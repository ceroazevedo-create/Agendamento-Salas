import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';

const PORT = 3000;
const app = express();

app.use(express.json());

// Supabase Admin Client (Service Role)
const supabaseUrl = 'https://gqpavuqopukyfeyqyrxc.supabase.co';

function getSupabaseAdmin() {
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    (process.env.VITE_SUPABASE_URL?.startsWith('sb_secret_') ? process.env.VITE_SUPABASE_URL : '') ||
    '';

  if (!serviceKey) {
    throw new Error('Chave de serviço SUPABASE_SERVICE_ROLE_KEY não configurada no ambiente do servidor.');
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

// API Routes
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * POST /api/admin/reset-password
 * Permite que a administração defina ou redefina diretamente a senha de qualquer profissional no Supabase Auth.
 */
app.post('/api/admin/reset-password', async (req: Request, res: Response) => {
  try {
    const { userId, email, newPassword, adminName } = req.body;

    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 6) {
      return res.status(400).json({
        error: 'A nova senha deve ter no mínimo 6 caracteres.'
      });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Validar autenticação do administrador via token Bearer (se fornecido)
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
      if (callerError || !callerData.user) {
        return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
      }

      // Checa se o usuário que está chamando é admin
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', callerData.user.id)
        .maybeSingle();

      const isAdmin = callerProfile?.role === 'admin' || callerData.user.email === 'admin@admin.com.br';
      if (!isAdmin) {
        return res.status(403).json({ error: 'Permissão negada. Apenas administradores podem alterar senhas.' });
      }
    }

    // 2. Localizar o usuário de destino por ID ou por E-mail
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
      return res.status(400).json({ error: 'Identificador do usuário (userId ou email) não informado.' });
    }

    // Confirma dados do usuário no Supabase Auth
    const { data: authUser, error: getUserError } = await supabaseAdmin.auth.admin.getUserById(targetUserId);
    if (getUserError || !authUser?.user) {
      return res.status(404).json({ error: 'Usuário não localizado no Supabase Auth.' });
    }

    targetEmail = authUser.user.email;

    // 3. Atualizar a senha diretamente no Supabase Auth
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, {
      password: newPassword.trim(),
      email_confirm: true // Garante confirmação de e-mail ativa para login imediato
    });

    if (updateError) {
      console.error('Erro ao atualizar senha no Supabase:', updateError);
      return res.status(500).json({ error: updateError.message || 'Falha ao atualizar senha no Supabase.' });
    }

    // 4. Registrar em audit_logs
    try {
      await supabaseAdmin.from('audit_logs').insert({
        user_id: targetUserId,
        user_name: adminName || 'Administração Geral',
        action: 'Redefinição de Senha',
        details: `Senha do usuário ${targetEmail} foi redefinida com sucesso pelo painel administrativo.`
      });
    } catch (auditErr) {
      console.warn('Aviso: falha ao gravar log de auditoria:', auditErr);
    }

    console.log(`[AUTH] Senha de ${targetEmail} redefinida com sucesso no Supabase.`);
    return res.json({
      success: true,
      message: `Senha de ${targetEmail} redefinida com sucesso!`,
      email: targetEmail
    });
  } catch (err: any) {
    console.error('Erro inesperado na rota /api/admin/reset-password:', err);
    return res.status(500).json({ error: err.message || 'Erro interno no servidor.' });
  }
});

// Start Server & Vite Middleware Setup
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LocaPsico Server running at http://0.0.0.0:${PORT}`);
  });
}

start();
