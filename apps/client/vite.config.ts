import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Same-origin in development so the auth cookies behave exactly as they
      // will in production behind one hostname.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
        configure(proxy) {
          // Login sets access_token and refresh_token as two Set-Cookie headers.
          // If the proxy collapses them, refresh never lands in the browser and
          // every draft save 401s once the 15-minute access cookie expires.
          proxy.on('proxyRes', (proxyRes) => {
            const cookies = proxyRes.headers['set-cookie'];
            if (!cookies) return;
            const list = Array.isArray(cookies) ? cookies : [cookies];
            proxyRes.headers['set-cookie'] = list.map((cookie) =>
              cookie.replace(/;\s*Domain=[^;]*/i, ''),
            );
          });
        },
      },
    },
  },
  build: {
    // 'hidden' emits maps without the `//# sourceMappingURL` comment: an error
    // tracker can still consume them, but a browser will not fetch them, so the
    // original sources are not served to anyone who opens devtools.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          // The editor is heavy and end users of published apps never load it.
          vendor: ['react', 'react-dom', 'react-router-dom'],
          table: ['@tanstack/react-table', '@tanstack/react-virtual'],
        },
      },
    },
  },
});
