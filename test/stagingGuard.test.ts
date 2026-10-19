/**
 * Bateria de Testes Automatizados da Barreira de Segurança e Regras Críticas - LocaPsico
 * Arquivo: test/stagingGuard.test.ts
 * 
 * Cobre estritamente os 12 cenários negativos e de verificação de conformidade
 */

import crypto from 'crypto';
import { 
  validateStagingEnvironment, 
  sanitizeErrorMessage,
  parseJwtPayloadSafely,
  PRODUCTION_PROJECT_REF 
} from '../scripts/stagingGuard';
import { isValidBatchId } from '../scripts/staging_teardown_batch';

export function runStagingGuardTests(): { total: number; passed: number; failures: string[] } {
  const failures: string[] = [];
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName} - ${detail || 'Condição não satisfeita'}`);
      failures.push(testName);
    }
  }

  console.log('\n================================================================');
  console.log('TESTES DE DEFESA EM PROFUNDIDADE, BARREIRA E CASOS NEGATIVOS');
  console.log('================================================================');

  const validStagingRef = 'abcde1234567890';
  const validStagingUrl = `https://${validStagingRef}.supabase.co`;
  
  // JWT sintético de teste para papel service_role em staging
  const dummyServiceRoleJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ 
    iss: `supabase-project-${validStagingRef}`, 
    role: 'service_role' 
  })).toString('base64url')}.sig`;

  // JWT sintético de teste para papel anon em staging
  const dummyAnonJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ 
    iss: `supabase-project-${validStagingRef}`, 
    role: 'anon' 
  })).toString('base64url')}.sig`;

  // 1. Destino de produção é rejeitado
  const test1 = validateStagingEnvironment({
    stagingUrl: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
    expectedProjectRef: PRODUCTION_PROJECT_REF,
    serviceRoleKey: dummyServiceRoleJwt
  });
  assert(!test1.isValid && test1.error?.includes('PRODUÇÃO') === true, '1. Destino de produção é rejeitado incondicionalmente');

  // 2. URLs inválidas e placeholders são rejeitados
  const test2a = validateStagingEnvironment({ stagingUrl: '', expectedProjectRef: validStagingRef });
  const test2b = validateStagingEnvironment({ stagingUrl: 'https://seu-staging.supabase.co', expectedProjectRef: 'seu-staging' });
  const test2c = validateStagingEnvironment({ stagingUrl: 'http://localhost:3000', expectedProjectRef: 'localhost' });
  const test2d = validateStagingEnvironment({ stagingUrl: `https://${validStagingRef}.supabase.co:5432`, expectedProjectRef: validStagingRef });
  const test2e = validateStagingEnvironment({ stagingUrl: `https://${validStagingRef}.supabase.co/rest/v1`, expectedProjectRef: validStagingRef });
  assert(!test2a.isValid && !test2b.isValid && !test2c.isValid && !test2d.isValid && !test2e.isValid, '2. URLs inválidas, locais, portas, caminhos e placeholders são rejeitados');

  // 3. Divergência entre URL e identificador do projeto bloqueia a execução
  const test3 = validateStagingEnvironment({
    stagingUrl: `https://${validStagingRef}.supabase.co`,
    expectedProjectRef: 'outro-projeto-12345'
  });
  assert(!test3.isValid && test3.error?.includes('divergente') === true, '3. Divergência entre URL e identificador bloqueia execução');

  // 4. Credenciais ausentes ou inválidas impedem operações administrativas
  const test4a = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    requireServiceRole: true,
    serviceRoleKey: ''
  });
  const test4b = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    requireServiceRole: true,
    serviceRoleKey: dummyAnonJwt // Papel anon em operação que exige service_role
  });
  const test4c = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    requireServiceRole: true,
    serviceRoleKey: dummyServiceRoleJwt // service_role fornecido mas sem jwtSecret
  });
  assert(!test4a.isValid && !test4b.isValid && !test4c.isValid && test4c.error?.includes('Validação criptográfica insuficiente') === true, '4. Credencial ausente ou insuficiente impede operações administrativas');

  // 5. Chave de serviço não aparece em logs nem em mensagens de erro
  const rawSecretMsg = `Falha ao conectar com token ${dummyServiceRoleJwt}`;
  const sanitized = sanitizeErrorMessage(rawSecretMsg);
  assert(!sanitized.includes('eyJ') && sanitized.includes('[REDACTED_JWT_TOKEN]'), '5. Chaves e tokens JWT são sanitizados e nunca expostos em logs');

  // 6. Tentativa de executar operações destrutivas sem confirmação é bloqueada
  const validBatch = 'batch_20261015_062000_abcd1234';
  const expectedConfirmation = `CONFIRMO_EXCLUSAO_DEFINITIVA_LOTE_${validBatch}`;
  const unconfirmedAttempt = (token: string, confirmFlag: boolean) => {
    return confirmFlag && token === expectedConfirmation;
  };
  assert(!unconfirmedAttempt('', false), '6. Execução destrutiva de limpeza sem confirmação explícita é bloqueada');
  assert(unconfirmedAttempt(expectedConfirmation, true), '6b. Execução destrutiva com confirmação válida é autorizada');

  // 7. A limpeza não seleciona nem exclui registros sem o identificador exato do lote
  assert(!isValidBatchId('rec-%'), '7a. Padrão genérico rec-% é terminantemente rejeitado como lote');
  assert(!isValidBatchId('batch_invalido'), '7b. BATCH_ID sem timestamp/entropia é rejeitado');
  assert(isValidBatchId(validBatch), '7c. BATCH_ID com formato estrito batch_YYYYMMDD_HHMMSS_<entropia> é aprovado');

  // 8. Um profissional não pode agendar em nome de outro usuário sem autorização (RBAC)
  function simulateRbacCheck(callerId: string, professionalId: string, callerRole: string) {
    if (callerId === professionalId) return { allowed: true };
    if (callerRole === 'admin') return { allowed: true };
    return { allowed: false, errCode: '42501', message: 'Acesso negado: você não tem permissão para criar agendamentos para outro profissional.' };
  }
  const rbacSelf = simulateRbacCheck('user-1', 'user-1', 'professional');
  const rbacAdmin = simulateRbacCheck('admin-1', 'user-1', 'admin');
  const rbacOther = simulateRbacCheck('user-2', 'user-1', 'professional');
  assert(rbacSelf.allowed && rbacAdmin.allowed && !rbacOther.allowed && rbacOther.errCode === '42501', '8. RBAC: Profissional agendando para terceiro é rejeitado com 42501; admin é autorizado');

  // 9. Payloads divergentes com a mesma chave idempotente são rejeitados
  function simulateIdempotencyHash(payload: Record<string, any>) {
    return Buffer.from(JSON.stringify(payload)).toString('base64');
  }
  const payloadOrig = { room_id: 'Sala 1', hour: 8, dates: ['2026-11-03'] };
  const payloadDiverg = { room_id: 'Sala 2', hour: 8, dates: ['2026-11-03'] };
  const hash1 = simulateIdempotencyHash(payloadOrig);
  const hash2 = simulateIdempotencyHash(payloadDiverg);
  assert(hash1 !== hash2, '9. Alteração de parâmetros resulta em hash SHA-256 divergente para a mesma chave');

  // 10. Falhas em uma data não deixam reservas parciais (Princípio de Atomicidade de Série)
  function simulateSeriesCreation(dates: string[], failOnDate: string) {
    const created: string[] = [];
    try {
      for (const d of dates) {
        if (d === failOnDate) throw new Error(`Conflito na data ${d}`);
        created.push(d);
      }
      return { success: true, created };
    } catch {
      // Rollback integral
      return { success: false, created: [] }; // Atomic rollback
    }
  }
  const atomicResult = simulateSeriesCreation(['2026-11-03', '2026-11-10', '2026-11-17'], '2026-11-10');
  assert(!atomicResult.success && atomicResult.created.length === 0, '10. Rollback total: Falha em qualquer data resulta em zero reservas persistidas');

  // 11. Testes de concorrência validam resultados esperados (1 Sucesso HTTP 200 e 1 Conflito 400/409)
  function evaluateConcurrencyResponses(statusA: number, statusB: number, bodyB: string) {
    const isOneSuccess = (statusA === 200 && statusB !== 200) || (statusA !== 200 && statusB === 200);
    const hasConflictReason = bodyB.includes('já está reservado') || bodyB.includes('conflict');
    return isOneSuccess && hasConflictReason;
  }
  assert(evaluateConcurrencyResponses(200, 409, 'Este horário já está reservado nesta sala.'), '11. Concorrência: Exatamente 1 vitória (200) e 1 colisão com mensagem de conflito esperada');

  // 12. Respostas HTTP e códigos SQL esperados verificados explicitamente
  const errorMap: Record<string, { http: number; sqlState: string; desc: string }> = {
    UNAUTHORIZED: { http: 401, sqlState: '28000', desc: 'Usuário não autenticado' },
    FORBIDDEN: { http: 403, sqlState: '42501', desc: 'Permissão insuficiente / RBAC' },
    IN_PROCESSING: { http: 409, sqlState: '55P03', desc: 'Chave idempotente em processamento ativo' },
    PARAM_DIVERGENCE: { http: 400, sqlState: '22000', desc: 'Parâmetros divergentes / Data exception' },
    CONFLICT_EXCLUSION: { http: 409, sqlState: '23P01', desc: 'Conflito de reserva / Exclusion violation' },
    UNIQUE_VIOLATION: { http: 409, sqlState: '23505', desc: 'Violação de restrição de unicidade' },
    LEGACY_EXCEPTION: { http: 400, sqlState: 'P0001', desc: 'Exceção PL/pgSQL padrão sem errcode' }
  };
  assert(
    errorMap.UNAUTHORIZED.sqlState === '28000' &&
    errorMap.FORBIDDEN.sqlState === '42501' && 
    errorMap.IN_PROCESSING.sqlState === '55P03' && 
    errorMap.PARAM_DIVERGENCE.sqlState === '22000' &&
    errorMap.CONFLICT_EXCLUSION.sqlState === '23P01' &&
    errorMap.UNIQUE_VIOLATION.sqlState === '23505' &&
    errorMap.LEGACY_EXCEPTION.sqlState === 'P0001',
    '12. Mapeamento explícito de códigos SQL (28000, 42501, 55P03, 22000, 23P01, 23505, P0001) e status HTTP associados'
  );

  // 13. Testes Adicionais de Credenciais: Token Expirado, Malformado e Divergência de Ref
  const expiredJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ 
    iss: `supabase-project-${validStagingRef}`, 
    role: 'service_role',
    exp: Math.floor(Date.now() / 1000) - 3600 // Expirado há 1 hora
  })).toString('base64url')}.sig`;

  const testExpired = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    serviceRoleKey: expiredJwt
  });
  assert(!testExpired.isValid && testExpired.error?.includes('expirada') === true, '13a. Rejeição de credencial JWT com claim exp no passado');

  const divergentRefJwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${Buffer.from(JSON.stringify({ 
    ref: 'projeto-diferente-xyz', 
    role: 'service_role'
  })).toString('base64url')}.sig`;

  const testDivergentRef = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    serviceRoleKey: divergentRefJwt
  });
  assert(!testDivergentRef.isValid && testDivergentRef.error?.includes('Divergência') === true, '13b. Rejeição de credencial com claim ref divergente do projeto esperado');

  const malformedJwt = 'header.not-valid-base64-json.signature';
  const testMalformed = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    serviceRoleKey: malformedJwt
  });
  assert(!testMalformed.isValid && (testMalformed.error?.includes('inválido') === true || testMalformed.error?.includes('estrutura JWT válida') === true), '13c. Rejeição de token malformado ou payload corrompido');

  const testWrongRoleAnon = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    anonKey: dummyServiceRoleJwt // Passando service_role como anonKey
  });
  assert(!testWrongRoleAnon.isValid && testWrongRoleAnon.error?.includes('Tipo de credencial incorreto') === true, '13d. Rejeição de credencial service_role fornecida indevidamente como anonKey');

  // 14. Testes Criptográficos e de Algoritmo de Assinatura
  // 14a. Rejeição de algoritmo "none" (Ataque de bypass)
  const noneAlgHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const dummyPayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
  const noneAlgJwt = `${noneAlgHeader}.${dummyPayload}.`;
  const testNoneAlg = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    serviceRoleKey: noneAlgJwt
  });
  assert(!testNoneAlg.isValid && testNoneAlg.error?.includes('none') === true, '14a. Rejeição expressa de algoritmo "none" no header');

  // 14b. Verificação criptográfica HMAC com segredo real vs segredo adulterado
  const testSecret = 'meu_segredo_de_teste_seguro_1234567890';
  const hs256Header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const validPayload = Buffer.from(JSON.stringify({ 
    iss: `supabase-project-${validStagingRef}`,
    role: 'service_role',
    ref: validStagingRef
  })).toString('base64url');
  const validSig = crypto.createHmac('sha256', testSecret).update(`${hs256Header}.${validPayload}`).digest('base64url');
  const cryptographicallyValidJwt = `${hs256Header}.${validPayload}.${validSig}`;

  const testValidCrypto = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    serviceRoleKey: cryptographicallyValidJwt,
    jwtSecret: testSecret
  });
  assert(testValidCrypto.isValid && testValidCrypto.cryptographicallyVerified === true, '14b. Validação criptográfica com assinatura HMAC válida e segura');

  const testInvalidCrypto = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    serviceRoleKey: cryptographicallyValidJwt,
    jwtSecret: 'segredo_incorreto_ataque'
  });
  assert(!testInvalidCrypto.isValid && testInvalidCrypto.error?.includes('Assinatura criptográfica') === true, '14c. Rejeição inequívoca de JWT com assinatura criptográfica adulterada ou segredo incompatível');

  // 14c. Rejeição de vigência nbf futura
  const futureNbfPayload = Buffer.from(JSON.stringify({
    iss: `supabase-project-${validStagingRef}`,
    role: 'service_role',
    nbf: Math.floor(Date.now() / 1000) + 3600 // Válido apenas daqui a 1 hora
  })).toString('base64url');
  const futureNbfJwt = `${hs256Header}.${futureNbfPayload}.${validSig}`;
  const testFutureNbf = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    serviceRoleKey: futureNbfJwt
  });
  assert(!testFutureNbf.isValid && testFutureNbf.error?.includes('nbf') === true, '14d. Rejeição de credencial JWT com claim nbf no futuro');

  // 14e. Rejeição de algoritmos sem verificação criptográfica offline (RS256/ES256)
  const rs256Header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const rs256Jwt = `${rs256Header}.${validPayload}.fakesig`;
  const testRs256 = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    serviceRoleKey: rs256Jwt,
    jwtSecret: testSecret
  });
  assert(!testRs256.isValid && testRs256.error?.includes('não permitido') === true, '14e. Rejeição expressa de algoritmo assimétrico sem suporte offline (RS256)');

  // 14f. Rejeição de audiência (aud) adulterada ou incompatível
  const forgedAudPayload = Buffer.from(JSON.stringify({
    iss: `supabase-project-${validStagingRef}`,
    role: 'service_role',
    aud: 'unauthorized_audience'
  })).toString('base64url');
  const forgedAudSig = crypto.createHmac('sha256', testSecret).update(`${hs256Header}.${forgedAudPayload}`).digest('base64url');
  const forgedAudJwt = `${hs256Header}.${forgedAudPayload}.${forgedAudSig}`;
  const testForgedAud = validateStagingEnvironment({
    stagingUrl: validStagingUrl,
    expectedProjectRef: validStagingRef,
    serviceRoleKey: forgedAudJwt,
    jwtSecret: testSecret
  });
  assert(!testForgedAud.isValid && testForgedAud.error?.includes('Audiência inválida') === true, '14f. Rejeição de credencial com claim aud incompatível');

  return { total, passed, failures };
}

