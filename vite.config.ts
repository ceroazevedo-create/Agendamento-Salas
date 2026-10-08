import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const safeSupabaseUrl =
      env.VITE_SUPABASE_URL && !env.VITE_SUPABASE_URL.startsWith('sb_secret_')
        ? env.VITE_SUPABASE_URL
        : 'https://gqpavuqopukyfeyqyrxc.supabase.co';
    const safeSupabaseAnonKey =
      env.VITE_SUPABASE_ANON_KEY && !env.VITE_SUPABASE_ANON_KEY.startsWith('sb_secret_')
        ? env.VITE_SUPABASE_ANON_KEY
        : 'sb_publishable_idoSyVhNDWy33hjn4xCUpw_wjpcB8CS';

    return {
      base: '/Agendamento-Salas/',
      server: {
        port: 3000,
        host: '0.0.0.0',
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
