import { 
  Booking, RoomId, BookingType, PeriodShift, 
  RecurrenceConfig, RecurrenceFrequency, 
  RecurrenceOccurrencePreview, RecurrencePreviewSummary, Role 
} from '../types';
import { bookingService } from './bookingService';
import { 
  getClosingHourForDate, SATURDAY_HOURS_END, 
  INITIAL_PERIOD_RATES, getPeriodConfig 
} from '../constants';
import { 
  addDays, addWeeks, addMonths, format, 
  isValid, parseISO, getDay 
} from 'date-fns';
import { getSystemConfig, addAuditLog } from './storageService';
import { supabase, isSupabaseConfigured, translateSupabaseError } from './supabase';

/**
 * Gera a lista ordenada de datas candidatas no formato YYYY-MM-DD
 * de acordo com a frequência, dias da semana e critérios de encerramento.
 */
export function generateCandidateDates(config: RecurrenceConfig): string[] {
  const { frequency, startDate, endType, endDate, occurrencesCount = 4, weekdays } = config;
  const dates: string[] = [];

  if (!startDate) return [];

  const [startY, startM, startD] = startDate.split('-').map(Number);
  const startObj = new Date(startY, startM - 1, startD);
  if (!isValid(startObj)) return [];

  const startDayOfWeek = startObj.getDay();
  // Se weekdays não foi especificado, usa o dia da semana da data inicial (se não for domingo)
  const effectiveWeekdays = weekdays && weekdays.length > 0
    ? [...new Set(weekdays)].filter(w => w >= 1 && w <= 6).sort((a, b) => a - b)
    : [startDayOfWeek === 0 ? 1 : startDayOfWeek];

  const maxOccurrences = Math.min(Math.max(1, occurrencesCount), 52); // limite de segurança

  if (frequency === 'WEEKLY') {
    let currentWeekDate = startObj;
    let iterations = 0;

    while (iterations < 60) {
      iterations++;
      const curDay = currentWeekDate.getDay();
      const diffToMonday = curDay === 0 ? -6 : 1 - curDay;
      const mondayOfWeek = addDays(currentWeekDate, diffToMonday);

      for (const targetWd of effectiveWeekdays) {
        const dayCandidate = addDays(mondayOfWeek, targetWd - 1);
        const dayCandidateStr = format(dayCandidate, 'yyyy-MM-dd');

        if (dayCandidateStr >= startDate) {
          if (endType === 'UNTIL_DATE') {
            if (endDate && dayCandidateStr > endDate) {
              return dates;
            }
          } else {
            if (dates.length >= maxOccurrences) {
              return dates;
            }
          }

          if (!dates.includes(dayCandidateStr)) {
            dates.push(dayCandidateStr);
          }

          if (endType === 'OCCURRENCES' && dates.length >= maxOccurrences) {
            return dates;
          }
        }
      }

      currentWeekDate = addWeeks(currentWeekDate, 1);
      if (endType === 'UNTIL_DATE' && endDate && format(currentWeekDate, 'yyyy-MM-dd') > endDate && dates.length > 0) {
        break;
      }
    }
  } else if (frequency === 'BIWEEKLY') {
    // Frequência quinzenal: mantém rigorosamente a alternância de duas semanas
    let cycleStartDate = startObj;
    let iterations = 0;

    while (iterations < 60) {
      iterations++;
      const curDay = cycleStartDate.getDay();
      const diffToMonday = curDay === 0 ? -6 : 1 - curDay;
      const mondayOfCycle = addDays(cycleStartDate, diffToMonday);

      for (const targetWd of effectiveWeekdays) {
        const dayCandidate = addDays(mondayOfCycle, targetWd - 1);
        const dayCandidateStr = format(dayCandidate, 'yyyy-MM-dd');

        if (dayCandidateStr >= startDate) {
          if (endType === 'UNTIL_DATE') {
            if (endDate && dayCandidateStr > endDate) {
              return dates;
            }
          } else {
            if (dates.length >= maxOccurrences) {
              return dates;
            }
          }

          if (!dates.includes(dayCandidateStr)) {
            dates.push(dayCandidateStr);
          }

          if (endType === 'OCCURRENCES' && dates.length >= maxOccurrences) {
            return dates;
          }
        }
      }

      cycleStartDate = addWeeks(cycleStartDate, 2);
      if (endType === 'UNTIL_DATE' && endDate && format(cycleStartDate, 'yyyy-MM-dd') > endDate && dates.length > 0) {
        break;
      }
    }
  } else if (frequency === 'MONTHLY') {
    // Frequência mensal: repete mensalmente no mesmo dia do mês com clamp para meses mais curtos
    const originalDayOfMonth = startObj.getDate();
    let monthOffset = 0;

    while (monthOffset < 48) {
      const targetYearMonth = addMonths(new Date(startObj.getFullYear(), startObj.getMonth(), 1), monthOffset);
      const year = targetYearMonth.getFullYear();
      const month = targetYearMonth.getMonth();

      const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
      const actualDay = Math.min(originalDayOfMonth, daysInTargetMonth);
      const candidateDate = new Date(year, month, actualDay);
      const dayCandidateStr = format(candidateDate, 'yyyy-MM-dd');

      if (dayCandidateStr >= startDate) {
        if (endType === 'UNTIL_DATE') {
          if (endDate && dayCandidateStr > endDate) {
            return dates;
          }
        } else {
          if (dates.length >= maxOccurrences) {
            return dates;
          }
        }

        if (!dates.includes(dayCandidateStr)) {
          dates.push(dayCandidateStr);
        }

        if (endType === 'OCCURRENCES' && dates.length >= maxOccurrences) {
          return dates;
        }
      }

      monthOffset++;
      if (endType === 'UNTIL_DATE' && endDate && dayCandidateStr > endDate) {
        break;
      }
    }
  }

  return dates.sort();
}

