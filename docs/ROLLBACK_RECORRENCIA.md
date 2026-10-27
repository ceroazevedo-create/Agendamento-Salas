# Plano de Rollback e Contingência — Agendamentos Recorrentes LocaPsico

Este documento fornece o procedimento operacional passo a passo para reverter as alterações de agendamento recorrente com segurança, sem perda de dados existentes em produção.

---

## 1. Identificação do Ponto de Restauração

- **Data da Homologação:** 27 de Outubro de 2026
- **Branch recomendada de backup:** `backup/recorrencia-antes-da-implementacao`
- **Tag de restauração:** `locapsico-pre-recorrencia`

### Como criar a tag e a branch de backup no seu repositório Git local/GitHub:
```bash
# 1. Certifique-se de estar na branch principal (ex: main ou production)
git checkout main

# 2. Crie a tag e a branch de segurança apontando para o commit funcional anterior
git tag -a locapsico-pre-recorrencia -m "Ponto de restauração estável anterior à implementação de recorrência"
git branch backup/recorrencia-antes-da-implementacao

# 3. Envie para o GitHub para persistência remota
git push origin locapsico-pre-recorrencia
git push origin backup/recorrencia-antes-da-implementacao
```

---

## 2. Reversão do Código do Frontend (Aplicação Web)

Se ocorrer qualquer instabilidade na interface ou na comunicação com a API após a publicação:

### Passo 2.1: Retornar o código ao commit anterior
```bash
# Retorna os arquivos de código para o estado da tag funcional
git checkout locapsico-pre-recorrencia -- services/ components/ types.ts constants.ts

# Ou alternar a branch inteira:
git checkout backup/recorrencia-antes-da-implementacao
```

### Passo 2.2: Recompilar e verificar testes
```bash
npm run lint
npm test
npm run build
```

---

## 3. Reversão do Banco de Dados Supabase (PostgreSQL)

Caso a migração `20261027000000_recurring_bookings_production_ready.sql` tenha sido aplicada no banco de dados e precise ser revertida:

### Regra de Ouro da Reversão de Banco:
> **NÃO execute comandos destrutivos (`DROP TABLE public.bookings CASCADE` ou remoção de dados).**  
> As colunas `recurrence_id`, `recurrence_rule`, `recurrence_index`, `recurrence_total`, `period_shift` e `period_name` são **estritamente aditivas e compatíveis** com a versão anterior do sistema.

### Script SQL de Rollback Seguro:
Execute o script abaixo no SQL Editor do Supabase para restaurar as funções e triggers anteriores, mantendo os dados preservados:

```sql
-- ==============================================================================
-- SCRIPT DE ROLLBACK: RECORRÊNCIA DE RESERVAS LOCAPSICO
-- ==============================================================================

-- 1. Remover RPC e funções de lock consultivo
DROP FUNCTION IF EXISTS public.create_recurring_series(TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, TEXT, TEXT, DATE[], BOOLEAN, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.acquire_room_date_locks(JSONB);
DROP FUNCTION IF EXISTS public.acquire_room_date_lock(TEXT, DATE);

-- 2. Restaurar o trigger anterior de conflito de reservas (se desejado restaurar sem PERIOD parcial)
CREATE OR REPLACE FUNCTION public.check_booking_conflict()
RETURNS TRIGGER AS $$
BEGIN
  IF EXTRACT(DOW FROM NEW.booking_date) = 0 THEN
    RAISE EXCEPTION 'As salas não são utilizadas aos domingos.';
  END IF;

  IF NEW.payment_status = 'CANCELLED' OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.blocked_slots
    WHERE (room_id = 'ALL' OR room_id = NEW.room_id)
      AND blocked_date = NEW.booking_date
      AND GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time)
  ) THEN
    RAISE EXCEPTION 'O horário selecionado está bloqueado pela administração.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.bookings
    WHERE room_id = NEW.room_id
      AND booking_date = NEW.booking_date
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND payment_status <> 'CANCELLED'
      AND status <> 'cancelled'
      AND GREATEST(start_time, NEW.start_time) < LEAST(end_time, NEW.end_time)
  ) THEN
    RAISE EXCEPTION 'Este horário já está reservado nesta sala.';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. A tabela public.booking_idempotency_keys e as colunas em public.bookings e public.rooms
-- NÃO precisam ser removidas, pois não interferem no funcionamento do código anterior.
```

---

## 4. Verificação Pós-Rollback

Após executar a reversão:
1. Abra o LocaPsico no navegador.
2. Agende uma reserva avulsa tradicional na Sala 1 e Sala 2.
3. Cancele um agendamento de teste para confirmar que o fluxo padrão está 100% operacional.
4. Execute `npm test` no terminal para garantir conformidade de todos os 146 testes automatizados.
