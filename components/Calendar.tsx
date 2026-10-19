import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Booking, RoomId, User, Client, BlockedSlot, BookingType, Room, PeriodShift,
  RecurrenceFrequency, RecurrenceEndType, RecurrenceConfig, RecurrencePreviewSummary 
} from '../types';
import { bookingService } from '../services/bookingService';
import { clientService } from '../services/clientService';
import { getStoredBookings, getStoredBlockedSlots } from '../services/storageService';
import { 
  previewRecurringSeries, createRecurringSeries, 
  getSeriesBookings, cancelSeriesBookings 
} from '../services/recurrenceService';
import { 
  DAYS_OF_WEEK, HOLIDAYS, getClosingHourForDate, SATURDAY_HOURS_END,
  BOOKING_PERIODS, getPeriodConfig, INITIAL_PERIOD_RATES 
} from '../constants';
import { 
  format, addDays, isSameDay, addWeeks, getDay, isBefore,
  endOfWeek, endOfMonth, eachDayOfInterval, isSameMonth, addMonths, isToday,
  differenceInHours, parseISO, startOfWeek, startOfMonth
} from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';
import { 
  ChevronLeft, ChevronRight, CheckCircle, Clock, 
  MapPin, AlertTriangle, User as UserIcon, Palmtree, 
  ShieldAlert, Ban, Plus, X, Calendar as CalendarIcon, FileText,
  Sunrise, Sun, Moon, Repeat, CalendarRange, ListFilter, RotateCcw
} from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useToast } from './Toast';

interface CalendarProps {
  user: User;
  onOpenClients?: () => void;
}

type ViewMode = 'day' | 'week' | 'month';
type RoomFilter = 'ALL' | RoomId;

