#!/usr/bin/env bash
# scripts/test_concurrency_race.sh - Teste Automatizado de Concorrência em Staging
# Executa duas requisições simultâneas disputando o mesmo horário/sala no PostgreSQL real.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/staging_guard.sh"

# 1. Validação Prévia de Variáveis de Ambiente
STAGING_SUPABASE_URL="${STAGING_SUPABASE_URL:-}"
STAGING_PROJECT_REF="${STAGING_PROJECT_REF:-}"
STAGING_ANON_KEY="${STAGING_ANON_KEY:-}"
TOKEN_PROF1="${TOKEN_PROF1:-}"
TOKEN_PROF2="${TOKEN_PROF2:-}"
PROF1_ID="${PROF1_ID:-}"
PROF2_ID="${PROF2_ID:-}"

if [[ -z "$STAGING_SUPABASE_URL" || -z "$STAGING_PROJECT_REF" || -z "$STAGING_ANON_KEY" ]]; then
  echo "ERRO DE CONFIGURAÇÃO: Defina STAGING_SUPABASE_URL, STAGING_PROJECT_REF e STAGING_ANON_KEY." >&2
  exit 1
fi

if [[ -z "$TOKEN_PROF1" || -z "$TOKEN_PROF2" || -z "$PROF1_ID" || -z "$PROF2_ID" ]]; then
  echo "ERRO DE CONFIGURAÇÃO: Defina TOKEN_PROF1, TOKEN_PROF2, PROF1_ID e PROF2_ID para o teste de concorrência." >&2
  exit 1
fi

# 2. Barreira de Segurança Obrigatória (Anti-Produção)
validate_staging_environment "$STAGING_SUPABASE_URL" "$STAGING_PROJECT_REF" "$STAGING_ANON_KEY"

# 3. Definição do Lote Exclusivo
BATCH_ID="race_$(date +%s)_$RANDOM"
SLOT_DATE="2026-11-10"

echo "=== TESTE DE CONCORRÊNCIA EM STAGING ==="
echo "Destino: $STAGING_SUPABASE_URL (Projeto: $STAGING_PROJECT_REF)"
echo "Lote de Teste: $BATCH_ID"
echo "Disputa: Sala 1 | Data: $SLOT_DATE | Horário: 14:00 às 16:00 (2h)"

PAYLOAD_1=$(cat <<EOF
{
  "p_room_id": "Sala 1",
  "p_professional_id": "${PROF1_ID}",
  "p_client_id": null,
  "p_booking_type": "HOURLY",
  "p_hour": 14,
  "p_duration_hours": 2,
  "p_recurrence_rule": "WEEKLY",
  "p_dates": ["${SLOT_DATE}"],
  "p_skip_conflicts": false,
  "p_notes": "Corrida Prof 1 [BATCH:${BATCH_ID}]",
  "p_idempotency_key": "rec-${BATCH_ID}-prof1"
}
EOF
)

PAYLOAD_2=$(cat <<EOF
{
  "p_room_id": "Sala 1",
  "p_professional_id": "${PROF2_ID}",
  "p_client_id": null,
  "p_booking_type": "HOURLY",
  "p_hour": 14,
  "p_duration_hours": 2,
  "p_recurrence_rule": "WEEKLY",
  "p_dates": ["${SLOT_DATE}"],
  "p_skip_conflicts": false,
  "p_notes": "Corrida Prof 2 [BATCH:${BATCH_ID}]",
  "p_idempotency_key": "rec-${BATCH_ID}-prof2"
}
EOF
)

RESP_A_FILE=$(mktemp)
RESP_B_FILE=$(mktemp)
trap 'rm -f "$RESP_A_FILE" "$RESP_B_FILE"' EXIT

echo "Disparando requisições paralelas simultâneas..."
curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "${STAGING_SUPABASE_URL}/rest/v1/rpc/create_recurring_series" \
  -H "apikey: ${STAGING_ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_PROF1}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_1" > "$RESP_A_FILE" &
PID1=$!

curl -s -w "\nHTTP_STATUS:%{http_code}\n" -X POST "${STAGING_SUPABASE_URL}/rest/v1/rpc/create_recurring_series" \
  -H "apikey: ${STAGING_ANON_KEY}" \
  -H "Authorization: Bearer ${TOKEN_PROF2}" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD_2" > "$RESP_B_FILE" &
PID2=$!

wait $PID1
wait $PID2

STATUS_A=$(grep "HTTP_STATUS:" "$RESP_A_FILE" | cut -d':' -f2)
STATUS_B=$(grep "HTTP_STATUS:" "$RESP_B_FILE" | cut -d':' -f2)

echo "Resultado Profissional 1: HTTP $STATUS_A"
echo "Resultado Profissional 2: HTTP $STATUS_B"

# Verificação de Exclusão Mútua
if { [[ "$STATUS_A" == "200" && "$STATUS_B" != "200" ]] || [[ "$STATUS_A" != "200" && "$STATUS_B" == "200" ]]; }; then
  echo "✓ SUCESSO: Exatamente uma requisição foi aceita e a outra foi rejeitada por conflito transacional."
  exit 0
else
  echo "✗ FALHA DE CONCORRÊNCIA: Comportamento inesperado (Status A: $STATUS_A | Status B: $STATUS_B)." >&2
  exit 1
fi
