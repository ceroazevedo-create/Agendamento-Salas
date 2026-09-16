// Interceptador e limpeza preventiva para erros de sessão/refresh token expirado do Supabase GoTrue
if (typeof window !== 'undefined') {
  const isRefreshTokenError = (str: string): boolean => {
    if (!str) return false;
    const lower = str.toLowerCase();
    return (
      lower.includes('invalid refresh token') ||
      lower.includes('refresh token not found') ||
      lower.includes('refresh_token_not_found') ||
      lower.includes('invalid_grant')
    );
  };

  const cleanInvalidTokens = () => {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sb-') || key.includes('supabase.auth'))) {
          localStorage.removeItem(key);
        }
      }
    } catch {}
  };

  // Intercepta console.error para não emitir erros benignos de refresh token expirado no GoTrue
  const origConsoleError = console.error;
  console.error = (...args: any[]) => {
    const errorStr = args
      .map(arg => (arg instanceof Error ? `${arg.name}: ${arg.message} ${arg.stack || ''}` : typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
      .join(' ');

    if (isRefreshTokenError(errorStr)) {
      cleanInvalidTokens();
      console.warn('[Supabase Auth] Sessão anterior expirada; credenciais locais limpas com sucesso.');
      return;
    }
    origConsoleError.apply(console, args);
  };

  // Intercepta rejeições não tratadas originadas por auto-refresh com token expirado
  window.addEventListener('unhandledrejection', (event) => {
    const reasonStr = event.reason instanceof Error
      ? `${event.reason.name}: ${event.reason.message}`
      : typeof event.reason === 'object'
      ? JSON.stringify(event.reason)
      : String(event.reason || '');

    if (isRefreshTokenError(reasonStr)) {
      event.preventDefault();
      event.stopPropagation();
      cleanInvalidTokens();
      console.warn('[Supabase Auth] Rejeição de refresh token prevenida.');
    }
  });

  // Intercepta erros globais na janela
  window.addEventListener('error', (event) => {
    const msg = event.message || (event.error && event.error.message) || '';
    if (isRefreshTokenError(msg)) {
      event.preventDefault();
      event.stopPropagation();
      cleanInvalidTokens();
    }
  });
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);