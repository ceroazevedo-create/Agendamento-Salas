import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';

const PORT = 3000;
const app = express();

app.use(express.json({ limit: '25mb' }));

// Supabase Admin Client (Service Role)
const supabaseUrl = 'https://gqpavuqopukyfeyqyrxc.supabase.co';

function getSupabaseAdmin() {
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (process.env.VITE_SUPABASE_URL?.startsWith('sb_secret_') ? process.env.VITE_SUPABASE_URL : '') ||
    '';

  if (!serviceKey) {
    throw new Error('Chave de serviço SUPABASE_SERVICE_ROLE_KEY não configurada no ambiente do servidor.');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

// API Routes
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * POST /api/admin/reset-password
 * Permite que a administração defina ou redefina diretamente a senha de qualquer profissional no Supabase Auth.
 */
app.post('/api/admin/reset-password', async (req: Request, res: Response) => {
  try {
    const { userId, email, newPassword, adminName } = req.body;

    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      return res.status(400).json({
        error: 'A nova senha deve ter no mínimo 6 caracteres.'
      });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Validar autenticação do administrador via token Bearer (se fornecido)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
      if (callerError || !callerData.user) {
        return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
      }

      // Checa se o usuário que está chamando é admin
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', callerData.user.id)
        .maybeSingle();

      const isAdmin = callerProfile?.role === 'admin' || callerData.user.email === 'admin@admin.com.br';
      if (!isAdmin) {
        return res.status(403).json({ error: 'Permissão negada. Apenas administradores podem alterar senhas.' });
      }
    }

    // 2. Localizar o usuário de destino por ID ou por E-mail
    let targetUserId = userId;
    let targetEmail = email;

    if (!targetUserId && targetEmail) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name')
        .eq('email', targetEmail.trim().toLowerCase())
        .maybeSingle();

      if (profile) {
        targetUserId = profile.id;
      }
    }

    if (!targetUserId) {
      return res.status(400).json({ error: 'Identificador do usuário (userId ou email) não informado.' });
    }

    // Confirma dados do usuário no Supabase Auth
    const { data: authUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
    if (getUserError || !authUser?.user) {
      return res.status(404).json({ error: 'Usuário não localizado no Supabase Auth.' });
    }

    targetEmail = authUser.user.email;

    // 3. Atualizar a senha diretamente no Supabase Auth
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      password: newPassword.trim(),
      email_confirm: true // Garante confirmação de e-mail ativa para login imediato
    });

    if (updateError) {
      console.error('Erro ao atualizar senha no Supabase:', updateError);
      return res.status(500).json({ error: updateError.message || 'Falha ao atualizar senha no Supabase.' });
    }

    // 4. Registrar em audit_logs
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: targetUserId,
        user_name: adminName || 'Administração Geral',
        action: 'Redefinição de Senha',
        details: `Senha do usuário ${targetEmail} foi redefinida com sucesso pelo painel administrativo.`
      });
    } catch (auditErr) {
      console.warn('Aviso: falha ao gravar log de auditoria:', auditErr);
    }

    console.log(`[AUTH] Senha de ${targetEmail} redefinida com sucesso no Supabase.`);
    return res.json({
      success: true,
      message: `Senha de ${targetEmail} redefinida com sucesso!`,
      email: targetEmail
    });
  } catch (err: any) {
    console.error('Erro inesperado na rota /api/admin/reset-password:', err);
    return res.status(500).json({ error: err.message || 'Erro interno no servidor.' });
  }
});

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

function maskFreeTextPII(text: string | null | undefined): string | null {
  if (!text || typeof text !== 'string') return text ?? null;
  return text
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '***@anonimizado.local')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '***.***.***-**')
    .replace(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}\b/g, '(**) *****-****');
}

