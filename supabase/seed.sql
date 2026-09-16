-- ==============================================================================
-- LOCAPSICO - SEED INICIAL DE DADOS PARA O SUPABASE
-- ==============================================================================

-- 1. SALAS INICIAIS (Horário 07:00 às 22:00, R$ 40/h, R$ 350 período integral)
INSERT INTO public.rooms (id, name, description, hourly_rate, period_rate, opening_time, closing_time, status, notes)
VALUES 
  (
    'Sala 1', 
    'Sala 1 - Atendimento Adulto & Casal', 
    'Sala com poltronas confortáveis, isolamento acústico superior, iluminação quente dimerizável e climatização individual.', 
    40.00, 
    350.00, 
    7, 
    22, 
    'ACTIVE', 
    'Ideal para atendimento individual de adultos, casais e psicoterapia.'
  ),
  (
    'Sala 2', 
    'Sala 2 - Infantil & Multidisciplinar', 
    'Espaço versátil com mesa de atividades lúdicas, brinquedos terapêuticos, tatame higienizável e armário com materiais.', 
    40.00, 
    350.00, 
    7, 
    22, 
    'ACTIVE', 
    'Adequada para psicologia infantil, fonoaudiologia, nutrição e terapias integrativas.'
  )
ON CONFLICT (id) DO UPDATE 
SET 
  hourly_rate = EXCLUDED.hourly_rate,
  period_rate = EXCLUDED.period_rate,
  opening_time = EXCLUDED.opening_time,
  closing_time = EXCLUDED.closing_time,
  status = EXCLUDED.status;

-- 2. CONFIGURAÇÕES GLOBAIS DA CLÍNICA
INSERT INTO public.settings (
  id, 
  establishment_name, 
  contact_email, 
  contact_phone, 
  open_hour, 
  close_hour, 
  cancellation_limit_hours, 
  allow_holidays_global, 
  unblocked_holidays
)
VALUES (
  'global', 
  'Espaço Terapêutico & Clínico LocaPsico', 
  'contato@locapsico.com.br', 
  '(11) 98765-4321', 
  7, 
  22, 
  24, 
  false, 
  ARRAY['2026-11-02', '2026-11-15']
)
ON CONFLICT (id) DO UPDATE 
SET 
  open_hour = EXCLUDED.open_hour,
  close_hour = EXCLUDED.close_hour,
  cancellation_limit_hours = EXCLUDED.cancellation_limit_hours;

-- Nota: Usuários, clientes e reservas reais são criados diretamente na plataforma
-- através do fluxo de cadastro e login com autenticação oficial do Supabase Auth.
