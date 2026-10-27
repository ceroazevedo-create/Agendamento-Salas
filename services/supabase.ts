import { createClient } from '@supabase/supabase-js';

/**
 * CONFIGURAÇÃO DO CLIENTE SUPABASE
 * Suporta variáveis de ambiente (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY)
 * e chaves de produção configuradas.
 */

declare global {
  interface ImportMetaEnv {
    readonly MODE?: string;
    readonly VITE_SUPABASE_URL?: string;
    readonly VITE_SUPABASE_ANON_KEY?: string;
  }
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }
}

export const PRODUCTION_PROJECT_REF = 'gqpavuqopukyfeyqyrxc';
export const STAGING_PROJECT_REF = 'rhuwvnusbzdgoaarhbkr';

// Valores padrão para o projeto de produção sistema-salas (gqpavuqopukyfeyqyrxc)
const prodDefaultUrl = `https://${PRODUCTION_PROJECT_REF}.supabase.co`;
const prodDefaultAnonKey = 'sb_publishable_idoSyVhNDWy33hjn4xCUpw_wjpcB8CS';
const stagingDefaultUrl = `https://${STAGING_PROJECT_REF}.supabase.co`;

const currentMode =
  (typeof import.meta !== 'undefined' && import.meta.env?.MODE) ||
  (typeof process !== 'undefined' && (process.env?.NODE_ENV || process.env?.MODE)) ||
  'production';

const unparsedEnvUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_URL) ||
  '';
const rawEnvUrl = (unparsedEnvUrl.startsWith('http://') || unparsedEnvUrl.startsWith('https://')) ? unparsedEnvUrl : '';

const rawEnvAnonKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && process.env?.VITE_SUPABASE_ANON_KEY) ||
  '';

// Determina o ambiente ativo
export type SupabaseEnvironment = 'staging' | 'production' | 'unknown';
export const supabaseEnvironment: SupabaseEnvironment =
  currentMode === 'staging' || rawEnvUrl.includes(STAGING_PROJECT_REF)
    ? 'staging'
    : (currentMode === 'production' || rawEnvUrl.includes(PRODUCTION_PROJECT_REF) || !rawEnvUrl)
      ? 'production'
      : 'unknown';

// Validação com fail-closed
let configError: string | null = null;
let resolvedUrl = '';
let resolvedAnonKey = '';

if (supabaseEnvironment === 'staging') {
  // Staging: NUNCA permite conexão ao banco de produção
  if (rawEnvUrl && rawEnvUrl.includes(PRODUCTION_PROJECT_REF)) {
    configError = `[BLOQUEIO DE SEGURANÇA] Tentativa de conectar ao banco de PRODUÇÃO (${PRODUCTION_PROJECT_REF}) em ambiente de homologação (staging). Operação cancelada.`;
  } else if (rawEnvAnonKey === prodDefaultAnonKey) {
    configError = `[BLOQUEIO DE SEGURANÇA] A chave anônima de PRODUÇÃO não pode ser utilizada no projeto de homologação (${STAGING_PROJECT_REF}).`;
  } else if (!rawEnvAnonKey) {
    configError = `[CONFIGURAÇÃO PENDENTE] Chave pública (VITE_SUPABASE_ANON_KEY) de homologação não foi configurada para o projeto ${STAGING_PROJECT_REF}. Defina VITE_SUPABASE_ANON_KEY no arquivo .env.staging.local.`;
  } else {
    resolvedUrl = rawEnvUrl || stagingDefaultUrl;
    resolvedAnonKey = rawEnvAnonKey;
  }
} else if (supabaseEnvironment === 'production') {
  // Produção: NUNCA permite conectar a staging por engano
  if (rawEnvUrl && rawEnvUrl.includes(STAGING_PROJECT_REF)) {
    configError = `[BLOQUEIO DE SEGURANÇA] URL do projeto de homologação (${STAGING_PROJECT_REF}) informada em ambiente de PRODUÇÃO. Operação cancelada.`;
  } else {
    resolvedUrl = rawEnvUrl || prodDefaultUrl;
    resolvedAnonKey = rawEnvAnonKey || prodDefaultAnonKey;
  }
} else {
  configError = `[CONFIGURAÇÃO INVÁLIDA] Ambiente Supabase desconhecido. Verifique as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.`;
}

if (configError) {
  console.error('[Supabase Config Error]', configError);
}

// Funções para sanitizar URL e Chave do Supabase
function sanitizeUrl(url?: string): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;
  try {
    const parsed = new URL(trimmed);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') ? trimmed : null;
  } catch {
    return null;
  }
}

function sanitizeAnonKey(key?: string): string | null {
  if (!key || typeof key !== 'string') return null;
  const trimmed = key.trim();
  // Chaves públicas válidas do Supabase são tokens JWT (iniciando com 'eyJ') ou chaves publicáveis (iniciando com 'sb_publishable_')
  if (trimmed.startsWith('eyJ') || trimmed.startsWith('sb_publishable_')) {
    return trimmed;
  }
  return null;
}

