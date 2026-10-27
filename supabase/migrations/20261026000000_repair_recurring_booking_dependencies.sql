-- LocaPsico: repair missing recurrence dependencies in an already-initialized database.
-- Safe to apply only after reviewing the target environment. Does not alter production data.
-- Restores helper functions and triggers required by create_recurring_series and concurrent bookings.
BEGIN;

CREATE OR REPLACE FUNCTION public.acquire_room_date_locks(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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

-- Compatibilidade com a versão da RPC já instalada em alguns ambientes,
-- que chama locapsico_lock_room_dates(JSONB) pelo nome legado.
CREATE OR REPLACE FUNCTION public.locapsico_lock_room_dates(p_items JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $
BEGIN
  PERFORM public.acquire_room_date_locks(p_items);
END;
$;

-- Função auxiliar individual para retrocompatibilidade
CREATE OR REPLACE FUNCTION public.acquire_room_date_lock(p_room_id TEXT, p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.acquire_room_date_locks(
    jsonb_build_array(jsonb_build_object('room_id', p_room_id, 'date', to_char(p_date, 'YYYY-MM-DD')))
  );
END;
$$;

-- 5. TRIGGER DE CONFLITO PARA BLOQUEIOS ADMINISTRATIVOS (public.blocked_slots)
-- Garante que inserções e alterações de bloqueios disputem os mesmos locks e respeitem reservas ativas

CREATE OR REPLACE FUNCTION public.check_blocked_slot_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Detecção de UPDATE neutro (nenhuma coluna de sala, data ou horário modificada)
  IF TG_OP = 'UPDATE' THEN
    IF OLD.room_id = NEW.room_id 
       AND OLD.blocked_date = NEW.blocked_date 
       AND OLD.start_time = NEW.start_time 
       AND OLD.end_time = NEW.end_time THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 2. Validação básica de dia e limites operacionais de horário
  IF EXTRACT(DOW FROM NEW.blocked_date) = 0 THEN
    RAISE EXCEPTION 'As salas não funcionam aos domingos.' USING ERRCODE = '22000';
  END IF;

  IF NEW.start_time < 7 THEN
    RAISE EXCEPTION 'Horário inicial não pode ser anterior à abertura das salas (07:00).' USING ERRCODE = '22000';
  END IF;

  IF NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'Horário final do bloqueio deve ser estritamente maior que o horário inicial.' USING ERRCODE = '22000';
  END IF;

  IF EXTRACT(DOW FROM NEW.blocked_date) = 6 AND NEW.end_time > 14 THEN
    RAISE EXCEPTION 'Aos sábados as salas encerram as atividades às 14:00.' USING ERRCODE = '22000';
  ELSIF NEW.end_time > 22 THEN
    RAISE EXCEPTION 'As salas encerram as atividades às 22:00.' USING ERRCODE = '22000';
  END IF;

  -- 3. Aquisição determinística de locks globais ordenados (prevenção total de deadlocks)
  IF TG_OP = 'UPDATE' AND (OLD.room_id <> NEW.room_id OR OLD.blocked_date <> NEW.blocked_date) THEN
    PERFORM public.acquire_room_date_locks(jsonb_build_array(
      jsonb_build_object('room_id', OLD.room_id, 'date', to_char(OLD.blocked_date, 'YYYY-MM-DD')),
      jsonb_build_object('room_id', NEW.room_id, 'date', to_char(NEW.blocked_date, 'YYYY-MM-DD'))
    ));
  ELSE
    PERFORM public.acquire_room_date_locks(jsonb_build_array(
      jsonb_build_object('room_id', NEW.room_id, 'date', to_char(NEW.blocked_date, 'YYYY-MM-DD'))
    ));
  END IF;

  -- 4. Regra Comercial: Rejeita bloqueio se já houver agendamentos ativos confirmados no período
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE (NEW.room_id = 'ALL' OR room_id = NEW.room_id)
      AND booking_date = NEW.blocked_date
      AND payment_status IS DISTINCT FROM 'CANCELLED'
      AND status IS DISTINCT FROM 'cancelled'
      AND GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time)
  ) THEN
    RAISE EXCEPTION 'Não é possível bloquear o horário: existem agendamentos ativos confirmados neste período.' USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_blocked_slot_conflict ON public.blocked_slots;
CREATE TRIGGER trg_check_blocked_slot_conflict
BEFORE INSERT OR UPDATE OF room_id, blocked_date, start_time, end_time
ON public.blocked_slots
FOR EACH ROW
EXECUTE FUNCTION public.check_blocked_slot_conflict();

-- 6. TRIGGER DE CONFLITO PARA RESERVAS (public.bookings)
-- Utiliza exatamente a mesma estratégia de lock consultivo

CREATE OR REPLACE FUNCTION public.check_booking_conflict()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. Reservas canceladas não disputam disponibilidade nem geram conflito
  IF NEW.payment_status = 'CANCELLED' OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- 2. Detecta se é um UPDATE neutro (nenhum campo de agenda ou status alterado)
  IF TG_OP = 'UPDATE' THEN
    IF OLD.room_id = NEW.room_id 
       AND OLD.booking_date = NEW.booking_date 
       AND OLD.start_time = NEW.start_time 
       AND OLD.end_time = NEW.end_time 
       AND OLD.booking_type = NEW.booking_type 
       AND OLD.payment_status = NEW.payment_status 
       AND OLD.status = NEW.status THEN
      RETURN NEW;
    END IF;
  END IF;

  -- 3. Regra Fundamental: Domingo fechado (DOW: 0 = Domingo)
  IF EXTRACT(DOW FROM NEW.booking_date) = 0 THEN
    RAISE EXCEPTION 'As salas não são utilizadas aos domingos.' USING ERRCODE = '22000';
  END IF;

  -- 4. Validação operacional de horários de funcionamento (Abertura 07:00, Sábados até 14:00, Seg-Sex até 22:00)
  IF NEW.start_time < 7 THEN
    RAISE EXCEPTION 'Horário inicial não pode ser anterior à abertura das salas (07:00).' USING ERRCODE = '22000';
  END IF;

  IF NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'Horário final da reserva deve ser estritamente maior que o horário inicial.' USING ERRCODE = '22000';
  END IF;

  IF EXTRACT(DOW FROM NEW.booking_date) = 6 AND NEW.end_time > 14 THEN
    RAISE EXCEPTION 'Aos sábados as salas encerram as atividades às 14:00.' USING ERRCODE = '22000';
  ELSIF NEW.end_time > 22 THEN
    RAISE EXCEPTION 'As salas encerram as atividades às 22:00.' USING ERRCODE = '22000';
  END IF;

  -- 5. Aquisição determinística de locks consultivos na mesma ordem global canônica
  IF TG_OP = 'UPDATE' AND (OLD.payment_status IS DISTINCT FROM 'CANCELLED' AND OLD.status IS DISTINCT FROM 'cancelled') 
     AND (OLD.room_id <> NEW.room_id OR OLD.booking_date <> NEW.booking_date) THEN
    PERFORM public.acquire_room_date_locks(jsonb_build_array(
      jsonb_build_object('room_id', OLD.room_id, 'date', to_char(OLD.booking_date, 'YYYY-MM-DD')),
      jsonb_build_object('room_id', NEW.room_id, 'date', to_char(NEW.booking_date, 'YYYY-MM-DD'))
    ));
  ELSE
    PERFORM public.acquire_room_date_locks(jsonb_build_array(
      jsonb_build_object('room_id', NEW.room_id, 'date', to_char(NEW.booking_date, 'YYYY-MM-DD'))
    ));
  END IF;

  -- 6. Verifica bloqueios administrativos
  IF EXISTS (
    SELECT 1 FROM public.blocked_slots
    WHERE (room_id = 'ALL' OR room_id = NEW.room_id)
      AND blocked_date = NEW.booking_date
      AND GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time)
  ) THEN
    RAISE EXCEPTION 'O horário selecionado está bloqueado pela administração.' USING ERRCODE = '23P01';
  END IF;

  -- 7. Verifica conflito com outras reservas ativas na mesma sala e data
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE room_id = NEW.room_id
      AND booking_date = NEW.booking_date
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND payment_status IS DISTINCT FROM 'CANCELLED'
      AND status IS DISTINCT FROM 'cancelled'
      AND (GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time))
  ) THEN
    RAISE EXCEPTION 'Este horário já está reservado nesta sala.' USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_booking_conflict ON public.bookings;
CREATE TRIGGER trg_check_booking_conflict
BEFORE INSERT OR UPDATE OF room_id, booking_date, start_time, end_time, booking_type, payment_status, status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.check_booking_conflict();

-- 7. RPC TRANSACIONAL: public.create_recurring_series
-- Implementa criação segura, cálculos tarifários oficiais, validação de regras,

-- Match the helper function grants from the original migration.
ALTER FUNCTION public.acquire_room_date_locks(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acquire_room_date_locks(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_room_date_locks(JSONB) TO authenticated, service_role;

ALTER FUNCTION public.locapsico_lock_room_dates(JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.locapsico_lock_room_dates(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.locapsico_lock_room_dates(JSONB) TO authenticated, service_role;

ALTER FUNCTION public.acquire_room_date_lock(TEXT, DATE) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.acquire_room_date_lock(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acquire_room_date_lock(TEXT, DATE) TO authenticated, service_role;

-- pgcrypto is commonly installed in the Supabase "extensions" schema.
-- The RPC uses digest(...), so this path must include extensions.
ALTER FUNCTION public.create_recurring_series(TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT)
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp;

-- Ensure the existing booking trigger executes with its intended privileges and safe path.
ALTER FUNCTION public.check_booking_conflict()
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp;

COMMIT;
