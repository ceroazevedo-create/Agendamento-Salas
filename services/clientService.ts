import { Client } from '../types';
import { getStoredClients, saveStoredClients, addAuditLog } from './storageService';
import { supabase, isSupabaseConfigured, translateSupabaseError } from './supabase';

function mapDbClientToClient(c: any): Client {
  return {
    id: c.id,
    professionalId: c.professional_id,
    name: c.full_name,
    cpf: c.cpf || '',
    birthDate: c.birth_date,
    phone: c.phone || '',
    whatsapp: c.whatsapp || c.phone || '',
    email: c.email || '',
    address: c.address || '',
    notes: c.notes || '',
    createdAt: c.created_at || new Date().toISOString(),
    status: (c.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE'
  };
}

export const clientService = {
  // Retorna apenas os clientes pertencentes ao profissional autenticado (Regra de Privacidade Crítica da Seção 8)
  getClientsByProfessional: async (professionalId: string): Promise<Client[]> => {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('professional_id', professionalId)
          .order('full_name', { ascending: true });

        if (error) throw error;
        if (data) {
          return data.map(mapDbClientToClient);
        }
      } catch (err) {
        console.warn('Erro ao buscar clientes no Supabase, usando local:', err);
      }
    }

    const clients = getStoredClients();
    return clients.filter(c => c.professionalId === professionalId);
  },

  // Para o administrador visualizar a lista global ou filtrada
  getAllClients: async (filterProfessionalId?: string): Promise<Client[]> => {
    if (isSupabaseConfigured) {
      try {
        let query = supabase.from('clients').select('*').order('full_name', { ascending: true });
        if (filterProfessionalId) {
          query = query.eq('professional_id', filterProfessionalId);
        }
        const { data, error } = await query;
        if (error) throw error;
        if (data) {
          return data.map(mapDbClientToClient);
        }
      } catch (err) {
        console.warn('Erro ao buscar clientes globais no Supabase, usando local:', err);
      }
    }

    const clients = getStoredClients();
    if (filterProfessionalId) {
      return clients.filter(c => c.professionalId === filterProfessionalId);
    }
    return clients;
  },

  getClientById: async (clientId: string): Promise<Client | null> => {
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase
          .from('clients')
          .select('*')
          .eq('id', clientId)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          return mapDbClientToClient(data);
        }
      } catch (err) {
        console.warn('Erro ao buscar cliente por ID no Supabase, usando local:', err);
      }
    }

    const clients = getStoredClients();
    return clients.find(c => c.id === clientId) || null;
  },

  createClient: async (
    professionalId: string,
    data: Omit<Client, 'id' | 'professionalId' | 'createdAt' | 'status'>
  ): Promise<Client> => {
    if (isSupabaseConfigured) {
      try {
        const payload = {
          professional_id: professionalId,
          full_name: data.name.trim(),
          cpf: data.cpf ? data.cpf.trim() : null,
          birth_date: data.birthDate || null,
          phone: data.phone ? data.phone.trim() : null,
          whatsapp: data.whatsapp ? data.whatsapp.trim() : null,
          email: data.email ? data.email.trim() : null,
          address: data.address ? data.address.trim() : null,
          notes: data.notes ? data.notes.trim() : null,
          status: 'ACTIVE'
        };

        const { data: created, error } = await supabase
          .from('clients')
          .insert(payload)
          .select()
          .single();

        if (error) throw error;
        return mapDbClientToClient(created);
      } catch (err: any) {
        throw new Error(translateSupabaseError(err));
      }
    }

    const clients = getStoredClients();
    const newClient: Client = {
      ...data,
      id: 'cli-' + Date.now(),
      professionalId,
      createdAt: new Date().toISOString(),
      status: 'ACTIVE'
    };

    saveStoredClients([newClient, ...clients]);
    return newClient;
  },

  updateClient: async (
    clientId: string,
    professionalId: string,
    updates: Partial<Omit<Client, 'id' | 'professionalId' | 'createdAt'>>,
    isAdmin = false
  ): Promise<Client> => {
    if (isSupabaseConfigured) {
      try {
        const payload: any = {};
        if (updates.name !== undefined) payload.full_name = updates.name.trim();
        if (updates.cpf !== undefined) payload.cpf = updates.cpf.trim();
        if (updates.birthDate !== undefined) payload.birth_date = updates.birthDate || null;
        if (updates.phone !== undefined) payload.phone = updates.phone.trim();
        if (updates.whatsapp !== undefined) payload.whatsapp = updates.whatsapp.trim();
        if (updates.email !== undefined) payload.email = updates.email.trim();
        if (updates.address !== undefined) payload.address = updates.address.trim();
        if (updates.notes !== undefined) payload.notes = updates.notes.trim();
        if (updates.status !== undefined) payload.status = updates.status;

        let query = supabase.from('clients').update(payload).eq('id', clientId);
        if (!isAdmin) {
          query = query.eq('professional_id', professionalId);
        }

        const { data: updated, error } = await query.select().single();
        if (error) throw error;
        return mapDbClientToClient(updated);
      } catch (err: any) {
        throw new Error(translateSupabaseError(err));
      }
    }

    const clients = getStoredClients();
    const index = clients.findIndex(c => c.id === clientId);
    if (index === -1) throw new Error('Cliente não encontrado.');

    if (!isAdmin && clients[index].professionalId !== professionalId) {
      throw new Error('Acesso negado: você só pode editar seus próprios clientes.');
    }

    const updated = {
      ...clients[index],
      ...updates
    };

    clients[index] = updated;
    saveStoredClients(clients);
    return updated;
  },

  deleteClient: async (clientId: string, professionalId: string, isAdmin = false): Promise<void> => {
    if (isSupabaseConfigured) {
      try {
        let query = supabase.from('clients').delete().eq('id', clientId);
        if (!isAdmin) {
          query = query.eq('professional_id', professionalId);
        }
        const { error } = await query;
        if (error) throw error;
        return;
      } catch (err: any) {
        throw new Error(translateSupabaseError(err));
      }
    }

    const clients = getStoredClients();
    const target = clients.find(c => c.id === clientId);
    if (!target) throw new Error('Cliente não encontrado.');

    if (!isAdmin && target.professionalId !== professionalId) {
      throw new Error('Acesso negado: você só pode remover seus próprios clientes.');
    }

    const filtered = clients.filter(c => c.id !== clientId);
    saveStoredClients(filtered);
  }
};