function anonymizeServerDataset(rawData: {
  profiles: any[];
  professionals: any[];
  clients: any[];
  rooms: any[];
  bookings: any[];
  payments: any[];
  blocked_slots: any[];
  settings: any[];
  audit_logs: any[];
}) {
  const userAliasMap = new Map<string, string>();
  let profIndex = 1;
  let adminIndex = 1;

  const profiles = rawData.profiles.map((row, idx) => {
    const clean = sanitizeRecordCredentials(row);
    const isRowAdmin = String(clean.role || '').toLowerCase() === 'admin';
    const alias = isRowAdmin
      ? `Administrador Anonimizado #${adminIndex++}`
      : `Profissional Anonimizado #${profIndex++}`;

    if (clean.id) {
      userAliasMap.set(String(clean.id), alias);
    }

    const masked: Record<string, any> = {
      ...clean,
      full_name: alias,
      email: isRowAdmin
        ? `admin_${idx + 1}@anonimizado.local`
        : `profissional_${idx + 1}@anonimizado.local`,
      phone: clean.phone ? '(**) *****-****' : clean.phone,
      cpf: clean.cpf ? '***.***.***-**' : clean.cpf
    };

    if ('name' in masked) masked.name = alias;
    if ('whatsapp' in masked && masked.whatsapp) masked.whatsapp = '(**) *****-****';
    if ('crp' in masked && masked.crp) masked.crp = 'CRP-ANONIMIZADO';
    if ('address' in masked && masked.address) masked.address = '[Endereço Anonimizado]';
    if ('bio' in masked && masked.bio) masked.bio = '[Biografia profissional anonimizada]';

    return masked;
  });

  const professionals = rawData.professionals.map((row, idx) => {
    const clean = sanitizeRecordCredentials(row);
    const alias = (clean.id && userAliasMap.get(String(clean.id))) || `Profissional Anonimizado #${idx + 1}`;
    const masked: Record<string, any> = {
      ...clean,
      crp: clean.crp ? 'CRP-ANONIMIZADO' : clean.crp,
      bio: clean.bio ? '[Biografia profissional anonimizada]' : clean.bio
    };

    if ('full_name' in masked) masked.full_name = alias;
    if ('name' in masked) masked.name = alias;
    if ('email' in masked && masked.email) masked.email = `profissional_${idx + 1}@anonimizado.local`;
    if ('phone' in masked && masked.phone) masked.phone = '(**) *****-****';
    if ('whatsapp' in masked && masked.whatsapp) masked.whatsapp = '(**) *****-****';
    if ('cpf' in masked && masked.cpf) masked.cpf = '***.***.***-**';
    if ('address' in masked && masked.address) masked.address = '[Endereço Anonimizado]';

    return masked;
  });

  const clientAliasMap = new Map<string, string>();
  const clients = rawData.clients.map((row, idx) => {
    const clean = sanitizeRecordCredentials(row);
    const alias = `Paciente Anonimizado #${idx + 1}`;
    if (clean.id) {
      clientAliasMap.set(String(clean.id), alias);
    }

    const masked: Record<string, any> = {
      ...clean,
      full_name: alias,
      email: clean.email ? `paciente_${idx + 1}@anonimizado.local` : null,
      phone: clean.phone ? '(**) *****-****' : clean.phone,
      cpf: clean.cpf ? '***.***.***-**' : clean.cpf,
      notes: clean.notes ? '[Anotação clínica/cadastral anonimizada]' : clean.notes
    };

    if ('name' in masked) masked.name = alias;
    if ('whatsapp' in masked && masked.whatsapp) masked.whatsapp = '(**) *****-****';
    if ('address' in masked && masked.address) masked.address = '[Endereço Anonimizado]';
    if ('birth_date' in masked && masked.birth_date) masked.birth_date = '1900-01-01';

    return masked;
  });

  const rooms = rawData.rooms.map(row => sanitizeRecordCredentials(row));

  const bookings = rawData.bookings.map(row => {
    const clean = sanitizeRecordCredentials(row);
    const masked: Record<string, any> = {
      ...clean,
      notes: clean.notes ? '[Observação de agendamento anonimizada]' : clean.notes
    };

    if ('user_name' in masked && masked.user_name) {
      masked.user_name = (clean.professional_id && userAliasMap.get(String(clean.professional_id))) || 'Profissional Anonimizado';
    }
    if ('userName' in masked && masked.userName) {
      masked.userName = (clean.professional_id && userAliasMap.get(String(clean.professional_id))) || 'Profissional Anonimizado';
    }
    if ('client_name' in masked && masked.client_name) {
      masked.client_name = (clean.client_id && clientAliasMap.get(String(clean.client_id))) || 'Paciente Anonimizado';
    }
    if ('clientName' in masked && masked.clientName) {
      masked.clientName = (clean.client_id && clientAliasMap.get(String(clean.client_id))) || 'Paciente Anonimizado';
    }

    return masked;
  });

  const payments = rawData.payments.map(row => {
    const clean = sanitizeRecordCredentials(row);
    return {
      ...clean,
      notes: clean.notes ? '[Observação financeira anonimizada]' : clean.notes
    };
  });

  const blocked_slots = rawData.blocked_slots.map(row => sanitizeRecordCredentials(row));
  const settings = rawData.settings.map(row => sanitizeRecordCredentials(row));

  const audit_logs = rawData.audit_logs.map(row => {
    const clean = sanitizeRecordCredentials(row);
    const alias =
      (clean.user_id && userAliasMap.get(String(clean.user_id))) ||
      'Usuário Anonimizado';
    return {
      ...clean,
      user_name: alias,
      details: maskFreeTextPII(clean.details)
    };
  });

  return {
    profiles,
    professionals,
    clients,
    rooms,
    bookings,
    payments,
    blocked_slots,
    settings,
    audit_logs
  };
}

