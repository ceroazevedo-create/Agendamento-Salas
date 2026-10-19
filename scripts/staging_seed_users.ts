/**
 * Provisionamento Idempotente de Usuários de Teste em Staging - LocaPsico
 * Arquivo: scripts/staging_seed_users.ts
 * 
 * Regras:
 * - Paginação real de listUsers da Supabase Admin API
 * - Comparação case-insensitive de e-mails
 * - Tratamento de concorrência e recuperação segura
 * - Verificação pós-criação da trigger em public.profiles e public.professionals
 * - Atribuição restrita de papel de administrador exclusivamente ao admin de teste
 * - Zero senhas fixas ou credenciais em log
 */

import { createClient, SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import crypto from 'crypto';
import { assertStagingEnvironmentSafe } from './stagingGuard';

const STAGING_URL = process.env.STAGING_SUPABASE_URL || '';
const STAGING_REF = process.env.STAGING_PROJECT_REF || '';
const SERVICE_ROLE_KEY = process.env.STAGING_SERVICE_ROLE_KEY || '';

export interface StagingTestUser {
  id: string;
  email: string;
  fullName: string;
  role: 'professional' | 'admin';
}

/**
 * Gera senha forte criptográfica em tempo de execução
 */
export function generateEphemeralPassword(): string {
  return crypto.randomBytes(24).toString('base64url') + '!A9#x';
}

/**
 * Busca usuário paginando por toda a lista de usuários no Supabase Auth
 */
async function findUserByEmailPaginated(
  supabaseAdmin: SupabaseClient,
  targetEmail: string
): Promise<SupabaseUser | null> {
  const normalizedTarget = targetEmail.trim().toLowerCase();
  let page = 1;
  const perPage = 50;

  while (page <= 20) { // limite de segurança de até 1.000 usuários de teste
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      throw new Error(`Falha ao paginar usuários no Auth de staging: ${error.message}`);
    }

    if (!data.users || data.users.length === 0) {
      break;
    }

    const match = data.users.find(u => (u.email || '').trim().toLowerCase() === normalizedTarget);
    if (match) {
      return match;
    }

    if (data.users.length < perPage) {
      break;
    }

    page++;
  }

  return null;
}

/**
 * Cria ou recupera de maneira estritamente idempotente o usuário de teste
 */
async function ensureStagingUser(
  supabaseAdmin: SupabaseClient,
  email: string,
  fullName: string,
  userMetadata: Record<string, any>
): Promise<string> {
  // 1. Busca prévia com paginação real
  const existing = await findUserByEmailPaginated(supabaseAdmin, email);
  if (existing) {
    return existing.id;
  }

  // 2. Criação limpa caso não exista
  const password = process.env.STAGING_TEST_PASSWORD || generateEphemeralPassword();

  const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      ...userMetadata,
      full_name: fullName,
      name: fullName
    }
  });

  if (createError) {
    // Trata corrida concorrente (se criado simultaneamente por outro processo)
    if (createError.message.toLowerCase().includes('already') || (createError as any).status === 422) {
      const recovered = await findUserByEmailPaginated(supabaseAdmin, email);
      if (recovered) {
        return recovered.id;
      }
    }
    throw new Error(`Erro ao criar usuário de teste (${email}): ${createError.message}`);
  }

  return createData.user.id;
}

/**
 * Verifica integridade das tabelas public.profiles e public.professionals
 * geradas pela trigger on_auth_user_created
 */
async function verifyUserProfilesAndRoles(
  supabaseAdmin: SupabaseClient,
  userId: string,
  email: string,
  expectedRole: 'professional' | 'admin'
): Promise<void> {
  // 1. Aguarda e consulta o perfil criado pela trigger
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, full_name, role, status')
    .eq('id', userId)
    .single();

  if (profErr || !profile) {
    throw new Error(`Trigger on_auth_user_created não gerou o perfil para ${email} (${userId}): ${profErr?.message}`);
  }

  // 2. Se for o usuário administrativo de teste, garante a elevação do papel de forma explícita
  if (expectedRole === 'admin' && profile.role !== 'admin') {
    const { error: updateErr } = await supabaseAdmin
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', userId);

    if (updateErr) {
      throw new Error(`Falha ao conceder papel de admin ao usuário de teste ${email}: ${updateErr.message}`);
    }
  }

  // 3. Para profissionais, confirma registro em public.professionals
  if (expectedRole === 'professional') {
    const { data: professional, error: proErr } = await supabaseAdmin
      .from('professionals')
      .select('id, user_id, status')
      .eq('user_id', userId)
      .single();

    if (proErr || !professional) {
      throw new Error(`Trigger on_auth_user_created não gerou o registro de professional para ${email}: ${proErr?.message}`);
    }
  }
}

/**
 * Função principal de seed para ser chamada por orquestradores de teste
 */
export async function seedStagingTestEnvironment(): Promise<StagingTestUser[]> {
  // 1. Barreira de segurança obrigatória
  assertStagingEnvironmentSafe(STAGING_URL, STAGING_REF, SERVICE_ROLE_KEY);

  const supabaseAdmin = createClient(STAGING_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // 2. Provisionamento das contas sintéticas de teste
  const prof1Id = await ensureStagingUser(
    supabaseAdmin,
    'profissional1.teste@locapsico.local',
    'Dr. Teste Recorrência 1',
    {
      cpf: '000.111.222-33',
      phone: '(11) 90000-0001',
      profession: 'Psicólogo(a)',
      councilRegistration: 'CRP 06/TESTE1'
    }
  );
  await verifyUserProfilesAndRoles(supabaseAdmin, prof1Id, 'profissional1.teste@locapsico.local', 'professional');

  const prof2Id = await ensureStagingUser(
    supabaseAdmin,
    'profissional2.teste@locapsico.local',
    'Dra. Teste Concorrência 2',
    {
      cpf: '000.444.555-66',
      phone: '(11) 90000-0002',
      profession: 'Psicólogo(a)',
      councilRegistration: 'CRP 06/TESTE2'
    }
  );
  await verifyUserProfilesAndRoles(supabaseAdmin, prof2Id, 'profissional2.teste@locapsico.local', 'professional');

  const adminId = await ensureStagingUser(
    supabaseAdmin,
    'admin.teste@locapsico.local',
    'Admin Teste Homologação',
    {
      cpf: '000.777.888-99',
      phone: '(11) 90000-0003'
    }
  );
  await verifyUserProfilesAndRoles(supabaseAdmin, adminId, 'admin.teste@locapsico.local', 'admin');

  return [
    { id: prof1Id, email: 'profissional1.teste@locapsico.local', fullName: 'Dr. Teste Recorrência 1', role: 'professional' },
    { id: prof2Id, email: 'profissional2.teste@locapsico.local', fullName: 'Dra. Teste Concorrência 2', role: 'professional' },
    { id: adminId, email: 'admin.teste@locapsico.local', fullName: 'Admin Teste Homologação', role: 'admin' }
  ];
}
