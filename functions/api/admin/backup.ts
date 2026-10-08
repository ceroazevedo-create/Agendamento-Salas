import { createClient } from '@supabase/supabase-js';

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

export type BackupMode = 'full' | 'anonymized';

const DEFAULT_SUPABASE_URL = 'https://gqpavuqopukyfeyqyrxc.supabase.co';

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

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function getSupabaseAdmin(env: Env) {
  const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

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

/**
 * Remove qualquer campo de senha, token, secret ou credencial caso exista em algum registro,
 * mantendo 100% intactos todos os dados reais necessários para restauração no Backup Completo.
 */
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
    // Mascara e-mails presentes em textos livres / logs
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '***@anonimizado.local')
    // Mascara CPFs formatados ou de 11 dígitos em textos
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '***.***.***-**')
    // Mascara telefones em textos
    .replace(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}-?\d{4}\b/g, '(**) *****-****');
}

function anonymizeDataset(rawData: {
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

async function resolveBackupMode(request: Request): Promise<BackupMode> {
  const url = new URL(request.url);
  const queryType = (url.searchParams.get('type') || url.searchParams.get('mode') || '').toLowerCase().trim();

  if (queryType === 'anonymized' || queryType === 'anonimizado') {
    return 'anonymized';
  }
  if (queryType === 'full' || queryType === 'completo') {
    return 'full';
  }

  if (request.method === 'POST') {
    try {
      const cloned = request.clone();
      const body = (await cloned.json()) as Record<string, unknown>;
      const bodyType = String(body?.type || body?.mode || '').toLowerCase().trim();
      if (bodyType === 'anonymized' || bodyType === 'anonimizado') {
        return 'anonymized';
      }
    } catch {
      // Corpo vazio ou não-JSON, segue padrão 'full'
    }
  }

  return 'full';
}

async function handleBackupRequest(context: PagesFunctionContext<Env>): Promise<Response> {
  try {
    const { request, env } = context;

    // 1. Verificar obrigatoriamente a presença do header Authorization: Bearer <token>
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse(
        { error: 'Não autorizado. Token de autenticação Bearer ausente.' },
        401
      );
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return jsonResponse(
        { error: 'Não autorizado. Token de autenticação vazio ou malformado.' },
        401
      );
    }

    const supabaseAdmin = getSupabaseAdmin(env);

    // 2. Validar o token no Supabase e identificar o usuário autenticado
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return jsonResponse(
        { error: 'Sessão administrativa inválida ou expirada.' },
        401
      );
    }

    // 3. Verificar se o usuário autenticado possui autorização administrativa (role = 'admin')
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
      return jsonResponse(
        { error: 'Permissão negada. Apenas administradores podem gerar backup do sistema.' },
        403
      );
    }

    const mode = await resolveBackupMode(request);

    // 4. Consultar (SOMENTE LEITURA) todas as tabelas utilizadas pelo aplicativo
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
      return jsonResponse(
        {
          error: `Falha ao ler a tabela '${firstErr.table}': ${firstErr.error?.message || 'Erro desconhecido'}`
        },
        500
      );
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

    const data = mode === 'anonymized' ? anonymizeDataset(rawData) : rawData;

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

    const backupPayload = {
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
    };

    return jsonResponse(backupPayload, 200);
  } catch (err: any) {
    return jsonResponse(
      { error: err?.message || 'Erro interno ao gerar o backup no servidor.' },
      500
    );
  }
}

/**
 * GET /api/admin/backup & POST /api/admin/backup (Cloudflare Pages Function)
 * Exporta cópia em formato JSON de todas as tabelas públicas do sistema (somente leitura)
 * nos modos 'full' (Backup Completo) ou 'anonymized' (Backup Anonimizado).
 */
export const onRequestGet = handleBackupRequest;
export const onRequestPost = handleBackupRequest;
