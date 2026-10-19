-- ==============================================================================
-- MIGRATION: Utilitário Transacional de Teardown para Staging (Homologação)
-- Arquivo: supabase/migrations/20261015000000_staging_teardown_helper.sql
-- ==============================================================================
-- NOTA ARQUITETURAL:
-- Esta migration isola a rotina de limpeza de lotes de homologação em arquivo
-- próprio, mantendo a migration de agendamentos recorrentes (20261014000000)
-- 100% restrita às regras de negócio e ao esquema do produto.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.teardown_staging_batch(
  p_batch_id TEXT,
  p_confirmation_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_tag TEXT;
  v_expected_token TEXT;
  v_del_payments INTEGER := 0;
  v_del_bookings INTEGER := 0;
  v_del_keys INTEGER := 0;
  v_del_blocks INTEGER := 0;
  v_del_logs INTEGER := 0;
BEGIN
  -- 1. Validação de Autorização: Apenas administradores ou service_role comprovado
  v_caller_id := auth.uid();
  IF v_caller_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller_id AND lower(role) = 'admin') THEN
      RAISE EXCEPTION 'Acesso negado: operação restrita a administradores.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF COALESCE(current_setting('request.jwt.claim.role', true), '') <> 'service_role' 
       AND COALESCE(auth.role(), '') <> 'service_role' 
       AND session_user NOT IN ('postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'Operação não permitida: credencial administrativa exigida.' USING ERRCODE = '28000';
    END IF;
  END IF;

  -- 2. Validação estrita do formato do BATCH_ID (Anti-injeção e anti-genérico)
  IF p_batch_id IS NULL OR NOT (p_batch_id ~ '^batch_[0-9]{8}_[0-9]{4,6}_[a-zA-Z0-9_-]{4,20}$') THEN
    RAISE EXCEPTION 'BATCH_ID inválido. Deve seguir rigorosamente o padrão "batch_YYYYMMDD_HHMMSS_<entropia>".' USING ERRCODE = '22000';
  END IF;

  -- 3. Validação do Token de Confirmação Exato
  v_expected_token := 'CONFIRMO_EXCLUSAO_DEFINITIVA_LOTE_' || p_batch_id;
  IF p_confirmation_token <> v_expected_token THEN
    RAISE EXCEPTION 'Token de confirmação inválido ou divergente.' USING ERRCODE = '22000';
  END IF;

  v_tag := '[BATCH:' || p_batch_id || ']';

  -- 4. Exclusão Atômica e Ordenada por Integridade Referencial
  -- Utiliza position() para correspondência exata de substring, evitando interpretação de '_' como curinga SQL LIKE
  -- 4.1 Pagamentos vinculados às reservas do lote
  WITH target_bookings AS (
    SELECT id FROM public.bookings WHERE position(v_tag in notes) > 0
  )
  DELETE FROM public.payments
  WHERE booking_id IN (SELECT id FROM target_bookings);
  GET DIAGNOSTICS v_del_payments = ROW_COUNT;

  -- 4.2 Reservas do lote
  DELETE FROM public.bookings
  WHERE position(v_tag in notes) > 0;
  GET DIAGNOSTICS v_del_bookings = ROW_COUNT;

  -- 4.3 Chaves de idempotência exclusivas do lote (prefixo exato 'rec-' || p_batch_id || '-')
  DELETE FROM public.booking_idempotency_keys
  WHERE position(('rec-' || p_batch_id || '-') in key) = 1;
  GET DIAGNOSTICS v_del_keys = ROW_COUNT;

  -- 4.4 Bloqueios de sala do lote
  DELETE FROM public.blocked_slots
  WHERE position(v_tag in reason) > 0;
  GET DIAGNOSTICS v_del_blocks = ROW_COUNT;

  -- 4.5 Logs de auditoria do lote
  DELETE FROM public.audit_logs
  WHERE position(v_tag in details) > 0;
  GET DIAGNOSTICS v_del_logs = ROW_COUNT;

  RETURN jsonb_build_object(
    'batch_id', p_batch_id,
    'payments_deleted', v_del_payments,
    'bookings_deleted', v_del_bookings,
    'idempotency_keys_deleted', v_del_keys,
    'blocked_slots_deleted', v_del_blocks,
    'audit_logs_deleted', v_del_logs
  );
END;
$$;

ALTER FUNCTION public.teardown_staging_batch(TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.teardown_staging_batch(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.teardown_staging_batch(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teardown_staging_batch(TEXT, TEXT) TO service_role;
