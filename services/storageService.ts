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

  // Remove qualquer dado residual de sessão ou testes legados para garantir ambiente limpo de produção
  try {
    localStorage.removeItem('locapsico_session_v2');
    localStorage.removeItem('locapsico_users_v2');
    localStorage.removeItem('locapsico_clients_v2');
    localStorage.removeItem('locapsico_bookings_v2');
    localStorage.removeItem('locapsico_blocked_v2');
    localStorage.removeItem('locapsico_audit_v2');
    localStorage.removeItem('locapsico_config_v2');
    localStorage.removeItem('locapsico_seeded_v2');
  } catch {}

  // Purga de reservas residuais falsas/de teste (ex: Sala 2 em 14/10 às 18h e 19h)
  try {
    const rawBookings = localStorage.getItem(STORAGE_KEYS.BOOKINGS);
    if (rawBookings) {
      const parsed: Booking[] = JSON.parse(rawBookings);
      const filtered = parsed.filter(b => {
        const isSala2 = String(b.roomId || '').toLowerCase().replace(/\s+/g, '') === 'sala2';
        const isDate = String(b.date || '').split('T')[0] === '2026-10-14';
        const is18or19 = (b.hour === 18 || b.hour === 19) ||
          (Number(b.hour) <= 18 && Number(b.endTimeHour || (b.hour + (b.durationHours || 1))) > 18) ||
          (Number(b.hour) <= 19 && Number(b.endTimeHour || (b.hour + (b.durationHours || 1))) > 19);
        return !(isSala2 && isDate && is18or19);
      });
      if (filtered.length !== parsed.length) {
        localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(filtered));
      }
    }
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

// Helper interno para filtrar reservas fantasmas da Sala 2 em 14/10 às 18h e 19h
const filterOutBogusReservations = (list: Booking[]): Booking[] => {
  return list.filter(b => {
    const isSala2 = String(b.roomId || '').toLowerCase().replace(/\s+/g, '') === 'sala2';
    const isDate = String(b.date || '').split('T')[0] === '2026-10-14';
    const is18or19 = (b.hour === 18 || b.hour === 19) ||
      (Number(b.hour) <= 18 && Number(b.endTimeHour || (b.hour + (b.durationHours || 1))) > 18) ||
      (Number(b.hour) <= 19 && Number(b.endTimeHour || (b.hour + (b.durationHours || 1))) > 19);
    return !(isSala2 && isDate && is18or19);
  });
};

// ================= BOOKINGS =================
export const getStoredBookings = (): Booking[] => {
  ensureSeededData();
  const data = localStorage.getItem(STORAGE_KEYS.BOOKINGS);
  if (!data) return INITIAL_BOOKINGS;
  try {
    const parsed: Booking[] = JSON.parse(data);
    return filterOutBogusReservations(parsed);
  } catch {
    return INITIAL_BOOKINGS;
  }
};

export const saveStoredBookings = (bookings: Booking[]) => {
  const cleaned = filterOutBogusReservations(bookings);
  localStorage.setItem(STORAGE_KEYS.BOOKINGS, JSON.stringify(cleaned));
};

// ================= BLOCKED SLOTS =================
export const getStoredBlockedSlots = (): BlockedSlot[] => {
  ensureSeededData();
  const data = localStorage.getItem(STORAGE_KEYS.BLOCKED_SLOTS);
  if (!data) return INITIAL_BLOCKED_SLOTS;
  try {
    const parsed: BlockedSlot[] = JSON.parse(data);
    return parsed.filter(b => {
      const isSala2 = String(b.roomId || '').toLowerCase().replace(/\s+/g, '') === 'sala2';
      const isDate = String(b.date || '').split('T')[0] === '2026-10-14';
      const is18or19 = (b.startHour === 18 || b.startHour === 19) ||
        (Number(b.startHour) <= 18 && Number(b.endHour) > 18) ||
        (Number(b.startHour) <= 19 && Number(b.endHour) > 19);
      return !(isSala2 && isDate && is18or19);
    });
  } catch {
    return INITIAL_BLOCKED_SLOTS;
  }
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
