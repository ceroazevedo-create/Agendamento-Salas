import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
    const env = loadEnv(mode, '.', '');

    // Constantes dos projetos Supabase
    const PROD_REF = 'gqpavuqopukyfeyqyrxc';
    const STAGING_REF = 'rhuwvnusbzdgoaarhbkr';
    const PROD_DEFAULT_URL = `https://${PROD_REF}.supabase.co`;
    const PROD_DEFAULT_ANON_KEY = 'sb_publishable_idoSyVhNDWy33hjn4xCUpw_wjpcB8CS';
    const STAGING_DEFAULT_URL = `https://${STAGING_REF}.supabase.co`;

    // Proteção contra chave secreta (service_role) na chave pública do cliente
    if (env.VITE_SUPABASE_ANON_KEY?.startsWith('sb_secret_')) {
      throw new Error('[BARREIRA DE SEGURANÇA] Chave secreta detectada em VITE_SUPABASE_ANON_KEY! Jamais utilize service_role ou chaves secretas no cliente web.');
    }

    // Sanitiza a URL: valores que não sejam http(s) (ex: placeholders ou variáveis de ambiente com prefixes desconhecidos) são desconsiderados
    const rawInputUrl = (env.VITE_SUPABASE_URL || '').trim();
    const isHttpUrl = rawInputUrl.startsWith('https://') || rawInputUrl.startsWith('http://');
    const inputUrl = isHttpUrl ? rawInputUrl : '';

    let safeSupabaseUrl = '';
    let safeSupabaseAnonKey = '';

    if (mode === 'staging') {
      if (inputUrl && inputUrl.includes(PROD_REF)) {
        throw new Error(`[BARREIRA DE SEGURANÇA] BLOQUEIO CRÍTICO: Tentativa de usar URL de PRODUÇÃO (${PROD_REF}) no modo de homologação (staging)!`);
      }
      if (inputUrl && !inputUrl.includes(STAGING_REF)) {
        throw new Error(`[BARREIRA DE SEGURANÇA] URL informada não corresponde ao projeto de homologação autorizado (${STAGING_REF}).`);
      }

      safeSupabaseUrl = STAGING_DEFAULT_URL;

      const inputAnonKey = (env.VITE_SUPABASE_ANON_KEY || '').trim();
      if (inputAnonKey === PROD_DEFAULT_ANON_KEY) {
        throw new Error('[BARREIRA DE SEGURANÇA] A chave anônima de PRODUÇÃO não pode ser usada no ambiente de homologação (staging)!');
      }

      if (!inputAnonKey) {
        if (command === 'build') {
          throw new Error(`[CONFIGURAÇÃO STAGING INCOMPLETA] VITE_SUPABASE_ANON_KEY para homologação (${STAGING_REF}) não foi definida. Configure a chave pública em .env.staging.local antes de realizar o build de staging.`);
        }
        // No dev server, permite subir com chave vazia para que a interface informe ao usuário a instrução de configuração
        safeSupabaseAnonKey = '';
      } else {
        safeSupabaseAnonKey = inputAnonKey;
      }
    } else {
      // Modo Produção (padrão)
      const inputUrl = (env.VITE_SUPABASE_URL || '').trim();
      if (inputUrl && inputUrl.includes(STAGING_REF)) {
        throw new Error(`[BARREIRA DE SEGURANÇA] BLOQUEIO: URL de homologação (${STAGING_REF}) detectada em modo de produção!`);
      }

      safeSupabaseUrl = inputUrl || PROD_DEFAULT_URL;
      safeSupabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY || '').trim() || PROD_DEFAULT_ANON_KEY;
    }

    const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
    const base = env.VITE_BASE || (isGitHubActions ? '/Agendamento-Salas/' : '/');

    return {
      base,
      server: {
        port: 3000,
        host: '0.0.0.0',
        hmr: false,
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(safeSupabaseUrl),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(safeSupabaseAnonKey)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
