-- HOMOLOGAÇÃO: exclusão de profissional preservando histórico
-- Execute SOMENTE no projeto Supabase de HOMOLOGAÇÃO:
-- rhuwvnusbzdgoaarhbkr
--
-- O teste é transacional e termina com ROLLBACK. Nenhum registro de teste
-- deve permanecer gravado. Execute em horário sem uso da homologação.
--
-- O teste seleciona um admin ativo, um profissional ativo e uma sala ativa.
-- Ele cria uma reserva futura, uma passada e dois pagamentos, chama a RPC,
-- verifica os efeitos e desfaz tudo.

BEGIN;

DO $$
DECLARE
  v_admin_id UUID;
  v_professional_id UUID;
  v_room_id TEXT;
  v_today DATE := (now() AT TIME ZONE 'America/Sao_Paulo')::DATE;
  v_future_date DATE;
  v_history_date DATE;
  v_future_booking_id UUID := gen_random_uuid();
  v_history_booking_id UUID := gen_random_uuid();
  v_future_payment_id UUID := gen_random_uuid();
  v_history_payment_id UUID := gen_random_uuid();
  v_result JSONB;
BEGIN
  SELECT id INTO v_admin_id
  FROM public.profiles
  WHERE lower(role) = 'admin' AND upper(status) = 'ACTIVE'
  ORDER BY created_at
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Teste interrompido: não existe administrador ativo na homologação.';
  END IF;

  SELECT p.id INTO v_professional_id
  FROM public.profiles p
  JOIN public.professionals pr ON pr.user_id = p.id
  WHERE lower(p.role) = 'professional' AND upper(p.status) = 'ACTIVE'
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF v_professional_id IS NULL THEN
    RAISE EXCEPTION 'Teste interrompido: não existe profissional ativo com cadastro operacional na homologação.';
  END IF;

  SELECT id INTO v_room_id
  FROM public.rooms
  WHERE status = 'ACTIVE'
  ORDER BY id
  LIMIT 1;

  IF v_room_id IS NULL THEN
    RAISE EXCEPTION 'Teste interrompido: não existe sala ativa na homologação.';
  END IF;

  SELECT d::DATE INTO v_future_date
  FROM generate_series(v_today + 30, v_today + 365, INTERVAL '1 day') AS g(d)
  WHERE EXTRACT(DOW FROM d) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.room_id = v_room_id
        AND b.booking_date = d::DATE
        AND b.payment_status <> 'CANCELLED'
        AND b.status <> 'cancelled'
        AND GREATEST(b.start_time, 7) < LEAST(b.end_time, 8)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_slots bs
      WHERE (bs.room_id = 'ALL' OR bs.room_id = v_room_id)
        AND bs.blocked_date = d::DATE
        AND GREATEST(bs.start_time, 7) < LEAST(bs.end_time, 8)
    )
  ORDER BY d
  LIMIT 1;

  IF v_future_date IS NULL THEN
    RAISE EXCEPTION 'Teste interrompido: não foi encontrada data futura livre para a reserva de teste.';
  END IF;

  SELECT d::DATE INTO v_history_date
  FROM generate_series(v_today - 60, v_today - 1, INTERVAL '1 day') AS g(d)
  WHERE EXTRACT(DOW FROM d) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.room_id = v_room_id
        AND b.booking_date = d::DATE
        AND b.payment_status <> 'CANCELLED'
        AND b.status <> 'cancelled'
        AND GREATEST(b.start_time, 7) < LEAST(b.end_time, 8)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocked_slots bs
      WHERE (bs.room_id = 'ALL' OR bs.room_id = v_room_id)
        AND bs.blocked_date = d::DATE
        AND GREATEST(bs.start_time, 7) < LEAST(bs.end_time, 8)
    )
  ORDER BY d DESC
  LIMIT 1;

  IF v_history_date IS NULL THEN
    RAISE EXCEPTION 'Teste interrompido: não foi encontrada data passada livre para a reserva de teste.';
  END IF;

  INSERT INTO public.bookings (
    id, professional_id, room_id, booking_date, start_time, end_time,
    booking_type, total_hours, hourly_rate, period_rate, total_amount,
    payment_status, status
  ) VALUES
    (v_future_booking_id, v_professional_id, v_room_id, v_future_date, 7, 8,
     'HOURLY', 1, 40, 400, 40, 'PAID', 'confirmed'),
    (v_history_booking_id, v_professional_id, v_room_id, v_history_date, 7, 8,
     'HOURLY', 1, 40, 400, 40, 'PAID', 'completed');

  INSERT INTO public.payments (
    id, booking_id, professional_id, amount, payment_date, status, notes, created_by
  ) VALUES
    (v_future_payment_id, v_future_booking_id, v_professional_id, 40, v_today, 'PAID', 'TESTE ROLLBACK - futuro', 'HOMOLOGACAO'),
    (v_history_payment_id, v_history_booking_id, v_professional_id, 40, v_today, 'PAID', 'TESTE ROLLBACK - histórico', 'HOMOLOGACAO');

  v_result := public.admin_remove_professional(v_professional_id, v_admin_id);

  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = v_future_booking_id) THEN
    RAISE EXCEPTION 'FALHA: a reserva futura não foi excluída.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.bookings WHERE id = v_history_booking_id) THEN
    RAISE EXCEPTION 'FALHA: a reserva histórica foi excluída.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE id = v_future_payment_id AND booking_id IS NULL) THEN
    RAISE EXCEPTION 'FALHA: o pagamento da reserva futura não foi preservado com booking_id nulo.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE id = v_history_payment_id AND booking_id = v_history_booking_id) THEN
    RAISE EXCEPTION 'FALHA: o pagamento histórico ou seu vínculo foi perdido.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_professional_id AND upper(status) = 'INACTIVE') THEN
    RAISE EXCEPTION 'FALHA: o perfil não foi marcado como INACTIVE.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.professionals WHERE user_id = v_professional_id) THEN
    RAISE EXCEPTION 'FALHA: o cadastro operacional do profissional continua presente.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE user_id = v_admin_id
      AND action = 'Exclusão de Profissional'
      AND "timestamp" >= transaction_timestamp()
      AND details LIKE 'Profissional % removido do cadastro.%'
  ) THEN
    RAISE EXCEPTION 'FALHA: não foi gravado o log de auditoria da exclusão.';
  END IF;

  RAISE NOTICE 'PASSOU: reserva futura excluída; reserva passada preservada; pagamentos preservados; perfil inativo; cadastro operacional removido; auditoria registrada. Datas usadas: futura %, histórica %. Resultado RPC: %',
    v_future_date, v_history_date, v_result;
END;
$$;

-- O ROLLBACK é obrigatório: desfaz inclusive o perfil inativado, as exclusões
-- e o log criados durante este teste.
ROLLBACK;
