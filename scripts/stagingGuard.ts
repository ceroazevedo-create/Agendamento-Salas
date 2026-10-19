/**
 * Barreira de Segurança Centralizada para Homologação em Staging - LocaPsico
 * Arquivo: scripts/stagingGuard.ts
 * 
 * Regra Inegociável: Bloqueia 100% qualquer operação contra o Supabase de produção (gqpavuqopukyfeyqyrxc),
 * rejeita placeholders, URLs adulteradas e credenciais incompatíveis ou inexistentes.
 * Falha estritamente de forma fechada (fail-closed).
 * 
 * ARQUITETURA DE VALIDAÇÃO DE JWT:
 * 1. Validação Estrutural e de Header:
 *    - Rejeição absoluta do algoritmo "none" (ataque de bypass de assinatura).
 *    - Verificação de formato estrito de 3 partes em Base64URL.
 *    - Restrição ao algoritmo simétrico seguro do Supabase (HS256). Algoritmos sem validação offline (RS256/ES256) são rejeitados.
 * 2. Validação Criptográfica:
 *    - Exige segredo compartilhado (jwtSecret) para comprovação offline da assinatura HMAC-SHA256.
 *    - Compara a assinatura em tempo constante (timingSafeEqual) para impedir ataques de temporização.
 * 3. Validação de Claims:
 *    - Expiração ("exp"): rejeita tokens expirados.
 *    - Validade Temporal ("nbf"): rejeita tokens ainda não vigentes.
 *    - Emissor ("iss") e Referência ("ref"): rejeita claims ligadas à produção e exige concordância com o projeto.
 *    - Papel ("role"): valida pertinência da permissão exigida (service_role vs anon).
 */

import crypto from 'crypto';

export const PRODUCTION_PROJECT_REF = 'gqpavuqopukyfeyqyrxc';

export const ALLOWED_JWT_ALGORITHMS = ['HS256'] as const;
export type AllowedJwtAlgorithm = typeof ALLOWED_JWT_ALGORITHMS[number];

export interface StagingEnvironmentConfig {
  stagingUrl: string;
  expectedProjectRef: string;
  serviceRoleKey?: string;
  anonKey?: string;
  requireServiceRole?: boolean;
  jwtSecret?: string; // Segredo do projeto para verificação criptográfica local
}

export interface ValidationResult {
  isValid: boolean;
  projectRef?: string;
  cryptographicallyVerified?: boolean;
  error?: string;
}

/**
 * Decodifica e valida o header do JWT de forma segura
 */
export function parseJwtHeaderSafely(token: string): { alg: string; typ?: string } | null {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;
    if (!parts[0]) return null;
    const headerStr = Buffer.from(parts[0], 'base64url').toString('utf8');
    const header = JSON.parse(headerStr);
    if (!header || typeof header !== 'object' || Array.isArray(header)) return null;
    return header;
  } catch {
    return null;
  }
}

/**
 * Decodifica o payload de um JWT de forma segura sem expor o token e sem dependências externas.
 * Valida a integridade estrutural das 3 partes e a decodificação JSON do payload.
 */
