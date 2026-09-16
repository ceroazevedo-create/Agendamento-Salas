-- ==============================================================================
-- LOCAPSICO - SCHEMA COMPLETO E DEFINITIVO DO BANCO DE DADOS SUPABASE (POSTGRESQL)
-- ==============================================================================

-- 1. EXTENSÕES
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. TABELA: profiles (Usuários do sistema vinculados ao auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  cpf TEXT,
  role TEXT NOT NULL CHECK (role IN ('professional', 'admin')) DEFAULT 'professional',
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. TABELA: professionals (Cadastro complementar dos profissionais clínicos)
CREATE TABLE IF NOT EXISTS public.professionals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  cpf TEXT,
  professional_type TEXT NOT NULL DEFAULT 'Psicólogo(a)',
  registration_number TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. TABELA: clients (Pacientes / Clientes dos profissionais - Regra estrita de privacidade)
CREATE TABLE IF NOT EXISTS public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  cpf TEXT,
  birth_date DATE,
  phone TEXT,
  whatsapp TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')) DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. TABELA: rooms (Salas de atendimento)
CREATE TABLE IF NOT EXISTS public.rooms (
  id TEXT PRIMARY KEY, -- 'Sala 1', 'Sala 2'
  name TEXT NOT NULL,
  description TEXT,
  hourly_rate NUMERIC(10,2) NOT NULL DEFAULT 40.00,
  period_rate NUMERIC(10,2) NOT NULL DEFAULT 350.00,
  opening_time INTEGER NOT NULL DEFAULT 7,
  closing_time INTEGER NOT NULL DEFAULT 22,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'MAINTENANCE')) DEFAULT 'ACTIVE',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. TABELA: bookings (Locações das salas com congelamento de valor)
CREATE TABLE IF NOT EXISTS public.bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  room_id TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE RESTRICT,
  booking_date DATE NOT NULL,
  start_time INTEGER NOT NULL CHECK (start_time >= 7 AND start_time < 22),
  end_time INTEGER NOT NULL CHECK (end_time > 7 AND end_time <= 22),
  booking_type TEXT NOT NULL CHECK (booking_type IN ('HOURLY', 'PERIOD')) DEFAULT 'HOURLY',
  total_hours INTEGER NOT NULL,
  hourly_rate NUMERIC(10,2) NOT NULL, -- Valor congelado no momento da locação
  period_rate NUMERIC(10,2) NOT NULL, -- Valor congelado no momento da locação
  total_amount NUMERIC(10,2) NOT NULL, -- Valor final congelado
  payment_status TEXT NOT NULL CHECK (payment_status IN ('PENDING', 'PAID', 'CANCELLED')) DEFAULT 'PENDING',
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled', 'completed')) DEFAULT 'confirmed',
  period_shift TEXT, -- 'MORNING', 'AFTERNOON', 'NIGHT'
  period_name TEXT, -- 'Manhã', 'Tarde', 'Noite'
  notes TEXT,
  paid_at TIMESTAMPTZ,
  paid_notes TEXT,
  paid_by_admin TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_booking_hours CHECK (end_time > start_time)
);

-- 7. TABELA: payments (Histórico e registro de pagamentos)
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  professional_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL CHECK (status IN ('PAID', 'PENDING', 'CANCELLED')) DEFAULT 'PAID',
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. TABELA: blocked_slots (Bloqueios administrativos de salas)
CREATE TABLE IF NOT EXISTS public.blocked_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id TEXT NOT NULL, -- 'Sala 1', 'Sala 2' ou 'ALL'
  blocked_date DATE NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'Administração Geral',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT check_blocked_hours CHECK (end_time > start_time)
);

