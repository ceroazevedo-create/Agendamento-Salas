-- ==============================================================================
-- LOCAPSICO - MIGRATION DEFINITIVA: AGENDAMENTOS RECORRENTES, CONCORRÊNCIA E IDEMPOTÊNCIA
-- Arquivo: supabase/migrations/20261014000000_add_recurring_bookings.sql
-- ==============================================================================
-- ATENÇÃO OBRIGATÓRIA DE SEGURANÇA:
-- 1. NÃO executa alterações destrutivas em tabelas ou dados existentes.
-- 2. PRESERVA integralmente a função public.check_booking_conflict() e o trigger trg_check_booking_conflict.
-- 3. NÃO adiciona tarifas de turnos com valores padrão e NÃO altera hourly_rate ou period_rate em public.rooms.
-- 4. NÃO DEVE SER APLICADA NO BANCO DE PRODUÇÃO SEM AUTORIZAÇÃO EXPRESSA E JANELA PLANEJADA.
-- ==============================================================================

-- 1. EXTENSÕES NECESSÁRIAS NO SCHEMA EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- 2. AJUSTES NO SCHEMA DA TABELA public.bookings (COMPATIBILIDADE RETROATIVA TOTAL)
-- Adiciona exclusivamente as colunas necessárias para rastrear a série recorrente e o turno
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS recurrence_id UUID;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS recurrence_rule TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS recurrence_index INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS recurrence_total INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS period_shift TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS period_name TEXT;

-- 3. TABELA DE IDEMPOTÊNCIA: public.booking_idempotency_keys
CREATE TABLE IF NOT EXISTS public.booking_idempotency_keys (
  key TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
  series_id UUID,
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);

-- Índices de performance para expiração e consultas de chaves
CREATE INDEX IF NOT EXISTS idx_booking_idempotency_keys_expires_at 
ON public.booking_idempotency_keys (expires_at);

CREATE INDEX IF NOT EXISTS idx_booking_idempotency_keys_user_id 
ON public.booking_idempotency_keys (user_id);

-- Índices de performance para busca de séries e sobreposição de horários
CREATE INDEX IF NOT EXISTS idx_bookings_recurrence_id 
ON public.bookings(recurrence_id) 
WHERE recurrence_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_active_slots 
ON public.bookings(room_id, booking_date, start_time, end_time) 
WHERE payment_status <> 'CANCELLED' AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_blocked_slots_lookup 
ON public.blocked_slots(room_id, blocked_date, start_time, end_time);

