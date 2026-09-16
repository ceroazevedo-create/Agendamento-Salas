-- ==============================================================================
-- MIGRAÇÃO: Suporte a Turnos/Períodos (Manhã, Tarde, Noite) e Correção de Conflito
-- Arquivo: supabase/migrations/20260915000000_fix_period_bookings.sql
-- ==============================================================================

-- 1. Adicionar colunas de suporte a turnos na tabela bookings caso não existam
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS period_shift TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS period_name TEXT;

-- 2. Atualizar a função de verificação de conflitos (check_booking_conflict)
-- Anteriormente, quando booking_type = 'PERIOD', o trigger bloqueava qualquer reserva no dia
-- mesmo que fosse em turnos diferentes (ex: Manhã 07-12 e Tarde 12-18).
-- A regra correta de conflito horário é a sobreposição estrita de intervalos:
-- GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time)
CREATE OR REPLACE FUNCTION public.check_booking_conflict()
RETURNS TRIGGER AS $$
BEGIN
  -- 1. Regra Fundamental: Domingo fechado (DOW: 0 = Domingo)
  IF EXTRACT(DOW FROM NEW.booking_date) = 0 THEN
    RAISE EXCEPTION 'As salas não são utilizadas aos domingos.';
  END IF;

  -- Se for uma reserva sendo cancelada, não precisa validar conflito
  IF NEW.payment_status = 'CANCELLED' OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- 2. Verifica bloqueios administrativos
  IF EXISTS (
    SELECT 1 FROM public.blocked_slots
    WHERE (room_id = 'ALL' OR room_id = NEW.room_id)
      AND blocked_date = NEW.booking_date
      AND GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time)
  ) THEN
    RAISE EXCEPTION 'O horário selecionado está bloqueado pela administração.';
  END IF;

  -- 3. Verifica conflito com outras reservas ativas na mesma sala e data
  -- Conflito ocorre se e somente se houver sobreposição nos horários:
  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE room_id = NEW.room_id
      AND booking_date = NEW.booking_date
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND payment_status <> 'CANCELLED'
      AND status <> 'cancelled'
      AND (GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time))
  ) THEN
    RAISE EXCEPTION 'Este horário já está reservado nesta sala.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Recriação do Trigger
DROP TRIGGER IF EXISTS trg_check_booking_conflict ON public.bookings;
CREATE TRIGGER trg_check_booking_conflict
BEFORE INSERT OR UPDATE OF room_id, booking_date, start_time, end_time, booking_type, payment_status, status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.check_booking_conflict();

-- 4. Garantir que as políticas de RLS permitam leitura das reservas ativas para renderização da agenda
DROP POLICY IF EXISTS "Leitura de locações para visualização de agenda" ON public.bookings;
CREATE POLICY "Leitura de locações para visualização de agenda"
ON public.bookings FOR SELECT
TO authenticated, anon
USING (true);

-- 5. Garantir que profissionais possam criar suas próprias reservas
DROP POLICY IF EXISTS "Profissional cria locação para si" ON public.bookings;
CREATE POLICY "Profissional cria locação para si"
ON public.bookings FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = professional_id 
  OR EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND (role = 'admin' OR role = 'ADMIN')
  )
);
