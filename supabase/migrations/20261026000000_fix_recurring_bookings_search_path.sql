-- ==============================================================================
-- LOCAPSICO - COMPLEMENTO DE RECORRÊNCIA: SEARCH_PATH E SEGURANÇA SUPABASE
-- Arquivo: supabase/migrations/20261026000000_fix_recurring_bookings_search_path.sql
-- ==============================================================================
-- Garante visibilidade das extensões (pgcrypto, uuid-ossp) no schema extensions
-- do Supabase e previne falhas de 'function digest() does not exist'.
-- ==============================================================================

-- 1. EXTENSÕES NO SCHEMA PADRÃO SUPABASE
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- 2. ATUALIZAÇÃO DO SEARCH_PATH DAS FUNÇÕES DE LOCK CONSULTIVO
ALTER FUNCTION public.acquire_room_date_locks(JSONB) 
SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.acquire_room_date_lock(TEXT, DATE) 
SET search_path = public, extensions, pg_temp;

-- 3. ATUALIZAÇÃO DO SEARCH_PATH DOS TRIGGERS DE CONFLITO
ALTER FUNCTION public.check_blocked_slot_conflict() 
SET search_path = public, extensions, pg_temp;

ALTER FUNCTION public.check_booking_conflict() 
SET search_path = public, extensions, pg_temp;

-- 4. ATUALIZAÇÃO DO SEARCH_PATH DA RPC TRANSACIONAL DE RECORRÊNCIA
ALTER FUNCTION public.create_recurring_series(
  TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT
) 
SET search_path = public, extensions, pg_temp;

-- 5. CONCESSÃO DE PERMISSÕES EXPLÍCITAS
GRANT EXECUTE ON FUNCTION public.acquire_room_date_locks(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_room_date_lock(TEXT, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_recurring_series(
  TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT
) TO authenticated, service_role;
