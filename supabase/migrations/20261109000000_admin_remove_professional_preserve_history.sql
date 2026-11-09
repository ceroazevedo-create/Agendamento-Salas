-- Remove um profissional sem destruir o histórico financeiro e de reservas.
-- Bloqueia imediatamente o uso das tabelas públicas por sessões de perfis inativos.
-- A verificação é feita no banco, não apenas na interface, pois JWTs já emitidos
-- podem permanecer válidos até expirarem.
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND UPPER(COALESCE(status, '')) = 'ACTIVE'
  );
$$;

REVOKE ALL ON FUNCTION public.is_active_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_user() TO authenticated, service_role;

-- Políticas RESTRICTIVE são combinadas com AND às políticas permissivas atuais.
-- Assim, preservam-se as regras de cada tabela, mas nenhum perfil INACTIVE
-- consegue consultar ou alterar dados via API usando um token antigo.
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'profiles',
    'professionals',
    'clients',
    'rooms',
    'bookings',
    'payments',
    'blocked_slots',
    'settings',
    'audit_logs'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "Somente perfis ativos acessam %I" ON public.%I',
      v_table, v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.is_active_user()) WITH CHECK (public.is_active_user())',
      'Somente perfis ativos acessam ' || v_table,
      v_table
    );
  END LOOP;
END;
$$;

-- A operação é chamada exclusivamente pelo endpoint administrativo com service_role.
CREATE OR REPLACE FUNCTION public.admin_remove_professional(
  p_user_id UUID,
  p_admin_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_role TEXT;
  v_target_status TEXT;
  v_target_name TEXT;
  v_admin_role TEXT;
  v_admin_status TEXT;
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_deleted_future_bookings INTEGER := 0;
  v_preserved_historical_bookings INTEGER := 0;
BEGIN
  IF p_user_id IS NULL OR p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'Identificadores do profissional e administrador são obrigatórios.';
  END IF;

  SELECT role, status
    INTO v_admin_role, v_admin_status
  FROM public.profiles
  WHERE id = p_admin_user_id
  FOR SHARE;

  IF NOT FOUND OR LOWER(COALESCE(v_admin_role, '')) <> 'admin'
     OR UPPER(COALESCE(v_admin_status, '')) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Operação permitida somente para administrador ativo.';
  END IF;

  SELECT role, status, full_name
    INTO v_target_role, v_target_status, v_target_name
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profissional não encontrado.';
  END IF;

  IF LOWER(COALESCE(v_target_role, '')) <> 'professional' THEN
    RAISE EXCEPTION 'Não é permitido excluir contas que não sejam profissionais.';
  END IF;

  -- Idempotência: se a transação anterior já retirou o cadastro e marcou
  -- o perfil como inativo, uma nova chamada apenas permite concluir/repetir
  -- a etapa de desativação no Supabase Auth, sem duplicar a auditoria.
  IF UPPER(COALESCE(v_target_status, '')) = 'INACTIVE'
     AND NOT EXISTS (
       SELECT 1 FROM public.professionals WHERE user_id = p_user_id
     ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_removed', true,
      'deleted_future_bookings', 0,
      'preserved_historical_bookings', 0
    );
  END IF;

  -- Exclui todas as reservas com data posterior à data atual de São Paulo.
  -- Reservas de hoje e anteriores permanecem no histórico.
  DELETE FROM public.bookings
  WHERE professional_id = p_user_id
    AND booking_date > v_today;
  GET DIAGNOSTICS v_deleted_future_bookings = ROW_COUNT;

  -- Preserva bookings passados e pagamentos; a tabela payments usa ON DELETE SET NULL
  -- para booking_id, portanto eventual lançamento de reserva futura não é apagado.
  SELECT COUNT(*)::INTEGER
    INTO v_preserved_historical_bookings
  FROM public.bookings
  WHERE professional_id = p_user_id
    AND booking_date <= v_today;

  -- Remove o cadastro operacional do profissional, mas mantém profiles para
  -- satisfazer as FKs históricas de bookings, payments e clients.
  DELETE FROM public.professionals
  WHERE user_id = p_user_id;

  UPDATE public.profiles
  SET status = 'INACTIVE',
      updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO public.audit_logs (user_id, user_name, action, details)
  VALUES (
    p_admin_user_id,
    'Administração',
    'Exclusão de Profissional',
    format(
      'Profissional %s removido do cadastro. %s agendamento(s) futuro(s) excluído(s); %s agendamento(s) histórico(s) preservado(s).',
      COALESCE(v_target_name, p_user_id::TEXT),
      v_deleted_future_bookings,
      v_preserved_historical_bookings
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'deleted_future_bookings', v_deleted_future_bookings,
    'preserved_historical_bookings', v_preserved_historical_bookings
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remove_professional(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_remove_professional(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.admin_remove_professional(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_professional(UUID, UUID) TO service_role;
