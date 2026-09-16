import { 
  User, Client, Booking, BlockedSlot, AuditLog, SystemConfig, Room, RoomId 
} from '../types';
import { STORAGE_KEYS } from '../constants';
import { 
  INITIAL_USERS, INITIAL_CLIENTS, INITIAL_BOOKINGS, 
  INITIAL_BLOCKED_SLOTS, INITIAL_AUDIT_LOGS, INITIAL_CONFIG 
} from './seedData';

// Helper to ensure initial seed data is loaded into localStorage (apenas para entidades de contingência local)
export const ensureSeededData = () => {
  if (typeof window === 'undefined') return;

  // Remove qualquer dado residual de sessão legada para garantir segurança
  try {
    localStorage.removeItem('locapsico_session_v2');
    localStorage.removeItem('locapsico_users_v2');
  } catch {}

  const isSeeded = localStorage.getItem(STORAGE_KEYS.SEEDED);
  if (!isSeeded) {
    localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(INITIAL_CLIENTS));
    localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(INITIAL_BOOKINGS));
    localStorage.setItem(STORAGE_KEYS.BLOCKED_SLOTS, JSON.stringify(INITIAL_BLOCKED_SLOTS));
    localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(INITIAL_AUDIT_LOGS));
    localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(INITIAL_CONFIG));
    localStorage.setItem(STORAGE_KEYS.SEEDED, 'true');
  }
};

// ================= USERS (NÃO UTILIZADO PARA AUTENTICAÇÃO) =================
// A autenticação e os usuários são gerenciados exclusivamente pelo Supabase Auth e public.profiles.
export const getStoredUsers = (): User[] => {
  return [];
};

export const saveStoredUsers = (_users: User[]) => {
  // No-op: Supabase Auth gerencia usuários
};

// ================= CLIENTS =================
export const getStoredClients = (): Client[] => {
  ensureSeededData();
  const data = localStorage.getItem(STORAGE_KEYS.CLIENTS);
  return data ? JSON.parse(data) : INITIAL_CLIENTS;
};

export const saveStoredClients = (clients: Client[]) => {
  localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(clients));
};

// ================= BOOKINGS =================
export const getStoredBookings = (): Booking[] => {
  ensureSeededData();
  const data = localStorage.getItem(STORAGE_KEYS.BOOKINGS);
  return data ? JSON.parse(data) : INITIAL_BOOKINGS;
};

export const saveStoredBookings = (bookings: Booking[]) => {
  localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(bookings));
};

// ================= BLOCKED SLOTS =================
export const getStoredBlockedSlots = (): BlockedSlot[] => {
  ensureSeededData();
  const data = localStorage.getItem(STORAGE_KEYS.BLOCKED_SLOTS);
  return data ? JSON.parse(data) : INITIAL_BLOCKED_SLOTS;
};

export const saveStoredBlockedSlots = (slots: BlockedSlot[]) => {
  localStorage.setItem(STORAGE_KEYS.BLOCKED_SLOTS, JSON.stringify(slots));
};

// ================= AUDIT LOGS =================
export const getStoredAuditLogs = (): AuditLog[] => {
  ensureSeededData();
  const data = localStorage.getItem(STORAGE_KEYS.AUDIT_LOGS);
  return data ? JSON.parse(data) : INITIAL_AUDIT_LOGS;
};

export const saveStoredAuditLogs = (logs: AuditLog[]) => {
  localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(logs));
};

export const addAuditLog = (userId: string, userName: string, action: string, details: string) => {
  const currentLogs = getStoredAuditLogs();
  const newLog: AuditLog = {
    id: 'aud-' + Date.now(),
    userId,
    userName,
    action,
    details,
    timestamp: new Date().toISOString()
  };
  saveStoredAuditLogs([newLog, ...currentLogs]);
};

// ================= SYSTEM CONFIG =================
export const getSystemConfig = (): SystemConfig => {
  ensureSeededData();
  const data = localStorage.getItem(STORAGE_KEYS.CONFIG);
  if (data) {
    try {
      const parsed: SystemConfig = JSON.parse(data);
      // Migração automática de horário caso ainda esteja com o antigo 8h às 21h
      if (parsed.openHour === 8 && parsed.closeHour === 21) {
        parsed.openHour = 7;
        parsed.closeHour = 22;
        if (parsed.rooms) {
          parsed.rooms = parsed.rooms.map(r => ({
            ...r,
            openHour: 7,
            closeHour: 22
          }));
        }
        localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(parsed));
      }
      return parsed;
    } catch {
      return INITIAL_CONFIG;
    }
  }
  return INITIAL_CONFIG;
};

export const saveSystemConfig = (config: SystemConfig) => {
  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
};

// ================= SESSÃO (GERENCIADA EXCLUSIVAMENTE PELO SUPABASE AUTH) =================
export const getStoredSession = (): User | null => {
  return null;
};

export const saveStoredSession = (_user: User | null) => {
  // No-op: A persistência de sessão é feita unicamente pelo cliente oficial do Supabase
};

// Helper to reset seed data to initial state if desired (entidades de fallback)
export const resetToInitialSeedData = () => {
  localStorage.setItem(STORAGE_KEYS.CLIENTS, JSON.stringify(INITIAL_CLIENTS));
  localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(INITIAL_BOOKINGS));
  localStorage.setItem(STORAGE_KEYS.BLOCKED_SLOTS, JSON.stringify(INITIAL_BLOCKED_SLOTS));
  localStorage.setItem(STORAGE_KEYS.AUDIT_LOGS, JSON.stringify(INITIAL_AUDIT_LOGS));
  localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(INITIAL_CONFIG));
  localStorage.setItem(STORAGE_KEYS.SEEDED, 'true');
};
