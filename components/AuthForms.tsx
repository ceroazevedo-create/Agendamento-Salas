import React, { useState } from 'react';
import { authService } from '../services/authService';
import { Button } from './Button';
import { Input } from './Input';
import { PasswordInput } from './PasswordInput';
import { Modal } from './Modal';
import { useToast } from './Toast';
import { getPasswordValidationMessage } from '../utils/passwordSecurity';
import { 
  Building2, ArrowRight, KeyRound, Mail, Lock
} from 'lucide-react';

interface AuthFormsProps {
  onSuccess: () => void;
}

export const AuthForms: React.FC<AuthFormsProps> = ({ onSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [profession, setProfession] = useState('Psicólogo(a) Clínico(a)');
  const [councilRegistration, setCouncilRegistration] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isTermsModalOpen, setIsTermsModalOpen] = useState(false);
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const { addToast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await authService.login(email, password);
      addToast('Bem-vindo(a) de volta ao LocaPsico!', 'success');
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      onSuccess();
    } catch (err: any) {
      addToast(err.message || 'Erro ao realizar login.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      return addToast('As senhas digitadas não coincidem.', 'error');
    }
    const passValidationError = getPasswordValidationMessage(password);
    if (passValidationError) {
      return addToast(passValidationError, 'error');
    }
    if (!termsAccepted) {
      return addToast('É necessário aceitar os termos de uso e política de privacidade (LGPD).', 'error');
    }

    setIsLoading(true);
    try {
      await authService.register({
        email,
        password,
        name,
        cpf,
        phone,
        whatsapp: whatsapp || phone,
        profession,
        councilRegistration
      });
      addToast('Conta criada com sucesso! Você já está conectado.', 'success');
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      onSuccess();
    } catch (err: any) {
      addToast(err.message || 'Erro ao criar conta.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) {
      return addToast('Informe seu e-mail cadastrado.', 'error');
    }
    setIsResetting(true);
    try {
      await authService.resetPassword(forgotEmail);
      addToast('Link de recuperação enviado para seu e-mail! Verifique sua caixa de entrada.', 'success');
      setIsForgotModalOpen(false);
      setForgotEmail('');
    } catch (err: any) {
      addToast(err.message || 'Não foi possível solicitar a recuperação.', 'error');
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-teal-50/20 to-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full mx-auto space-y-8">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-3xl bg-teal-600 text-white shadow-xl shadow-teal-600/20 mb-2">
            <Building2 size={32} />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-gray-900">
            Loca<span className="text-teal-600">Psico</span>
          </h1>
          <h2 className="text-base font-bold text-gray-800">
            Sua sala profissional, no seu horário.
          </h2>
          <p className="text-xs text-gray-500 max-w-sm mx-auto leading-relaxed">
            Reserve salas por hora ou período integral, consulte sua agenda e acompanhe seus consumos em um só lugar.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-white p-8 rounded-3xl shadow-xl shadow-teal-900/5 border border-gray-100">
          {/* Toggle Tabs */}
          <div className="flex bg-gray-100 p-1 rounded-2xl mb-6">
            <button
              type="button"
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                isLogin ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-400 hover:text-gray-700'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2.5 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
                !isLogin ? 'bg-white text-teal-600 shadow-sm' : 'text-gray-400 hover:text-gray-700'
              }`}
            >
              Criar Conta
            </button>
          </div>

          {/* Form Content */}
          {isLogin ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <Input
                label="E-mail"
                type="email"
                placeholder="seu.email@exemplo.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <PasswordInput
                label="Senha de Acesso"
                placeholder="Digite sua senha"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />

              <div className="flex items-center justify-between text-xs pt-1">
                <label className="flex items-center text-gray-500 cursor-pointer">
                  <input type="checkbox" className="rounded text-teal-600 focus:ring-teal-500 mr-2" defaultChecked />
                  Lembrar de mim
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setForgotEmail(email);
                    setIsForgotModalOpen(true);
                  }}
                  className="font-bold text-teal-600 hover:text-teal-700"
                >
                  Esqueci a senha
                </button>
              </div>

              <div className="pt-2">
                <Button type="submit" disabled={isLoading} className="w-full flex items-center justify-center gap-2">
                  {isLoading ? 'Autenticando no servidor...' : 'Acessar Sistema'}
                  <ArrowRight size={16} />
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <Input
                label="Nome Completo *"
                placeholder="Ex: Dra. Mariana Lima"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="CPF *"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={e => setCpf(e.target.value)}
                  required
                />
                <Input
                  label="Registro (CRP/CRM)"
                  placeholder="CRP 06/123456"
                  value={councilRegistration}
                  onChange={e => setCouncilRegistration(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Telefone / Celular *"
                  placeholder="(11) 90000-0000"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  required
                />
                <Input
                  label="WhatsApp"
                  placeholder="(11) 90000-0000"
                  value={whatsapp}
                  onChange={e => setWhatsapp(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="E-mail Profissional *"
                  type="email"
                  placeholder="seu.email@exemplo.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                />
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 ml-1">
                    Profissão / Área *
                  </label>
                  <select
                    value={profession}
                    onChange={e => setProfession(e.target.value)}
                    className="w-full px-4 py-3 bg-white border-2 border-gray-100 rounded-xl text-gray-900 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  >
                    <option value="Psicólogo(a) Clínico(a)">Psicólogo(a) Clínico(a)</option>
                    <option value="Psicoterapeuta">Psicoterapeuta</option>
                    <option value="Psicanalista">Psicanalista</option>
                    <option value="Neuropsicólogo(a)">Neuropsicólogo(a)</option>
                    <option value="Fonoaudiólogo(a)">Fonoaudiólogo(a)</option>
                    <option value="Terapeuta Ocupacional">Terapeuta Ocupacional</option>
                    <option value="Nutricionista">Nutricionista</option>
                    <option value="Outro Profissional de Saúde">Outro Profissional de Saúde</option>
                  </select>
                </div>
              </div>

              <div className="space-y-4">
                <PasswordInput
                  label="Senha de Acesso *"
                  placeholder="Crie sua senha segura"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  showStrengthMeter={true}
                  required
                />
                <PasswordInput
                  label="Confirmar Senha *"
                  placeholder="Repita exatamente a senha criada"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  error={
                    confirmPassword && password !== confirmPassword 
                      ? 'As senhas digitadas não coincidem' 
                      : undefined
                  }
                  required
                />
              </div>

              {/* Termos e LGPD */}
              <div className="pt-2">
                <label className="flex items-start text-xs text-gray-500 cursor-pointer gap-2">
                  <input
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={e => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 rounded text-teal-600 focus:ring-teal-500"
                  />
                  <span>
                    Li e concordo com os{' '}
                    <button
                      type="button"
                      onClick={() => setIsTermsModalOpen(true)}
                      className="text-teal-600 font-bold underline"
                    >
                      Termos de Uso e Política de Privacidade (LGPD)
                    </button>
                    .
                  </span>
                </label>
              </div>

              <div className="pt-2">
                <Button type="submit" disabled={isLoading} className="w-full flex items-center justify-center gap-2">
                  {isLoading ? 'Cadastrando no servidor...' : 'Criar Conta de Profissional'}
                  <ArrowRight size={16} />
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Modal de Recuperação de Senha (Supabase Auth) */}
      <Modal
        isOpen={isForgotModalOpen}
        onClose={() => setIsForgotModalOpen(false)}
        title="Recuperação de Senha"
      >
        <form onSubmit={handleForgotPassword} className="space-y-4 text-xs text-gray-600">
          <p className="leading-relaxed">
            Digite o e-mail cadastrado na sua conta do LocaPsico. Enviaremos um link de redefinição seguro diretamente para a sua caixa de entrada.
          </p>
          <Input
            label="E-mail Cadastrado *"
            type="email"
            placeholder="seu.email@exemplo.com"
            value={forgotEmail}
            onChange={e => setForgotEmail(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsForgotModalOpen(false)}
              disabled={isResetting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isResetting}
              className="flex items-center gap-2"
            >
              <KeyRound size={14} />
              {isResetting ? 'Enviando link...' : 'Enviar Link de Recuperação'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Termos de Uso e LGPD */}
      <Modal
        isOpen={isTermsModalOpen}
        onClose={() => setIsTermsModalOpen(false)}
        title="Termos de Uso e Privacidade (LGPD)"
      >
        <div className="space-y-4 text-xs text-gray-600 leading-relaxed max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
          <h4 className="font-black text-gray-900 text-sm">1. Natureza do Serviço</h4>
          <p>
            O LocaPsico é uma plataforma tecnológica de locação de espaços físicos para profissionais da saúde e psicologia. A locação das salas não configura vínculo empregatício.
          </p>

          <h4 className="font-black text-gray-900 text-sm">2. Proteção de Dados e Sigilo Clínico (LGPD)</h4>
          <p>
            Em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018) e o Código de Ética Profissional do Psicólogo, todos os dados clínicos de pacientes inseridos na plataforma são de visualização exclusiva do profissional cadastrado. A administração da clínica não tem acesso a prontuários ou notas sigilosas de atendimento.
          </p>

          <h4 className="font-black text-gray-900 text-sm">3. Política de Cancelamento</h4>
          <p>
            Cancelamentos de horários locados devem ser efetuados com antecedência mínima de 24 horas através da plataforma. Locações não desmarcadas com essa antecedência serão cobradas integralmente.
          </p>

          <div className="pt-4 flex justify-end">
            <Button onClick={() => {
              setTermsAccepted(true);
              setIsTermsModalOpen(false);
            }}>
              Entendido e Aceito
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