/**
 * Realiza a prévia e a verificação completa de disponibilidade de todas as ocorrências
 * da série recorrente, calculando preços, conflitos e resumo financeiro.
 */
export async function previewRecurringSeries(params: {
  roomId: RoomId;
  startDate: string;
  hour: number;
  durationHours?: number;
  type?: BookingType;
  periodShift?: PeriodShift;
  config: RecurrenceConfig;
}): Promise<RecurrencePreviewSummary> {
  const dates = generateCandidateDates(params.config);

  // Busca tarifas da sala
  let hourlyRate = 40.0;
  let periodRate = 350.0;
  let morningRate = INITIAL_PERIOD_RATES.MORNING;
  let afternoonRate = INITIAL_PERIOD_RATES.AFTERNOON;
  let nightRate = INITIAL_PERIOD_RATES.NIGHT;

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
      }
    } catch {}
  } else {
    const config = getSystemConfig();
    const room = config.rooms.find(r => r.id === params.roomId);
    if (room) {
      hourlyRate = room.hourlyRate;
      periodRate = room.dailyRate;
      if (room.morningRate) morningRate = room.morningRate;
      if (room.afternoonRate) afternoonRate = room.afternoonRate;
      if (room.nightRate) nightRate = room.nightRate;
    }
  }

  const isPeriod = params.type === 'PERIOD';
  const occurrences: RecurrenceOccurrencePreview[] = [];

  for (const date of dates) {
    const dayOfWeek = getDay(parseISO(date));
    const isSaturday = dayOfWeek === 6;
    const isSunday = dayOfWeek === 0;

    let startHour: number;
    let endHour: number;
    let duration: number;
    let price = 0;

    if (isPeriod) {
      const shift = params.periodShift || 'MORNING';
      const pConf = getPeriodConfig(shift, date);
      startHour = pConf.startHour;
      endHour = pConf.endHour;
      duration = pConf.duration;

      if (shift === 'MORNING') price = morningRate;
      else if (shift === 'AFTERNOON') price = isSaturday ? Number((afternoonRate * (2 / 6)).toFixed(2)) : afternoonRate;
      else if (shift === 'NIGHT') price = nightRate;
      else price = isSaturday ? Number((periodRate * (7 / 15)).toFixed(2)) : periodRate;
    } else {
      startHour = params.hour;
      duration = params.durationHours || 1;
      endHour = startHour + duration;
      price = duration * hourlyRate;
    }

    // Verificação de regras de dia/horário da sala
    if (isSunday) {
      occurrences.push({
        date,
        dayOfWeek,
        startHour,
        endHour,
        hasConflict: true,
        conflictReason: 'As salas não são utilizadas aos domingos.',
        price
      });
      continue;
    }

    const maxClosing = getClosingHourForDate(dayOfWeek);
    if (startHour >= maxClosing || endHour > maxClosing) {
      occurrences.push({
        date,
        dayOfWeek,
        startHour,
        endHour,
        hasConflict: true,
        conflictReason: isSaturday 
          ? 'Aos sábados o atendimento das salas vai somente até as 14:00.' 
          : `O atendimento encerra às ${maxClosing}:00.`,
        price
      });
      continue;
    }

    // Verificação rigorosa de conflito com reservas existentes e bloqueios
    const conflictResult = await bookingService.checkConflict(params.roomId, date, startHour, endHour);

    occurrences.push({
      date,
      dayOfWeek,
      startHour,
      endHour,
      hasConflict: conflictResult.hasConflict,
      conflictReason: conflictResult.reason,
      price
    });
  }

  const availableCount = occurrences.filter(o => !o.hasConflict).length;
  const conflictCount = occurrences.filter(o => o.hasConflict).length;
  const totalEstimatedAmount = occurrences
    .filter(o => !o.hasConflict)
    .reduce((sum, o) => sum + o.price, 0);

  return {
    roomId: params.roomId,
    frequency: params.config.frequency,
    weekdays: params.config.weekdays || [],
    startDate: params.config.startDate,
    endDate: params.config.endDate,
    totalExpected: occurrences.length,
    availableCount,
    conflictCount,
    occurrences,
    totalEstimatedAmount
  };
}

