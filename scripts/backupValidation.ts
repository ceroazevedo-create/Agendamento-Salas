/**
 * LOCAPSICO - MÓDULO OFICIAL DE VALIDAÇÃO PRÉVIA DE BACKUP E RESTAURAÇÃO
 * Arquivo: scripts/backupValidation.ts
 *
 * Responsável pela validação profunda de integridade referencial, tipos e regras de negócio
 * ANTES de qualquer operação destrutiva ou de modificação no banco de dados.
 */

export const REQUIRED_BACKUP_TABLES = [
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

export type RequiredBackupTable = typeof REQUIRED_BACKUP_TABLES[number];

export const FORBIDDEN_CREDENTIAL_KEYS = new Set([
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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
  description?: string;
  schemaVersion?: string;
  generatedAt?: string;
  generatedBy?: {
    id?: string;
    email?: string;
    name?: string;
  };
  totalRecords?: number;
  counts?: Partial<BackupCounts>;
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
    [key: string]: any[];
  };
}

export interface ValidationDetail {
  table?: string;
  recordIndex?: number;
  field?: string;
  message: string;
}

export interface BackupValidationResult {
  valid: boolean;
  errors: string[];
  error?: string;
  details: ValidationDetail[];
  counts?: BackupCounts;
  isAnonymized?: boolean;
}

/**
 * Valida formato de UUID v4 ou RFC4122
 */
export function isValidUUID(val: any): boolean {
  if (typeof val !== 'string') return false;
  return UUID_REGEX.test(val.trim());
}

/**
 * Valida string de data YYYY-MM-DD
 */
export function isValidDateString(val: any): boolean {
  if (typeof val !== 'string' || !DATE_REGEX.test(val.trim())) return false;
  const [yearStr, monthStr, dayStr] = val.trim().split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const dateObj = new Date(year, month - 1, day);
  return (
    dateObj.getFullYear() === year &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  );
}

/**
 * Detecta se o payload é um backup anonimizado (não restaurável)
 */
export function detectAnonymizedBackup(backup: any): { isAnonymized: boolean; reason?: string } {
  if (!backup || typeof backup !== 'object') {
    return { isAnonymized: false };
  }

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
      reason: 'Os metadados do arquivo identificam expressamente um Backup Anonimizado (restorable: false).'
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
        reason: 'Foram detectados dados mascarados/anonimizados (ex: @anonimizado.local, CPF ou telefone mascarados) nos registros.'
      };
    }
  }

  return { isAnonymized: false };
}

/**
 * Detecta presença de campos de credenciais sensíveis no payload
 */
export function detectForbiddenCredentials(backup: any): { hasCredentials: boolean; reason?: string } {
  if (!backup || typeof backup !== 'object') {
    return { hasCredentials: false };
  }

  const checkObject = (obj: any, path: string): string | null => {
    if (!obj || typeof obj !== 'object') return null;

    for (const [key, val] of Object.entries(obj)) {
      if (FORBIDDEN_CREDENTIAL_KEYS.has(key.toLowerCase()) && val !== null && val !== undefined && val !== '') {
        return `Campo sensível proibido "${key}" detectado em ${path}`;
      }
      if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
        const nested = checkObject(val, `${path}.${key}`);
        if (nested) return nested;
      }
    }
    return null;
  };

  const data = backup?.data || {};
  for (const tableName of REQUIRED_BACKUP_TABLES) {
    const tableRows = data[tableName];
    if (Array.isArray(tableRows)) {
      for (let i = 0; i < tableRows.length; i++) {
        const row = tableRows[i];
        const error = checkObject(row, `${tableName}[${i}]`);
        if (error) {
          return { hasCredentials: true, reason: error };
        }
      }
    }
  }

  return { hasCredentials: false };
}

/**
 * Sanitiza objeto removendo chaves de credenciais proibidas
 */
