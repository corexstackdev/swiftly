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
    port: 5173,
    proxy: {
      // Same-origin in development so the auth cookies behave exactly as they
      // will in production behind one hostname.
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: false,
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
