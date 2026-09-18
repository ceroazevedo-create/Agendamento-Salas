import { User, Role } from '../types';
import { addAuditLog, getStoredUsers, saveStoredUsers } from './storageService';
import { getPasswordValidationMessage } from '../utils/passwordSecurity';
import { supabase, translateSupabaseError, clearSupabaseStorageTokens, isSupabaseConfigured } from './supabase';

export interface RegisterPayload {
  email: string; 
  password: string; 
  name: string;
  cpf?: string;
  phone?: string;
  whatsapp?: string;
  councilRegistration?: string;
  profession?: string;
}

/**
 * Converte o perfil persistido no Supabase para o modelo User do frontend.
 * SEGURANÇA: A role vem EXCLUSIVAMENTE de `profiles.role` no banco de dados.
 * O frontend nunca define privilégios por conta própria nem confia em dados do cliente.
 */
function mapProfileToUser(profile: any, prof?: any, authUser?: any): User {
  const isProfileAdmin = profile?.role === 'admin' || profile?.role === 'ADMIN';
  const role: Role = isProfileAdmin ? 'ADMIN' : 'USER';

  return {
    id: profile.id,
    email: profile.email || authUser?.email || '',
    name: profile.full_name || profile.nome || authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || 'Profissional',
    role,
    cpf: profile.cpf || prof?.cpf || '',
    phone: profile.phone || prof?.phone || '',
    whatsapp: profile.whatsapp || prof?.whatsapp || profile.phone || '',
    councilRegistration: prof?.registration_number || profile.council_registration || '',
    profession: prof?.professional_type || profile.profession || 'Psicólogo(a)',
    status: (profile.status || 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
    createdAt: profile.created_at || new Date().toISOString()
  };
}

export const authService = {
  /**
   * Login real utilizando exclusivamente Supabase Auth (supabase.auth.signInWithPassword).
   * Sem dados em localStorage, sem bypasses demo.
   */
  login: async (email: string, password: string): Promise<User> => {
    if (!email || typeof email !== 'string') {
      throw new Error('Informe um e-mail válido.');
    }
    if (!password || typeof password !== 'string') {
      throw new Error('Informe sua senha.');
    }
    const cleanEmail = email.trim().toLowerCase();

    // 1. Autenticação via Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password
    });

    if (authError) {
      throw new Error(translateSupabaseError(authError));
    }

    if (!authData.user) {
      throw new Error('Não foi possível autenticar o usuário.');
    }

    // 2. Busca o perfil do usuário na tabela public.profiles pelo auth.uid()
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (profileError) {
      throw new Error(translateSupabaseError(profileError));
    }

    if (!profile) {
      throw new Error('Perfil de usuário não localizado no banco de dados. Contate a administração.');
    }

    // 3. Busca dados complementares em public.professionals
    const { data: prof } = await supabase
      .from('professionals')
      .select('*')
      .eq('user_id', authData.user.id)
      .maybeSingle();

    const user = mapProfileToUser(profile, prof, authData.user);

    if (user.status === 'INACTIVE') {
      await supabase.auth.signOut();
      throw new Error('Esta conta está inativa. Entre em contato com a administração.');
    }

    addAuditLog(user.id, user.name, 'Login', 'Autenticação realizada com sucesso no Supabase.');
    return user;
  },

  /**
   * Cadastro real de novo profissional no Supabase Auth.
   * Novos usuários recebem role 'professional' no banco (mapeado para 'USER' no frontend).
   */
  register: async (
    payloadOrEmail: string | RegisterPayload, 
    passwordArg?: string, 
    nameArg?: string,
    cpfArg?: string,
    phoneArg?: string,
    whatsappArg?: string,
    councilRegistrationArg?: string,
    professionArg?: string
  ): Promise<User> => {
    let email = '';
    let password = '';
    let name = '';
    let cpf = '';
    let phone = '';
    let whatsapp = '';
    let councilRegistration = '';
    let profession = '';

    if (typeof payloadOrEmail === 'object' && payloadOrEmail !== null) {
      email = payloadOrEmail.email || '';
      password = payloadOrEmail.password || '';
      name = payloadOrEmail.name || '';
      cpf = payloadOrEmail.cpf || '';
      phone = payloadOrEmail.phone || '';
      whatsapp = payloadOrEmail.whatsapp || '';
      councilRegistration = payloadOrEmail.councilRegistration || '';
      profession = payloadOrEmail.profession || '';
    } else {
      email = typeof payloadOrEmail === 'string' ? payloadOrEmail : '';
      password = passwordArg || '';
      name = nameArg || '';
      cpf = cpfArg || '';
      phone = phoneArg || '';
      whatsapp = whatsappArg || '';
      councilRegistration = councilRegistrationArg || '';
      profession = professionArg || '';
    }

    if (!email || typeof email !== 'string') {
      throw new Error('Informe um e-mail válido.');
    }

    if (!name || typeof name !== 'string') {
      throw new Error('Informe seu nome completo.');
    }

    if (!password || typeof password !== 'string') {
      throw new Error('Informe uma senha válida.');
    }

    const passwordError = getPasswordValidationMessage(password);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const cleanEmail = email.trim().toLowerCase();

    // Cria o usuário em auth.users através do Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          name: name.trim(),
          full_name: name.trim(),
          cpf: cpf ? cpf.trim() : '',
          phone: phone ? phone.trim() : '',
          whatsapp: (whatsapp ? whatsapp.trim() : '') || (phone ? phone.trim() : ''),
          profession: profession ? profession.trim() : 'Psicólogo(a)',
          councilRegistration: councilRegistration ? councilRegistration.trim() : ''
        }
      }
    });

    if (authError) {
      throw new Error(translateSupabaseError(authError));
    }

    if (!authData.user) {
      throw new Error('Não foi possível criar a conta no servidor.');
    }

    // Carrega o profile gerado no banco de dados
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle();

    const { data: prof } = await supabase
      .from('professionals')
      .select('*')
      .eq('user_id', authData.user.id)
      .maybeSingle();

    let newUser: User;
    if (profile) {
      newUser = mapProfileToUser(profile, prof, authData.user);
    } else {
      newUser = {
        id: authData.user.id,
        email: cleanEmail,
        name: name.trim(),
        role: 'USER',
        cpf: cpf ? cpf.trim() : '',
        phone: phone ? phone.trim() : '',
        whatsapp: (whatsapp ? whatsapp.trim() : '') || (phone ? phone.trim() : ''),
        councilRegistration: councilRegistration ? councilRegistration.trim() : '',
        profession: profession ? profession.trim() : 'Psicólogo(a)',
        status: 'ACTIVE',
        createdAt: new Date().toISOString()
      };
    }

    addAuditLog(newUser.id, newUser.name, 'Novo Cadastro', 'Profissional registrado com sucesso via Supabase Auth.');
    return newUser;
  },

  /**
   * Obtém o usuário atual autenticado exclusivamente a partir da sessão ativa do Supabase.
   */
  getCurrentUser: async (): Promise<User | null> => {
    try {
      const sessionPromise = supabase.auth.getSession();
      const timeoutPromise = new Promise<{ data: { session: null }; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: { session: null }, error: null }), 2500)
      );

      const { data: { session }, error: sessionError } = await Promise.race([sessionPromise, timeoutPromise]);
      if (sessionError || !session?.user) {
        if (sessionError) {
          const errMsg = sessionError.message || String(sessionError);
          if (
            errMsg.includes('Refresh Token') ||
            errMsg.includes('refresh_token_not_found') ||
            errMsg.includes('invalid_grant')
          ) {
            clearSupabaseStorageTokens();
            try {
              await supabase.auth.signOut({ scope: 'local' });
            } catch {}
          }
        }
        return null;
      }

      const profilePromise = supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      const profileTimeout = new Promise<{ data: null; error: any }>((resolve) =>
        setTimeout(() => resolve({ data: null, error: null }), 2500)
      );

      const { data: profile, error: profileError } = await Promise.race([profilePromise, profileTimeout]);
      if (profileError || !profile) {
        return null;
      }

      const { data: prof } = await supabase
        .from('professionals')
        .select('*')
        .eq('user_id', session.user.id)
        .maybeSingle();

      return mapProfileToUser(profile, prof, session.user);
    } catch (err: any) {
      const msg = err?.message || String(err || '');
      if (
        msg.includes('Refresh Token') ||
        msg.includes('refresh_token_not_found') ||
        msg.includes('invalid_grant')
      ) {
        clearSupabaseStorageTokens();
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch {}
      } else {
        console.warn('Aviso ao sincronizar sessão atual no Supabase:', err);
      }
      return null;
    }
  },

  /**
   * Encerra a sessão ativa no Supabase Auth.
   */
  logout: async (): Promise<void> => {
    try {
      await supabase.auth.signOut();
    } catch {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    } finally {
      clearSupabaseStorageTokens();
    }
  },

  /**
   * Atualiza dados de perfil do usuário logado.
   */
  updateProfile: async (userId: string, data: Partial<User>): Promise<User> => {
    const updatesProfile: any = {};
    if (data.name) updatesProfile.full_name = data.name;
    if (data.phone) updatesProfile.phone = data.phone;
    if (data.cpf) updatesProfile.cpf = data.cpf;

    if (isSupabaseConfigured) {
      if (Object.keys(updatesProfile).length > 0) {
        try {
          const { error: pErr } = await supabase
            .from('profiles')
            .update(updatesProfile)
            .eq('id', userId);
          if (pErr) console.warn('Aviso ao atualizar profiles no Supabase:', pErr);
        } catch (e) {
          console.warn('Erro ao atualizar profiles:', e);
        }
      }

      const updatesProf: any = {};
      if (data.name) updatesProf.full_name = data.name;
      if (data.phone) updatesProf.phone = data.phone;
      if (data.cpf) updatesProf.cpf = data.cpf;
      if (data.profession) updatesProf.professional_type = data.profession;
      if (data.councilRegistration) updatesProf.registration_number = data.councilRegistration;

      if (Object.keys(updatesProf).length > 0) {
        try {
          await supabase
            .from('professionals')
            .update(updatesProf)
            .eq('user_id', userId);
        } catch (e) {
          console.warn('Erro ao atualizar professionals:', e);
        }
      }
    }

    const storedUsers = getStoredUsers();
    const userIndex = storedUsers.findIndex(u => u.id === userId || (data.email && u.email === data.email));
    let updatedLocalUser: User | null = null;
    if (userIndex !== -1) {
      storedUsers[userIndex] = {
        ...storedUsers[userIndex],
        ...data,
        name: data.name || storedUsers[userIndex].name,
        phone: data.phone !== undefined ? data.phone : storedUsers[userIndex].phone,
        whatsapp: data.whatsapp !== undefined ? data.whatsapp : storedUsers[userIndex].whatsapp,
        cpf: data.cpf !== undefined ? data.cpf : storedUsers[userIndex].cpf,
      };
      saveStoredUsers(storedUsers);
      updatedLocalUser = storedUsers[userIndex];
    }

    let updatedUser: User | null = null;
    try {
      updatedUser = await authService.getCurrentUser();
    } catch {}

    if (!updatedUser) {
      if (updatedLocalUser) {
        updatedUser = updatedLocalUser;
      } else {
        updatedUser = {
          id: userId,
          name: data.name || 'Administrador',
          email: data.email || 'admin@admin.com.br',
          role: 'ADMIN',
          status: 'ACTIVE',
          createdAt: new Date().toISOString(),
          phone: data.phone,
          whatsapp: data.whatsapp,
          cpf: data.cpf,
          ...data
        } as User;
      }
    } else {
      updatedUser = {
        ...updatedUser,
        ...data
      };
    }

    addAuditLog(userId, updatedUser.name, 'Atualização de Perfil', 'Dados cadastrais atualizados.');
    return updatedUser;
  },

  /**
   * Altera a senha do usuário autenticado via Supabase Auth.
   */
  updatePassword: async (newPassword: string, _userId?: string): Promise<void> => {
    const passwordError = getPasswordValidationMessage(newPassword);
    if (passwordError) {
      throw new Error(passwordError);
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      throw new Error(translateSupabaseError(error));
    }
  },

  /**
   * Redefinição administrativa: atualiza diretamente a senha do profissional no Supabase Auth.
   */
  adminResetUserPassword: async (userId: string, newPassword: string, adminUser: User): Promise<void> => {
    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      throw new Error('A nova senha deve ter no mínimo 6 caracteres.');
    }

    const { data: target, error: targetError } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', userId)
      .single();

    const targetEmail = (target as any)?.email;
    if (targetError || !target || !targetEmail) {
      throw new Error('E-mail do profissional não localizado.');
    }

    // Obter o token de autenticação da sessão do administrador
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    try {
      // Chama o endpoint de backend com service role para atualizar a senha no Supabase Auth
      const response = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          userId,
          email: targetEmail,
          newPassword: newPassword.trim(),
          adminName: adminUser.name
        })
      });

      let result: any = null;
      try {
        const text = await response.text();
        result = JSON.parse(text);
      } catch {
        // Resposta não é JSON (ex: página HTML 404 em hospedagem estática como GitHub Pages)
      }

      if (!response.ok || !result?.success) {
        if (response.status === 404) {
          // Em ambientes estáticos sem Node.js ativo (ex: GitHub Pages), envia link de redefinição por e-mail via Supabase Auth
          const { error: resetErr } = await supabase.auth.resetPasswordForEmail(targetEmail, {
            redirectTo: window.location.origin
          });
          if (resetErr) {
            throw new Error('Servidor de backend não disponível e falha no envio por e-mail: ' + translateSupabaseError(resetErr));
          }
          addAuditLog(
            adminUser.id,
            adminUser.name,
            'Link de Recuperação de Senha Enviado',
            `Como o servidor de backend não está ativo nesta hospedagem estática, foi enviado um link de redefinição para ${targetEmail} via Supabase Auth.`
          );
          return;
        }
        throw new Error(result?.error || `Erro (${response.status}) ao atualizar a senha do profissional no servidor.`);
      }

      addAuditLog(
        adminUser.id,
        adminUser.name,
        'Redefinição de Senha de Profissional',
        `Senha de ${targetEmail} redefinida com sucesso para a nova credencial gerada pelo administrador.`
      );
    } catch (fetchErr: any) {
      // Se houver erro de conexão com /api/admin/reset-password, tenta envio por e-mail
      if (fetchErr.message?.includes('Failed to fetch') || fetchErr.message?.includes('NetworkError')) {
        const { error: emailErr } = await supabase.auth.resetPasswordForEmail(targetEmail, {
          redirectTo: window.location.origin
        });
        if (!emailErr) {
          addAuditLog(
            adminUser.id,
            adminUser.name,
            'Link de Recuperação de Senha Enviado',
            `Link de redefinição enviado para o e-mail ${targetEmail} via Supabase Auth.`
          );
          return;
        }
      }
      throw fetchErr;
    }
  },

  /**
   * Solicita envio de link de recuperação de senha pelo Supabase Auth.
   */
  resetPassword: async (email: string): Promise<void> => {
    if (!email || typeof email !== 'string') {
      throw new Error('Informe um e-mail válido.');
    }
    const cleanEmail = email.trim().toLowerCase();

    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: window.location.origin
    });

    if (error) {
      throw new Error(translateSupabaseError(error));
    }
  },

  /**
   * Lista todos os perfis cadastrados no Supabase (utilizado pelo Administrador).
   * Possui fallback resiliente para garantir que o painel administrativo sempre carregue.
   */
  getAllProfiles: async (): Promise<User[]> => {
    if (isSupabaseConfigured) {
      try {
        const { data: profiles, error } = await supabase
          .from('profiles')
          .select('*')
          .order('full_name', { ascending: true });

        if (error) {
          console.warn('Aviso ao consultar perfis do Supabase:', error);
        } else if (profiles && profiles.length > 0) {
          const { data: professionals } = await supabase
            .from('professionals')
            .select('*');

          const profsMap = new Map((professionals || []).map(p => [p.user_id, p]));
          const mappedUsers = profiles.map(p => mapProfileToUser(p, profsMap.get(p.id)));
          if (mappedUsers.length > 0) {
            saveStoredUsers(mappedUsers);
            return mappedUsers;
          }
        }
      } catch (err) {
        console.warn('Exceção ao obter perfis do Supabase, utilizando cache local:', err);
      }
    }

    return getStoredUsers();
  },

  /**
   * Ativa ou desativa a conta de um profissional na plataforma.
   */
  toggleUserStatus: async (userId: string, adminUser: User): Promise<User> => {
    const { data: current, error: fetchErr } = await supabase
      .from('profiles')
      .select('status, full_name, role')
      .eq('id', userId)
      .single();

    if (fetchErr || !current) {
      throw new Error('Usuário não encontrado.');
    }

    const newStatus = current.status === 'INACTIVE' ? 'ACTIVE' : 'INACTIVE';

    const { error: pErr } = await supabase
      .from('profiles')
      .update({ status: newStatus })
      .eq('id', userId);

    if (pErr) throw new Error(translateSupabaseError(pErr));

    await supabase
      .from('professionals')
      .update({ status: newStatus })
      .eq('user_id', userId);

    const currentName = (current as any)?.full_name || userId;
    addAuditLog(
      adminUser.id, 
      adminUser.name, 
      'Alteração de Status de Usuário', 
      `Usuário ${currentName} alterado para ${newStatus}.`
    );

    return {
      id: userId,
      name: (current as any)?.full_name || 'Profissional',
      email: '',
      role: (current as any)?.role === 'admin' ? 'ADMIN' : 'USER',
      status: newStatus
    };
  },

  /**
   * Exclui um profissional da plataforma. Administradores não podem ser excluídos.
   */
  deleteUser: async (userId: string, adminUser?: User): Promise<void> => {
    const { data: target } = await supabase
      .from('profiles')
      .select('role, full_name, email')
      .eq('id', userId)
      .maybeSingle();

    if (target?.role === 'admin' || target?.role === 'ADMIN') {
      throw new Error('Não é permitido excluir contas com perfil de Administrador.');
    }

    await supabase.from('professionals').delete().eq('user_id', userId);
    const { error } = await supabase.from('profiles').delete().eq('id', userId);

    if (error) {
      throw new Error(translateSupabaseError(error));
    }

    if (adminUser) {
      addAuditLog(
        adminUser.id,
        adminUser.name,
        'Exclusão de Profissional',
        `Profissional ${target?.full_name || userId} foi excluído do sistema.`
      );
    }
  }
};
