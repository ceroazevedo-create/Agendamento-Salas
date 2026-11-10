-- Aplica a política administrativa de feriados à criação de séries recorrentes.
-- Mantém a assinatura e as permissões da RPC existente; não executa alterações de dados.
CREATE OR REPLACE FUNCTION public.create_recurring_series(
  p_room_id TEXT,
  p_professional_id UUID,
  p_client_id UUID DEFAULT NULL,
  p_booking_type TEXT DEFAULT 'HOURLY',
  p_hour INTEGER DEFAULT 7,
  p_duration_hours INTEGER DEFAULT 1,
  p_period_shift TEXT DEFAULT NULL,
  p_period_name TEXT DEFAULT NULL,
  p_recurrence_rule TEXT DEFAULT 'WEEKLY',
  p_dates DATE[] DEFAULT '{}',
  p_skip_conflicts BOOLEAN DEFAULT FALSE,
  p_notes TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_caller_role TEXT;
  v_caller_status TEXT;
  v_room RECORD;
  v_sorted_dates DATE[];
  v_cur_date DATE;
  v_day_of_week INTEGER;
  v_closing_hour INTEGER;
  v_start_hour INTEGER;
  v_end_hour INTEGER;
  v_duration INTEGER;
  
  v_amount_for_occ NUMERIC(10,2);
  v_period_rate_recorded NUMERIC(10,2);
  v_series_total_amount NUMERIC(10,2) := 0.00;
  v_has_conflict BOOLEAN;
  v_conflict_reason TEXT;
  
  v_series_id UUID;
  v_new_booking_id UUID;
  v_idx INTEGER;
  v_valid_count INTEGER := 0;
  
  v_canonical_json JSONB;
  v_request_hash TEXT;
  v_idem RECORD;
  
  v_created_ids UUID[] := '{}';
  v_created_dates DATE[] := '{}';
  v_skipped_dates_json JSONB := '[]'::jsonb;
  v_valid_dates DATE[] := '{}';
  v_valid_amounts NUMERIC(10,2)[] := '{}';
  v_valid_starts INTEGER[] := '{}';
  v_valid_ends INTEGER[] := '{}';
  v_valid_durations INTEGER[] := '{}';
  v_valid_period_rates NUMERIC(10,2)[] := '{}';
  v_lock_items JSONB;
  
  v_response_payload JSONB;
  v_final_notes TEXT;
  v_allow_holidays_global BOOLEAN := FALSE;
  v_unblocked_holidays TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- 7.1 AUTENTICAÇÃO E PERMISSÕES (RBAC)
  v_caller_id := auth.uid();

  IF v_caller_id IS NULL THEN
    IF (session_user IN ('postgres', 'supabase_admin') AND current_setting('request.jwt.claim.role', true) IS NULL)
       OR (COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' 
           AND COALESCE(auth.role(), '') = 'service_role') THEN
      v_caller_id := p_professional_id;
    ELSE
      RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.' USING ERRCODE = '28000';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_professional_id
      AND status = 'ACTIVE'
      AND lower(role) IN ('professional', 'admin')
  ) THEN
    RAISE EXCEPTION 'Profissional inexistente, inativo ou sem papel autorizado.'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(role), status
    INTO v_caller_role, v_caller_status
  FROM public.profiles
  WHERE id = v_caller_id;

  IF NOT FOUND
     OR v_caller_status IS DISTINCT FROM 'ACTIVE'
     OR v_caller_role IS NULL
     OR v_caller_role NOT IN ('professional', 'admin') THEN
    RAISE EXCEPTION 'Usuário sem perfil ativo ou sem permissão para agendar.'
      USING ERRCODE = '42501';
  END IF;

  IF v_caller_id <> p_professional_id THEN
    IF v_caller_role <> 'admin' THEN
      RAISE EXCEPTION 'Permissão negada: profissionais só podem agendar para si.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 7.2 VALIDAÇÃO DO CLIENTE (SE INFORMADO)
  IF p_client_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.clients 
      WHERE id = p_client_id 
        AND (professional_id = p_professional_id OR public.is_admin())
        AND status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Cliente inválido, inativo ou não vinculado a este profissional.' USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 7.3 VALIDAÇÃO DA SALA
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sala % não encontrada.', p_room_id USING ERRCODE = '22000';
  END IF;

  IF v_room.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'A sala % está em manutenção e indisponível para reservas.', p_room_id USING ERRCODE = '22000';
  END IF;


  -- 7.4 VALIDAÇÕES ESTRITAS DE PARÂMETROS
  IF p_booking_type IS NULL OR p_booking_type NOT IN ('HOURLY', 'PERIOD') THEN
    RAISE EXCEPTION 'Modalidade de agendamento inválida: %. Permitidas: HOURLY, PERIOD.', p_booking_type USING ERRCODE = '22000';
  END IF;

  IF p_booking_type = 'HOURLY' THEN
    IF p_hour IS NULL OR p_hour < 7 OR p_hour >= 22 THEN
      RAISE EXCEPTION 'Horário inicial inválido para locação por hora: %. As salas funcionam a partir das 07:00.', p_hour USING ERRCODE = '22000';
    END IF;

    IF p_duration_hours IS NULL OR p_duration_hours < 1 OR (p_hour + p_duration_hours) > 22 THEN
      RAISE EXCEPTION 'Duração inválida para locação por hora: %h a partir das %:00. O horário de encerramento máximo é 22:00.', p_duration_hours, p_hour USING ERRCODE = '22000';
    END IF;
  ELSIF p_booking_type = 'PERIOD' THEN
    IF p_period_shift IS NULL OR p_period_shift NOT IN ('MORNING', 'AFTERNOON', 'NIGHT', 'FULL_DAY') THEN
      RAISE EXCEPTION 'Turno inválido ou não informado para agendamento por período: %. Permitidos: MORNING, AFTERNOON, NIGHT, FULL_DAY.', p_period_shift USING ERRCODE = '22000';
    END IF;
  END IF;

  -- Não usar valores padrão da interface como se estivessem persistidos no banco.
  -- O administrador precisa salvar as tarifas por turno após as colunas serem criadas.
  IF p_booking_type = 'PERIOD' THEN
    IF p_period_shift = 'MORNING' AND v_room.morning_rate IS NULL THEN
      RAISE EXCEPTION 'A tarifa de manhã ainda não está cadastrada para a sala %. Peça ao administrador para salvar as tarifas.', p_room_id USING ERRCODE = '22000';
    ELSIF p_period_shift = 'AFTERNOON' AND v_room.afternoon_rate IS NULL THEN
      RAISE EXCEPTION 'A tarifa da tarde ainda não está cadastrada para a sala %. Peça ao administrador para salvar as tarifas.', p_room_id USING ERRCODE = '22000';
    ELSIF p_period_shift = 'NIGHT' AND v_room.night_rate IS NULL THEN
      RAISE EXCEPTION 'A tarifa da noite ainda não está cadastrada para a sala %. Peça ao administrador para salvar as tarifas.', p_room_id USING ERRCODE = '22000';
    ELSIF p_period_shift = 'FULL_DAY' AND v_room.period_rate IS NULL THEN
      RAISE EXCEPTION 'A tarifa integral ainda não está cadastrada para a sala %.', p_room_id USING ERRCODE = '22000';
    END IF;
  END IF;

  IF p_recurrence_rule IS NULL OR p_recurrence_rule NOT IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY') THEN
    RAISE EXCEPTION 'Frequência de recorrência inválida: %. Permitidas: DAILY, WEEKLY, BIWEEKLY, MONTHLY.', p_recurrence_rule USING ERRCODE = '22000';
  END IF;

  IF p_dates IS NULL OR cardinality(p_dates) = 0 THEN
    RAISE EXCEPTION 'Nenhuma data fornecida para a série recorrente.' USING ERRCODE = '22000';
  END IF;

  IF cardinality(p_dates) > 52 THEN
    RAISE EXCEPTION 'Limite máximo de 52 ocorrências por série excedido.' USING ERRCODE = '22000';
  END IF;

  SELECT array_agg(d ORDER BY d ASC) INTO v_sorted_dates 
  FROM (SELECT DISTINCT unnest(p_dates) AS d) sub;

  IF cardinality(v_sorted_dates) <> cardinality(p_dates) THEN
    RAISE EXCEPTION 'A lista de datas contém datas duplicadas.' USING ERRCODE = '22000';
  END IF;

  IF (v_sorted_dates[cardinality(v_sorted_dates)] - v_sorted_dates[1]) > 366 THEN
    RAISE EXCEPTION 'O horizonte temporal da série excede o limite de 366 dias.' USING ERRCODE = '22000';
  END IF;

  -- 7.5 PROTOCOLO DE IDEMPOTÊNCIA E HASH CANÔNICO
  v_canonical_json := jsonb_build_object(
    'booking_type', p_booking_type,
    'client_id', p_client_id,
    'dates', to_jsonb(v_sorted_dates),
    'duration_hours', p_duration_hours,
    'hour', p_hour,
    'notes', COALESCE(p_notes, ''),
    'period_name', COALESCE(p_period_shift, ''),
    'display_period_name', COALESCE(NULLIF(trim(p_period_name), ''), ''),
    'period_shift', COALESCE(p_period_shift, ''),
    'professional_id', p_professional_id,
    'recurrence_rule', p_recurrence_rule,
    'room_id', p_room_id,
    'skip_conflicts', p_skip_conflicts
  );
  v_request_hash := encode(digest(v_canonical_json::text, 'sha256'), 'hex');

  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('idempotency_key')::integer, hashtext(p_idempotency_key)::integer);

    SELECT * INTO v_idem FROM public.booking_idempotency_keys WHERE key = p_idempotency_key FOR UPDATE;
    IF FOUND THEN
      IF v_idem.user_id <> v_caller_id AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller_id AND (role = 'admin' OR role = 'ADMIN')) THEN
        RAISE EXCEPTION 'Acesso negado: esta chave de idempotência pertence a outro usuário.' USING ERRCODE = '42501';
      END IF;

      IF v_idem.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'Chave de idempotência reutilizada com parâmetros divergentes.' USING ERRCODE = '22000';
      END IF;

      IF v_idem.expires_at < now() THEN
        RAISE EXCEPTION 'Chave de idempotência expirada.' USING ERRCODE = '22000';
      END IF;

      IF v_idem.status = 'COMPLETED' THEN
        RETURN v_idem.response_payload;
      ELSIF v_idem.status = 'PROCESSING' THEN
        IF (now() - v_idem.updated_at) > INTERVAL '2 minutes' THEN
          UPDATE public.booking_idempotency_keys
          SET status = 'PROCESSING', updated_at = now()
          WHERE key = p_idempotency_key;
        ELSE
          RAISE EXCEPTION 'Uma requisição com esta chave de idempotência já está em processamento.' USING ERRCODE = '55P03';
        END IF;
      ELSIF v_idem.status = 'FAILED' THEN
        UPDATE public.booking_idempotency_keys
        SET status = 'PROCESSING', updated_at = now()
        WHERE key = p_idempotency_key;
      END IF;
    ELSE
      INSERT INTO public.booking_idempotency_keys (
        key, user_id, request_hash, status, created_at, updated_at, expires_at
      ) VALUES (
        p_idempotency_key, v_caller_id, v_request_hash, 'PROCESSING', now(), now(), now() + INTERVAL '24 hours'
      );
    END IF;
  END IF;

  -- 7.6 AQUISIÇÃO DETERMINÍSTICA DE ADVISORY LOCKS
  SELECT jsonb_agg(jsonb_build_object('room_id', p_room_id, 'date', to_char(d, 'YYYY-MM-DD')))
  INTO v_lock_items
  FROM unnest(v_sorted_dates) AS d;

  PERFORM public.acquire_room_date_locks(v_lock_items);

  -- Carrega a política de feriados; ausência de configuração mantém o padrão bloqueado.
  SELECT COALESCE(allow_holidays_global, FALSE), COALESCE(unblocked_holidays, ARRAY[]::TEXT[])
    INTO v_allow_holidays_global, v_unblocked_holidays
  FROM public.settings
  WHERE id = 'global';
  -- SELECT INTO sem linha retorna NULL; manter o padrão seguro de feriado bloqueado.
  v_allow_holidays_global := COALESCE(v_allow_holidays_global, FALSE);
  v_unblocked_holidays := COALESCE(v_unblocked_holidays, ARRAY[]::TEXT[]);

  -- 7.7 AVALIAÇÃO DE CADA OCORRÊNCIA INDIVIDUALMENTE CONFORME O DIA DA SEMANA
  FOREACH v_cur_date IN ARRAY v_sorted_dates LOOP
    v_day_of_week := EXTRACT(DOW FROM v_cur_date)::integer;
    v_has_conflict := FALSE;
    v_conflict_reason := NULL;

    -- Regra 1: Domingo fechado
    IF v_day_of_week = 0 THEN
      v_has_conflict := TRUE;
      v_conflict_reason := 'As salas não são utilizadas aos domingos.';
    END IF;

    -- Regra 2: Encerramento e horários por dia da semana
    IF NOT v_has_conflict THEN
      IF v_day_of_week = 6 THEN
        v_closing_hour := 14;
      ELSE
        v_closing_hour := 22;
      END IF;

      IF p_booking_type = 'PERIOD' THEN
        IF p_period_shift = 'MORNING' THEN
          v_start_hour := 7;
          v_end_hour := 12;
          v_duration := 5;
          v_amount_for_occ := v_room.morning_rate;
          v_period_rate_recorded := v_amount_for_occ;

        ELSIF p_period_shift = 'AFTERNOON' THEN
          v_start_hour := 12;
          IF v_day_of_week = 6 THEN
            v_end_hour := 14;
            v_duration := 2;
            -- Proporcional oficial de sábado: 2h de 6h
            v_amount_for_occ := ROUND(v_room.afternoon_rate * 2.0 / 6.0, 2);
          ELSE
            v_end_hour := 18;
            v_duration := 6;
            v_amount_for_occ := v_room.afternoon_rate;
          END IF;
          v_period_rate_recorded := v_amount_for_occ;

        ELSIF p_period_shift = 'NIGHT' THEN
          IF v_day_of_week = 6 THEN
            v_has_conflict := TRUE;
            v_conflict_reason := 'O turno da Noite não está disponível aos sábados (fechamento às 14:00).';
          ELSE
            v_start_hour := 18;
            v_end_hour := 22;
            v_duration := 4;
            v_amount_for_occ := v_room.night_rate;
            v_period_rate_recorded := v_amount_for_occ;
          END IF;

        ELSIF p_period_shift = 'FULL_DAY' THEN
          v_start_hour := 7;
          IF v_day_of_week = 6 THEN
            v_end_hour := 14;
            v_duration := 7;
            -- Proporcional oficial de sábado: 7h de 15h
            v_amount_for_occ := ROUND(v_room.period_rate * 7.0 / 15.0, 2);
          ELSE
            v_end_hour := 22;
            v_duration := 15;
            v_amount_for_occ := v_room.period_rate;
          END IF;
          v_period_rate_recorded := v_amount_for_occ;
        END IF;

      ELSE
        -- Locação por hora (HOURLY)
        v_start_hour := p_hour;
        v_duration := p_duration_hours;
        v_end_hour := v_start_hour + v_duration;
        v_amount_for_occ := v_duration * v_room.hourly_rate;
        v_period_rate_recorded := v_room.period_rate;
      END IF;

      IF v_start_hour < 7 OR v_end_hour > v_closing_hour THEN
        v_has_conflict := TRUE;
        v_conflict_reason := format('Horário %s:00-%s:00 excede o horário de funcionamento (até %s:00).', v_start_hour, v_end_hour, v_closing_hour);
      END IF;
    END IF;

    -- Regra 3: Feriados nacionais (mesma lista usada pela interface).
    -- A administração pode liberar todos os feriados ou datas específicas.
    IF NOT v_has_conflict AND NOT v_allow_holidays_global THEN
      IF (
        to_char(v_cur_date, 'MM-DD') = ANY (ARRAY[
          '01-01', '04-21', '05-01', '09-07', '10-12',
          '11-02', '11-15', '11-20', '12-25'
        ]::TEXT[])
        OR to_char(v_cur_date, 'YYYY-MM-DD') = ANY (ARRAY[
          '2026-02-16', '2026-02-17', '2026-04-03',
          '2026-04-21', '2026-06-04'
        ]::TEXT[])
      ) AND NOT (
        to_char(v_cur_date, 'MM-DD') = ANY (v_unblocked_holidays)
        OR to_char(v_cur_date, 'YYYY-MM-DD') = ANY (v_unblocked_holidays)
      ) THEN
        v_has_conflict := TRUE;
        v_conflict_reason := 'Esta data é feriado nacional e está bloqueada pela administração.';
      END IF;
    END IF;

    -- Regra 4: Bloqueios administrativos
    IF NOT v_has_conflict THEN
      IF EXISTS (
        SELECT 1 FROM public.blocked_slots
        WHERE (room_id = 'ALL' OR room_id = p_room_id)
          AND blocked_date = v_cur_date
          AND GREATEST(start_time, v_start_hour) < LEAST(end_time, v_end_hour)
      ) THEN
        v_has_conflict := TRUE;
        v_conflict_reason := 'O horário está bloqueado pela administração.';
      END IF;
    END IF;

    -- Regra 4: Conflito com reservas ativas (sobreposição real de horários)
    -- Reservas adjacentes (ex: 07h-12h e 12h-18h) são permitidas sem conflito.
    IF NOT v_has_conflict AND EXISTS (
      SELECT 1 FROM public.bookings
      WHERE room_id = p_room_id
        AND booking_date = v_cur_date
        AND payment_status <> 'CANCELLED'
        AND status <> 'cancelled'
        AND GREATEST(start_time, v_start_hour) < LEAST(end_time, v_end_hour)
    ) THEN
      v_has_conflict := TRUE;
      v_conflict_reason := 'Este horário já está reservado nesta sala.';
    END IF;

    -- Tratamento do resultado para esta data
    IF v_has_conflict THEN
      IF NOT p_skip_conflicts THEN
        -- Rollback atômico: se uma falhar, aborta a série inteira
        RAISE EXCEPTION 'Conflito detectado na data % (%:00 às %:00): %. A série inteira foi cancelada.', 
          to_char(v_cur_date, 'YYYY-MM-DD'), v_start_hour, v_end_hour, v_conflict_reason USING ERRCODE = '23P01';
      ELSE
        v_skipped_dates_json := v_skipped_dates_json || jsonb_build_object(
          'date', to_char(v_cur_date, 'YYYY-MM-DD'),
          'reason', v_conflict_reason
        );
      END IF;
    ELSE
      v_valid_count := v_valid_count + 1;
      v_valid_dates := array_append(v_valid_dates, v_cur_date);
      v_valid_amounts := array_append(v_valid_amounts, v_amount_for_occ);
      v_valid_starts := array_append(v_valid_starts, v_start_hour);
      v_valid_ends := array_append(v_valid_ends, v_end_hour);
      v_valid_durations := array_append(v_valid_durations, v_duration);
      v_valid_period_rates := array_append(v_valid_period_rates, v_period_rate_recorded);
      v_series_total_amount := v_series_total_amount + v_amount_for_occ;
    END IF;
  END LOOP;

  -- 7.8 VERIFICAÇÃO DE OCORRÊNCIAS VÁLIDAS
  IF v_valid_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma data válida disponível na série. Nenhuma reserva foi criada.' USING ERRCODE = '23P01';
  END IF;

  -- 7.9 CRIAÇÃO DA SÉRIE E INSERÇÕES ATÔMICAS
  v_series_id := extensions.gen_random_uuid();

  FOR v_idx IN 1..v_valid_count LOOP
    v_cur_date := v_valid_dates[v_idx];
    v_amount_for_occ := v_valid_amounts[v_idx];
    v_start_hour := v_valid_starts[v_idx];
    v_end_hour := v_valid_ends[v_idx];
    v_duration := v_valid_durations[v_idx];
    v_period_rate_recorded := v_valid_period_rates[v_idx];

    v_final_notes := p_notes;
    IF p_booking_type = 'PERIOD' THEN
      v_final_notes := concat_ws(' ', format('[PERIOD:%s]', p_period_shift), format('[Turno: %s]', COALESCE(p_period_name, '')), v_final_notes);
    END IF;
    v_final_notes := concat_ws(' ', format('[SERIES:%s:%s/%s:%s]', v_series_id, v_idx, v_valid_count, p_recurrence_rule), v_final_notes);

    INSERT INTO public.bookings (
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
      recurrence_id,
      recurrence_rule,
      recurrence_index,
      recurrence_total,
      notes
    ) VALUES (
      p_professional_id,
      p_client_id,
      p_room_id,
      v_cur_date,
      v_start_hour,
      v_end_hour,
      p_booking_type,
      v_duration,
      v_room.hourly_rate,
      v_period_rate_recorded,
      v_amount_for_occ,
      'PENDING',
      'confirmed',
      p_period_shift,
      p_period_name,
      v_series_id,
      p_recurrence_rule,
      v_idx,
      v_valid_count,
      NULLIF(trim(v_final_notes), '')
    ) RETURNING id INTO v_new_booking_id;

    v_created_ids := array_append(v_created_ids, v_new_booking_id);
    v_created_dates := array_append(v_created_dates, v_cur_date);
  END LOOP;

  -- 7.10 REGISTRO DE AUDITORIA
  INSERT INTO public.audit_logs (user_id, user_name, action, details, timestamp)
  VALUES (
    v_caller_id,
    COALESCE((SELECT full_name FROM public.profiles WHERE id = v_caller_id), 'Profissional'),
    'Criação de Série Recorrente',
    format('Série %s criada na %s: %s reservas confirmadas (%s). Total: R$ %s. Ignoradas: %s.',
      v_series_id, p_room_id, v_valid_count, p_recurrence_rule, v_series_total_amount, jsonb_array_length(v_skipped_dates_json)),
    now()
  );

  -- 7.11 PAYLOAD DE RESPOSTA FORMATADO PARA O FRONTEND
  v_response_payload := jsonb_build_object(
    'series_id', v_series_id,
    'requested_count', cardinality(v_sorted_dates),
    'created_count', v_valid_count,
    'skipped_count', jsonb_array_length(v_skipped_dates_json),
    'recurrence_rule', p_recurrence_rule,
    'room_id', p_room_id,
    'created_booking_ids', to_jsonb(v_created_ids),
    'created_dates', to_jsonb(v_created_dates),
    'skipped_dates', v_skipped_dates_json,
    'total_amount', v_series_total_amount
  );

  -- 7.12 GRAVAÇÃO NA TABELA DE IDEMPOTÊNCIA
  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    INSERT INTO public.booking_idempotency_keys (
      key, user_id, request_hash, status, series_id, response_payload, created_at, updated_at, expires_at
    ) VALUES (
      p_idempotency_key, v_caller_id, v_request_hash, 'COMPLETED', v_series_id, v_response_payload, now(), now(), now() + INTERVAL '24 hours'
    )
    ON CONFLICT (key) DO UPDATE SET
      status = 'COMPLETED',
      series_id = EXCLUDED.series_id,
      response_payload = EXCLUDED.response_payload,
      updated_at = now()
    WHERE public.booking_idempotency_keys.status <> 'COMPLETED';
  END IF;

  RETURN v_response_payload;
END;
$$;

ALTER FUNCTION public.create_recurring_series(TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_recurring_series(TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_recurring_series(TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT) TO authenticated, service_role;
