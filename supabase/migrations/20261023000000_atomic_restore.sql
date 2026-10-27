-- ==============================================================================
-- LOCAPSICO - MIGRATION: RESTAURAÇÃO ATÔMICA TRANSACIONAL DO SISTEMA (RPC)
-- Arquivo: supabase/migrations/20261023000000_atomic_restore.sql
-- ==============================================================================
-- ATENÇÃO OBRIGATÓRIA DE SEGURANÇA:
-- Esta migração define a função transacional de restauração completa no PostgreSQL.
-- Executa em um único bloco de transação atômica (tudo ou nada), garantindo que
-- falhas durante a restauração causem rollback total sem deixar o banco inconsistente.
-- NÃO DEVE SER APLICADA NO BANCO DE PRODUÇÃO SEM AUTORIZAÇÃO EXPRESSA E JANELA PLANEJADA.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.execute_admin_full_restore(
  p_backup_data JSONB,
  p_caller_admin_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_profile RECORD;
  v_admin_name TEXT;
  v_counts JSONB;
  v_profiles_count INTEGER := 0;
  v_professionals_count INTEGER := 0;
  v_clients_count INTEGER := 0;
  v_rooms_count INTEGER := 0;
  v_bookings_count INTEGER := 0;
  v_payments_count INTEGER := 0;
  v_blocked_count INTEGER := 0;
  v_settings_count INTEGER := 0;
  v_audit_count INTEGER := 0;
BEGIN
  -- 1. VALIDAÇÃO DE AUTORIZAÇÃO DO EXECUTOR (RBAC)
  IF p_caller_admin_id IS NULL THEN
    RAISE EXCEPTION 'Identificador do administrador executor (p_caller_admin_id) é obrigatório.'
      USING ERRCODE = '42501';
  END IF;

  SELECT id, full_name, email, role, status
  INTO v_admin_profile
  FROM public.profiles
  WHERE id = p_caller_admin_id;

  IF v_admin_profile.id IS NULL THEN
    RAISE EXCEPTION 'Perfil do administrador executor não foi encontrado no banco de dados.'
      USING ERRCODE = '42501';
  END IF;

  IF lower(v_admin_profile.role) <> 'admin' THEN
    RAISE EXCEPTION 'Permissão negada: o usuário executor não possui privilégios de administrador (role <> admin).'
      USING ERRCODE = '42501';
  END IF;

  IF upper(v_admin_profile.status) <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Permissão negada: a conta do administrador executor encontra-se inativa.'
      USING ERRCODE = '42501';
  END IF;

  v_admin_name := COALESCE(v_admin_profile.full_name, 'Administrador');

  -- 2. VALIDAÇÃO BÁSICA DO PAYLOAD DE DADOS
  IF p_backup_data IS NULL OR jsonb_typeof(p_backup_data) <> 'object' THEN
    RAISE EXCEPTION 'Payload de dados do backup (p_backup_data) inválido ou nulo.'
      USING ERRCODE = '22000';
  END IF;

  IF NOT (
    p_backup_data ? 'profiles' AND
    p_backup_data ? 'professionals' AND
    p_backup_data ? 'clients' AND
    p_backup_data ? 'rooms' AND
    p_backup_data ? 'bookings' AND
    p_backup_data ? 'payments' AND
    p_backup_data ? 'blocked_slots' AND
    p_backup_data ? 'settings' AND
    p_backup_data ? 'audit_logs'
  ) THEN
    RAISE EXCEPTION 'Estrutura do backup incompleta: uma ou mais tabelas obrigatórias ausentes no payload.'
      USING ERRCODE = '22000';
  END IF;

  -- 3. DESATIVAÇÃO TEMPORÁRIA DE TRIGGERS CONCORRENTES PARA RESTAURAÇÃO DO SNAPSHOT
  BEGIN
    ALTER TABLE public.bookings DISABLE TRIGGER trg_check_booking_conflict;
  EXCEPTION WHEN OTHERS THEN
    -- Trigger pode não existir em esquemas anteriores
    NULL;
  END;

  BEGIN
    -- 4. LIMPEZA DETERMINÍSTICA ORDENADA (FILHAS -> MÃES)
    -- Garante que nenhuma violação de chave estrangeira ocorra durante a limpeza
    DELETE FROM public.payments;
    DELETE FROM public.bookings;
    DELETE FROM public.blocked_slots;
    DELETE FROM public.clients;
    DELETE FROM public.audit_logs;
    DELETE FROM public.professionals;

    -- Preserva a conta do administrador logado na tabela profiles para manter o vínculo auth
    DELETE FROM public.profiles WHERE id <> p_caller_admin_id;

    DELETE FROM public.rooms;
    DELETE FROM public.settings;

    -- 5. INSERÇÃO EM ORDEM DETERMINÍSTICA (MÃES -> FILHAS)

    -- 5.1 TABELA: settings
    INSERT INTO public.settings (
      id,
      establishment_name,
      contact_email,
      contact_phone,
      open_hour,
      close_hour,
      cancellation_limit_hours,
      allow_holidays_global,
      unblocked_holidays,
      created_at,
      updated_at
    )
    SELECT
      COALESCE(elem->>'id', 'global'),
      COALESCE(elem->>'establishment_name', 'LocaPsico'),
      COALESCE(elem->>'contact_email', 'contato@locapsico.com.br'),
      COALESCE(elem->>'contact_phone', '(11) 98765-4321'),
      COALESCE((elem->>'open_hour')::INTEGER, 7),
      COALESCE((elem->>'close_hour')::INTEGER, 22),
      COALESCE((elem->>'cancellation_limit_hours')::INTEGER, 24),
      COALESCE((elem->>'allow_holidays_global')::BOOLEAN, false),
      COALESCE(
        ARRAY(SELECT jsonb_array_elements_text(elem->'unblocked_holidays')),
        '{}'::TEXT[]
      ),
      COALESCE((elem->>'created_at')::TIMESTAMPTZ, now()),
      COALESCE((elem->>'updated_at')::TIMESTAMPTZ, now())
    FROM jsonb_array_elements(p_backup_data->'settings') AS elem
    ON CONFLICT (id) DO UPDATE SET
      establishment_name = EXCLUDED.establishment_name,
      contact_email = EXCLUDED.contact_email,
      contact_phone = EXCLUDED.contact_phone,
      open_hour = EXCLUDED.open_hour,
      close_hour = EXCLUDED.close_hour,
      cancellation_limit_hours = EXCLUDED.cancellation_limit_hours,
      allow_holidays_global = EXCLUDED.allow_holidays_global,
      unblocked_holidays = EXCLUDED.unblocked_holidays,
      updated_at = now();

    GET DIAGNOSTICS v_settings_count = ROW_COUNT;

    -- 5.2 TABELA: rooms
    INSERT INTO public.rooms (
      id,
      name,
      description,
      hourly_rate,
      period_rate,
      morning_rate,
      afternoon_rate,
      night_rate,
      opening_time,
      closing_time,
      status,
      notes,
      created_at,
      updated_at
    )
    SELECT
      elem->>'id',
      COALESCE(elem->>'name', elem->>'id'),
      elem->>'description',
      COALESCE((elem->>'hourly_rate')::NUMERIC(10,2), 40.00),
      COALESCE((elem->>'period_rate')::NUMERIC(10,2), 350.00),
      COALESCE((elem->>'morning_rate')::NUMERIC(10,2), 150.00),
      COALESCE((elem->>'afternoon_rate')::NUMERIC(10,2), 180.00),
      COALESCE((elem->>'night_rate')::NUMERIC(10,2), 130.00),
      COALESCE((elem->>'opening_time')::INTEGER, 7),
      COALESCE((elem->>'closing_time')::INTEGER, 22),
      COALESCE(elem->>'status', 'ACTIVE'),
      elem->>'notes',
      COALESCE((elem->>'created_at')::TIMESTAMPTZ, now()),
      COALESCE((elem->>'updated_at')::TIMESTAMPTZ, now())
    FROM jsonb_array_elements(p_backup_data->'rooms') AS elem
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      hourly_rate = EXCLUDED.hourly_rate,
      period_rate = EXCLUDED.period_rate,
      morning_rate = EXCLUDED.morning_rate,
      afternoon_rate = EXCLUDED.afternoon_rate,
      night_rate = EXCLUDED.night_rate,
      opening_time = EXCLUDED.opening_time,
      closing_time = EXCLUDED.closing_time,
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      updated_at = now();

    GET DIAGNOSTICS v_rooms_count = ROW_COUNT;

    -- 5.3 TABELA: profiles
    -- Insere/atualiza perfis do backup, preservando a função e status ativo do administrador executor
    INSERT INTO public.profiles (
      id,
      full_name,
      email,
      phone,
      cpf,
      role,
      status,
      created_at,
      updated_at
    )
    SELECT
      (elem->>'id')::UUID,
      COALESCE(elem->>'full_name', 'Usuário'),
      elem->>'email',
      elem->>'phone',
      elem->>'cpf',
      CASE
        WHEN (elem->>'id')::UUID = p_caller_admin_id THEN 'admin'
        ELSE COALESCE(elem->>'role', 'professional')
      END,
      CASE
        WHEN (elem->>'id')::UUID = p_caller_admin_id THEN 'ACTIVE'
        ELSE COALESCE(elem->>'status', 'ACTIVE')
      END,
      COALESCE((elem->>'created_at')::TIMESTAMPTZ, now()),
      COALESCE((elem->>'updated_at')::TIMESTAMPTZ, now())
    FROM jsonb_array_elements(p_backup_data->'profiles') AS elem
    ON CONFLICT (id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      cpf = EXCLUDED.cpf,
      role = CASE WHEN profiles.id = p_caller_admin_id THEN 'admin' ELSE EXCLUDED.role END,
      status = CASE WHEN profiles.id = p_caller_admin_id THEN 'ACTIVE' ELSE EXCLUDED.status END,
      updated_at = now();

    GET DIAGNOSTICS v_profiles_count = ROW_COUNT;

    -- 5.4 TABELA: professionals
    INSERT INTO public.professionals (
      id,
      user_id,
      full_name,
      email,
      phone,
      cpf,
      professional_type,
      registration_number,
      status,
      created_at,
      updated_at
    )
    SELECT
      COALESCE((elem->>'id')::UUID, gen_random_uuid()),
      (elem->>'user_id')::UUID,
      COALESCE(elem->>'full_name', 'Profissional'),
      COALESCE(elem->>'email', ''),
      elem->>'phone',
      elem->>'cpf',
      COALESCE(elem->>'professional_type', 'Psicólogo(a)'),
      elem->>'registration_number',
      COALESCE(elem->>'status', 'ACTIVE'),
      COALESCE((elem->>'created_at')::TIMESTAMPTZ, now()),
      COALESCE((elem->>'updated_at')::TIMESTAMPTZ, now())
    FROM jsonb_array_elements(p_backup_data->'professionals') AS elem
    ON CONFLICT (user_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      cpf = EXCLUDED.cpf,
      professional_type = EXCLUDED.professional_type,
      registration_number = EXCLUDED.registration_number,
      status = EXCLUDED.status,
      updated_at = now();

    GET DIAGNOSTICS v_professionals_count = ROW_COUNT;

    -- 5.5 TABELA: clients
    INSERT INTO public.clients (
      id,
      professional_id,
      full_name,
      cpf,
      birth_date,
      phone,
      whatsapp,
      email,
      address,
      notes,
      status,
      created_at,
      updated_at
    )
    SELECT
      (elem->>'id')::UUID,
      (elem->>'professional_id')::UUID,
      COALESCE(elem->>'full_name', 'Paciente'),
      elem->>'cpf',
      CASE WHEN elem->>'birth_date' IS NOT NULL AND elem->>'birth_date' <> '' THEN (elem->>'birth_date')::DATE ELSE NULL END,
      elem->>'phone',
      elem->>'whatsapp',
      elem->>'email',
      elem->>'address',
      elem->>'notes',
      COALESCE(elem->>'status', 'ACTIVE'),
      COALESCE((elem->>'created_at')::TIMESTAMPTZ, now()),
      COALESCE((elem->>'updated_at')::TIMESTAMPTZ, now())
    FROM jsonb_array_elements(p_backup_data->'clients') AS elem;

    GET DIAGNOSTICS v_clients_count = ROW_COUNT;

    -- 5.6 TABELA: bookings
    INSERT INTO public.bookings (
      id,
      professional_id,
      client_id,
      room_id,
      booking_date,
      start_time,
      end_time,
      booking_type,
      total_hours,
      hourly_rate,
      period_rate,
      total_amount,
      payment_status,
      status,
      period_shift,
      period_name,
      notes,
      paid_at,
      paid_notes,
      paid_by_admin,
      recurrence_id,
      recurrence_rule,
      recurrence_index,
      recurrence_total,
      created_at,
      updated_at
    )
    SELECT
      (elem->>'id')::UUID,
      (elem->>'professional_id')::UUID,
      CASE WHEN elem->>'client_id' IS NOT NULL AND elem->>'client_id' <> '' THEN (elem->>'client_id')::UUID ELSE NULL END,
      elem->>'room_id',
      (elem->>'booking_date')::DATE,
      (elem->>'start_time')::INTEGER,
      (elem->>'end_time')::INTEGER,
      COALESCE(elem->>'booking_type', 'HOURLY'),
      COALESCE((elem->>'total_hours')::INTEGER, (elem->>'end_time')::INTEGER - (elem->>'start_time')::INTEGER),
      COALESCE((elem->>'hourly_rate')::NUMERIC(10,2), 40.00),
      COALESCE((elem->>'period_rate')::NUMERIC(10,2), 350.00),
      COALESCE((elem->>'total_amount')::NUMERIC(10,2), 40.00),
      COALESCE(elem->>'payment_status', 'PENDING'),
      COALESCE(elem->>'status', 'confirmed'),
      elem->>'period_shift',
      elem->>'period_name',
      elem->>'notes',
      CASE WHEN elem->>'paid_at' IS NOT NULL AND elem->>'paid_at' <> '' THEN (elem->>'paid_at')::TIMESTAMPTZ ELSE NULL END,
      elem->>'paid_notes',
      elem->>'paid_by_admin',
      CASE WHEN elem->>'recurrence_id' IS NOT NULL AND elem->>'recurrence_id' <> '' THEN (elem->>'recurrence_id')::UUID ELSE NULL END,
      elem->>'recurrence_rule',
      CASE WHEN elem->>'recurrence_index' IS NOT NULL AND elem->>'recurrence_index' <> '' THEN (elem->>'recurrence_index')::INTEGER ELSE NULL END,
      CASE WHEN elem->>'recurrence_total' IS NOT NULL AND elem->>'recurrence_total' <> '' THEN (elem->>'recurrence_total')::INTEGER ELSE NULL END,
      COALESCE((elem->>'created_at')::TIMESTAMPTZ, now()),
      COALESCE((elem->>'updated_at')::TIMESTAMPTZ, now())
    FROM jsonb_array_elements(p_backup_data->'bookings') AS elem;

    GET DIAGNOSTICS v_bookings_count = ROW_COUNT;

    -- 5.7 TABELA: blocked_slots
    INSERT INTO public.blocked_slots (
      id,
      room_id,
      blocked_date,
      start_time,
      end_time,
      reason,
      created_by,
      created_at
    )
    SELECT
      (elem->>'id')::UUID,
      elem->>'room_id',
      (elem->>'blocked_date')::DATE,
      (elem->>'start_time')::INTEGER,
      (elem->>'end_time')::INTEGER,
      COALESCE(elem->>'reason', 'Bloqueio Administrativo'),
      COALESCE(elem->>'created_by', v_admin_name),
      COALESCE((elem->>'created_at')::TIMESTAMPTZ, now())
    FROM jsonb_array_elements(p_backup_data->'blocked_slots') AS elem;

    GET DIAGNOSTICS v_blocked_count = ROW_COUNT;

    -- 5.8 TABELA: payments
    INSERT INTO public.payments (
      id,
      booking_id,
      professional_id,
      amount,
      payment_date,
      status,
      notes,
      created_by,
      created_at,
      updated_at
    )
    SELECT
      (elem->>'id')::UUID,
      CASE WHEN elem->>'booking_id' IS NOT NULL AND elem->>'booking_id' <> '' THEN (elem->>'booking_id')::UUID ELSE NULL END,
      (elem->>'professional_id')::UUID,
      (elem->>'amount')::NUMERIC(10,2),
      COALESCE((elem->>'payment_date')::DATE, CURRENT_DATE),
      COALESCE(elem->>'status', 'PAID'),
      elem->>'notes',
      COALESCE(elem->>'created_by', v_admin_name),
      COALESCE((elem->>'created_at')::TIMESTAMPTZ, now()),
      COALESCE((elem->>'updated_at')::TIMESTAMPTZ, now())
    FROM jsonb_array_elements(p_backup_data->'payments') AS elem;

    GET DIAGNOSTICS v_payments_count = ROW_COUNT;

    -- 5.9 TABELA: audit_logs
    INSERT INTO public.audit_logs (
      id,
      user_id,
      user_name,
      action,
      details,
      timestamp
    )
    SELECT
      (elem->>'id')::UUID,
      CASE WHEN elem->>'user_id' IS NOT NULL AND elem->>'user_id' <> '' THEN (elem->>'user_id')::UUID ELSE NULL END,
      COALESCE(elem->>'user_name', 'Sistema'),
      COALESCE(elem->>'action', 'Ação'),
      COALESCE(elem->>'details', ''),
      COALESCE((elem->>'timestamp')::TIMESTAMPTZ, now())
    FROM jsonb_array_elements(p_backup_data->'audit_logs') AS elem;

    GET DIAGNOSTICS v_audit_count = ROW_COUNT;

    -- Registra o evento oficial da restauração no audit_logs
    INSERT INTO public.audit_logs (
      id,
      user_id,
      user_name,
      action,
      details,
      timestamp
    ) VALUES (
      gen_random_uuid(),
      p_caller_admin_id,
      v_admin_name,
      'Restauração de Backup Completo (Atômica)',
      format('Restauração integral executada via procedimento atômico PostgreSQL. Total de registros: %s.',
             (v_profiles_count + v_professionals_count + v_clients_count + v_rooms_count +
              v_bookings_count + v_payments_count + v_blocked_count + v_settings_count + v_audit_count)),
      now()
    );
    v_audit_count := v_audit_count + 1;

    -- 6. REATIVAÇÃO DO TRIGGER DE CONFLITOS DE RESERVAS
    BEGIN
      ALTER TABLE public.bookings ENABLE TRIGGER trg_check_booking_conflict;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    -- Montagem do retorno consolidado
    v_counts := jsonb_build_object(
      'profiles', v_profiles_count,
      'professionals', v_professionals_count,
      'clients', v_clients_count,
      'rooms', v_rooms_count,
      'bookings', v_bookings_count,
      'payments', v_payments_count,
      'blocked_slots', v_blocked_count,
      'settings', v_settings_count,
      'audit_logs', v_audit_count
    );

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Backup Completo restaurado com sucesso e atomicidade garantida!',
      'restored_at', now(),
      'restored_by', jsonb_build_object(
        'id', p_caller_admin_id,
        'email', v_admin_profile.email,
        'name', v_admin_name
      ),
      'counts', v_counts,
      'total_records', (
        v_profiles_count + v_professionals_count + v_clients_count + v_rooms_count +
        v_bookings_count + v_payments_count + v_blocked_count + v_settings_count + v_audit_count
      )
    );

  EXCEPTION WHEN OTHERS THEN
    -- Garante a reativação do trigger antes de propagar o erro e disparar rollback automático
    BEGIN
      ALTER TABLE public.bookings ENABLE TRIGGER trg_check_booking_conflict;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RAISE;
  END;
END;
$$;

-- Permissões rigorosas de execução
REVOKE ALL ON FUNCTION public.execute_admin_full_restore(JSONB, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_admin_full_restore(JSONB, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_admin_full_restore(JSONB, UUID) TO service_role;
