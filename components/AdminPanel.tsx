import React, { useState, useEffect, useMemo } from 'react';
import { Booking, User, RoomId, Room, BlockedSlot, AuditLog, SystemConfig, PaymentStatus } from '../types';
import { bookingService } from '../services/bookingService';
import { authService } from '../services/authService';
import { clientService } from '../services/clientService';
import { getStoredAuditLogs, getSystemConfig, saveSystemConfig } from '../services/storageService';
import { INITIAL_HOURLY_RATE, INITIAL_DAILY_RATE, getClosingHourForDate, SATURDAY_HOURS_END } from '../constants';
import { Button } from './Button';
import { Modal } from './Modal';
import { Input } from './Input';
import { format, parseISO, addDays, isToday, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';
import { 
  LayoutDashboard, Calendar as CalendarIcon, Users, 
  DollarSign, FileText, Ban, Settings, ShieldAlert, 
  Search, CheckCircle2, XCircle, Trash2, Edit2, 
  Download, Plus, RefreshCw, Clock, ArrowRight, Lock,
  UserX, AlertTriangle, KeyRound, Copy, Eye, EyeOff, MessageCircle
} from 'lucide-react';
import { useToast } from './Toast';
import { checkPasswordStrength } from '../utils/passwordSecurity';
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
  | 'audit';

interface AdminPanelProps {
  currentUser?: User | null;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ currentUser }) => {
  const adminActor: User = useMemo(() => {
    return currentUser || {
      id: 'admin',
      name: 'Administrador',
      email: '',
      role: 'ADMIN',
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    };
  }, [currentUser]);
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
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
  const [blockRoom, setBlockRoom] = useState<RoomId | 'ALL'>('Sala 1');
  const [blockDate, setBlockDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [blockStartHour, setBlockStartHour] = useState<number>(8);
  const [blockEndHour, setBlockEndHour] = useState<number>(12);
  const [blockReason, setBlockReason] = useState<string>('');
  const [isCreatingBlock, setIsCreatingBlock] = useState(false);

  // Edit Room Modal
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [editHourlyRate, setEditHourlyRate] = useState<number>(40);
  const [editDailyRate, setEditDailyRate] = useState<number>(350);
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

  const { addToast } = useToast();

  const loadAdminData = async () => {
    setIsLoading(true);
    try {
      const [allBookings, allProfiles, allRooms, allBlocks] = await Promise.all([
        bookingService.getAllBookingsWithCancelled(),
        authService.getAllProfiles(),
        bookingService.getRooms(),
        bookingService.getBlockedSlots()
      ]);

      setBookings(allBookings);
      setUsers(allProfiles);
      setRooms(allRooms);
      setBlocks(allBlocks);
      setAuditLogs(getStoredAuditLogs());
      setConfig(getSystemConfig());
    } catch (err: any) {
      addToast('Erro ao carregar painel administrativo.', 'error');
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

  // Selected Professional Summary
  const selectedProfStats = useMemo(() => {
    if (selectedProfId === 'ALL') return null;
    const profBookings = filteredFinancialBookings.filter(b => b.paymentStatus !== 'CANCELLED');
    const totalDue = profBookings.reduce((sum, b) => sum + b.totalAmount, 0);
    const totalPaid = profBookings.filter(b => b.paymentStatus === 'PAID').reduce((sum, b) => sum + b.totalAmount, 0);
    const totalHours = profBookings.reduce((sum, b) => sum + (b.durationHours || 1), 0);
    const profObj = users.find(u => u.id === selectedProfId);

    return {
      name: profObj?.name || 'Profissional',
      count: profBookings.length,
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

  const handleCreateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockReason.trim()) return addToast('Informe o motivo do bloqueio.', 'error');
    if (blockStartHour >= blockEndHour) return addToast('O horário final deve ser maior que o inicial.', 'error');

    if (blockDate) {
      const [y, m, d] = blockDate.split('-').map(Number);
      const dayOfWeek = new Date(y, m - 1, d).getDay();
      if (dayOfWeek === 0) {
        return addToast('As salas já estão fechadas aos domingos.', 'warning');
      }
      const maxHour = getClosingHourForDate(dayOfWeek);
      if (blockEndHour > maxHour || blockStartHour >= maxHour) {
        return addToast(
          dayOfWeek === 6 
            ? 'Aos sábados o horário de funcionamento vai apenas até as 14:00.' 
            : `O horário de funcionamento neste dia encerra às ${maxHour}:00.`, 
          'warning'
        );
      }
    }

    setIsCreatingBlock(true);
    try {
      await bookingService.createBlockedSlot({
        roomId: blockRoom,
        date: blockDate,
        startHour: blockStartHour,
        endHour: blockEndHour,
        reason: blockReason,
        createdBy: adminActor.name || 'Administração'
      }, adminActor);

      addToast('Bloqueio cadastrado com sucesso!', 'success');
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
    setEditDailyRate(room.dailyRate);
  };

  const handleSaveRoomRates = async () => {
    if (!editingRoom) return;
    setIsUpdatingRates(true);
    try {
      await bookingService.updateRoomRates(
        editingRoom.id,
        editHourlyRate,
        editDailyRate,
        adminActor
      );
      addToast(`Valores da ${editingRoom.id} atualizados com sucesso!`, 'success');
      setEditingRoom(null);
      await loadAdminData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao atualizar tarifas.', 'error');
    } finally {
      setIsUpdatingRates(false);
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

  // Exportar Relatório em PDF
  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('LocaPsico — Relatório Administrativo Mensal', 14, 20);
    doc.setFontSize(11);
    doc.text(`Mês de Referência: ${selectedMonth}`, 14, 28);
    doc.text(`Total Faturado: R$ ${totalMonthlyRevenue.toFixed(2)} | Recebido: R$ ${totalMonthlyPaid.toFixed(2)} | Pendente: R$ ${totalMonthlyPending.toFixed(2)}`, 14, 34);

    const rows = filteredFinancialBookings.map(b => [
      format(parseISO(b.date), 'dd/MM/yyyy'),
      b.roomId,
      b.userName || 'N/A',
      b.clientName || 'N/A',
      `${b.hour}:00 - ${b.endTimeHour}:00`,
      `${b.durationHours}h`,
      `R$ ${b.totalAmount.toFixed(2)}`,
      b.paymentStatus === 'PAID' ? 'Pago' : b.paymentStatus === 'CANCELLED' ? 'Cancelado' : 'Pendente'
    ]);

    autoTable(doc, {
      startY: 42,
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
          { id: 'audit', label: 'Auditoria', icon: ShieldAlert }
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

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="bg-white p-4 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Tarifa por Hora</span>
                    <span className="text-xl font-black text-teal-600">R$ {room.hourlyRate.toFixed(2)}</span>
                  </div>
                  <div className="bg-white p-4 rounded-2xl border border-gray-100">
                    <span className="text-[10px] font-black uppercase text-gray-400 block">Tarifa Período (15h)</span>
                    <span className="text-xl font-black text-teal-600">R$ {room.dailyRate.toFixed(2)}</span>
                  </div>
                </div>

                <Button
                  onClick={() => handleOpenRoomModal(room)}
                  className="w-full flex items-center justify-center gap-2 text-xs"
                >
                  <Edit2 size={14} /> Editar Valores da {room.id}
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

            {/* Painel do Profissional Selecionado (Seção 14) */}
            {selectedProfStats && (
              <div className="p-5 bg-teal-50 border border-teal-100 rounded-2xl flex flex-wrap justify-between items-center gap-4 text-xs">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-teal-600 block">
                    Profissional Selecionado
                  </span>
                  <span className="text-base font-black text-gray-900">{selectedProfStats.name}</span>
                </div>
                <div className="flex gap-6">
                  <div>
                    <span className="text-gray-400 block text-[10px] font-bold uppercase">Locações</span>
                    <span className="font-black text-gray-900">{selectedProfStats.count} ({selectedProfStats.hours}h)</span>
                  </div>
                  <div>
                    <span className="text-gray-400 block text-[10px] font-bold uppercase">Total Devido</span>
                    <span className="font-black text-gray-900">R$ {selectedProfStats.totalDue.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-emerald-600 block text-[10px] font-bold uppercase">Total Pago</span>
                    <span className="font-black text-emerald-700">R$ {selectedProfStats.totalPaid.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-amber-600 block text-[10px] font-bold uppercase">Saldo Devedor</span>
                    <span className="font-black text-amber-700">R$ {selectedProfStats.balance.toFixed(2)}</span>
                  </div>
                </div>
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
                  {filteredFinancialBookings.map(b => (
                    <tr key={b.id} className="hover:bg-gray-50/50">
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
                      <td className="py-4 px-6 text-right font-black text-gray-900">
                        R$ {b.totalAmount.toFixed(2)}
                      </td>
                      <td className="py-4 px-6 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          b.paymentStatus === 'PAID'
                            ? 'bg-emerald-100 text-emerald-800'
                            : b.paymentStatus === 'CANCELLED'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {b.paymentStatus === 'PAID' ? 'Pago' : b.paymentStatus === 'CANCELLED' ? 'Cancelado' : 'Pendente'}
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
                  ))}
                </tbody>
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
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-xl font-black text-gray-900">Bloqueios Administrativos</h3>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                Bloqueie horários por manutenção, limpeza, reuniões ou feriados
              </p>
            </div>
            <Button onClick={() => setIsBlockModalOpen(true)} className="flex items-center gap-1.5 text-xs">
              <Plus size={14} /> Novo Bloqueio
            </Button>
          </div>

          {blocks.length === 0 ? (
            <p className="text-xs text-gray-400 italic py-8 text-center">
              Nenhum bloqueio administrativo ativo no momento.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {blocks.map(b => (
                <div key={b.id} className="p-5 rounded-2xl border border-amber-200 bg-amber-50/50 flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-xs text-amber-900">{b.roomId === 'ALL' ? 'Todas as Salas' : b.roomId}</span>
                      <span className="text-[10px] bg-amber-200/60 text-amber-800 px-2 py-0.5 rounded font-black">
                        {format(parseISO(b.date), 'dd/MM/yyyy')}
                      </span>
                    </div>
                    <p className="text-xs font-bold text-amber-800 mt-1">
                      Horário: {b.startHour}:00 às {b.endHour}:00
                    </p>
                    <p className="text-[11px] text-amber-700 mt-0.5 italic">
                      Motivo: {b.reason}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteBlock(b.id)}
                    className="p-2 text-red-500 hover:bg-red-100 rounded-xl transition-colors"
                    title="Desativar Bloqueio"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================= 8. CONFIGURAÇÕES (Seção 29) ================= */}
      {activeTab === 'settings' && (
        <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm max-w-2xl mx-auto space-y-6">
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
        title="Criar Bloqueio de Horário"
      >
        <form onSubmit={handleCreateBlock} className="space-y-4">
          <div>
            <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-1">
              Sala a Bloquear
            </label>
            <select
              value={blockRoom}
              onChange={e => setBlockRoom(e.target.value as RoomId | 'ALL')}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold"
            >
              <option value="Sala 1">Sala 1</option>
              <option value="Sala 2">Sala 2</option>
              <option value="ALL">Todas as Salas (Clínica Toda)</option>
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
              Nota: As salas já não funcionam aos domingos (fechamento automático).
            </span>
          </div>

          {/* Seletor dinâmico baseado na data (Sábado até 14h) */}
          {(() => {
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
          })()}

          <Input
            label="Motivo do Bloqueio *"
            value={blockReason}
            onChange={e => setBlockReason(e.target.value)}
            placeholder="Ex: Manutenção do ar condicionado, limpeza, reunião..."
            required
          />

          <div className="pt-2 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setIsBlockModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isCreatingBlock}>
              {isCreatingBlock ? 'Bloqueando...' : 'Salvar Bloqueio'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Edição de Tarifas da Sala */}
      <Modal
        isOpen={!!editingRoom}
        onClose={() => setEditingRoom(null)}
        title={`Editar Tarifas — ${editingRoom?.id}`}
      >
        <div className="space-y-4">
          <Input
            label="Novo Valor por Hora (R$)"
            type="number"
            value={editHourlyRate.toString()}
            onChange={e => setEditHourlyRate(Number(e.target.value))}
          />

          <Input
            label="Novo Valor do Período Integral (07h às 22h) (R$)"
            type="number"
            value={editDailyRate.toString()}
            onChange={e => setEditDailyRate(Number(e.target.value))}
          />

          <p className="text-[11px] text-gray-500 italic">
            * Importante: as reservas criadas anteriormente manterão o valor original contratado.
          </p>

          <div className="pt-2 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setEditingRoom(null)}>
              Cancelar
            </Button>
            <Button disabled={isUpdatingRates} onClick={handleSaveRoomRates}>
              {isUpdatingRates ? 'Salvando...' : 'Salvar Novos Valores'}
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
