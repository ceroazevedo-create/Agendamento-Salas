import { supabase } from './supabase';
import { User } from '../types';
import { format } from 'date-fns';

export interface BackupCounts {
  profiles: number;
  professionals: number;
  clients: number;
  rooms: number;
  bookings: number;
  payments: number;
  blocked_slots: number;
  settings: number;
  audit_logs: number;
}

export interface BackupMetadata {
  system: string;
  description: string;
  schemaVersion: string;
  generatedAt: string;
  generatedBy: {
    id: string;
    email: string;
    name: string;
  };
  totalRecords: number;
  counts: BackupCounts;
}

export interface SystemBackupPayload {
  metadata: BackupMetadata;
  data: {
    profiles: any[];
    professionals: any[];
    clients: any[];
    rooms: any[];
    bookings: any[];
    payments: any[];
    blocked_slots: any[];
    settings: any[];
    audit_logs: any[];
  };
}

/**
 * Fallback seguro de leitura direta via sessão autenticada do administrador no Supabase
 * (utilizado apenas caso a aplicação esteja sendo acessada via hospedagem estática sem Pages Functions, ex: GitHub Pages).
 */
async function generateClientSideAdminBackup(adminUser: User): Promise<SystemBackupPayload> {
  if (adminUser.role !== 'ADMIN') {
    throw new Error('Permissão negada. Apenas administradores podem gerar backup do sistema.');
  }

  const [
    profilesRes,
    professionalsRes,
    clientsRes,
    roomsRes,
    bookingsRes,
    paymentsRes,
    blockedSlotsRes,
    settingsRes,
    auditLogsRes
  ] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: true }),
    supabase.from('professionals').select('*').order('created_at', { ascending: true }),
    supabase.from('clients').select('*').order('created_at', { ascending: true }),
    supabase.from('rooms').select('*').order('id', { ascending: true }),
    supabase.from('bookings').select('*').order('booking_date', { ascending: false }),
    supabase.from('payments').select('*').order('created_at', { ascending: false }),
    supabase.from('blocked_slots').select('*').order('blocked_date', { ascending: false }),
    supabase.from('settings').select('*'),
    supabase.from('audit_logs').select('*').order('timestamp', { ascending: false })
  ]);

  const data = {
    profiles: profilesRes.data || [],
    professionals: professionalsRes.data || [],
    clients: clientsRes.data || [],
    rooms: roomsRes.data || [],
    bookings: bookingsRes.data || [],
    payments: paymentsRes.data || [],
    blocked_slots: blockedSlotsRes.data || [],
    settings: settingsRes.data || [],
    audit_logs: auditLogsRes.data || []
  };

  const counts: BackupCounts = {
    profiles: data.profiles.length,
    professionals: data.professionals.length,
    clients: data.clients.length,
    rooms: data.rooms.length,
    bookings: data.bookings.length,
    payments: data.payments.length,
    blocked_slots: data.blocked_slots.length,
    settings: data.settings.length,
    audit_logs: data.audit_logs.length
  };

  const totalRecords = Object.values(counts).reduce((acc, c) => acc + c, 0);

  return {
    metadata: {
      system: 'LocaPsico',
      description: 'Backup completo de segurança dos dados do sistema LocaPsico',
      schemaVersion: '1.0',
      generatedAt: new Date().toISOString(),
      generatedBy: {
        id: adminUser.id,
        email: adminUser.email,
        name: adminUser.name
      },
      totalRecords,
      counts
    },
    data
  };
}

export const backupService = {
  /**
   * Solicita ao endpoint administrativo (/api/admin/backup) a geração do backup completo (somente leitura)
   * e retorna o payload estruturado.
   */
  fetchSystemBackup: async (adminUser: User): Promise<SystemBackupPayload> => {
    if (!adminUser || adminUser.role !== 'ADMIN') {
      throw new Error('Permissão negada. Apenas administradores podem realizar backups.');
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    if (!token) {
      throw new Error('Sessão administrativa não encontrada. Faça login novamente.');
    }

    try {
      const response = await fetch('/api/admin/backup', {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      let parsed: any = null;
      try {
        const text = await response.text();
        parsed = JSON.parse(text);
      } catch {
        // Resposta não é JSON (ex: 404 HTML no GitHub Pages)
      }

      if (response.ok && parsed?.metadata && parsed?.data) {
        return parsed as SystemBackupPayload;
      }

      // Se for 404 (hospedagem puramente estática como GitHub Pages), utiliza fallback autenticado via RLS Admin
      if (response.status === 404 || !parsed) {
        return await generateClientSideAdminBackup(adminUser);
      }

      throw new Error(parsed?.error || `Falha ao gerar backup no servidor (status ${response.status}).`);
    } catch (err: any) {
      if (err?.message?.includes('Failed to fetch') || err?.message?.includes('NetworkError')) {
        return await generateClientSideAdminBackup(adminUser);
      }
      throw err;
    }
  },

  /**
   * Faz o download automático do arquivo JSON de backup no navegador do administrador.
   */
  downloadBackupFile: (backup: SystemBackupPayload): string => {
    const timestamp = format(new Date(), 'yyyy-MM-dd-HHmm');
    const fileName = `locapsico-backup-${timestamp}.json`;
    const jsonContent = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return fileName;
  }
};