export function sanitizeCredentialsDeep<T extends Record<string, any>>(record: T): T {
  if (!record || typeof record !== 'object') return record;
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (FORBIDDEN_CREDENTIAL_KEYS.has(key.toLowerCase())) {
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      cleaned[key] = sanitizeCredentialsDeep(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned as T;
}

/**
 * Validação rigorosa e completa do payload de restauração.
 * Rejeita qualquer anomalia de tipo, chave estrangeira ou regra de negócio.
 */
export function validateFullBackupPayload(backup: any): BackupValidationResult {
  const errors: string[] = [];
  const details: ValidationDetail[] = [];

  function addError(message: string, detail?: { table?: string; recordIndex?: number; field?: string }) {
    errors.push(message);
    details.push({
      message,
      table: detail?.table,
      recordIndex: detail?.recordIndex,
      field: detail?.field
    });
  }

  // 1. Estrutura Raiz
  if (!backup || typeof backup !== 'object') {
    addError('O conteúdo do backup não é um objeto JSON válido.');
    return { valid: false, errors, error: errors[0], details };
  }

  // 2. Metadados
  if (!backup.metadata || typeof backup.metadata !== 'object') {
    addError('Arquivo de backup inválido: bloco "metadata" ausente.');
    return { valid: false, errors, error: errors[0], details };
  }

  if (backup.metadata.system !== 'LocaPsico') {
    addError(`Arquivo incompatível: o sistema de origem ("${backup.metadata.system || 'desconhecido'}") não é o LocaPsico.`);
    return { valid: false, errors, error: errors[0], details };
  }

  // 3. Detecção de Anonimização
  const anonCheck = detectAnonymizedBackup(backup);
  if (anonCheck.isAnonymized) {
    addError(`Operação bloqueada: Não é permitido restaurar um Backup Anonimizado. ${anonCheck.reason || ''} Utilize exclusivamente um arquivo de Backup Completo.`);
    return { valid: false, errors, error: errors[0], details, isAnonymized: true };
  }

  // 4. Detecção de Credenciais Proibidas
  const credCheck = detectForbiddenCredentials(backup);
  if (credCheck.hasCredentials) {
    addError(`Arquivo rejeitado por segurança: ${credCheck.reason}. Backups não podem conter senhas, tokens ou chaves privadas.`);
  }

  // 5. Bloco de Dados
  if (!backup.data || typeof backup.data !== 'object') {
    addError('Arquivo inválido: bloco "data" ausente.');
    return { valid: false, errors, error: errors[0], details };
  }

  // 6. Presença das 9 Tabelas Obrigatórias
  for (const table of REQUIRED_BACKUP_TABLES) {
    if (!Array.isArray(backup.data[table])) {
      addError(`Estrutura de backup incompleta: a tabela "${table}" está ausente ou não é uma lista válida.`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, error: errors[0], details };
  }

  const {
    profiles = [],
    professionals = [],
    clients = [],
    rooms = [],
    bookings = [],
    payments = [],
    blocked_slots = [],
    settings = [],
    audit_logs = []
  } = backup.data;

  // -------------------------------------------------------------
  // 7. Validação Tabela PROFILES
  // -------------------------------------------------------------
  const profileIdSet = new Set<string>();
  const profileEmailSet = new Set<string>();

  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    if (!p || typeof p !== 'object') {
      addError(`Registro inválido na tabela profiles na posição ${i}`, { table: 'profiles', recordIndex: i });
      continue;
    }

    if (!isValidUUID(p.id)) {
      addError(`profiles[${i}].id ("${p.id}") não é um UUID v4 válido.`, { table: 'profiles', recordIndex: i, field: 'id' });
    } else {
      if (profileIdSet.has(p.id)) {
        addError(`profiles[${i}].id duplicado: "${p.id}".`, { table: 'profiles', recordIndex: i, field: 'id' });
      }
      profileIdSet.add(p.id);
    }

    if (!p.full_name || typeof p.full_name !== 'string' || !p.full_name.trim()) {
      addError(`profiles[${i}].full_name é obrigatório e não pode ser vazio.`, { table: 'profiles', recordIndex: i, field: 'full_name' });
    }

    const email = String(p.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      addError(`profiles[${i}].email ("${p.email}") é inválido.`, { table: 'profiles', recordIndex: i, field: 'email' });
    } else {
      profileEmailSet.add(email);
    }

    const role = String(p.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'professional') {
      addError(`profiles[${i}].role ("${p.role}") inválido. Valores permitidos: 'admin' ou 'professional'.`, { table: 'profiles', recordIndex: i, field: 'role' });
    }

    const status = String(p.status || '').toUpperCase();
    if (status !== 'ACTIVE' && status !== 'INACTIVE') {
      addError(`profiles[${i}].status ("${p.status}") inválido. Valores permitidos: 'ACTIVE' ou 'INACTIVE'.`, { table: 'profiles', recordIndex: i, field: 'status' });
    }
  }

  // -------------------------------------------------------------
  // 8. Validação Tabela PROFESSIONALS
  // -------------------------------------------------------------
  const professionalIdSet = new Set<string>();
  const professionalUserIdSet = new Set<string>();

  for (let i = 0; i < professionals.length; i++) {
    const prof = professionals[i];
    if (!prof || typeof prof !== 'object') {
      addError(`Registro inválido na tabela professionals na posição ${i}`, { table: 'professionals', recordIndex: i });
      continue;
    }

    if (!isValidUUID(prof.id)) {
      addError(`professionals[${i}].id ("${prof.id}") não é um UUID v4 válido.`, { table: 'professionals', recordIndex: i, field: 'id' });
    } else {
      professionalIdSet.add(prof.id);
    }

    if (!isValidUUID(prof.user_id)) {
      addError(`professionals[${i}].user_id ("${prof.user_id}") não é um UUID v4 válido.`, { table: 'professionals', recordIndex: i, field: 'user_id' });
    } else {
      // Verificação de unicidade estrita: professionals.user_id é UNIQUE no banco
      if (professionalUserIdSet.has(prof.user_id)) {
        addError(`professionals[${i}].user_id duplicado ("${prof.user_id}"). Violação da restrição de unicidade.`, { table: 'professionals', recordIndex: i, field: 'user_id' });
      }
      professionalUserIdSet.add(prof.user_id);

      // Integridade referencial com profiles
      if (!profileIdSet.has(prof.user_id)) {
        addError(`professionals[${i}].user_id ("${prof.user_id}") não existe na tabela profiles do backup.`, { table: 'professionals', recordIndex: i, field: 'user_id' });
      }
    }

    if (!prof.full_name || typeof prof.full_name !== 'string' || !prof.full_name.trim()) {
      addError(`professionals[${i}].full_name é obrigatório.`, { table: 'professionals', recordIndex: i, field: 'full_name' });
    }
  }

  // -------------------------------------------------------------
  // 9. Validação Tabela CLIENTS
  // -------------------------------------------------------------
  const clientIdSet = new Set<string>();

  for (let i = 0; i < clients.length; i++) {
    const c = clients[i];
    if (!c || typeof c !== 'object') {
      addError(`Registro inválido na tabela clients na posição ${i}`, { table: 'clients', recordIndex: i });
      continue;
    }

    if (!isValidUUID(c.id)) {
      addError(`clients[${i}].id ("${c.id}") não é um UUID v4 válido.`, { table: 'clients', recordIndex: i, field: 'id' });
    } else {
      clientIdSet.add(c.id);
    }

    if (!isValidUUID(c.professional_id)) {
      addError(`clients[${i}].professional_id ("${c.professional_id}") não é um UUID v4 válido.`, { table: 'clients', recordIndex: i, field: 'professional_id' });
    } else if (!profileIdSet.has(c.professional_id)) {
      addError(`clients[${i}].professional_id ("${c.professional_id}") não existe na tabela profiles do backup.`, { table: 'clients', recordIndex: i, field: 'professional_id' });
    }

    if (!c.full_name || typeof c.full_name !== 'string' || !c.full_name.trim()) {
      addError(`clients[${i}].full_name é obrigatório.`, { table: 'clients', recordIndex: i, field: 'full_name' });
    }
  }

  // -------------------------------------------------------------
  // 10. Validação Tabela ROOMS
  // Nota: rooms.id é TEXT (ex: 'Sala 1', 'Sala 2'), NÃO UUID.
  // -------------------------------------------------------------
  const roomIdSet = new Set<string>();

  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i];
    if (!r || typeof r !== 'object') {
      addError(`Registro inválido na tabela rooms na posição ${i}`, { table: 'rooms', recordIndex: i });
      continue;
    }

    const roomId = String(r.id || '').trim();
    if (!roomId) {
      addError(`rooms[${i}].id é obrigatório e não pode ser vazio.`, { table: 'rooms', recordIndex: i, field: 'id' });
    } else {
      roomIdSet.add(roomId);
    }

    if (!r.name || typeof r.name !== 'string' || !r.name.trim()) {
      addError(`rooms[${i}].name é obrigatório.`, { table: 'rooms', recordIndex: i, field: 'name' });
    }

    const hourlyRate = Number(r.hourly_rate);
    if (isNaN(hourlyRate) || hourlyRate <= 0) {
      addError(`rooms[${i}].hourly_rate deve ser um número positivo.`, { table: 'rooms', recordIndex: i, field: 'hourly_rate' });
    }

    const openTime = Number(r.opening_time);
    const closeTime = Number(r.closing_time);
    if (isNaN(openTime) || openTime < 0 || openTime > 24) {
      addError(`rooms[${i}].opening_time inválido (${r.opening_time}).`, { table: 'rooms', recordIndex: i, field: 'opening_time' });
    }
    if (isNaN(closeTime) || closeTime < 0 || closeTime > 24 || closeTime <= openTime) {
      addError(`rooms[${i}].closing_time inválido ou menor/igual ao horário de abertura.`, { table: 'rooms', recordIndex: i, field: 'closing_time' });
    }

    const status = String(r.status || '').toUpperCase();
    if (status !== 'ACTIVE' && status !== 'MAINTENANCE') {
      addError(`rooms[${i}].status ("${r.status}") inválido. Valores permitidos: 'ACTIVE' ou 'MAINTENANCE'.`, { table: 'rooms', recordIndex: i, field: 'status' });
    }
  }

  // -------------------------------------------------------------
  // 11. Validação Tabela BOOKINGS
  // -------------------------------------------------------------
  const bookingIdSet = new Set<string>();

  for (let i = 0; i < bookings.length; i++) {
    const b = bookings[i];
    if (!b || typeof b !== 'object') {
      addError(`Registro inválido na tabela bookings na posição ${i}`, { table: 'bookings', recordIndex: i });
      continue;
    }

    if (!isValidUUID(b.id)) {
      addError(`bookings[${i}].id ("${b.id}") não é um UUID v4 válido.`, { table: 'bookings', recordIndex: i, field: 'id' });
    } else {
      bookingIdSet.add(b.id);
    }

    if (!isValidUUID(b.professional_id)) {
      addError(`bookings[${i}].professional_id ("${b.professional_id}") não é um UUID v4 válido.`, { table: 'bookings', recordIndex: i, field: 'professional_id' });
    } else if (!profileIdSet.has(b.professional_id)) {
      addError(`bookings[${i}].professional_id ("${b.professional_id}") não existe na tabela profiles do backup.`, { table: 'bookings', recordIndex: i, field: 'professional_id' });
    }

    if (b.client_id !== null && b.client_id !== undefined && b.client_id !== '') {
      if (!isValidUUID(b.client_id)) {
        addError(`bookings[${i}].client_id ("${b.client_id}") não é um UUID v4 válido.`, { table: 'bookings', recordIndex: i, field: 'client_id' });
      } else if (!clientIdSet.has(b.client_id)) {
        addError(`bookings[${i}].client_id ("${b.client_id}") não existe na tabela clients do backup.`, { table: 'bookings', recordIndex: i, field: 'client_id' });
      }
    }

    const bRoomId = String(b.room_id || '').trim();
    if (!bRoomId) {
      addError(`bookings[${i}].room_id é obrigatório.`, { table: 'bookings', recordIndex: i, field: 'room_id' });
    } else if (!roomIdSet.has(bRoomId)) {
      addError(`bookings[${i}].room_id ("${bRoomId}") não existe na tabela rooms do backup.`, { table: 'bookings', recordIndex: i, field: 'room_id' });
    }

    if (!isValidDateString(b.booking_date)) {
      addError(`bookings[${i}].booking_date ("${b.booking_date}") não é uma data válida no formato YYYY-MM-DD.`, { table: 'bookings', recordIndex: i, field: 'booking_date' });
    }

    const start = Number(b.start_time);
    const end = Number(b.end_time);
    if (isNaN(start) || start < 7 || start >= 22) {
      addError(`bookings[${i}].start_time (${b.start_time}) fora do limite operacional [7, 21].`, { table: 'bookings', recordIndex: i, field: 'start_time' });
    }
    if (isNaN(end) || end <= 7 || end > 22) {
      addError(`bookings[${i}].end_time (${b.end_time}) fora do limite operacional [8, 22].`, { table: 'bookings', recordIndex: i, field: 'end_time' });
    }
    if (!isNaN(start) && !isNaN(end) && end <= start) {
      addError(`bookings[${i}]: end_time (${end}) deve ser estritamente maior que start_time (${start}).`, { table: 'bookings', recordIndex: i });
    }

    const bStatus = String(b.status || '').toLowerCase();
    if (bStatus !== 'confirmed' && bStatus !== 'cancelled' && bStatus !== 'completed') {
      addError(`bookings[${i}].status ("${b.status}") inválido. Valores permitidos: 'confirmed', 'cancelled', 'completed'.`, { table: 'bookings', recordIndex: i, field: 'status' });
    }

    const pStatus = String(b.payment_status || '').toUpperCase();
    if (pStatus !== 'PENDING' && pStatus !== 'PAID' && pStatus !== 'CANCELLED') {
      addError(`bookings[${i}].payment_status ("${b.payment_status}") inválido. Valores permitidos: 'PENDING', 'PAID', 'CANCELLED'.`, { table: 'bookings', recordIndex: i, field: 'payment_status' });
    }

    // Se recurrence_id presente, deve ser UUID
    if (b.recurrence_id !== null && b.recurrence_id !== undefined && b.recurrence_id !== '') {
      if (!isValidUUID(b.recurrence_id)) {
        addError(`bookings[${i}].recurrence_id ("${b.recurrence_id}") não é um UUID v4 válido.`, { table: 'bookings', recordIndex: i, field: 'recurrence_id' });
      }
    }
  }

  // -------------------------------------------------------------
  // 12. Validação Tabela PAYMENTS
  // -------------------------------------------------------------
  for (let i = 0; i < payments.length; i++) {
    const pay = payments[i];
    if (!pay || typeof pay !== 'object') {
      addError(`Registro inválido na tabela payments na posição ${i}`, { table: 'payments', recordIndex: i });
      continue;
    }

    if (!isValidUUID(pay.id)) {
      addError(`payments[${i}].id ("${pay.id}") não é um UUID v4 válido.`, { table: 'payments', recordIndex: i, field: 'id' });
    }

    if (!isValidUUID(pay.professional_id)) {
      addError(`payments[${i}].professional_id ("${pay.professional_id}") não é um UUID v4 válido.`, { table: 'payments', recordIndex: i, field: 'professional_id' });
    } else if (!profileIdSet.has(pay.professional_id)) {
      addError(`payments[${i}].professional_id ("${pay.professional_id}") não existe na tabela profiles do backup.`, { table: 'payments', recordIndex: i, field: 'professional_id' });
    }

    if (pay.booking_id !== null && pay.booking_id !== undefined && pay.booking_id !== '') {
      if (!isValidUUID(pay.booking_id)) {
        addError(`payments[${i}].booking_id ("${pay.booking_id}") não é um UUID v4 válido.`, { table: 'payments', recordIndex: i, field: 'booking_id' });
      } else if (!bookingIdSet.has(pay.booking_id)) {
        addError(`payments[${i}].booking_id ("${pay.booking_id}") não existe na tabela bookings do backup.`, { table: 'payments', recordIndex: i, field: 'booking_id' });
      }
    }

    const payStatus = String(pay.status || '').toUpperCase();
    if (payStatus !== 'PAID' && payStatus !== 'PENDING' && payStatus !== 'CANCELLED') {
      addError(`payments[${i}].status ("${pay.status}") inválido. Valores permitidos: 'PAID', 'PENDING', 'CANCELLED'.`, { table: 'payments', recordIndex: i, field: 'status' });
    }
  }

  // -------------------------------------------------------------
  // 13. Validação Tabela BLOCKED_SLOTS
  // -------------------------------------------------------------
  for (let i = 0; i < blocked_slots.length; i++) {
    const blk = blocked_slots[i];
    if (!blk || typeof blk !== 'object') {
      addError(`Registro inválido na tabela blocked_slots na posição ${i}`, { table: 'blocked_slots', recordIndex: i });
      continue;
    }

    if (!isValidUUID(blk.id)) {
      addError(`blocked_slots[${i}].id ("${blk.id}") não é um UUID v4 válido.`, { table: 'blocked_slots', recordIndex: i, field: 'id' });
    }

    const blkRoomId = String(blk.room_id || '').trim();
    if (!blkRoomId) {
      addError(`blocked_slots[${i}].room_id é obrigatório.`, { table: 'blocked_slots', recordIndex: i, field: 'room_id' });
    } else if (blkRoomId !== 'ALL' && !roomIdSet.has(blkRoomId)) {
      addError(`blocked_slots[${i}].room_id ("${blkRoomId}") deve ser "ALL" ou uma sala existente em rooms.`, { table: 'blocked_slots', recordIndex: i, field: 'room_id' });
    }

    if (!isValidDateString(blk.blocked_date)) {
      addError(`blocked_slots[${i}].blocked_date ("${blk.blocked_date}") não é uma data válida no formato YYYY-MM-DD.`, { table: 'blocked_slots', recordIndex: i, field: 'blocked_date' });
    }

    const start = Number(blk.start_time);
    const end = Number(blk.end_time);
    if (isNaN(start) || isNaN(end) || end <= start) {
      addError(`blocked_slots[${i}]: end_time (${blk.end_time}) deve ser estritamente maior que start_time (${blk.start_time}).`, { table: 'blocked_slots', recordIndex: i });
    }
  }

  // -------------------------------------------------------------
  // 14. Validação Tabela SETTINGS
  // Nota: settings.id é TEXT (ex: 'global'), NÃO UUID.
  // -------------------------------------------------------------
  for (let i = 0; i < settings.length; i++) {
    const s = settings[i];
    if (!s || typeof s !== 'object') {
      addError(`Registro inválido na tabela settings na posição ${i}`, { table: 'settings', recordIndex: i });
      continue;
    }
    const sId = String(s.id || '').trim();
    if (!sId) {
      addError(`settings[${i}].id é obrigatório.`, { table: 'settings', recordIndex: i, field: 'id' });
    }
  }

  // -------------------------------------------------------------
  // 15. Validação Tabela AUDIT_LOGS
  // -------------------------------------------------------------
  for (let i = 0; i < audit_logs.length; i++) {
    const log = audit_logs[i];
    if (!log || typeof log !== 'object') {
      addError(`Registro inválido na tabela audit_logs na posição ${i}`, { table: 'audit_logs', recordIndex: i });
      continue;
    }

    if (!isValidUUID(log.id)) {
      addError(`audit_logs[${i}].id ("${log.id}") não é um UUID v4 válido.`, { table: 'audit_logs', recordIndex: i, field: 'id' });
    }

    if (log.user_id !== null && log.user_id !== undefined && log.user_id !== '') {
      if (!isValidUUID(log.user_id)) {
        addError(`audit_logs[${i}].user_id ("${log.user_id}") não é um UUID v4 válido.`, { table: 'audit_logs', recordIndex: i, field: 'user_id' });
      } else if (!profileIdSet.has(log.user_id)) {
        addError(`audit_logs[${i}].user_id ("${log.user_id}") não existe na tabela profiles do backup.`, { table: 'audit_logs', recordIndex: i, field: 'user_id' });
      }
    }

    if (!log.action || typeof log.action !== 'string' || !log.action.trim()) {
      addError(`audit_logs[${i}].action é obrigatório.`, { table: 'audit_logs', recordIndex: i, field: 'action' });
    }
  }

  const counts: BackupCounts = {
    profiles: profiles.length,
    professionals: professionals.length,
    clients: clients.length,
    rooms: rooms.length,
    bookings: bookings.length,
    payments: payments.length,
    blocked_slots: blocked_slots.length,
    settings: settings.length,
    audit_logs: audit_logs.length
  };

  return {
    valid: errors.length === 0,
    errors,
    error: errors[0],
    details,
    counts
  };
}