/**
 * GET / POST /api/admin/backup
 * Exporta cópia em formato JSON de todas as tabelas públicas do sistema (somente leitura)
 * nos modos 'full' (Backup Completo) ou 'anonymized' (Backup Anonimizado).
 */
const handleAdminBackup = async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Não autorizado. Token de autenticação Bearer ausente.' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({ error: 'Não autorizado. Token de autenticação vazio ou malformado.' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', callerData.user.id)
      .maybeSingle();

    const roleNormalized = String(callerProfile?.role || '').toLowerCase();
    const isAdmin =
      roleNormalized === 'admin' ||
      callerData.user.email?.toLowerCase() === 'admin@admin.com.br';

    if (!isAdmin) {
      return res.status(403).json({ error: 'Permissão negada. Apenas administradores podem gerar backup do sistema.' });
    }

    const rawType = String(req.query?.type || req.query?.mode || req.body?.type || req.body?.mode || 'full').toLowerCase().trim();
    const mode: 'full' | 'anonymized' =
      rawType === 'anonymized' || rawType === 'anonimizado' ? 'anonymized' : 'full';

    const [
      profilesRes,
      professionalsRes,
      clientsRes,
      roomsRes,
      bookingsRes,
      paymentsRes,
      blockedSlotsRes,
      settingsRes,
      auditLogsRes
    ] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').order('created_at', { ascending: true }),
      supabaseAdmin.from('professionals').select('*').order('created_at', { ascending: true }),
      supabaseAdmin.from('clients').select('*').order('created_at', { ascending: true }),
      supabaseAdmin.from('rooms').select('*').order('id', { ascending: true }),
      supabaseAdmin.from('bookings').select('*').order('booking_date', { ascending: false }),
      supabaseAdmin.from('payments').select('*').order('created_at', { ascending: false }),
      supabaseAdmin.from('blocked_slots').select('*').order('blocked_date', { ascending: false }),
      supabaseAdmin.from('settings').select('*'),
      supabaseAdmin.from('audit_logs').select('*').order('timestamp', { ascending: false })
    ]);

    const tableErrors = [
      { table: 'profiles', error: profilesRes.error },
      { table: 'professionals', error: professionalsRes.error },
      { table: 'clients', error: clientsRes.error },
      { table: 'rooms', error: roomsRes.error },
      { table: 'bookings', error: bookingsRes.error },
      { table: 'payments', error: paymentsRes.error },
      { table: 'blocked_slots', error: blockedSlotsRes.error },
      { table: 'settings', error: settingsRes.error },
      { table: 'audit_logs', error: auditLogsRes.error }
    ].filter(item => item.error !== null);

    if (tableErrors.length > 0) {
      const firstErr = tableErrors[0];
      return res.status(500).json({
        error: `Falha ao ler a tabela '${firstErr.table}': ${firstErr.error?.message || 'Erro desconhecido'}`
      });
    }

    const rawData = {
      profiles: (profilesRes.data || []).map(sanitizeRecordCredentials),
      professionals: (professionalsRes.data || []).map(sanitizeRecordCredentials),
      clients: (clientsRes.data || []).map(sanitizeRecordCredentials),
      rooms: (roomsRes.data || []).map(sanitizeRecordCredentials),
      bookings: (bookingsRes.data || []).map(sanitizeRecordCredentials),
      payments: (paymentsRes.data || []).map(sanitizeRecordCredentials),
      blocked_slots: (blockedSlotsRes.data || []).map(sanitizeRecordCredentials),
      settings: (settingsRes.data || []).map(sanitizeRecordCredentials),
      audit_logs: (auditLogsRes.data || []).map(sanitizeRecordCredentials)
    };

    const data = mode === 'anonymized' ? anonymizeServerDataset(rawData) : rawData;

    const counts = {
      profiles: data.profiles.length,
      professionals: data.professionals.length,
      clients: data.clients.length,
      rooms: data.rooms.length,
      bookings: data.bookings.length,
      payments: data.payments.length,
      blocked_slots: data.blocked_slots.length,
      settings: data.settings.length,
      audit_logs: data.audit_logs.length
    };

    const totalRecords = Object.values(counts).reduce((acc, c) => acc + c, 0);

    return res.json({
      metadata: {
        system: 'LocaPsico',
        backupType: mode === 'anonymized' ? 'ANONIMIZADO' : 'COMPLETO',
        isAnonymized: mode === 'anonymized',
        restorable: mode === 'full',
        description:
          mode === 'anonymized'
            ? 'Backup ANONIMIZADO do sistema LocaPsico (dados pessoais mascarados para proteção de privacidade/LGPD — NÃO utilizar para restauração de produção)'
            : 'Backup COMPLETO de segurança dos dados do sistema LocaPsico (pronto para restauração integral)',
        schemaVersion: '1.1',
        generatedAt: new Date().toISOString(),
        generatedBy: {
          id: callerData.user.id,
          email:
            mode === 'anonymized'
              ? 'admin@anonimizado.local'
              : callerData.user.email || callerProfile?.email || 'admin@admin.com.br',
          name:
            mode === 'anonymized'
              ? 'Administrador Anonimizado'
              : callerProfile?.full_name || 'Administrador'
        },
        totalRecords,
        counts
      },
      data
    });
  } catch (err: any) {
    console.error('Erro inesperado na rota /api/admin/backup:', err);
    return res.status(500).json({ error: err.message || 'Erro interno ao gerar o backup no servidor.' });
  }
};

