import { User, Client, Room, Booking, BlockedSlot, AuditLog, SystemConfig } from '../types';
import { INITIAL_HOURLY_RATE, INITIAL_DAILY_RATE } from '../constants';

export const INITIAL_ROOMS: Room[] = [
  {
    id: 'Sala 1',
    name: 'Sala 1 — Psicoterapia & Acolhimento',
    description: 'Poltronas ergonômicas reclináveis, isolamento acústico duplo, iluminação dimerizável e mesa de apoio.',
    hourlyRate: 40.0,
    dailyRate: 460.0,
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
    description: 'Espaço com mesa de atendimento, divã, área lúdica com tapete vinílico e maca dobrável opcional.',
    hourlyRate: 40.0,
    dailyRate: 460.0,
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

// Usuários não são mais criados ou providos via mock estático no frontend.
// A autenticação e os perfis são gerenciados exclusivamente pelo Supabase (auth.users e public.profiles).
export const INITIAL_USERS: User[] = [];

export const INITIAL_CLIENTS: Client[] = [
  // Clientes da Helena
  {
    id: 'cli-1',
    professionalId: 'usr-helena',
    name: 'Maria da Silva',
    cpf: '123.456.789-00',
    birthDate: '1992-05-14',
    phone: '(11) 91234-5678',
    whatsapp: '(11) 91234-5678',
    email: 'maria.silva@gmail.com',
    address: 'Av. Paulista, 1000 - Bela Vista, SP',
    notes: 'Queixa principal: ansiedade generalizada e estresse ocupacional.',
    createdAt: '2026-03-10T10:00:00Z',
    status: 'ACTIVE'
  },
  {
    id: 'cli-2',
    professionalId: 'usr-helena',
    name: 'João Pedro Carlos',
    cpf: '234.567.890-11',
    birthDate: '1988-11-20',
    phone: '(11) 92345-6789',
    whatsapp: '(11) 92345-6789',
    email: 'jp.carlos@outlook.com',
    address: 'Rua Augusta, 450 - Consolação, SP',
    notes: 'Acompanhamento semanal às terças e quintas.',
    createdAt: '2026-03-15T11:00:00Z',
    status: 'ACTIVE'
  },
  {
    id: 'cli-3',
    professionalId: 'usr-helena',
    name: 'Fernanda Lima',
    cpf: '345.678.901-22',
    birthDate: '1995-02-28',
    phone: '(11) 93456-7890',
    whatsapp: '(11) 93456-7890',
    email: 'fernanda.lima@yahoo.com',
    address: 'Rua Oscar Freire, 800 - Jardins, SP',
    notes: 'Psicoterapia com foco em transição de carreira.',
    createdAt: '2026-04-02T15:00:00Z',
    status: 'ACTIVE'
  },
  // Clientes do Bruno
  {
    id: 'cli-4',
    professionalId: 'usr-bruno',
    name: 'Lucas Alencar',
    cpf: '456.789.012-33',
    birthDate: '1983-07-09',
    phone: '(11) 94567-8901',
    whatsapp: '(11) 94567-8901',
    email: 'lucas.alencar@empresa.com.br',
    address: 'Alameda Santos, 1200 - Cerqueira César, SP',
    notes: 'Atendimento quinzenal.',
    createdAt: '2026-03-20T08:00:00Z',
    status: 'ACTIVE'
  },
  {
    id: 'cli-5',
    professionalId: 'usr-bruno',
    name: 'Beatriz Vasconcelos',
    cpf: '567.890.123-44',
    birthDate: '1990-10-12',
    phone: '(11) 95678-9012',
    whatsapp: '(11) 95678-9012',
    email: 'beatriz.vasc@gmail.com',
    address: 'Rua Haddock Lobo, 950 - Cerqueira César, SP',
    notes: 'Sessões focadas em luto e elaboração afetiva.',
    createdAt: '2026-04-10T16:00:00Z',
    status: 'ACTIVE'
  },
  // Clientes da Camila
  {
    id: 'cli-6',
    professionalId: 'usr-camila',
    name: 'Renata Mendonça',
    cpf: '678.901.234-55',
    birthDate: '1996-03-05',
    phone: '(11) 96789-0123',
    whatsapp: '(11) 96789-0123',
    email: 'renata.mendonca@gmail.com',
    address: 'Rua Pamplona, 320 - Bela Vista, SP',
    notes: 'Reeducação alimentar e saúde metabólica.',
    createdAt: '2026-04-12T14:30:00Z',
    status: 'ACTIVE'
  }
];

// Gerar reservas representativas para Setembro de 2026 (mês atual de referência)
export const INITIAL_BOOKINGS: Booking[] = [
  // 1. Reserva de Helena hoje (10/09/2026) às 14:00 na Sala 1
  {
    id: 'bk-1001',
    userId: 'usr-helena',
    userEmail: 'helena@psico.com.br',
    userName: 'Dra. Helena Castro',
    clientId: 'cli-1',
    clientName: 'Maria da Silva',
    roomId: 'Sala 1',
    date: '2026-09-10',
    hour: 14,
    durationHours: 1,
    endTimeHour: 15,
    type: 'HOURLY',
    priceAtBooking: 40.0,
    totalAmount: 40.0,
    paymentStatus: 'PAID',
    createdAt: '2026-09-01T10:00:00Z',
    paidAt: '2026-09-05T14:00:00Z',
    paidByAdmin: 'Dra. Sandra Ramos'
  },
  // 2. Reserva de Bruno hoje (10/09/2026) às 16:00 na Sala 2
  {
    id: 'bk-1002',
    userId: 'usr-bruno',
    userEmail: 'bruno@terapia.com.br',
    userName: 'Dr. Bruno Mendes',
    clientId: 'cli-4',
    clientName: 'Lucas Alencar',
    roomId: 'Sala 2',
    date: '2026-09-10',
    hour: 16,
    durationHours: 2,
    endTimeHour: 18,
    type: 'HOURLY',
    priceAtBooking: 40.0,
    totalAmount: 80.0,
    paymentStatus: 'PENDING',
    createdAt: '2026-09-02T11:30:00Z'
  },
  // 3. Reserva amanhã (11/09/2026) Helena às 10:00 na Sala 1
  {
    id: 'bk-1003',
    userId: 'usr-helena',
    userEmail: 'helena@psico.com.br',
    userName: 'Dra. Helena Castro',
    clientId: 'cli-2',
    clientName: 'João Pedro Carlos',
    roomId: 'Sala 1',
    date: '2026-09-11',
    hour: 10,
    durationHours: 1,
    endTimeHour: 11,
    type: 'HOURLY',
    priceAtBooking: 40.0,
    totalAmount: 40.0,
    paymentStatus: 'PAID',
    createdAt: '2026-09-03T09:00:00Z',
    paidAt: '2026-09-08T10:00:00Z',
    paidByAdmin: 'Dra. Sandra Ramos'
  },
  // 4. Reserva período integral (12/09/2026) Bruno na Sala 2
  {
    id: 'bk-1004',
    userId: 'usr-bruno',
    userEmail: 'bruno@terapia.com.br',
    userName: 'Dr. Bruno Mendes',
    clientId: 'cli-5',
    clientName: 'Beatriz Vasconcelos',
    roomId: 'Sala 2',
    date: '2026-09-12',
    hour: 8,
    durationHours: 13,
    endTimeHour: 21,
    type: 'PERIOD',
    priceAtBooking: 40.0,
    totalAmount: 350.0, // Tarifa fixa do período
    paymentStatus: 'PENDING',
    createdAt: '2026-09-04T12:00:00Z',
    notes: 'Imersão de atendimento contínuo'
  },
  // 5. Reserva de Helena na semana que vem (15/09/2026) às 14:00 na Sala 1
  {
    id: 'bk-1005',
    userId: 'usr-helena',
    userEmail: 'helena@psico.com.br',
    userName: 'Dra. Helena Castro',
    clientId: 'cli-1',
    clientName: 'Maria da Silva',
    roomId: 'Sala 1',
    date: '2026-09-15',
    hour: 14,
    durationHours: 1,
    endTimeHour: 15,
    type: 'HOURLY',
    priceAtBooking: 40.0,
    totalAmount: 40.0,
    paymentStatus: 'PENDING',
    createdAt: '2026-09-06T15:20:00Z'
  },
  // 6. Reserva de Camila na quarta-feira (16/09/2026) às 10:00 na Sala 1
  {
    id: 'bk-1006',
    userId: 'usr-camila',
    userEmail: 'camila@saude.com.br',
    userName: 'Dra. Camila Rocha',
    clientId: 'cli-6',
    clientName: 'Renata Mendonça',
    roomId: 'Sala 1',
    date: '2026-09-16',
    hour: 10,
    durationHours: 1,
    endTimeHour: 11,
    type: 'HOURLY',
    priceAtBooking: 40.0,
    totalAmount: 40.0,
    paymentStatus: 'PAID',
    createdAt: '2026-09-07T08:15:00Z',
    paidAt: '2026-09-09T11:00:00Z',
    paidByAdmin: 'Dra. Sandra Ramos'
  },
  // 7. Reserva de Helena na quarta-feira (16/09/2026) às 14:00 na Sala 1
  {
    id: 'bk-1007',
    userId: 'usr-helena',
    userEmail: 'helena@psico.com.br',
    userName: 'Dra. Helena Castro',
    clientId: 'cli-3',
    clientName: 'Fernanda Lima',
    roomId: 'Sala 1',
    date: '2026-09-16',
    hour: 14,
    durationHours: 1,
    endTimeHour: 15,
    type: 'HOURLY',
    priceAtBooking: 40.0,
    totalAmount: 40.0,
    paymentStatus: 'PENDING',
    createdAt: '2026-09-07T14:10:00Z'
  },
  // 8. Reserva de Bruno (05/09/2026) - Passada
  {
    id: 'bk-1008',
    userId: 'usr-bruno',
    userEmail: 'bruno@terapia.com.br',
    userName: 'Dr. Bruno Mendes',
    clientId: 'cli-4',
    clientName: 'Lucas Alencar',
    roomId: 'Sala 1',
    date: '2026-09-05',
    hour: 9,
    durationHours: 2,
    endTimeHour: 11,
    type: 'HOURLY',
    priceAtBooking: 40.0,
    totalAmount: 80.0,
    paymentStatus: 'PAID',
    createdAt: '2026-09-01T08:00:00Z',
    paidAt: '2026-09-05T12:00:00Z',
    paidByAdmin: 'Dra. Sandra Ramos'
  },
  // 9. Reserva de Helena (03/09/2026) - Passada
  {
    id: 'bk-1009',
    userId: 'usr-helena',
    userEmail: 'helena@psico.com.br',
    userName: 'Dra. Helena Castro',
    clientId: 'cli-1',
    clientName: 'Maria da Silva',
    roomId: 'Sala 2',
    date: '2026-09-03',
    hour: 15,
    durationHours: 2,
    endTimeHour: 17,
    type: 'HOURLY',
    priceAtBooking: 40.0,
    totalAmount: 80.0,
    paymentStatus: 'PAID',
    createdAt: '2026-08-28T10:00:00Z',
    paidAt: '2026-09-03T18:00:00Z',
    paidByAdmin: 'Dra. Sandra Ramos'
  },
  // 10. Reserva de Helena (01/09/2026) - Passada
  {
    id: 'bk-1010',
    userId: 'usr-helena',
    userEmail: 'helena@psico.com.br',
    userName: 'Dra. Helena Castro',
    clientId: 'cli-2',
    clientName: 'João Pedro Carlos',
    roomId: 'Sala 1',
    date: '2026-09-01',
    hour: 10,
    durationHours: 1,
    endTimeHour: 11,
    type: 'HOURLY',
    priceAtBooking: 40.0,
    totalAmount: 40.0,
    paymentStatus: 'PAID',
    createdAt: '2026-08-25T11:00:00Z',
    paidAt: '2026-09-01T12:00:00Z',
    paidByAdmin: 'Dra. Sandra Ramos'
  }
];

export const INITIAL_BLOCKED_SLOTS: BlockedSlot[] = [
  {
    id: 'blk-1',
    roomId: 'Sala 1',
    date: '2026-09-17',
    startHour: 8,
    endHour: 11,
    reason: 'Higienização e Manutenção do Ar Condicionado',
    createdAt: '2026-09-01T10:00:00Z',
    createdBy: 'Dra. Sandra Ramos'
  },
  {
    id: 'blk-2',
    roomId: 'ALL',
    date: '2026-09-21',
    startHour: 12,
    endHour: 14,
    reason: 'Reunião Geral da Equipe Clínica',
    createdAt: '2026-09-02T14:00:00Z',
    createdBy: 'Dra. Sandra Ramos'
  }
];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'aud-1',
    userId: 'usr-admin',
    userName: 'Dra. Sandra Ramos',
    action: 'Criação do Sistema',
    details: 'Inicialização dos parâmetros clínicos e configuração inicial das 2 salas.',
    timestamp: '2026-09-01T08:00:00Z'
  },
  {
    id: 'aud-2',
    userId: 'usr-admin',
    userName: 'Dra. Sandra Ramos',
    action: 'Bloqueio de Horário',
    details: 'Bloqueio Sala 1 em 17/09/2026 (08h às 11h) para higienização.',
    timestamp: '2026-09-01T10:05:00Z'
  },
  {
    id: 'aud-3',
    userId: 'usr-admin',
    userName: 'Dra. Sandra Ramos',
    action: 'Confirmação de Pagamento',
    details: 'Baixa de pagamento no valor de R$ 40,00 para Dra. Helena Castro.',
    timestamp: '2026-09-05T14:00:00Z'
  }
];
