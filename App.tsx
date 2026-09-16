import React, { useState, useEffect } from 'react';
import { User } from './types';
import { authService } from './services/authService';
import { supabase } from './services/supabase';
import { AuthForms } from './components/AuthForms';
import { Calendar } from './components/Calendar';
import { UserDashboard } from './components/UserDashboard';
import { AdminPanel } from './components/AdminPanel';
import { ClientsManager } from './components/ClientsManager';
import { ToastProvider, useToast } from './components/Toast';
import { 
  Building2, Calendar as CalendarIcon, LayoutDashboard, 
  Users, DollarSign, FileText, Settings, LogOut, 
  Menu, X, User as UserIcon, Shield, ChevronDown
} from 'lucide-react';

export type AppView = 
  | 'calendar' 
  | 'dashboard' 
  | 'clients' 
  | 'bookings' 
  | 'billing' 
  | 'profile' 
  | 'admin';

const AppContent: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    let isMounted = true;

    // Timer de segurança: garante que a tela de carregamento nunca fique presa
    const safetyTimer = setTimeout(() => {
      if (isMounted) {
        setLoading(false);
      }
    }, 1200);

    // 1. Carregamento inicial da sessão ativa do Supabase Auth
    const initSession = async () => {
      try {
        const user = await authService.getCurrentUser();
        if (isMounted) {
          setCurrentUser(user);
          if (user?.role === 'ADMIN') {
            setCurrentView('admin');
          } else if (user) {
            setCurrentView('dashboard');
          }
        }
      } catch (e: any) {
        const msg = e?.message || String(e || '');
        if (
          !msg.includes('Refresh Token') &&
          !msg.includes('refresh_token_not_found') &&
          !msg.includes('invalid_grant')
        ) {
          console.warn('Aviso na inicialização de sessão Supabase:', e);
        }
      } finally {
        if (isMounted) {
          clearTimeout(safetyTimer);
          setLoading(false);
        }
      }
    };

    initSession();

    // 2. Monitoramento de eventos reais de autenticação via Supabase Auth
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;

      if (event === 'SIGNED_OUT' || !session?.user) {
        setCurrentUser(null);
        setCurrentView('dashboard');
        setLoading(false);
      } else {
        try {
          const user = await authService.getCurrentUser();
          if (isMounted) {
            setCurrentUser(user);
            if (user?.role === 'ADMIN') {
              setCurrentView('admin');
            } else if (user) {
              setCurrentView('dashboard');
            }
          }
        } catch (err: any) {
          const msg = err?.message || String(err || '');
          if (
            !msg.includes('Refresh Token') &&
            !msg.includes('refresh_token_not_found') &&
            !msg.includes('invalid_grant')
          ) {
            console.warn('Aviso ao sincronizar perfil Supabase:', err);
          }
        } finally {
          if (isMounted) {
            clearTimeout(safetyTimer);
            setLoading(false);
          }
        }
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(safetyTimer);
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Sempre rola para o alto da tela quando a tela atual mudar
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [currentView]);

  const handleLogout = async () => {
    await authService.logout();
    setCurrentUser(null);
    setCurrentView('dashboard');
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    addToast('Sessão encerrada com sucesso.', 'info');
  };

  const handleAuthSuccess = async () => {
    const user = await authService.getCurrentUser();
    setCurrentUser(user);
    if (user?.role === 'ADMIN') {
      setCurrentView('admin');
    } else {
      setCurrentView('dashboard');
    }
    // Garante que a tela início abra no topo absoluto da página
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    setTimeout(() => {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }, 50);
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin"></div>
          <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Carregando LocaPsico...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthForms onSuccess={handleAuthSuccess} />;
  }

  const isAdmin = currentUser.role === 'ADMIN';

  // Navigation Items for Desktop and Mobile (Início em primeiro lugar)
  const professionalNavItems = [
    { id: 'dashboard' as AppView, label: 'Início', icon: LayoutDashboard },
    { id: 'calendar' as AppView, label: 'Agenda', icon: CalendarIcon },
    { id: 'clients' as AppView, label: 'Pacientes', icon: Users },
    { id: 'bookings' as AppView, label: 'Minhas Locações', icon: FileText },
    { id: 'billing' as AppView, label: 'Meus Consumos', icon: DollarSign },
  ];

  const adminNavItems = [
    { id: 'admin' as AppView, label: 'Painel Geral', icon: LayoutDashboard },
    { id: 'calendar' as AppView, label: 'Agenda Completa', icon: CalendarIcon },
    { id: 'clients' as AppView, label: 'Pacientes', icon: Users },
  ];

  const currentNavItems = isAdmin ? adminNavItems : professionalNavItems;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col font-sans selection:bg-teal-500 selection:text-white">
      {/* Top Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex justify-between items-center">
          {/* Logo & Brand */}
          <div className="flex items-center gap-8">
            <div 
              className="flex items-center gap-3 cursor-pointer group"
              onClick={() => {
                setCurrentView(isAdmin ? 'admin' : 'dashboard');
                window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
              }}
            >
              <div className="w-11 h-11 bg-teal-600 rounded-2xl flex items-center justify-center text-white shadow-md shadow-teal-600/20 group-hover:scale-105 transition-transform">
                <Building2 size={22} />
              </div>
              <div>
                <span className="text-lg font-black tracking-tight text-gray-900 block leading-none">
                  Loca<span className="text-teal-600">Psico</span>
                </span>
                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                  Gestão & Locação de Salas
                </span>
              </div>
            </div>

            {/* Desktop Navigation Links */}
            <nav className="hidden lg:flex items-center gap-1.5">
              {currentNavItems.map(item => {
                const Icon = item.icon;
                const isActive = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setCurrentView(item.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-2xl text-xs font-black uppercase tracking-wider transition-all ${
                      isActive
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-gray-500 hover:text-teal-700 hover:bg-teal-50/50'
                    }`}
                  >
                    <Icon size={14} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* User Profile Info & Controls */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div 
              onClick={() => !isAdmin && setCurrentView('profile')}
              className={`hidden sm:flex items-center gap-3 px-3 py-1.5 rounded-2xl border border-gray-100 bg-gray-50/50 ${!isAdmin ? 'cursor-pointer hover:bg-teal-50/50 hover:border-teal-200' : ''} transition-all`}
            >
              <div className="w-8 h-8 rounded-xl bg-teal-100 text-teal-800 font-black text-xs flex items-center justify-center">
                {currentUser.name.charAt(0)}
              </div>
              <div className="text-left">
                <p className="text-xs font-black text-gray-900 leading-tight">
                  {currentUser.name}
                </p>
                <p className="text-[10px] text-teal-600 font-bold uppercase tracking-wider">
                  {isAdmin ? '👑 Administrador' : (currentUser.profession || 'Terapeuta')}
                </p>
              </div>
            </div>

            <button
              onClick={handleLogout}
              title="Sair do sistema"
              className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-all"
            >
              <LogOut size={18} />
            </button>

            {/* Mobile Hamburger Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2.5 text-gray-500 hover:bg-gray-100 rounded-2xl transition-all"
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* Mobile Dropdown Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden bg-white border-t border-gray-100 p-4 space-y-1.5 shadow-lg animate-slide-up">
            <div className="p-3 bg-gray-50 rounded-2xl mb-2 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-teal-600 text-white font-black text-xs flex items-center justify-center">
                {currentUser.name.charAt(0)}
              </div>
              <div>
                <p className="text-xs font-black text-gray-900">{currentUser.name}</p>
                <p className="text-[10px] text-teal-600 font-bold uppercase tracking-wider">
                  {isAdmin ? 'Administrador' : currentUser.profession || 'Terapeuta'}
                </p>
              </div>
            </div>

            {currentNavItems.map(item => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setCurrentView(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all text-left ${
                    isActive
                      ? 'bg-teal-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}

            {!isAdmin && (
              <button
                onClick={() => {
                  setCurrentView('profile');
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all text-left ${
                  currentView === 'profile'
                    ? 'bg-teal-600 text-white'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <UserIcon size={16} />
                <span>Meu Perfil</span>
              </button>
            )}
          </div>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 py-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto w-full">
        {currentView === 'calendar' && (
          <Calendar 
            user={currentUser} 
            onOpenClients={() => setCurrentView('clients')} 
          />
        )}

        {currentView === 'dashboard' && (
          <UserDashboard 
            user={currentUser} 
            initialTab="overview" 
            onNavigateToCalendar={() => setCurrentView('calendar')} 
          />
        )}

        {currentView === 'clients' && (
          <ClientsManager user={currentUser} />
        )}

        {currentView === 'bookings' && (
          <UserDashboard 
            user={currentUser} 
            initialTab="bookings" 
            onNavigateToCalendar={() => setCurrentView('calendar')} 
          />
        )}

        {currentView === 'billing' && (
          <UserDashboard 
            user={currentUser} 
            initialTab="billing" 
            onNavigateToCalendar={() => setCurrentView('calendar')} 
          />
        )}

        {currentView === 'profile' && (
          <UserDashboard 
            user={currentUser} 
            initialTab="profile" 
            onNavigateToCalendar={() => setCurrentView('calendar')} 
          />
        )}

        {currentView === 'admin' && (
          <AdminPanel currentUser={currentUser} />
        )}
      </main>

      {/* Footer */}
      <footer className="py-6 border-t border-gray-100 bg-white text-center">
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
          © 2026 LocaPsico — Sistema de Gestão & Locação de Salas para Psicólogos e Terapeutas
        </p>
      </footer>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
};

export default App;
