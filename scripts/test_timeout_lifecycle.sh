#!/usr/bin/env bash
# scripts/test_timeout_lifecycle.sh - Teste do Ciclo de Vida da Idempotência em Staging

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/staging_guard.sh"

STAGING_SUPABASE_URL="${STAGING_SUPABASE_URL:-}"
STAGING_PROJECT_REF="${STAGING_PROJECT_REF:-}"
STAGING_ANON_KEY="${STAGING_ANON_KEY:-}"
TOKEN_PROF1="${TOKEN_PROF1:-}"
PROF1_ID="${PROF1_ID:-}"

if [[ -z "$STAGING_SUPABASE_URL" || -z "$STAGING_PROJECT_REF" || -z "$STAGING_ANON_KEY" ]]; then
  echo "ERRO DE CONFIGURAÇÃO: Defina STAGING_SUPABASE_URL, STAGING_PROJECT_REF e STAGING_ANON_KEY." >&2
  exit 1
fi

if [[ -z "$TOKEN_PROF1" || -z "$PROF1_ID" ]]; then
  echo "ERRO DE CONFIGURAÇÃO: Defina TOKEN_PROF1 e PROF1_ID para o teste de idempotência." >&2
  exit 1
fi

# Barreira de Segurança Obrigatória
validate_staging_environment "$STAGING_SUPABASE_URL" "$STAGING_PROJECT_REF" "$STAGING_ANON_KEY"

BATCH_ID="idem_$(date +%s)_$RANDOM"
CHAVE_TESTE="rec-${BATCH_ID}-001"

echo "=== TESTE DO CICLO DE VIDA DA IDEMPOTÊNCIA EM STAGING ==="
echo "Lote: $BATCH_ID | Chave: $CHAVE_TESTE"

# 1. Chamada Inicial
PAYLOAD_ORIGINAL=$(cat <<EOF
{
  "p_room_id": "Sala 1",
  "p_professional_id": "${PROF1_ID}",
  "p_client_id": null,
  "p_booking_type": "HOURLY",
  "p_hour": 8,
  "p_duration_hours": 1,
  "p_recurrence_rule": "WEEKLY",
  "p_dates": ["2026-11-04"],
  "p_skip_conflicts": false,
  "p_notes": "Teste Idempotencia [BATCH:${BATCH_ID}]",
  "p_idempotency_key": "${CHAVE_TESTE}"
}
EOF
)

echo "Passo 1: Disparando requisição inicial..."
RESP_1=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "${STAGING_SUPABASE_URL}/rest/v1/rpc/create_recurring_series" \
  -H "apikey: ${STAGING_ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_PROF1}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_ORIGINAL")

STATUS_1=$(echo "$RESP_1" | grep "HTTP_STATUS:" | cut -d':' -f2)
BODY_1=$(echo "$RESP_1" | sed '/HTTP_STATUS:/d')

if [[ "$STATUS_1" != "200" ]]; then
  echo "✗ FALHA Passo 1: Resposta inicial não foi 200 (Status: $STATUS_1, Body: $BODY_1)" >&2
  exit 1
fi

SERIES_ID_1=$(echo "$BODY_1" | grep -o '"series_id":"[^"]*' | cut -d'"' -f4 || true)
echo "✓ Passo 1 Concluído: Série criada com ID $SERIES_ID_1"

# 2. Reenvio da Mesma Chave (Simulando Resposta Perdida / Timeout)
echo "Passo 2: Reenviando requisição com a mesma chave (retry)..."
RESP_2=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "${STAGING_SUPABASE_URL}/rest/v1/rpc/create_recurring_series" \
  -H "apikey: ${STAGING_ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_PROF1}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_ORIGINAL")

STATUS_2=$(echo "$RESP_2" | grep "HTTP_STATUS:" | cut -d':' -f2)
BODY_2=$(echo "$RESP_2" | sed '/HTTP_STATUS:/d')
SERIES_ID_2=$(echo "$BODY_2" | grep -o '"series_id":"[^"]*' | cut -d'"' -f4 || true)

if [[ "$STATUS_2" == "200" && "$SERIES_ID_1" == "$SERIES_ID_2" ]]; then
  echo "✓ SUCESSO Passo 2: Retry retornou o mesmo series_id ($SERIES_ID_2) de forma perfeitamente idempotente."
else
  echo "✗ FALHA Passo 2: Retry divergente (Status: $STATUS_2, Series ID: $SERIES_ID_2)" >&2
  exit 1
fi

# 3. Tentativa com Mesma Chave mas Parâmetros Divergentes
echo "Passo 3: Tentando reutilizar mesma chave com parâmetros divergentes (alterando horário para 9h)..."
PAYLOAD_DIVERGENTE=$(cat <<EOF
{
  "p_room_id": "Sala 1",
  "p_professional_id": "${PROF1_ID}",
  "p_client_id": null,
  "p_booking_type": "HOURLY",
  "p_hour": 9,
  "p_duration_hours": 1,
  "p_recurrence_rule": "WEEKLY",
  "p_dates": ["2026-11-04"],
  "p_skip_conflicts": false,
  "p_notes": "Teste Idempotencia Divergente [BATCH:${BATCH_ID}]",
  "p_idempotency_key": "${CHAVE_TESTE}"
}
EOF
)

RESP_3=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST "${STAGING_SUPABASE_URL}/rest/v1/rpc/create_recurring_series" \
  -H "apikey: ${STAGING_ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_PROF1}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_DIVERGENTE")

STATUS_3=$(echo "$RESP_3" | grep "HTTP_STATUS:" | cut -d':' -f2)
BODY_3=$(echo "$RESP_3" | sed '/HTTP_STATUS:/d')

if echo "$BODY_3" | grep -q "Chave de idempotência reutilizada com parâmetros divergentes"; then
  echo "✓ SUCESSO Passo 3: Reutilização com parâmetros divergentes foi devidamente rejeitada pelo banco."
else
  echo "✗ FALHA Passo 3: O banco não rejeitou parâmetros divergentes (Status: $STATUS_3, Body: $BODY_3)" >&2
  exit 1
fi

echo "=== TODOS OS PASSOS DO CICLO DE IDEMPOTÊNCIA FORAM APROVADOS ==="
exit 0
