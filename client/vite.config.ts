import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 12000,
    host: true,
    // Vite refuses requests whose Host header it does not recognise. The
    // runtime exposes the dev server through a generated hostname, so it is
    // allowed explicitly rather than disabling the check with `true`.
    allowedHosts: [
      'localhost',
      '.prod-runtime.all-hands.dev',
      ...(process.env.VITE_ALLOWED_HOSTS?.split(',').filter(Boolean) ?? []),
    ],
    // The API runs on its own port in development. Proxying /api keeps the
    // browser on a single origin, so the session cookie is first-party and no
    // CORS preflight is needed for the dev setup.
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:12001',
        changeOrigin: true,
        // Sends cookies through the proxy so the dev session behaves exactly
        // like the deployed one.
        cookieDomainRewrite: 'localhost',
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