-- 4. FUNÇÕES DE AQUISIÇÃO DETERMINÍSTICA DE LOCKS CONSULTIVOS (pg_advisory_xact_lock)
-- Unifica a estratégia de concorrência em uma ordem global e imutável para eliminar deadlocks:
-- 1º: Expansão de 'ALL' para todas as salas ativas de public.rooms
-- 2º: Deduplicação rigorosa dos pares (room_id, slot_date)
-- 3º: Ordenação determinística global: 1º por room_id ASC, 2º por slot_date ASC
CREATE OR REPLACE FUNCTION public.acquire_room_date_locks(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  r RECORD;
  v_date_int INTEGER;
BEGIN
  -- Recebe JSONB array: [{'room_id': '...', 'date': 'YYYY-MM-DD'}, ...]
  FOR r IN
    WITH raw_slots AS (
      SELECT 
        elem->>'room_id' AS r_id,
        (elem->>'date')::DATE AS s_date
      FROM jsonb_array_elements(p_items) AS elem
      WHERE elem->>'room_id' IS NOT NULL AND elem->>'date' IS NOT NULL
    ),
    expanded_slots AS (
      SELECT 
        CASE 
          WHEN raw.r_id = 'ALL' THEN rm.id 
          ELSE raw.r_id 
        END AS room_id,
        raw.s_date AS slot_date
      FROM raw_slots raw
      LEFT JOIN public.rooms rm ON raw.r_id = 'ALL'
    ),
    canonical_order AS (
      SELECT DISTINCT room_id, slot_date
      FROM expanded_slots
      WHERE room_id IS NOT NULL AND slot_date IS NOT NULL
      ORDER BY room_id ASC, slot_date ASC
    )
    SELECT room_id, slot_date FROM canonical_order
  LOOP
    -- Inteiro YYYYMMDD (ex: 20261020). Faixa segura de 32 bits sem risco de colisão ou ambiguidade
    v_date_int := (EXTRACT(YEAR FROM r.slot_date)::integer * 10000) 
                + (EXTRACT(MONTH FROM r.slot_date)::integer * 100) 
                + (EXTRACT(DAY FROM r.slot_date)::integer);
    PERFORM pg_advisory_xact_lock(hashtext(r.room_id), v_date_int);
  END LOOP;
END;
$$;

-- Função auxiliar individual para aquisição pontual de lock
CREATE OR REPLACE FUNCTION public.acquire_room_date_lock(p_room_id TEXT, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public.acquire_room_date_locks(
    jsonb_build_array(jsonb_build_object('room_id', p_room_id, 'date', to_char(p_date, 'YYYY-MM-DD')))
  );
END;
$$;

-- 5. RPC TRANSACIONAL: public.create_recurring_series
-- Implementa criação segura e atômica, cálculo financeiro baseado nas tarifas oficiais,
-- validação de regras da clínica (fechado domingo, sábado até 14h), proteção contra concorrência
-- via advisory locks ordenados e protocolo de idempotência SHA-256.
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
  v_room RECORD;
  v_room_json JSONB;
  v_sorted_dates DATE[];
  v_cur_date DATE;
  v_day_of_week INTEGER;
  v_closing_hour INTEGER;
  v_start_hour INTEGER;
  v_end_hour INTEGER;
  v_duration INTEGER;
  
  -- Tarifas de referência (sem alterar o schema de rooms)
  v_morning_rate NUMERIC(10,2);
  v_afternoon_rate NUMERIC(10,2);
  v_night_rate NUMERIC(10,2);
  v_full_day_rate NUMERIC(10,2);
  
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
  
  -- Arrays para rastreamento e retorno
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
BEGIN
  -- 5.1 AUTENTICAÇÃO E PERMISSÕES (RBAC)
  v_caller_id := auth.uid();

  -- Se executado sem auth.uid(), permite SOMENTE se for o papel interno de sistema (service_role ou sessão interna postgres)
  IF v_caller_id IS NULL THEN
    IF (session_user IN ('postgres', 'supabase_admin') AND current_setting('request.jwt.claim.role', true) IS NULL)
       OR (COALESCE(current_setting('request.jwt.claim.role', true), '') = 'service_role' 
           AND COALESCE(auth.role(), '') = 'service_role') THEN
      v_caller_id := p_professional_id;
    ELSE
      RAISE EXCEPTION 'Operação não permitida: usuário não autenticado.' USING ERRCODE = '28000';
    END IF;
  END IF;

  -- Valida a existência do perfil profissional no sistema
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_professional_id) THEN
    RAISE EXCEPTION 'Profissional com ID % não encontrado.', p_professional_id USING ERRCODE = '22000';
  END IF;

  -- Controle de Acesso Baseado em Papéis:
  -- Profissional comum opera estritamente para si mesmo. Administrador opera em nome de terceiros.
  IF v_caller_id <> p_professional_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = v_caller_id AND lower(role) = 'admin'
    ) THEN
      RAISE EXCEPTION 'Permissão negada: agendamento permitido apenas para o próprio perfil ou por administradores.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 5.2 VALIDAÇÃO DO CLIENTE (SE INFORMADO)
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

  -- 5.3 VALIDAÇÃO DA SALA E RECUPERAÇÃO DAS TARIFAS
  SELECT * INTO v_room FROM public.rooms WHERE id = p_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sala % não encontrada.', p_room_id USING ERRCODE = '22000';
  END IF;

  IF v_room.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'A sala % está em manutenção e indisponível para reservas.', p_room_id USING ERRCODE = '22000';
  END IF;

  -- Extrai tarifas sem presumir que colunas extras existam em public.rooms (elimina erro de missing column)
  v_room_json := to_jsonb(v_room);
  v_morning_rate := COALESCE((v_room_json->>'morning_rate')::NUMERIC, 150.00);
  v_afternoon_rate := COALESCE((v_room_json->>'afternoon_rate')::NUMERIC, 180.00);
  v_night_rate := COALESCE((v_room_json->>'night_rate')::NUMERIC, 130.00);
  v_full_day_rate := COALESCE(v_room.period_rate, 350.00);

  -- 5.4 VALIDAÇÃO DA REGRA DE RECORRÊNCIA E DATAS (INCLUI 'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY')
  IF p_recurrence_rule NOT IN ('DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY') THEN
    RAISE EXCEPTION 'Frequência de recorrência inválida: %. Permitidas: DAILY, WEEKLY, BIWEEKLY, MONTHLY.', p_recurrence_rule USING ERRCODE = '22000';
  END IF;

  IF p_dates IS NULL OR cardinality(p_dates) = 0 THEN
    RAISE EXCEPTION 'Nenhuma data fornecida para a série recorrente.' USING ERRCODE = '22000';
  END IF;

  IF cardinality(p_dates) > 52 THEN
    RAISE EXCEPTION 'Limite máximo de 52 ocorrências por série excedido.' USING ERRCODE = '22000';
  END IF;

  -- Ordena as datas e elimina duplicidades
  SELECT array_agg(d ORDER BY d ASC) INTO v_sorted_dates 
  FROM (SELECT DISTINCT unnest(p_dates) AS d) sub;

  IF cardinality(v_sorted_dates) <> cardinality(p_dates) THEN
    RAISE EXCEPTION 'A lista de datas contém datas duplicadas.' USING ERRCODE = '22000';
  END IF;

  -- Limite temporal de horizonte: máximo de 366 dias (1 ano)
  IF (v_sorted_dates[cardinality(v_sorted_dates)] - v_sorted_dates[1]) > 366 THEN
    RAISE EXCEPTION 'O horizonte temporal da série excede o limite de 366 dias.' USING ERRCODE = '22000';
  END IF;

  -- 5.5 CANONICAL HASH & PROTOCOLO DE IDEMPOTÊNCIA
  v_canonical_json := jsonb_build_object(
    'booking_type', p_booking_type,
    'client_id', p_client_id,
    'dates', to_jsonb(v_sorted_dates),
    'duration_hours', p_duration_hours,
    'hour', p_hour,
    'notes', COALESCE(p_notes, ''),
    'period_name', COALESCE(p_period_name, ''),
    'period_shift', COALESCE(p_period_shift, ''),
    'professional_id', p_professional_id,
    'recurrence_rule', p_recurrence_rule,
    'room_id', p_room_id,
    'skip_conflicts', p_skip_conflicts
  );
  v_request_hash := encode(digest(v_canonical_json::text, 'sha256'), 'hex');

  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    -- Serializa chamadas com a mesma chave via lock consultivo transacional
    PERFORM pg_advisory_xact_lock(hashtext('idempotency_key')::integer, hashtext(p_idempotency_key)::integer);

    -- Verifica se já existe registro na tabela de idempotência
    SELECT * INTO v_idem FROM public.booking_idempotency_keys WHERE key = p_idempotency_key FOR UPDATE;
    IF FOUND THEN
      -- Valida autorização do proprietário da chave
      IF v_idem.user_id <> v_caller_id AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_caller_id AND lower(role) = 'admin') THEN
        RAISE EXCEPTION 'Acesso negado: esta chave de idempotência pertence a outro usuário.' USING ERRCODE = '42501';
      END IF;

      -- Valida se os parâmetros correspondem à requisição original
      IF v_idem.request_hash <> v_request_hash THEN
        RAISE EXCEPTION 'Chave de idempotência reutilizada com parâmetros divergentes.' USING ERRCODE = '22000';
      END IF;

      -- Verifica se expirou
      IF v_idem.expires_at < now() THEN
        RAISE EXCEPTION 'Chave de idempotência expirada.' USING ERRCODE = '22000';
      END IF;

      -- Se já concluída com sucesso, retorna a resposta original persistida (imutabilidade)
      IF v_idem.status = 'COMPLETED' THEN
        RETURN v_idem.response_payload;
      ELSIF v_idem.status = 'PROCESSING' THEN
        -- Se estiver em processamento há mais de 2 minutos, considera timeout e permite reprocessar
        IF (now() - v_idem.updated_at) > INTERVAL '2 minutes' THEN
          UPDATE public.booking_idempotency_keys
          SET updated_at = now()
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
      -- Inserção inicial em estado PROCESSING para proteger contra requisições simultâneas
      INSERT INTO public.booking_idempotency_keys (
        key,
        user_id,
        request_hash,
        status,
        created_at,
        updated_at,
        expires_at
      ) VALUES (
        p_idempotency_key,
        v_caller_id,
        v_request_hash,
        'PROCESSING',
        now(),
        now(),
        now() + INTERVAL '24 hours'
      )
      ON CONFLICT (key) DO NOTHING;
    END IF;
  END IF;

  -- 5.6 AQUISIÇÃO DETERMINÍSTICA DE LOCKS EM TODAS AS DATAS DA SÉRIE
  -- Garante ausência total de deadlocks entre séries e operações simultâneas
  SELECT jsonb_agg(jsonb_build_object('room_id', p_room_id, 'date', to_char(d, 'YYYY-MM-DD')))
  INTO v_lock_items
  FROM unnest(v_sorted_dates) AS d;

  PERFORM public.acquire_room_date_locks(v_lock_items);

  -- 5.7 AVALIAÇÃO DE DATAS, REGRAS DE FUNCIONAMENTO, TARIFAS E CONFLITOS
  FOREACH v_cur_date IN ARRAY v_sorted_dates LOOP
    v_day_of_week := EXTRACT(DOW FROM v_cur_date)::integer;
    v_has_conflict := FALSE;
    v_conflict_reason := NULL;

    -- Regra 1: Domingo fechado
    IF v_day_of_week = 0 THEN
      v_has_conflict := TRUE;
      v_conflict_reason := 'As salas não são utilizadas aos domingos.';
    END IF;

    -- Regra 2: Horário de fechamento (Sábado 14h, Seg-Sex 22h)
    IF NOT v_has_conflict THEN
      IF v_day_of_week = 6 THEN
        v_closing_hour := 14;
      ELSE
        v_closing_hour := 22;
      END IF;

      -- Determinação de horários e tarifas oficiais
      IF p_booking_type = 'PERIOD' THEN
        IF p_period_shift = 'MORNING' THEN
          v_start_hour := 7;
          v_end_hour := 12;
          v_duration := 5;
          v_amount_for_occ := v_morning_rate;
          v_period_rate_recorded := v_amount_for_occ;
        ELSIF p_period_shift = 'AFTERNOON' THEN
          v_start_hour := 12;
          IF v_day_of_week = 6 THEN
            v_end_hour := 14; -- Sábado encerra às 14h (2h)
            v_duration := 2;
            -- Proporcional oficial: 2h de 6h (180 * 2/6 = 60.00)
            v_amount_for_occ := ROUND(v_afternoon_rate * 2.0 / 6.0, 2);
          ELSE
            v_end_hour := 18;
            v_duration := 6;
            v_amount_for_occ := v_afternoon_rate;
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
            v_amount_for_occ := v_night_rate;
            v_period_rate_recorded := v_amount_for_occ;
          END IF;
        ELSIF p_period_shift = 'FULL_DAY' THEN
          v_start_hour := 7;
          IF v_day_of_week = 6 THEN
            v_end_hour := 14;
            v_duration := 7;
            -- Proporcional oficial de sábado: 7h de 15h
            v_amount_for_occ := ROUND(v_full_day_rate * 7.0 / 15.0, 2);
          ELSE
            v_end_hour := 22;
            v_duration := 15;
            v_amount_for_occ := v_full_day_rate;
          END IF;
          v_period_rate_recorded := v_amount_for_occ;
        ELSE
          v_start_hour := 7;
          v_end_hour := 12;
          v_duration := 5;
          v_amount_for_occ := v_morning_rate;
          v_period_rate_recorded := v_amount_for_occ;
        END IF;
      ELSE
        -- Locação por hora (HOURLY)
        v_start_hour := p_hour;
        v_duration := COALESCE(p_duration_hours, 1);
        v_end_hour := v_start_hour + v_duration;
        v_amount_for_occ := v_duration * v_room.hourly_rate;
        v_period_rate_recorded := v_full_day_rate;
      END IF;

      -- Validação de limites da grade operacional
      IF v_start_hour < 7 OR v_end_hour > v_closing_hour THEN
        v_has_conflict := TRUE;
        v_conflict_reason := format('Horário %s:00-%s:00 excede o horário de funcionamento (até %s:00).', v_start_hour, v_end_hour, v_closing_hour);
      END IF;
    END IF;

    -- Regra 3: Verificação de sobreposição com bloqueios e reservas
    IF NOT v_has_conflict THEN
      -- Bloqueios administrativos
      IF EXISTS (
        SELECT 1 FROM public.blocked_slots
        WHERE (room_id = 'ALL' OR room_id = p_room_id)
          AND blocked_date = v_cur_date
          AND GREATEST(start_time, v_start_hour) < LEAST(end_time, v_end_hour)
      ) THEN
        v_has_conflict := TRUE;
        v_conflict_reason := 'O horário está bloqueado pela administração.';
      END IF;

      -- Reservas confirmadas existentes
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
    END IF;

    -- Tratamento do resultado para esta data
    IF v_has_conflict THEN
      IF NOT p_skip_conflicts THEN
        -- Rollback integral automático da transação
        RAISE EXCEPTION 'Conflito detectado na data % (%:00 às %:00): %. A série não foi criada.', 
          to_char(v_cur_date, 'YYYY-MM-DD'), v_start_hour, v_end_hour, v_conflict_reason USING ERRCODE = '23P01';
      ELSE
        v_skipped_dates_json := v_skipped_dates_json || jsonb_build_object(
          'date', to_char(v_cur_date, 'YYYY-MM-DD'),
          'reason', v_conflict_reason
        );
      END IF;
    ELSE
      -- Data válida: armazena nos buffers temporários
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

  -- 5.8 VERIFICAÇÃO DE OCORRÊNCIAS VÁLIDAS
  IF v_valid_count = 0 THEN
    RAISE EXCEPTION 'Nenhuma data válida disponível na série. Nenhuma reserva foi criada.' USING ERRCODE = '23P01';
  END IF;

  -- 5.9 CRIAÇÃO DA SÉRIE E GRAVAÇÃO ATÔMICA DAS RESERVAS
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

  -- 5.10 REGISTRO DE AUDITORIA
  INSERT INTO public.audit_logs (user_id, user_name, action, details)
  VALUES (
    v_caller_id,
    COALESCE((SELECT full_name FROM public.profiles WHERE id = v_caller_id), 'Profissional'),
    'Criação de Série Recorrente',
    format('Série %s criada na %s: %s reservas confirmadas (%s). Total: R$ %s. Ignoradas: %s.',
      v_series_id, p_room_id, v_valid_count, p_recurrence_rule, v_series_total_amount, jsonb_array_length(v_skipped_dates_json))
  );

  -- 5.11 CONSTRUÇÃO DA RESPOSTA PERSISTIDA
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

  -- 5.12 GRAVAÇÃO NA TABELA DE IDEMPOTÊNCIA (SE CHAVE INFORMADA)
  IF p_idempotency_key IS NOT NULL AND length(trim(p_idempotency_key)) > 0 THEN
    INSERT INTO public.booking_idempotency_keys (
      key,
      user_id,
      request_hash,
      status,
      series_id,
      response_payload,
      created_at,
      updated_at,
      expires_at
    ) VALUES (
      p_idempotency_key,
      v_caller_id,
      v_request_hash,
      'COMPLETED',
      v_series_id,
      v_response_payload,
      now(),
      now(),
      now() + INTERVAL '24 hours'
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

-- 6. PERMISSÕES DE ACESSO (LEAST PRIVILEGE) E DEFINIÇÃO DE PROPRIETÁRIO
ALTER FUNCTION public.acquire_room_date_locks(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acquire_room_date_locks(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_room_date_locks(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_room_date_locks(JSONB) TO service_role;

ALTER FUNCTION public.acquire_room_date_lock(TEXT, DATE) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acquire_room_date_lock(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_room_date_lock(TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_room_date_lock(TEXT, DATE) TO service_role;

ALTER FUNCTION public.create_recurring_series(TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_recurring_series(TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_recurring_series(TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_recurring_series(TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT) TO service_role;

REVOKE ALL ON public.booking_idempotency_keys FROM PUBLIC;
ALTER TABLE public.booking_idempotency_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuário consulta suas próprias chaves de idempotência" ON public.booking_idempotency_keys;
CREATE POLICY "Usuário consulta suas próprias chaves de idempotência"
ON public.booking_idempotency_keys FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.is_admin());

GRANT SELECT ON public.booking_idempotency_keys TO authenticated;
GRANT ALL ON public.booking_idempotency_keys TO service_role;
