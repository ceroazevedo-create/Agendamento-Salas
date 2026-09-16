import React, { useState, useEffect, useMemo } from 'react';
import { Client, User } from '../types';
import { clientService } from '../services/clientService';
import { Modal } from './Modal';
import { Button } from './Button';
import { Input } from './Input';
import { useToast } from './Toast';
import { 
  Users, UserPlus, Search, Phone, Mail, MapPin, 
  FileText, Calendar, Edit2, Trash2, CheckCircle, MessageSquare
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale/pt-BR';

interface ClientsManagerProps {
  user: User;
}

export const ClientsManager: React.FC<ClientsManagerProps> = ({ user }) => {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [clientToDelete, setClientToDelete] = useState<Client | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const { addToast } = useToast();
  const isAdmin = user.role === 'ADMIN';

  const fetchClients = async () => {
    setIsLoading(true);
    try {
      const data = isAdmin
        ? await clientService.getAllClients()
        : await clientService.getClientsByProfessional(user.id);
      setClients(data);
    } catch (e: any) {
      addToast('Erro ao carregar lista de pacientes.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, [user.id, isAdmin]);

  const openCreateModal = () => {
    setEditingClient(null);
    setName('');
    setCpf('');
    setBirthDate('');
    setPhone('');
    setWhatsapp('');
    setEmail('');
    setAddress('');
    setNotes('');
    setIsModalOpen(true);
  };

  const openEditModal = (client: Client) => {
    setEditingClient(client);
    setName(client.name);
    setCpf(client.cpf);
    setBirthDate(client.birthDate || '');
    setPhone(client.phone);
    setWhatsapp(client.whatsapp || client.phone);
    setEmail(client.email || '');
    setAddress(client.address || '');
    setNotes(client.notes || '');
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return addToast('Informe o nome do paciente.', 'error');
    if (!phone.trim()) return addToast('Informe o telefone de contato.', 'error');

    setIsSubmitting(true);
    try {
      if (editingClient) {
        await clientService.updateClient(editingClient.id, user.id, {
          name,
          cpf,
          birthDate,
          phone,
          whatsapp: whatsapp || phone,
          email,
          address,
          notes
        }, isAdmin);
        addToast('Dados do paciente atualizados com sucesso!', 'success');
      } else {
        await clientService.createClient(user.id, {
          name,
          cpf,
          birthDate,
          phone,
          whatsapp: whatsapp || phone,
          email,
          address,
          notes
        });
        addToast('Paciente cadastrado com sucesso!', 'success');
      }
      setIsModalOpen(false);
      await fetchClients();
    } catch (e: any) {
      addToast(e.message || 'Erro ao salvar paciente.', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClient = async () => {
    if (!clientToDelete) return;
    try {
      await clientService.deleteClient(clientToDelete.id, user.id, isAdmin);
      addToast(`Paciente ${clientToDelete.name} removido.`, 'success');
      setClientToDelete(null);
      await fetchClients();
    } catch (e: any) {
      addToast(e.message || 'Erro ao remover paciente.', 'error');
    }
  };

  const filteredClients = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return clients;
    return clients.filter(c => 
      c.name.toLowerCase().includes(term) ||
      c.cpf.includes(term) ||
      c.phone.includes(term) ||
      (c.email && c.email.toLowerCase().includes(term))
    );
  }, [clients, searchTerm]);

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Top Header Card */}
      <div className="bg-white rounded-3xl p-6 lg:p-8 shadow-sm border border-gray-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center font-black">
              <Users size={24} />
            </div>
            <div>
              <h2 className="text-xl lg:text-2xl font-black text-gray-900 tracking-tight">Meus Pacientes / Clientes</h2>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-0.5">
                {isAdmin ? 'Visualização Geral da Clínica' : 'Carteira Pessoal & Sigilosa'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Buscar por nome, CPF ou tel..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
            />
          </div>
          <Button onClick={openCreateModal} className="flex items-center justify-center gap-2 whitespace-nowrap">
            <UserPlus size={16} />
            Novo Paciente
          </Button>
        </div>
      </div>

      {/* Clients List */}
      {isLoading ? (
        <div className="h-64 flex items-center justify-center bg-white rounded-3xl border border-gray-100">
          <div className="w-8 h-8 border-4 border-teal-100 border-t-teal-600 rounded-full animate-spin"></div>
        </div>
      ) : filteredClients.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-gray-100 space-y-4">
          <div className="w-16 h-16 bg-teal-50 text-teal-600 rounded-full flex items-center justify-center mx-auto">
            <Users size={32} />
          </div>
          <h3 className="text-lg font-black text-gray-800">
            {searchTerm ? 'Nenhum paciente encontrado para esta busca.' : 'Você ainda não cadastrou nenhum paciente.'}
          </h3>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Cadastre seus pacientes para vincular diretamente aos horários alugados nas salas 1 e 2. Seus dados são confidenciais e exclusivos.
          </p>
          <Button onClick={openCreateModal} className="mt-2 inline-flex items-center gap-2">
            <UserPlus size={16} /> Cadastrar Primeiro Paciente
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredClients.map(client => {
            const cleanPhone = client.whatsapp?.replace(/\D/g, '') || client.phone.replace(/\D/g, '');
            return (
              <div 
                key={client.id}
                className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-black text-gray-900 text-base group-hover:text-teal-600 transition-colors">
                        {client.name}
                      </h4>
                      {client.cpf && (
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mt-0.5">
                          CPF: {client.cpf}
                        </p>
                      )}
                    </div>
                    <span className="bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-lg">
                      Ativo
                    </span>
                  </div>

                  <div className="space-y-2 text-xs text-gray-600">
                    <div className="flex items-center gap-2">
                      <Phone size={14} className="text-teal-600 flex-shrink-0" />
                      <span>{client.phone}</span>
                    </div>
                    {client.email && (
                      <div className="flex items-center gap-2">
                        <Mail size={14} className="text-teal-600 flex-shrink-0" />
                        <span className="truncate">{client.email}</span>
                      </div>
                    )}
                    {client.address && (
                      <div className="flex items-start gap-2">
                        <MapPin size={14} className="text-teal-600 flex-shrink-0 mt-0.5" />
                        <span className="truncate">{client.address}</span>
                      </div>
                    )}
                    {client.notes && (
                      <div className="pt-2 border-t border-gray-50 text-[11px] text-gray-500 bg-gray-50 p-2.5 rounded-xl italic">
                        "{client.notes}"
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-4 mt-4 border-t border-gray-50 flex items-center justify-between">
                  <a
                    href={`https://wa.me/55${cleanPhone}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-600 hover:text-emerald-700 uppercase tracking-wider bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl transition-colors"
                  >
                    <MessageSquare size={13} /> WhatsApp
                  </a>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEditModal(client)}
                      className="p-2 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded-xl transition-colors"
                      title="Editar Paciente"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => setClientToDelete(client)}
                      className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                      title="Excluir Paciente"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Criação / Edição */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={editingClient ? "Editar Paciente" : "Novo Paciente"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nome Completo *"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Ex: Maria da Silva"
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="CPF"
              value={cpf}
              onChange={e => setCpf(e.target.value)}
              placeholder="000.000.000-00"
            />
            <Input
              label="Data de Nascimento"
              type="date"
              value={birthDate}
              onChange={e => setBirthDate(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Telefone / Celular *"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="(11) 90000-0000"
              required
            />
            <Input
              label="WhatsApp"
              value={whatsapp}
              onChange={e => setWhatsapp(e.target.value)}
              placeholder="(11) 90000-0000"
            />
          </div>

          <Input
            label="E-mail"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="paciente@exemplo.com"
          />

          <Input
            label="Endereço Completo"
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="Rua, número, bairro, cidade"
          />

          <div>
            <label className="block text-xs font-black text-gray-700 uppercase tracking-wider mb-2">
              Observações Clínicas / Queixa Inicial (Privativo)
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              placeholder="Anotações confidenciais que ajudam no acompanhamento das sessões..."
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl text-xs font-semibold text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all resize-none"
            ></textarea>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={() => setIsModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando...' : (editingClient ? 'Salvar Alterações' : 'Cadastrar Paciente')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Confirmação de Exclusão */}
      <Modal
        isOpen={!!clientToDelete}
        onClose={() => setClientToDelete(null)}
        title="Confirmar Exclusão"
      >
        <div className="space-y-4 text-center">
          <div className="w-14 h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto">
            <Trash2 size={28} />
          </div>
          <h4 className="text-base font-black text-gray-900">
            Deseja remover {clientToDelete?.name}?
          </h4>
          <p className="text-xs text-gray-500 max-w-sm mx-auto">
            Esta ação removerá o paciente da sua carteira. Os agendamentos já efetuados permanecerão registrados no histórico financeiro.
          </p>
          <div className="pt-4 flex justify-center gap-3">
            <Button variant="secondary" onClick={() => setClientToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDeleteClient}>
              Sim, Remover Paciente
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
