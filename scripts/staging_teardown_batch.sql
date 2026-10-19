-- ==============================================================================
-- LIMPEZA SEGURA TRANSACTIONAL POR LOTE DE HOMOLOGAÇÃO (BATCH_ID)
-- Arquivo: scripts/staging_teardown_batch.sql
-- ==============================================================================
-- NOTA METODOLÓGICA DE SEGURANÇA:
-- 1. Este script adota estratégia de Defesa em Profundidade.
-- 2. A validação de ambiente deve ser realizada no executor ANTES da conexão.
-- 3. O modo padrão deste script é SIMULAÇÃO (c_dry_run := true).
-- 4. Exclusões destrutivas exigem c_dry_run := false E token de confirmação idêntico.
-- ==============================================================================

DO $$
DECLARE
  -- 1. Parâmetros de Execução (SIMULAÇÃO É O PADRÃO OBRIGATÓRIO)
  c_dry_run BOOLEAN := true;
  c_batch_id TEXT := 'batch_HOMOLOG_SUBSTITUIR';
  c_confirmation_token TEXT := '';

  -- Constantes de Auditoria
  c_expected_token TEXT;
  c_tag TEXT;
  v_prod_ref TEXT := 'gqpavuqopukyfeyqyrxc';
  v_host TEXT;
  v_del_payments INTEGER := 0;
  v_del_bookings INTEGER := 0;
  v_del_keys INTEGER := 0;
  v_del_blocks INTEGER := 0;
  v_del_logs INTEGER := 0;
  v_preview_bookings INTEGER := 0;
BEGIN
  -- 2. Salvaguarda no Banco: Bloqueio caso o cabeçalho host aponte para produção
  SELECT current_setting('request.headers', true)::json->>'host' INTO v_host;
  IF v_host IS NOT NULL AND v_host LIKE '%' || v_prod_ref || '%' THEN
    RAISE EXCEPTION 'BLOQUEIO FATAL: Tentativa de executar limpeza em PRODUÇÃO (%) detectada!', v_prod_ref;
  END IF;

  -- 3. Validação do Formato Estrito do BATCH_ID
  IF c_batch_id IS NULL 
     OR c_batch_id = 'batch_HOMOLOG_SUBSTITUIR' 
     OR NOT (c_batch_id ~ '^batch_[0-9]{8}_[0-9]{4,6}_[a-zA-Z0-9_-]{4,20}$') THEN
    RAISE EXCEPTION 'BLOQUEIO: BATCH_ID "%" inválido. Formato esperado: batch_YYYYMMDD_HHMMSS_<entropia>', c_batch_id;
  END IF;

  c_tag := '[BATCH:' || c_batch_id || ']';
  c_expected_token := 'CONFIRMO_EXCLUSAO_DEFINITIVA_LOTE_' || c_batch_id;

  -- 4. Contagem Prévia de Registros Afetados
  SELECT count(*) INTO v_preview_bookings 
  FROM public.bookings 
  WHERE notes LIKE '%' || c_tag || '%';

  -- 5. Comportamento no Modo Simulação (Dry Run)
  IF c_dry_run THEN
    RAISE NOTICE '================================================================';
    RAISE NOTICE '[MODO SIMULAÇÃO ATIVO] NENHUM DADO FOI ALTERADO OU REMOVIDO.';
    RAISE NOTICE 'Lote avaliado: %', c_batch_id;
    RAISE NOTICE 'Reservas associadas identificadas: %', v_preview_bookings;
    RAISE NOTICE 'Para executar de forma destrutiva, configure c_dry_run := false e c_confirmation_token := ''%''.', c_expected_token;
    RAISE NOTICE '================================================================';
    RETURN;
  END IF;

  -- 6. Validação de Confirmação Explícita para Execução Real
  IF c_confirmation_token <> c_expected_token THEN
    RAISE EXCEPTION 'BLOQUEIO: Token de confirmação incorreto ou ausente. Esperado: "%"', c_expected_token;
  END IF;

  IF v_preview_bookings = 0 THEN
    RAISE NOTICE 'Aviso: Nenhuma reserva encontrada para o lote %. Nenhuma exclusão necessária.', c_batch_id;
    RETURN;
  END IF;

  -- 7. Execução Atômica e Ordenada por Integridade Referencial
  -- 7.1 Pagamentos vinculados às reservas do lote
  WITH target_bookings AS (
    SELECT id FROM public.bookings WHERE position(c_tag in notes) > 0
  )
  DELETE FROM public.payments
  WHERE booking_id IN (SELECT id FROM target_bookings);
  GET DIAGNOSTICS v_del_payments = ROW_COUNT;

  -- 7.2 Reservas do lote
  DELETE FROM public.bookings
  WHERE position(c_tag in notes) > 0;
  GET DIAGNOSTICS v_del_bookings = ROW_COUNT;

  -- 7.3 Chaves de idempotência exclusivas do lote (prefixo exato 'rec-' || c_batch_id || '-')
  DELETE FROM public.booking_idempotency_keys
  WHERE position(('rec-' || c_batch_id || '-') in key) = 1;
  GET DIAGNOSTICS v_del_keys = ROW_COUNT;

  -- 7.4 Bloqueios de teste do lote
  DELETE FROM public.blocked_slots
  WHERE position(c_tag in reason) > 0;
  GET DIAGNOSTICS v_del_blocks = ROW_COUNT;

  -- 7.5 Logs de auditoria do lote
  DELETE FROM public.audit_logs
  WHERE position(c_tag in details) > 0;
  GET DIAGNOSTICS v_del_logs = ROW_COUNT;

  RAISE NOTICE '================================================================';
  RAISE NOTICE '[LIMPEZA CONCLUÍDA COM SUCESSO]';
  RAISE NOTICE 'Lote: % | Pagamentos: % | Reservas: % | Chaves: % | Bloqueios: % | Logs: %',
    c_batch_id, v_del_payments, v_del_bookings, v_del_keys, v_del_blocks, v_del_logs;
  RAISE NOTICE '================================================================';
END $$;
