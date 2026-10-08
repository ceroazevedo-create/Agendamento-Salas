import React, { useState, useEffect, useMemo } from 'react';
import { Booking, User, RoomId, Room, BlockedSlot, AuditLog, SystemConfig, PaymentStatus } from '../types';
import { bookingService } from '../services/bookingService';
import { authService } from '../services/authService';
import { clientService } from '../services/clientService';
import { 
  getStoredAuditLogs, 
  getSystemConfig, 
  saveSystemConfig,
  getStoredBookings,
  getStoredUsers,
  getStoredBlockedSlots
} from '../services/storageService';
import { INITIAL_HOURLY_RATE, INITIAL_DAILY_RATE, INITIAL_PERIOD_RATES, getClosingHourForDate, SATURDAY_HOURS_END } from '../constants';
import { Button } from './Button';
import { Modal } from './Modal';
import { Input } from './Input';
import { PasswordInput } from './PasswordInput';
import { format, parseISO, addDays, isToday, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';
import { 
  LayoutDashboard, Calendar as CalendarIcon, Users, 
  DollarSign, FileText, Ban, Settings, ShieldAlert, 
  Search, CheckCircle2, XCircle, Trash2, Edit2, 
  Download, Plus, RefreshCw, Clock, ArrowRight, Lock,
  UserX, AlertTriangle, KeyRound, Copy, Eye, EyeOff, MessageCircle,
  UserCheck, ShieldCheck, Check, Palmtree, CalendarOff, Database, Upload, RotateCcw
} from 'lucide-react';
import { useToast } from './Toast';
import { checkPasswordStrength, getPasswordValidationMessage } from '../utils/passwordSecurity';
import {
  backupService,
  BackupCounts,
  BackupMode,
  BackupValidationResult,
  RestoreExecutionResult
} from '../services/backupService';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

type AdminTab = 
  | 'dashboard' 
  | 'calendar' 
  | 'professionals' 
  | 'rooms' 
  | 'financial' 
  | 'reports' 
  | 'blocks' 
  | 'settings' 
  | 'audit'
  | 'backup'
  | 'profile';

interface AdminPanelProps {
  currentUser?: User | null;
  onUpdateUser?: (user: User) => void;
  initialTab?: AdminTab;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ currentUser, onUpdateUser, initialTab }) => {
  const adminActor: User = useMemo(() => {
    return currentUser || {
      id: 'admin',
      name: 'Administrador',
      email: 'admin@admin.com.br',
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    };
  }, [currentUser]);
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab || 'dashboard');

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Admin Profile State
  const [adminName, setAdminName] = useState(currentUser?.name || 'Administrador');
  const [adminPhone, setAdminPhone] = useState(currentUser?.phone || '');
  const [adminWhatsapp, setAdminWhatsapp] = useState(currentUser?.whatsapp || '');
  const [adminCpf, setAdminCpf] = useState(currentUser?.cpf || '');
  const [adminNewPassword, setAdminNewPassword] = useState('');
  const [adminConfirmPassword, setAdminConfirmPassword] = useState('');
  const [isSavingAdminProfile, setIsSavingAdminProfile] = useState(false);

  useEffect(() => {
    if (currentUser) {
      setAdminName(currentUser.name);
      setAdminPhone(currentUser.phone || '');
      setAdminWhatsapp(currentUser.whatsapp || '');
      setAdminCpf(currentUser.cpf || '');
    }
  }, [currentUser]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [blocks, setBlocks] = useState<BlockedSlot[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [config, setConfig] = useState<SystemConfig>(getSystemConfig());
  const [isLoading, setIsLoading] = useState(false);

  // Financial Filter State
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [selectedProfId, setSelectedProfId] = useState<string>('ALL');
  const [selectedRoomFilter, setSelectedRoomFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ALL');

  // Payment Status Modal
  const [bookingToUpdatePayment, setBookingToUpdatePayment] = useState<Booking | null>(null);
  const [newPaymentStatus, setNewPaymentStatus] = useState<PaymentStatus>('PAID');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [isUpdatingPayment, setIsUpdatingPayment] = useState(false);

  // New Block Modal
  const [isBlockModalOpen, setIsBlockModalOpen] = useState(false);
  const [blockType, setBlockType] = useState<'FULL_DAY' | 'HOURS'>('FULL_DAY');
  const [blockRoom, setBlockRoom] = useState<RoomId | 'ALL'>('ALL');
  const [blockDate, setBlockDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [blockStartHour, setBlockStartHour] = useState<number>(7);
  const [blockEndHour, setBlockEndHour] = useState<number>(22);
  const [blockReason, setBlockReason] = useState<string>('');
  const [isCreatingBlock, setIsCreatingBlock] = useState(false);

  // Edit Room Modal
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editHourlyRate, setEditHourlyRate] = useState<number>(40);
  const [editDailyRate, setEditDailyRate] = useState<number>(460);
  const [editMorningRate, setEditMorningRate] = useState<number>(INITIAL_PERIOD_RATES.MORNING);
  const [editAfternoonRate, setEditAfternoonRate] = useState<number>(INITIAL_PERIOD_RATES.AFTERNOON);
  const [editNightRate, setEditNightRate] = useState<number>(INITIAL_PERIOD_RATES.NIGHT);
  const [isUpdatingRates, setIsUpdatingRates] = useState(false);

  // Delete Professional State (Exclusão no menu Configurações)
  const [selectedProfToDelete, setSelectedProfToDelete] = useState<string>('');
  const [userPendingDeletion, setUserPendingDeletion] = useState<User | null>(null);
  const [isDeletingUser, setIsDeletingUser] = useState(false);
  const [deleteConfirmCheckbox, setDeleteConfirmCheckbox] = useState(false);

  // Reset Professional Password State (Configurações)
  const [resetPasswordUserId, setResetPasswordUserId] = useState<string>('');
  const [newPasswordInput, setNewPasswordInput] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isResettingPassword, setIsResettingPassword] = useState<boolean>(false);
  const [lastResetResult, setLastResetResult] = useState<{ 
    userName: string; 
    userEmail: string; 
    userPhone?: string; 
    newPass: string 
  } | null>(null);

  // Backup e Segurança State
  const [generatingBackupMode, setGeneratingBackupMode] = useState<BackupMode | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [lastBackupResult, setLastBackupResult] = useState<{
    mode: BackupMode;
    backupType: 'COMPLETO' | 'ANONIMIZADO';
    fileName: string;
    generatedAt: string;
    totalRecords: number;
    counts: BackupCounts;
  } | null>(null);

  // Restauração Segura de Backup Completo State
  const [restoreValidation, setRestoreValidation] = useState<BackupValidationResult | null>(null);
  const [restoreConfirmChecked, setRestoreConfirmChecked] = useState<boolean>(false);
  const [restoreConfirmWord, setRestoreConfirmWord] = useState<string>('');
  const [autoSafetyBackupBeforeRestore, setAutoSafetyBackupBeforeRestore] = useState<boolean>(true);
  const [isRestoringBackup, setIsRestoringBackup] = useState<boolean>(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [lastRestoreResult, setLastRestoreResult] = useState<RestoreExecutionResult | null>(null);

  const { addToast } = useToast();

  const loadAdminData = async () => {
    setIsLoading(true);
    try {
      const [bookingsRes, profilesRes, roomsRes, blocksRes] = await Promise.allSettled([
        bookingService.getAllBookingsWithCancelled(),
        authService.getAllProfiles(),
        bookingService.getRooms(),
        bookingService.getBlockedSlots()
      ]);

      if (bookingsRes.status === 'fulfilled' && bookingsRes.value) {
        setBookings(bookingsRes.value);
      } else {
        if (bookingsRes.status === 'rejected') {
          console.warn('Aviso: falha ao carregar reservas do Supabase, usando local:', bookingsRes.reason);
        }
        setBookings(getStoredBookings());
      }

      if (profilesRes.status === 'fulfilled' && profilesRes.value) {
        setUsers(profilesRes.value);
      } else {
        if (profilesRes.status === 'rejected') {
          console.warn('Aviso: falha ao carregar perfis do Supabase, usando local:', profilesRes.reason);
        }
        setUsers(getStoredUsers());
      }

      if (roomsRes.status === 'fulfilled' && roomsRes.value) {
        setRooms(roomsRes.value);
      }

      if (blocksRes.status === 'fulfilled' && blocksRes.value) {
        setBlocks(blocksRes.value);
      } else {
        if (blocksRes.status === 'rejected') {
          console.warn('Aviso: falha ao carregar bloqueios do Supabase, usando local:', blocksRes.reason);
        }
        setBlocks(getStoredBlockedSlots());
      }

      setAuditLogs(getStoredAuditLogs());
      setConfig(getSystemConfig());
    } catch (err: any) {
      console.error('Erro inesperado ao carregar painel administrativo:', err);
      // Garante que mesmo em erro fatal os dados locais sejam montados
      setBookings(getStoredBookings());
      setUsers(getStoredUsers());
      setBlocks(getStoredBlockedSlots());
      setAuditLogs(getStoredAuditLogs());
      setConfig(getSystemConfig());
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  // Today & Tomorrow
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');

  const todayBookings = useMemo(() => {
    return bookings.filter(b => b.date === todayStr && b.paymentStatus !== 'CANCELLED');
  }, [bookings, todayStr]);

  const tomorrowBookings = useMemo(() => {
    return bookings.filter(b => b.date === tomorrowStr && b.paymentStatus !== 'CANCELLED');
  }, [bookings, tomorrowStr]);

  // Monthly Overview
  const currentMonthBookings = useMemo(() => {
    return bookings.filter(b => b.date.startsWith(selectedMonth) && b.paymentStatus !== 'CANCELLED');
  }, [bookings, selectedMonth]);

  const totalMonthlyRevenue = useMemo(() => {
    return currentMonthBookings.reduce((acc, b) => acc + b.totalAmount, 0);
  }, [currentMonthBookings]);

  const totalMonthlyPaid = useMemo(() => {
    return currentMonthBookings
      .filter(b => b.paymentStatus === 'PAID')
      .reduce((acc, b) => acc + b.totalAmount, 0);
  }, [currentMonthBookings]);

  const totalMonthlyPending = useMemo(() => {
    return currentMonthBookings
      .filter(b => b.paymentStatus === 'PENDING')
      .reduce((acc, b) => acc + b.totalAmount, 0);
  }, [currentMonthBookings]);

  const totalMonthlyHours = useMemo(() => {
    return currentMonthBookings.reduce((acc, b) => acc + (b.durationHours || 1), 0);
  }, [currentMonthBookings]);

  // Taxas de Ocupação do Mês (13 horas/dia * 30 dias = ~390h disponíveis)
  const room1Hours = useMemo(() => {
    return currentMonthBookings
      .filter(b => b.roomId === 'Sala 1')
      .reduce((acc, b) => acc + (b.durationHours || 1), 0);
  }, [currentMonthBookings]);

  const room2Hours = useMemo(() => {
    return currentMonthBookings
      .filter(b => b.roomId === 'Sala 2')
      .reduce((acc, b) => acc + (b.durationHours || 1), 0);
  }, [currentMonthBookings]);

  const room1Occupancy = Math.min(100, Math.round((room1Hours / 300) * 100)); // 20 dias úteis * 15h = 300h base
  const room2Occupancy = Math.min(100, Math.round((room2Hours / 300) * 100));

  // Financial Table Filtered
  const filteredFinancialBookings = useMemo(() => {
    return bookings.filter(b => {
      if (selectedMonth && !b.date.startsWith(selectedMonth)) return false;
      if (selectedProfId !== 'ALL' && b.userId !== selectedProfId) return false;
      if (selectedRoomFilter !== 'ALL' && b.roomId !== selectedRoomFilter) return false;
      if (selectedStatusFilter !== 'ALL' && b.paymentStatus !== selectedStatusFilter) return false;
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [bookings, selectedMonth, selectedProfId, selectedRoomFilter, selectedStatusFilter]);

  // Consolidated Financial Summary (Cobrança consolidada do mês - agendamentos cancelados desconsiderados)
  const financialSummary = useMemo(() => {
    const active = filteredFinancialBookings.filter(b => b.paymentStatus !== 'CANCELLED');
    const cancelled = filteredFinancialBookings.filter(b => b.paymentStatus === 'CANCELLED');

    const totalToBill = active.reduce((acc, b) => acc + b.totalAmount, 0);
    const totalPaid = active.filter(b => b.paymentStatus === 'PAID').reduce((acc, b) => acc + b.totalAmount, 0);
    const totalPending = active.filter(b => b.paymentStatus === 'PENDING').reduce((acc, b) => acc + b.totalAmount, 0);
    const totalActiveHours = active.reduce((acc, b) => acc + (b.durationHours || 1), 0);
    const totalCancelledDisregarded = cancelled.reduce((acc, b) => acc + b.totalAmount, 0);

    return {
      activeCount: active.length,
      cancelledCount: cancelled.length,
      totalActiveHours,
      totalToBill,
      totalPaid,
      totalPending,
      totalCancelledDisregarded
    };
  }, [filteredFinancialBookings]);

  // Selected Professional Summary
  const selectedProfStats = useMemo(() => {
    if (selectedProfId === 'ALL') return null;
    const profBookings = filteredFinancialBookings.filter(b => b.paymentStatus !== 'CANCELLED');
    const cancelledBookings = filteredFinancialBookings.filter(b => b.paymentStatus === 'CANCELLED');
    const totalDue = profBookings.reduce((sum, b) => sum + b.totalAmount, 0);
    const totalPaid = profBookings.filter(b => b.paymentStatus === 'PAID').reduce((sum, b) => sum + b.totalAmount, 0);
    const totalHours = profBookings.reduce((sum, b) => sum + (b.durationHours || 1), 0);
    const cancelledAmount = cancelledBookings.reduce((sum, b) => sum + b.totalAmount, 0);
    const profObj = users.find(u => u.id === selectedProfId);

    return {
      name: profObj?.name || 'Profissional',
      count: profBookings.length,
      cancelledCount: cancelledBookings.length,
      cancelledAmount,
      hours: totalHours,
      totalDue,
      totalPaid,
      balance: totalDue - totalPaid
    };
  }, [selectedProfId, filteredFinancialBookings, users]);

  // Actions
  const handleOpenPaymentModal = (booking: Booking) => {
    setBookingToUpdatePayment(booking);
    setNewPaymentStatus(booking.paymentStatus === 'PAID' ? 'PENDING' : 'PAID');
    setPaymentNotes('');
  };

  const handleSavePaymentStatus = async () => {
    if (!bookingToUpdatePayment) return;
    setIsUpdatingPayment(true);
    try {
      await bookingService.updatePaymentStatus({
        bookingId: bookingToUpdatePayment.id,
        newStatus: newPaymentStatus,
        adminUser: { id: 'usr-admin', name: 'Administração Geral' },
        paidNotes: paymentNotes
      });
      addToast(`Status da locação atualizado para ${newPaymentStatus === 'PAID' ? 'Pago' : 'Pendente'}.`, 'success');
      setBookingToUpdatePayment(null);
      await loadAdminData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao alterar pagamento.', 'error');
    } finally {
      setIsUpdatingPayment(false);
    }
  };

  const handleOpenNewBlockModal = (type: 'FULL_DAY' | 'HOURS' = 'FULL_DAY', initialReason = '') => {
    setBlockType(type);
    setBlockRoom('ALL');
    setBlockDate(format(new Date(), 'yyyy-MM-dd'));
    setBlockReason(initialReason);
    const dayOfWeek = new Date().getDay();
    const maxHour = getClosingHourForDate(dayOfWeek) || 22;
    setBlockStartHour(7);
    setBlockEndHour(maxHour);
    setIsBlockModalOpen(true);
  };

  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockReason.trim()) return addToast('Informe o motivo do bloqueio (ex: Feriado Nacional, Manutenção).', 'error');

    if (!blockDate) return addToast('Selecione a data do bloqueio.', 'error');

    const [y, m, d] = blockDate.split('-').map(Number);
    const dayOfWeek = new Date(y, m - 1, d).getDay();
    if (dayOfWeek === 0) {
      return addToast('A clínica já não funciona aos domingos (fechamento padrão).', 'warning');
    }

    const maxHour = getClosingHourForDate(dayOfWeek) || 22;
    const minHour = 7;

    let finalStartHour = blockStartHour;
    let finalEndHour = blockEndHour;

    if (blockType === 'FULL_DAY') {
      finalStartHour = minHour;
      finalEndHour = maxHour;
    } else {
      if (blockStartHour >= blockEndHour) {
        return addToast('O horário final deve ser maior que o inicial.', 'error');
      }
      if (blockEndHour > maxHour || blockStartHour >= maxHour) {
        return addToast(
          dayOfWeek === 6 
            ? 'Aos sábados o expediente encerra às 14:00.' 
            : `O expediente neste dia encerra às ${maxHour}:00.`, 
          'warning'
        );
      }
    }

    setIsCreatingBlock(true);
    try {
      await bookingService.createBlockedSlot({
        roomId: blockRoom,
        date: blockDate,
        startHour: finalStartHour,
        endHour: finalEndHour,
        reason: blockReason.trim(),
        createdBy: adminActor.name || 'Administração'
      }, adminActor);

      addToast(
        blockType === 'FULL_DAY'
          ? `Dia ${format(parseISO(blockDate), 'dd/MM/yyyy')} bloqueado com sucesso (feriado/dia inteiro)!`
          : 'Bloqueio de horário cadastrado com sucesso!', 
        'success'
      );
      setIsBlockModalOpen(false);
      setBlockReason('');
      await loadAdminData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao criar bloqueio.', 'error');
    } finally {
      setIsCreatingBlock(false);
    }
  };

  const handleDeleteBlock = async (blockId: string) => {
    try {
      await bookingService.deleteBlockedSlot(blockId, adminActor);
      addToast('Bloqueio removido com sucesso.', 'success');
      await loadAdminData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao excluir bloqueio.', 'error');
    }
  };

  const handleOpenRoomModal = (room: Room) => {
    setEditingRoom(room);
    setEditHourlyRate(room.hourlyRate);
    const mRate = Number(room.morningRate ?? INITIAL_PERIOD_RATES.MORNING);
    const aRate = Number(room.afternoonRate ?? INITIAL_PERIOD_RATES.AFTERNOON);
    const nRate = Number(room.nightRate ?? INITIAL_PERIOD_RATES.NIGHT);
    setEditMorningRate(mRate);
    setEditAfternoonRate(aRate);
    setEditNightRate(nRate);
    setEditDailyRate(room.dailyRate || room.fullDayRate || (mRate + aRate + nRate));
  };

  const handleSaveRoomRates = async () => {
    if (!editingRoom) return;
    if (editHourlyRate <= 0) return addToast('O valor da hora deve ser maior que zero.', 'error');
    if (editMorningRate <= 0 || editAfternoonRate <= 0 || editNightRate <= 0) {
      return addToast('Os valores dos turnos (manhã, tarde e noite) devem ser maiores que zero.', 'error');
    }
    if (editDailyRate <= 0) {
      return addToast('O valor do período de 1 dia deve ser maior que zero.', 'error');
    }
    setIsUpdatingRates(true);
    try {
      await bookingService.updateRoomRates(
        editingRoom.id,
        editHourlyRate,
        editDailyRate,
        adminActor,
        editMorningRate,
        editAfternoonRate,
        editNightRate
      );
      addToast(`Tarifas da ${editingRoom.id} (turnos e 1 dia) atualizadas com sucesso!`, 'success');
      setEditingRoom(null);
      await loadAdminData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao atualizar tarifas.', 'error');
    } finally {
      setIsUpdatingRates(false);
    }
  };

  const handleSaveAdminProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminName.trim()) {
      return addToast('O nome completo não pode estar em branco.', 'error');
    }

    if (adminNewPassword) {
      const pwdError = getPasswordValidationMessage(adminNewPassword);
      if (pwdError) return addToast(pwdError, 'error');
      if (adminNewPassword !== adminConfirmPassword) {
        return addToast('A confirmação de senha não confere.', 'error');
      }
    }

    setIsSavingAdminProfile(true);
    try {
      const updatedUser = await authService.updateProfile(adminActor.id, {
        name: adminName.trim(),
        phone: adminPhone.trim(),
        whatsapp: adminWhatsapp.trim(),
        cpf: adminCpf.trim()
      });

      if (adminNewPassword) {
        await authService.updatePassword(adminNewPassword, adminActor.id);
        setAdminNewPassword('');
        setAdminConfirmPassword('');
        addToast('Senha de acesso atualizada com sucesso!', 'success');
      }

      onUpdateUser?.(updatedUser);
      addToast('Perfil do administrador atualizado com sucesso!', 'success');
    } catch (err: any) {
      addToast(err.message || 'Erro ao salvar alterações no perfil do administrador.', 'error');
    } finally {
      setIsSavingAdminProfile(false);
    }
  };

  const handleToggleUserStatus = async (user: User) => {
    try {
      await authService.toggleUserStatus(user.id, adminActor);
      addToast(`Status do profissional ${user.name} alterado.`, 'success');
      await loadAdminData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao alterar status.', 'error');
    }
  };

  // Exclusão de Profissional do Aplicativo (Configurações)
  const handleInitiateDeleteUser = (user: User) => {
    setUserPendingDeletion(user);
    setDeleteConfirmCheckbox(false);
  };

  const handleConfirmDeleteUser = async () => {
    if (!userPendingDeletion) return;
    setIsDeletingUser(true);
    try {
      await authService.deleteUser(userPendingDeletion.id, adminActor);
      addToast(`Profissional ${userPendingDeletion.name} foi excluído(a) com sucesso do aplicativo!`, 'success');
      setUserPendingDeletion(null);
      setSelectedProfToDelete('');
      await loadAdminData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao excluir profissional.', 'error');
    } finally {
      setIsDeletingUser(false);
    }
  };

  // Redefinição de Senha Administrativa (Configurações)
  const handleGenerateRandomPassword = () => {
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    const pass = `Loca@${randomDigits}`;
    setNewPasswordInput(pass);
    addToast(`Senha sugerida: ${pass}`, 'info');
  };

  const handleAdminResetPassword = async () => {
    if (!resetPasswordUserId) {
      return addToast('Selecione um profissional para redefinir a senha.', 'error');
    }
    if (!newPasswordInput || newPasswordInput.trim().length < 6) {
      return addToast('A nova senha deve ter no mínimo 6 caracteres.', 'error');
    }

    const targetUser = users.find(u => u.id === resetPasswordUserId);
    if (!targetUser) {
      return addToast('Profissional não encontrado.', 'error');
    }

    setIsResettingPassword(true);
    try {
      const trimmedPass = newPasswordInput.trim();
      await authService.adminResetUserPassword(
        targetUser.id,
        trimmedPass,
        adminActor
      );

      setLastResetResult({
        userName: targetUser.name,
        userEmail: targetUser.email,
        userPhone: targetUser.whatsapp || targetUser.phone,
        newPass: trimmedPass
      });

      addToast(`Senha de ${targetUser.name} redefinida com sucesso!`, 'success');
      setNewPasswordInput('');
      await loadAdminData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao redefinir senha do profissional.', 'error');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleCopyResetCredentials = () => {
    if (!lastResetResult) return;
    const textToCopy = `*Acesso LocaPsico — Nova Senha*\nProfissional: ${lastResetResult.userName}\nE-mail: ${lastResetResult.userEmail}\nNova Senha: ${lastResetResult.newPass}\n\nFaça login e redefina caso deseje.`;
    navigator.clipboard.writeText(textToCopy);
    addToast('Credenciais copiadas para a área de transferência!', 'success');
  };

  // Gerar e Baixar Backup do Sistema (Somente Leitura: Completo ou Anonimizado)
  const handleRunBackupNow = async (mode: BackupMode = 'full') => {
    if (generatingBackupMode !== null) return;
    setGeneratingBackupMode(mode);
    setBackupError(null);

    try {
      const backupPayload = await backupService.fetchSystemBackup(adminActor, mode);
      const fileName = backupService.downloadBackupFile(backupPayload, mode);
      const label = mode === 'anonymized' ? 'ANONIMIZADO' : 'COMPLETO';

      setLastBackupResult({
        mode,
        backupType: label,
        fileName,
        generatedAt: backupPayload.metadata.generatedAt,
        totalRecords: backupPayload.metadata.totalRecords,
        counts: backupPayload.metadata.counts
      });

      addToast(`Backup ${label} concluído! Arquivo ${fileName} baixado.`, 'success');
    } catch (err: any) {
      const msg = err?.message || 'Não foi possível gerar o backup no momento.';
      setBackupError(msg);
      addToast(msg, 'error');
    } finally {
      setGeneratingBackupMode(null);
    }
  };

  // Selecionar e validar arquivo JSON para Restauração Segura (somente Backup Completo)
  const handleSelectRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setRestoreError(null);
    setLastRestoreResult(null);
    setRestoreConfirmChecked(false);
    setRestoreConfirmWord('');

    if (!file.name.toLowerCase().endsWith('.json')) {
      const msg = 'Formato inválido. Selecione um arquivo com extensão .json gerado pelo LocaPsico.';
      setRestoreValidation({
        valid: false,
        fileName: file.name,
        error: msg
      });
      addToast(msg, 'error');
      return;
    }

    try {
      const rawText = await file.text();
      const validation = backupService.validateBackupFileContent(rawText, file.name);
      setRestoreValidation(validation);

      if (!validation.valid) {
        addToast(validation.error || 'Arquivo de backup rejeitado na validação.', 'error');
      } else {
        addToast('Arquivo de Backup Completo validado! Revise o resumo antes de restaurar.', 'success');
      }
    } catch (err: any) {
      const msg = err?.message || 'Erro ao ler o arquivo selecionado.';
      setRestoreValidation({
        valid: false,
        fileName: file.name,
        error: msg
      });
      addToast(msg, 'error');
    }
  };

  const handleClearRestoreSelection = () => {
    setRestoreValidation(null);
    setRestoreConfirmChecked(false);
    setRestoreConfirmWord('');
    setRestoreError(null);
  };

  const handleExecuteSafeRestore = async () => {
    if (!restoreValidation?.valid || !restoreValidation.payload) {
      addToast('Selecione um arquivo de Backup Completo válido antes de continuar.', 'error');
      return;
    }

    if (!restoreConfirmChecked) {
      addToast('Marque a caixa de confirmação de segurança para prosseguir.', 'error');
      return;
    }

    if (restoreConfirmWord.trim().toUpperCase() !== 'RESTAURAR') {
      addToast('Digite exatamente a palavra RESTAURAR no campo de confirmação.', 'error');
      return;
    }

    setIsRestoringBackup(true);
    setRestoreError(null);

    try {
      const result = await backupService.restoreSystemBackup(
        adminActor,
        restoreValidation.payload,
        restoreConfirmWord,
        autoSafetyBackupBeforeRestore
      );

      setLastRestoreResult(result);
      setRestoreValidation(null);
      setRestoreConfirmChecked(false);
      setRestoreConfirmWord('');

      addToast('Restauração do Backup Completo concluída com sucesso!', 'success');
      await loadAdminData();
    } catch (err: any) {
      const msg = err?.message || 'Falha ao executar a restauração do backup.';
      setRestoreError(msg);
      addToast(msg, 'error');
    } finally {
      setIsRestoringBackup(false);
    }
  };

  // Exportar Relatório em PDF
  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('LocaPsico — Relatório Administrativo Mensal', 14, 20);
    doc.setFontSize(11);
    doc.text(`Mês de Referência: ${selectedMonth}`, 14, 28);
    doc.text(`Cobrança do Mês: R$ ${financialSummary.totalToBill.toFixed(2)} | Recebido: R$ ${financialSummary.totalPaid.toFixed(2)} | Pendente: R$ ${financialSummary.totalPending.toFixed(2)}`, 14, 34);

    if (financialSummary.cancelledCount > 0) {
      doc.setFontSize(9);
      doc.setTextColor(180, 50, 50);
      doc.text(`* ${financialSummary.cancelledCount} agendamento(s) cancelado(s) desconsiderado(s) da cobrança (R$ 0,00 cobrado).`, 14, 40);
      doc.setTextColor(0, 0, 0);
    }

    const rows = filteredFinancialBookings.map(b => {
      const isCancelled = b.paymentStatus === 'CANCELLED';
      return [
        format(parseISO(b.date), 'dd/MM/yyyy'),
        b.roomId,
        b.userName || 'N/A',
        b.clientName || 'N/A',
        `${b.hour.toString().padStart(2, '0')}:00 - ${b.endTimeHour.toString().padStart(2, '0')}:00`,
        isCancelled ? `0h (${b.durationHours}h canc.)` : `${b.durationHours}h`,
        isCancelled ? 'R$ 0,00 (Isento)' : `R$ ${b.totalAmount.toFixed(2)}`,
        b.paymentStatus === 'PAID' ? 'Pago' : isCancelled ? 'Cancelado (Sem Cobrança)' : 'Pendente'
      ];
    });

    autoTable(doc, {
      startY: financialSummary.cancelledCount > 0 ? 44 : 40,
      head: [['Data', 'Sala', 'Profissional', 'Paciente', 'Horário', 'Horas', 'Valor', 'Status']],
      body: rows,
      theme: 'grid',
      headStyles: { fillColor: [15, 157, 129] }
    });

    doc.save(`LocaPsico-Relatorio-${selectedMonth}.pdf`);
    addToast('Relatório PDF exportado com sucesso!', 'success');
  };

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Sub-Menu Superior da Administração (Seção 45) */}
      <div className="bg-white rounded-3xl p-2.5 border border-gray-100 shadow-sm flex flex-wrap gap-1.5">
        {[
          { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
          { id: 'calendar', label: 'Agenda Geral', icon: CalendarIcon },
          { id: 'professionals', label: 'Profissionais', icon: Users },
          { id: 'rooms', label: 'Salas & Tarifas', icon: Settings },
          { id: 'financial', label: 'Financeiro', icon: DollarSign },
          { id: 'reports', label: 'Relatórios', icon: FileText },
          { id: 'blocks', label: 'Bloqueios', icon: Ban },
          { id: 'settings', label: 'Configurações', icon: Settings },
          { id: 'audit', label: 'Auditoria', icon: ShieldAlert },
          { id: 'backup', label: 'Backup e Segurança', icon: ShieldCheck },
          { id: 'profile', label: 'Meu Perfil', icon: UserCheck }
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as AdminTab)}
              className={`flex items-center gap-1.5 py-2.5 px-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
                isActive
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Icon size={14} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ================= 1. DASHBOARD ADMINISTRATIVO (Seção 13) ================= */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Métricas Principais */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                Receita do Mês
              </span>
              <span className="text-3xl font-black text-teal-600 block">
                R$ {totalMonthlyRevenue.toFixed(0)}
              </span>
              <span className="text-[10px] font-bold text-gray-400 mt-1 block">
                Pago: R$ {totalMonthlyPaid.toFixed(0)}
              </span>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                Valores Pendentes
              </span>
              <span className="text-3xl font-black text-amber-600 block">
                R$ {totalMonthlyPending.toFixed(0)}
              </span>
              <span className="text-[10px] font-bold text-amber-600/80 mt-1 block">
                A receber
              </span>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                Profissionais Ativos
              </span>
              <span className="text-3xl font-black text-gray-900 block">
                {users.filter(u => u.role === 'USER' && u.status !== 'INACTIVE').length}
              </span>
              <span className="text-[10px] font-bold text-teal-600 mt-1 block">
                Cadastrados
              </span>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                Horas Alugadas (Mês)
              </span>
              <span className="text-3xl font-black text-gray-900 block">
                {totalMonthlyHours}h
              </span>
              <span className="text-[10px] font-bold text-teal-600 mt-1 block">
                {currentMonthBookings.length} locações
              </span>
            </div>
          </div>

          {/* Ocupação das Salas (Seção 13) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="font-black text-gray-900 text-sm">Ocupação Sala 1</h4>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Psicoterapia</p>
                </div>
                <span className="text-2xl font-black text-teal-600">{room1Occupancy}%</span>
              </div>
              <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden">
                <div
                  className="bg-teal-500 h-full rounded-full transition-all"
                  style={{ width: `${room1Occupancy}%` }}
                ></div>
              </div>
              <span className="text-[11px] text-gray-500 block">
                {room1Hours} horas reservadas este mês.
              </span>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-3">
              <div className="flex justify-between items-center">
                <div>
                  <h4 className="font-black text-gray-900 text-sm">Ocupação Sala 2</h4>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Multidisciplinar</p>
                </div>
                <span className="text-2xl font-black text-teal-600">{room2Occupancy}%</span>
              </div>
              <div className="w-full bg-gray-100 h-3 rounded-full overflow-hidden">
                <div
                  className="bg-teal-500 h-full rounded-full transition-all"
                  style={{ width: `${room2Occupancy}%` }}
                ></div>
              </div>
              <span className="text-[11px] text-gray-500 block">
                {room2Hours} horas reservadas este mês.
              </span>
            </div>
          </div>

          {/* Reservas de Hoje e do Dia Seguinte (Seção 13) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Hoje */}
            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-black text-gray-900 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  Reservas de Hoje ({todayBookings.length})
                </h4>
                <span className="text-[10px] text-gray-400 font-bold uppercase">
                  {format(new Date(), 'dd/MM/yyyy')}
                </span>
              </div>

              {todayBookings.length === 0 ? (
                <p className="text-xs text-gray-400 italic py-4 text-center">
                  Nenhuma reserva para hoje.
                </p>
              ) : (
                <div className="space-y-2">
                  {todayBookings.map(b => (
                    <div key={b.id} className="p-3 bg-gray-50 rounded-2xl flex justify-between items-center text-xs">
                      <div>
                        <span className="font-black text-gray-900">{b.roomId}</span> —{' '}
                        <span className="font-bold text-teal-700">{b.hour}:00</span> ({b.durationHours}h)
                        <p className="text-[11px] text-gray-500">
                          Profissional: {b.userName} {b.clientName ? `| Paciente: ${b.clientName}` : ''}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                        b.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {b.paymentStatus === 'PAID' ? 'Pago' : 'Pendente'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Amanhã */}
            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm space-y-4">
              <div className="flex justify-between items-center">
                <h4 className="text-sm font-black text-gray-900 flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-teal-500"></span>
                  Reservas de Amanhã ({tomorrowBookings.length})
                </h4>
                <span className="text-[10px] text-gray-400 font-bold uppercase">
                  {format(addDays(new Date(), 1), 'dd/MM/yyyy')}
                </span>
              </div>

              {tomorrowBookings.length === 0 ? (
                <p className="text-xs text-gray-400 italic py-4 text-center">
                  Nenhuma reserva para o dia seguinte.
                </p>
              ) : (
                <div className="space-y-2">
                  {tomorrowBookings.map(b => (
                    <div key={b.id} className="p-3 bg-gray-50 rounded-2xl flex justify-between items-center text-xs">
                      <div>
                        <span className="font-black text-gray-900">{b.roomId}</span> —{' '}
                        <span className="font-bold text-teal-700">{b.hour}:00</span> ({b.durationHours}h)
                        <p className="text-[11px] text-gray-500">
                          Profissional: {b.userName} {b.clientName ? `| Paciente: ${b.clientName}` : ''}
                        </p>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                        b.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {b.paymentStatus === 'PAID' ? 'Pago' : 'Pendente'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= 2. AGENDA GERAL (Seção 32) ================= */}
      {activeTab === 'calendar' && (
        <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-black text-gray-900">Agenda Geral Consolidada</h3>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                Visão detalhada de todas as salas, profissionais e horários reservados
              </p>
            </div>
            <Button onClick={() => setActiveTab('blocks')} className="flex items-center gap-1 text-xs">
              <Ban size={14} /> Bloquear Horário
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Data</th>
                  <th className="py-3 px-4">Sala</th>
                  <th className="py-3 px-4">Horário</th>
                  <th className="py-3 px-4">Profissional</th>
                  <th className="py-3 px-4">Paciente</th>
                  <th className="py-3 px-4 text-right">Valor</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {bookings.filter(b => b.paymentStatus !== 'CANCELLED').map(b => (
                  <tr key={b.id} className="hover:bg-gray-50/50">
                    <td className="py-3 px-4 font-bold text-gray-900">
                      {format(parseISO(b.date), 'dd/MM/yyyy')}
                    </td>
                    <td className="py-3 px-4 font-black text-teal-700">{b.roomId}</td>
                    <td className="py-3 px-4 font-bold">
                      {b.type === 'PERIOD'
                        ? `${b.hour.toString().padStart(2, '0')}:00 - ${b.endTimeHour.toString().padStart(2, '0')}:00 (${b.periodName || 'Turno'})`
                        : `${b.hour.toString().padStart(2, '0')}:00 - ${b.endTimeHour.toString().padStart(2, '0')}:00`
                      }
                    </td>
                    <td className="py-3 px-4 font-black text-gray-800">{b.userName}</td>
                    <td className="py-3 px-4 text-gray-600">{b.clientName || '—'}</td>
                    <td className="py-3 px-4 text-right font-black">R$ {b.totalAmount.toFixed(2)}</td>
                    <td className="py-3 px-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                        b.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {b.paymentStatus === 'PAID' ? 'Pago' : 'Pendente'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleOpenPaymentModal(b)}
                        className="text-teal-600 hover:text-teal-800 font-bold uppercase text-[10px]"
                      >
                        Alterar Status
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ================= 3. PROFISSIONAIS ================= */}
      {activeTab === 'professionals' && (
        <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-4">
          <h3 className="text-xl font-black text-gray-900">Profissionais Cadastrados</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
            {users.filter(u => u.role === 'USER').map(prof => {
              const profBookings = bookings.filter(b => b.userId === prof.id && b.paymentStatus !== 'CANCELLED');
              const totalSpent = profBookings.reduce((sum, b) => sum + b.totalAmount, 0);
              const totalHours = profBookings.reduce((sum, b) => sum + (b.durationHours || 1), 0);
              const isActive = prof.status !== 'INACTIVE';

              return (
                <div key={prof.id} className="p-6 rounded-3xl border border-gray-100 bg-gray-50/50 flex flex-col justify-between space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between items-start">
                      <h4 className="font-black text-base text-gray-900">{prof.name}</h4>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                        isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {isActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <p className="text-xs text-teal-700 font-bold">
                      {prof.profession} {prof.councilRegistration ? `(${prof.councilRegistration})` : ''}
                    </p>
                    <p className="text-xs text-gray-500">{prof.email}</p>
                    {prof.phone && <p className="text-xs text-gray-500">Tel: {prof.phone}</p>}
                  </div>

                  <div className="pt-3 border-t border-gray-200/60 flex justify-between items-center text-xs">
                    <div>
                      <span className="text-gray-400 block text-[10px] font-bold uppercase">Total Consumido</span>
                      <span className="font-black text-gray-900">{totalHours}h (R$ {totalSpent.toFixed(0)})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setResetPasswordUserId(prof.id);
                          setActiveTab('settings');
                          setLastResetResult(null);
                        }}
                        className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-all"
                        title="Redefinir senha deste profissional"
                      >
                        <KeyRound size={15} />
                      </button>
                      <Button
                        variant="secondary"
                        onClick={() => handleToggleUserStatus(prof)}
                        className="text-[10px] px-3 py-1.5"
                      >
                        {isActive ? 'Desativar' : 'Ativar'}
                      </Button>
                      <button
                        onClick={() => handleInitiateDeleteUser(prof)}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                        title="Excluir profissional do aplicativo"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ================= 4. SALAS & TARIFAS (Seção 6, 29, 48) ================= */}
      {activeTab === 'rooms' && (
        <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-6">
          <div>
            <h3 className="text-xl font-black text-gray-900">Configuração das Salas & Valores</h3>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
              Alterações futuras de preço não modificam retroativamente reservas já existentes (Regra #48)
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {rooms.map(room => (
              <div key={room.id} className="p-6 rounded-3xl border border-gray-100 bg-gray-50/50 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-black text-lg text-gray-900">{room.name}</h4>
                    <p className="text-xs text-gray-500 mt-1">{room.description}</p>
                  </div>
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-black uppercase px-2.5 py-1 rounded-lg">
                    {room.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2">
                  <div className="bg-white p-3 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Hora Avulsa</span>
                    <span className="text-sm font-black text-teal-600">R$ {room.hourlyRate.toFixed(2)}</span>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Manhã (5h)</span>
                    <span className="text-sm font-black text-teal-600">R$ {(room.morningRate ?? INITIAL_PERIOD_RATES.MORNING).toFixed(2)}</span>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Tarde (6h)</span>
                    <span className="text-sm font-black text-teal-600">R$ {(room.afternoonRate ?? INITIAL_PERIOD_RATES.AFTERNOON).toFixed(2)}</span>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Noite (4h)</span>
                    <span className="text-sm font-black text-teal-600">R$ {(room.nightRate ?? INITIAL_PERIOD_RATES.NIGHT).toFixed(2)}</span>
                  </div>
                  <div className="bg-white p-3 rounded-2xl border border-teal-200 bg-teal-50/50 col-span-2 sm:col-span-1">
                    <span className="text-[10px] font-black uppercase text-teal-800 block">1 Dia (15h)</span>
                    <span className="text-sm font-black text-teal-800">R$ {(room.dailyRate ?? room.fullDayRate ?? INITIAL_PERIOD_RATES.FULL_DAY).toFixed(2)}</span>
                  </div>
                </div>

                <Button
                  onClick={() => handleOpenRoomModal(room)}
                  className="w-full flex items-center justify-center gap-2 text-xs"
                >
                  <Edit2 size={14} /> Editar Tarifas por Períodos & 1 Dia
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= 5. CONTROLE FINANCEIRO & PAGAMENTOS (Seção 14, 15) ================= */}
      {activeTab === 'financial' && (
        <div className="space-y-6">
          {/* Barra de Filtros */}
          <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h3 className="text-xl font-black text-gray-900">Controle Financeiro de Locações</h3>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                  Acompanhamento de débitos, pagamentos e alteração de status
                </p>
              </div>
              <Button onClick={handleExportPDF} className="flex items-center gap-1.5 text-xs">
                <Download size={15} /> Exportar Relatório PDF
              </Button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">
                  Profissional
                </label>
                <select
                  value={selectedProfId}
                  onChange={e => setSelectedProfId(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                >
                  <option value="ALL">Todos os Profissionais</option>
                  {users.filter(u => u.role === 'USER').map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">
                  Mês de Referência
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={e => setSelectedMonth(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">
                  Sala
                </label>
                <select
                  value={selectedRoomFilter}
                  onChange={e => setSelectedRoomFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                >
                  <option value="ALL">Todas as Salas</option>
                  <option value="Sala 1">Sala 1</option>
                  <option value="Sala 2">Sala 2</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">
                  Status
                </label>
                <select
                  value={selectedStatusFilter}
                  onChange={e => setSelectedStatusFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                >
                  <option value="ALL">Todos os Status</option>
                  <option value="PAID">Pago</option>
                  <option value="PENDING">Pendente</option>
                  <option value="CANCELLED">Cancelado</option>
                </select>
              </div>
            </div>

            {/* Painel de Cobrança Geral do Mês (Desconsiderando Cancelados) */}
            {selectedProfId === 'ALL' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
                <div className="p-4 bg-teal-50 border border-teal-100 rounded-2xl">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-teal-700">
                      Cobrança Total do Mês
                    </span>
                    <span className="text-[9px] bg-teal-200/70 text-teal-900 px-1.5 py-0.5 rounded font-bold">
                      {financialSummary.activeCount} locações
                    </span>
                  </div>
                  <span className="text-xl font-black text-gray-900 block">
                    R$ {financialSummary.totalToBill.toFixed(2)}
                  </span>
                  <p className="text-[10px] text-teal-700 font-semibold mt-1">
                    Exclui agendamentos cancelados ({financialSummary.totalActiveHours}h ativas)
                  </p>
                </div>

                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl">
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 block mb-1">
                    Total Recebido (Pago)
                  </span>
                  <span className="text-xl font-black text-emerald-800 block">
                    R$ {financialSummary.totalPaid.toFixed(2)}
                  </span>
                  <p className="text-[10px] text-emerald-600 font-semibold mt-1">
                    Valores quitados no período
                  </p>
                </div>

                <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                  <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 block mb-1">
                    Saldo Pendente
                  </span>
                  <span className="text-xl font-black text-amber-800 block">
                    R$ {financialSummary.totalPending.toFixed(2)}
                  </span>
                  <p className="text-[10px] text-amber-600 font-semibold mt-1">
                    Aguardando baixa de pagamento
                  </p>
                </div>

                <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-black uppercase tracking-wider text-gray-500">
                      Cancelados (Desconsiderados)
                    </span>
                    <span className="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">
                      {financialSummary.cancelledCount} canceladas
                    </span>
                  </div>
                  <span className="text-xl font-black text-gray-500 block line-through">
                    R$ {financialSummary.totalCancelledDisregarded.toFixed(2)}
                  </span>
                  <p className="text-[10px] text-emerald-700 font-bold mt-1">
                    ✓ R$ 0,00 cobrado (Isentos da fatura)
                  </p>
                </div>
              </div>
            )}

            {/* Painel do Profissional Selecionado (Seção 14) */}
            {selectedProfStats && (
              <div className="p-5 bg-teal-50 border border-teal-100 rounded-2xl space-y-3 text-xs">
                <div className="flex flex-wrap justify-between items-center gap-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider text-teal-600 block">
                      Profissional Selecionado
                    </span>
                    <span className="text-base font-black text-gray-900">{selectedProfStats.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <div>
                      <span className="text-gray-400 block text-[10px] font-bold uppercase">Locações Faturáveis</span>
                      <span className="font-black text-gray-900">{selectedProfStats.count} ({selectedProfStats.hours}h)</span>
                    </div>
                    <div>
                      <span className="text-teal-700 block text-[10px] font-bold uppercase">Total a Cobrar</span>
                      <span className="font-black text-teal-900 text-sm">R$ {selectedProfStats.totalDue.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-emerald-600 block text-[10px] font-bold uppercase">Total Pago</span>
                      <span className="font-black text-emerald-700 text-sm">R$ {selectedProfStats.totalPaid.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-amber-600 block text-[10px] font-bold uppercase">Saldo Devedor</span>
                      <span className="font-black text-amber-700 text-sm">R$ {selectedProfStats.balance.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {selectedProfStats.cancelledCount > 0 && (
                  <div className="pt-2 border-t border-teal-100/60 flex items-center justify-between text-[11px] text-gray-600">
                    <span>
                      <strong>{selectedProfStats.cancelledCount} agendamento(s) cancelado(s)</strong> no mês de referência.
                    </span>
                    <span className="text-emerald-700 font-bold">
                      R$ {selectedProfStats.cancelledAmount.toFixed(2)} desconsiderados da fatura (R$ 0,00 cobrado)
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tabela de Locações Financeiras */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-4 px-6">Data</th>
                    <th className="py-4 px-6">Sala</th>
                    <th className="py-4 px-6">Profissional</th>
                    <th className="py-4 px-6">Horário</th>
                    <th className="py-4 px-6">Horas</th>
                    <th className="py-4 px-6 text-right">Valor</th>
                    <th className="py-4 px-6 text-center">Status</th>
                    <th className="py-4 px-6 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredFinancialBookings.map(b => {
                    const isCancelled = b.paymentStatus === 'CANCELLED';
                    return (
                      <tr key={b.id} className={isCancelled ? "bg-red-50/30 hover:bg-red-50/50" : "hover:bg-gray-50/50"}>
                        <td className="py-4 px-6 font-black text-gray-900">
                          {format(parseISO(b.date), 'dd/MM/yyyy')}
                        </td>
                        <td className="py-4 px-6 font-bold text-teal-700">{b.roomId}</td>
                        <td className="py-4 px-6 font-black text-gray-800">{b.userName}</td>
                        <td className="py-4 px-6 font-bold text-gray-600">
                          {`${b.hour.toString().padStart(2, '0')}:00 - ${b.endTimeHour.toString().padStart(2, '0')}:00`}
                        </td>
                        <td className="py-4 px-6 text-gray-500">
                          {b.durationHours}h {b.type === 'PERIOD' ? `(${b.periodName ? `Período ${b.periodName}` : 'Período'})` : ''}
                        </td>
                        <td className="py-4 px-6 text-right">
                          {isCancelled ? (
                            <div className="flex flex-col items-end">
                              <span className="text-gray-400 line-through text-[11px] font-semibold">
                                R$ {b.totalAmount.toFixed(2)}
                              </span>
                              <span className="font-black text-red-600 text-xs">
                                R$ 0,00
                              </span>
                              <span className="text-[9px] font-bold text-gray-500 uppercase tracking-tighter">
                                Desconsiderado
                              </span>
                            </div>
                          ) : (
                            <span className="font-black text-gray-900 text-xs">
                              R$ {b.totalAmount.toFixed(2)}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-center">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            b.paymentStatus === 'PAID'
                              ? 'bg-emerald-100 text-emerald-800'
                              : isCancelled
                              ? 'bg-red-100 text-red-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {b.paymentStatus === 'PAID' ? 'Pago' : isCancelled ? 'Cancelado (Sem Cobrança)' : 'Pendente'}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button
                            onClick={() => handleOpenPaymentModal(b)}
                            className="text-teal-600 hover:text-teal-800 font-bold uppercase text-[11px]"
                          >
                            Alterar Status
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {filteredFinancialBookings.length > 0 && (
                  <tfoot className="bg-gray-50/80 border-t-2 border-gray-200 font-black text-xs">
                    <tr>
                      <td colSpan={4} className="py-4 px-6 text-gray-700">
                        Totalizadores da Cobrança ({financialSummary.activeCount} faturáveis • {financialSummary.cancelledCount} canceladas desconsideradas)
                      </td>
                      <td className="py-4 px-6 text-gray-700">
                        {financialSummary.totalActiveHours}h
                      </td>
                      <td className="py-4 px-6 text-right text-gray-900">
                        R$ {financialSummary.totalToBill.toFixed(2)}
                        <span className="block text-[9px] font-bold text-emerald-700">
                          (Sem cancelados)
                        </span>
                      </td>
                      <td className="py-4 px-6 text-center text-[11px] text-gray-600">
                        Pago: R$ {financialSummary.totalPaid.toFixed(2)}
                      </td>
                      <td className="py-4 px-6 text-right text-[11px] text-amber-700">
                        Pendente: R$ {financialSummary.totalPending.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= 6. RELATÓRIOS (Seção 16) ================= */}
      {activeTab === 'reports' && (
        <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-6">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-black text-gray-900">Relatórios Gerenciais</h3>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                Consolidado mensal por sala e por profissional
              </p>
            </div>
            <Button onClick={handleExportPDF} className="flex items-center gap-1.5 text-xs">
              <Download size={14} /> Exportar PDF Completo
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-6 rounded-3xl bg-gray-50 border border-gray-100 space-y-2">
              <span className="text-[10px] font-black uppercase text-gray-400">Total Faturado</span>
              <span className="text-2xl font-black text-gray-900 block">R$ {totalMonthlyRevenue.toFixed(2)}</span>
              <p className="text-xs text-emerald-600 font-bold">Recebido: R$ {totalMonthlyPaid.toFixed(2)}</p>
            </div>

            <div className="p-6 rounded-3xl bg-gray-50 border border-gray-100 space-y-2">
              <span className="text-[10px] font-black uppercase text-gray-400">Total de Horas</span>
              <span className="text-2xl font-black text-gray-900 block">{totalMonthlyHours} horas</span>
              <p className="text-xs text-teal-600 font-bold">Sala 1: {room1Hours}h | Sala 2: {room2Hours}h</p>
            </div>

            <div className="p-6 rounded-3xl bg-gray-50 border border-gray-100 space-y-2">
              <span className="text-[10px] font-black uppercase text-gray-400">Taxa de Ocupação</span>
              <span className="text-2xl font-black text-gray-900 block">
                {Math.round((room1Occupancy + room2Occupancy) / 2)}%
              </span>
              <p className="text-xs text-gray-500">Média combinada das 2 salas</p>
            </div>
          </div>
        </div>
      )}

      {/* ================= 7. BLOQUEIOS DE HORÁRIOS (Seção 33, 34) ================= */}
      {activeTab === 'blocks' && (
        <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-black text-gray-900">Bloqueios Administrativos & Feriados</h3>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                Bloqueie feriados (dia inteiro) ou horários específicos por manutenção e reuniões
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => handleOpenNewBlockModal('FULL_DAY', 'Feriado / Recesso da Clínica')}
                className="flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white border-amber-600 shadow-xs"
              >
                <Palmtree size={14} /> Bloquear Feriado (Dia Todo)
              </Button>
              <Button
                onClick={() => handleOpenNewBlockModal('HOURS')}
                variant="secondary"
                className="flex items-center gap-1.5 text-xs"
              >
                <Clock size={14} /> Bloquear Horário
              </Button>
            </div>
          </div>

          {blocks.length === 0 ? (
            <div className="p-8 bg-amber-50/40 rounded-2xl border border-amber-100 text-center space-y-2">
              <CalendarOff size={28} className="mx-auto text-amber-400" />
              <p className="text-xs font-bold text-gray-700">Nenhum bloqueio administrativo ou feriado ativo no momento.</p>
              <p className="text-[11px] text-gray-400">
                Utilize os botões acima para bloquear um dia inteiro (feriado) ou um horário específico.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {blocks.map(b => {
                const isFullDay = b.startHour <= 7 && b.endHour >= 14;
                return (
                  <div key={b.id} className="p-5 rounded-2xl border border-amber-200 bg-amber-50/50 flex justify-between items-start gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-black text-xs text-amber-900">
                          {b.roomId === 'ALL' ? 'Todas as Salas (Clínica toda)' : b.roomId}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-black uppercase tracking-wider ${
                          isFullDay ? 'bg-amber-200 text-amber-900' : 'bg-amber-200/60 text-amber-800'
                        }`}>
                          {isFullDay ? '🌴 Feriado (Dia Todo)' : `⏱️ ${b.startHour}:00 às ${b.endHour}:00`}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-amber-900">
                        Data: {format(parseISO(b.date), 'dd/MM/yyyy')}
                      </p>
                      <p className="text-xs font-medium text-amber-800">
                        Motivo: <span className="font-bold">{b.reason}</span>
                      </p>
                      {b.createdBy && (
                        <p className="text-[10px] text-amber-600">
                          Por: {b.createdBy}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteBlock(b.id)}
                      className="p-2 text-red-500 hover:bg-red-100 rounded-xl transition-colors shrink-0"
                      title="Desativar Bloqueio"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ================= 8. CONFIGURAÇÕES (Seção 29) ================= */}
      {activeTab === 'settings' && (
        <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm max-w-3xl mx-auto space-y-6">
          <div>
            <h3 className="text-xl font-black text-gray-900">Configurações Gerais da Clínica</h3>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
              Horários de funcionamento, regras de cancelamento e dados do estabelecimento
            </p>
          </div>

          <div className="space-y-4">
            <Input
              label="Nome do Estabelecimento"
              value={config.establishmentName}
              onChange={e => setConfig({ ...config, establishmentName: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="E-mail de Contato"
                value={config.contactEmail}
                onChange={e => setConfig({ ...config, contactEmail: e.target.value })}
              />
              <Input
                label="Telefone / WhatsApp da Clínica"
                value={config.contactPhone}
                onChange={e => setConfig({ ...config, contactPhone: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Horário de Abertura (Hora)"
                type="number"
                value={config.openHour.toString()}
                onChange={e => setConfig({ ...config, openHour: Number(e.target.value) })}
              />
              <Input
                label="Horário de Fechamento (Hora)"
                type="number"
                value={config.closeHour.toString()}
                onChange={e => setConfig({ ...config, closeHour: Number(e.target.value) })}
              />
            </div>
            <Input
              label="Regra de Cancelamento (Horas Mínimas de Antecedência)"
              type="number"
              value={config.cancellationLimitHours.toString()}
              onChange={e => setConfig({ ...config, cancellationLimitHours: Number(e.target.value) })}
            />
            <div className="pt-4 flex justify-end">
              <Button onClick={() => {
                saveSystemConfig(config);
                addToast('Configurações salvas com sucesso!', 'success');
              }}>
                Salvar Configurações
              </Button>
            </div>
          </div>

          {/* ================= BLOQUEIO DE HORÁRIOS OU DIA (FERIADOS) ================= */}
          <div className="pt-6 border-t border-gray-100">
            <div className="p-6 rounded-3xl border border-amber-200 bg-amber-50/40 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3.5">
                  <div className="w-12 h-12 bg-amber-100 text-amber-800 rounded-2xl flex items-center justify-center shrink-0 shadow-xs">
                    <Palmtree size={24} />
                  </div>
                  <div>
                    <h4 className="text-base font-black text-gray-900">
                      Bloqueio de Horários ou Dia Completo (Feriados & Recessos)
                    </h4>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">
                      Bloqueie o dia inteiro para feriados nacionais, municipais ou reformas da clínica, ou restrinja faixas específicas de horários para evitar agendamentos.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => handleOpenNewBlockModal('FULL_DAY', 'Feriado / Recesso da Clínica')}
                    className="flex items-center gap-1.5 text-xs py-2 px-3.5 shadow-xs bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                  >
                    <Palmtree size={14} /> Bloquear Feriado (Dia Todo)
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => handleOpenNewBlockModal('HOURS')}
                    className="flex items-center gap-1.5 text-xs py-2 px-3.5"
                  >
                    <Clock size={14} /> Bloquear Horário
                  </Button>
                </div>
              </div>

              {/* Lista dos Bloqueios & Feriados Cadastrados */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between text-xs font-bold text-gray-500 uppercase tracking-wider px-1">
                  <span>Bloqueios & Feriados Cadastrados ({blocks.length})</span>
                  {blocks.length > 0 && (
                    <span className="text-[10px] text-amber-800 font-semibold normal-case">
                      * Dias e horários bloqueados impedem agendamentos por terapeutas.
                    </span>
                  )}
                </div>

                {blocks.length === 0 ? (
                  <div className="p-6 bg-white rounded-2xl border border-amber-100 text-center space-y-2">
                    <CalendarOff size={24} className="mx-auto text-amber-400" />
                    <p className="text-xs font-semibold text-gray-700">Nenhum feriado ou horário bloqueado no momento.</p>
                    <p className="text-[11px] text-gray-400">
                      Utilize os botões acima para bloquear feriados (o dia todo) ou horários pontuais por manutenção/reunião.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {blocks.map(b => {
                      const isFullDay = b.startHour <= 7 && b.endHour >= 14;
                      return (
                        <div
                          key={b.id}
                          className="p-4 bg-white rounded-2xl border border-amber-200/80 shadow-xs flex justify-between items-start gap-3 hover:border-amber-300 transition-all"
                        >
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-black text-gray-900">
                                {b.roomId === 'ALL' ? 'Todas as Salas (Clínica toda)' : b.roomId}
                              </span>
                              <span className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider ${
                                isFullDay 
                                  ? 'bg-amber-100 text-amber-800' 
                                  : 'bg-teal-50 text-teal-700'
                              }`}>
                                {isFullDay ? '🌴 Dia Inteiro' : `⏱️ ${b.startHour}h às ${b.endHour}h`}
                              </span>
                            </div>

                            <p className="text-xs font-bold text-teal-900">
                              📅 {format(parseISO(b.date), 'dd/MM/yyyy')}
                            </p>

                            <p className="text-xs text-gray-600">
                              Motivo: <strong className="text-gray-800">{b.reason}</strong>
                            </p>
                            {b.createdBy && (
                              <span className="text-[10px] text-gray-400 block">
                                Criado por: {b.createdBy}
                              </span>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDeleteBlock(b.id)}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all shrink-0"
                            title="Remover bloqueio"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ================= ZONA DE ACESSO: REDEFINIR SENHA DE PROFISSIONAL ================= */}
          <div className="pt-6 border-t border-gray-100">
            <div className="p-6 rounded-3xl border border-teal-200 bg-teal-50/40 space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-teal-100 text-teal-700 rounded-2xl flex items-center justify-center shrink-0 shadow-xs">
                  <KeyRound size={24} />
                </div>
                <div>
                  <h4 className="text-base font-black text-gray-900">
                    Redefinir Senha de Profissional (Esquecimento de Senha)
                  </h4>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                    Ferramenta administrativa para cadastrar uma nova senha para psicólogos e terapeutas que esqueceram suas credenciais de acesso ao LocaPsico.
                  </p>
                </div>
              </div>

              <div className="space-y-4 pt-1">
                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-2">
                    Selecione o Profissional
                  </label>
                  <select
                    value={resetPasswordUserId}
                    onChange={e => {
                      setResetPasswordUserId(e.target.value);
                      setLastResetResult(null);
                    }}
                    className="w-full px-4 py-3 bg-white border-2 border-teal-200 rounded-2xl text-xs sm:text-sm font-semibold text-gray-800 focus:outline-none focus:border-teal-600 transition-all shadow-xs"
                  >
                    <option value="">-- Selecione o profissional que esqueceu a senha --</option>
                    {users.filter(u => u.role === 'USER').map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.profession || 'Terapeuta'} ({p.email})
                      </option>
                    ))}
                  </select>
                </div>

                {resetPasswordUserId && (() => {
                  const targetProf = users.find(u => u.id === resetPasswordUserId);
                  if (!targetProf) return null;

                  return (
                    <div className="p-5 bg-white rounded-2xl border border-teal-100 shadow-xs space-y-4 animate-fade-in">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100">
                        <div>
                          <span className="text-sm font-black text-gray-900 block">{targetProf.name}</span>
                          <span className="text-xs text-teal-700 font-bold">{targetProf.profession}</span>
                          {targetProf.councilRegistration && (
                            <span className="text-xs text-gray-500 ml-1.5">({targetProf.councilRegistration})</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          E-mail de Login: <strong className="text-gray-800">{targetProf.email}</strong>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="block text-xs font-bold text-gray-700">
                            Nova Senha de Acesso *
                          </label>
                          {newPasswordInput && (() => {
                            const strength = checkPasswordStrength(newPasswordInput);
                            return (
                              <span className={`text-[11px] font-black uppercase tracking-wider ${strength.color}`}>
                                Força: {strength.label}
                              </span>
                            );
                          })()}
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2.5">
                          <div className="relative flex-1">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={newPasswordInput}
                              onChange={e => setNewPasswordInput(e.target.value)}
                              placeholder="Digite a nova senha (mínimo 6 dígitos)"
                              className="w-full px-4 py-3 pr-10 bg-white border-2 border-gray-200 rounded-xl text-xs sm:text-sm font-semibold text-gray-900 focus:outline-none focus:border-teal-600 transition-all"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-3 top-3.5 text-gray-400 hover:text-gray-600"
                              title={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                            >
                              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                            </button>
                          </div>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={handleGenerateRandomPassword}
                            className="text-xs px-4 py-2.5 whitespace-nowrap"
                          >
                            Gerar Senha Provisória
                          </Button>
                        </div>
                        <p className="text-[11px] text-gray-400">
                          Você pode digitar a senha escolhida pelo profissional ou clicar em "Gerar Senha Provisória" para gerar automaticamente uma senha padrão.
                        </p>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <Button
                          variant="primary"
                          disabled={isResettingPassword || !newPasswordInput}
                          onClick={handleAdminResetPassword}
                          className="flex items-center gap-2 text-xs px-6 py-2.5 shadow-sm"
                        >
                          <KeyRound size={15} />
                          {isResettingPassword ? 'Atualizando...' : 'Definir Nova Senha'}
                        </Button>
                      </div>
                    </div>
                  );
                })()}

                {/* Card com Confirmação e Envio Rápido */}
                {lastResetResult && (
                  <div className="p-5 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-3 animate-fade-in">
                    <div className="flex items-center gap-2 text-emerald-800">
                      <CheckCircle2 size={18} className="text-emerald-600" />
                      <span className="text-xs font-black uppercase tracking-wider">
                        Senha Atualizada com Sucesso!
                      </span>
                    </div>
                    <div className="p-3.5 bg-white rounded-xl border border-emerald-100 text-xs space-y-1 font-mono text-gray-700">
                      <p><strong>Profissional:</strong> {lastResetResult.userName}</p>
                      <p><strong>E-mail de Login:</strong> {lastResetResult.userEmail}</p>
                      <p><strong>Nova Senha:</strong> <span className="font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded">{lastResetResult.newPass}</span></p>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={handleCopyResetCredentials}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 rounded-xl text-xs font-bold transition-all shadow-xs"
                      >
                        <Copy size={13} />
                        Copiar Dados
                      </button>
                      {lastResetResult.userPhone && (
                        <a
                          href={`https://wa.me/55${lastResetResult.userPhone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá ${lastResetResult.userName}, sua nova senha de acesso ao LocaPsico foi definida para: ${lastResetResult.newPass}\n\nVocê já pode entrar com seu e-mail (${lastResetResult.userEmail}) e agendar suas salas!`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                        >
                          <MessageCircle size={13} />
                          Enviar pelo WhatsApp
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ================= ZONA DE GESTÃO: EXCLUIR PROFISSIONAL DO APP ================= */}
          <div className="pt-6 border-t border-gray-100">
            <div className="p-6 rounded-3xl border border-red-200 bg-red-50/40 space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center shrink-0 shadow-xs">
                  <UserX size={24} />
                </div>
                <div>
                  <h4 className="text-base font-black text-gray-900">
                    Excluir Profissional do Aplicativo
                  </h4>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                    Comando administrativo para revogar e excluir permanentemente a conta de um psicólogo ou terapeuta do LocaPsico.
                  </p>
                </div>
              </div>

              <div className="space-y-4 pt-1">
                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-2">
                    Selecione o Profissional para Excluir
                  </label>
                  <select
                    value={selectedProfToDelete}
                    onChange={e => setSelectedProfToDelete(e.target.value)}
                    className="w-full px-4 py-3 bg-white border-2 border-red-200 rounded-2xl text-xs sm:text-sm font-semibold text-gray-800 focus:outline-none focus:border-red-500 transition-all shadow-xs"
                  >
                    <option value="">-- Selecione um profissional cadastrado --</option>
                    {users.filter(u => u.role === 'USER').map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.profession || 'Terapeuta'} ({p.email})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedProfToDelete && (() => {
                  const targetProf = users.find(u => u.id === selectedProfToDelete);
                  if (!targetProf) return null;

                  const profBookings = bookings.filter(b => b.userId === targetProf.id && b.paymentStatus !== 'CANCELLED');
                  const totalHours = profBookings.reduce((sum, b) => sum + (b.durationHours || 1), 0);
                  const totalSpent = profBookings.reduce((sum, b) => sum + b.totalAmount, 0);

                  return (
                    <div className="p-5 bg-white rounded-2xl border border-red-200/80 shadow-sm space-y-4 animate-fade-in">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-gray-100">
                        <div>
                          <span className="text-sm sm:text-base font-black text-gray-900 block">{targetProf.name}</span>
                          <span className="text-xs text-teal-700 font-bold">{targetProf.profession}</span>
                          {targetProf.councilRegistration && (
                            <span className="text-xs text-gray-500 ml-1.5">({targetProf.councilRegistration})</span>
                          )}
                        </div>
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider self-start sm:self-auto ${
                          targetProf.status !== 'INACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {targetProf.status !== 'INACTIVE' ? 'Ativo' : 'Inativo'}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <div className="p-3 bg-gray-50 rounded-xl">
                          <span className="text-[10px] font-bold text-gray-400 uppercase block">E-mail</span>
                          <span className="font-medium text-gray-800 truncate block">{targetProf.email}</span>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-xl">
                          <span className="text-[10px] font-bold text-gray-400 uppercase block">Telefone</span>
                          <span className="font-medium text-gray-800 block">{targetProf.phone || targetProf.whatsapp || 'Não informado'}</span>
                        </div>
                        <div className="p-3 bg-gray-50 rounded-xl">
                          <span className="text-[10px] font-bold text-gray-400 uppercase block">Consumo no App</span>
                          <span className="font-bold text-gray-900 block">{profBookings.length} reservas ({totalHours}h • R$ {totalSpent.toFixed(0)})</span>
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <Button
                          variant="danger"
                          onClick={() => handleInitiateDeleteUser(targetProf)}
                          className="flex items-center gap-2 text-xs px-5 py-2.5 shadow-sm"
                        >
                          <Trash2 size={15} />
                          Excluir {targetProf.name} do App
                        </Button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= 9. AUDITORIA (Seção 50) ================= */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-4">
          <h3 className="text-xl font-black text-gray-900">Trilha de Auditoria do Sistema</h3>
          <div className="space-y-3 pt-2">
            {auditLogs.map(log => (
              <div key={log.id} className="p-4 rounded-2xl bg-gray-50 border border-gray-100 flex justify-between items-start text-xs">
                <div>
                  <span className="font-black text-teal-700 uppercase tracking-wider block text-[10px]">
                    {log.action}
                  </span>
                  <p className="font-bold text-gray-900 mt-0.5">{log.details}</p>
                  <p className="text-[10px] text-gray-400 mt-1">
                    Responsável: {log.userName}
                  </p>
                </div>
                <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                  {format(parseISO(log.timestamp), "dd/MM/yyyy HH:mm")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ================= 9.5. BACKUP E SEGURANÇA ================= */}
      {activeTab === 'backup' && (
        <div className="max-w-5xl mx-auto space-y-6 animate-fade-in">
          {/* Cabeçalho Principal */}
          <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-6">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-teal-600/20">
                  <Database size={26} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-black text-gray-900">Backup e Segurança</h3>
                    <span className="bg-teal-50 text-teal-700 border border-teal-200 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                      <ShieldCheck size={12} /> Exclusivo Administrador
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed max-w-3xl">
                    Escolha abaixo a modalidade de exportação desejada. O sistema oferece o <strong>Backup Completo</strong> (para futura restauração real dos dados) e o <strong>Backup Anonimizado</strong> (com mascaramento de dados pessoais para auditoria, suporte técnico ou conformidade LGPD).
                  </p>
                </div>
              </div>
            </div>

            {/* Grid com as 2 Modalidades de Backup */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* OPÇÃO 1: BACKUP COMPLETO */}
              <div className="p-6 rounded-3xl bg-teal-50/60 border-2 border-teal-200 flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-teal-600 text-white text-[10px] font-black uppercase tracking-wider">
                      <CheckCircle2 size={12} /> 1. Backup Completo
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-teal-800 bg-white px-2.5 py-1 rounded-lg border border-teal-200">
                      Restauração Integral
                    </span>
                  </div>

                  <div>
                    <h4 className="text-base font-black text-gray-900">
                      Dados Originais Completos para Restauração
                    </h4>
                    <p className="text-xs text-gray-600 leading-relaxed mt-1">
                      Contém todos os registros reais necessários para reconstruir integralmente o sistema no futuro. Mantém intactos CPFs, telefones, e-mails, nomes de profissionais e pacientes, agendamentos e histórico financeiro.
                    </p>
                  </div>

                  {/* Exemplo técnico claro */}
                  <div className="p-3.5 rounded-2xl bg-white border border-teal-100 space-y-1.5 text-[11px]">
                    <span className="font-black text-teal-800 uppercase tracking-wider block text-[10px]">
                      Formato dos Dados no Backup Completo:
                    </span>
                    <pre className="font-mono text-[10px] text-gray-700 overflow-x-auto leading-relaxed">
{`"cpf": "11111111111",
"phone": "11957865636",
"email": "admin@admin.com.br"`}
                    </pre>
                    <p className="text-[10px] text-gray-500 pt-1 border-t border-gray-100">
                      <strong>Segurança:</strong> Não inclui senhas, tokens, Service Role Key, chaves de API, secrets ou variáveis de ambiente.
                    </p>
                  </div>

                  <div className="text-[10px] text-teal-800 font-mono bg-teal-100/60 px-3 py-1.5 rounded-xl border border-teal-200/70 truncate">
                    Arquivo: locapsico_backup_completo_YYYY-MM-DD_HH-mm-ss.json
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    variant="primary"
                    disabled={generatingBackupMode !== null}
                    onClick={() => handleRunBackupNow('full')}
                    className="w-full py-3.5 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2.5 shadow-md shadow-teal-600/20"
                  >
                    {generatingBackupMode === 'full' ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        <span>Gerando backup completo...</span>
                      </>
                    ) : (
                      <>
                        <Download size={16} />
                        <span>Baixar Backup Completo</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* OPÇÃO 2: BACKUP ANONIMIZADO */}
              <div className="p-6 rounded-3xl bg-slate-50 border-2 border-slate-200 flex flex-col justify-between gap-5">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-white text-[10px] font-black uppercase tracking-wider">
                      <EyeOff size={12} /> 2. Backup Anonimizado
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-700 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                      Proteção LGPD / Análise
                    </span>
                  </div>

                  <div>
                    <h4 className="text-base font-black text-gray-900">
                      Dados Pessoais Mascarados (Sem Identificação)
                    </h4>
                    <p className="text-xs text-gray-600 leading-relaxed mt-1">
                      Preserva a estrutura das tabelas, IDs relacionais, contagens, datas, horários e valores financeiros, mas substitui nomes, CPFs, telefones, e-mails, CRPs e anotações por máscaras anônimas.
                    </p>
                  </div>

                  {/* Exemplo técnico claro */}
                  <div className="p-3.5 rounded-2xl bg-white border border-slate-200 space-y-1.5 text-[11px]">
                    <span className="font-black text-slate-700 uppercase tracking-wider block text-[10px]">
                      Formato dos Dados no Backup Anonimizado:
                    </span>
                    <pre className="font-mono text-[10px] text-gray-700 overflow-x-auto leading-relaxed">
{`"cpf": "***.***.***-**",
"phone": "(**) *****-****",
"email": "profissional_1@anonimizado.local"`}
                    </pre>
                    <p className="text-[10px] text-amber-800 pt-1 border-t border-gray-100">
                      <strong>Atenção:</strong> Indicado para auditoria externa, testes ou diagnóstico técnico. <strong>Não deve ser usado para restaurar produção.</strong>
                    </p>
                  </div>

                  <div className="text-[10px] text-slate-700 font-mono bg-slate-200/60 px-3 py-1.5 rounded-xl border border-slate-300/70 truncate">
                    Arquivo: locapsico_backup_anonimizado_YYYY-MM-DD_HH-mm-ss.json
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    disabled={generatingBackupMode !== null}
                    onClick={() => handleRunBackupNow('anonymized')}
                    className="w-full py-3.5 px-6 rounded-2xl bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 shadow-md shadow-slate-900/10"
                  >
                    {generatingBackupMode === 'anonymized' ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        <span>Gerando backup anonimizado...</span>
                      </>
                    ) : (
                      <>
                        <EyeOff size={16} />
                        <span>Baixar Backup Anonimizado</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Alerta de Erro caso ocorra falha */}
            {backupError && (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-900 animate-fade-in">
                <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <span className="font-black block text-red-800 uppercase tracking-wider">
                    Não foi possível concluir o backup
                  </span>
                  <p className="text-red-700 font-medium">{backupError}</p>
                </div>
              </div>
            )}

            {/* Resultado do Último Backup Gerado na Sessão */}
            {lastBackupResult && (
              <div className="p-6 rounded-3xl bg-emerald-50/70 border border-emerald-200 space-y-4 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-200/60 pb-3">
                  <div className="flex items-center gap-2.5 text-emerald-900">
                    <CheckCircle2 size={20} className="text-emerald-600 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black uppercase tracking-wider">
                          Backup {lastBackupResult.backupType} Gerado e Baixado com Sucesso!
                        </span>
                        <span
                          className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase ${
                            lastBackupResult.mode === 'anonymized'
                              ? 'bg-slate-800 text-white'
                              : 'bg-teal-700 text-white'
                          }`}
                        >
                          {lastBackupResult.mode === 'anonymized'
                            ? 'Dados Anonimizados (LGPD)'
                            : 'Pronto para Restauração'}
                        </span>
                      </div>
                      <span className="text-[11px] text-emerald-700 font-semibold block mt-0.5">
                        Arquivo salvo: <strong className="font-mono">{lastBackupResult.fileName}</strong>
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-800 bg-white px-3 py-1 rounded-xl border border-emerald-200 self-start sm:self-auto">
                    {format(parseISO(lastBackupResult.generatedAt), "dd/MM/yyyy 'às' HH:mm:ss")}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 text-xs">
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Perfis (profiles)</span>
                    <span className="text-base font-black text-gray-900">{lastBackupResult.counts.profiles}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Profissionais</span>
                    <span className="text-base font-black text-gray-900">{lastBackupResult.counts.professionals}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Pacientes (clients)</span>
                    <span className="text-base font-black text-gray-900">{lastBackupResult.counts.clients}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Salas (rooms)</span>
                    <span className="text-base font-black text-gray-900">{lastBackupResult.counts.rooms}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Agendamentos</span>
                    <span className="text-base font-black text-gray-900">{lastBackupResult.counts.bookings}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Pagamentos</span>
                    <span className="text-base font-black text-gray-900">{lastBackupResult.counts.payments}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Bloqueios</span>
                    <span className="text-base font-black text-gray-900">{lastBackupResult.counts.blocked_slots}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Configurações</span>
                    <span className="text-base font-black text-gray-900">{lastBackupResult.counts.settings}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Logs Auditoria</span>
                    <span className="text-base font-black text-gray-900">{lastBackupResult.counts.audit_logs}</span>
                  </div>
                  <div className="p-3 bg-emerald-600 text-white rounded-2xl">
                    <span className="text-[10px] font-black uppercase text-emerald-100 block">Total Exportado</span>
                    <span className="text-base font-black">{lastBackupResult.totalRecords} reg.</span>
                  </div>
                </div>
              </div>
            )}

            {/* Comparativo Direto e Garantias de Segurança */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="p-5 rounded-2xl bg-gray-50 border border-gray-100 space-y-2.5 text-xs">
                <h5 className="font-black text-gray-900 uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <Database size={14} className="text-teal-600" /> Diferença Entre os Dois Arquivos
                </h5>
                <ul className="space-y-1.5 text-gray-600">
                  <li>• <strong>Backup Completo:</strong> Preserva nomes, CPFs, telefones, e-mails e observações reais. Indispensável para restaurar os dados do sistema.</li>
                  <li>• <strong>Backup Anonimizado:</strong> Substitui dados pessoais identificáveis por máscaras (ex: <code>***.***.***-**</code>), mantendo IDs e valores financeiros para conferência segura.</li>
                  <li>• <strong>Mesma Cobertura:</strong> Ambos exportam as 9 tabelas públicas (<code>profiles</code>, <code>professionals</code>, <code>clients</code>, <code>rooms</code>, <code>bookings</code>, <code>payments</code>, <code>blocked_slots</code>, <code>settings</code> e <code>audit_logs</code>).</li>
                </ul>
              </div>

              <div className="p-5 rounded-2xl bg-gray-50 border border-gray-100 space-y-2.5 text-xs">
                <h5 className="font-black text-gray-900 uppercase tracking-wider text-[11px] flex items-center gap-2">
                  <ShieldCheck size={14} className="text-teal-600" /> Proteção e Sigilo em Ambos
                </h5>
                <ul className="space-y-1.5 text-gray-600">
                  <li>• <strong>Acesso Restrito:</strong> Validado por token de sessão e perfil de Administrador no servidor.</li>
                  <li>• <strong>Operação 100% Somente Leitura:</strong> Executa apenas consultas <code>SELECT</code> no Supabase, sem alterar nenhum registro.</li>
                  <li>• <strong>Zero Credenciais:</strong> Nenhuma senha, hash, token, Service Role Key, chave de API ou variável de ambiente é incluída em nenhum dos arquivos.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* ================= SEÇÃO DE RESTAURAÇÃO SEGURA DE BACKUP COMPLETO ================= */}
          <div className="bg-white rounded-3xl p-6 lg:p-8 border-2 border-amber-200/80 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-6">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-2xl bg-amber-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-amber-600/20">
                  <RotateCcw size={26} />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-black text-gray-900">
                      Restauração Segura de Backup
                    </h3>
                    <span className="bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                      <Lock size={11} /> Somente Backup Completo
                    </span>
                    <span className="bg-teal-50 text-teal-700 border border-teal-200 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider flex items-center gap-1">
                      <ShieldCheck size={11} /> Conta Admin Protegida
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1 leading-relaxed max-w-3xl">
                    Permite restaurar integralmente o banco de dados a partir de um arquivo de{' '}
                    <strong>Backup Completo</strong> gerado pelo próprio LocaPsico (
                    <code className="text-[11px] bg-gray-100 px-1.5 py-0.5 rounded">
                      locapsico_backup_completo_...json
                    </code>
                    ). Por segurança, arquivos de <strong>Backup Anonimizado são estritamente bloqueados</strong> e jamais podem ser restaurados.
                  </p>
                </div>
              </div>
            </div>

            {/* Seleção de Arquivo JSON */}
            <div className="p-6 rounded-3xl bg-amber-50/40 border border-amber-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="space-y-1">
                <h4 className="text-sm font-black text-gray-900 flex items-center gap-2">
                  <Upload size={16} className="text-amber-700" />
                  1. Selecionar Arquivo de Backup Completo (.json)
                </h4>
                <p className="text-xs text-gray-600">
                  O sistema fará a leitura e validação estrutural completa do arquivo antes de habilitar qualquer alteração no banco de dados.
                </p>
              </div>

              <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto">
                <label className="cursor-pointer w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-gray-900 hover:bg-gray-800 text-white text-xs font-black uppercase tracking-wider transition-all shadow-sm">
                  <Upload size={15} />
                  <span>Escolher Arquivo .JSON</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleSelectRestoreFile}
                    disabled={isRestoringBackup}
                    className="hidden"
                  />
                </label>

                {restoreValidation && (
                  <button
                    type="button"
                    onClick={handleClearRestoreSelection}
                    disabled={isRestoringBackup}
                    className="px-3.5 py-3 rounded-2xl bg-white hover:bg-gray-100 text-gray-600 border border-gray-200 text-xs font-bold transition-all"
                  >
                    Limpar
                  </button>
                )}
              </div>
            </div>

            {/* Caso o arquivo selecionado seja INVÁLIDO ou ANONIMIZADO */}
            {restoreValidation && !restoreValidation.valid && (
              <div className="p-6 rounded-3xl bg-red-50 border-2 border-red-200 space-y-3 animate-fade-in">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-red-600 text-white flex items-center justify-center shrink-0">
                    <XCircle size={20} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-black uppercase tracking-wider text-red-900">
                        {restoreValidation.isAnonymizedDetected
                          ? 'Restauração Bloqueada: Backup Anonimizado Detectado'
                          : 'Arquivo Rejeitado na Validação de Segurança'}
                      </span>
                      {restoreValidation.fileName && (
                        <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-red-200 text-red-800">
                          {restoreValidation.fileName}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-red-800 font-medium leading-relaxed">
                      {restoreValidation.error}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Caso o arquivo selecionado seja um BACKUP COMPLETO VÁLIDO: Pré-visualização e Confirmação */}
            {restoreValidation && restoreValidation.valid && restoreValidation.summary && (
              <div className="p-6 rounded-3xl bg-amber-50/60 border-2 border-amber-300 space-y-6 animate-fade-in">
                {/* Cabeçalho da Inspeção */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-amber-200 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-teal-600 text-white flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle2 size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-black uppercase tracking-wider text-gray-900">
                          2. Inspeção Prévia do Arquivo Validado
                        </span>
                        <span className="bg-teal-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-md uppercase">
                          Backup {restoreValidation.summary.backupType} • Apto para Restauração
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-600 mt-0.5">
                        Arquivo: <strong className="font-mono text-gray-900">{restoreValidation.fileName}</strong> •{' '}
                        Gerado por: <strong>{restoreValidation.summary.generatedByName}</strong> ({restoreValidation.summary.generatedByEmail})
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] font-black uppercase text-amber-900 block">
                      Data do Backup
                    </span>
                    <span className="text-xs font-black text-gray-900 bg-white px-3 py-1 rounded-xl border border-amber-200 inline-block mt-0.5">
                      {restoreValidation.summary.generatedAt
                        ? format(parseISO(restoreValidation.summary.generatedAt), "dd/MM/yyyy 'às' HH:mm:ss")
                        : 'Data registrada no arquivo'}
                    </span>
                  </div>
                </div>

                {/* Contagem Detalhada dos Registros que Serão Restaurados */}
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 block mb-2.5">
                    Quantidade de Registros no Arquivo por Tabela:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 text-xs">
                    <div className="p-3 bg-white rounded-2xl border border-amber-200/80">
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Perfis (profiles)</span>
                      <span className="text-base font-black text-gray-900">{restoreValidation.summary.counts.profiles}</span>
                    </div>
                    <div className="p-3 bg-white rounded-2xl border border-amber-200/80">
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Profissionais</span>
                      <span className="text-base font-black text-gray-900">{restoreValidation.summary.counts.professionals}</span>
                    </div>
                    <div className="p-3 bg-white rounded-2xl border border-amber-200/80">
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Pacientes (clients)</span>
                      <span className="text-base font-black text-gray-900">{restoreValidation.summary.counts.clients}</span>
                    </div>
                    <div className="p-3 bg-white rounded-2xl border border-amber-200/80">
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Salas (rooms)</span>
                      <span className="text-base font-black text-gray-900">{restoreValidation.summary.counts.rooms}</span>
                    </div>
                    <div className="p-3 bg-white rounded-2xl border border-amber-200/80">
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Agendamentos</span>
                      <span className="text-base font-black text-gray-900">{restoreValidation.summary.counts.bookings}</span>
                    </div>
                    <div className="p-3 bg-white rounded-2xl border border-amber-200/80">
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Pagamentos</span>
                      <span className="text-base font-black text-gray-900">{restoreValidation.summary.counts.payments}</span>
                    </div>
                    <div className="p-3 bg-white rounded-2xl border border-amber-200/80">
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Bloqueios</span>
                      <span className="text-base font-black text-gray-900">{restoreValidation.summary.counts.blocked_slots}</span>
                    </div>
                    <div className="p-3 bg-white rounded-2xl border border-amber-200/80">
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Configurações</span>
                      <span className="text-base font-black text-gray-900">{restoreValidation.summary.counts.settings}</span>
                    </div>
                    <div className="p-3 bg-white rounded-2xl border border-amber-200/80">
                      <span className="text-[10px] font-black uppercase text-gray-400 block">Logs Auditoria</span>
                      <span className="text-base font-black text-gray-900">{restoreValidation.summary.counts.audit_logs}</span>
                    </div>
                    <div className="p-3 bg-amber-600 text-white rounded-2xl">
                      <span className="text-[10px] font-black uppercase text-amber-100 block">Total no Arquivo</span>
                      <span className="text-base font-black">{restoreValidation.summary.totalRecords} reg.</span>
                    </div>
                  </div>
                </div>

                {/* Garantias Técnicas da Restauração */}
                <div className="p-4 rounded-2xl bg-white border border-amber-200/90 space-y-2 text-xs">
                  <span className="font-black text-amber-900 uppercase tracking-wider block text-[10px]">
                    Protocolo de Segurança e Integridade Relacional:
                  </span>
                  <ul className="space-y-1 text-gray-600 text-[11px]">
                    <li>
                      • <strong>Preservação Absoluta do Administrador:</strong> Sua conta atual (
                      <code>{adminActor.email}</code>) permanecerá ativa, autenticada e com permissão{' '}
                      <code>admin</code> em <code>auth.users</code> e <code>profiles</code>.
                    </li>
                    <li>
                      • <strong>Ordem Estrita de Chaves Estrangeiras:</strong> Os dados serão restaurados na sequência{' '}
                      <code>settings → rooms → profiles → professionals → clients → bookings → blocked_slots → payments → audit_logs</code>.
                    </li>
                    <li>
                      • <strong>Rollback Automático em Memória:</strong> Se qualquer falha de integridade ocorrer no servidor, o estado imediatamente anterior é preservado automaticamente.
                    </li>
                  </ul>
                </div>

                {/* Etapas de Confirmação Obrigatória */}
                <div className="p-5 rounded-2xl bg-white border-2 border-amber-300 space-y-4">
                  <h5 className="text-xs font-black uppercase tracking-wider text-gray-900 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-600" />
                    3. Confirmação Dupla de Segurança para Restaurar
                  </h5>

                  {/* Checkbox 1: Backup Automático Pré-Restauração */}
                  <label className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-xl bg-teal-50/70 border border-teal-200">
                    <input
                      type="checkbox"
                      checked={autoSafetyBackupBeforeRestore}
                      onChange={e => setAutoSafetyBackupBeforeRestore(e.target.checked)}
                      disabled={isRestoringBackup}
                      className="mt-0.5 w-4 h-4 rounded text-teal-600 focus:ring-teal-500"
                    />
                    <div className="text-xs">
                      <span className="font-bold text-teal-950 block">
                        Gerar e baixar automaticamente um Backup Completo de Segurança do estado atual antes de restaurar (Recomendado)
                      </span>
                      <span className="text-[11px] text-teal-800">
                        Salva automaticamente o arquivo <code className="font-mono">locapsico_backup_pre_restauracao_...json</code> no seu computador antes de aplicar a restauração.
                      </span>
                    </div>
                  </label>

                  {/* Checkbox 2: Ciência Obrigatória */}
                  <label className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-xl bg-amber-50/70 border border-amber-200">
                    <input
                      type="checkbox"
                      checked={restoreConfirmChecked}
                      onChange={e => setRestoreConfirmChecked(e.target.checked)}
                      disabled={isRestoringBackup}
                      className="mt-0.5 w-4 h-4 rounded text-amber-600 focus:ring-amber-500"
                    />
                    <span className="text-xs font-semibold text-gray-800 leading-relaxed">
                      Confirmo que verifiquei os metadados e quantidades de registros acima e desejo restaurar o banco de dados do LocaPsico para o estado deste <strong>Backup Completo</strong>.
                    </span>
                  </label>

                  {/* Palavra de Confirmação + Botão de Execução */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end pt-1">
                    <div>
                      <label className="block text-[11px] font-black text-gray-700 uppercase tracking-wider mb-1.5">
                        Digite <span className="text-amber-700 font-mono">RESTAURAR</span> para habilitar a execução:
                      </label>
                      <input
                        type="text"
                        value={restoreConfirmWord}
                        onChange={e => setRestoreConfirmWord(e.target.value)}
                        disabled={isRestoringBackup}
                        placeholder="Digite RESTAURAR"
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-300 rounded-2xl text-xs font-black uppercase tracking-widest text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={
                        isRestoringBackup ||
                        !restoreConfirmChecked ||
                        restoreConfirmWord.trim().toUpperCase() !== 'RESTAURAR'
                      }
                      onClick={handleExecuteSafeRestore}
                      className="w-full py-3.5 px-6 rounded-2xl bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2.5 shadow-md shadow-amber-600/20"
                    >
                      {isRestoringBackup ? (
                        <>
                          <RefreshCw size={16} className="animate-spin" />
                          <span>Restaurando Backup Completo...</span>
                        </>
                      ) : (
                        <>
                          <RotateCcw size={16} />
                          <span>Confirmar e Restaurar Sistema</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Erro durante a execução da restauração */}
            {restoreError && (
              <div className="p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-900 animate-fade-in">
                <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <span className="font-black block text-red-800 uppercase tracking-wider">
                    Não foi possível concluir a restauração
                  </span>
                  <p className="text-red-700 font-medium">{restoreError}</p>
                </div>
              </div>
            )}

            {/* Resultado da Última Restauração Concluída */}
            {lastRestoreResult && (
              <div className="p-6 rounded-3xl bg-emerald-50/80 border-2 border-emerald-300 space-y-4 animate-fade-in">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-200 pb-3">
                  <div className="flex items-center gap-2.5 text-emerald-950">
                    <CheckCircle2 size={22} className="text-emerald-600 shrink-0" />
                    <div>
                      <span className="text-xs font-black uppercase tracking-wider block">
                        Restauração de Backup Completo Concluída com Sucesso!
                      </span>
                      <span className="text-[11px] text-emerald-800 font-semibold block mt-0.5">
                        {lastRestoreResult.safetyBackupFileName
                          ? `Cópia preventiva salva antes da operação: ${lastRestoreResult.safetyBackupFileName}`
                          : 'Todos os relacionamentos e dados foram sincronizados e recarregados.'}
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-800 bg-white px-3 py-1 rounded-xl border border-emerald-200 self-start sm:self-auto">
                    {format(parseISO(lastRestoreResult.restoredAt), "dd/MM/yyyy 'às' HH:mm:ss")}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 text-xs">
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Perfis Restaurados</span>
                    <span className="text-base font-black text-gray-900">{lastRestoreResult.counts.profiles}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Profissionais</span>
                    <span className="text-base font-black text-gray-900">{lastRestoreResult.counts.professionals}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Pacientes</span>
                    <span className="text-base font-black text-gray-900">{lastRestoreResult.counts.clients}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Salas</span>
                    <span className="text-base font-black text-gray-900">{lastRestoreResult.counts.rooms}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Agendamentos</span>
                    <span className="text-base font-black text-gray-900">{lastRestoreResult.counts.bookings}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Pagamentos</span>
                    <span className="text-base font-black text-gray-900">{lastRestoreResult.counts.payments}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Bloqueios</span>
                    <span className="text-base font-black text-gray-900">{lastRestoreResult.counts.blocked_slots}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Configurações</span>
                    <span className="text-base font-black text-gray-900">{lastRestoreResult.counts.settings}</span>
                  </div>
                  <div className="p-3 bg-white rounded-2xl border border-emerald-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Logs Auditoria</span>
                    <span className="text-base font-black text-gray-900">{lastRestoreResult.counts.audit_logs}</span>
                  </div>
                  <div className="p-3 bg-emerald-600 text-white rounded-2xl">
                    <span className="text-[10px] font-black uppercase text-emerald-100 block">Total Restaurado</span>
                    <span className="text-base font-black">{lastRestoreResult.totalRestored} reg.</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= 10. MEU PERFIL DE ADMINISTRADOR ================= */}
      {activeTab === 'profile' && (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header do Perfil */}
          <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-teal-600 flex items-center justify-center text-white text-2xl font-black shadow-md shadow-teal-600/20">
                {adminName ? adminName.charAt(0).toUpperCase() : 'A'}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-black text-gray-900">{adminName || 'Administrador'}</h3>
                  <span className="bg-amber-100 text-amber-800 text-[10px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider">
                    <ShieldCheck size={12} /> Administrador Master
                  </span>
                </div>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  {currentUser?.email || 'admin@admin.com.br'} • Acesso Irrestrito à Gestão e Finanças
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-100">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Conta Ativa no Sistema
              </span>
            </div>
          </div>

          {/* Formulário de Edição */}
          <form onSubmit={handleSaveAdminProfile} className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-8">
            {/* Seção 1: Dados Cadastrais */}
            <div className="space-y-4">
              <div className="border-b border-gray-100 pb-3">
                <h4 className="text-sm font-black text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <UserCheck size={16} className="text-teal-600" /> Dados Pessoais & Contato
                </h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  Mantenha suas informações cadastrais atualizadas para registros em auditoria e relatórios
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <Input
                    label="Nome Completo *"
                    value={adminName}
                    onChange={e => setAdminName(e.target.value)}
                    placeholder="Ex: Administrador da Clínica"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1.5">
                    E-mail de Acesso (Login)
                  </label>
                  <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-600 flex items-center justify-between">
                    <span>{currentUser?.email || 'admin@admin.com.br'}</span>
                    <span className="text-[10px] uppercase font-black text-gray-400 bg-gray-200/60 px-2 py-0.5 rounded-md">
                      Principal
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">
                    O e-mail principal é utilizado para login no sistema.
                  </p>
                </div>

                <div>
                  <Input
                    label="CPF"
                    value={adminCpf}
                    onChange={e => setAdminCpf(e.target.value)}
                    placeholder="000.000.000-00"
                  />
                </div>

                <div>
                  <Input
                    label="Telefone / Celular"
                    value={adminPhone}
                    onChange={e => setAdminPhone(e.target.value)}
                    placeholder="(11) 98765-4321"
                  />
                </div>

                <div>
                  <Input
                    label="WhatsApp para Contato"
                    value={adminWhatsapp}
                    onChange={e => setAdminWhatsapp(e.target.value)}
                    placeholder="(11) 98765-4321"
                  />
                </div>
              </div>
            </div>

            {/* Seção 2: Alteração de Senha */}
            <div className="space-y-4 pt-4 border-t border-gray-100">
              <div className="border-b border-gray-100 pb-3">
                <h4 className="text-sm font-black text-gray-900 uppercase tracking-wider flex items-center gap-2">
                  <Lock size={16} className="text-teal-600" /> Segurança & Senha de Acesso
                </h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  Deixe os campos em branco se não desejar alterar a sua senha atual
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <PasswordInput
                    label="Nova Senha"
                    value={adminNewPassword}
                    onChange={e => setAdminNewPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres (A-Z, 0-9, símbolos)"
                    showStrengthMeter={true}
                  />
                </div>

                <div>
                  <PasswordInput
                    label="Confirmar Nova Senha"
                    value={adminConfirmPassword}
                    onChange={e => setAdminConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                  />
                </div>
              </div>
            </div>

            {/* Ações */}
            <div className="pt-4 border-t border-gray-100 flex flex-col sm:flex-row justify-end items-center gap-3">
              <Button
                type="submit"
                disabled={isSavingAdminProfile}
                className="w-full sm:w-auto px-8 py-3 text-xs flex items-center justify-center gap-2 shadow-md shadow-teal-600/20"
              >
                {isSavingAdminProfile ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Salvando Alterações...
                  </>
                ) : (
                  <>
                    <Check size={16} /> Salvar Alterações do Perfil
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Alteração de Pagamento */}
      <Modal
        isOpen={!!bookingToUpdatePayment}
        onClose={() => setBookingToUpdatePayment(null)}
        title="Atualizar Status de Pagamento"
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-600">
            Alterando pagamento da locação de{' '}
            <strong>{bookingToUpdatePayment?.userName}</strong> ({bookingToUpdatePayment?.roomId}, {bookingToUpdatePayment?.date}) no valor de{' '}
            <strong>R$ {bookingToUpdatePayment?.totalAmount.toFixed(2)}</strong>.
          </p>

          <div>
            <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
              Novo Status
            </label>
            <select
              value={newPaymentStatus}
              onChange={e => setNewPaymentStatus(e.target.value as PaymentStatus)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold"
            >
              <option value="PAID">Pago</option>
              <option value="PENDING">Pendente</option>
              <option value="CANCELLED">Cancelado</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
              Observações Administrativas
            </label>
            <textarea
              rows={2}
              value={paymentNotes}
              onChange={e => setPaymentNotes(e.target.value)}
              placeholder="Ex: Pago via PIX em 10/09"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold"
            />
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setBookingToUpdatePayment(null)}>
              Cancelar
            </Button>
            <Button disabled={isUpdatingPayment} onClick={handleSavePaymentStatus}>
              {isUpdatingPayment ? 'Salvando...' : 'Confirmar Alteração'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal de Criação de Bloqueio */}
      <Modal
        isOpen={isBlockModalOpen}
        onClose={() => setIsBlockModalOpen(false)}
        title={blockType === 'FULL_DAY' ? 'Bloquear Dia Completo (Feriado / Recesso)' : 'Bloquear Faixa de Horários'}
      >
        <form onSubmit={handleCreateBlock} className="space-y-4">
          {/* Seletor de Tipo: Dia Inteiro vs Horários */}
          <div className="grid grid-cols-2 gap-2 p-1.5 bg-gray-100 rounded-2xl">
            <button
              type="button"
              onClick={() => {
                setBlockType('FULL_DAY');
                setBlockRoom('ALL');
                if (!blockReason) setBlockReason('Feriado Nacional / Recesso');
              }}
              className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                blockType === 'FULL_DAY'
                  ? 'bg-amber-600 text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Palmtree size={14} /> Dia Inteiro (Feriado)
            </button>
            <button
              type="button"
              onClick={() => setBlockType('HOURS')}
              className={`py-2 px-3 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                blockType === 'HOURS'
                  ? 'bg-teal-600 text-white shadow-xs'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Clock size={14} /> Horário Específico
            </button>
          </div>

          <div>
            <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
              Abrangência da Sala
            </label>
            <select
              value={blockRoom}
              onChange={e => setBlockRoom(e.target.value as RoomId | 'ALL')}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold"
            >
              <option value="ALL">Todas as Salas (Clínica Toda — Ideal para Feriados)</option>
              <option value="Sala 1">Apenas Sala 1</option>
              <option value="Sala 2">Apenas Sala 2</option>
            </select>
          </div>

          <div>
            <Input
              label="Data do Bloqueio"
              type="date"
              value={blockDate}
              onChange={e => setBlockDate(e.target.value)}
              required
            />
            <span className="text-[10px] text-gray-400 font-medium block mt-1">
              * A clínica já não abre aos domingos (fechamento padrão). Aos sábados fecha às 14h.
            </span>
          </div>

          {blockType === 'FULL_DAY' ? (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs space-y-1.5">
              <div className="flex items-center gap-2 text-amber-900 font-bold">
                <Palmtree size={15} className="text-amber-700" />
                <span>Bloqueio do Dia Inteiro Selecionado</span>
              </div>
              <p className="text-gray-600 text-[11px] leading-relaxed">
                Nenhum terapeuta poderá agendar horários nesta data. O bloqueio cobrirá o expediente integral (07:00 às {
                  blockDate && new Date(Number(blockDate.split('-')[0]), Number(blockDate.split('-')[1]) - 1, Number(blockDate.split('-')[2])).getDay() === 6 ? '14:00' : '22:00'
                }).
              </p>
            </div>
          ) : (
            /* Seletor dinâmico baseado na data (Sábado até 14h) */
            (() => {
              const blockDayOfWeek = blockDate ? new Date(Number(blockDate.split('-')[0]), Number(blockDate.split('-')[1]) - 1, Number(blockDate.split('-')[2])).getDay() : 1;
              const maxBlockHour = getClosingHourForDate(blockDayOfWeek) || 22;
              const startHourOptions = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].filter(h => h < maxBlockHour);
              const endHourOptions = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].filter(h => h <= maxBlockHour && h > blockStartHour);

              return (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
                      Horário Inicial
                    </label>
                    <select
                      value={blockStartHour}
                      onChange={e => setBlockStartHour(Number(e.target.value))}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold"
                    >
                      {startHourOptions.map(h => (
                        <option key={h} value={h}>{h}:00</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
                      Horário Final
                    </label>
                    <select
                      value={blockEndHour}
                      onChange={e => setBlockEndHour(Number(e.target.value))}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold"
                    >
                      {endHourOptions.map(h => (
                        <option key={h} value={h}>{h}:00</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })()
          )}

          <div>
            <Input
              label="Motivo do Bloqueio *"
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              placeholder="Ex: Feriado Nacional, Tiradentes, Manutenção, Limpeza..."
              required
            />
            {/* Atalhos de motivos frequentes */}
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mr-1">Sugestões:</span>
              {[
                'Feriado Nacional',
                'Feriado Municipal',
                'Recesso de Fim de Ano',
                'Emenda de Feriado',
                'Manutenção / Reforma'
              ].map(sug => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => setBlockReason(sug)}
                  className="px-2.5 py-1 bg-gray-100 hover:bg-amber-100 hover:text-amber-900 text-gray-600 rounded-lg text-[10px] font-bold transition-colors"
                >
                  + {sug}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setIsBlockModalOpen(false)}>
              Cancelar
            </Button>
            <Button 
              type="submit" 
              disabled={isCreatingBlock}
              className={blockType === 'FULL_DAY' ? 'bg-amber-600 hover:bg-amber-700 text-white border-amber-600' : ''}
            >
              {isCreatingBlock ? 'Salvando...' : blockType === 'FULL_DAY' ? 'Bloquear Dia Inteiro' : 'Salvar Bloqueio'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Edição de Tarifas da Sala */}
      <Modal
        isOpen={!!editingRoom}
        onClose={() => setEditingRoom(null)}
        title={`Editar Tarifas por Períodos — ${editingRoom?.id}`}
      >
        <div className="space-y-4">
          <div>
            <Input
              label="Valor da Hora Avulsa (R$)"
              type="number"
              value={editHourlyRate.toString()}
              onChange={e => setEditHourlyRate(Number(e.target.value))}
            />
          </div>

          <div className="pt-2 border-t border-gray-100">
            <h4 className="text-xs font-black uppercase tracking-wider text-teal-800 mb-3">
              Valores por Período (Turnos)
            </h4>
            
            <div className="space-y-3">
              <div>
                <Input
                  label="Período Manhã (07:00 às 12:00 — 5h) (R$)"
                  type="number"
                  value={editMorningRate.toString()}
                  onChange={e => setEditMorningRate(Number(e.target.value))}
                />
              </div>

              <div>
                <Input
                  label="Período Tarde (12:00 às 18:00 — 6h) (R$)"
                  type="number"
                  value={editAfternoonRate.toString()}
                  onChange={e => setEditAfternoonRate(Number(e.target.value))}
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  * Aos sábados a clínica encerra às 14:00 (proporcional calculado automaticamente).
                </p>
              </div>

              <div>
                <Input
                  label="Período Noite (18:00 às 22:00 — 4h) (R$)"
                  type="number"
                  value={editNightRate.toString()}
                  onChange={e => setEditNightRate(Number(e.target.value))}
                />
              </div>

              <div className="pt-2 border-t border-gray-100">
                <Input
                  label="Período de 1 Dia (07:00 às 22:00 — 15h) (R$)"
                  type="number"
                  value={editDailyRate.toString()}
                  onChange={e => setEditDailyRate(Number(e.target.value))}
                />
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mt-1">
                  <p className="text-[10px] text-gray-400">
                    * Tarifa para locação de 1 dia integral (15h consecutivas).
                  </p>
                  <button
                    type="button"
                    onClick={() => setEditDailyRate(editMorningRate + editAfternoonRate + editNightRate)}
                    className="text-[10px] font-bold text-teal-600 hover:text-teal-700 underline text-left"
                  >
                    Usar soma dos 3 turnos (R$ {(editMorningRate + editAfternoonRate + editNightRate).toFixed(2)})
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Resumo Dinâmico dos Períodos */}
          <div className="p-3.5 bg-teal-50 border border-teal-100 rounded-2xl text-xs space-y-2">
            <span className="font-black text-teal-900 block text-[11px] uppercase tracking-wider">
              Resumo da Cobrança por Turno & 1 Dia:
            </span>
            <div className="grid grid-cols-3 gap-2 text-gray-700 text-[11px]">
              <div>Manhã (5h): <strong className="text-teal-900 block">R$ {editMorningRate.toFixed(2)}</strong></div>
              <div>Tarde (6h): <strong className="text-teal-900 block">R$ {editAfternoonRate.toFixed(2)}</strong></div>
              <div>Noite (4h): <strong className="text-teal-900 block">R$ {editNightRate.toFixed(2)}</strong></div>
            </div>
            <div className="pt-2 border-t border-teal-200/60 flex justify-between items-center font-black text-teal-900 text-xs">
              <span>Período de 1 Dia (15h):</span>
              <span className="text-sm text-teal-700">R$ {editDailyRate.toFixed(2)}</span>
            </div>
          </div>

          <p className="text-[11px] text-gray-500 italic">
            * As reservas criadas anteriormente manterão o valor original contratado.
          </p>

          <div className="pt-2 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setEditingRoom(null)}>
              Cancelar
            </Button>
            <Button disabled={isUpdatingRates} onClick={handleSaveRoomRates}>
              {isUpdatingRates ? 'Salvando...' : 'Salvar Tarifas'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal de Confirmação: Excluir Profissional do App */}
      <Modal
        isOpen={!!userPendingDeletion}
        onClose={() => setUserPendingDeletion(null)}
        title="Excluir Profissional do Aplicativo"
      >
        <div className="space-y-5">
          <div className="p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-900">
            <AlertTriangle className="shrink-0 text-red-600 mt-0.5" size={20} />
            <div className="text-xs space-y-1 leading-relaxed">
              <p className="font-black text-sm text-red-800">
                Atenção: Ação Irreversível
              </p>
              <p>
                Você está prestes a excluir permanentemente a conta de <strong className="font-black">{userPendingDeletion?.name}</strong> ({userPendingDeletion?.email}) do aplicativo.
              </p>
            </div>
          </div>

          <div className="text-xs text-gray-600 space-y-2 bg-gray-50 p-4 rounded-2xl border border-gray-100">
            <p className="font-bold text-gray-900">Impactos da exclusão:</p>
            <ul className="list-disc list-inside space-y-1 text-gray-600">
              <li>O profissional perderá imediatamente o acesso ao sistema.</li>
              <li>Todas as credenciais de login serão permanentemente deletadas.</li>
              <li>A ação será registrada na trilha de auditoria para fins de segurança.</li>
            </ul>
          </div>

          <label className="flex items-start gap-3 p-3 rounded-2xl border border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors">
            <input
              type="checkbox"
              checked={deleteConfirmCheckbox}
              onChange={e => setDeleteConfirmCheckbox(e.target.checked)}
              className="mt-0.5 rounded text-red-600 focus:ring-red-500"
            />
            <span className="text-xs font-bold text-gray-800">
              Confirmo que desejo excluir definitivamente este profissional do LocaPsico.
            </span>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="secondary"
              onClick={() => setUserPendingDeletion(null)}
              disabled={isDeletingUser}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={!deleteConfirmCheckbox || isDeletingUser}
              onClick={handleConfirmDeleteUser}
              className="flex items-center gap-2"
            >
              <Trash2 size={16} />
              {isDeletingUser ? 'Excluindo...' : 'Sim, Excluir Profissional'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
