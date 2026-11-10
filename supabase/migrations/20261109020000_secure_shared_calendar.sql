-- Agenda compartilhada com dados mínimos e detalhes privados condicionais.
-- SECURITY DEFINER permite consultar reservas sem ampliar o SELECT direto da tabela.
CREATE OR REPLACE FUNCTION public.get_calendar_bookings()
RETURNS TABLE (
  id uuid,
  professional_id uuid,
  user_name text,
  room_id text,
  booking_date date,
  start_time integer,
  end_time integer,
  booking_type text,
  total_hours integer,
  hourly_rate numeric,
  total_amount numeric,
  payment_status text,
  status text,
  period_shift text,
  period_name text,
  client_id uuid,
  client_name text,
  notes text,
  paid_at timestamptz,
  paid_notes text,
  paid_by_admin text,
  created_at timestamptz,
  recurrence_id text,
  recurrence_rule text,
  recurrence_index integer,
  recurrence_total integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_admin boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_active_user() THEN
    RAISE EXCEPTION 'Acesso não autorizado.' USING ERRCODE = '42501';
  END IF;

  v_admin := public.is_admin();

  RETURN QUERY
  SELECT
    b.id,
    b.professional_id,
    COALESCE(p.full_name, 'Profissional')::text,
    b.room_id,
    b.booking_date,
    b.start_time,
    b.end_time,
    b.booking_type,
    b.total_hours,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.hourly_rate ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.total_amount ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.payment_status ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.status ELSE 'confirmed' END,
    b.period_shift,
    b.period_name,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.client_id ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN c.full_name ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.notes ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.paid_at ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.paid_notes ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.paid_by_admin ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.created_at ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.recurrence_id::text ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.recurrence_rule ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.recurrence_index ELSE NULL END,
    CASE WHEN v_admin OR b.professional_id = v_uid THEN b.recurrence_total ELSE NULL END
  FROM public.bookings b
  JOIN public.profiles p ON p.id = b.professional_id AND p.status = 'ACTIVE'
  LEFT JOIN public.clients c ON c.id = b.client_id
  WHERE b.payment_status <> 'CANCELLED'
    AND b.status <> 'cancelled'
  ORDER BY b.booking_date, b.start_time;
END;
$$;

ALTER FUNCTION public.get_calendar_bookings() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_calendar_bookings() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_calendar_bookings() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_calendar_bookings() TO authenticated;

-- A tabela deixa de expor reservas completas de terceiros por SELECT direto.
-- Remove também a política legada que liberava leitura irrestrita (inclusive anon).
DROP POLICY IF EXISTS "Leitura de locações para visualização de agenda" ON public.bookings;
DROP POLICY IF EXISTS bookings_select ON public.bookings;
CREATE POLICY bookings_select ON public.bookings
FOR SELECT TO authenticated
USING (auth.uid() = professional_id OR public.is_admin());
