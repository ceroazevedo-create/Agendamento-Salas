#!/usr/bin/env bash
# scripts/staging_guard.sh - Barreira de Segurança Centralizada para Shell Scripts

set -euo pipefail

PROD_PROJECT_REF="gqpavuqopukyfeyqyrxc"

validate_staging_environment() {
  local staging_url="${1:-}"
  local expected_ref="${2:-}"
  local auth_token="${3:-}"

  # 1. Validação de presença
  if [[ -z "$staging_url" ]]; then
    echo "ERRO CRÍTICO: STAGING_SUPABASE_URL não informada." >&2
    return 1
  fi

  # 2. Bloqueio absoluto do identificador de produção
  if [[ "$staging_url" == *"$PROD_PROJECT_REF"* || "$expected_ref" == "$PROD_PROJECT_REF" ]]; then
    echo "ERRO DE SEGURANÇA: Tentativa de operação contra o ambiente de PRODUÇÃO ($PROD_PROJECT_REF) BLOQUEADA!" >&2
    return 1
  fi

  # 3. Rejeição de placeholders e hosts locais
  if [[ "$staging_url" =~ (seu-staging|exemplo|placeholder|localhost|127\.0\.0\.1|::1|YOUR_STAGING|<project-ref>) ]]; then
    echo "ERRO DE CONFIGURAÇÃO: URL contém placeholder ou host local inválido." >&2
    return 1
  fi

  # 4. Rejeição de portas, query strings e caminhos adicionais
  if [[ "$staging_url" == *"?"* || "$staging_url" == *"#"* ]]; then
    echo "ERRO DE FORMATO: URL não deve conter query strings ou fragmentos." >&2
    return 1
  fi

  if [[ ! "$staging_url" =~ ^https:// ]]; then
    echo "ERRO DE PROTOCOLO: A URL de staging deve utilizar estritamente HTTPS." >&2
    return 1
  fi

  local host_part="${staging_url#https://}"
  if [[ "$host_part" == *":"* ]]; then
    echo "ERRO DE FORMATO: Porta personalizada detectada na URL." >&2
    return 1
  fi

  if [[ "$host_part" == *"/"* && "$host_part" != */ ]]; then
    echo "ERRO DE FORMATO: Caminho adicional detectado na URL de staging." >&2
    return 1
  fi

  # 5. Formato oficial Supabase
  if [[ ! "$staging_url" =~ ^https://([a-z0-9]{15,35})\.supabase\.co/?$ ]]; then
    echo "ERRO DE FORMATO: URL não segue o padrão 'https://<project-ref>.supabase.co'." >&2
    return 1
  fi

  local extracted_ref="${BASH_REMATCH[1]}"

  # 6. Conferência do identificador autorizado
  if [[ -z "$expected_ref" ]]; then
    echo "ERRO CRÍTICO: STAGING_PROJECT_REF autorizado não foi informado." >&2
    return 1
  fi

  if [[ "$extracted_ref" != "$expected_ref" ]]; then
    echo "ERRO: O projeto na URL ($extracted_ref) difere do projeto de staging autorizado ($expected_ref)." >&2
    return 1
  fi

  # 7. Validação da credencial (sem expor o token)
  if [[ -n "$auth_token" ]]; then
    if [[ "$auth_token" != eyJ* ]]; then
      echo "ERRO: Credencial fornecida não possui estrutura JWT válida." >&2
      return 1
    fi

    if [[ "$auth_token" == *"$PROD_PROJECT_REF"* ]]; then
      echo "ERRO DE SEGURANÇA: Credencial contém referência ao projeto de PRODUÇÃO!" >&2
      return 1
    fi
  fi

  echo "✓ Destino validado com sucesso: Staging isolado autorizado ($extracted_ref)."
  return 0
}