-- 9. TABELA: settings (Configurações globais da clínica)
CREATE TABLE IF NOT EXISTS public.settings (
  id TEXT PRIMARY KEY DEFAULT 'global',
  establishment_name TEXT NOT NULL DEFAULT 'Espaço Terapêutico & Clínico LocaPsico',
  contact_email TEXT NOT NULL DEFAULT 'contato@locapsico.com.br',
  contact_phone TEXT NOT NULL DEFAULT '(11) 98765-4321',
  open_hour INTEGER NOT NULL DEFAULT 7,
  close_hour INTEGER NOT NULL DEFAULT 22,
  cancellation_limit_hours INTEGER NOT NULL DEFAULT 24,
  allow_holidays_global BOOLEAN NOT NULL DEFAULT false,
  unblocked_holidays TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 10. TABELA: audit_logs (Auditoria de ações do sistema)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==============================================================================
-- ÍNDICES DE PERFORMANCE (Seção 47)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_bookings_date_room ON public.bookings(booking_date, room_id);
CREATE INDEX IF NOT EXISTS idx_bookings_professional ON public.bookings(professional_id);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON public.bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_clients_professional ON public.clients(professional_id);
CREATE INDEX IF NOT EXISTS idx_blocked_slots_date ON public.blocked_slots(blocked_date, room_id);
CREATE INDEX IF NOT EXISTS idx_payments_professional ON public.payments(professional_id);

-- ==============================================================================
-- FUNÇÕES AUXILIARES & SEGURANÇA
-- ==============================================================================

-- Função para verificar se o usuário atual é Administrador
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função trigger para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de updated_at
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_professionals_updated_at ON public.professionals;
CREATE TRIGGER trg_professionals_updated_at BEFORE UPDATE ON public.professionals FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_clients_updated_at ON public.clients;
CREATE TRIGGER trg_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_rooms_updated_at ON public.rooms;
CREATE TRIGGER trg_rooms_updated_at BEFORE UPDATE ON public.rooms FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_settings_updated_at ON public.settings;
CREATE TRIGGER trg_settings_updated_at BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- PREVENÇÃO ROBUSTA DE CONFLITO NO BANCO DE DADOS (TRIGGER EM POSTGRESQL)
-- ==============================================================================
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
  -- Conflito ocorre se e somente se houver sobreposição nos intervalos de horários:
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

DROP TRIGGER IF EXISTS trg_check_booking_conflict ON public.bookings;
CREATE TRIGGER trg_check_booking_conflict
BEFORE INSERT OR UPDATE OF room_id, booking_date, start_time, end_time, booking_type, payment_status, status
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.check_booking_conflict();

-- ==============================================================================
-- CRIAÇÃO AUTOMÁTICA DE PROFILE / PROFESSIONAL NO CADASTRO DO SUPABASE AUTH
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  user_full_name TEXT;
  user_cpf TEXT;
  user_phone TEXT;
  user_profession TEXT;
  user_reg TEXT;
  user_role TEXT;
BEGIN
  user_full_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'full_name',
    split_part(NEW.email, '@', 1)
  );
  user_cpf := COALESCE(NEW.raw_user_meta_data->>'cpf', '');
  user_phone := COALESCE(NEW.raw_user_meta_data->>'phone', '');
  user_profession := COALESCE(NEW.raw_user_meta_data->>'profession', 'Psicólogo(a)');
  user_reg := COALESCE(NEW.raw_user_meta_data->>'councilRegistration', NEW.raw_user_meta_data->>'registration_number', '');
  
  -- Somente o e-mail padrão do administrador ou metadata explícita admin interna recebe role admin
  IF LOWER(NEW.email) = 'admin@admin.com.br' THEN
    user_role := 'admin';
  ELSE
    user_role := 'professional';
  END IF;

  -- 1. Insere ou atualiza o perfil
  INSERT INTO public.profiles (id, full_name, email, phone, cpf, role, status)
  VALUES (NEW.id, user_full_name, NEW.email, user_phone, user_cpf, user_role, 'ACTIVE')
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone = COALESCE(EXCLUDED.phone, profiles.phone),
      cpf = COALESCE(EXCLUDED.cpf, profiles.cpf);

  -- 2. Insere ou atualiza o registro do profissional
  INSERT INTO public.professionals (user_id, full_name, email, phone, cpf, professional_type, registration_number, status)
  VALUES (NEW.id, user_full_name, NEW.email, user_phone, user_cpf, user_profession, user_reg, 'ACTIVE')
  ON CONFLICT (user_id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      phone = COALESCE(EXCLUDED.phone, professionals.phone),
      cpf = COALESCE(EXCLUDED.cpf, professionals.cpf),
      professional_type = EXCLUDED.professional_type,
      registration_number = EXCLUDED.registration_number;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) - CONTROLE E PRIVACIDADE DE ACESSO
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- POLICIES: profiles
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Usuários podem visualizar seu próprio perfil ou admin todos" ON public.profiles;
CREATE POLICY "Usuários podem visualizar seu próprio perfil ou admin todos"
ON public.profiles FOR SELECT
USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "Usuários podem atualizar seu próprio perfil ou admin todos" ON public.profiles;
CREATE POLICY "Usuários podem atualizar seu próprio perfil ou admin todos"
ON public.profiles FOR UPDATE
USING (auth.uid() = id OR public.is_admin());