app.get('/api/admin/backup', handleAdminBackup);
app.post('/api/admin/backup', handleAdminBackup);

const REQUIRED_BACKUP_TABLES = [
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

function detectServerAnonymizedPayload(backup: any): { isAnonymized: boolean; reason?: string } {
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
        reason: 'Foram detectados dados mascarados/anonimizados nos registros.'
      };
    }
  }

  return { isAnonymized: false };
}

function validateServerFullBackupPayload(backup: any): { valid: boolean; error?: string } {
  if (!backup || typeof backup !== 'object') {
    return { valid: false, error: 'O conteúdo enviado não é um objeto JSON válido.' };
  }

  if (!backup.metadata || typeof backup.metadata !== 'object') {
    return { valid: false, error: 'Arquivo inválido: bloco "metadata" ausente.' };
  }

  if (backup.metadata.system !== 'LocaPsico') {
    return {
      valid: false,
      error: `Arquivo incompatível: o sistema de origem ("${backup.metadata.system || 'desconhecido'}") não é o LocaPsico.`
    };
  }

  const anonCheck = detectServerAnonymizedPayload(backup);
  if (anonCheck.isAnonymized) {
    return {
      valid: false,
      error: `Operação bloqueada: Não é permitido restaurar um Backup Anonimizado. ${anonCheck.reason || ''} Utilize exclusivamente um arquivo de Backup Completo.`
    };
  }

  if (!backup.data || typeof backup.data !== 'object') {
    return { valid: false, error: 'Arquivo inválido: bloco "data" ausente.' };
  }

  for (const table of REQUIRED_BACKUP_TABLES) {
    if (!Array.isArray(backup.data[table])) {
      return {
        valid: false,
        error: `Estrutura de backup incompleta: a tabela "${table}" está ausente ou não é uma lista válida.`
      };
    }
  }

  return { valid: true };
}

/**
 * POST /api/admin/restore
 * Restaura com segurança um Backup Completo do LocaPsico preservando a conta do Administrador.
 */
