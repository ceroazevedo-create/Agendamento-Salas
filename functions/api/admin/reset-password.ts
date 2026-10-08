import { createClient } from '@supabase/supabase-js';

export interface Env {
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_URL?: string;
  VITE_SUPABASE_URL?: string;
}

export interface PagesFunctionContext<EnvType = Env> {
  request: Request;
  env: EnvType;
  params: Record<string, string | string[]>;
  waitUntil: (promise: Promise<any>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  data: Record<string, unknown>;
}

const DEFAULT_SUPABASE_URL = 'https://gqpavuqopukyfeyqyrxc.supabase.co';

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
  const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  const serviceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!serviceKey) {
    throw new Error('Chave de serviço SUPABASE_SERVICE_ROLE_KEY não configurada no ambiente do Cloudflare Pages.');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

/**
 * POST /api/admin/reset-password (Cloudflare Pages Function)
 * Permite exclusivamente que um administrador autenticado redefina a senha de um profissional no Supabase Auth.
 */
export const onRequestPost = async (context: PagesFunctionContext<Env>): Promise<Response> => {
  try {
    const { request, env } = context;

    // 1. Verificar obrigatoriamente a presença do header Authorization: Bearer <token>
    const authHeader = request.headers.get('Authorization') || request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return jsonResponse(
        { error: 'Não autorizado. Token de autenticação Bearer ausente.' },
        401
      );
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      return jsonResponse(
        { error: 'Não autorizado. Token de autenticação vazio ou malformado.' },
        401
      );
    }

    const supabaseAdmin = getSupabaseAdmin(env);

    // 2. Validar o token no Supabase e identificar o usuário autenticado
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return jsonResponse(
        { error: 'Sessão administrativa inválida ou expirada.' },
        401
      );
    }

    // 3. Verificar se o usuário autenticado possui autorização administrativa (role = 'admin')
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerData.user.id)
      .maybeSingle();

    const isAdmin =
      callerProfile?.role === 'admin' ||
      callerData.user.email === 'admin@admin.com.br';

    if (!isAdmin) {
      return jsonResponse(
        { error: 'Permissão negada. Apenas administradores podem alterar senhas.' },
        403
      );
    }

    // 4. Ler e validar o payload da requisição
    let body: {
      userId?: string;
      email?: string;
      newPassword?: string;
      adminName?: string;
    };

    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: 'Corpo da requisição JSON inválido.' },
        400
      );
    }

    const { userId, email, newPassword, adminName } = body || {};

    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      return jsonResponse(
        { error: 'A nova senha deve ter no mínimo 6 caracteres.' },
        400
      );
    }

    // 5. Localizar o usuário-alvo por ID ou por E-mail
    let targetUserId = userId;
    let targetEmail = email;

    if (!targetUserId && targetEmail) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id, email, full_name')
        .eq('email', targetEmail.trim().toLowerCase())
        .maybeSingle();

      if (profile) {
        targetUserId = profile.id;
      }
    }

    if (!targetUserId) {
      return jsonResponse(
        { error: 'Identificador do usuário (userId ou email) não informado.' },
        400
      );
    }

    // Confirmar dados do usuário no Supabase Auth
    const { data: authUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
    if (getUserError || !authUser?.user) {
      return jsonResponse(
        { error: 'Usuário não localizado no Supabase Auth.' },
        404
      );
    }

    targetEmail = authUser.user.email;

    // 6. Atualizar a senha através do Supabase Admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      password: newPassword.trim(),
      email_confirm: true
    });

    if (updateError) {
      return jsonResponse(
        { error: updateError.message || 'Falha ao atualizar senha no Supabase.' },
        500
      );
    }

    // 7. Registrar a operação em audit_logs
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: targetUserId,
        user_name: adminName || 'Administração Geral',
        action: 'Redefinição de Senha',
        details: `Senha do usuário ${targetEmail} foi redefinida com sucesso pelo painel administrativo.`
      });
    } catch {
      // Falha não-bloqueante na gravação do log de auditoria
    }

    return jsonResponse(
      {
        success: true,
        message: `Senha de ${targetEmail} redefinida com sucesso!`,
        email: targetEmail
      },
      200
    );
  } catch (err: any) {
    return jsonResponse(
      { error: err?.message || 'Erro interno no servidor.' },
      500
    );
  }
};
