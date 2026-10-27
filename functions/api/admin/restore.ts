import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { validateFullBackupPayload, sanitizeCredentialsDeep } from '../../../scripts/backupValidation';

export interface Env {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
}

export interface PagesFunctionContext<EnvType = Env> {
  request: Request;
  env: EnvType;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<any>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  data: Record<string, unknown>;
}

const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  'password',
  'password_hash',
  'encrypted_password',
  'new_password',
  'reset_token',
  'confirmation_token',
  'recovery_token',
  'access_token',
  'refresh_token',
  'token',
  'secret',
  'api_key',
  'apikey',
  'service_role_key',
  'supabase_service_role_key',
  'private_key'
]);

const REQUIRED_TABLES = [
  'profiles',
  'professionals',
  'clients',
  'rooms',
  'bookings',
  'payments',
  'blocked_slots',
  'settings',
  'audit_logs'
] as const;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

export const PRODUCTION_PROJECT_REF = 'gqpavuqopukyfeyqyrxc';

function extractProjectRefFromUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    const hostParts = parsed.hostname.split('.');
    if (hostParts.length >= 3 && hostParts[1] === 'supabase' && hostParts[2] === 'co') {
      return hostParts[0].toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

function getSupabaseAdmin(env: Env): SupabaseClient {
  const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl) {
    throw new Error('Configuração ausente: SUPABASE_URL ou VITE_SUPABASE_URL não definida.');
  }

  if (!serviceKey) {
    throw new Error('Chave de serviço SUPABASE_SERVICE_ROLE_KEY não configurada no ambiente do Cloudflare Pages.');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

function sanitizeRecordCredentials<T extends Record<string, any>>(record: T): T {
  if (!record || typeof record !== 'object') return record;
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (FORBIDDEN_CREDENTIAL_KEYS.has(key.toLowerCase())) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned as T;
}

/**
 * Verifica se o payload de backup contém qualquer indício de anonimização.
 * Backups anonimizados NUNCA podem ser restaurados.
 */
function detectAnonymizedPayload(backup: any): { isAnonymized: boolean; reason?: string } {
  const meta = backup?.metadata || {};

  if (
    String(meta.backupType || '').toUpperCase() === 'ANONIMIZADO' ||
    meta.isAnonymized === true ||
    meta.restorable === false ||
    String(meta.description || '').toUpperCase().includes('ANONIMIZADO') ||
    String(meta.generatedBy?.email || '').endsWith('@anonimizado.local')
  ) {
    return {
      isAnonymized: true,
      reason: 'Os metadados do arquivo indicam que este é um Backup Anonimizado (restorable: false).'
    };
  }

  const data = backup?.data || {};
  const checkRows = [
    ...(Array.isArray(data.profiles) ? data.profiles : []),
    ...(Array.isArray(data.professionals) ? data.professionals : []),
    ...(Array.isArray(data.clients) ? data.clients : [])
  ];

  for (const row of checkRows) {
    if (!row || typeof row !== 'object') continue;
    const email = String(row.email || '').toLowerCase();
    const cpf = String(row.cpf || '');
    const phone = String(row.phone || '');
    const fullName = String(row.full_name || row.name || '');

    if (
      email.endsWith('@anonimizado.local') ||
      cpf === '***.***.***-**' ||
      phone === '(**) *****-****' ||
      fullName.includes('Anonimizado #') ||
      String(row.crp || '') === 'CRP-ANONIMIZADO'
    ) {
      return {
        isAnonymized: true,
        reason: 'Foram detectados dados mascarados/anonimizados (ex: @anonimizado.local ou ***.***.***-**) nos registros.'
      };
    }
  }

  return { isAnonymized: false };
}



async function upsertBookingsSafely(supabaseAdmin: SupabaseClient, bookings: any[]): Promise<number> {
  if (!bookings || bookings.length === 0) return 0;

  let restoredCount = 0;

  // Tenta em lote primeiro
  const { error: batchErr } = await supabaseAdmin
    .from('bookings')
    .upsert(bookings, { onConflict: 'id' });

  if (!batchErr) {
    return bookings.length;
  }

  // Fallback individual (caso alguma coluna opcional como period_shift não exista ou haja conflito pontual em registro histórico)
  for (const row of bookings) {
    const cleanRow = { ...row };
    const { error: rowErr } = await supabaseAdmin
      .from('bookings')
      .upsert(cleanRow, { onConflict: 'id' });

    if (!rowErr) {
      restoredCount++;
      continue;
    }

    // Tentativa sem period_shift / period_name caso o banco remoto não tenha essas colunas
    const fallbackRow = { ...cleanRow };
    delete fallbackRow.period_shift;
    delete fallbackRow.period_name;

    const { error: fallbackErr } = await supabaseAdmin
      .from('bookings')
      .upsert(fallbackRow, { onConflict: 'id' });

    if (!fallbackErr) {
      restoredCount++;
    }
  }

  return restoredCount;
}

async function upsertRoomsSafely(supabaseAdmin: SupabaseClient, rooms: any[]): Promise<number> {
  if (!rooms || rooms.length === 0) return 0;

  const { error: batchErr } = await supabaseAdmin
    .from('rooms')
    .upsert(rooms, { onConflict: 'id' });

  if (!batchErr) {
    return rooms.length;
  }

  let restoredCount = 0;
  for (const r of rooms) {
    const fallbackRoom = { ...r };
    delete fallbackRoom.morning_rate;
    delete fallbackRoom.afternoon_rate;
    delete fallbackRoom.night_rate;

    const { error } = await supabaseAdmin
      .from('rooms')
      .upsert(fallbackRoom, { onConflict: 'id' });

    if (!error) restoredCount++;
  }
  return restoredCount;
}

/**
 * POST /api/admin/restore (Cloudflare Pages Function)
 * Restaura com segurança um Backup Completo do LocaPsico preservando a conta do Administrador.
 */
export const onRequestPost = async (context: PagesFunctionContext<Env>): Promise<Response> => {
  try {
    const { request, env } = context;

    // 1. Verificar obrigatoriamente Authorization: Bearer <token>
    const rawAuth = request.headers.get('Authorization') || request.headers.get('authorization') || '';
    const authHeader = rawAuth.trim();
    if (!authHeader || (!authHeader.startsWith('Bearer ') && authHeader !== 'Bearer')) {
      return jsonResponse(
        { error: 'Não autorizado. Token de autenticação Bearer ausente.' },
        401
      );
    }

    const token = authHeader.replace(/^Bearer\s*/i, '').trim();
    if (!token) {
      return jsonResponse(
        { error: 'Não autorizado. Token de autenticação vazio ou malformado.' },
        401
      );
    }

    const supabaseAdmin = (context.data?.supabaseAdmin as SupabaseClient) || getSupabaseAdmin(env);

    // 2. Validar o token no Supabase e identificar o administrador autenticado
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return jsonResponse(
        { error: 'Sessão administrativa inválida ou expirada.' },
        401
      );
    }

    const callerAdminId = callerData.user.id;
    const callerAdminEmail = (callerData.user.email || 'admin@admin.com.br').trim().toLowerCase();

    // 3. Verificar se o usuário autenticado possui role = 'admin'
    const { data: callerProfile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', callerAdminId)
      .maybeSingle();

    if (profileErr) {
      return jsonResponse(
        { error: 'Falha ao consultar perfil administrativo no banco.' },
        500
      );
    }

    const roleNormalized = String(callerProfile?.role || '').toLowerCase();
    const isAdmin = roleNormalized === 'admin';

    if (!isAdmin) {
      return jsonResponse(
        { error: 'Permissão negada. Apenas administradores podem restaurar backups do sistema.' },
        403
      );
    }

    // 4. Ler e validar o corpo da requisição
    let body: { backup?: any; confirmationWord?: string };
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: 'Corpo da requisição JSON inválido.' },
        400
      );
    }

    if (String(body?.confirmationWord || '').trim().toUpperCase() !== 'RESTAURAR') {
      return jsonResponse(
        { error: 'Palavra de confirmação inválida. Digite exatamente RESTAURAR para confirmar.' },
        400
      );
    }

    const backupPayload = body?.backup;
    const validation = validateFullBackupPayload(backupPayload);
    if (!validation.valid) {
      return jsonResponse(
        { error: validation.error || 'Arquivo de backup inválido para restauração.' },
        400
      );
    }

    // Bloqueio rigoroso de segurança: impede restauração destrutiva no projeto de produção
    const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
    const projectRef = extractProjectRefFromUrl(supabaseUrl);
    if (projectRef === PRODUCTION_PROJECT_REF) {
      return jsonResponse(
        {
          error: `[BLOQUEIO DE SEGURANÇA] Restauração abortada: Operações administrativas destrutivas são terminantemente proibidas contra o projeto de PRODUÇÃO (${PRODUCTION_PROJECT_REF}).`
        },
        403
      );
    }

    // 5. Capturar snapshot atual em memória para rollback automático caso ocorra falha crítica
    const [
      currProfilesRes,
      currProfessionalsRes,
      currClientsRes,
      currRoomsRes,
      currBookingsRes,
      currPaymentsRes,
      currBlocksRes,
      currSettingsRes
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*'),
      supabaseAdmin.from('professionals').select('*'),
      supabaseAdmin.from('clients').select('*'),
      supabaseAdmin.from('rooms').select('*'),
      supabaseAdmin.from('bookings').select('*'),
      supabaseAdmin.from('payments').select('*'),
      supabaseAdmin.from('blocked_slots').select('*'),
      supabaseAdmin.from('settings').select('*')
    ]);

    const preRestoreSnapshot = {
      profiles: currProfilesRes.data || [],
      professionals: currProfessionalsRes.data || [],
      clients: currClientsRes.data || [],
      rooms: currRoomsRes.data || [],
      bookings: currBookingsRes.data || [],
      payments: currPaymentsRes.data || [],
      blocked_slots: currBlocksRes.data || [],
      settings: currSettingsRes.data || []
    };

    // Rastreamento de contas Auth recém-criadas nesta execução para compensação isolada
    const newlyCreatedAuthUserIds: string[] = [];

    const rollbackCreatedAuthUsers = async () => {
      if (newlyCreatedAuthUserIds.length > 0) {
        const cleanupResults = await Promise.allSettled(
          newlyCreatedAuthUserIds.map(uid => supabaseAdmin.auth.admin.deleteUser(uid))
        );
        const failedCleanups = cleanupResults.filter(r => r.status === 'rejected');
        if (failedCleanups.length > 0) {
          console.error(`[RESTORE COMPENSAÇÃO] Falha ao excluir ${failedCleanups.length} contas Auth temporárias:`, failedCleanups);
        }
      }
    };

    try {
      // 6. Mapear usuários existentes no Supabase Auth (auth.users) com paginação completa
      const existingAuthUsers: any[] = [];
      let authPage = 1;
      let hasMoreAuth = true;

      while (hasMoreAuth) {
        const { data: authListRes, error: authListErr } = await supabaseAdmin.auth.admin.listUsers({
          page: authPage,
          perPage: 1000
        });

        if (authListErr) {
          throw new Error(`Falha ao listar usuários do Supabase Auth: ${authListErr.message}`);
        }

        const pageUsers = authListRes?.users || [];
        existingAuthUsers.push(...pageUsers);

        if (pageUsers.length < 1000) {
          hasMoreAuth = false;
        } else {
          authPage++;
        }
      }
      const authUsersById = new Map<string, any>();
      const authUsersByEmail = new Map<string, any>();

      for (const u of existingAuthUsers) {
        authUsersById.set(u.id, u);
        if (u.email) {
          authUsersByEmail.set(u.email.trim().toLowerCase(), u);
        }
      }

      const rawProfiles = (backupPayload.data.profiles || []).map(sanitizeRecordCredentials);
      const rawProfessionals = (backupPayload.data.professionals || []).map(sanitizeRecordCredentials);
      const rawClients = (backupPayload.data.clients || []).map(sanitizeRecordCredentials);
      const rawRooms = (backupPayload.data.rooms || []).map(sanitizeRecordCredentials);
      const rawBookings = (backupPayload.data.bookings || []).map(sanitizeRecordCredentials);
      const rawPayments = (backupPayload.data.payments || []).map(sanitizeRecordCredentials);
      const rawBlockedSlots = (backupPayload.data.blocked_slots || []).map(sanitizeRecordCredentials);
      const rawSettings = (backupPayload.data.settings || []).map(sanitizeRecordCredentials);
      const rawAuditLogs = (backupPayload.data.audit_logs || []).map(sanitizeRecordCredentials);

      // Mapeamento de IDs de perfis (caso o admin ou algum profissional tenha outro UUID no Auth atual)
      const profileIdMap = new Map<string, string>();
      const profilesToUpsertMap = new Map<string, any>();

      for (const p of rawProfiles) {
        if (!p || !p.id) continue;
        const pEmail = String(p.email || '').trim().toLowerCase();
        const isBackupRowAdmin =
          String(p.role || '').toLowerCase() === 'admin' ||
          pEmail === 'admin@admin.com.br' ||
          pEmail === callerAdminEmail ||
          p.id === callerAdminId;

        if (isBackupRowAdmin) {
          profileIdMap.set(String(p.id), callerAdminId);
          profilesToUpsertMap.set(callerAdminId, {
            ...p,
            id: callerAdminId,
            email: callerData.user.email || p.email || 'admin@admin.com.br',
            full_name: p.full_name || callerProfile?.full_name || 'Administrador',
            role: 'admin',
            status: 'ACTIVE'
          });
          continue;
        }

        // Profissional comum: verificar se o UUID já existe em auth.users
        if (authUsersById.has(String(p.id))) {
          profileIdMap.set(String(p.id), String(p.id));
          profilesToUpsertMap.set(String(p.id), {
            ...p,
            role: 'professional',
            status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
          });
        } else if (pEmail && authUsersByEmail.has(pEmail)) {
          // Já existe no Auth com o mesmo e-mail, mas com outro UUID
          const matchedAuth = authUsersByEmail.get(pEmail);
          profileIdMap.set(String(p.id), String(matchedAuth.id));
          profilesToUpsertMap.set(String(matchedAuth.id), {
            ...p,
            id: String(matchedAuth.id),
            role: 'professional',
            status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
          });
        } else if (pEmail) {
          // Não existe no Auth atual: provisionar nova conta e rastrear ID para compensação
          const tempPassword = `LocaPsico#${Math.random().toString(36).slice(-6)}9A!`;
          const { data: createdAuth, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
            id: String(p.id),
            email: pEmail,
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
              full_name: p.full_name || 'Profissional',
              name: p.full_name || 'Profissional',
              cpf: p.cpf || '',
              phone: p.phone || ''
            }
          });

          if (createAuthErr || !createdAuth?.user) {
            await rollbackCreatedAuthUsers();
            return jsonResponse(
              { error: `Falha ao provisionar usuário ${pEmail} no Supabase Auth: ${createAuthErr?.message || 'Erro desconhecido'}` },
              500
            );
          }

          const finalId = String(createdAuth.user.id);
          newlyCreatedAuthUserIds.push(finalId);
          profileIdMap.set(String(p.id), finalId);
          authUsersById.set(finalId, createdAuth.user);
          authUsersByEmail.set(pEmail, createdAuth.user);
          profilesToUpsertMap.set(finalId, {
            ...p,
            id: finalId,
            role: 'professional',
            status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
          });
        }
      }

      // Garantir obrigatoriamente que o administrador atual esteja presente, ativo e com role = 'admin'
      if (!profilesToUpsertMap.has(callerAdminId)) {
        profilesToUpsertMap.set(callerAdminId, {
          id: callerAdminId,
          full_name: callerProfile?.full_name || 'Administrador',
          email: callerData.user.email || callerProfile?.email || 'admin@admin.com.br',
          phone: callerProfile?.phone || null,
          cpf: callerProfile?.cpf || null,
          role: 'admin',
          status: 'ACTIVE',
          created_at: callerProfile?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      } else {
        const adm = profilesToUpsertMap.get(callerAdminId);
        adm.id = callerAdminId;
        adm.role = 'admin';
        adm.status = 'ACTIVE';
      }

      const validProfileIds = new Set<string>(profilesToUpsertMap.keys());
      const resolveProfileId = (oldId: string | null | undefined): string | null => {
        if (!oldId) return null;
        const mapped = profileIdMap.get(String(oldId)) || String(oldId);
        return validProfileIds.has(mapped) ? mapped : null;
      };

      // Preparar professionals
      const professionalsByUserId = new Map<string, any>();
      for (const prof of rawProfessionals) {
        if (!prof) continue;
        const targetUserId = resolveProfileId(prof.user_id);
        if (!targetUserId) continue;
        professionalsByUserId.set(targetUserId, {
          ...prof,
          user_id: targetUserId,
          status: prof.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
        });
      }

      // Preparar clients
      const clientsToUpsert: any[] = [];
      const validClientIds = new Set<string>();
      for (const c of rawClients) {
        if (!c || !c.id) continue;
        const targetProfId = resolveProfileId(c.professional_id) || callerAdminId;
        clientsToUpsert.push({
          ...c,
          professional_id: targetProfId
        });
        validClientIds.add(String(c.id));
      }

      // Preparar rooms (garantindo que todas as salas referenciadas existam)
      const roomsMap = new Map<string, any>();
      for (const r of rawRooms) {
        if (r && r.id) {
          roomsMap.set(String(r.id), r);
        }
      }
      if (!roomsMap.has('Sala 1')) {
        roomsMap.set('Sala 1', {
          id: 'Sala 1',
          name: 'Sala 1 — Atendimento Clínico',
          hourly_rate: 40,
          period_rate: 350,
          opening_time: 7,
          closing_time: 22,
          status: 'ACTIVE'
        });
      }
      if (!roomsMap.has('Sala 2')) {
        roomsMap.set('Sala 2', {
          id: 'Sala 2',
          name: 'Sala 2 — Multidisciplinar',
          hourly_rate: 40,
          period_rate: 350,
          opening_time: 7,
          closing_time: 22,
          status: 'ACTIVE'
        });
      }
      const roomsToUpsert = Array.from(roomsMap.values());

      // Preparar bookings
      const bookingsToUpsert: any[] = [];
      const validBookingIds = new Set<string>();
      for (const b of rawBookings) {
        if (!b || !b.id) continue;
        const targetProfId = resolveProfileId(b.professional_id) || callerAdminId;
        const targetClientId =
          b.client_id && validClientIds.has(String(b.client_id)) ? String(b.client_id) : null;
        const targetRoomId = roomsMap.has(String(b.room_id)) ? String(b.room_id) : 'Sala 1';

        bookingsToUpsert.push({
          ...b,
          professional_id: targetProfId,
          client_id: targetClientId,
          room_id: targetRoomId
        });
        validBookingIds.add(String(b.id));
      }

      // Preparar payments
      const paymentsToUpsert: any[] = [];
      for (const pay of rawPayments) {
        if (!pay || !pay.id) continue;
        const targetProfId = resolveProfileId(pay.professional_id) || callerAdminId;
        const targetBookingId =
          pay.booking_id && validBookingIds.has(String(pay.booking_id)) ? String(pay.booking_id) : null;
        paymentsToUpsert.push({
          ...pay,
          professional_id: targetProfId,
          booking_id: targetBookingId
        });
      }

      // Preparar blocked_slots
      const blockedSlotsToUpsert = rawBlockedSlots.filter((blk: any) => blk && blk.id);

      // Preparar settings
      const settingsToUpsert = rawSettings.filter((s: any) => s && s.id);

      // Preparar audit_logs
      const auditLogsToUpsert = rawAuditLogs
        .filter((log: any) => log && log.id)
        .map((log: any) => ({
          ...log,
          user_id: resolveProfileId(log.user_id)
        }));

      const preparedBackupData = {
        profiles: Array.from(profilesToUpsertMap.values()),
        professionals: Array.from(professionalsByUserId.values()),
        clients: clientsToUpsert,
        rooms: roomsToUpsert,
        bookings: bookingsToUpsert,
        payments: paymentsToUpsert,
        blocked_slots: blockedSlotsToUpsert,
        settings: settingsToUpsert,
        audit_logs: auditLogsToUpsert
      };

      // 7. EXECUÇÃO ATÔMICA VIA RPC POSTGRESQL (execute_admin_full_restore)
      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc('execute_admin_full_restore', {
        p_backup_data: preparedBackupData,
        p_caller_admin_id: callerAdminId
      });

      if (!rpcError && rpcResult?.success) {
        return jsonResponse({
          success: true,
          message: 'Backup Completo restaurado com sucesso e atomicidade garantida no PostgreSQL!',
          restoredAt: rpcResult.restored_at || new Date().toISOString(),
          restoredBy: {
            id: callerAdminId,
            email: callerAdminEmail,
            name: callerProfile?.full_name || 'Administrador'
          },
          totalRestored: rpcResult.total_records,
          counts: rpcResult.counts
        });
      }

      const isRpcMissing =
        rpcError?.code === '42883' ||
        (String(rpcError?.message || '').toLowerCase().includes('execute_admin_full_restore') &&
         String(rpcError?.message || '').toLowerCase().includes('does not exist'));

      if (!isRpcMissing) {
        // Rollback atômico já efetuado pelo PostgreSQL; compensar contas Auth criadas
        await rollbackCreatedAuthUsers();
        return jsonResponse(
          { error: `Falha na restauração atômica (rollback executado no banco): ${rpcError?.message || 'Erro desconhecido'}` },
          500
        );
      }

      // =========================================================================
      // FASE DE LIMPEZA ORDENADA (Fallback apenas caso a RPC não exista)
      // =========================================================================
      await supabaseAdmin.from('payments').delete().not('id', 'is', null);
      await supabaseAdmin.from('bookings').delete().not('id', 'is', null);
      await supabaseAdmin.from('blocked_slots').delete().not('id', 'is', null);
      await supabaseAdmin.from('clients').delete().not('id', 'is', null);
      await supabaseAdmin.from('audit_logs').delete().not('id', 'is', null);
      await supabaseAdmin.from('professionals').delete().not('id', 'is', null);

      // Em profiles, remove apenas perfis que não fazem parte do backup E nunca remove o administrador atual
      const { data: currentProfilesInDb } = await supabaseAdmin
        .from('profiles')
        .select('id, role, email');

      for (const dbProf of currentProfilesInDb || []) {
        const isCurrentAdmin =
          dbProf.id === callerAdminId ||
          String(dbProf.role || '').toLowerCase() === 'admin' ||
          String(dbProf.email || '').toLowerCase() === 'admin@admin.com.br';

        if (!isCurrentAdmin && !validProfileIds.has(String(dbProf.id))) {
          await supabaseAdmin.from('profiles').delete().eq('id', dbProf.id);
        }
      }

      // =========================================================================
      // FASE DE RESTAURAÇÃO ORDENADA (Tabelas Mães -> Tabelas Filhas)
      // =========================================================================

      // 1. settings
      if (settingsToUpsert.length > 0) {
        const { error: settingsErr } = await supabaseAdmin
          .from('settings')
          .upsert(settingsToUpsert, { onConflict: 'id' });
        if (settingsErr) {
          throw new Error(`Erro ao restaurar 'settings': ${settingsErr.message}`);
        }
      }

      // 2. rooms
      const restoredRoomsCount = await upsertRoomsSafely(supabaseAdmin, roomsToUpsert);
      if (roomsToUpsert.length > 0 && restoredRoomsCount < roomsToUpsert.length) {
        throw new Error(`Erro ao restaurar 'rooms': apenas ${restoredRoomsCount} de ${roomsToUpsert.length} salas foram salvas.`);
      }

      // 3. profiles
      const profilesArray = Array.from(profilesToUpsertMap.values());
      if (profilesArray.length > 0) {
        const { error: profilesErr } = await supabaseAdmin
          .from('profiles')
          .upsert(profilesArray, { onConflict: 'id' });
        if (profilesErr) {
          throw new Error(`Erro ao restaurar 'profiles': ${profilesErr.message}`);
        }
      }

      // 4. professionals
      const professionalsArray = Array.from(professionalsByUserId.values());
      if (professionalsArray.length > 0) {
        const { error: profsErr } = await supabaseAdmin
          .from('professionals')
          .upsert(professionalsArray, { onConflict: 'user_id' });
        if (profsErr) {
          throw new Error(`Erro ao restaurar 'professionals': ${profsErr.message}`);
        }
      }

      // 5. clients
      if (clientsToUpsert.length > 0) {
        const { error: clientsErr } = await supabaseAdmin
          .from('clients')
          .upsert(clientsToUpsert, { onConflict: 'id' });
        if (clientsErr) {
          throw new Error(`Erro ao restaurar 'clients': ${clientsErr.message}`);
        }
      }

      // 6. bookings (inserido ANTES de blocked_slots para não acionar falso conflito com bloqueios posteriores)
      const restoredBookingsCount = await upsertBookingsSafely(supabaseAdmin, bookingsToUpsert);
      if (bookingsToUpsert.length > 0 && restoredBookingsCount < bookingsToUpsert.length) {
        throw new Error(`Erro ao restaurar 'bookings': apenas ${restoredBookingsCount} de ${bookingsToUpsert.length} agendamentos foram salvos.`);
      }

      // 7. blocked_slots
      if (blockedSlotsToUpsert.length > 0) {
        const { error: blocksErr } = await supabaseAdmin
          .from('blocked_slots')
          .upsert(blockedSlotsToUpsert, { onConflict: 'id' });
        if (blocksErr) {
          throw new Error(`Erro ao restaurar 'blocked_slots': ${blocksErr.message}`);
        }
      }

      // 8. payments
      if (paymentsToUpsert.length > 0) {
        const { error: paymentsErr } = await supabaseAdmin
          .from('payments')
          .upsert(paymentsToUpsert, { onConflict: 'id' });
        if (paymentsErr) {
          throw new Error(`Erro ao restaurar 'payments': ${paymentsErr.message}`);
        }
      }

      // 9. audit_logs + registro da própria restauração
      if (auditLogsToUpsert.length > 0) {
        await supabaseAdmin
          .from('audit_logs')
          .upsert(auditLogsToUpsert, { onConflict: 'id' });
      }

      const restoreAuditLog = {
        user_id: callerAdminId,
        user_name: callerProfile?.full_name || 'Administrador',
        action: 'Restauração de Backup Completo',
        details: `Backup Completo (gerado em ${backupPayload.metadata.generatedAt || 'data não informada'}) restaurado com sucesso pelo administrador.`,
        timestamp: new Date().toISOString()
      };

      await supabaseAdmin.from('audit_logs').insert(restoreAuditLog);

      const restoredCounts = {
        profiles: profilesArray.length,
        professionals: professionalsArray.length,
        clients: clientsToUpsert.length,
        rooms: roomsToUpsert.length,
        bookings: restoredBookingsCount,
        payments: paymentsToUpsert.length,
        blocked_slots: blockedSlotsToUpsert.length,
        settings: settingsToUpsert.length,
        audit_logs: auditLogsToUpsert.length + 1
      };

      const totalRestored = Object.values(restoredCounts).reduce((acc, c) => acc + c, 0);

      return jsonResponse({
        success: true,
        message: 'Backup Completo restaurado com sucesso!',
        restoredAt: new Date().toISOString(),
        restoredBy: {
          id: callerAdminId,
          email: callerAdminEmail,
          name: callerProfile?.full_name || 'Administrador'
        },
        totalRestored,
        counts: restoredCounts
      });
    } catch (innerErr: any) {
      await rollbackCreatedAuthUsers();
      // Rollback automático de emergência usando o preRestoreSnapshot
      let rollbackFailureReason: string | null = null;
      try {
        if (preRestoreSnapshot.settings.length > 0) {
          const { error: sErr } = await supabaseAdmin.from('settings').upsert(preRestoreSnapshot.settings, { onConflict: 'id' });
          if (sErr) throw new Error(`Falha ao restaurar settings: ${sErr.message}`);
        }
        if (preRestoreSnapshot.rooms.length > 0) {
          const count = await upsertRoomsSafely(supabaseAdmin, preRestoreSnapshot.rooms);
          if (count < preRestoreSnapshot.rooms.length) throw new Error('Falha ao restaurar rooms integralmente');
        }
        if (preRestoreSnapshot.profiles.length > 0) {
          const { error: pErr } = await supabaseAdmin.from('profiles').upsert(preRestoreSnapshot.profiles, { onConflict: 'id' });
          if (pErr) throw new Error(`Falha ao restaurar profiles: ${pErr.message}`);
        }
        if (preRestoreSnapshot.professionals.length > 0) {
          const { error: prErr } = await supabaseAdmin.from('professionals').upsert(preRestoreSnapshot.professionals, { onConflict: 'user_id' });
          if (prErr) throw new Error(`Falha ao restaurar professionals: ${prErr.message}`);
        }
        if (preRestoreSnapshot.clients.length > 0) {
          const { error: cErr } = await supabaseAdmin.from('clients').upsert(preRestoreSnapshot.clients, { onConflict: 'id' });
          if (cErr) throw new Error(`Falha ao restaurar clients: ${cErr.message}`);
        }
        if (preRestoreSnapshot.bookings.length > 0) {
          const count = await upsertBookingsSafely(supabaseAdmin, preRestoreSnapshot.bookings);
          if (count < preRestoreSnapshot.bookings.length) throw new Error('Falha ao restaurar bookings integralmente');
        }
        if (preRestoreSnapshot.blocked_slots.length > 0) {
          const { error: blErr } = await supabaseAdmin.from('blocked_slots').upsert(preRestoreSnapshot.blocked_slots, { onConflict: 'id' });
          if (blErr) throw new Error(`Falha ao restaurar blocked_slots: ${blErr.message}`);
        }
        if (preRestoreSnapshot.payments.length > 0) {
          const { error: payErr } = await supabaseAdmin.from('payments').upsert(preRestoreSnapshot.payments, { onConflict: 'id' });
          if (payErr) throw new Error(`Falha ao restaurar payments: ${payErr.message}`);
        }
      } catch (rbErr: any) {
        rollbackFailureReason = rbErr?.message || 'Erro durante execução do rollback.';
      }

      if (rollbackFailureReason) {
        return jsonResponse(
          {
            error: `Falha crítica durante a restauração e falha no rollback: não é possível garantir a recuperação integral do estado anterior. Motivo do rollback: ${rollbackFailureReason}. Erro original: ${innerErr?.message || 'Erro inesperado'}`
          },
          500
        );
      }

      return jsonResponse(
        {
          error: `Falha durante a restauração (estado anterior preservado): ${innerErr?.message || 'Erro inesperado'}`
        },
        500
      );
    }
  } catch (err: any) {
    return jsonResponse(
      { error: err?.message || 'Erro interno no servidor ao processar a restauração.' },
      500
    );
  }
};