app.post('/api/admin/restore', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Não autorizado. Token de autenticação Bearer ausente.' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return res.status(401).json({ error: 'Não autorizado. Token de autenticação vazio ou malformado.' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
    }

    const callerAdminId = callerData.user.id;
    const callerAdminEmail = (callerData.user.email || 'admin@admin.com.br').trim().toLowerCase();

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', callerAdminId)
      .maybeSingle();

    const roleNormalized = String(callerProfile?.role || '').toLowerCase();
    const isAdmin =
      roleNormalized === 'admin' ||
      callerAdminEmail === 'admin@admin.com.br';

    if (!isAdmin) {
      return res.status(403).json({ error: 'Permissão negada. Apenas administradores podem restaurar backups do sistema.' });
    }

    const { backup: backupPayload, confirmationWord } = req.body || {};

    if (String(confirmationWord || '').trim().toUpperCase() !== 'RESTAURAR') {
      return res.status(400).json({ error: 'Palavra de confirmação inválida. Digite exatamente RESTAURAR para confirmar.' });
    }

    const validation = validateServerFullBackupPayload(backupPayload);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error || 'Arquivo de backup inválido para restauração.' });
    }

    // Snapshot em memória pré-restauração para rollback automático em caso de erro
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

    try {
      const { data: authListRes } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000
      });
      const existingAuthUsers = authListRes?.users || [];
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

        if (authUsersById.has(String(p.id))) {
          profileIdMap.set(String(p.id), String(p.id));
          profilesToUpsertMap.set(String(p.id), {
            ...p,
            role: 'professional',
            status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
          });
        } else if (pEmail && authUsersByEmail.has(pEmail)) {
          const matchedAuth = authUsersByEmail.get(pEmail);
          profileIdMap.set(String(p.id), String(matchedAuth.id));
          profilesToUpsertMap.set(String(matchedAuth.id), {
            ...p,
            id: String(matchedAuth.id),
            role: 'professional',
            status: p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
          });
        } else if (pEmail) {
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

          if (!createAuthErr && createdAuth?.user) {
            const finalId = String(createdAuth.user.id);
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
      }

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

      const blockedSlotsToUpsert = rawBlockedSlots.filter((blk: any) => blk && blk.id);
      const settingsToUpsert = rawSettings.filter((s: any) => s && s.id);
      const auditLogsToUpsert = rawAuditLogs
        .filter((log: any) => log && log.id)
        .map((log: any) => ({
          ...log,
          user_id: resolveProfileId(log.user_id)
        }));

      // Limpeza ordenada (filhas -> mães)
      await supabaseAdmin.from('payments').delete().not('id', 'is', null);
      await supabaseAdmin.from('bookings').delete().not('id', 'is', null);
      await supabaseAdmin.from('blocked_slots').delete().not('id', 'is', null);
      await supabaseAdmin.from('clients').delete().not('id', 'is', null);
      await supabaseAdmin.from('audit_logs').delete().not('id', 'is', null);
      await supabaseAdmin.from('professionals').delete().not('id', 'is', null);

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

      // 1. settings
      if (settingsToUpsert.length > 0) {
        const { error: settingsErr } = await supabaseAdmin
          .from('settings')
          .upsert(settingsToUpsert, { onConflict: 'id' });
        if (settingsErr) throw new Error(`Erro ao restaurar 'settings': ${settingsErr.message}`);
      }

      // 2. rooms
      for (const r of roomsToUpsert) {
        const { error: rErr } = await supabaseAdmin.from('rooms').upsert(r, { onConflict: 'id' });
        if (rErr) {
          const fallbackRoom = { ...r };
          delete fallbackRoom.morning_rate;
          delete fallbackRoom.afternoon_rate;
          delete fallbackRoom.night_rate;
          await supabaseAdmin.from('rooms').upsert(fallbackRoom, { onConflict: 'id' });
        }
      }

      // 3. profiles
      const profilesArray = Array.from(profilesToUpsertMap.values());
      if (profilesArray.length > 0) {
        const { error: profilesErr } = await supabaseAdmin
          .from('profiles')
          .upsert(profilesArray, { onConflict: 'id' });
        if (profilesErr) throw new Error(`Erro ao restaurar 'profiles': ${profilesErr.message}`);
      }

      // 4. professionals
      const professionalsArray = Array.from(professionalsByUserId.values());
      if (professionalsArray.length > 0) {
        const { error: profsErr } = await supabaseAdmin
          .from('professionals')
          .upsert(professionalsArray, { onConflict: 'user_id' });
        if (profsErr) throw new Error(`Erro ao restaurar 'professionals': ${profsErr.message}`);
      }

      // 5. clients
      if (clientsToUpsert.length > 0) {
        const { error: clientsErr } = await supabaseAdmin
          .from('clients')
          .upsert(clientsToUpsert, { onConflict: 'id' });
        if (clientsErr) throw new Error(`Erro ao restaurar 'clients': ${clientsErr.message}`);
      }

      // 6. bookings (antes de blocked_slots)
      let restoredBookingsCount = 0;
      if (bookingsToUpsert.length > 0) {
        const { error: batchBookErr } = await supabaseAdmin
          .from('bookings')
          .upsert(bookingsToUpsert, { onConflict: 'id' });

        if (!batchBookErr) {
          restoredBookingsCount = bookingsToUpsert.length;
        } else {
          for (const row of bookingsToUpsert) {
            const { error: rowErr } = await supabaseAdmin.from('bookings').upsert(row, { onConflict: 'id' });
            if (!rowErr) {
              restoredBookingsCount++;
            } else {
              const fallbackRow = { ...row };
              delete fallbackRow.period_shift;
              delete fallbackRow.period_name;
              const { error: fbErr } = await supabaseAdmin.from('bookings').upsert(fallbackRow, { onConflict: 'id' });
              if (!fbErr) restoredBookingsCount++;
            }
          }
        }
      }

      // 7. blocked_slots
      if (blockedSlotsToUpsert.length > 0) {
        const { error: blocksErr } = await supabaseAdmin
          .from('blocked_slots')
          .upsert(blockedSlotsToUpsert, { onConflict: 'id' });
        if (blocksErr) throw new Error(`Erro ao restaurar 'blocked_slots': ${blocksErr.message}`);
      }

      // 8. payments
      if (paymentsToUpsert.length > 0) {
        const { error: paymentsErr } = await supabaseAdmin
          .from('payments')
          .upsert(paymentsToUpsert, { onConflict: 'id' });
        if (paymentsErr) throw new Error(`Erro ao restaurar 'payments': ${paymentsErr.message}`);
      }

      // 9. audit_logs + log da restauração
      if (auditLogsToUpsert.length > 0) {
        await supabaseAdmin.from('audit_logs').upsert(auditLogsToUpsert, { onConflict: 'id' });
      }

      await supabaseAdmin.from('audit_logs').insert({
        user_id: callerAdminId,
        user_name: callerProfile?.full_name || 'Administrador',
        action: 'Restauração de Backup Completo',
        details: `Backup Completo (gerado em ${backupPayload.metadata.generatedAt || 'data não informada'}) restaurado com sucesso pelo administrador.`,
        timestamp: new Date().toISOString()
      });

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

      return res.json({
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
      try {
        if (preRestoreSnapshot.settings.length > 0) {
          await supabaseAdmin.from('settings').upsert(preRestoreSnapshot.settings, { onConflict: 'id' });
        }
        if (preRestoreSnapshot.rooms.length > 0) {
          await supabaseAdmin.from('rooms').upsert(preRestoreSnapshot.rooms, { onConflict: 'id' });
        }
        if (preRestoreSnapshot.profiles.length > 0) {
          await supabaseAdmin.from('profiles').upsert(preRestoreSnapshot.profiles, { onConflict: 'id' });
        }
        if (preRestoreSnapshot.professionals.length > 0) {
          await supabaseAdmin.from('professionals').upsert(preRestoreSnapshot.professionals, { onConflict: 'user_id' });
        }
        if (preRestoreSnapshot.clients.length > 0) {
          await supabaseAdmin.from('clients').upsert(preRestoreSnapshot.clients, { onConflict: 'id' });
        }
        if (preRestoreSnapshot.bookings.length > 0) {
          await supabaseAdmin.from('bookings').upsert(preRestoreSnapshot.bookings, { onConflict: 'id' });
        }
        if (preRestoreSnapshot.blocked_slots.length > 0) {
          await supabaseAdmin.from('blocked_slots').upsert(preRestoreSnapshot.blocked_slots, { onConflict: 'id' });
        }
        if (preRestoreSnapshot.payments.length > 0) {
          await supabaseAdmin.from('payments').upsert(preRestoreSnapshot.payments, { onConflict: 'id' });
        }
      } catch {}

      return res.status(500).json({
        error: `Falha durante a restauração (estado anterior preservado): ${innerErr?.message || 'Erro inesperado'}`
      });
    }
  } catch (err: any) {
    console.error('Erro inesperado na rota /api/admin/restore:', err);
    return res.status(500).json({ error: err.message || 'Erro interno no servidor ao processar a restauração.' });
  }
});

// Start Server & Vite Middleware Setup
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LocaPsico Server running at http://0.0.0.0:${PORT}`);
  });
}

start();
