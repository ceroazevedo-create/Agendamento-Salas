import { supabase } from './supabase';
import { User, Client, Booking, BlockedSlot, AuditLog, RoomId, PaymentStatus, BookingType } from '../types';
import { format } from 'date-fns';
import {
  saveStoredClients,
  saveStoredBookings,
  saveStoredBlockedSlots,
  saveStoredAuditLogs,
  getSystemConfig,
  saveSystemConfig,
  addAuditLog
} from './storageService';

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

export interface BackupValidationResult {
  valid: boolean;
  isAnonymizedDetected?: boolean;
  error?: string;
  fileName?: string;
  payload?: SystemBackupPayload;
  summary?: {
    system: string;
    schemaVersion: string;
    backupType: 'COMPLETO';
    generatedAt: string;
    generatedByName: string;
    generatedByEmail: string;
    totalRecords: number;
    counts: BackupCounts;
  };
}

export interface RestoreExecutionResult {
  success: boolean;
  message: string;
  restoredAt: string;
  totalRestored: number;
  counts: BackupCounts;
  safetyBackupFileName?: string;
}

const REQUIRED_TABLES: Array<keyof SystemBackupPayload['data']> = [
  'profiles',
  'professionals',
  'clients',
  'rooms',
  'bookings',
  'payments',
  'blocked_slots',
  'settings',
  'audit_logs'
];

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
      masked.client_name = (clean.client_id && clientAliasMap.get(String(client_id_safe(clean)))) || 'Paciente Anonimizado';
    }
    if ('clientName' in masked && masked.clientName) {
      masked.clientName = (clean.client_id && clientAliasMap.get(String(client_id_safe(clean)))) || 'Paciente Anonimizado';
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

function client_id_safe(clean: Record<string, any>): string {
  return String(clean.client_id || '');
}

/**
 * Sincroniza o cache local (localStorage) após uma restauração bem-sucedida
 * para que a interface reflita imediatamente os registros restaurados.
 */
function syncLocalStorageFromBackupData(data: SystemBackupPayload['data']) {
  try {
    const profilesMap = new Map<string, any>();
    for (const p of data.profiles || []) {
      if (p?.id) profilesMap.set(String(p.id), p);
    }

    const clientsMap = new Map<string, any>();
    const mappedClients: Client[] = (data.clients || []).map((c: any) => {
      clientsMap.set(String(c.id), c);
      return {
        id: String(c.id),
        professionalId: String(c.professional_id || ''),
        name: String(c.full_name || c.name || 'Paciente'),
        cpf: c.cpf || '',
        birthDate: c.birth_date || undefined,
        phone: c.phone || '',
        whatsapp: c.whatsapp || c.phone || '',
        email: c.email || '',
        address: c.address || '',
        notes: c.notes || '',
        createdAt: c.created_at || new Date().toISOString(),
        status: (c.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as 'ACTIVE' | 'INACTIVE'
      };
    });
    saveStoredClients(mappedClients);

    const mappedBookings: Booking[] = (data.bookings || []).map((b: any) => {
      const prof = profilesMap.get(String(b.professional_id || ''));
      const cli = b.client_id ? clientsMap.get(String(b.client_id)) : null;
      const startHour = Number(b.start_time ?? b.hour ?? 7);
      const endHour = Number(b.end_time ?? b.end_time_hour ?? startHour + 1);
      const duration = Number(b.total_hours ?? b.duration_hours ?? Math.max(1, endHour - startHour));
      const roomId: RoomId =
        String(b.room_id || '').trim().toLowerCase() === 'sala 2' ? 'Sala 2' : 'Sala 1';
      const rawType = String(b.booking_type || b.type || 'HOURLY').toUpperCase();
      const type: BookingType = rawType === 'PERIOD' || duration >= 4 ? 'PERIOD' : 'HOURLY';
      const paymentStatus: PaymentStatus = (b.payment_status ||
        (b.status === 'cancelled' ? 'CANCELLED' : 'PENDING')) as PaymentStatus;

      return {
        id: String(b.id),
        userId: String(b.professional_id || ''),
        userEmail: prof?.email || '',
        userName: prof?.full_name || 'Profissional',
        clientId: b.client_id ? String(b.client_id) : undefined,
        clientName: cli?.full_name || undefined,
        roomId,
        date: String(b.booking_date || b.date || '').split('T')[0],
        hour: startHour,
        durationHours: duration,
        endTimeHour: endHour,
        type,
        periodShift: b.period_shift || undefined,
        periodName: b.period_name || undefined,
        priceAtBooking: Number(b.hourly_rate ?? 40),
        totalAmount: Number(b.total_amount ?? 40),
        paymentStatus,
        createdAt: b.created_at || new Date().toISOString(),
        notes: b.notes || undefined,
        paidAt: b.paid_at || undefined,
        paidNotes: b.paid_notes || undefined,
        paidByAdmin: b.paid_by_admin || undefined
      };
    });
    saveStoredBookings(mappedBookings);

    const mappedBlocks: BlockedSlot[] = (data.blocked_slots || []).map((blk: any) => ({
      id: String(blk.id),
      roomId: (blk.room_id || 'ALL') as RoomId | 'ALL',
      date: String(blk.blocked_date || '').split('T')[0],
      startHour: Number(blk.start_time ?? 7),
      endHour: Number(blk.end_time ?? 22),
      reason: String(blk.reason || 'Bloqueio Administrativo'),
      createdAt: blk.created_at || new Date().toISOString(),
      createdBy: String(blk.created_by || 'Administração')
    }));
    saveStoredBlockedSlots(mappedBlocks);

    const mappedLogs: AuditLog[] = (data.audit_logs || []).map((log: any) => ({
      id: String(log.id || 'aud-' + Date.now()),
      userId: String(log.user_id || ''),
      userName: String(log.user_name || 'Administrador'),
      action: String(log.action || 'Ação'),
      details: String(log.details || ''),
      timestamp: log.timestamp || new Date().toISOString()
    }));
    saveStoredAuditLogs(mappedLogs);

    const currentConfig = getSystemConfig();
    if (Array.isArray(data.settings) && data.settings.length > 0) {
      const s = data.settings[0];
      currentConfig.openHour = Number(s.open_hour ?? currentConfig.openHour ?? 7);
      currentConfig.closeHour = Number(s.close_hour ?? currentConfig.closeHour ?? 22);
      currentConfig.cancellationLimitHours = Number(
        s.cancellation_limit_hours ?? currentConfig.cancellationLimitHours ?? 24
      );
      if (typeof s.allow_holidays_global === 'boolean') {
        currentConfig.allowHolidaysGlobal = s.allow_holidays_global;
      }
      if (Array.isArray(s.unblocked_holidays)) {
        currentConfig.unblocked_holidays = s.unblocked_holidays;
      }
    }
    if (Array.isArray(data.rooms) && data.rooms.length > 0) {
      currentConfig.rooms = data.rooms.map((r: any) => ({
        id: (String(r.id) === 'Sala 2' ? 'Sala 2' : 'Sala 1') as RoomId,
        name: String(r.name || r.id || 'Sala'),
        description: String(r.description || ''),
        hourlyRate: Number(r.hourly_rate ?? 40),
        dailyRate: Number(r.period_rate ?? 350),
        morningRate: Number(r.morning_rate ?? 150),
        afternoonRate: Number(r.afternoon_rate ?? 180),
        nightRate: Number(r.night_rate ?? 130),
        status: (r.status === 'MAINTENANCE' ? 'MAINTENANCE' : 'ACTIVE') as 'ACTIVE' | 'MAINTENANCE',
        openHour: Number(r.opening_time ?? 7),
        closeHour: Number(r.closing_time ?? 22),
        notes: r.notes || undefined
      }));
    }
    saveSystemConfig(currentConfig);
  } catch (e) {
    console.warn('Aviso ao atualizar cache local após restauração:', e);
  }
}

/**
 * Fallback seguro de leitura direta via sessão autenticada do administrador no Supabase
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

/**
 * Fallback seguro de restauração via cliente Supabase autenticado como Administrador
 * (utilizado somente em ambientes puramente estáticos onde /api/admin/restore retorna 404).
 */
async function executeClientSideAdminRestore(
  adminUser: User,
  backupPayload: SystemBackupPayload
): Promise<RestoreExecutionResult> {
  if (!adminUser || adminUser.role !== 'ADMIN') {
    throw new Error('Permissão negada. Apenas administradores podem restaurar o sistema.');
  }

  const d = backupPayload.data;

  // 1. Limpeza das tabelas operacionais na ordem filha -> mãe (preservando profiles/admin)
  await supabase.from('payments').delete().not('id', 'is', null);
  await supabase.from('bookings').delete().not('id', 'is', null);
  await supabase.from('blocked_slots').delete().not('id', 'is', null);
  await supabase.from('clients').delete().not('id', 'is', null);

  // 2. Restaurar settings
  if (d.settings?.length > 0) {
    await supabase.from('settings').upsert(d.settings.map(sanitizeRecordCredentials), { onConflict: 'id' });
  }

  // 3. Restaurar rooms
  if (d.rooms?.length > 0) {
    for (const r of d.rooms.map(sanitizeRecordCredentials)) {
      const { error } = await supabase.from('rooms').upsert(r, { onConflict: 'id' });
      if (error) {
        const fb = { ...r };
        delete fb.morning_rate;
        delete fb.afternoon_rate;
        delete fb.night_rate;
        await supabase.from('rooms').upsert(fb, { onConflict: 'id' });
      }
    }
  }

  // 4. Restaurar profiles existentes (garantindo que o admin atual continue ativo e admin)
  const { data: existingProfiles } = await supabase.from('profiles').select('id, email, role');
  const existingProfileIds = new Set((existingProfiles || []).map((p: any) => String(p.id)));

  const validProfilesToUpsert = (d.profiles || [])
    .map(sanitizeRecordCredentials)
    .filter((p: any) => p?.id && existingProfileIds.has(String(p.id)))
    .map((p: any) => {
      if (String(p.id) === adminUser.id || String(p.role).toLowerCase() === 'admin') {
        return { ...p, role: 'admin', status: 'ACTIVE' };
      }
      return p;
    });

  if (validProfilesToUpsert.length > 0) {
    await supabase.from('profiles').upsert(validProfilesToUpsert, { onConflict: 'id' });
  }

  // 5. Restaurar professionals vinculados
  const validProfRows = (d.professionals || [])
    .map(sanitizeRecordCredentials)
    .filter((prof: any) => prof?.user_id && existingProfileIds.has(String(prof.user_id)));

  if (validProfRows.length > 0) {
    await supabase.from('professionals').upsert(validProfRows, { onConflict: 'user_id' });
  }

  // 6. Restaurar clients
  const clientsToRestore = (d.clients || [])
    .map(sanitizeRecordCredentials)
    .map((c: any) => ({
      ...c,
      professional_id: existingProfileIds.has(String(c.professional_id)) ? c.professional_id : adminUser.id
    }));

  if (clientsToRestore.length > 0) {
    await supabase.from('clients').upsert(clientsToRestore, { onConflict: 'id' });
  }

  // 7. Restaurar bookings (antes de blocked_slots)
  const validClientIds = new Set(clientsToRestore.map((c: any) => String(c.id)));
  const bookingsToRestore = (d.bookings || [])
    .map(sanitizeRecordCredentials)
    .map((b: any) => ({
      ...b,
      professional_id: existingProfileIds.has(String(b.professional_id)) ? b.professional_id : adminUser.id,
      client_id: b.client_id && validClientIds.has(String(b.client_id)) ? b.client_id : null
    }));

  if (bookingsToRestore.length > 0) {
    const { error: bErr } = await supabase.from('bookings').upsert(bookingsToRestore, { onConflict: 'id' });
    if (bErr) {
      for (const row of bookingsToRestore) {
        const fb = { ...row };
        delete fb.period_shift;
        delete fb.period_name;
        await supabase.from('bookings').upsert(fb, { onConflict: 'id' });
      }
    }
  }

  // 8. Restaurar blocked_slots
  if (d.blocked_slots?.length > 0) {
    await supabase.from('blocked_slots').upsert(d.blocked_slots.map(sanitizeRecordCredentials), { onConflict: 'id' });
  }

  // 9. Restaurar payments
  const validBookingIds = new Set(bookingsToRestore.map((b: any) => String(b.id)));
  const paymentsToRestore = (d.payments || [])
    .map(sanitizeRecordCredentials)
    .map((pay: any) => ({
      ...pay,
      professional_id: existingProfileIds.has(String(pay.professional_id)) ? pay.professional_id : adminUser.id,
      booking_id: pay.booking_id && validBookingIds.has(String(pay.booking_id)) ? pay.booking_id : null
    }));

  if (paymentsToRestore.length > 0) {
    await supabase.from('payments').upsert(paymentsToRestore, { onConflict: 'id' });
  }

  // 10. Registrar auditoria
  await supabase.from('audit_logs').insert({
    user_id: adminUser.id,
    user_name: adminUser.name,
    action: 'Restauração de Backup Completo',
    details: `Backup Completo (gerado em ${backupPayload.metadata.generatedAt}) restaurado pelo administrador.`
  });

  syncLocalStorageFromBackupData(d);
  addAuditLog(
    adminUser.id,
    adminUser.name,
    'Restauração de Backup Completo',
    `Backup Completo (gerado em ${backupPayload.metadata.generatedAt}) restaurado com sucesso.`
  );

  const counts: BackupCounts = {
    profiles: validProfilesToUpsert.length || d.profiles.length,
    professionals: validProfRows.length || d.professionals.length,
    clients: clientsToRestore.length,
    rooms: d.rooms.length,
    bookings: bookingsToRestore.length,
    payments: paymentsToRestore.length,
    blocked_slots: d.blocked_slots.length,
    settings: d.settings.length,
    audit_logs: d.audit_logs.length + 1
  };

  return {
    success: true,
    message: 'Backup Completo restaurado com sucesso!',
    restoredAt: new Date().toISOString(),
    totalRestored: Object.values(counts).reduce((a, b) => a + b, 0),
    counts
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
  },

  /**
   * Faz o download automático de um Backup Completo de Segurança Pré-Restauração.
   */
  downloadPreRestoreSafetyBackup: (backup: SystemBackupPayload): string => {
    const timestamp = format(new Date(), 'yyyy-MM-dd_HH-mm-ss');
    const fileName = `locapsico_backup_pre_restauracao_${timestamp}.json`;
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
  },

  /**
   * Valida um arquivo JSON selecionado pelo administrador antes de permitir a restauração.
   * Garante que SOMENTE arquivos de BACKUP COMPLETO gerados pelo LocaPsico sejam aceitos,
   * bloqueando qualquer tentativa de restaurar um Backup Anonimizado ou arquivo inválido.
   */
  validateBackupFileContent: (rawJsonText: string, fileName?: string): BackupValidationResult => {
    if (!rawJsonText || !rawJsonText.trim()) {
      return {
        valid: false,
        fileName,
        error: 'O arquivo selecionado está vazio.'
      };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawJsonText);
    } catch {
      return {
        valid: false,
        fileName,
        error: 'O arquivo selecionado não possui um formato JSON válido.'
      };
    }

    if (!parsed || typeof parsed !== 'object') {
      return {
        valid: false,
        fileName,
        error: 'Estrutura JSON inválida.'
      };
    }

    const meta = parsed.metadata;
    if (!meta || typeof meta !== 'object') {
      return {
        valid: false,
        fileName,
        error: 'Arquivo inválido: metadados do LocaPsico ("metadata") não encontrados.'
      };
    }

    if (meta.system !== 'LocaPsico') {
      return {
        valid: false,
        fileName,
        error: `Arquivo incompatível: sistema de origem "${meta.system || 'desconhecido'}". Apenas backups gerados pelo LocaPsico são aceitos.`
      };
    }

    // Bloqueio estrito de Backup Anonimizado (por metadados, nome de arquivo ou inspeção dos registros)
    const isMetaAnonymized =
      String(meta.backupType || '').toUpperCase() === 'ANONIMIZADO' ||
      meta.isAnonymized === true ||
      meta.restorable === false ||
      String(meta.description || '').toUpperCase().includes('ANONIMIZADO') ||
      String(meta.generatedBy?.email || '').endsWith('@anonimizado.local');

    const isFileNameAnonymized = Boolean(
      fileName && fileName.toLowerCase().includes('anonimizado')
    );

    const data = parsed.data;
    if (!data || typeof data !== 'object') {
      return {
        valid: false,
        fileName,
        error: 'Arquivo inválido: bloco de dados ("data") não encontrado.'
      };
    }

    let hasMaskedRecords = false;
    const sampleRows = [
      ...(Array.isArray(data.profiles) ? data.profiles : []),
      ...(Array.isArray(data.professionals) ? data.professionals : []),
      ...(Array.isArray(data.clients) ? data.clients : [])
    ];

    for (const row of sampleRows) {
      if (!row || typeof row !== 'object') continue;
      const email = String(row.email || '').toLowerCase();
      const cpf = String(row.cpf || '');
      const phone = String(row.phone || '');
      const name = String(row.full_name || row.name || '');

      if (
        email.endsWith('@anonimizado.local') ||
        cpf === '***.***.***-**' ||
        phone === '(**) *****-****' ||
        name.includes('Anonimizado #') ||
        String(row.crp || '') === 'CRP-ANONIMIZADO'
      ) {
        hasMaskedRecords = true;
        break;
      }
    }

    if (isMetaAnonymized || isFileNameAnonymized || hasMaskedRecords) {
      return {
        valid: false,
        isAnonymizedDetected: true,
        fileName,
        error:
          'RESTAURAÇÃO BLOQUEADA: Este arquivo é um BACKUP ANONIMIZADO (LGPD) com dados mascarados. ' +
          'Restaurá-lo sobrescreveria nomes, CPFs, telefones e e-mails reais por máscaras. ' +
          'Selecione exclusivamente um arquivo de BACKUP COMPLETO (locapsico_backup_completo_...).'
      };
    }

    for (const table of REQUIRED_TABLES) {
      if (!Array.isArray(data[table])) {
        return {
          valid: false,
          fileName,
          error: `Arquivo de backup incompleto: a tabela obrigatória "${table}" não foi encontrada no arquivo.`
        };
      }
    }

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
      valid: true,
      fileName,
      payload: parsed as SystemBackupPayload,
      summary: {
        system: String(meta.system),
        schemaVersion: String(meta.schemaVersion || '1.0'),
        backupType: 'COMPLETO',
        generatedAt: String(meta.generatedAt || ''),
        generatedByName: String(meta.generatedBy?.name || 'Administrador'),
        generatedByEmail: String(meta.generatedBy?.email || 'admin@admin.com.br'),
        totalRecords,
        counts
      }
    };
  },

  /**
   * Executa a restauração segura de um Backup Completo validado.
   * Opcionalmente gera e baixa antes uma cópia de segurança pré-restauração do estado atual.
   */
  restoreSystemBackup: async (
    adminUser: User,
    backupPayload: SystemBackupPayload,
    confirmationWord: string,
    autoDownloadSafetyBackup = true
  ): Promise<RestoreExecutionResult> => {
    if (!adminUser || adminUser.role !== 'ADMIN') {
      throw new Error('Permissão negada. Apenas administradores podem restaurar backups do sistema.');
    }

    if (String(confirmationWord || '').trim().toUpperCase() !== 'RESTAURAR') {
      throw new Error('Digite exatamente a palavra RESTAURAR para confirmar a operação.');
    }

    // Revalidar que o payload é um Backup Completo legítimo
    const check = backupService.validateBackupFileContent(JSON.stringify(backupPayload));
    if (!check.valid) {
      throw new Error(check.error || 'Arquivo de backup inválido para restauração.');
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    if (!token) {
      throw new Error('Sessão administrativa expirada ou não encontrada. Faça login novamente.');
    }

    // 1. Gerar e baixar automaticamente um Backup Completo de Segurança Pré-Restauração antes de alterar os dados
    let safetyBackupFileName: string | undefined;
    if (autoDownloadSafetyBackup) {
      try {
        const currentSnapshot = await backupService.fetchSystemBackup(adminUser, 'full');
        safetyBackupFileName = backupService.downloadPreRestoreSafetyBackup(currentSnapshot);
      } catch (preErr) {
        console.warn('Aviso ao gerar backup automático pré-restauração:', preErr);
      }
    }

    // 2. Enviar para o endpoint seguro de restauração (/api/admin/restore)
    try {
      const response = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          backup: backupPayload,
          confirmationWord: 'RESTAURAR'
        })
      });

      let parsed: any = null;
      try {
        const text = await response.text();
        parsed = JSON.parse(text);
      } catch {
        // Resposta não é JSON (ex: 404 em hospedagem puramente estática)
      }

      if (response.ok && parsed?.success) {
        // Sincronizar o cache local com os dados restaurados para atualização imediata da UI
        syncLocalStorageFromBackupData(backupPayload.data);
        addAuditLog(
          adminUser.id,
          adminUser.name,
          'Restauração de Backup Completo',
          `Backup Completo restaurado com sucesso (${parsed.totalRestored || 0} registros processados).`
        );

        return {
          success: true,
          message: parsed.message || 'Backup Completo restaurado com sucesso!',
          restoredAt: parsed.restoredAt || new Date().toISOString(),
          totalRestored: parsed.totalRestored || check.summary?.totalRecords || 0,
          counts: parsed.counts || check.summary!.counts,
          safetyBackupFileName
        };
      }

      if (response.status === 404 || !parsed) {
        const fallbackRes = await executeClientSideAdminRestore(adminUser, backupPayload);
        return {
          ...fallbackRes,
          safetyBackupFileName
        };
      }

      throw new Error(parsed?.error || `Falha ao restaurar backup no servidor (status ${response.status}).`);
    } catch (err: any) {
      if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError')) {
        const fallbackRes = await executeClientSideAdminRestore(adminUser, backupPayload);
        return {
          ...fallbackRes,
          safetyBackupFileName
        };
      }
      throw err;
    }
  }
};
