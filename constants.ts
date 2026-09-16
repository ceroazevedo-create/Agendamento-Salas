// Horário padrão das salas: Segunda a Sexta 07:00 às 22:00 | Sábado 07:00 às 14:00
export const HOURS_START = 7;
export const HOURS_END = 22; 
export const SATURDAY_HOURS_END = 14;

/**
 * Retorna o horário de fechamento para um determinado dia da semana.
 * Segunda a Sexta: 22h | Sábado: 14h | Domingo: 0 (Fechado)
 */
export function getClosingHourForDate(dateOrDayOfWeek: Date | number | string): number {
  let dayOfWeek: number;
  if (typeof dateOrDayOfWeek === 'number') {
    dayOfWeek = dateOrDayOfWeek;
  } else if (typeof dateOrDayOfWeek === 'string') {
    const [y, m, d] = dateOrDayOfWeek.split('-').map(Number);
    dayOfWeek = new Date(y, m - 1, d).getDay();
  } else {
    dayOfWeek = dateOrDayOfWeek.getDay();
  }

  if (dayOfWeek === 0) return 0; // Domingo fechado
  if (dayOfWeek === 6) return SATURDAY_HOURS_END; // Sábado até 14h
  return HOURS_END; // Seg-Sex até 22h
} 

export const DAYS_OF_WEEK = [
  'Domingo', 
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado'
];

export const INITIAL_HOURLY_RATE = 40.0;
export const INITIAL_DAILY_RATE = 400.0;

// Tarifas padrão por período (Manhã, Tarde, Noite e 1 Dia Integral)
export const INITIAL_PERIOD_RATES = {
  MORNING: 150.0,   // Manhã (07:00 às 12:00 - 5h)
  AFTERNOON: 180.0, // Tarde (12:00 às 18:00 - 6h)
  NIGHT: 130.0,     // Noite (18:00 às 22:00 - 4h)
  FULL_DAY: 400.0,  // 1 Dia / Diária (07:00 às 22:00 - 15h)
};

import { PeriodShift } from './types';

export interface PeriodConfig {
  id: PeriodShift;
  name: string; // 'Manhã' | 'Tarde' | 'Noite' | '1 Dia'
  startHour: number;
  endHour: number;
  saturdayEndHour?: number;
  description: string;
}

export const BOOKING_PERIODS: PeriodConfig[] = [
  {
    id: 'MORNING',
    name: 'Manhã',
    startHour: 7,
    endHour: 12,
    description: '07:00 às 12:00 (5 horas)'
  },
  {
    id: 'AFTERNOON',
    name: 'Tarde',
    startHour: 12,
    endHour: 18,
    saturdayEndHour: 14,
    description: '12:00 às 18:00 (Seg-Sex) • 12:00 às 14:00 (Sáb)'
  },
  {
    id: 'NIGHT',
    name: 'Noite',
    startHour: 18,
    endHour: 22,
    description: '18:00 às 22:00 (Segunda a Sexta)'
  },
  {
    id: 'FULL_DAY',
    name: '1 Dia',
    startHour: 7,
    endHour: 22,
    saturdayEndHour: 14,
    description: '07:00 às 22:00 (15h) • Sáb até 14:00 (7h)'
  }
];

/**
 * Retorna as configurações de um determinado período (Manhã, Tarde ou Noite),
 * aplicando os horários e limites de sábado quando aplicável.
 */
export function getPeriodConfig(period: PeriodShift, dateOrDayOfWeek?: Date | number | string) {
  const p = BOOKING_PERIODS.find(item => item.id === period) || BOOKING_PERIODS[0];
  let isSaturday = false;
  if (dateOrDayOfWeek !== undefined) {
    if (typeof dateOrDayOfWeek === 'number') {
      isSaturday = dateOrDayOfWeek === 6;
    } else if (typeof dateOrDayOfWeek === 'string') {
      const [y, m, d] = dateOrDayOfWeek.split('-').map(Number);
      isSaturday = new Date(y, m - 1, d).getDay() === 6;
    } else {
      isSaturday = dateOrDayOfWeek.getDay() === 6;
    }
  }

  const startHour = p.startHour;
  const endHour = isSaturday && p.saturdayEndHour !== undefined ? p.saturdayEndHour : p.endHour;
  const isAvailableOnDate = isSaturday ? p.id !== 'NIGHT' : true;
  const duration = Math.max(0, endHour - startHour);

  return {
    ...p,
    startHour,
    endHour,
    duration,
    isAvailableOnDate
  };
}

export const STORAGE_KEYS = {
  CLIENTS: 'locapsico_clients_v2',
  BOOKINGS: 'locapsico_bookings_v2',
  BLOCKED_SLOTS: 'locapsico_blocked_v2',
  AUDIT_LOGS: 'locapsico_audit_v2',
  CONFIG: 'locapsico_config_v2',
  SEEDED: 'locapsico_seeded_v2'
};

export const HOLIDAYS = [
  '01-01', 
  '04-21', 
  '05-01', 
  '09-07', 
  '10-12', 
  '11-02', 
  '11-15', 
  '11-20', 
  '12-25', 
  '2026-02-16', 
  '2026-02-17', 
  '2026-04-03', 
  '2026-04-21', 
  '2026-06-04', 
];