// Obtenção da URL e Chave validadas
const validResolvedUrl = sanitizeUrl(resolvedUrl);
const validResolvedKey = sanitizeAnonKey(resolvedAnonKey);

export const supabaseConfigError: string | null = configError;
export const supabaseUrl: string = (!configError && validResolvedUrl) ? validResolvedUrl : 'https://placeholder.supabase.co';
export const supabaseAnonKey: string = (!configError && validResolvedKey) ? validResolvedKey : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy';

export const isKeyFromClerk = false;

export const isSupabaseConfigured: boolean = Boolean(
  !supabaseConfigError &&
  supabaseUrl &&
  !supabaseUrl.includes('placeholder') &&
  (supabaseUrl.startsWith('https://') || supabaseUrl.startsWith('http://')) &&
  supabaseAnonKey &&
  (supabaseAnonKey.startsWith('eyJ') || supabaseAnonKey.startsWith('sb_publishable_')) &&
  !supabaseAnonKey.includes('dummy')
);

// Utilitário para limpar tokens residuais ou corrompidos do Supabase Auth
export function clearSupabaseStorageTokens() {
  if (typeof window === 'undefined') return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('supabase.auth'))) {
        localStorage.removeItem(key);
      }
    }
  } catch {}
}

// Storage adapter seguro com tratamento de exceções
const safeSupabaseStorage = typeof window !== 'undefined' ? {
  getItem: (key: string): string | null => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      window.localStorage.setItem(key, value);
    } catch {}
  },
  removeItem: (key: string): void => {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }
} : undefined;

// Cliente oficial do Supabase com inicialização segura contra falhas de URL
let clientInstance: ReturnType<typeof createClient>;
try {
  clientInstance = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: safeSupabaseStorage,
      // Desativa o navigator.locks do browser que causa deadlocks em iframes sandboxed
      lock: async (_name, _acquireTimeout, fn) => {
        return await fn();
      }
    }
  });
} catch (err) {
  console.warn('Aviso: Falha ao instanciar createClient do Supabase, utilizando fallback:', err);
  clientInstance = createClient('https://placeholder.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy', {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      lock: async (_name, _acquireTimeout, fn) => {
        return await fn();
      }
    }
  });
}

export const supabase = clientInstance;

/**
 * Tradutor de Erros do Supabase para Mensagens Amigáveis em Português (Seção 39)
 */
export function translateSupabaseError(error: any): string {
  if (!error) return 'Ocorreu um erro desconhecido.';
  const msg = typeof error === 'string' ? error : (error.message || error.error_description || '');

  if (
    msg.includes('Invalid Refresh Token') || 
    msg.includes('refresh_token_not_found') || 
    msg.includes('Refresh Token Not Found') ||
    msg.includes('invalid_grant')
  ) {
    clearSupabaseStorageTokens();
    return 'Sua sessão anterior expirou. Por favor, faça login novamente.';
  }

  if (msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
    return 'E-mail ou senha incorretos.';
  }
  if (msg.includes('Email not confirmed') || msg.includes('email_not_confirmed')) {
    return 'E-mail ainda não confirmado. Desative a opção "Confirm email" no painel do Supabase (Authentication -> Providers -> Email) ou clique no link enviado para seu e-mail.';
  }
  if (msg.includes('User already registered') || msg.includes('already exists')) {
    return 'Este e-mail já está cadastrado no sistema.';
  }
  if (msg.includes('duplicate key value') || msg.includes('unique constraint')) {
    return 'Este horário acabou de ser reservado por outra pessoa. Escolha outro horário.';
  }
  if (msg.includes('As salas não são utilizadas aos domingos')) {
    return 'As salas não são utilizadas aos domingos.';
  }
  if (msg.includes('Horário bloqueado pela administração') || msg.includes('bloqueado')) {
    return 'O horário selecionado está bloqueado pela administração.';
  }
  if (msg.includes('Este horário já está reservado')) {
    return 'Este horário já está reservado nesta sala. Escolha outro horário.';
  }
  if (msg.includes('JWT') || msg.includes('token is expired') || msg.includes('session')) {
    return 'Sua sessão expirou. Por favor, faça login novamente.';
  }
  if (msg.includes('Failed to fetch') || msg.includes('network') || msg.includes('NetworkError')) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.';
  }
  if (msg.includes('Password should be at least')) {
    return 'A senha deve ter no mínimo 6 caracteres.';
  }
  if (msg.includes('row-level security') || msg.includes('policy')) {
    return 'Acesso não autorizado para esta operação.';
  }

  return msg || 'Ocorreu uma falha ao processar a requisição.';
}
