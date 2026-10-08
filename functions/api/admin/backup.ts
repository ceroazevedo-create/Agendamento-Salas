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

const DEFAULT_SUPABASE_URL = 'https://gqpavuqopukyfeyqyrxc.supabase.co';

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

    const data = {
      profiles: profilesRes.data || [],
      professionals: professionalsRes.data || [],
      clients: clientsRes.data || [],
      rooms: roomsRes.data || [],
      bookings: bookingsRes.data || [],
      payments: paymentsRes.data || [],
      blocked_slots: blockedSlotsRes.data || [],
      settings: settingsRes.data || [],
      audit_logs: auditLogsRes.data || []
    };

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
        description: 'Backup completo de segurança dos dados do sistema LocaPsico',
        schemaVersion: '1.0',
        generatedAt: new Date().toISOString(),
        generatedBy: {
          id: callerData.user.id,
          email: callerData.user.email || callerProfile?.email || 'admin@admin.com.br',
          name: callerProfile?.full_name || 'Administrador'
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
 * Exporta cópia completa em formato JSON de todas as tabelas públicas do sistema (somente leitura).
 */
export const onRequestGet = handleBackupRequest;
export const onRequestPost = handleBackupRequest;