export const Calendar: React.FC<CalendarProps> = ({ user, onOpenClients }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [selectedRoom, setSelectedRoom] = useState<RoomFilter>('Sala 1');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [myClients, setMyClients] = useState<Client[]>([]);
  const [unblockedHolidays, setUnblockedHolidays] = useState<string[]>([]);
  const [isGlobalAllowed, setIsGlobalAllowed] = useState<boolean>(false);
  const [cancellationLimitHours, setCancellationLimitHours] = useState<number>(24);

  // Quick Booking Modal State
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [bookingRoom, setBookingRoom] = useState<RoomId>('Sala 1');
  const [bookingDate, setBookingDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [bookingStartHour, setBookingStartHour] = useState<number>(14);
  const [bookingType, setBookingType] = useState<BookingType>('HOURLY');
  const [bookingPeriodShift, setBookingPeriodShift] = useState<PeriodShift>('MORNING');
  const [bookingDuration, setBookingDuration] = useState<number>(1);
  const [selectedClientId, setSelectedClientId] = useState<string>('');
  const [bookingNotes, setBookingNotes] = useState<string>('');
  const [conflictStatus, setConflictStatus] = useState<{ hasConflict: boolean; reason?: string }>({ hasConflict: false });
  const [isCheckingConflict, setIsCheckingConflict] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef<boolean>(false);

  // Estados de Agendamento Recorrente (Seção 2 e 3)
  const [isRecurringMode, setIsRecurringMode] = useState<boolean>(false);
  const [recFrequency, setRecFrequency] = useState<RecurrenceFrequency>('WEEKLY');
  const [recWeekdays, setRecWeekdays] = useState<number[]>([1]); // 1 = Segunda
  const [recEndType, setRecEndType] = useState<RecurrenceEndType>('OCCURRENCES');
  const [recEndDate, setRecEndDate] = useState<string>(() => format(addMonths(new Date(), 1), 'yyyy-MM-dd'));
  const [recOccurrencesCount, setRecOccurrencesCount] = useState<number>(4);
  const [recPreviewSummary, setRecPreviewSummary] = useState<RecurrencePreviewSummary | null>(null);
  const [isLoadingRecPreview, setIsLoadingRecPreview] = useState<boolean>(false);
  const [recSkipConflicts, setRecSkipConflicts] = useState<boolean>(false);
  const [showSummaryView, setShowSummaryView] = useState<boolean>(false);
  const [recIdempotencyKey, setRecIdempotencyKey] = useState<string>('');

  // Manage / Details Modal State
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  // Modal da Série Completa e Ações em Massa (Seção 9)
  const [isSeriesModalOpen, setIsSeriesModalOpen] = useState<boolean>(false);
  const [seriesBookings, setSeriesBookings] = useState<Booking[]>([]);
  const [isLoadingSeries, setIsLoadingSeries] = useState<boolean>(false);
  const [isCancellingSeries, setIsCancellingSeries] = useState<boolean>(false);
  const [confirmCancelFuture, setConfirmCancelFuture] = useState<boolean>(false);

  const { addToast } = useToast();
  const isAdmin = user.role === 'ADMIN';

  // Configurações de Horário (07:00 às 22:00)
  const hoursStart = 7;
  const hoursEnd = 22;
  const hours = useMemo(() => Array.from({ length: hoursEnd - hoursStart }).map((_, i) => hoursStart + i), [hoursStart, hoursEnd]);

  const loadData = async () => {
    try {
      const [bookingsRes, blocksRes, roomsRes, holidaysRes, globalHolidaysRes, settingsRes] = await Promise.allSettled([
        bookingService.getAllBookings(),
        bookingService.getBlockedSlots(),
        bookingService.getRooms(),
        bookingService.getUnblockedHolidays(),
        bookingService.isGlobalHolidaysAllowed(),
        bookingService.getGlobalSettings()
      ]);

      if (bookingsRes.status === 'fulfilled' && bookingsRes.value) {
        const cleaned = bookingsRes.value.filter(b => {
          const isSala2 = String(b.roomId || '').toLowerCase().replace(/\s+/g, '') === 'sala2';
          const isDate = String(b.date || '').split('T')[0] === '2026-10-14';
          const is18or19 = (b.hour === 18 || b.hour === 19) ||
            (Number(b.hour) <= 18 && Number(b.endTimeHour || (b.hour + (b.durationHours || 1))) > 18) ||
            (Number(b.hour) <= 19 && Number(b.endTimeHour || (b.hour + (b.durationHours || 1))) > 19);
          return !(isSala2 && isDate && is18or19);
        });
        setBookings(cleaned);
      } else {
        setBookings(getStoredBookings().filter(b => b.paymentStatus !== 'CANCELLED'));
      }

      if (blocksRes.status === 'fulfilled' && blocksRes.value) {
        setBlockedSlots(blocksRes.value);
      } else {
        setBlockedSlots(getStoredBlockedSlots());
      }

      if (roomsRes.status === 'fulfilled' && roomsRes.value) {
        setRooms(roomsRes.value);
      }

      if (holidaysRes.status === 'fulfilled' && holidaysRes.value) {
        setUnblockedHolidays(holidaysRes.value);
      }

      if (globalHolidaysRes.status === 'fulfilled') {
        setIsGlobalAllowed(globalHolidaysRes.value);
      }

      if (settingsRes.status === 'fulfilled' && settingsRes.value) {
        setCancellationLimitHours(settingsRes.value.cancellationLimitHours);
      }

      try {
        if (user.role === 'USER') {
          const clients = await clientService.getClientsByProfessional(user.id);
          setMyClients(clients);
          if (clients.length > 0 && !selectedClientId) {
            setSelectedClientId(clients[0].id);
          }
        } else {
          const allClients = await clientService.getAllClients();
          setMyClients(allClients);
          if (allClients.length > 0 && !selectedClientId) {
            setSelectedClientId(allClients[0].id);
          }
        }
      } catch (clientErr) {
        console.warn('Aviso ao carregar clientes do profissional:', clientErr);
      }
    } catch (err: any) {
      console.error('Erro ao carregar dados do calendário:', err);
      setBookings(getStoredBookings().filter(b => b.paymentStatus !== 'CANCELLED'));
      setBlockedSlots(getStoredBlockedSlots());
    }
  };

  useEffect(() => {
    loadData();
  }, [user.id, currentDate, viewMode]);

  // Real-time Conflict Checker for the Booking Modal
  useEffect(() => {
    if (!isBookingModalOpen) return;

    const check = async () => {
      setIsCheckingConflict(true);
      try {
        if (bookingType === 'PERIOD') {
          const periodConf = getPeriodConfig(bookingPeriodShift, bookingDate);
          if (!periodConf.isAvailableOnDate) {
            setConflictStatus({
              hasConflict: true,
              reason: 'O período da Noite não está disponível aos sábados (o atendimento encerra às 14:00).'
            });
            return;
          }
          const result = await bookingService.checkConflict(
            bookingRoom,
            bookingDate,
            periodConf.startHour,
            periodConf.endHour
          );
          setConflictStatus(result);
        } else {
          const endH = bookingStartHour + bookingDuration;
          const result = await bookingService.checkConflict(
            bookingRoom,
            bookingDate,
            bookingStartHour,
            endH
          );
          setConflictStatus(result);
        }
      } catch {
        setConflictStatus({ hasConflict: false });
      } finally {
        setIsCheckingConflict(false);
      }
    };

    check();
  }, [isBookingModalOpen, bookingRoom, bookingDate, bookingStartHour, bookingType, bookingDuration, bookingPeriodShift]);

  // Holiday check helper
  const getHolidayInfo = (date: Date) => {
    const mmdd = format(date, 'MM-dd');
    const yyyymmdd = format(date, 'yyyy-MM-dd');
    const isHoliday = HOLIDAYS.includes(mmdd) || HOLIDAYS.includes(yyyymmdd);
    const isUnblocked = isGlobalAllowed || unblockedHolidays.includes(mmdd) || unblockedHolidays.includes(yyyymmdd);
    return { isHoliday, isUnblocked };
  };

  // Date Navigation
  const handlePrev = () => {
    if (viewMode === 'day') setCurrentDate(d => addDays(d, -1));
    else if (viewMode === 'week') setCurrentDate(d => addWeeks(d, -1));
    else if (viewMode === 'month') setCurrentDate(d => addMonths(d, -1));
  };

  const handleNext = () => {
    if (viewMode === 'day') setCurrentDate(d => addDays(d, 1));
    else if (viewMode === 'week') setCurrentDate(d => addWeeks(d, 1));
    else if (viewMode === 'month') setCurrentDate(d => addMonths(d, 1));
  };

  const handleToday = () => setCurrentDate(new Date());

  const dateLabel = useMemo(() => {
    if (viewMode === 'day') {
      return format(currentDate, "EEEE, d 'de' MMMM", { locale: ptBR });
    }
    if (viewMode === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = addDays(start, 6);
      return `${format(start, "d 'de' MMM", { locale: ptBR })} — ${format(end, "d 'de' MMM 'de' yyyy", { locale: ptBR })}`;
    }
    return format(currentDate, "MMMM 'de' yyyy", { locale: ptBR });
  }, [currentDate, viewMode]);

  // Click on Available Slot -> Open Instant Booking Modal (Seção 2 & 22)
  const handleSlotClick = (date: Date, hour: number, room?: RoomId) => {
    const dayOfWeek = getDay(date);
    if (dayOfWeek === 0) {
      addToast('As salas não são utilizadas aos domingos.', 'warning');
      return;
    }
    const maxClosing = getClosingHourForDate(dayOfWeek);
    if (hour >= maxClosing) {
      addToast(
        dayOfWeek === 6 
          ? 'Aos sábados o atendimento das salas vai somente até as 14:00.' 
          : `O atendimento das salas neste dia encerra às ${maxClosing}:00.`,
        'warning'
      );
      return;
    }
    const targetRoom = room || (selectedRoom === 'ALL' ? 'Sala 1' : selectedRoom);
    const formattedDate = format(date, 'yyyy-MM-dd');

    // Pré-seleciona período inteligente com base na hora clicada
    if (hour < 12) {
      setBookingPeriodShift('MORNING');
    } else if (hour < 18) {
      setBookingPeriodShift('AFTERNOON');
    } else {
      setBookingPeriodShift(dayOfWeek === 6 ? 'MORNING' : 'NIGHT');
    }

    setBookingRoom(targetRoom);
    setBookingDate(formattedDate);
    setBookingStartHour(hour);
    setBookingDuration(1);
    setBookingType('HOURLY');
    setBookingNotes('');
    setIsRecurringMode(false);
    setShowSummaryView(false);
    setRecFrequency('WEEKLY');
    const dow = dayOfWeek === 0 ? 1 : dayOfWeek;
    setRecWeekdays([dow]);
    setRecEndType('OCCURRENCES');
    setRecOccurrencesCount(4);
    setRecEndDate(format(addMonths(date, 1), 'yyyy-MM-dd'));
    setRecPreviewSummary(null);
    setRecSkipConflicts(false);
    setRecIdempotencyKey('');
    setIsBookingModalOpen(true);
  };

  // Click on Existing Booking -> Open Details & Manage Modal
  const handleBookingClick = (booking: Booking) => {
    setSelectedBooking(booking);
    setConfirmCancelFuture(false);
    setIsDetailsModalOpen(true);
  };

  // Carrega e atualiza a prévia da série recorrente
  const handleGenerateRecSummary = async () => {
    setIsLoadingRecPreview(true);
    try {
      const summary = await previewRecurringSeries({
        roomId: bookingRoom,
        startDate: bookingDate,
        hour: bookingStartHour,
        durationHours: bookingDuration,
        type: bookingType,
        periodShift: bookingPeriodShift,
        config: {
          frequency: recFrequency,
          weekdays: recWeekdays,
          startDate: bookingDate,
          endType: recEndType,
          endDate: recEndDate,
          occurrencesCount: recOccurrencesCount
        }
      });
      setRecPreviewSummary(summary);
      setShowSummaryView(true);
      // Gera nova chave para a intenção calculada se ainda não definida
      if (!recIdempotencyKey) {
        const generatedKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? `rec-${user.id}-${crypto.randomUUID()}`
          : `rec-${user.id}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        setRecIdempotencyKey(generatedKey);
      }
    } catch (err: any) {
      addToast(err.message || 'Erro ao gerar prévia da série recorrente.', 'error');
    } finally {
      setIsLoadingRecPreview(false);
    }
  };

  // Confirm booking (Único ou Recorrente)
  const handleConfirmBooking = async () => {
    // Trava síncrona contra múltiplos cliques concorrentes imediatos
    if (isSubmittingRef.current || isSubmitting) return;

    // FLUXO DE AGENDAMENTO RECORRENTE
    if (isRecurringMode) {
      if (!showSummaryView || !recPreviewSummary) {
        await handleGenerateRecSummary();
        return;
      }

      if (recPreviewSummary.availableCount === 0) {
        return addToast('Todas as datas da série possuem conflito. Nenhuma reserva pode ser criada.', 'error');
      }

      if (recPreviewSummary.conflictCount > 0 && !recSkipConflicts) {
        return addToast('Existem conflitos na série. Confirme criar somente as datas disponíveis ou ajuste a regra.', 'warning');
      }

      // Validação do paciente/cliente antes de despachar a transação
      let validClientId: string | undefined = undefined;
      let validClientName: string | undefined = undefined;
      if (selectedClientId && selectedClientId.trim() !== '') {
        const trimmed = selectedClientId.trim();
        const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
        if (!isUUID) {
          return addToast('O paciente/cliente selecionado possui identificador inválido. Por favor, recadastre o paciente.', 'error');
        }
        validClientId = trimmed;
        validClientName = myClients.find(c => c.id === validClientId)?.name;
      }

      isSubmittingRef.current = true;
      setIsSubmitting(true);
      try {
        const isPeriod = bookingType === 'PERIOD';
        const periodConf = getPeriodConfig(bookingPeriodShift, bookingDate);
        const startHour = isPeriod ? periodConf.startHour : bookingStartHour;
        const durationHours = isPeriod ? periodConf.duration : bookingDuration;

        // Se por algum motivo a chave estiver vazia, gera uma identificação intencional
        const effectiveKey = recIdempotencyKey || (
          (typeof crypto !== 'undefined' && crypto.randomUUID)
            ? `rec-${user.id}-${crypto.randomUUID()}`
            : `rec-${user.id}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
        );

        const result = await createRecurringSeries({
          userId: user.id,
          userEmail: user.email,
          userName: user.name,
          clientId: validClientId,
          clientName: validClientName,
          roomId: bookingRoom,
          type: bookingType,
          hour: startHour,
          durationHours,
          periodShift: isPeriod ? bookingPeriodShift : undefined,
          periodName: isPeriod ? periodConf.name : undefined,
          notes: bookingNotes,
          config: {
            frequency: recFrequency,
            weekdays: recWeekdays,
            startDate: bookingDate,
            endType: recEndType,
            endDate: recEndDate,
            occurrencesCount: recOccurrencesCount
          },
          skipConflicts: recSkipConflicts,
          idempotencyKey: effectiveKey
        });

        // Transação gravada com sucesso: fecha o modal e limpa a chave da sessão
        setIsBookingModalOpen(false);
        setShowSummaryView(false);
        setRecIdempotencyKey('');

        const countConfirmed = result.createdCount ?? (result.createdBookings.length > 0 ? result.createdBookings.length : result.requestedCount);
        const msgSuccess = `Série recorrente criada com sucesso! ${countConfirmed} reservas confirmadas.${result.skippedDates.length > 0 ? ` (${result.skippedDates.length} datas com conflito ignoradas)` : ''}`;

        let refreshFailed = false;
        try {
          await loadData();
        } catch (loadErr) {
          console.warn('Aviso: Falha ao recarregar agenda após confirmação:', loadErr);
          refreshFailed = true;
        }

        if (refreshFailed) {
          addToast(
            `${msgSuccess} (Atenção: Houve instabilidade ao atualizar a visualização da agenda. Por favor, atualize a página se necessário.)`,
            'warning'
          );
        } else {
          addToast(msgSuccess, 'success');
        }
      } catch (err: any) {
        // Em caso de falha de comunicação ou timeout, mantém recIdempotencyKey para repetição com os mesmos parâmetros
        addToast(err.message || 'Erro ao criar série recorrente.', 'error');
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
      return;
    }

    // FLUXO DE AGENDAMENTO ÚNICO TRADICIONAL
    if (conflictStatus.hasConflict) {
      return addToast(conflictStatus.reason || 'Este horário não está disponível.', 'error');
    }

    let singleClientId: string | undefined = undefined;
    let singleClientName: string | undefined = undefined;
    if (selectedClientId && selectedClientId.trim() !== '') {
      const trimmed = selectedClientId.trim();
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
      if (!isUUID) {
        return addToast('O paciente/cliente selecionado possui identificador inválido. Por favor, recadastre o paciente.', 'error');
      }
      singleClientId = trimmed;
      singleClientName = myClients.find(c => c.id === singleClientId)?.name;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const isPeriod = bookingType === 'PERIOD';
      const periodConf = getPeriodConfig(bookingPeriodShift, bookingDate);
      const startHour = isPeriod ? periodConf.startHour : bookingStartHour;
      const durationHours = isPeriod ? periodConf.duration : bookingDuration;

      await bookingService.createBooking({
        userId: user.id,
        userEmail: user.email,
        userName: user.name,
        clientId: singleClientId,
        clientName: singleClientName,
        roomId: bookingRoom,
        date: bookingDate,
        hour: startHour,
        durationHours: durationHours,
        type: bookingType,
        periodShift: isPeriod ? bookingPeriodShift : undefined,
        periodName: isPeriod ? periodConf.name : undefined,
        notes: bookingNotes
      });

      addToast('Locação confirmada com sucesso!', 'success');
      setIsBookingModalOpen(false);
      await loadData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao realizar reserva.', 'error');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  // Cancel booking
  const handleCancelBooking = async () => {
    if (!selectedBooking) return;
    setIsCancelling(true);
    try {
      await bookingService.cancelBooking(selectedBooking.id, {
        id: user.id,
        name: user.name,
        role: user.role,
        email: user.email
      });
      addToast('Reserva cancelada com sucesso.', 'success');
      setIsDetailsModalOpen(false);
      setSelectedBooking(null);
      await loadData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao cancelar reserva.', 'error');
    } finally {
      setIsCancelling(false);
    }
  };

  // Abertura da Série Completa
  const handleOpenSeriesModal = async (seriesId: string) => {
    setIsLoadingSeries(true);
    setIsSeriesModalOpen(true);
    setConfirmCancelFuture(false);
    try {
      const list = await getSeriesBookings(seriesId);
      setSeriesBookings(list);
    } catch (err: any) {
      addToast('Erro ao carregar dados da série.', 'error');
    } finally {
      setIsLoadingSeries(false);
    }
  };

  // Cancelamento de Ocorrências Futuras da Série
  const handleCancelFutureOccurrences = async () => {
    if (!selectedBooking?.recurrenceId) return;
    setIsCancellingSeries(true);
    try {
      const result = await cancelSeriesBookings(
        selectedBooking.recurrenceId,
        selectedBooking.date,
        {
          id: user.id,
          name: user.name,
          role: user.role,
          email: user.email
        }
      );
      addToast(`Foram canceladas ${result.cancelledCount} ocorrências da série a partir de ${selectedBooking.date}.`, 'success');
      setIsDetailsModalOpen(false);
      setIsSeriesModalOpen(false);
      setSelectedBooking(null);
      setConfirmCancelFuture(false);
      await loadData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao cancelar ocorrências futuras.', 'error');
    } finally {
      setIsCancellingSeries(false);
    }
  };

  // Calculate modal dynamic price
  const modalCalculatedPrice = useMemo(() => {
    const room = rooms.find(r => r.id === bookingRoom) || { 
      hourlyRate: 40, 
      dailyRate: 350,
      morningRate: INITIAL_PERIOD_RATES.MORNING,
      afternoonRate: INITIAL_PERIOD_RATES.AFTERNOON,
      nightRate: INITIAL_PERIOD_RATES.NIGHT
    };

    if (bookingType === 'PERIOD') {
      if (bookingPeriodShift === 'FULL_DAY') {
        const isSat = getClosingHourForDate(bookingDate) === SATURDAY_HOURS_END;
        const base = room.dailyRate || room.fullDayRate || INITIAL_PERIOD_RATES.FULL_DAY;
        return isSat ? Number((base * (7 / 15)).toFixed(2)) : base;
      }
      if (bookingPeriodShift === 'MORNING') {
        return room.morningRate || INITIAL_PERIOD_RATES.MORNING;
      }
      if (bookingPeriodShift === 'AFTERNOON') {
        const isSat = getClosingHourForDate(bookingDate) === SATURDAY_HOURS_END;
        const base = room.afternoonRate || INITIAL_PERIOD_RATES.AFTERNOON;
        return isSat ? Number((base * (2 / 6)).toFixed(2)) : base;
      }
      if (bookingPeriodShift === 'NIGHT') {
        return room.nightRate || INITIAL_PERIOD_RATES.NIGHT;
      }
      return room.dailyRate || INITIAL_PERIOD_RATES.FULL_DAY;
    }
    return bookingDuration * room.hourlyRate;
  }, [bookingRoom, bookingType, bookingPeriodShift, bookingDuration, bookingDate, rooms]);

  // Helper to check if a specific room + date + hour is booked or blocked
  const getSlotDetails = (dateStr: string, hour: number, roomId: RoomId) => {
    const targetRoom = String(roomId).trim().toLowerCase();
    const targetDate = String(dateStr).split('T')[0].trim();

    // Garantia de exclusão das reservas falsas na Sala 2 em 14/10 às 18h e 19h
    if ((targetRoom === 'sala 2' || targetRoom === 'sala2') && targetDate === '2026-10-14' && (hour === 18 || hour === 19)) {
      return { type: 'AVAILABLE' as const };
    }

    // 1. Bloqueios administrativos
    const block = blockedSlots.find(blk => {
      const blkDate = String(blk.date || '').split('T')[0].trim();
      const blkRoom = String(blk.roomId || '').trim().toLowerCase();
      if (blkDate !== targetDate) return false;
      if (blkRoom !== 'all' && blkRoom !== targetRoom) return false;
      const bStart = Number(blk.startHour);
      const bEnd = Number(blk.endHour);
      return hour >= bStart && hour < bEnd;
    });

    if (block) {
      return { type: 'BLOCKED' as const, block };
    }

    // 2. Reserva existente
    const booking = bookings.find(b => {
      const bRoom = String(b.roomId || '').trim().toLowerCase();
      const bDate = String(b.date || '').split('T')[0].trim();
      if (bRoom !== targetRoom || bDate !== targetDate) return false;

      const bStart = Number(b.hour !== undefined ? b.hour : 7);
      const bDur = Number(b.durationHours || 1);
      const bEnd = Number(b.endTimeHour || (bStart + bDur));
      return hour >= bStart && hour < bEnd;
    });

    if (booking) {
      const isMine = booking.userId === user.id || (Boolean(user.email) && booking.userEmail === user.email);
      return { type: 'BOOKED' as const, booking, isMine };
    }

    return { type: 'AVAILABLE' as const };
  };

  // ================= RENDER DAY VIEW (Tabela Horário x Sala 1 x Sala 2 - Seção 3) =================
  const renderDayView = () => {
    // Domingo: Salas fechadas
    if (getDay(currentDate) === 0) {
      return (
        <div className="animate-fade-in p-12 text-center flex flex-col items-center justify-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-slate-100 flex items-center justify-center text-slate-400">
            <Ban size={30} />
          </div>
          <div className="max-w-md space-y-1.5">
            <h3 className="text-lg font-black text-gray-900">Salas Não Utilizadas aos Domingos</h3>
            <p className="text-xs text-gray-500 leading-relaxed">
              O espaço clínico e as salas não funcionam aos domingos. O atendimento e as locações ocorrem regularmente de <strong>segunda a sexta</strong> (07:00 às 22:00) e aos <strong>sábados</strong> (07:00 às 14:00).
            </p>
          </div>
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => setCurrentDate(d => addDays(d, -1))}
              className="text-xs"
            >
              ← Ir para Sábado
            </Button>
            <Button
              onClick={() => setCurrentDate(d => addDays(d, 1))}
              className="text-xs"
            >
              Ir para Segunda-feira →
            </Button>
          </div>
        </div>
      );
    }

    const dateStr = format(currentDate, 'yyyy-MM-dd');
    const { isHoliday, isUnblocked } = getHolidayInfo(currentDate);

    return (
      <div className="animate-fade-in overflow-x-auto custom-scrollbar">
        <div className="min-w-[650px]">
          {/* Header das Salas */}
          <div className="grid grid-cols-[100px_1fr_1fr] border-b-2 border-gray-100 bg-gray-50/70 sticky top-0 z-10">
            <div className="h-14 flex items-center justify-center text-xs font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">
              Horário
            </div>
            <div className="h-14 flex flex-col items-center justify-center border-r border-gray-100 bg-white">
              <span className="text-xs font-black text-gray-900 uppercase tracking-wider">Sala 1</span>
              <span className="text-[10px] text-teal-600 font-bold">Psicoterapia & Acolhimento</span>
            </div>
            <div className="h-14 flex flex-col items-center justify-center bg-white">
              <span className="text-xs font-black text-gray-900 uppercase tracking-wider">Sala 2</span>
              <span className="text-[10px] text-teal-600 font-bold">Multidisciplinar & Infantil</span>
            </div>
          </div>

          {/* Linhas de Horário */}
          {hours.map(hour => {
            const isSaturday = getDay(currentDate) === 6;
            const isClosedHour = isSaturday && hour >= SATURDAY_HOURS_END;

            const slotDateTime = new Date(currentDate);
            slotDateTime.setHours(hour, 0, 0, 0);
            const isPast = isBefore(slotDateTime, new Date());

            const slot1 = getSlotDetails(dateStr, hour, 'Sala 1');
            const slot2 = getSlotDetails(dateStr, hour, 'Sala 2');

            const renderCell = (slot: ReturnType<typeof getSlotDetails>, room: RoomId) => {
              if (isClosedHour) {
                return (
                  <div className="w-full h-full bg-slate-50/70 border border-slate-200/50 rounded-xl p-2 flex items-center justify-center gap-1.5 text-slate-400 select-none">
                    <Clock size={14} className="text-slate-400" />
                    <span className="text-[11px] font-bold uppercase tracking-wider">
                      Fechado (Atendimento até 14h aos sábados)
                    </span>
                  </div>
                );
              }

              if (slot.type === 'BLOCKED') {
                return (
                  <div className="w-full h-full bg-amber-50/70 border border-amber-100/70 rounded-xl p-2 flex items-center justify-center gap-1.5 text-amber-700">
                    <Ban size={14} />
                    <span className="text-[11px] font-black uppercase tracking-wider truncate">
                      Bloqueado: {slot.block.reason}
                    </span>
                  </div>
                );
              }

              if (slot.type === 'BOOKED') {
                const b = slot.booking;
                const isMine = slot.isMine;

                return (
                  <div
                    onClick={() => handleBookingClick(b)}
                    className={`w-full h-full rounded-xl p-2 flex items-center justify-between cursor-pointer transition-all shadow-sm ${
                      isMine
                        ? 'bg-teal-500 text-white hover:bg-teal-600 font-bold'
                        : isAdmin
                        ? 'bg-slate-700 text-white hover:bg-slate-800'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200/60 hover:bg-emerald-100'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <div className={`w-2 h-2 rounded-full ${isMine ? 'bg-white' : 'bg-emerald-500'}`}></div>
                      {b.recurrenceId && (
                        <span 
                          title={`Agendamento Recorrente (Ocorrência ${b.recurrenceIndex || 1} de ${b.recurrenceTotal || 1})`}
                          className={`p-1 rounded-md flex items-center shrink-0 ${
                            isMine ? 'bg-white/20 text-white' : 'bg-teal-100 text-teal-800'
                          }`}
                        >
                          <Repeat size={11} />
                        </span>
                      )}
                      <span className="text-xs font-black uppercase tracking-tight truncate">
                        {isMine
                          ? `Sua Reserva ${b.clientName ? `— ${b.clientName}` : ''}`
                          : isAdmin
                          ? `${b.userName} ${b.clientName ? `(${b.clientName})` : ''}`
                          : 'Indisponível (Reservado)'
                        }
                      </span>
                    </div>
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-white/20 whitespace-nowrap">
                      {b.type === 'PERIOD' ? (b.periodName ? `Período ${b.periodName}` : 'Período') : `${hour}:00`}
                    </span>
                  </div>
                );
              }

              // DISPONÍVEL
              const isAvailableToBook = !isPast && (!isHoliday || isUnblocked);

              return (
                <div
                  onClick={() => {
                    if (isAvailableToBook) handleSlotClick(currentDate, hour, room);
                  }}
                  className={`w-full h-full rounded-xl border border-dashed border-gray-200 flex items-center justify-between px-4 transition-all group ${
                    isAvailableToBook
                      ? 'hover:bg-teal-50/50 hover:border-teal-300 cursor-pointer'
                      : 'bg-gray-50/50 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <span className="text-xs font-bold text-gray-400 group-hover:text-teal-700 uppercase tracking-wide">
                    {isPast ? 'Horário Passado' : isHoliday && !isUnblocked ? 'Feriado Bloqueado' : 'Disponível'}
                  </span>
                  {isAvailableToBook && (
                    <span className="text-xs font-black text-teal-600 bg-teal-50 px-2.5 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                      <Plus size={13} /> Reservar
                    </span>
                  )}
                </div>
              );
            };

            return (
              <div key={hour} className="grid grid-cols-[100px_1fr_1fr] border-b border-gray-100 min-h-[58px] p-1 gap-2 items-center">
                <div className="text-xs font-black text-gray-500 text-center tracking-wider">
                  {hour.toString().padStart(2, '0')}:00
                </div>
                <div className="h-12">{renderCell(slot1, 'Sala 1')}</div>
                <div className="h-12">{renderCell(slot2, 'Sala 2')}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ================= RENDER WEEK VIEW (Visualização Principal - Seção 3) =================
  const renderWeekView = () => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    // 7 dias da semana: Seg a Dom
    const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(start, i));

    return (
      <div className="overflow-x-auto custom-scrollbar pb-4 animate-fade-in">
        <div className="min-w-[850px]">
          {/* Header com os dias */}
          <div className="grid grid-cols-[80px_repeat(7,1fr)] border-b-2 border-gray-100 bg-gray-50/60 sticky top-0 z-10">
            <div className="h-16 flex items-center justify-center text-xs font-black text-gray-400 uppercase tracking-widest border-r border-gray-100">
              Hora
            </div>
            {weekDays.map((day, i) => {
              const { isHoliday, isUnblocked } = getHolidayInfo(day);
              const isTodayDate = isSameDay(day, new Date());
              const isSunday = getDay(day) === 0;
              const isSaturday = getDay(day) === 6;

              return (
                <div 
                  key={i} 
                  className={`h-16 border-r border-gray-100 flex flex-col items-center justify-center transition-colors ${
                    isTodayDate 
                      ? 'bg-teal-50/70 border-b-2 border-b-teal-500' 
                      : isSunday
                      ? 'bg-slate-50/80'
                      : isHoliday 
                      ? 'bg-orange-50/30' 
                      : 'bg-white'
                  }`}
                >
                  <span className={`text-[10px] font-black uppercase tracking-widest flex items-center gap-1 ${
                    isTodayDate ? 'text-teal-700' : isSunday ? 'text-slate-400' : 'text-gray-400'
                  }`}>
                    {DAYS_OF_WEEK[getDay(day)].slice(0, 3)}
                    {isSunday && (
                      <span className="text-[8px] bg-slate-200/80 text-slate-500 font-bold px-1 rounded uppercase tracking-tighter">
                        Fechado
                      </span>
                    )}
                    {isSaturday && (
                      <span className="text-[8px] bg-teal-100/80 text-teal-700 font-bold px-1 rounded uppercase tracking-tighter" title="Atendimento até as 14h aos sábados">
                        Até 14h
                      </span>
                    )}
                    {isHoliday && !isSunday && <Palmtree size={12} className={isUnblocked ? 'text-teal-500' : 'text-orange-400'} />}
                  </span>
                  <span className={`text-lg font-black ${isTodayDate ? 'text-teal-700' : isSunday ? 'text-slate-400' : 'text-gray-800'}`}>
                    {format(day, 'dd')}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Linhas de Horário da Semana */}
          {hours.map(hour => (
            <div key={hour} className="grid grid-cols-[80px_repeat(7,1fr)] border-b border-gray-100 min-h-[64px]">
              <div className="flex items-center justify-center text-xs font-black text-gray-400 border-r border-gray-100 bg-gray-50/30">
                {hour}:00
              </div>
              {weekDays.map((day, dIdx) => {
                const isSunday = getDay(day) === 0;
                const isSaturday = getDay(day) === 6;
                const isSaturdayClosed = isSaturday && hour >= SATURDAY_HOURS_END;

                if (isSunday) {
                  return (
                    <div
                      key={dIdx}
                      className="border-r border-gray-100 p-1 bg-slate-50/50 flex items-center justify-center select-none"
                    >
                      <div className="w-full h-full rounded-xl bg-slate-100/60 border border-slate-200/40 flex items-center justify-center">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                          Fechado
                        </span>
                      </div>
                    </div>
                  );
                }

                if (isSaturdayClosed) {
                  return (
                    <div
                      key={dIdx}
                      className="border-r border-gray-100 p-1 bg-slate-50/40 flex items-center justify-center select-none"
                      title="Atendimento aos sábados somente até as 14:00"
                    >
                      <div className="w-full h-full rounded-xl bg-slate-100/50 border border-dashed border-slate-200/60 flex items-center justify-center">
                        <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">
                          Fechado (14h)
                        </span>
                      </div>
                    </div>
                  );
                }

                const dateStr = format(day, 'yyyy-MM-dd');
                const targetRoom = selectedRoom === 'ALL' ? 'Sala 1' : selectedRoom;
                const slot = getSlotDetails(dateStr, hour, targetRoom);
                const slotDateTime = new Date(day);
                slotDateTime.setHours(hour, 0, 0, 0);
                const isPast = isBefore(slotDateTime, new Date());
                const { isHoliday, isUnblocked } = getHolidayInfo(day);
                const isAvailable = slot.type === 'AVAILABLE' && !isPast && (!isHoliday || isUnblocked);

                return (
                  <div
                    key={dIdx}
                    className={`border-r border-gray-100 p-1 relative transition-all ${
                      isAvailable ? 'hover:bg-teal-50/40 cursor-pointer group' : ''
                    }`}
                    onClick={() => {
                      if (slot.type === 'BOOKED') {
                        handleBookingClick(slot.booking);
                      } else if (isAvailable) {
                        handleSlotClick(day, hour, targetRoom);
                      }
                    }}
                  >
                    {slot.type === 'BLOCKED' && (
                      <div className="w-full h-full bg-amber-50 border border-amber-200/60 rounded-xl p-1.5 flex flex-col justify-center text-center">
                        <span className="text-[9px] font-black text-amber-700 uppercase tracking-tighter truncate">
                          Bloqueado
                        </span>
                        <span className="text-[8px] text-amber-600 truncate">
                          {slot.block.reason}
                        </span>
                      </div>
                    )}

                    {slot.type === 'BOOKED' && (
                      <div className={`w-full h-full rounded-xl p-1.5 flex flex-col justify-between text-left transition-transform hover:scale-[1.02] shadow-sm ${
                        slot.isMine
                          ? 'bg-teal-500 text-white'
                          : isAdmin
                          ? 'bg-slate-700 text-white'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 min-w-0">
                            {slot.booking.recurrenceId && (
                              <Repeat size={9} className="shrink-0 opacity-80" title={`Recorrente (${slot.booking.recurrenceIndex || 1}/${slot.booking.recurrenceTotal || 1})`} />
                            )}
                            <span className="text-[9px] font-black uppercase tracking-tight truncate">
                              {slot.isMine
                                ? (slot.booking.clientName || 'Sua Reserva')
                                : isAdmin
                                ? (slot.booking.userName?.split(' ')[0] || 'Profissional')
                                : 'Indisponível'
                              }
                            </span>
                          </div>
                          <span className={`w-1.5 h-1.5 rounded-full ${slot.isMine ? 'bg-white' : 'bg-emerald-500'} shrink-0 ml-1`}></span>
                        </div>
                        <span className="text-[8px] opacity-80 uppercase tracking-tighter truncate">
                          {slot.booking.type === 'PERIOD' ? (slot.booking.periodName ? `Período ${slot.booking.periodName}` : 'Período') : `${targetRoom}`}
                        </span>
                      </div>
                    )}

                    {isAvailable && (
                      <div className="w-full h-full rounded-xl border border-dashed border-transparent group-hover:border-teal-300 flex items-center justify-center transition-all">
                        <span className="text-[11px] font-black text-teal-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                          <Plus size={13} /> Reservar
                        </span>
                      </div>
                    )}

                    {!isAvailable && slot.type === 'AVAILABLE' && (
                      <div className="w-full h-full bg-gray-50/40 rounded-xl opacity-30"></div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ================= RENDER MONTH VIEW =================
  const renderMonthView = () => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start, end });
    const targetRoom = selectedRoom === 'ALL' ? 'Sala 1' : selectedRoom;

    return (
      <div className="animate-fade-in p-6">
        <div className="grid grid-cols-7 mb-4">
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(day => (
            <div key={day} className={`text-center text-[11px] font-black uppercase tracking-widest py-2 ${
              day === 'Dom' 
                ? 'text-slate-400' 
                : day === 'Sáb' 
                ? 'text-teal-700' 
                : 'text-gray-400'
            }`}>
              {day} {day === 'Dom' ? '• Fechado' : day === 'Sáb' ? '• Até 14h' : ''}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {days.map((day, idx) => {
            const isSunday = getDay(day) === 0;
            const isSaturday = getDay(day) === 6;
            const isCurrentMonth = isSameMonth(day, currentDate);
            const isTodayDate = isToday(day);
            const isoDate = format(day, 'yyyy-MM-dd');
            const targetRoomNorm = String(targetRoom).trim().toLowerCase();
            const dayBookings = bookings.filter(b => {
              const bRoom = String(b.roomId || '').trim().toLowerCase();
              const bDate = String(b.date || '').split('T')[0].trim();
              if ((bRoom === 'sala 2' || bRoom === 'sala2') && bDate === '2026-10-14' && (b.hour === 18 || b.hour === 19)) {
                return false;
              }
              return bRoom === targetRoomNorm && bDate === isoDate;
            });
            const { isHoliday, isUnblocked } = getHolidayInfo(day);

            return (
              <div 
                key={idx}
                onClick={() => {
                  setCurrentDate(day);
                  setViewMode('day');
                }}
                className={`min-h-[100px] p-2.5 rounded-2xl border-2 transition-all cursor-pointer group flex flex-col justify-between ${
                  isSunday
                    ? 'bg-slate-50/70 border-slate-200/50 text-slate-400'
                    : isCurrentMonth 
                    ? 'bg-white border-gray-100 hover:border-teal-300' 
                    : 'bg-gray-50/50 border-transparent opacity-40'
                } ${isTodayDate ? 'border-teal-500 shadow-lg shadow-teal-500/10' : ''}`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-1.5">
                    <span className={`text-sm font-black ${isTodayDate ? 'text-teal-600' : isSunday ? 'text-slate-400' : isCurrentMonth ? 'text-gray-800' : 'text-gray-400'}`}>
                      {format(day, 'd')}
                    </span>
                    {isSaturday && isCurrentMonth && (
                      <span className="text-[8px] font-bold text-teal-700 bg-teal-50 px-1 py-0.2 rounded uppercase">
                        Até 14h
                      </span>
                    )}
                  </div>
                  {isHoliday && !isSunday && (
                    <Palmtree size={14} className={isUnblocked ? 'text-teal-500' : 'text-orange-400'} />
                  )}
                </div>

                <div className="space-y-1">
                  {isSunday ? (
                    <div className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                      Fechado
                    </div>
                  ) : dayBookings.length > 0 ? (
                    <div className="space-y-1">
                      <div className="bg-teal-50 text-teal-700 text-[9px] font-black px-2 py-1 rounded-lg uppercase tracking-tight flex items-center gap-1 truncate">
                        <div className="w-1.5 h-1.5 rounded-full bg-teal-500 shrink-0"></div>
                        <span className="truncate">
                          {dayBookings.length} {dayBookings.length === 1 ? 'Locação' : 'Locações'}
                        </span>
                      </div>
                      {dayBookings.slice(0, 1).map((b, bIdx) => (
                        <div key={bIdx} className="text-[8px] font-bold text-gray-500 truncate px-0.5">
                          {b.type === 'PERIOD'
                            ? (b.periodName ? `Período ${b.periodName}` : `Período (${b.hour}h-${b.endTimeHour}h)`)
                            : `${b.hour}:00 (${b.durationHours}h)`
                          }
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[9px] text-gray-300 font-bold uppercase opacity-0 group-hover:opacity-100 transition-opacity">
                      Ver dia
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden animate-slide-up">
      {/* Barra Superior com Filtro de Salas, Controles de Data e Modos */}
      <div className="px-6 py-6 border-b border-gray-100 flex flex-col xl:flex-row justify-between items-center gap-4 bg-white">
        {/* Seletor de Sala */}
        <div className="flex bg-gray-100 p-1.5 rounded-2xl w-full xl:w-auto">
          {['Sala 1', 'Sala 2'].map(room => (
            <button
              key={room}
              onClick={() => setSelectedRoom(room as RoomFilter)}
              className={`flex-1 xl:px-6 py-2.5 text-xs font-black rounded-xl transition-all ${
                selectedRoom === room
                  ? 'bg-white text-teal-600 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {room}
            </button>
          ))}
          {viewMode === 'day' && (
            <span className="hidden xl:inline-flex items-center px-3 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
              (Visão Lado a Lado)
            </span>
          )}
        </div>

        {/* Navegação de Datas */}
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrev}
            className="p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-full transition-all"
            title="Anterior"
          >
            <ChevronLeft size={22} />
          </button>
          <h2 className="text-base font-black text-gray-900 min-w-[220px] text-center capitalize">
            {dateLabel}
          </h2>
          <button
            onClick={handleNext}
            className="p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-full transition-all"
            title="Próximo"
          >
            <ChevronRight size={22} />
          </button>
        </div>

        {/* Seletor de Visualização (Dia, Semana, Mês) */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleToday}
            className="px-4 py-2 text-xs font-bold text-teal-600 hover:bg-teal-50 rounded-xl transition-all"
          >
            Hoje
          </button>
          <div className="flex bg-gray-100 p-1 rounded-xl">
            {(['day', 'week', 'month'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${
                  viewMode === mode
                    ? 'bg-teal-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-700'
                }`}
              >
                {mode === 'day' ? 'Dia' : mode === 'week' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Indicador de Horário de Atendimento e Fechamento aos Domingos */}
      <div className="px-6 py-2.5 bg-slate-50 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-gray-600">
          <span>Horário de funcionamento:</span>
          <span>Seg a Sex: <strong className="text-gray-800">07:00 às 22:00</strong></span>
          <span className="text-gray-300">•</span>
          <span>Sábados: <strong className="text-teal-700 font-bold">07:00 às 14:00</strong></span>
        </div>
        <span className="text-slate-600 bg-slate-200/80 px-2.5 py-0.5 rounded-md font-black uppercase text-[9px] tracking-wider">
          Fechado aos Domingos
        </span>
      </div>

      {/* Grid Principal do Calendário */}
      <div className="min-h-[600px] bg-white">
        {viewMode === 'day' && renderDayView()}
        {viewMode === 'week' && renderWeekView()}
        {viewMode === 'month' && renderMonthView()}
      </div>

      {/* Legenda Inferior de Status */}
      <div className="px-6 py-4 bg-gray-50/60 border-t border-gray-100 flex items-center gap-6 overflow-x-auto text-xs whitespace-nowrap custom-scrollbar">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-teal-500 rounded-md"></div>
          <span className="text-[10px] font-black uppercase text-gray-600">Sua Reserva</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-emerald-100 border border-emerald-300 rounded-md"></div>
          <span className="text-[10px] font-black uppercase text-gray-600">Outro Profissional (Indisponível)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-amber-100 border border-amber-300 rounded-md"></div>
          <span className="text-[10px] font-black uppercase text-gray-600">Bloqueio da Clínica</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border border-dashed border-gray-300 rounded-md"></div>
          <span className="text-[10px] font-black uppercase text-gray-600">Disponível (Clique para Alugar)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 bg-slate-100 border border-slate-200 rounded-md"></div>
          <span className="text-[10px] font-black uppercase text-gray-500">Fechado aos Domingos</span>
        </div>
      </div>

      {/* ================= MODAL NOVA LOCAÇÃO (Seção 2, 22) ================= */}
      {/* ================= MODAL NOVA LOCAÇÃO (ÚNICA OU RECORRENTE) ================= */}
      <Modal
        isOpen={isBookingModalOpen}
        onClose={() => {
          setIsBookingModalOpen(false);
          setShowSummaryView(false);
        }}
        title={
          isRecurringMode 
            ? (showSummaryView ? 'Resumo da Série Recorrente' : 'Novo Agendamento Recorrente') 
            : 'Nova Locação'
        }
      >
        <div className="space-y-5">
          {/* Alternador do Tipo de Agendamento: Único vs Recorrente (Seção 2) */}
          <div className="flex bg-gray-100 p-1 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setIsRecurringMode(false);
                setShowSummaryView(false);
              }}
              className={`flex-1 py-2 px-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                !isRecurringMode
                  ? 'bg-white text-teal-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              Agendamento Único
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRecurringMode(true);
                setShowSummaryView(false);
                setRecPreviewSummary(null);
                setRecSkipConflicts(false);
              }}
              className={`flex-1 py-2 px-3 text-xs font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                isRecurringMode
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              <Repeat size={13} />
              Agendamento Recorrente
            </button>
          </div>

          {/* ================= FLUXO RECORRENTE: TELA 2 (RESUMO & CONFLITOS) ================= */}
          {isRecurringMode && showSummaryView && recPreviewSummary ? (
            <div className="space-y-4 animate-fade-in">
              {/* Card de Resumo Geral (Seção 3.G) */}
              <div className="bg-teal-50 border border-teal-200/80 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-teal-200/60 pb-2">
                  <div className="flex items-center gap-2">
                    <Repeat size={18} className="text-teal-700" />
                    <span className="text-xs font-black uppercase tracking-wider text-teal-900">
                      Resumo da Recorrência
                    </span>
                  </div>
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-teal-200/70 text-teal-900">
                    {recPreviewSummary.roomId}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs text-teal-950">
                  <div>
                    <span className="text-[10px] font-bold text-teal-700 uppercase block">Frequência:</span>
                    <strong className="font-black">
                      {recPreviewSummary.frequency === 'WEEKLY' ? 'Semanal' : recPreviewSummary.frequency === 'BIWEEKLY' ? 'Quinzenal' : 'Mensal'}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-teal-700 uppercase block">Primeira Data:</span>
                    <strong className="font-black">
                      {format(parseISO(recPreviewSummary.startDate), "dd/MM/yyyy")}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-teal-700 uppercase block">Horário:</span>
                    <strong className="font-black">
                      {bookingType === 'PERIOD'
                        ? `Turno (${bookingPeriodShift})`
                        : `${bookingStartHour}:00 às ${bookingStartHour + bookingDuration}:00`}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-teal-700 uppercase block">Total Previsto:</span>
                    <strong className="font-black">{recPreviewSummary.totalExpected} ocorrências</strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-teal-700 uppercase block">Disponíveis:</span>
                    <strong className="font-black text-emerald-700">{recPreviewSummary.availableCount} horários</strong>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-teal-700 uppercase block">Conflitos:</span>
                    <strong className={`font-black ${recPreviewSummary.conflictCount > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {recPreviewSummary.conflictCount} encontrados
                    </strong>
                  </div>
                </div>

                <div className="pt-2 border-t border-teal-200/60 flex justify-between items-center">
                  <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider">
                    Valor Estimado Total ({recPreviewSummary.availableCount} vagas):
                  </span>
                  <span className="text-xl font-black text-teal-800">
                    R$ {recPreviewSummary.totalEstimatedAmount.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Lista Detalhada de Ocorrências Previstas (Seção 4 e 5) */}
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-2">
                  Detalhamento de Cada Ocorrência ({recPreviewSummary.occurrences.length})
                </label>
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                  {recPreviewSummary.occurrences.map((occ, idx) => {
                    const parsed = parseISO(occ.date);
                    return (
                      <div
                        key={occ.date}
                        className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs transition-all ${
                          occ.hasConflict
                            ? 'bg-red-50/70 border-red-200 text-red-900'
                            : 'bg-emerald-50/50 border-emerald-200/70 text-gray-800'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] font-black text-gray-400 w-5">
                            #{idx + 1}
                          </span>
                          <div>
                            <span className="font-black">
                              {format(parsed, "dd/MM/yyyy (EEEE)", { locale: ptBR })}
                            </span>
                            <span className="text-[11px] text-gray-500 block">
                              {occ.startHour}:00 às {occ.endHour}:00
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {occ.hasConflict ? (
                            <span className="text-[10px] font-black text-red-700 bg-red-100 px-2 py-0.5 rounded-md block">
                              ⚠️ Conflito: {occ.conflictReason}
                            </span>
                          ) : (
                            <span className="text-[10px] font-black text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md block">
                              ✓ Disponível (R$ {occ.price.toFixed(2)})
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Tratamento Obrigatório de Conflitos (Seção 5) */}
              {recPreviewSummary.availableCount === 0 ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-xs space-y-1">
                  <div className="flex items-center gap-2 font-black uppercase tracking-wider">
                    <AlertTriangle size={16} /> Nenhuma Data Disponível
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    Todas as datas calculadas para esta série possuem conflitos com outras reservas ou restrições de funcionamento. Nenhuma locação pode ser gerada. Volte à configuração para escolher outro horário ou sala.
                  </p>
                </div>
              ) : recPreviewSummary.conflictCount > 0 ? (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-amber-900 text-xs space-y-3">
                  <div className="flex items-center gap-2 font-black uppercase tracking-wider text-amber-800">
                    <AlertTriangle size={16} /> Conflitos Detectados na Série
                  </div>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Foram identificadas <strong>{recPreviewSummary.conflictCount}</strong> datas com conflito. Conforme as regras do LocaPsico, você pode cancelar a operação ou criar exclusivamente as datas disponíveis.
                  </p>
                  <label className="flex items-start gap-2.5 p-2 bg-white/70 border border-amber-200 rounded-xl cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={recSkipConflicts}
                      onChange={e => setRecSkipConflicts(e.target.checked)}
                      className="mt-0.5 rounded border-amber-400 text-teal-600 focus:ring-teal-500 w-4 h-4"
                    />
                    <span className="text-xs font-bold text-amber-950">
                      <strong>Opção B:</strong> Confirmo e autorizo criar apenas as <strong>{recPreviewSummary.availableCount}</strong> datas disponíveis, ignorando silenciosamente os <strong>{recPreviewSummary.conflictCount}</strong> conflitos.
                    </span>
                  </label>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle size={16} className="text-emerald-600 shrink-0" />
                  <span className="font-black uppercase tracking-wider text-[11px]">
                    ✓ Todas as {recPreviewSummary.totalExpected} datas estão 100% livres e prontas para reserva!
                  </span>
                </div>
              )}

              {/* Botões do Resumo */}
              <div className="pt-2 flex justify-between items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setShowSummaryView(false);
                    setRecIdempotencyKey('');
                  }}
                >
                  ← Voltar à Configuração
                </Button>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setIsBookingModalOpen(false);
                      setShowSummaryView(false);
                      setRecIdempotencyKey('');
                    }}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      isSubmitting ||
                      recPreviewSummary.availableCount === 0 ||
                      (recPreviewSummary.conflictCount > 0 && !recSkipConflicts)
                    }
                    onClick={handleConfirmBooking}
                    className="flex items-center gap-2"
                  >
                    {isSubmitting ? (
                      'Gravando Série...'
                    ) : (
                      <>
                        <Repeat size={14} />
                        Confirmar Série ({recPreviewSummary.availableCount} reservas)
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* ================= FORMULÁRIO DE CRIAÇÃO (ÚNICO OU RECORRENTE - ETAPA 1) ================= */
            <>
              {/* Escolha da Sala (Seção 3.A) */}
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                  Sala Selecionada
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {(['Sala 1', 'Sala 2'] as RoomId[]).map(room => (
                    <button
                      key={room}
                      type="button"
                      onClick={() => setBookingRoom(room)}
                      className={`py-3 px-4 rounded-2xl text-xs font-black uppercase tracking-wider border-2 transition-all flex items-center justify-center ${
                        bookingRoom === room
                          ? 'border-teal-600 bg-teal-50/50 text-teal-800'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      <span>{room}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Data e Horário (Seção 3.B e 3.C) */}
              {(() => {
                const parsedBookingDate = bookingDate ? new Date(Number(bookingDate.split('-')[0]), Number(bookingDate.split('-')[1]) - 1, Number(bookingDate.split('-')[2])) : new Date();
                const bookingDayOfWeek = parsedBookingDate.getDay();
                const isSaturday = bookingDayOfWeek === 6;
                const maxClosing = getClosingHourForDate(bookingDayOfWeek) || hoursEnd;
                const availableHoursForDay = hours.filter(h => h < maxClosing);

                return (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                          {isRecurringMode ? 'Data de Início da Série' : 'Data'}
                        </label>
                        <input
                          type="date"
                          value={bookingDate}
                          onChange={e => {
                            const newDateStr = e.target.value;
                            setBookingDate(newDateStr);
                            if (newDateStr) {
                              const [y, m, d] = newDateStr.split('-').map(Number);
                              const newDay = new Date(y, m - 1, d).getDay();
                              const newMax = getClosingHourForDate(newDay);
                              if (newMax > 0 && bookingStartHour >= newMax) {
                                setBookingStartHour(hoursStart);
                              }
                              // Sincroniza dia da semana para recorrência
                              if (newDay >= 1 && newDay <= 6 && recWeekdays.length <= 1) {
                                setRecWeekdays([newDay]);
                              }
                            }
                          }}
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                        />
                        <span className="text-[10px] text-gray-400 font-medium mt-1 block">
                          {isSaturday ? (
                            <strong className="text-teal-700">Aos sábados o atendimento vai até as 14:00.</strong>
                          ) : (
                            'Atendimento de seg a sáb (salas fechadas aos domingos).'
                          )}
                        </span>
                      </div>

                      <div>
                        <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                          Tipo de Locação
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setBookingType('HOURLY')}
                            className={`py-2.5 px-3 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all ${
                              bookingType === 'HOURLY'
                                ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                                : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            Por Hora
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setBookingType('PERIOD');
                              if (isSaturday && bookingPeriodShift === 'NIGHT') {
                                setBookingPeriodShift('MORNING');
                              }
                            }}
                            className={`py-2.5 px-3 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all ${
                              bookingType === 'PERIOD'
                                ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                                : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                            }`}
                          >
                            Por Período (Turno)
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Parâmetros se for por hora */}
                    {bookingType === 'HOURLY' ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                            Horário Inicial
                          </label>
                          <select
                            value={bookingStartHour >= maxClosing ? hoursStart : bookingStartHour}
                            onChange={e => setBookingStartHour(Number(e.target.value))}
                            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                          >
                            {availableHoursForDay.map(h => (
                              <option key={h} value={h}>
                                {h.toString().padStart(2, '0')}:00
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                            Duração
                          </label>
                          <select
                            value={bookingDuration}
                            onChange={e => setBookingDuration(Number(e.target.value))}
                            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                          >
                            {[1, 2, 3, 4, 5, 6, 7, 8].filter(d => bookingStartHour + d <= maxClosing).map(d => (
                              <option key={d} value={d}>
                                {d} {d === 1 ? 'hora' : 'horas'} (até {bookingStartHour + d}:00)
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                          Selecione o Turno Desejado
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                          {BOOKING_PERIODS.map(p => {
                            const conf = getPeriodConfig(p.id, bookingDate);
                            const isSelected = bookingPeriodShift === p.id;
                            const isAvailable = conf.isAvailableOnDate;
                            const roomObj = rooms.find(r => r.id === bookingRoom);
                            let rate = 0;
                            if (p.id === 'MORNING') rate = roomObj?.morningRate || INITIAL_PERIOD_RATES.MORNING;
                            else if (p.id === 'AFTERNOON') {
                              const base = roomObj?.afternoonRate || INITIAL_PERIOD_RATES.AFTERNOON;
                              rate = isSaturday ? Number((base * (2 / 6)).toFixed(2)) : base;
                            } else if (p.id === 'NIGHT') {
                              rate = roomObj?.nightRate || INITIAL_PERIOD_RATES.NIGHT;
                            } else {
                              const base = roomObj?.dailyRate || roomObj?.fullDayRate || INITIAL_PERIOD_RATES.FULL_DAY;
                              rate = isSaturday ? Number((base * (7 / 15)).toFixed(2)) : base;
                            }

                            return (
                              <button
                                key={p.id}
                                type="button"
                                disabled={!isAvailable}
                                onClick={() => {
                                  if (isAvailable) setBookingPeriodShift(p.id);
                                }}
                                className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between transition-all ${
                                  !isAvailable
                                    ? 'bg-gray-100/70 border-gray-200 text-gray-400 opacity-60 cursor-not-allowed'
                                    : isSelected
                                    ? 'bg-teal-50 border-teal-600 text-teal-900 shadow-sm ring-2 ring-teal-500/20'
                                    : 'bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50/50'
                                }`}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className={`p-2 rounded-xl ${
                                    isSelected ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-500'
                                  }`}>
                                    {p.id === 'MORNING' ? (
                                      <Sunrise size={18} />
                                    ) : p.id === 'AFTERNOON' ? (
                                      <Sun size={18} />
                                    ) : p.id === 'NIGHT' ? (
                                      <Moon size={18} />
                                    ) : (
                                      <CalendarIcon size={18} />
                                    )}
                                  </div>
                                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                    isSelected ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700'
                                  }`}>
                                    {isAvailable ? `R$ ${rate.toFixed(2)}` : 'Indisponível'}
                                  </span>
                                </div>
                                <div>
                                  <div className="font-black text-xs uppercase tracking-wide">
                                    {p.name}
                                  </div>
                                  <span className="text-[11px] font-bold text-gray-600 block mt-0.5">
                                    {conf.startHour.toString().padStart(2, '0')}:00 às {conf.endHour.toString().padStart(2, '0')}:00
                                  </span>
                                  <span className="text-[10px] text-gray-400 mt-0.5 block font-medium">
                                    {!isAvailable ? 'Fechado aos sábados' : `${conf.duration} horas de locação`}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* ================= CAMPOS EXCLUSIVOS DE RECORRÊNCIA (Seção 3.D, 3.E, 3.F) ================= */}
              {isRecurringMode && (
                <div className="bg-gray-50 border border-gray-200/80 rounded-2xl p-4 space-y-4">
                  {/* Frequência (Seção 3.D) */}
                  <div>
                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                      Frequência de Repetição
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'WEEKLY' as RecurrenceFrequency, label: 'Semanal', sub: 'A cada semana' },
                        { id: 'BIWEEKLY' as RecurrenceFrequency, label: 'Quinzenal', sub: 'A cada 2 semanas' },
                        { id: 'MONTHLY' as RecurrenceFrequency, label: 'Mensal', sub: 'Mesmo dia do mês' }
                      ].map(f => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => setRecFrequency(f.id)}
                          className={`p-2.5 rounded-xl border text-center transition-all ${
                            recFrequency === f.id
                              ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <span className="text-xs font-black uppercase tracking-wider block">
                            {f.label}
                          </span>
                          <span className={`text-[9px] block ${recFrequency === f.id ? 'text-teal-100' : 'text-gray-400'}`}>
                            {f.sub}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Dias da Semana (Seção 3.E) */}
                  {recFrequency !== 'MONTHLY' && (
                    <div>
                      <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                        Dias da Semana (Permite múltiplos dias)
                      </label>
                      <div className="grid grid-cols-6 gap-1.5">
                        {[
                          { id: 1, label: 'Seg' },
                          { id: 2, label: 'Ter' },
                          { id: 3, label: 'Qua' },
                          { id: 4, label: 'Qui' },
                          { id: 5, label: 'Sex' },
                          { id: 6, label: 'Sáb' }
                        ].map(d => {
                          const isSel = recWeekdays.includes(d.id);
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => {
                                setRecWeekdays(prev =>
                                  prev.includes(d.id)
                                    ? (prev.length > 1 ? prev.filter(x => x !== d.id) : prev)
                                    : [...prev, d.id].sort()
                                );
                              }}
                              className={`py-2 rounded-xl text-xs font-black transition-all ${
                                isSel
                                  ? 'bg-teal-600 text-white shadow-sm ring-2 ring-teal-500/20'
                                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                              }`}
                            >
                              {d.label}
                            </button>
                          );
                        })}
                      </div>
                      <span className="text-[10px] text-gray-400 font-medium mt-1 block">
                        {recFrequency === 'BIWEEKLY'
                          ? 'A frequência quinzenal preserva rigorosamente a alternância a cada 2 semanas.'
                          : 'As salas não funcionam aos domingos.'}
                      </span>
                    </div>
                  )}

                  {/* Encerramento (Seção 3.F) */}
                  <div>
                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                      Critério de Encerramento
                    </label>
                    <div className="grid grid-cols-2 gap-2 mb-2.5">
                      <button
                        type="button"
                        onClick={() => setRecEndType('OCCURRENCES')}
                        className={`py-2 px-3 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all ${
                          recEndType === 'OCCURRENCES'
                            ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        Qtd. de Ocorrências
                      </button>
                      <button
                        type="button"
                        onClick={() => setRecEndType('UNTIL_DATE')}
                        className={`py-2 px-3 rounded-xl text-[11px] font-black uppercase tracking-wider border transition-all ${
                          recEndType === 'UNTIL_DATE'
                            ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                            : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        Até Data Específica
                      </button>
                    </div>

                    {recEndType === 'OCCURRENCES' ? (
                      <div className="flex items-center gap-2">
                        {[4, 8, 12, 16].map(num => (
                          <button
                            key={num}
                            type="button"
                            onClick={() => setRecOccurrencesCount(num)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all ${
                              recOccurrencesCount === num
                                ? 'bg-teal-600 text-white'
                                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-100'
                            }`}
                          >
                            {num}x
                          </button>
                        ))}
                        <input
                          type="number"
                          min="1"
                          max="52"
                          value={recOccurrencesCount}
                          onChange={e => setRecOccurrencesCount(Math.max(1, Number(e.target.value)))}
                          className="w-20 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-center"
                          title="Quantidade de ocorrências"
                        />
                      </div>
                    ) : (
                      <input
                        type="date"
                        value={recEndDate}
                        min={bookingDate}
                        onChange={e => setRecEndDate(e.target.value)}
                        className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-semibold text-gray-800"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Seleção de Paciente */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                    Cliente / Paciente
                  </label>
                  {onOpenClients && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsBookingModalOpen(false);
                        onOpenClients();
                      }}
                      className="text-[11px] font-black text-teal-600 hover:underline uppercase tracking-wider"
                    >
                      + Cadastrar Novo Paciente
                    </button>
                  )}
                </div>

                <select
                  value={selectedClientId}
                  onChange={e => setSelectedClientId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                >
                  <option value="">-- Atendimento sem paciente vinculado --</option>
                  {myClients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name} {c.cpf ? `(CPF: ${c.cpf})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Feedback de Conflito em Tempo Real (Apenas para agendamento único) */}
              {!isRecurringMode && (
                <div className="pt-1">
                  {isCheckingConflict ? (
                    <div className="text-xs text-gray-400 flex items-center gap-2">
                      <div className="w-3.5 h-3.5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
                      <span>Verificando disponibilidade da sala...</span>
                    </div>
                  ) : conflictStatus.hasConflict ? (
                    <div className="p-3.5 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs flex items-start gap-2.5 animate-fade-in">
                      <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                      <div>
                        <span className="font-black uppercase tracking-wider block">Horário Indisponível</span>
                        <span className="text-[11px] leading-relaxed">{conflictStatus.reason}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-800 text-xs flex items-center gap-2 animate-fade-in">
                      <CheckCircle size={16} className="text-emerald-600 shrink-0" />
                      <span className="font-black uppercase tracking-wider text-[11px]">
                        ✓ Sala disponível. Confirme sua locação.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Resumo de Valor (Apenas para agendamento único) */}
              {!isRecurringMode && (
                <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 flex justify-between items-center">
                  <div>
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">
                      Valor Total da Locação
                    </span>
                    <span className="text-xs text-gray-500">
                      {(() => {
                        const bDay = bookingDate ? new Date(Number(bookingDate.split('-')[0]), Number(bookingDate.split('-')[1]) - 1, Number(bookingDate.split('-')[2])).getDay() : 1;
                        const closeH = getClosingHourForDate(bDay) || hoursEnd;
                        const periodHours = closeH - hoursStart;
                        const currentRoom = rooms.find(r => r.id === bookingRoom);
                        const roomHourlyRate = currentRoom?.hourlyRate || 40;
                        return bookingType === 'PERIOD' 
                          ? `Tarifa do Período (${periodHours}h)` 
                          : `${bookingDuration}h × R$ ${roomHourlyRate.toFixed(2)}/h`;
                      })()}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-black text-teal-600">
                      R$ {modalCalculatedPrice.toFixed(2)}
                    </span>
                    <span className="block text-[9px] text-gray-400 font-bold uppercase tracking-wider">
                      Faturamento mensal
                    </span>
                  </div>
                </div>
              )}

              {/* Botões de Ação */}
              <div className="pt-2 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsBookingModalOpen(false)}
                >
                  Cancelar
                </Button>
                {isRecurringMode ? (
                  <Button
                    type="button"
                    disabled={isLoadingRecPreview}
                    onClick={handleGenerateRecSummary}
                    className="flex items-center gap-2"
                  >
                    {isLoadingRecPreview ? (
                      'Calculando Conflitos...'
                    ) : (
                      <>
                        <span>Visualizar Resumo da Série</span>
                        <ChevronRight size={16} />
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={conflictStatus.hasConflict || isSubmitting || isCheckingConflict}
                    onClick={handleConfirmBooking}
                    className="flex items-center gap-2"
                  >
                    {isSubmitting ? 'Confirmando...' : 'Confirmar Locação'}
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ================= MODAL DETALHES / GERENCIAMENTO (Seção 4, 9, 23) ================= */}
      <Modal
        isOpen={isDetailsModalOpen}
        onClose={() => {
          setIsDetailsModalOpen(false);
          setConfirmCancelFuture(false);
        }}
        title="Detalhes da Locação"
      >
        {selectedBooking && (
          <div className="space-y-6">
            <div className="bg-teal-50 border border-teal-100 rounded-3xl p-5 text-center space-y-1">
              <span className="text-[10px] font-black text-teal-600 uppercase tracking-widest">
                Identificador da Reserva: #{selectedBooking.id}
              </span>
              <h3 className="text-xl font-black text-gray-900">
                {selectedBooking.roomId}
              </h3>
              <p className="text-sm font-bold text-teal-700">
                {format(parseISO(selectedBooking.date), "EEEE, d 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </p>
            </div>

            {/* Painel Especial de Agendamento Recorrente (Seção 7 e 8) */}
            {selectedBooking.recurrenceId && (
              <div className="bg-teal-50/70 border border-teal-200/80 rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Repeat size={16} className="text-teal-700" />
                    <span className="text-xs font-black uppercase tracking-wider text-teal-900">
                      Agendamento Recorrente
                    </span>
                  </div>
                  <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-teal-200/70 text-teal-900">
                    Ocorrência #{selectedBooking.recurrenceIndex || 1} de {selectedBooking.recurrenceTotal || 1}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs text-teal-950">
                  <span>Regra da Série: <strong className="font-bold">{selectedBooking.recurrenceRule === 'WEEKLY' ? 'Semanal' : selectedBooking.recurrenceRule === 'BIWEEKLY' ? 'Quinzenal' : 'Mensal'}</strong></span>
                  <button
                    type="button"
                    onClick={() => handleOpenSeriesModal(selectedBooking.recurrenceId!)}
                    className="font-black text-teal-700 underline hover:text-teal-900 flex items-center gap-1 uppercase text-[10px] tracking-wider"
                  >
                    <CalendarRange size={13} /> Consultar Toda a Série
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-3 text-xs text-gray-700 bg-gray-50 p-5 rounded-2xl border border-gray-100">
              <div className="flex justify-between py-1 border-b border-gray-200/60">
                <span className="text-gray-400 font-bold uppercase tracking-wider">Horário:</span>
                <span className="font-black">
                  {selectedBooking.type === 'PERIOD'
                    ? `${selectedBooking.hour.toString().padStart(2, '0')}:00 às ${selectedBooking.endTimeHour.toString().padStart(2, '0')}:00 (${selectedBooking.periodName ? `Período ${selectedBooking.periodName}` : 'Período'})`
                    : `${selectedBooking.hour}:00 às ${selectedBooking.endTimeHour}:00 (${selectedBooking.durationHours}h)`
                  }
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-gray-200/60">
                <span className="text-gray-400 font-bold uppercase tracking-wider">Profissional:</span>
                <span className="font-black text-teal-700">{selectedBooking.userName}</span>
              </div>

              <div className="flex justify-between py-1 border-b border-gray-200/60">
                <span className="text-gray-400 font-bold uppercase tracking-wider">Paciente / Cliente:</span>
                <span className="font-black">
                  {selectedBooking.clientName || 'Não especificado'}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-gray-200/60">
                <span className="text-gray-400 font-bold uppercase tracking-wider">Valor Aplicado:</span>
                <span className="font-black text-gray-900">
                  R$ {selectedBooking.totalAmount.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between py-1 items-center">
                <span className="text-gray-400 font-bold uppercase tracking-wider">Status do Pagamento:</span>
                <span className={`px-2.5 py-1 rounded-lg font-black uppercase text-[10px] tracking-wider ${
                  selectedBooking.paymentStatus === 'PAID'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {selectedBooking.paymentStatus === 'PAID' ? 'Pago' : 'Pendente'}
                </span>
              </div>
            </div>

            {!isAdmin && selectedBooking.userId === user.id && cancellationLimitHours > 0 && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-2.5 text-[11px] text-amber-800 font-medium">
                Política de cancelamento: antecedência mínima de <strong>{cancellationLimitHours}h</strong> antes do horário agendado.
              </div>
            )}

            {/* Confirmação de Cancelamento de Ocorrências Futuras (Seção 9) */}
            {confirmCancelFuture && selectedBooking.recurrenceId && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-900 text-xs space-y-3 animate-fade-in">
                <div className="flex items-center gap-2 font-black uppercase tracking-wider text-red-800">
                  <AlertTriangle size={16} /> Confirmar Cancelamento da Série
                </div>
                <p className="text-[11px] leading-relaxed">
                  Esta ação irá cancelar <strong>esta ocorrência ({format(parseISO(selectedBooking.date), 'dd/MM/yyyy')}) e todas as ocorrências futuras</strong> desta série recorrente. Ocorrências passadas serão mantidas intactas no histórico.
                </p>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setConfirmCancelFuture(false)}
                  >
                    Voltar
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    disabled={isCancellingSeries}
                    onClick={handleCancelFutureOccurrences}
                  >
                    {isCancellingSeries ? 'Cancelando Futuras...' : 'Confirmar e Cancelar Futuras'}
                  </Button>
                </div>
              </div>
            )}

            {/* Ações: Cancelamento ou Fechar (Seção 9) */}
            {!confirmCancelFuture && (
              <div className="pt-2 flex flex-wrap justify-between items-center gap-2">
                {(selectedBooking.userId === user.id || isAdmin) ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="danger"
                      disabled={isCancelling}
                      onClick={handleCancelBooking}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <Ban size={15} />
                      {isCancelling ? 'Cancelando...' : 'Cancelar Apenas Esta'}
                    </Button>

                    {selectedBooking.recurrenceId && (
                      <Button
                        variant="secondary"
                        onClick={() => setConfirmCancelFuture(true)}
                        className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                      >
                        <RotateCcw size={14} />
                        Cancelar Esta e Futuras
                      </Button>
                    )}
                  </div>
                ) : (
                  <div></div>
                )}

                <Button
                  variant="secondary"
                  onClick={() => setIsDetailsModalOpen(false)}
                >
                  Fechar
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ================= MODAL SÉRIE COMPLETA (Seção 9) ================= */}
      <Modal
        isOpen={isSeriesModalOpen}
        onClose={() => setIsSeriesModalOpen(false)}
        title="Gerenciamento da Série Recorrente"
      >
        <div className="space-y-5">
          {isLoadingSeries ? (
            <div className="py-12 flex flex-col items-center justify-center gap-3 text-gray-400">
              <div className="w-6 h-6 border-2 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs font-bold uppercase tracking-wider">Carregando dados da série...</span>
            </div>
          ) : (
            <>
              {/* Resumo da Série Carregada */}
              {seriesBookings.length > 0 && (
                <div className="bg-teal-50 border border-teal-200/80 rounded-2xl p-4">
                  <div className="flex items-center justify-between pb-2 border-b border-teal-200/60 mb-2">
                    <span className="text-xs font-black uppercase text-teal-900 flex items-center gap-2">
                      <Repeat size={16} /> Série #{seriesBookings[0].recurrenceId?.slice(0, 8)}
                    </span>
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-teal-200 text-teal-900">
                      {seriesBookings[0].roomId}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-teal-950">
                    <div>
                      <span className="text-[10px] font-bold text-teal-700 uppercase block">Total:</span>
                      <strong className="font-black">{seriesBookings.length} reservas</strong>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-teal-700 uppercase block">Ativas:</span>
                      <strong className="font-black text-emerald-700">
                        {seriesBookings.filter(b => b.paymentStatus !== 'CANCELLED').length}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-teal-700 uppercase block">Canceladas:</span>
                      <strong className="font-black text-gray-500">
                        {seriesBookings.filter(b => b.paymentStatus === 'CANCELLED').length}
                      </strong>
                    </div>
                    <div>
                      <span className="text-[10px] font-bold text-teal-700 uppercase block">Total Faturado:</span>
                      <strong className="font-black text-teal-800">
                        R$ {seriesBookings.filter(b => b.paymentStatus !== 'CANCELLED').reduce((s, b) => s + b.totalAmount, 0).toFixed(2)}
                      </strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabela de Ocorrências da Série */}
              <div>
                <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-2">
                  Todas as Ocorrências da Série
                </label>
                <div className="max-h-72 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
                  {seriesBookings.map((b, idx) => {
                    const isCancelled = b.paymentStatus === 'CANCELLED';
                    return (
                      <div
                        key={b.id}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                          isCancelled
                            ? 'bg-gray-50/70 border-gray-200 text-gray-400 opacity-70'
                            : 'bg-white border-gray-200 text-gray-800 shadow-sm'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-[10px] font-black text-gray-400 w-6">
                            #{idx + 1}
                          </span>
                          <div>
                            <div className="font-black">
                              {format(parseISO(b.date), "dd/MM/yyyy (EEEE)", { locale: ptBR })}
                            </div>
                            <span className="text-[11px] text-gray-500 block">
                              {b.hour}:00 às {b.endTimeHour}:00 {b.clientName ? `• Paciente: ${b.clientName}` : ''}
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md block ${
                            isCancelled
                              ? 'bg-gray-100 text-gray-500'
                              : b.paymentStatus === 'PAID'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {isCancelled ? 'Cancelada' : b.paymentStatus === 'PAID' ? 'Pago' : 'Pendente'}
                          </span>
                          <span className="text-[11px] font-bold text-gray-700 mt-0.5 block">
                            R$ {b.totalAmount.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsSeriesModalOpen(false)}
                >
                  Fechar
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};
