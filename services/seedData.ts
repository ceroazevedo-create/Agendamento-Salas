import { User, Client, Room, Booking, BlockedSlot, AuditLog, SystemConfig } from '../types';

export const INITIAL_ROOMS: Room[] = [
  {
    id: 'Sala 1',
    name: 'Sala 1 — Psicoterapia & Acolhimento',
    description: 'Espaço para atendimento individual e de casal.',
    hourlyRate: 34.0,
    dailyRate: 350.0,
    morningRate: 150.0,
    afternoonRate: 180.0,
    nightRate: 130.0,
    status: 'ACTIVE',
    openHour: 7,
    closeHour: 22,
    notes: 'Ideal para atendimento individual de adultos, casais e psicoterapia.'
  },
  {
    id: 'Sala 2',
    name: 'Sala 2 — Multidisciplinar & Infantil',
    description: 'Espaço multidisciplinar e infantil.',
    hourlyRate: 34.0,
    dailyRate: 350.0,
    morningRate: 150.0,
    afternoonRate: 180.0,
    nightRate: 130.0,
    status: 'ACTIVE',
    openHour: 7,
    closeHour: 22,
    notes: 'Adequada para psicologia infantil, fonoaudiologia, nutrição e terapias integrativas.'
  }
];

export const INITIAL_CONFIG: SystemConfig = {
  establishmentName: 'Espaço Terapêutico & Clínico LocaPsico',
  contactEmail: 'contato@locapsico.com.br',
  contactPhone: '(11) 98765-4321',
  openHour: 7,
  closeHour: 22,
  cancellationLimitHours: 24,
  allowHolidaysGlobal: false,
  unblockedHolidays: [],
  rooms: INITIAL_ROOMS
};

// Dados operacionais iniciam vazios para ambiente de produção
export const INITIAL_USERS: User[] = [];
export const INITIAL_CLIENTS: Client[] = [];
export const INITIAL_BOOKINGS: Booking[] = [];
export const INITIAL_BLOCKED_SLOTS: BlockedSlot[] = [];
export const INITIAL_AUDIT_LOGS: AuditLog[] = [];
