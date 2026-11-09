import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
}

export interface PagesFunctionContext<EnvType = Env> {
  request: Request;
  env: EnvType;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function getSupabaseAdmin(env: Env) {
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim();
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceKey) {
    throw new Error('Configuração administrativa do Supabase ausente no servidor.');
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/**
 * POST /api/admin/delete-professional
 * Remove o cadastro operacional, apaga reservas futuras e preserva histórico.
 * A chave service_role existe somente no ambiente do Cloudflare Pages.
 */
export const onRequestPost = async (context: PagesFunctionContext<Env>): Promise<Response> => {
  try {
    const { request, env } = context;
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Não autorizado. Sessão administrativa ausente.' }, 401);
    }

    const token = authorization.slice(7).trim();
    if (!token) return jsonResponse({ error: 'Token administrativo inválido.' }, 401);

    let body: { userId?: string };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Corpo da requisição inválido.' }, 400);
    }

    const userId = String(body?.userId || '').trim();
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(userId)) {
      return jsonResponse({ error: 'Identificador do profissional inválido.' }, 400);
    }

    const admin = getSupabaseAdmin(env);
    const { data: callerData, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return jsonResponse({ error: 'Sessão administrativa inválida ou expirada.' }, 401);
    }

    const { data: callerProfile, error: callerProfileError } = await admin
      .from('profiles')
      .select('role, status')
      .eq('id', callerData.user.id)
      .maybeSingle();

    if (callerProfileError) {
      return jsonResponse({ error: 'Não foi possível validar o administrador.' }, 500);
    }

    if (String(callerProfile?.role || '').toLowerCase() !== 'admin' ||
        String(callerProfile?.status || '').toUpperCase() !== 'ACTIVE') {
      return jsonResponse({ error: 'Somente um administrador ativo pode excluir profissionais.' }, 403);
    }

    if (callerData.user.id === userId) {
      return jsonResponse({ error: 'O administrador não pode excluir a própria conta por esta operação.' }, 403);
    }

    const { data: target, error: targetError } = await admin
      .from('profiles')
      .select('role, status, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (targetError) return jsonResponse({ error: 'Falha ao localizar o profissional.' }, 500);
    if (!target) return jsonResponse({ error: 'Profissional não encontrado.' }, 404);
    if (String(target.role || '').toLowerCase() !== 'professional') {
      return jsonResponse({ error: 'Não é permitido excluir contas administrativas.' }, 403);
    }

    // Confirma a identidade Auth antes de alterar o banco, evitando remoção parcial
    // quando o usuário de autenticação já não existe.
    const { data: authBefore, error: authBeforeError } = await admin.auth.admin.getUserById(userId);
    if (authBeforeError || !authBefore?.user) {
      return jsonResponse({
        error: 'Não foi possível confirmar a conta deste profissional no Supabase Auth. Nenhuma alteração foi feita no cadastro ou nos agendamentos.',
        partial: false
      }, 409);
    }

    // A função SQL é transacional e idempotente; retries não repetem a auditoria.
    const { data: removal, error: removalError } = await admin.rpc('admin_remove_professional', {
      p_user_id: userId,
      p_admin_user_id: callerData.user.id
    });

    if (removalError) {
      return jsonResponse({ error: removalError.message || 'Falha ao remover o profissional do banco.' }, 500);
    }

    // Soft delete preserva profiles e as FKs do histórico. Se a tentativa anterior
    // já concluiu o Auth, deleted_at evita repetir a operação.
    if (!(authBefore.user as any).deleted_at) {
      const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId, true);
      if (authDeleteError) {
        return jsonResponse({
          error: 'O cadastro já foi retirado e marcado como inativo, mas a desativação no Supabase Auth não foi confirmada. Você pode tentar novamente; o banco não repetirá a exclusão dos agendamentos nem a auditoria.',
          partial: true,
          removal
        }, 502);
      }
    }

    return jsonResponse({
      success: true,
      message: 'Profissional removido. Reservas futuras excluídas; histórico e pagamentos preservados.',
      removal
    });
  } catch (error: any) {
    return jsonResponse({ error: error?.message || 'Erro interno ao excluir profissional.' }, 500);
  }
};