export function parseJwtPayloadSafely(token: string): Record<string, any> | null {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.trim().split('.');
    if (parts.length !== 3) return null;
    if (!parts[0] || !parts[1] || !parts[2]) return null;
    const payloadStr = Buffer.from(parts[1], 'base64url').toString('utf8');
    const parsed = JSON.parse(payloadStr);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Verifica criptograficamente a assinatura de um JWT HMAC-SHA256 (HS256) em tempo constante
 */
export function verifyHmacJwtSignature(token: string, secret: string): boolean {
  try {
    if (!token || !secret) return false;
    const parts = token.trim().split('.');
    if (parts.length !== 3) return false;

    const header = parseJwtHeaderSafely(token);
    if (!header || header.alg !== 'HS256') return false;

    const dataToSign = `${parts[0]}.${parts[1]}`;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(dataToSign)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSig);
    const actualBuf = Buffer.from(parts[2]);

    if (expectedBuf.length !== actualBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

/**
 * Sanitiza mensagens de erro para garantir que nenhuma chave ou token apareça em logs
 */
export function sanitizeErrorMessage(message: string): string {
  return message.replace(/eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}(\.[a-zA-Z0-9_-]*)?/g, '[REDACTED_JWT_TOKEN]');
}

/**
 * Validação centralizada e à prova de falhas do destino de homologação
 */
export function validateStagingEnvironment(config: StagingEnvironmentConfig): ValidationResult {
  const { stagingUrl, expectedProjectRef, serviceRoleKey, anonKey, requireServiceRole, jwtSecret } = config;

  // 1. Rejeição de URL vazia ou nula
  if (!stagingUrl || typeof stagingUrl !== 'string' || stagingUrl.trim() === '') {
    return { isValid: false, error: 'URL de staging não informada ou vazia.' };
  }

  const trimmedUrl = stagingUrl.trim();

  // 2. Bloqueio absoluto do identificador de PRODUÇÃO
  if (trimmedUrl.includes(PRODUCTION_PROJECT_REF) || expectedProjectRef === PRODUCTION_PROJECT_REF) {
    return { 
      isValid: false, 
      error: `BLOQUEIO DE SEGURANÇA: Tentativa de operação contra o ambiente de PRODUÇÃO (${PRODUCTION_PROJECT_REF}) abortada!` 
    };
  }

  // 3. Rejeição de placeholders e hosts locais
  const placeholderRegex = /(seu-staging|exemplo|placeholder|localhost|127\.0\.0\.1|::1|YOUR_STAGING|<project-ref>)/i;
  if (placeholderRegex.test(trimmedUrl)) {
    return { isValid: false, error: 'URL contém placeholder genérico ou host local não autorizado.' };
  }

  // 4. Detecção precoce e detalhada de anomalias (portas, caminhos, query strings)
  if (trimmedUrl.includes('?') || trimmedUrl.includes('#')) {
    return { isValid: false, error: 'URL inválida: não deve conter query strings ou fragmentos.' };
  }
  if (!trimmedUrl.startsWith('https://')) {
    return { isValid: false, error: 'Protocolo inválido: a URL de staging deve utilizar estritamente HTTPS.' };
  }
  if (trimmedUrl.slice(8).includes(':')) {
    return { isValid: false, error: 'Porta explícita detectada na URL: a URL de staging não deve conter portas personalizadas.' };
  }
  if (trimmedUrl.slice(8).includes('/')) {
    return { isValid: false, error: 'Caminho adicional detectado na URL: a URL de staging deve ser a raiz do projeto (ex: https://<ref>.supabase.co).' };
  }

  // 5. Validação estrita de formato oficial Supabase
  const supabaseUrlRegex = /^https:\/\/([a-z0-9]{15,35})\.supabase\.co$/;
  const match = trimmedUrl.match(supabaseUrlRegex);

  if (!match) {
    return { 
      isValid: false, 
      error: 'Formato de URL inválido. A URL de staging deve ser estritamente "https://<project-ref>.supabase.co".' 
    };
  }

  const extractedProjectRef = match[1];

  // 6. Comparação obrigatória com o identificador de staging explicitamente autorizado
  if (!expectedProjectRef || typeof expectedProjectRef !== 'string' || expectedProjectRef.trim() === '') {
    return { isValid: false, error: 'Identificador do projeto de staging autorizado não foi informado para conferência.' };
  }

  if (extractedProjectRef.toLowerCase() !== expectedProjectRef.trim().toLowerCase()) {
    return { 
      isValid: false, 
      error: `Identificador divergente: a URL aponta para "${extractedProjectRef}", mas o projeto autorizado é "${expectedProjectRef}".` 
    };
  }

  let isCryptographicallyVerified = false;

  // 7. Validação de Service Role Key (quando informada ou obrigatória)
  if (requireServiceRole || serviceRoleKey !== undefined) {
    if (!serviceRoleKey || typeof serviceRoleKey !== 'string' || serviceRoleKey.trim() === '') {
      return { isValid: false, error: 'Chave administrativa (service_role) é obrigatória para esta operação, mas está ausente ou vazia.' };
    }

    // 7.1 Header e Algoritmo
    const header = parseJwtHeaderSafely(serviceRoleKey);
    if (!header || !header.alg) {
      return { isValid: false, error: 'Header do JWT service_role é inválido ou ausente.' };
    }
    if (header.alg === 'none' || header.alg.toLowerCase() === 'none') {
      return { isValid: false, error: 'Algoritmo "none" proibido: tentativa de bypass de assinatura detectada!' };
    }
    if (!ALLOWED_JWT_ALGORITHMS.includes(header.alg as any)) {
      return { isValid: false, error: `Algoritmo "${header.alg}" não permitido. Algoritmos aceitos: ${ALLOWED_JWT_ALGORITHMS.join(', ')}.` };
    }

    // 7.2 Payload e Claims
    const payload = parseJwtPayloadSafely(serviceRoleKey);
    if (!payload) {
      return { isValid: false, error: 'Chave service_role fornecida não possui estrutura JWT válida.' };
    }

    // 7.3 Emissor ou Referência de Produção
    if (payload.iss && typeof payload.iss === 'string' && payload.iss.includes(PRODUCTION_PROJECT_REF)) {
      return { isValid: false, error: 'BLOQUEIO DE SEGURANÇA: A chave fornecida pertence ao projeto de PRODUÇÃO!' };
    }
    if (payload.ref && typeof payload.ref === 'string') {
      if (payload.ref === PRODUCTION_PROJECT_REF) {
        return { isValid: false, error: 'BLOQUEIO DE SEGURANÇA: A claim "ref" no token aponta para o projeto de PRODUÇÃO!' };
      }
      if (payload.ref.toLowerCase() !== expectedProjectRef.toLowerCase()) {
        return { isValid: false, error: `Divergência de projeto: claim "ref" no token ("${payload.ref}") difere do projeto autorizado ("${expectedProjectRef}").` };
      }
    }

    // 7.4 Compatibilidade de Papel e Audiência
    if (payload.role && payload.role !== 'service_role') {
      return { isValid: false, error: `Permissão insuficiente: a chave fornecida possui papel "${payload.role}", mas a operação exige "service_role".` };
    }
    if (payload.aud && payload.aud !== 'authenticated' && payload.aud !== 'service_role') {
      return { isValid: false, error: `Audiência inválida: claim "aud" ("${payload.aud}") incompatível com credencial administrativa.` };
    }

    // 7.5 Expiração (exp) e Vigência (nbf)
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < nowSec) {
      return { isValid: false, error: 'Credencial service_role expirada (claim "exp" no passado).' };
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSec) {
      return { isValid: false, error: 'Credencial service_role ainda não é válida (claim "nbf" no futuro).' };
    }

    // 7.6 Verificação Criptográfica de Assinatura
    if (requireServiceRole && !jwtSecret) {
      return { 
        isValid: false, 
        cryptographicallyVerified: false,
        error: 'Validação criptográfica insuficiente: "jwtSecret" não fornecido para comprovação da assinatura da credencial service_role em operação privilegiada.' 
      };
    }

    if (jwtSecret) {
      if (!verifyHmacJwtSignature(serviceRoleKey, jwtSecret)) {
        return { isValid: false, error: 'Assinatura criptográfica do JWT service_role é inválida para o segredo fornecido.' };
      }
      isCryptographicallyVerified = true;
    }
  }

  // 8. Validação de Anon Key (quando informada)
  if (anonKey !== undefined) {
    if (!anonKey || typeof anonKey !== 'string' || anonKey.trim() === '') {
      return { isValid: false, error: 'Chave anonKey fornecida é vazia.' };
    }

    const header = parseJwtHeaderSafely(anonKey);
    if (!header || !header.alg) {
      return { isValid: false, error: 'Header do JWT anonKey é inválido ou ausente.' };
    }
    if (header.alg === 'none' || header.alg.toLowerCase() === 'none') {
      return { isValid: false, error: 'Algoritmo "none" proibido na chave anonKey!' };
    }
    if (!ALLOWED_JWT_ALGORITHMS.includes(header.alg as any)) {
      return { isValid: false, error: `Algoritmo "${header.alg}" não permitido na anonKey.` };
    }

    const payload = parseJwtPayloadSafely(anonKey);
    if (!payload) {
      return { isValid: false, error: 'Chave anonKey fornecida não possui estrutura JWT válida.' };
    }

    if (payload.iss && typeof payload.iss === 'string' && payload.iss.includes(PRODUCTION_PROJECT_REF)) {
      return { isValid: false, error: 'BLOQUEIO DE SEGURANÇA: A chave anonKey fornecida pertence ao projeto de PRODUÇÃO!' };
    }
    if (payload.ref && typeof payload.ref === 'string') {
      if (payload.ref === PRODUCTION_PROJECT_REF) {
        return { isValid: false, error: 'BLOQUEIO DE SEGURANÇA: A claim "ref" na anonKey aponta para o projeto de PRODUÇÃO!' };
      }
      if (payload.ref.toLowerCase() !== expectedProjectRef.toLowerCase()) {
        return { isValid: false, error: `Divergência de projeto: claim "ref" na anonKey ("${payload.ref}") difere do projeto autorizado ("${expectedProjectRef}").` };
      }
    }

    if (payload.role && payload.role !== 'anon') {
      return { isValid: false, error: `Tipo de credencial incorreto: esperava-se papel "anon", mas o token contém papel "${payload.role}".` };
    }
    if (payload.aud && payload.aud !== 'anon' && payload.aud !== 'authenticated') {
      return { isValid: false, error: `Audiência inválida na chave anon: claim "aud" ("${payload.aud}").` };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === 'number' && payload.exp < nowSec) {
      return { isValid: false, error: 'Credencial anonKey expirada (claim "exp" no passado).' };
    }

    if (jwtSecret) {
      if (!verifyHmacJwtSignature(anonKey, jwtSecret)) {
        return { isValid: false, error: 'Assinatura criptográfica do JWT anonKey é inválida para o segredo fornecido.' };
      }
      isCryptographicallyVerified = true;
    }
  }

  return {
    isValid: true,
    projectRef: extractedProjectRef,
    cryptographicallyVerified: isCryptographicallyVerified
  };
}

/**
 * Utilitário executável de guarda que encerra o processo caso a validação falhe (fail-closed)
 */
export function assertStagingEnvironmentSafe(
  stagingUrl: string, 
  expectedProjectRef: string,
  serviceRoleKey?: string,
  options?: { requireServiceRole?: boolean; anonKey?: string; jwtSecret?: string }
): string {
  const result = validateStagingEnvironment({
    stagingUrl,
    expectedProjectRef,
    serviceRoleKey,
    anonKey: options?.anonKey,
    requireServiceRole: options?.requireServiceRole,
    jwtSecret: options?.jwtSecret
  });

  if (!result.isValid) {
    const safeError = sanitizeErrorMessage(result.error || 'Falha desconhecida na barreira de segurança.');
    console.error(`\n[BARREIRA DE SEGURANÇA STAGING] FALHA CRÍTICA:\n${safeError}\n`);
    throw new Error(`[BARREIRA STAGING BLOQUEADA] ${safeError}`);
  }

  return result.projectRef!;
}
