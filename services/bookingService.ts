import { Booking, RoomId, BookingType, PaymentStatus, BlockedSlot, SystemConfig, Room, PeriodShift } from '../types';
import { 
  getStoredBookings, saveStoredBookings, 
  getStoredBlockedSlots, saveStoredBlockedSlots, 
  getSystemConfig, saveSystemConfig, addAuditLog 
} from './storageService';
import { differenceInHours } from 'date-fns';
import { supabase, isSupabaseConfigured, translateSupabaseError } from './supabase';
import { getClosingHourForDate, SATURDAY_HOURS_END, INITIAL_PERIOD_RATES, getPeriodConfig, BOOKING_PERIODS } from '../constants';

function mapDbBookingToBooking(b: any, profilesMap?: Map<string, any>): Booking {
  const clientObj = Array.isArray(b.clients) ? b.clients[0] : b.clients;
  const profileObj = Array.isArray(b.profiles) ? b.profiles[0] : b.profiles;
  const uid = b.user_id || b.professional_id || '';
  const profile = profilesMap?.get(uid) || profileObj;

  const hour = Number(b.hour !== undefined ? b.hour : (b.start_time !== undefined ? b.start_time : 7));
  const duration = Number(b.duration_hours || b.total_hours || (b.end_time ? Number(b.end_time) - hour : 1));
  const endHour = Number(b.end_time_hour || b.end_time || (hour + duration));
  const price = Number(b.price_at_booking || b.hourly_rate || 40.0);
  const total = Number(b.total_amount || (price * duration));

  // Normalizar data (remover T00:00:00 se presente)
  const rawDate = String(b.date || b.booking_date || '');
  const cleanDate = rawDate.includes('T') ? rawDate.split('T')[0] : rawDate.trim();

  // Determina se é por período
  const rawType = String(b.type || b.booking_type || '').toUpperCase();
  const isPeriodType = rawType === 'PERIOD' || duration >= 4;
  const type: BookingType = isPeriodType ? 'PERIOD' : 'HOURLY';

  // Identificação e recuperação inteligente do turno (Manhã, Tarde ou Noite)
  let periodShift: PeriodShift | undefined = b.period_shift || b.periodShift;
  let periodName: string | undefined = b.period_name || b.periodName;

  const notesText = String(b.notes || '');
  if (!periodShift && isPeriodType) {
    if (notesText.includes('[PERIOD:AFTERNOON]') || notesText.includes('Tarde')) {
      periodShift = 'AFTERNOON';
    } else if (notesText.includes('[PERIOD:MORNING]') || notesText.includes('Manhã')) {
      periodShift = 'MORNING';
    } else if (notesText.includes('[PERIOD:NIGHT]') || notesText.includes('Noite')) {
      periodShift = 'NIGHT';
    } else {
      if (hour >= 12 && hour < 18) {
        periodShift = 'AFTERNOON';
      } else if (hour >= 7 && hour < 12) {
        periodShift = 'MORNING';
      } else if (hour >= 18) {
        periodShift = 'NIGHT';
      }
    }
  }

  if (!periodName && isPeriodType) {
    if (periodShift) {
      const pConf = BOOKING_PERIODS.find(p => p.id === periodShift);
      if (pConf) periodName = pConf.name;
    } else if (duration >= 14) {
      periodName = 'Integral';
    }
  }

  // Normalização de sala ('Sala 1' ou 'Sala 2')
  const rRaw = String(b.room_id || 'Sala 1').trim().toLowerCase();
  const roomId: RoomId = (rRaw === 'sala 2' || rRaw === '2') ? 'Sala 2' : 'Sala 1';

  const paymentStatus: PaymentStatus = (b.payment_status || (b.status === 'cancelled' ? 'CANCELLED' : 'PENDING')) as PaymentStatus;

  return {
    id: String(b.id),
    userId: uid,
    userEmail: b.user_email || profile?.email || '',
    userName: b.user_name || profile?.nome || profile?.full_name || 'Profissional',
    clientId: b.client_id || undefined,
    clientName: clientObj?.full_name || b.client_name || undefined,
    roomId,
    date: cleanDate,
    hour: hour,
    durationHours: duration,
    endTimeHour: endHour,
    type: type,
    periodShift,
    periodName,
    priceAtBooking: price,
    totalAmount: total,
    paymentStatus: paymentStatus,
    createdAt: b.created_at || new Date().toISOString(),
    notes: b.notes || undefined,
    paidAt: b.paid_at || undefined,
    paidNotes: b.paid_notes || undefined,
    paidByAdmin: b.paid_by_admin || undefined
  };
}

const isValidUUID = (id: string | undefined | null): boolean => {
  if (!id || typeof id !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id.trim());
};

const safeInsertAuditLog = async (logData: { user_id: string; user_name: string; action: string; details: string }) => {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('audit_logs').insert(logData).select().maybeSingle();
  } catch {
    // Falha silenciosa de auditoria remota
  }
};

function mapDbBlockToBlockedSlot(blk: any): BlockedSlot {
  return {
    id: blk.id,
    roomId: blk.room_id as RoomId | 'ALL',
    date: blk.blocked_date,
    startHour: blk.start_time,
    endHour: blk.end_time,
    reason: blk.reason,
    createdAt: blk.created_at || new Date().toISOString(),
    createdBy: blk.created_by || 'Administração'
  };
}

