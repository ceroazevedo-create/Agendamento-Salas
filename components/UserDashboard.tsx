import React, { useState, useEffect, useMemo } from 'react';
import { Booking, User, Client } from '../types';
import { bookingService } from '../services/bookingService';
import { authService } from '../services/authService';
import { clientService } from '../services/clientService';
import { 
  format, parseISO, isAfter, isBefore, startOfMonth, 
  endOfMonth, isSameMonth, subMonths, addMonths 
} from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';
import { Button } from './Button';
import { Input } from './Input';
import { PasswordInput } from './PasswordInput';
import { Modal } from './Modal';
import { getPasswordValidationMessage } from '../utils/passwordSecurity';
import { 
  TrendingUp, Clock, DollarSign, AlertCircle, 
  CheckCircle2, Calendar as CalendarIcon, User as UserIcon, 
  Search, Filter, Ban, FileText, Download, Lock, ShieldCheck, Phone
} from 'lucide-react';
import { useToast } from './Toast';

interface UserDashboardProps {
  user: User;
  initialTab?: 'overview' | 'bookings' | 'billing' | 'profile';
  onNavigateToCalendar?: () => void;
}

export const UserDashboard: React.FC<UserDashboardProps> = ({ 
  user, 
  initialTab = 'overview',
  onNavigateToCalendar 
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'bookings' | 'billing' | 'profile'>(initialTab);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters for Bookings Tab
  const [filterMonth, setFilterMonth] = useState<string>(format(new Date(), 'yyyy-MM'));
  const [filterRoom, setFilterRoom] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [searchClient, setSearchClient] = useState<string>('');

  // Profile Form
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone || '');
  const [whatsapp, setWhatsapp] = useState(user.whatsapp || '');
  const [councilRegistration, setCouncilRegistration] = useState(user.councilRegistration || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Cancellation Modal
  const [bookingToCancel, setBookingToCancel] = useState<Booking | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const { addToast } = useToast();

  const loadUserData = async () => {
    setIsLoading(true);
    try {
      const [allMyBookings, myClients] = await Promise.all([
        bookingService.getBookingsByProfessional(user.id),
        clientService.getClientsByProfessional(user.id)
      ]);
      setBookings(allMyBookings);
      setClients(myClients);
    } catch (err: any) {
      addToast('Erro ao carregar dados do profissional.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUserData();
  }, [user.id]);

  useEffect(() => {
    setActiveTab(initialTab);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [initialTab]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [activeTab]);

  // Current Month Calculations (Setembro 2026 / Mês Atual)
  const currentMonthDate = new Date();
  const currentMonthStr = format(currentMonthDate, 'yyyy-MM');

  const currentMonthBookings = useMemo(() => {
    return bookings.filter(b => b.date.startsWith(currentMonthStr) && b.paymentStatus !== 'CANCELLED');
  }, [bookings, currentMonthStr]);

  const monthHours = useMemo(() => {
    return currentMonthBookings.reduce((sum, b) => sum + (b.durationHours || 1), 0);
  }, [currentMonthBookings]);

  const monthSpent = useMemo(() => {
    return currentMonthBookings.reduce((sum, b) => sum + b.totalAmount, 0);
  }, [currentMonthBookings]);

  const monthPending = useMemo(() => {
    return currentMonthBookings
      .filter(b => b.paymentStatus === 'PENDING')
      .reduce((sum, b) => sum + b.totalAmount, 0);
  }, [currentMonthBookings]);

  const monthPaid = useMemo(() => {
    return currentMonthBookings
      .filter(b => b.paymentStatus === 'PAID')
      .reduce((sum, b) => sum + b.totalAmount, 0);
  }, [currentMonthBookings]);

  // Next Upcoming Appointment (Hoje ou Futuro)
  const nextAppointment = useMemo(() => {
    const now = new Date();
    const activeFuture = bookings
      .filter(b => b.paymentStatus !== 'CANCELLED')
      .filter(b => {
        const bDate = new Date(`${b.date}T${b.hour.toString().padStart(2, '0')}:00:00`);
        return isAfter(bDate, now);
      })
      .sort((a, b) => {
        const da = new Date(`${a.date}T${a.hour.toString().padStart(2, '0')}:00:00`).getTime();
        const db = new Date(`${b.date}T${b.hour.toString().padStart(2, '0')}:00:00`).getTime();
        return da - db;
      });

    return activeFuture[0] || null;
  }, [bookings]);

  // Filtered Bookings for the "Minhas Locações" Table
  const filteredBookings = useMemo(() => {
    return bookings.filter(b => {
      if (filterMonth && !b.date.startsWith(filterMonth)) return false;
      if (filterRoom !== 'ALL' && b.roomId !== filterRoom) return false;
      if (filterStatus !== 'ALL' && b.paymentStatus !== filterStatus) return false;
      if (searchClient) {
        const term = searchClient.toLowerCase();
        const clientMatch = b.clientName && b.clientName.toLowerCase().includes(term);
        if (!clientMatch) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [bookings, filterMonth, filterRoom, filterStatus, searchClient]);

  // Selected Month Breakdown for "Meus Consumos" Tab
  const billingMonthBookings = useMemo(() => {
    return bookings.filter(b => b.date.startsWith(filterMonth) && b.paymentStatus !== 'CANCELLED');
  }, [bookings, filterMonth]);

  const billingTotalHours = useMemo(() => {
    return billingMonthBookings.reduce((sum, b) => sum + (b.durationHours || 1), 0);
  }, [billingMonthBookings]);

  const billingTotalAmount = useMemo(() => {
    return billingMonthBookings.reduce((sum, b) => sum + b.totalAmount, 0);
  }, [billingMonthBookings]);

  const billingTotalPaid = useMemo(() => {
    return billingMonthBookings
      .filter(b => b.paymentStatus === 'PAID')
      .reduce((sum, b) => sum + b.totalAmount, 0);
  }, [billingMonthBookings]);

  const billingTotalPending = useMemo(() => {
    return billingMonthBookings
      .filter(b => b.paymentStatus === 'PENDING')
      .reduce((sum, b) => sum + b.totalAmount, 0);
  }, [billingMonthBookings]);

  const mostUsedRoom = useMemo(() => {
    if (billingMonthBookings.length === 0) return 'Nenhuma';
    let sala1 = 0;
    let sala2 = 0;
    billingMonthBookings.forEach(b => {
      if (b.roomId === 'Sala 1') sala1 += (b.durationHours || 1);
      else sala2 += (b.durationHours || 1);
    });
    return sala1 >= sala2 ? 'Sala 1' : 'Sala 2';
  }, [billingMonthBookings]);

  // Monthly Evolution Data (Últimos 4 meses)
  const monthlyChartData = useMemo(() => {
    const months = [3, 2, 1, 0].map(diff => {
      const d = subMonths(new Date(), diff);
      const mStr = format(d, 'yyyy-MM');
      const mLabel = format(d, 'MMMM', { locale: ptBR });
      const total = bookings
        .filter(b => b.date.startsWith(mStr) && b.paymentStatus !== 'CANCELLED')
        .reduce((sum, b) => sum + b.totalAmount, 0);
      return { monthStr: mStr, label: mLabel, total };
    });
    return months;
  }, [bookings]);

  // Handle Cancel Booking
  const confirmCancel = async () => {
    if (!bookingToCancel) return;
    setIsCancelling(true);
    try {
      await bookingService.cancelBooking(bookingToCancel.id, {
        id: user.id,
        name: user.name,
        role: user.role
      });
      addToast('Locação cancelada com sucesso.', 'success');
      setBookingToCancel(null);
      await loadUserData();
    } catch (err: any) {
      addToast(err.message || 'Erro ao cancelar locação.', 'error');
    } finally {
      setIsCancelling(false);
    }
  };

  // Handle Profile Update
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsUpdatingProfile(true);
    try {
      await authService.updateProfile(user.id, {
        name,
        phone,
        whatsapp,
        councilRegistration
      });

      if (newPassword.trim()) {
        const passValidationError = getPasswordValidationMessage(newPassword.trim());
        if (passValidationError) {
          throw new Error(passValidationError);
        }
        if (newPassword !== confirmPassword) throw new Error('As senhas digitadas não coincidem.');
        await authService.updatePassword(newPassword.trim(), user.id);
        setNewPassword('');
        setConfirmPassword('');
      }

      addToast('Perfil atualizado com sucesso!', 'success');
    } catch (err: any) {
      addToast(err.message || 'Erro ao atualizar perfil.', 'error');
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Sub-Navigation Tabs */}
      <div className="bg-white rounded-3xl p-2 border border-gray-100 shadow-sm flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 min-w-[120px] py-2.5 px-4 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
            activeTab === 'overview'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Início
        </button>
        <button
          onClick={() => setActiveTab('bookings')}
          className={`flex-1 min-w-[120px] py-2.5 px-4 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
            activeTab === 'bookings'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Minhas Locações
        </button>
        <button
          onClick={() => setActiveTab('billing')}
          className={`flex-1 min-w-[120px] py-2.5 px-4 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
            activeTab === 'billing'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Meus Consumos
        </button>
        <button
          onClick={() => setActiveTab('profile')}
          className={`flex-1 min-w-[120px] py-2.5 px-4 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
            activeTab === 'profile'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          Meu Perfil
        </button>
      </div>

      {/* ================= TAB 1: VISÃO GERAL (Seção 17) ================= */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Header Card com Saudação */}
          <div className="bg-gradient-to-br from-teal-700 via-teal-800 to-emerald-900 rounded-3xl p-8 text-white shadow-md relative overflow-hidden">
            <div className="relative z-10 max-w-2xl">
              <span className="bg-white/20 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full backdrop-blur-sm">
                Portal do Profissional
              </span>
              <h2 className="text-2xl lg:text-3xl font-black tracking-tight mt-3">
                Olá, {user.name}!
              </h2>
              <p className="text-teal-100 text-xs mt-1 font-medium">
                {user.profession || 'Profissional de Saúde'} {user.councilRegistration ? `— ${user.councilRegistration}` : ''}
              </p>
            </div>

            {/* Próximo Atendimento (Seção 17) */}
            <div className="mt-6 pt-6 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-teal-200 block">
                  Próximo Atendimento Agendado:
                </span>
                {nextAppointment ? (
                  <p className="text-sm font-bold text-white mt-0.5">
                    {nextAppointment.roomId} — {format(parseISO(nextAppointment.date), "dd/MM 'às' HH:00", { locale: ptBR })}
                    {nextAppointment.clientName ? ` (${nextAppointment.clientName})` : ''}
                  </p>
                ) : (
                  <p className="text-xs text-teal-200 mt-0.5 italic">
                    Nenhum atendimento agendado para as próximas horas.
                  </p>
                )}
              </div>

              {onNavigateToCalendar && (
                <button
                  type="button"
                  onClick={onNavigateToCalendar}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white text-teal-900 hover:bg-teal-50 font-black text-xs uppercase tracking-wider shadow-md hover:shadow-lg transition-all active:scale-95 self-start sm:self-auto shrink-0 cursor-pointer"
                >
                  <CalendarIcon size={16} className="text-teal-700" />
                  <span>Abrir Agenda</span>
                </button>
              )}
            </div>
          </div>

          {/* 4 Cards de Métricas Principais (Seção 17) */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                Locações este mês
              </span>
              <span className="text-3xl font-black text-gray-900 block">
                {currentMonthBookings.length}
              </span>
              <span className="text-[10px] font-bold text-teal-600 mt-1 block">
                Setembro/2026
              </span>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                Horas utilizadas
              </span>
              <span className="text-3xl font-black text-gray-900 block">
                {monthHours}h
              </span>
              <span className="text-[10px] font-bold text-teal-600 mt-1 block">
                Salas 1 e 2
              </span>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                Gasto este mês
              </span>
              <span className="text-3xl font-black text-teal-600 block">
                R$ {monthSpent.toFixed(0)}
              </span>
              <span className="text-[10px] font-bold text-gray-400 mt-1 block">
                Total acumulado
              </span>
            </div>

            <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 block mb-1">
                Pendências
              </span>
              <span className="text-3xl font-black text-amber-600 block">
                R$ {monthPending.toFixed(0)}
              </span>
              <span className="text-[10px] font-bold text-amber-600/80 mt-1 block">
                Aguardando acerto
              </span>
            </div>
          </div>

          {/* Atendimentos Recentes / Próximos */}
          <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-base font-black text-gray-900">Suas Próximas Locações</h3>
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                  Visualização rápida dos horários reservados
                </p>
              </div>
              <button
                onClick={() => setActiveTab('bookings')}
                className="text-xs font-black text-teal-600 hover:underline uppercase tracking-wider"
              >
                Ver Todas →
              </button>
            </div>

            {bookings.length === 0 ? (
              <div className="p-8 text-center bg-gray-50 rounded-2xl">
                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">
                  Sua agenda está livre. Clique em um horário disponível para fazer uma locação.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {bookings.slice(0, 4).map(b => (
                  <div
                    key={b.id}
                    className="p-4 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-xs text-gray-900">{b.roomId}</span>
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                          b.paymentStatus === 'PAID' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {b.paymentStatus === 'PAID' ? 'Pago' : 'Pendente'}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-teal-700 mt-1">
                        {format(parseISO(b.date), "dd/MM/yyyy", { locale: ptBR })} — {b.hour}:00 às {b.endTimeHour}:00 ({b.durationHours}h{b.type === 'PERIOD' ? ` • ${b.periodName || 'Período'}` : ''})
                      </p>
                      {b.clientName && (
                        <p className="text-[11px] text-gray-500 mt-0.5">
                          Paciente: {b.clientName}
                        </p>
                      )}
                    </div>
                    <span className="text-base font-black text-gray-900">
                      R$ {b.totalAmount.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= TAB 2: MINHAS LOCAÇÕES / HISTÓRICO (Seção 31) ================= */}
      {activeTab === 'bookings' && (
        <div className="space-y-6">
          {/* Header e Filtros */}
          <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-4">
            <div>
              <h3 className="text-xl font-black text-gray-900">Minhas Locações</h3>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                Histórico completo com filtros por sala, data, paciente e status
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">
                  Mês de Referência
                </label>
                <input
                  type="month"
                  value={filterMonth}
                  onChange={e => setFilterMonth(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">
                  Sala
                </label>
                <select
                  value={filterRoom}
                  onChange={e => setFilterRoom(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                >
                  <option value="ALL">Todas as Salas</option>
                  <option value="Sala 1">Sala 1</option>
                  <option value="Sala 2">Sala 2</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">
                  Status de Pagamento
                </label>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                >
                  <option value="ALL">Todos os Status</option>
                  <option value="PAID">Pago</option>
                  <option value="PENDING">Pendente</option>
                  <option value="CANCELLED">Cancelado</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-wider mb-1">
                  Buscar Paciente
                </label>
                <input
                  type="text"
                  placeholder="Nome do paciente..."
                  value={searchClient}
                  onChange={e => setSearchClient(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-semibold"
                />
              </div>
            </div>
          </div>

          {/* Tabela de Locações */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50/70 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-wider">
                  <tr>
                    <th className="py-4 px-6">Data</th>
                    <th className="py-4 px-6">Sala</th>
                    <th className="py-4 px-6">Paciente</th>
                    <th className="py-4 px-6">Horário</th>
                    <th className="py-4 px-6">Duração</th>
                    <th className="py-4 px-6 text-right">Valor</th>
                    <th className="py-4 px-6 text-center">Status</th>
                    <th className="py-4 px-6 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 font-medium">
                  {filteredBookings.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-gray-400">
                        Nenhuma locação registrada com os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredBookings.map(b => (
                      <tr key={b.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="py-4 px-6 font-black text-gray-900">
                          {format(parseISO(b.date), 'dd/MM/yyyy')}
                        </td>
                        <td className="py-4 px-6 font-bold text-teal-700">
                          {b.roomId}
                        </td>
                        <td className="py-4 px-6 font-bold text-gray-800">
                          {b.clientName || <span className="text-gray-400 italic">Geral / Não informado</span>}
                        </td>
                        <td className="py-4 px-6 font-bold text-gray-600">
                          {`${b.hour.toString().padStart(2, '0')}:00 - ${b.endTimeHour.toString().padStart(2, '0')}:00`}
                        </td>
                        <td className="py-4 px-6 text-gray-500">
                          {b.durationHours}h {b.type === 'PERIOD' ? `(${b.periodName ? `Período ${b.periodName}` : 'Período'})` : ''}
                        </td>
                        <td className="py-4 px-6 font-black text-gray-900 text-right">
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
                          {b.paymentStatus !== 'CANCELLED' && (
                            <button
                              onClick={() => setBookingToCancel(b)}
                              className="text-red-500 hover:text-red-700 text-[11px] font-black uppercase hover:underline"
                            >
                              Cancelar
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 3: MEUS CONSUMOS / FINANCEIRO (Seção 8) ================= */}
      {activeTab === 'billing' && (
        <div className="space-y-6">
          {/* Header com Seletor de Mês */}
          <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h3 className="text-xl font-black text-gray-900">Meus Consumos & Relatório Financeiro</h3>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
                Acompanhe o total de horas, valores pagos e pendências por mês
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-black text-gray-500 uppercase tracking-wider">
                Mês:
              </span>
              <input
                type="month"
                value={filterMonth}
                onChange={e => setFilterMonth(e.target.value)}
                className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-black text-gray-800"
              />
            </div>
          </div>

          {/* Cards do Resumo do Mês (Seção 8) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase text-gray-400 block mb-1">Locações</span>
              <span className="text-2xl font-black text-gray-900">{billingMonthBookings.length}</span>
            </div>

            <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase text-gray-400 block mb-1">Total de Horas</span>
              <span className="text-2xl font-black text-gray-900">{billingTotalHours}h</span>
            </div>

            <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase text-gray-400 block mb-1">Sala Mais Usada</span>
              <span className="text-xl font-black text-teal-600">{mostUsedRoom}</span>
            </div>

            <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase text-gray-400 block mb-1">Valor Total</span>
              <span className="text-2xl font-black text-gray-900">R$ {billingTotalAmount.toFixed(0)}</span>
            </div>

            <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase text-emerald-600 block mb-1">Valores Pagos</span>
              <span className="text-2xl font-black text-emerald-700">R$ {billingTotalPaid.toFixed(0)}</span>
            </div>

            <div className="bg-white rounded-3xl p-5 border border-gray-100 shadow-sm">
              <span className="text-[10px] font-black uppercase text-amber-600 block mb-1">Valores Pendentes</span>
              <span className="text-2xl font-black text-amber-700">R$ {billingTotalPending.toFixed(0)}</span>
            </div>
          </div>

          {/* Gráfico de Evolução Mensal (Seção 8) */}
          <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm space-y-4">
            <h4 className="text-base font-black text-gray-900">
              Evolução dos Seus Gastos Mensais
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
              {monthlyChartData.map((item, idx) => {
                const max = Math.max(...monthlyChartData.map(m => m.total), 100);
                const heightPercent = Math.max(15, (item.total / max) * 100);

                return (
                  <div key={idx} className="flex flex-col items-center gap-2">
                    <div className="h-32 w-full bg-gray-50 rounded-2xl p-2 flex flex-col justify-end items-center">
                      <div
                        className="w-full bg-teal-500 rounded-xl transition-all flex items-center justify-center text-white text-[10px] font-black"
                        style={{ height: `${heightPercent}%` }}
                      >
                        {item.total > 0 ? `R$ ${item.total}` : ''}
                      </div>
                    </div>
                    <span className="text-xs font-black uppercase tracking-wider text-gray-600 capitalize">
                      {item.label}
                    </span>
                    <span className="text-[11px] font-bold text-teal-600">
                      R$ {item.total.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 4: MEU PERFIL (Seção 44) ================= */}
      {activeTab === 'profile' && (
        <div className="bg-white rounded-3xl p-6 lg:p-8 border border-gray-100 shadow-sm max-w-2xl mx-auto space-y-6">
          <div>
            <h3 className="text-xl font-black text-gray-900">Meu Perfil Profissional</h3>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-0.5">
              Mantenha seus dados e credenciais clínicas atualizados
            </p>
          </div>

          <form onSubmit={handleUpdateProfile} className="space-y-4">
            <Input
              label="Nome Completo *"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Telefone / Celular"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="(11) 90000-0000"
              />
              <Input
                label="WhatsApp"
                value={whatsapp}
                onChange={e => setWhatsapp(e.target.value)}
                placeholder="(11) 90000-0000"
              />
            </div>

            <Input
              label="Registro Profissional (CRP / CRM / CRN)"
              value={councilRegistration}
              onChange={e => setCouncilRegistration(e.target.value)}
              placeholder="Ex: CRP 06/123456"
            />

            <div className="pt-4 border-t border-gray-100 space-y-3">
              <span className="block text-xs font-black text-gray-700 uppercase tracking-wider">
                Alterar Senha de Acesso (Opcional)
              </span>
              <div className="space-y-3">
                <PasswordInput
                  label="Nova Senha"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Crie uma nova senha segura"
                  showStrengthMeter={true}
                />
                {newPassword && (
                  <PasswordInput
                    label="Confirmar Nova Senha"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Repita a nova senha"
                    error={
                      confirmPassword && newPassword !== confirmPassword 
                        ? 'As senhas digitadas não coincidem' 
                        : undefined
                    }
                  />
                )}
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <Button type="submit" disabled={isUpdatingProfile}>
                {isUpdatingProfile ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Modal de Cancelamento de Locação */}
      <Modal
        isOpen={!!bookingToCancel}
        onClose={() => setBookingToCancel(null)}
        title="Confirmar Cancelamento"
      >
        <div className="space-y-4 text-center">
          <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
            <Ban size={28} />
          </div>
          <h4 className="text-base font-black text-gray-900">
            Deseja cancelar esta locação?
          </h4>
          <p className="text-xs text-gray-500">
            {bookingToCancel && (
              <>
                {bookingToCancel.roomId} em{' '}
                {format(parseISO(bookingToCancel.date), 'dd/MM/yyyy')} às{' '}
                {bookingToCancel.hour}:00
              </>
            )}
          </p>
          <p className="text-[11px] text-gray-400">
            Lembramos que a política de cancelamento permite cancelamentos com no mínimo 24h de antecedência.
          </p>
          <div className="pt-4 flex justify-center gap-3">
            <Button variant="secondary" onClick={() => setBookingToCancel(null)}>
              Voltar
            </Button>
            <Button variant="danger" disabled={isCancelling} onClick={confirmCancel}>
              {isCancelling ? 'Cancelando...' : 'Sim, Cancelar'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
