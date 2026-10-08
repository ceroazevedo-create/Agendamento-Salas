import { supabase } from './supabase';
import { User } from '../types';
import { format } from 'date-fns';

export type BackupMode = 'full' | 'anonymized';

export interface BackupCounts {
  profiles: number;
  professionals: number;
  clients: number;
  rooms: number;
  bookings: number;
  payments: number;
  blocked_slots: number;
  settings: number;
  audit_logs: number;
}

export interface BackupMetadata {
  system: string;
  backupType?: 'COMPLETO' | 'ANONIMIZADO';
  isAnonymized?: boolean;
  restorable?: boolean;
  description: string;
  schemaVersion: string;
  generatedAt: string;
  generatedBy: {
    id: string;
    email: string;
    name: string;
  };
  totalRecords: number;
  counts: BackupCounts;
}

export interface SystemBackupPayload {
  metadata: BackupMetadata;
  data: {
    profiles: any[];
    professionals: any[];
    clients: any[];
    rooms: any[];
    bookings: any[];
    payments: any[];
    blocked_slots: any[];
    settings: any[];
    audit_logs: any[];
  };
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

export function anonymizeBackupData(rawData: SystemBackupPayload['data']): SystemBackupPayload['data'] {
  const userAliasMap = new Map<string, string>();
  let profIndex = 1;
  let adminIndex = 1;

  const profiles = (rawData.profiles || []).map((row, idx) => {
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

  const professionals = (rawData.professionals || []).map((row, idx) => {
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
  const clients = (rawData.clients || []).map((row, idx) => {
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

  const rooms = (rawData.rooms || []).map(row => sanitizeRecordCredentials(row));

  const bookings = (rawData.bookings || []).map(row => {
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

  const payments = (rawData.payments || []).map(row => {
    const clean = sanitizeRecordCredentials(row);
    return {
      ...clean,
      notes: clean.notes ? '[Observação financeira anonimizada]' : clean.notes
    };
  });

  const blocked_slots = (rawData.blocked_slots || []).map(row => sanitizeRecordCredentials(row));
  const settings = (rawData.settings || []).map(row => sanitizeRecordCredentials(row));

  const audit_logs = (rawData.audit_logs || []).map(row => {
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
 * Fallback seguro de leitura direta via sessão autenticada do administrador no Supabase
 * (utilizado apenas caso a aplicação esteja sendo acessada via hospedagem estática sem Pages Functions, ex: GitHub Pages).
 */
async function generateClientSideAdminBackup(
  adminUser: User,
  mode: BackupMode = 'full'
): Promise<SystemBackupPayload> {
  if (adminUser.role !== 'ADMIN') {
    throw new Error('Permissão negada. Apenas administradores podem gerar backup do sistema.');
  }

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
    supabase.from('profiles').select('*').order('created_at', { ascending: true }),
    supabase.from('professionals').select('*').order('created_at', { ascending: true }),
    supabase.from('clients').select('*').order('created_at', { ascending: true }),
    supabase.from('rooms').select('*').order('id', { ascending: true }),
    supabase.from('bookings').select('*').order('booking_date', { ascending: false }),
    supabase.from('payments').select('*').order('created_at', { ascending: false }),
    supabase.from('blocked_slots').select('*').order('blocked_date', { ascending: false }),
    supabase.from('settings').select('*'),
    supabase.from('audit_logs').select('*').order('timestamp', { ascending: false })
  ]);

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

  const data = mode === 'anonymized' ? anonymizeBackupData(rawData) : rawData;

  const counts: BackupCounts = {
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

  return {
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
        id: adminUser.id,
        email: mode === 'anonymized' ? 'admin@anonimizado.local' : adminUser.email,
        name: mode === 'anonymized' ? 'Administrador Anonimizado' : adminUser.name
      },
      totalRecords,
      counts
    },
    data
  };
}

export const backupService = {
  /**
   * Solicita ao endpoint administrativo (/api/admin/backup?type=...) a geração do backup (somente leitura)
   * no modo 'full' (Backup Completo) ou 'anonymized' (Backup Anonimizado).
   */
  fetchSystemBackup: async (
    adminUser: User,
    mode: BackupMode = 'full'
  ): Promise<SystemBackupPayload> => {
    if (!adminUser || adminUser.role !== 'ADMIN') {
      throw new Error('Permissão negada. Apenas administradores podem realizar backups.');
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    if (!token) {
      throw new Error('Sessão administrativa não encontrada. Faça login novamente.');
    }

    try {
      const response = await fetch(`/api/admin/backup?type=${encodeURIComponent(mode)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      let parsed: any = null;
      try {
        const text = await response.text();
        parsed = JSON.parse(text);
      } catch {
        // Resposta não é JSON (ex: 404 HTML no GitHub Pages)
      }

      if (response.ok && parsed?.metadata && parsed?.data) {
        const payload = parsed as SystemBackupPayload;

        // Garante que se o modo solicitado foi anonimizado, os dados estejam anonimizados mesmo que um servidor antigo responda
        if (mode === 'anonymized' && !payload.metadata.isAnonymized) {
          payload.data = anonymizeBackupData(payload.data);
          payload.metadata.backupType = 'ANONIMIZADO';
          payload.metadata.isAnonymized = true;
          payload.metadata.restorable = false;
          payload.metadata.generatedBy = {
            ...payload.metadata.generatedBy,
            email: 'admin@anonimizado.local',
            name: 'Administrador Anonimizado'
          };
        } else if (mode === 'full') {
          payload.metadata.backupType = 'COMPLETO';
          payload.metadata.isAnonymized = false;
          payload.metadata.restorable = true;
        }

        return payload;
      }

      // Se for 404 (hospedagem puramente estática como GitHub Pages), utiliza fallback autenticado via RLS Admin
      if (response.status === 404 || !parsed) {
        return await generateClientSideAdminBackup(adminUser, mode);
      }

      throw new Error(parsed?.error || `Falha ao gerar backup no servidor (status ${response.status}).`);
    } catch (err: any) {
      if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError')) {
        return await generateClientSideAdminBackup(adminUser, mode);
      }
      throw err;
    }
  },

  /**
   * Faz o download automático do arquivo JSON de backup no computador do administrador.
   * Padrão de nomes:
   * - Completo: locapsico_backup_completo_YYYY-MM-DD_HH-mm-ss.json
   * - Anonimizado: locapsico_backup_anonimizado_YYYY-MM-DD_HH-mm-ss.json
   */
  downloadBackupFile: (backup: SystemBackupPayload, mode: BackupMode = 'full'): string => {
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const isAnon = mode === 'anonymized' || backup.metadata?.isAnonymized === true;
    const prefix = isAnon ? 'locapsico_backup_anonimizado' : 'locapsico_backup_completo';
    const fileName = `${prefix}_${timestamp}.json`;
    const jsonContent = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return fileName;
  }
};
