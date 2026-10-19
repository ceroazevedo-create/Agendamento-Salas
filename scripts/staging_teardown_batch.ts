/**
 * Limpeza Segura Parametrizada por Lote de Homologação (BATCH_ID) - LocaPsico
 * Arquivo: scripts/staging_teardown_batch.ts
 * 
 * Regras de Defesa em Profundidade:
 * - Validação de ambiente no executor ANTES de qualquer conexão com o banco
 * - Modo Simulação (Dry-Run) ATIVO por padrão
 * - Exige confirmação explícita (flag booleana + token textual) para execução destrutiva
 * - Rejeita lotes malformados ou genéricos
 * - Exclusão atômica e estritamente associada aos registros do lote
 * - Respeito integral à integridade referencial (FKs)
 */

import { createClient } from '@supabase/supabase-js';
import { assertStagingEnvironmentSafe } from './stagingGuard';

const STAGING_URL = process.env.STAGING_SUPABASE_URL || '';
const STAGING_REF = process.env.STAGING_PROJECT_REF || '';
const SERVICE_ROLE_KEY = process.env.STAGING_SERVICE_ROLE_KEY || '';

export interface TeardownOptions {
  batchId: string;
  dryRun?: boolean;
  confirmDestructiveExecution?: boolean;
  confirmationToken?: string;
}

export interface TeardownReport {
  batchId: string;
  dryRun: boolean;
  executed: boolean;
  affected: {
    payments: number;
    bookings: number;
    idempotencyKeys: number;
    blockedSlots: number;
    auditLogs: number;
  };
  message: string;
}

/**
 * Validador estrito de formato de BATCH_ID
 */
export function isValidBatchId(batchId: string): boolean {
  if (!batchId || typeof batchId !== 'string') return false;
  // Formato: batch_AAAAMMDD_HHMMSS_<entropia> (mínimo 16 caracteres)
  const batchRegex = /^batch_[0-9]{8}_[0-9]{4,6}_[a-zA-Z0-9_-]{4,20}$/;
  return batchRegex.test(batchId);
}

export async function teardownStagingBatch(options: TeardownOptions): Promise<TeardownReport> {
  const { 
    batchId, 
    dryRun = true, 
    confirmDestructiveExecution = false, 
    confirmationToken = '' 
  } = options;

  // 1. Validação estrita do identificador do lote
  if (!isValidBatchId(batchId)) {
    throw new Error(
      `[BLOQUEIO DE SEGURANÇA] BATCH_ID inválido: "${batchId}". ` +
      `Deve seguir rigorosamente o padrão "batch_YYYYMMDD_HHMMSS_<entropia>".`
    );
  }

  // 2. Barreira de Segurança no Executor (Falha Fechada antes de conectar)
  assertStagingEnvironmentSafe(STAGING_URL, STAGING_REF, SERVICE_ROLE_KEY, {
    requireServiceRole: true
  });

  const expectedToken = `CONFIRMO_EXCLUSAO_DEFINITIVA_LOTE_${batchId}`;

  // 3. Validação de Confirmação Explícita para Execução Destrutiva
  if (!dryRun) {
    if (!confirmDestructiveExecution || confirmationToken !== expectedToken) {
      throw new Error(
        `[BLOQUEIO DE SEGURANÇA] Tentativa de exclusão destrutiva sem confirmação explícita válida. ` +
        `Para executar a limpeza real, defina confirmDestructiveExecution=true e ` +
        `confirmationToken="${expectedToken}". Operação abortada sem alterações.`
      );
    }
  }

  const supabaseAdmin = createClient(STAGING_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const tagPattern = `[BATCH:${batchId}]`;

  // 4. Verificação Prévia dos Registros Associados ao Lote
  const { data: bookings, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id')
    .like('notes', `%${tagPattern}%`);

  if (bErr) throw new Error(`Falha ao consultar reservas do lote: ${bErr.message}`);

  const bookingIds = (bookings || []).map(b => b.id);

  let paymentsCount = 0;
  if (bookingIds.length > 0) {
    const { count, error: pErr } = await supabaseAdmin
      .from('payments')
      .select('id', { count: 'exact', head: true })
      .in('booking_id', bookingIds);
    if (pErr) throw new Error(`Falha ao consultar pagamentos: ${pErr.message}`);
    paymentsCount = count || 0;
  }

  const { count: keysCount, error: kErr } = await supabaseAdmin
    .from('booking_idempotency_keys')
    .select('key', { count: 'exact', head: true })
    .like('key', `rec-${batchId}-%`);
  if (kErr) throw new Error(`Falha ao consultar chaves de idempotência: ${kErr.message}`);

  const { count: blocksCount, error: blkErr } = await supabaseAdmin
    .from('blocked_slots')
    .select('id', { count: 'exact', head: true })
    .like('reason', `%${tagPattern}%`);
  if (blkErr) throw new Error(`Falha ao consultar bloqueios: ${blkErr.message}`);

  const { count: logsCount, error: lErr } = await supabaseAdmin
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .like('details', `%${tagPattern}%`);
  if (lErr) throw new Error(`Falha ao consultar logs de auditoria: ${lErr.message}`);

  const report: TeardownReport = {
    batchId,
    dryRun,
    executed: !dryRun,
    affected: {
      payments: paymentsCount,
      bookings: bookingIds.length,
      idempotencyKeys: keysCount || 0,
      blockedSlots: blocksCount || 0,
      auditLogs: logsCount || 0
    },
    message: dryRun
      ? `Simulação concluída com sucesso. Nenhum dado foi alterado. ${bookingIds.length} reservas identificadas para o lote ${batchId}.`
      : `Limpeza definitiva executada com sucesso para o lote ${batchId}.`
  };

  // Se for apenas visualização (Dry Run), retorna o relatório sem qualquer remoção
  if (dryRun) {
    return report;
  }

  // 5. Exclusão Atômica Estrita via RPC Transacional no PostgreSQL (Sem Fallback Não-Atômico)
  // Toda exclusão deve ocorrer dentro da mesma transação no PostgreSQL para garantir atomicidade total e rollback seguro.
  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc('teardown_staging_batch', {
    p_batch_id: batchId,
    p_confirmation_token: confirmationToken
  });

  if (rpcErr || !rpcData) {
    throw new Error(
      `[BLOQUEIO DE SEGURANÇA - FAIL-CLOSED] Falha na execução da RPC transacional 'teardown_staging_batch': ` +
      `${rpcErr?.message || 'Resposta nula do servidor'}. ` +
      `Operação destrutiva cancelada imediatamente sem efetuar exclusões sequenciais ou parciais.`
    );
  }

  report.affected = {
    payments: rpcData.payments_deleted || 0,
    bookings: rpcData.bookings_deleted || 0,
    idempotencyKeys: rpcData.idempotency_keys_deleted || 0,
    blockedSlots: rpcData.blocked_slots_deleted || 0,
    auditLogs: rpcData.audit_logs_deleted || 0
  };
  report.message = `Limpeza atômica transacional executada com sucesso via RPC para o lote ${batchId}.`;

  return report;
}
