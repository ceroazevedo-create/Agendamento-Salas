import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';

const PORT = 3000;
const app = express();

app.use(express.json());

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
