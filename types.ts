
export type Role = 'USER' | 'ADMIN';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  cpf?: string;
  phone?: string;
  whatsapp?: string;
  councilRegistration?: string; // CRP, CRM, CRN etc.
  profession?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  createdAt?: string;
  password?: string;
}

export interface Client {
  id: string;
  professionalId: string;
  name: string;
  cpf: string;
  birthDate?: string;
  phone: string;
  whatsapp: string;
  email?: string;
  address?: string;
  notes?: string;
  createdAt: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export type RoomId = 'Sala 1' | 'Sala 2';

export type PeriodShift = 'MORNING' | 'AFTERNOON' | 'NIGHT';

export interface Room {
  id: RoomId;
  name: string;
  description: string;
  hourlyRate: number;
  dailyRate: number; // Tarifa legada ou integral
  morningRate?: number; // Tarifa para o período da manhã (07h às 12h)
  afternoonRate?: number; // Tarifa para o período da tarde (12h às 18h)
  nightRate?: number; // Tarifa para o período da noite (18h às 22h)
  status: 'ACTIVE' | 'MAINTENANCE';
  openHour: number;
  closeHour: number;
  notes?: string;
}

export type BookingType = 'HOURLY' | 'PERIOD';
export type PaymentStatus = 'PENDING' | 'PAID' | 'CANCELLED';

export interface Booking {
  id: string;
  userId: string; // professionalId
  userEmail: string;
  userName?: string;
  clientId?: string;
  clientName?: string;
  roomId: RoomId;
  date: string; // YYYY-MM-DD
  hour: number; // starting hour (e.g. 7 para manhã, 12 para tarde, 18 para noite)
  durationHours: number; // e.g. 5h manhã, 6h tarde, 4h noite
  endTimeHour: number; // hour + durationHours
  type: BookingType;
  periodShift?: PeriodShift; // MORNING | AFTERNOON | NIGHT
  periodName?: string; // 'Manhã' | 'Tarde' | 'Noite'
  priceAtBooking: number; // rate per hour applied
  totalAmount: number; // total cost for this booking
  paymentStatus: PaymentStatus;
  createdAt: string;
  notes?: string;
  paidAt?: string;
  paidNotes?: string;
  paidByAdmin?: string;
}

export interface BlockedSlot {
  id: string;
  roomId: RoomId | 'ALL';
  date: string; // YYYY-MM-DD
  startHour: number;
  endHour: number;
  reason: string;
  createdAt: string;
  createdBy: string;
}

export interface PaymentRecord {
  id: string;
  professionalId: string;
  professionalName: string;
  bookingId: string;
  amount: number;
  paymentDate: string;
  status: 'PAID' | 'PENDING';
  notes?: string;
  recordedBy: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  timestamp: string;
}

export interface SystemConfig {
  establishmentName: string;
  contactPhone: string;
  contactEmail: string;
  openHour: number;
  closeHour: number;
  cancellationLimitHours: number;
  allowHolidaysGlobal: boolean;
  unblockedHolidays: string[];
  rooms: Room[];
}

export interface AppConfig extends SystemConfig {
  hourlyRate: number; // fallback for legacy
}

export interface CalendarSlot {
  hour: number;
  available: boolean;
  booking?: Booking;
  blocked?: BlockedSlot;
}