function mapDbRoomToRoom(r: any): Room {
  return {
    id: r.id as RoomId,
    name: r.name,
    description: r.description || '',
    hourlyRate: Number(r.hourly_rate || 40.0),
    dailyRate: Number(r.period_rate || 350.0),
    morningRate: Number(r.morning_rate || r.morningRate || INITIAL_PERIOD_RATES.MORNING),
    afternoonRate: Number(r.afternoon_rate || r.afternoonRate || INITIAL_PERIOD_RATES.AFTERNOON),
    nightRate: Number(r.night_rate || r.nightRate || INITIAL_PERIOD_RATES.NIGHT),
    status: (r.status || 'ACTIVE') as 'ACTIVE' | 'MAINTENANCE',
    openHour: Number(r.opening_time || 7),
    closeHour: Number(r.closing_time || 22),
    notes: r.notes
  };
}

export const bookingService = {
  // Retorna todos os agendamentos ativos
  getAllBookings: async (): Promise<Booking[]> => {
    const localBookings = getStoredBookings();
    const localActive = localBookings.filter(b => b.paymentStatus !== 'CANCELLED');

    if (isSupabaseConfigured) {
      try {
        const [bookRes, profRes] = await Promise.all([
          supabase.from('bookings').select('*'),
          supabase.from('profiles').select('*')
        ]);

        if (bookRes.data && Array.isArray(bookRes.data)) {
          const profilesMap = new Map<string, any>();
          if (profRes.data) {
            profRes.data.forEach((p: any) => profilesMap.set(p.id, p));
          }

          const localMap = new Map<string, Booking>();
          localBookings.forEach(lb => localMap.set(String(lb.id), lb));

          const activeRemote = bookRes.data
            .filter((b: any) => {
              const status = (b.payment_status || b.status || '').toUpperCase();
              return status !== 'CANCELLED';
            })
            .map((b: any) => {
              const mapped = mapDbBookingToBooking(b, profilesMap);
              const localMatch = localMap.get(mapped.id);
              if (localMatch) {
                return {
                  ...mapped,
                  clientName: localMatch.clientName || mapped.clientName,
                  notes: localMatch.notes || mapped.notes,
                  paymentStatus: localMatch.paymentStatus || mapped.paymentStatus,
                  durationHours: localMatch.durationHours || mapped.durationHours,
                  endTimeHour: localMatch.endTimeHour || mapped.endTimeHour,
                  periodShift: localMatch.periodShift || mapped.periodShift,
                  periodName: localMatch.periodName || mapped.periodName,
                  type: localMatch.type || mapped.type
                };
              }
              return mapped;
            });

          // PRESERVA RESERVAS LOCAIS QUE AINDA NÃO FORAM SINCRONIZADAS COM O SUPABASE
          const remoteIds = new Set(activeRemote.map(b => String(b.id)));
          const unSyncedLocal = localActive.filter(lb => {
            if (remoteIds.has(String(lb.id))) return false;
            const overlapsWithRemote = activeRemote.some(rb => 
              rb.roomId.toLowerCase().trim() === lb.roomId.toLowerCase().trim() &&
              rb.date === lb.date &&
              Math.max(rb.hour, lb.hour) < Math.min(rb.endTimeHour, lb.endTimeHour)
            );
            return !overlapsWithRemote;
          });

          // Consolida remotas com locais ativas
          const combined = [...activeRemote, ...unSyncedLocal];
          saveStoredBookings(combined);

          return combined;
        }
      } catch (err) {
        console.warn('Erro ao carregar reservas do Supabase, usando local:', err);
      }
    }

    return localActive;
  },

  // Retorna inclusive os cancelados se necessário para auditoria
  getAllBookingsWithCancelled: async (): Promise<Booking[]> => {
    if (isSupabaseConfigured) {
      try {
        const [bookRes, profRes] = await Promise.all([
          supabase.from('bookings').select('*'),
          supabase.from('profiles').select('*')
        ]);

        if (bookRes.data) {
          const profilesMap = new Map<string, any>();
          if (profRes.data) {
            profRes.data.forEach((p: any) => profilesMap.set(p.id, p));
          }

          const localBookings = getStoredBookings();
          const localMap = new Map<string, Booking>();
          localBookings.forEach(lb => localMap.set(lb.id, lb));

          return bookRes.data.map((b: any) => {
            const mapped = mapDbBookingToBooking(b, profilesMap);
            const localMatch = localMap.get(mapped.id);
            if (localMatch) {
              return {
                ...mapped,
                clientName: localMatch.clientName || mapped.clientName,
                notes: localMatch.notes || mapped.notes,
                paymentStatus: localMatch.paymentStatus || mapped.paymentStatus,
                durationHours: localMatch.durationHours || mapped.durationHours,
                endTimeHour: localMatch.endTimeHour || mapped.endTimeHour
              };
            }
            return mapped;
          });
        }
      } catch (err) {
        console.warn('Erro ao carregar todas as reservas do Supabase, usando local:', err);
      }
    }

    return getStoredBookings();
  },

  // Busca agendamentos de um profissional específico
  getBookingsByProfessional: async (userId: string): Promise<Booking[]> => {
    if (isSupabaseConfigured) {
      try {
        const all = await bookingService.getAllBookings();
        return all.filter(b => b.userId === userId);
      } catch (err) {
        console.warn('Erro ao carregar reservas do profissional do Supabase, usando local:', err);
      }
    }

    const all = getStoredBookings();
    return all.filter(b => b.userId === userId);
  },

  // Regra Crítica de Conflito (#26 e Seção 21)
  checkConflict: async (
    roomId: RoomId,
    date: string,
    startHour: number,
    endHour: number,
    excludeBookingId?: string
  ): Promise<{ hasConflict: boolean; reason?: string }> => {
    // 0. Regra: Domingo fechado e Sábado até 14h
    if (date) {
      const [y, m, d] = date.split('-').map(Number);
      const dayOfWeek = new Date(y, m - 1, d).getDay();
      if (dayOfWeek === 0) {
        return { 
          hasConflict: true, 
          reason: 'As salas não são utilizadas aos domingos.' 
        };
      }
      const closingHour = getClosingHourForDate(dayOfWeek);
      if (endHour > closingHour || startHour >= closingHour) {
        return {
          hasConflict: true,
          reason: dayOfWeek === 6 
            ? 'Aos sábados o atendimento das salas vai somente até as 14:00.' 
            : `O horário de encerramento das salas neste dia é às ${closingHour}:00.`
        };
      }
    }

    // 1. Verificação no Supabase quando conectado
    if (isSupabaseConfigured) {
      try {
        // Verifica bloqueios
        const { data: blocks, error: blockErr } = await supabase
          .from('blocked_slots')
          .select('*')
          .eq('blocked_date', date);

        if (!blockErr && blocks) {
          const overlappingBlock = blocks.find((blk: any) => {
            if (blk.room_id !== 'ALL' && blk.room_id !== roomId) return false;
            const bStart = Number(blk.start_time);
            const bEnd = Number(blk.end_time);
            return Math.max(startHour, bStart) < Math.min(endHour, bEnd);
          });
          if (overlappingBlock) {
            return {
              hasConflict: true,
              reason: `Horário bloqueado pela administração: ${(overlappingBlock as any).reason}`
            };
          }
        }

        // Verifica reservas na data e sala
        const { data: existingBookings, error: bookErr } = await supabase
          .from('bookings')
          .select('*');

        if (!bookErr && existingBookings) {
          const normRoom = String(roomId).trim().toLowerCase();
          const normDate = String(date).split('T')[0].trim();

          const dayBookings = existingBookings.filter((b: any) => {
            const bRoom = String(b.room_id || '').trim().toLowerCase();
            const bRawDate = String(b.date || b.booking_date || '');
            const bDate = bRawDate.includes('T') ? bRawDate.split('T')[0] : bRawDate.trim();
            const bStatus = (b.payment_status || b.status || '').toUpperCase();

            if (bRoom !== normRoom) return false;
            if (bDate !== normDate) return false;
            if (bStatus === 'CANCELLED') return false;
            if (excludeBookingId && String(b.id) === String(excludeBookingId)) return false;
            return true;
          });

          for (const b of dayBookings) {
            const bStart = Number(b.hour !== undefined ? b.hour : b.start_time);
            const bDuration = Number(b.duration_hours || b.total_hours || (b.end_time ? Number(b.end_time) - bStart : 1));
            const bEnd = Number(b.end_time_hour || b.end_time || (bStart + bDuration));
            const bType = b.type || b.booking_type;

            if (Math.max(startHour, bStart) < Math.min(endHour, bEnd)) {
              const periodLabel = b.period_name || b.periodName 
                ? ` (Período da ${b.period_name || b.periodName})` 
                : (bType === 'PERIOD' && (bEnd - bStart >= 14) ? ' (Período Integral)' : '');
              return { 
                hasConflict: true, 
                reason: `O horário das ${bStart}:00 às ${bEnd}:00${periodLabel} já está reservado nesta sala.` 
              };
            }
          }
          return { hasConflict: false };
        }
      } catch (e) {
        console.warn('Erro ao checar conflito no Supabase, checando local:', e);
      }
    }

    // Fallback: verificação com armazenamento local
    const allBookings = getStoredBookings().filter(b => 
      b.paymentStatus !== 'CANCELLED' && 
      (!excludeBookingId || b.id !== excludeBookingId)
    );
    const allBlocks = getStoredBlockedSlots();
    const targetRoomNorm = String(roomId).trim().toLowerCase();
    const targetDateNorm = String(date).split('T')[0].trim();

    // 1. Verifica bloqueios administrativos para a sala ou para todas as salas
    const overlappingBlock = allBlocks.find(blk => {
      const blkDate = String(blk.date || '').split('T')[0].trim();
      const blkRoom = String(blk.roomId || '').trim().toLowerCase();
      if (blkDate !== targetDateNorm) return false;
      if (blkRoom !== 'all' && blkRoom !== targetRoomNorm) return false;
      return Math.max(startHour, blk.startHour) < Math.min(endHour, blk.endHour);
    });

    if (overlappingBlock) {
      return { 
        hasConflict: true, 
        reason: `Horário bloqueado pela administração: ${overlappingBlock.reason}` 
      };
    }

    // 2. Verifica reservas existentes na mesma sala e data
    const sameDayRoomBookings = allBookings.filter(b => {
      const bRoom = String(b.roomId || '').trim().toLowerCase();
      const bDate = String(b.date || '').split('T')[0].trim();
      return bRoom === targetRoomNorm && bDate === targetDateNorm;
    });

    for (const b of sameDayRoomBookings) {
      const bStart = Number(b.hour !== undefined ? b.hour : 7);
      const bDur = Number(b.durationHours || 1);
      const bEnd = Number(b.endTimeHour || (bStart + bDur));

      if (Math.max(startHour, bStart) < Math.min(endHour, bEnd)) {
        const periodLabel = b.periodName 
          ? ` (Período da ${b.periodName})` 
          : (b.type === 'PERIOD' && (bEnd - bStart >= 14) ? ' (Período Integral)' : '');
        return { 
          hasConflict: true, 
          reason: `O horário das ${bStart}:00 às ${bEnd}:00${periodLabel} já está reservado nesta sala.` 
        };
      }
    }

    return { hasConflict: false };
  },

  // Criação da locação com congelamento de valores (Seção 11 e Seção 24)
  createBooking: async (params: {
    userId: string;
    userEmail: string;
    userName: string;
    clientId?: string;
    clientName?: string;
    roomId: RoomId;
    date: string;
    hour: number;
    durationHours?: number;
    type?: BookingType;
    periodShift?: PeriodShift;
    periodName?: string;
    notes?: string;
  }): Promise<Booking> => {
    let hourlyRate = 40.0;
    let periodRate = 350.0;
    let morningRate = INITIAL_PERIOD_RATES.MORNING;
    let afternoonRate = INITIAL_PERIOD_RATES.AFTERNOON;
    let nightRate = INITIAL_PERIOD_RATES.NIGHT;
    let openHour = 7;
    let closeHour = 22;

    // Busca tarifas e horários das salas
    if (isSupabaseConfigured) {
      try {
        const { data: roomData } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', params.roomId)
          .maybeSingle();

        if (roomData) {
          hourlyRate = Number(roomData.hourly_rate);
          periodRate = Number(roomData.period_rate);
          if (roomData.morning_rate) morningRate = Number(roomData.morning_rate);
          if (roomData.afternoon_rate) afternoonRate = Number(roomData.afternoon_rate);
          if (roomData.night_rate) nightRate = Number(roomData.night_rate);
          openHour = Number(roomData.opening_time);
          closeHour = Number(roomData.closing_time);
        }
      } catch (e) {
        console.warn('Erro ao obter tarifas da sala no Supabase:', e);
      }
    } else {
      const config = getSystemConfig();
      const room = config.rooms.find(r => r.id === params.roomId);
      if (room) {
        hourlyRate = room.hourlyRate;
        periodRate = room.dailyRate;
        if (room.morningRate) morningRate = room.morningRate;
        if (room.afternoonRate) afternoonRate = room.afternoonRate;
        if (room.nightRate) nightRate = room.nightRate;
        openHour = room.openHour;
        closeHour = room.closeHour;
      }
    }

    const isPeriod = params.type === 'PERIOD';
    const periodShift: PeriodShift = params.periodShift || 'MORNING';
    const periodConf = getPeriodConfig(periodShift, params.date);

    const startHour = isPeriod ? periodConf.startHour : params.hour;
    const duration = isPeriod ? periodConf.duration : (params.durationHours || 1);
    const endHour = startHour + duration;
    const periodName = params.periodName || periodConf.name;

    // 1. Validação estrita de conflito no frontend
    const conflict = await bookingService.checkConflict(params.roomId, params.date, startHour, endHour);
    if (conflict.hasConflict) {
      throw new Error(conflict.reason || 'Este horário não está mais disponível.');
    }

    // 2. Cálculo financeiro com congelamento de valor
    const priceAtBooking = hourlyRate;
    let totalAmount = 0;
    if (isPeriod) {
      if (periodShift === 'MORNING') {
        totalAmount = morningRate;
      } else if (periodShift === 'AFTERNOON') {
        const isSat = getClosingHourForDate(params.date) === SATURDAY_HOURS_END;
        totalAmount = isSat ? Math.round(afternoonRate * (2 / 6)) : afternoonRate;
      } else if (periodShift === 'NIGHT') {
        totalAmount = nightRate;
      } else {
        totalAmount = periodRate;
      }
    } else {
      totalAmount = duration * hourlyRate;
    }

    // 3. Persistência no Supabase e Local
    let createdBookingId = 'bk-' + Date.now();
    let syncedToSupabase = false;

    if (isSupabaseConfigured) {
      try {
        const isValidUUID = (val?: string): boolean => 
          Boolean(val && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val));

        // 1. Obter ID do profissional válido (UUID)
        let professionalId: string | null = isValidUUID(params.userId) ? params.userId : null;
        if (!professionalId) {
          try {
            const { data: authData } = await supabase.auth.getUser();
            if (authData?.user?.id && isValidUUID(authData.user.id)) {
              professionalId = authData.user.id;
            }
          } catch {}
        }

        // 2. Obter ID de cliente válido (UUID) ou null
        const clientId: string | null = isValidUUID(params.clientId) ? (params.clientId as string) : null;

        if (professionalId) {
          const notesWithMeta = isPeriod 
            ? `[PERIOD:${periodShift}] [Turno: ${periodName}] ${params.notes || ''}`.trim()
            : (params.notes || null);

          // Tentativa 1: Inserção com colunas completas incluindo period_shift e period_name
          const fullPayload: any = {
            professional_id: professionalId,
            client_id: clientId,
            room_id: params.roomId,
            booking_date: params.date,
            start_time: startHour,
            end_time: endHour,
            booking_type: isPeriod ? 'PERIOD' : 'HOURLY',
            total_hours: duration,
            hourly_rate: hourlyRate,
            period_rate: isPeriod ? totalAmount : periodRate,
            total_amount: totalAmount,
            payment_status: 'PENDING',
            status: 'confirmed',
            notes: notesWithMeta,
            period_shift: isPeriod ? periodShift : null,
            period_name: isPeriod ? periodName : null
          };

          const { data: createdWithPeriod, error: periodErr } = await supabase
            .from('bookings')
            .insert(fullPayload)
            .select()
            .maybeSingle();

          if (!periodErr && createdWithPeriod) {
            createdBookingId = String(createdWithPeriod.id);
            syncedToSupabase = true;
          } else {
            // Se falhar devido à ausência das colunas period_shift/period_name na tabela remota, tenta sem elas
            const stdPayload = { ...fullPayload };
            delete stdPayload.period_shift;
            delete stdPayload.period_name;

            const { data: createdStd, error: stdErr } = await supabase
              .from('bookings')
              .insert(stdPayload)
              .select()
              .maybeSingle();

            if (!stdErr && createdStd) {
              createdBookingId = String(createdStd.id);
              syncedToSupabase = true;
            } else {
              console.warn('Aviso ao inserir no Supabase (reserva preservada localmente):', stdErr || periodErr);
            }
          }
        }

        if (syncedToSupabase) {
          try {
            await supabase.from('audit_logs').insert({
              user_id: professionalId,
              user_name: params.userName,
              action: 'Nova Reserva',
              details: `Locação criada: ${params.roomId}, ${params.date} das ${startHour}:00 às ${endHour}:00 (${isPeriod ? `Período da ${periodName}` : `${duration}h`}) (Total: R$ ${totalAmount.toFixed(2)})`
            });
          } catch {}
        }
      } catch (err: any) {
        console.warn('Aviso na sincronização de reserva:', err);
      }
    }

    const newBooking: Booking = {
      id: createdBookingId,
      userId: params.userId,
      userEmail: params.userEmail,
      userName: params.userName,
      clientId: params.clientId,
      clientName: params.clientName,
      roomId: params.roomId,
      date: params.date,
      hour: startHour,
      durationHours: duration,
      endTimeHour: endHour,
      type: isPeriod ? 'PERIOD' : 'HOURLY',
      periodShift: isPeriod ? periodShift : undefined,
      periodName: isPeriod ? periodName : undefined,
      priceAtBooking,
      totalAmount,
      paymentStatus: 'PENDING',
      createdAt: new Date().toISOString(),
      notes: params.notes
    };

    const current = getStoredBookings();
    saveStoredBookings([newBooking, ...current.filter(b => b.id !== newBooking.id)]);

    addAuditLog(
      params.userId,
      params.userName,
      'Nova Reserva',
      `Locação criada: ${params.roomId}, ${params.date} das ${startHour}:00 às ${endHour}:00 (${isPeriod ? `Período da ${periodName}` : `${duration}h`}) (Total: R$ ${totalAmount.toFixed(2)})`
    );

    return newBooking;
  },

  // Cancelamento de locação respeitando as regras configuradas (Seção 44)
  cancelBooking: async (bookingId: string, user: { id: string; name: string; role: string; email?: string }): Promise<void> => {
    const isAdmin = user.role === 'ADMIN';
    const isUUID = isValidUUID(bookingId);
    const localBookings = getStoredBookings();
    let localIndex = localBookings.findIndex(b => b.id === bookingId || String(b.id).trim() === String(bookingId).trim());
    let localTarget: Booking | undefined = localIndex !== -1 ? localBookings[localIndex] : undefined;

    let remoteTarget: any = null;

    // 1. Se o Supabase estiver configurado e o ID for um UUID válido, tenta localizar no Supabase
    if (isSupabaseConfigured && isUUID) {
      try {
        const { data, error } = await supabase
          .from('bookings')
          .select('*')
          .eq('id', bookingId)
          .maybeSingle();

        if (!error && data) {
          remoteTarget = data;
        }
      } catch (err) {
        console.warn('Erro ao consultar reserva no Supabase:', err);
      }
    }

    // 2. Se não encontrou por UUID mas temos o localTarget, tenta localizar no Supabase pelo slot (sala, data e hora inicial)
    if (isSupabaseConfigured && !remoteTarget && localTarget) {
      try {
        const cleanDate = String(localTarget.date).split('T')[0];
        const { data, error } = await supabase
          .from('bookings')
          .select('*')
          .eq('room_id', localTarget.roomId)
          .eq('booking_date', cleanDate)
          .eq('start_time', localTarget.hour)
          .maybeSingle();

        if (!error && data) {
          remoteTarget = data;
        }
      } catch (err) {
        console.warn('Tentativa de busca por slot no Supabase falhou:', err);
      }
    }

    // 3. Se não encontrou por ID exato, faz uma busca flexível no Local Storage (ex: se ID tiver variações de string)
    if (!remoteTarget && !localTarget) {
      const approx = localBookings.find(b => String(b.id).includes(bookingId) || bookingId.includes(String(b.id)));
      if (approx) {
        localTarget = approx;
        localIndex = localBookings.findIndex(b => b.id === approx.id);
      }
    }

    // Se a reserva realmente não existe nem no Supabase nem localmente
    if (!remoteTarget && !localTarget) {
      throw new Error('Reserva não encontrada.');
    }

    // 4. Validação de Permissão (Dono da reserva ou Administrador)
    const ownerId = remoteTarget?.professional_id || remoteTarget?.user_id || localTarget?.userId;
    const ownerEmail = remoteTarget?.user_email || localTarget?.userEmail;
    const isOwner = ownerId === user.id || (Boolean(user.email) && Boolean(ownerEmail) && user.email === ownerEmail);

    if (!isAdmin && !isOwner) {
      throw new Error('Você só pode cancelar suas próprias reservas.');
    }

    // 5. Validação de Antecedência Mínima de Cancelamento (Padrão 24h ou conforme configuração do sistema)
    if (!isAdmin) {
      const config = getSystemConfig();
      const limitHours = config.cancellationLimitHours ?? 24;

      const dateStr = String(remoteTarget?.booking_date || localTarget?.date || '').split('T')[0];
      const startHour = Number(remoteTarget?.start_time !== undefined ? remoteTarget.start_time : localTarget?.hour ?? 7);

      if (dateStr) {
        const bookingStartTime = new Date(`${dateStr}T${startHour.toString().padStart(2, '0')}:00:00`);
        const hoursDiff = differenceInHours(bookingStartTime, new Date());

        if (hoursDiff < limitHours) {
          throw new Error(`Cancelamentos só podem ser realizados com no mínimo ${limitHours}h de antecedência do horário agendado.`);
        }
      }
    }

    // 6. Atualiza no Supabase caso a reserva exista remotamente
    if (isSupabaseConfigured && remoteTarget) {
      try {
        const { error: updateErr } = await supabase
          .from('bookings')
          .update({
            payment_status: 'CANCELLED',
            status: 'cancelled'
          })
          .eq('id', remoteTarget.id);

        if (!updateErr) {
          await safeInsertAuditLog({
            user_id: user.id,
            user_name: user.name,
            action: 'Cancelamento de Reserva',
            details: `Reserva ${remoteTarget.id} (${remoteTarget.room_id}, ${remoteTarget.booking_date}) foi cancelada.`
          });
        } else {
          console.warn('Erro ao atualizar cancelamento no Supabase:', updateErr);
        }
      } catch (e) {
        console.warn('Falha na comunicação com Supabase durante cancelamento:', e);
      }
    }

    // 7. Atualiza no Local Storage
    const currentLocal = getStoredBookings();
    const updatedLocal = currentLocal.map(b => {
      const isDirectMatch = b.id === bookingId || (remoteTarget && b.id === remoteTarget.id) || (localTarget && b.id === localTarget.id);
      const isSlotMatch = remoteTarget && 
        b.roomId.toLowerCase().trim() === String(remoteTarget.room_id).toLowerCase().trim() &&
        b.date === String(remoteTarget.booking_date).split('T')[0] &&
        b.hour === remoteTarget.start_time;

      if (isDirectMatch || isSlotMatch) {
        return {
          ...b,
          paymentStatus: 'CANCELLED' as PaymentStatus
        };
      }
      return b;
    });

    if (localIndex !== -1 && !updatedLocal.some(b => (b.id === bookingId || b.id === localTarget?.id) && b.paymentStatus === 'CANCELLED')) {
      updatedLocal[localIndex] = {
        ...updatedLocal[localIndex],
        paymentStatus: 'CANCELLED' as PaymentStatus
      };
    }

    saveStoredBookings(updatedLocal);

    // 8. Registro de Auditoria
    const roomRef = remoteTarget?.room_id || localTarget?.roomId || '';
    const dateRef = remoteTarget?.booking_date || localTarget?.date || '';
    addAuditLog(
      user.id,
      user.name,
      'Cancelamento de Reserva',
      `Reserva ${bookingId} (${roomRef}, ${dateRef}) foi cancelada com sucesso.`
    );
  },

  // Atualização do status de pagamento (ex: marcar como "Pago")
  updatePaymentStatus: async (params: {
    bookingId: string;
    newStatus: PaymentStatus;
    adminUser: { id: string; name: string };
    paidNotes?: string;
  }): Promise<Booking> => {
    const isUUID = isValidUUID(params.bookingId);

    if (isSupabaseConfigured && isUUID) {
      try {
        const payload: any = {
          payment_status: params.newStatus,
          paid_notes: params.paidNotes,
          paid_by_admin: params.adminUser.name,
          paid_at: params.newStatus === 'PAID' ? new Date().toISOString() : null
        };

        const { data: updated, error } = await supabase
          .from('bookings')
          .update(payload)
          .eq('id', params.bookingId)
          .select('*, clients(full_name), profiles:professional_id(full_name, email)')
          .maybeSingle();

        if (!error && updated) {
          // Se marcado como pago, insere registro em public.payments
          if (params.newStatus === 'PAID') {
            try {
              await supabase.from('payments').insert({
                booking_id: updated.id,
                professional_id: updated.professional_id,
                amount: updated.total_amount,
                payment_date: new Date().toISOString().split('T')[0],
                status: 'PAID',
                notes: params.paidNotes || 'Pagamento confirmado pelo administrador',
                created_by: params.adminUser.name
              });
            } catch {
              // Ignore remote payments insert error
            }
          }

          await safeInsertAuditLog({
            user_id: params.adminUser.id,
            user_name: params.adminUser.name,
            action: 'Controle Financeiro / Pagamento',
            details: `Reserva ${params.bookingId} alterada para status: ${params.newStatus}.`
          });

          const local = getStoredBookings();
          saveStoredBookings(local.map(b => b.id === params.bookingId ? { ...b, paymentStatus: params.newStatus } : b));

          return mapDbBookingToBooking(updated);
        }
      } catch (err: any) {
        console.warn('Erro ao atualizar status de pagamento no Supabase, atualizando localmente:', err);
      }
    }

    const bookings = getStoredBookings();
    const index = bookings.findIndex(b => b.id === params.bookingId);
    if (index === -1) throw new Error('Reserva não encontrada.');

    const target = bookings[index];
    const updated: Booking = {
      ...target,
      paymentStatus: params.newStatus,
      paidAt: params.newStatus === 'PAID' ? new Date().toISOString() : undefined,
      paidNotes: params.paidNotes,
      paidByAdmin: params.adminUser.name
    };

    bookings[index] = updated;
    saveStoredBookings(bookings);

    addAuditLog(
      params.adminUser.id,
      params.adminUser.name,
      'Controle Financeiro / Pagamento',
      `Reserva ${params.bookingId} (${target.roomId}, ${target.date}) alterada para status: ${params.newStatus}.`
    );

    return updated;
  },

  // Gerenciamento de Bloqueios Administrativos
  getBlockedSlots: async (): Promise<BlockedSlot[]> => {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('blocked_slots')
          .select('*')
          .order('blocked_date', { ascending: true });

        if (error) throw error;
        if (data) {
          return data.map(mapDbBlockToBlockedSlot);
        }
      } catch (err) {
        console.warn('Erro ao carregar bloqueios do Supabase, usando local:', err);
      }
    }

    return getStoredBlockedSlots();
  },

  createBlockedSlot: async (
    slotData: Omit<BlockedSlot, 'id' | 'createdAt'>,
    adminUser: { id: string; name: string }
  ): Promise<BlockedSlot> => {
    if (slotData.date) {
      const [y, m, d] = slotData.date.split('-').map(Number);
      if (new Date(y, m - 1, d).getDay() === 0) {
        throw new Error('As salas já não são utilizadas aos domingos.');
      }
    }

    if (isSupabaseConfigured) {
      try {
        const payload = {
          room_id: slotData.roomId,
          blocked_date: slotData.date,
          start_time: slotData.startHour,
          end_time: slotData.endHour,
          reason: slotData.reason,
          created_by: adminUser.name
        };

        const { data: created, error } = await supabase
          .from('blocked_slots')
          .insert(payload)
          .select()
          .single();

        if (error) throw error;

        await supabase.from('audit_logs').insert({
          user_id: adminUser.id,
          user_name: adminUser.name,
          action: 'Bloqueio de Horário',
          details: `Bloqueio criado para ${slotData.roomId} em ${slotData.date} (${slotData.startHour}h-${slotData.endHour}h): ${slotData.reason}`
        });

        return mapDbBlockToBlockedSlot(created);
      } catch (err: any) {
        throw new Error(translateSupabaseError(err));
      }
    }

    const blocks = getStoredBlockedSlots();
    const newBlock: BlockedSlot = {
      ...slotData,
      id: 'blk-' + Date.now(),
      createdAt: new Date().toISOString()
    };

    saveStoredBlockedSlots([newBlock, ...blocks]);

    addAuditLog(
      adminUser.id,
      adminUser.name,
      'Bloqueio de Horário',
      `Bloqueio criado para ${slotData.roomId} em ${slotData.date} (${slotData.startHour}h-${slotData.endHour}h): ${slotData.reason}`
    );

    return newBlock;
  },

  deleteBlockedSlot: async (blockId: string, adminUser: { id: string; name: string }): Promise<void> => {
    if (isSupabaseConfigured && isValidUUID(blockId)) {
      try {
        const { error } = await supabase.from('blocked_slots').delete().eq('id', blockId);
        if (!error) {
          await safeInsertAuditLog({
            user_id: adminUser.id,
            user_name: adminUser.name,
            action: 'Remoção de Bloqueio',
            details: `Bloqueio ${blockId} foi desativado.`
          });
        }
      } catch (err: any) {
        console.warn('Erro ao remover bloqueio no Supabase:', err);
      }
    }

    const blocks = getStoredBlockedSlots();
    const filtered = blocks.filter(b => b.id !== blockId);
    saveStoredBlockedSlots(filtered);

    addAuditLog(
      adminUser.id,
      adminUser.name,
      'Remoção de Bloqueio',
      `Bloqueio ${blockId} foi desativado.`
    );
  },

  // Gerenciamento das Salas e Tarifas
  getRooms: async (): Promise<Room[]> => {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('rooms')
          .select('*')
          .order('id', { ascending: true });

        if (!error && data && data.length > 0) {
          return data.map(mapDbRoomToRoom);
        }
      } catch (e) {
        console.warn('Erro ao buscar salas no Supabase, usando local:', e);
      }
    }

    const config = getSystemConfig();
    return (config.rooms || []).map(r => ({
      ...r,
      morningRate: Number(r.morningRate ?? INITIAL_PERIOD_RATES.MORNING),
      afternoonRate: Number(r.afternoonRate ?? INITIAL_PERIOD_RATES.AFTERNOON),
      nightRate: Number(r.nightRate ?? INITIAL_PERIOD_RATES.NIGHT)
    }));
  },

  updateRoomRates: async (
    roomId: RoomId,
    hourlyRate: number,
    dailyRate: number,
    adminUser: { id: string; name: string },
    morningRate?: number,
    afternoonRate?: number,
    nightRate?: number
  ): Promise<void> => {
    const finalMorning = morningRate !== undefined ? morningRate : INITIAL_PERIOD_RATES.MORNING;
    const finalAfternoon = afternoonRate !== undefined ? afternoonRate : INITIAL_PERIOD_RATES.AFTERNOON;
    const finalNight = nightRate !== undefined ? nightRate : INITIAL_PERIOD_RATES.NIGHT;
    const finalDaily = dailyRate > 0 ? dailyRate : (finalMorning + finalAfternoon + finalNight);

    if (isSupabaseConfigured) {
      try {
        const updatePayload: any = {
          hourly_rate: hourlyRate,
          period_rate: finalDaily
        };
        if (morningRate !== undefined) updatePayload.morning_rate = finalMorning;
        if (afternoonRate !== undefined) updatePayload.afternoon_rate = finalAfternoon;
        if (nightRate !== undefined) updatePayload.night_rate = finalNight;

        let { error } = await supabase
          .from('rooms')
          .update(updatePayload)
          .eq('id', roomId);

        // Fallback caso as colunas de turnos ainda não existam no banco remoto
        if (error && (error.code === '42703' || String(error.message).includes('_rate'))) {
          const fallbackRes = await supabase
            .from('rooms')
            .update({
              hourly_rate: hourlyRate,
              period_rate: finalDaily
            })
            .eq('id', roomId);
          error = fallbackRes.error;
        }

        if (!error) {
          await safeInsertAuditLog({
            user_id: adminUser.id,
            user_name: adminUser.name,
            action: 'Alteração de Preço',
            details: `Novos valores para ${roomId}: Hora R$ ${hourlyRate.toFixed(2)} | Manhã R$ ${finalMorning.toFixed(2)} | Tarde R$ ${finalAfternoon.toFixed(2)} | Noite R$ ${finalNight.toFixed(2)}`
          });
        }
      } catch (err: any) {
        console.warn('Erro ao persistir novas tarifas no Supabase:', err);
      }
    }

    const config = getSystemConfig();
    const room = config.rooms.find(r => r.id === roomId);
    if (!room) throw new Error('Sala não encontrada.');

    room.hourlyRate = hourlyRate;
    room.dailyRate = finalDaily;
    room.morningRate = finalMorning;
    room.afternoonRate = finalAfternoon;
    room.nightRate = finalNight;

    saveSystemConfig(config);

    addAuditLog(
      adminUser.id,
      adminUser.name,
      'Alteração de Preço',
      `Novos valores para ${roomId}: Hora R$ ${hourlyRate.toFixed(2)} | Manhã R$ ${finalMorning.toFixed(2)} | Tarde R$ ${finalAfternoon.toFixed(2)} | Noite R$ ${finalNight.toFixed(2)}`
    );
  },

  // Helpers de Configuração Global
  getCurrentHourlyRate: async (roomId: RoomId = 'Sala 1'): Promise<number> => {
    if (isSupabaseConfigured) {
      try {
        const { data } = await supabase
          .from('rooms')
          .select('hourly_rate')
          .eq('id', roomId)
          .maybeSingle();
        if (data?.hourly_rate) return Number(data.hourly_rate);
      } catch (e) {}
    }
    const config = getSystemConfig();
    const room = config.rooms.find(r => r.id === roomId);
    return room ? room.hourlyRate : 40.0;
  },

  getUnblockedHolidays: async (): Promise<string[]> => {
    const config = getSystemConfig();
    return config.unblockedHolidays || [];
  },

  isGlobalHolidaysAllowed: async (): Promise<boolean> => {
    const config = getSystemConfig();
    return !!config.allowHolidaysGlobal;
  },

  toggleGlobalHolidays: async (): Promise<boolean> => {
    const config = getSystemConfig();
    config.allowHolidaysGlobal = !config.allowHolidaysGlobal;
    saveSystemConfig(config);
    return config.allowHolidaysGlobal;
  },

  toggleHolidayStatus: async (dateKey: string): Promise<string[]> => {
    const config = getSystemConfig();
    const current = config.unblockedHolidays || [];
    const newList = current.includes(dateKey)
      ? current.filter(d => d !== dateKey)
      : [...current, dateKey];

    config.unblockedHolidays = newList;
    saveSystemConfig(config);
    return newList;
  },

  deleteBookingsByUserId: async (userId: string): Promise<void> => {
    if (isSupabaseConfigured) {
      try {
        await supabase.from('bookings').delete().eq('professional_id', userId);
      } catch (e) {}
    }
    const bookings = getStoredBookings();
    const filtered = bookings.filter(b => b.userId !== userId);
    saveStoredBookings(filtered);
  }
};