-- ------------------------------------------------------------------------------
-- POLICIES: professionals
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Visualização de profissionais" ON public.professionals;
CREATE POLICY "Visualização de profissionais"
ON public.professionals FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Edição de profissionais" ON public.professionals;
CREATE POLICY "Edição de profissionais"
ON public.professionals FOR UPDATE
USING (auth.uid() = user_id OR public.is_admin());

-- ------------------------------------------------------------------------------
-- POLICIES: clients (Privacidade Absoluta - Regra Crítica da Seção 8)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Profissional acessa somente seus próprios clientes" ON public.clients;
CREATE POLICY "Profissional acessa somente seus próprios clientes"
ON public.clients FOR SELECT
USING (auth.uid() = professional_id OR public.is_admin());

DROP POLICY IF EXISTS "Profissional cria clientes para si" ON public.clients;
CREATE POLICY "Profissional cria clientes para si"
ON public.clients FOR INSERT
WITH CHECK (auth.uid() = professional_id OR public.is_admin());

DROP POLICY IF EXISTS "Profissional edita somente seus clientes" ON public.clients;
CREATE POLICY "Profissional edita somente seus clientes"
ON public.clients FOR UPDATE
USING (auth.uid() = professional_id OR public.is_admin());

DROP POLICY IF EXISTS "Profissional exclui somente seus clientes" ON public.clients;
CREATE POLICY "Profissional exclui somente seus clientes"
ON public.clients FOR DELETE
USING (auth.uid() = professional_id OR public.is_admin());

-- ------------------------------------------------------------------------------
-- POLICIES: rooms (Qualquer usuário logado consulta; apenas admin altera)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Qualquer usuário logado pode visualizar salas" ON public.rooms;
CREATE POLICY "Qualquer usuário logado pode visualizar salas"
ON public.rooms FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Apenas admin pode gerenciar salas" ON public.rooms;
CREATE POLICY "Apenas admin pode gerenciar salas"
ON public.rooms FOR ALL
USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- POLICIES: bookings (Locações)
-- ------------------------------------------------------------------------------
-- Profissional visualiza suas próprias locações completas, ou locações de terceiros para verificar ocupação da agenda
DROP POLICY IF EXISTS "Visualização de locações na agenda" ON public.bookings;
CREATE POLICY "Visualização de locações na agenda"
ON public.bookings FOR SELECT
TO authenticated
USING (
  auth.uid() = professional_id 
  OR public.is_admin()
  OR true -- Permite carregar a ocupação da grade no calendário compartilhado
);

DROP POLICY IF EXISTS "Profissional cria locação para si" ON public.bookings;
CREATE POLICY "Profissional cria locação para si"
ON public.bookings FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = professional_id OR public.is_admin());

DROP POLICY IF EXISTS "Profissional atualiza suas locações (ex: cancelamento)" ON public.bookings;
CREATE POLICY "Profissional atualiza suas locações (ex: cancelamento)"
ON public.bookings FOR UPDATE
TO authenticated
USING (auth.uid() = professional_id OR public.is_admin());

-- ------------------------------------------------------------------------------
-- POLICIES: payments
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Profissional vê seus pagamentos ou admin todos" ON public.payments;
CREATE POLICY "Profissional vê seus pagamentos ou admin todos"
ON public.payments FOR SELECT
TO authenticated
USING (auth.uid() = professional_id OR public.is_admin());

DROP POLICY IF EXISTS "Admin gerencia pagamentos" ON public.payments;
CREATE POLICY "Admin gerencia pagamentos"
ON public.payments FOR ALL
USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- POLICIES: blocked_slots
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Todos podem visualizar horários bloqueados" ON public.blocked_slots;
CREATE POLICY "Todos podem visualizar horários bloqueados"
ON public.blocked_slots FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Apenas admin gerencia bloqueios" ON public.blocked_slots;
CREATE POLICY "Apenas admin gerencia bloqueios"
ON public.blocked_slots FOR ALL
USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- POLICIES: settings
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Todos autenticados visualizam configurações" ON public.settings;
CREATE POLICY "Todos autenticados visualizam configurações"
ON public.settings FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "Apenas admin edita configurações" ON public.settings;
CREATE POLICY "Apenas admin edita configurações"
ON public.settings FOR ALL
USING (public.is_admin());

-- ------------------------------------------------------------------------------
-- POLICIES: audit_logs
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Inserção de auditoria" ON public.audit_logs;
CREATE POLICY "Inserção de auditoria"
ON public.audit_logs FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "Apenas admin visualiza logs de auditoria" ON public.audit_logs;
CREATE POLICY "Apenas admin visualiza logs de auditoria"
ON public.audit_logs FOR SELECT
TO authenticated
USING (public.is_admin());