/**
 * Cria a série de reservas recorrentes de forma segura e consistente.
 * Revalida conflitos imediatamente antes da gravação de cada ocorrência.
 */
export async function createRecurringSeries(params: {
  userId: string;
  userEmail: string;
  userName: string;
  clientId?: string;
  clientName?: string;
  roomId: RoomId;
  type?: BookingType;
  hour: number;
  durationHours?: number;
  periodShift?: PeriodShift;
  periodName?: string;
  notes?: string;
  config: RecurrenceConfig;
  skipConflicts: boolean;
  idempotencyKey?: string;
}): Promise<{
  seriesId: string;
  createdBookings: Booking[];
  skippedDates: string[];
  createdCount: number;
  requestedCount: number;
}> {
  // 1. INTEGRAÇÃO REAL SUPABASE (TRANSAÇÃO ATÔMICA, ADVISORY LOCKS & RPC)
  if (isSupabaseConfigured) {
    const candidateDates = generateCandidateDates(params.config);
    if (!candidateDates || candidateDates.length === 0) {
      throw new Error('Nenhuma data válida gerada para os parâmetros informados.');
    }

    const isPeriod = params.type === 'PERIOD';
    const periodConf = isPeriod ? getPeriodConfig(params.periodShift || 'MORNING', candidateDates[0]) : null;
    const startHour = isPeriod ? (periodConf?.startHour ?? 7) : params.hour;
    const durationHours = isPeriod ? (periodConf?.duration ?? 5) : (params.durationHours || 1);

    // Chave de idempotência única por solicitação intencional (prefere crypto.randomUUID quando disponível)
    const idempotencyKey = params.idempotencyKey || (
      (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? `rec-${params.userId}-${crypto.randomUUID()}`
        : `rec-${params.userId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    );

    // Validação estrita do cliente: envia null se não informado; rejeita com erro claro se inválido
    let effectiveClientId: string | null = null;
    if (params.clientId && params.clientId.trim() !== '') {
      const trimmed = params.clientId.trim();
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
      if (!isUUID) {
        throw new Error('Identificador de cliente inválido (formato UUID esperado).');
      }
      effectiveClientId = trimmed;
    }

    const rpcParams = {
      p_room_id: params.roomId,
      p_professional_id: params.userId,
      p_client_id: effectiveClientId,
      p_booking_type: params.type || 'HOURLY',
      p_hour: startHour,
      p_duration_hours: durationHours,
      p_period_shift: isPeriod ? (params.periodShift || 'MORNING') : null,
      p_period_name: isPeriod ? (params.periodName || periodConf?.name || 'Turno') : null,
      p_recurrence_rule: params.config.frequency,
      p_dates: candidateDates,
      p_skip_conflicts: params.skipConflicts,
      p_notes: params.notes || null,
      p_idempotency_key: idempotencyKey
    };

    const { data, error } = await supabase.rpc('create_recurring_series', rpcParams);

    if (error) {
      throw new Error(translateSupabaseError(error));
    }

    // Validação rigorosa da estrutura de retorno da RPC antes do consumo
    if (!data || typeof data !== 'object') {
      throw new Error('Resposta inválida do servidor ao processar a série recorrente.');
    }

    const resultData = data as Record<string, any>;
    const seriesId = String(resultData.series_id || '').trim();
    const isSeriesUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(seriesId);
    if (!seriesId || !isSeriesUUID) {
      throw new Error('Identificador da série (series_id) não retornado ou malformado pelo banco de dados.');
    }

    const skippedDates: string[] = Array.isArray(resultData.skipped_dates) 
      ? resultData.skipped_dates.map((s: any) => s.date) 
      : [];
    const createdIds: string[] = Array.isArray(resultData.created_booking_ids) 
      ? resultData.created_booking_ids 
      : [];
    const createdCount = Number(resultData.created_count ?? createdIds.length);
    const requestedCount = Number(resultData.requested_count ?? candidateDates.length);

    // Recupera os registros criados preferencialmente pelos IDs confirmados pela RPC
    let createdBookings: Booking[] = [];
    if (createdIds.length > 0) {
      try {
        createdBookings = await bookingService.getBookingsByIds(createdIds);
      } catch (idErr) {
        console.warn('Aviso ao consultar reservas pelos IDs da RPC:', idErr);
      }

      // Se retornou parcial, tenta recuperar os IDs faltantes para não apresentar lista incompleta
      if (createdBookings.length > 0 && createdBookings.length < createdIds.length) {
        const foundIds = new Set(createdBookings.map(b => b.id));
        const missingIds = createdIds.filter(id => !foundIds.has(id));
        if (missingIds.length > 0) {
          try {
            const missingBookings = await bookingService.getBookingsByIds(missingIds);
            createdBookings = [...createdBookings, ...missingBookings];
          } catch (retryErr) {
            console.warn('Aviso ao tentar recuperar ocorrências restantes:', retryErr);
          }
        }
      }

      // Fallback: se ainda estiver incompleto, busca por recurrence_id na consulta geral
      if (createdBookings.length < createdIds.length) {
        try {
          const allBookings = await bookingService.getAllBookings();
          const seriesFromAll = allBookings.filter(b => b.recurrenceId === seriesId);
          if (seriesFromAll.length >= createdBookings.length) {
            createdBookings = seriesFromAll;
          }
        } catch (fetchErr) {
          console.warn('Aviso ao consultar agenda completa para série:', fetchErr);
        }
      }
    }

    return {
      seriesId,
      createdBookings,
      skippedDates,
      createdCount,
      requestedCount
    };
  }

  // 2. MODO LOCAL / OFFLINE (FALLBACK PARA DESENVOLVIMENTO ISOLADO SEM SUPABASE)
  const preview = await previewRecurringSeries({
    roomId: params.roomId,
    startDate: params.config.startDate,
    hour: params.hour,
    durationHours: params.durationHours,
    type: params.type,
    periodShift: params.periodShift,
    config: params.config
  });

  if (preview.totalExpected === 0) {
    throw new Error('Nenhuma data válida gerada para os parâmetros informados.');
  }

  if (preview.availableCount === 0) {
    throw new Error('Todas as datas da série possuem conflito com outras reservas ou restrições de horário.');
  }

  if (preview.conflictCount > 0 && !params.skipConflicts) {
    throw new Error(
      `Existem ${preview.conflictCount} datas com conflito. Escolha a opção de criar somente as datas disponíveis ou ajuste a regra.`
    );
  }

  const validOccurrences = preview.occurrences.filter(o => !o.hasConflict);
  const skippedDates = preview.occurrences.filter(o => o.hasConflict).map(o => o.date);

  const seriesId = (typeof crypto !== 'undefined' && crypto.randomUUID) 
    ? crypto.randomUUID() 
    : 'rec-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

  const createdBookings: Booking[] = [];

  for (let idx = 0; idx < validOccurrences.length; idx++) {
    const occ = validOccurrences[idx];

    try {
      const created = await bookingService.createBooking({
        userId: params.userId,
        userEmail: params.userEmail,
        userName: params.userName,
        clientId: params.clientId,
        clientName: params.clientName,
        roomId: params.roomId,
        date: occ.date,
        hour: occ.startHour,
        durationHours: occ.endHour - occ.startHour,
        type: params.type || 'HOURLY',
        periodShift: params.periodShift,
        periodName: params.periodName,
        notes: params.notes,
        recurrenceId: seriesId,
        recurrenceRule: params.config.frequency,
        recurrenceIndex: idx + 1,
        recurrenceTotal: validOccurrences.length
      });

      createdBookings.push(created);
    } catch (err: any) {
      console.warn(`Conflito de concorrência detectado na data ${occ.date}:`, err);
      if (params.skipConflicts) {
        skippedDates.push(occ.date);
      } else {
        // Rollback: cancela as que foram criadas até o momento nesta série
        for (const bk of createdBookings) {
          try {
            await bookingService.cancelBooking(bk.id, {
              id: params.userId,
              name: params.userName,
              role: 'USER',
              email: params.userEmail
            });
          } catch {}
        }
        throw new Error(
          `Falha de concorrência ao agendar ${occ.date}: ${err.message || 'Horário acabou de ser ocupado'}. A série foi cancelada.`
        );
      }
    }
  }

  // 4. Registro de auditoria da série completa
  addAuditLog(
    params.userId,
    params.userName,
    'Criação de Série Recorrente',
    `Série recorrente criada com sucesso: ${createdBookings.length} reservas geradas para ${params.roomId} (${params.config.frequency}). ${skippedDates.length > 0 ? `${skippedDates.length} datas ignoradas por conflito.` : ''}`
  );

  return {
    seriesId,
    createdBookings,
    skippedDates,
    createdCount: createdBookings.length,
    requestedCount: preview.totalExpected
  };
}

/**
 * Recupera todas as reservas pertencentes a uma série recorrente específica.
 */
export async function getSeriesBookings(seriesId: string): Promise<Booking[]> {
  const allBookings = await bookingService.getAllBookings();
  return allBookings
    .filter(b => b.recurrenceId === seriesId)
    .sort((a, b) => a.date.localeCompare(b.date) || a.hour - b.hour);
}

/**
 * Cancela reservas de uma série recorrente.
 * Se fromDate for informado, cancela apenas as ocorrências a partir desta data (ocorrência atual e futuras),
 * preservando integralmente as reservas passadas da série.
 */
export async function cancelSeriesBookings(
  seriesId: string,
  fromDate?: string,
  cancelledBy?: { id: string; name: string; role: Role; email: string }
): Promise<{ cancelledCount: number; cancelledIds: string[] }> {
  const seriesBookings = await getSeriesBookings(seriesId);
  const targetBookings = fromDate
    ? seriesBookings.filter(b => b.date >= fromDate && b.paymentStatus !== 'CANCELLED')
    : seriesBookings.filter(b => b.paymentStatus !== 'CANCELLED');

  const cancelledIds: string[] = [];
  const userContext = cancelledBy || {
    id: 'system',
    name: 'Administração',
    role: 'ADMIN' as Role,
    email: ''
  };

  for (const b of targetBookings) {
    try {
      await bookingService.cancelBooking(b.id, {
        id: userContext.id,
        name: userContext.name,
        role: userContext.role,
        email: userContext.email
      });
      cancelledIds.push(b.id);
    } catch (e) {
      console.warn(`Erro ao cancelar reserva ${b.id} da série:`, e);
    }
  }

  addAuditLog(
    userContext.id,
    userContext.name,
    'Cancelamento de Série Recorrente',
    `Canceladas ${cancelledIds.length} ocorrências da série ${seriesId}${fromDate ? ` a partir de ${fromDate}` : ''}.`
  );

  return {
    cancelledCount: cancelledIds.length,
    cancelledIds
  };
}
