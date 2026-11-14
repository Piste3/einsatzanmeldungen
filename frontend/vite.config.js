import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

// Die Browser-App liegt während des Umbaus unter /neu/. Beim Umschalten (Schritt 8) wechselt die Basis auf «/».
export default defineConfig({
  base: process.env.KKB_BASE || '/neu/',
  plugins: [vue()],
  resolve: {
    alias: {
      // Datums-, Bezeichnungs- und Sortierfunktionen gibt es nur einmal (Backend und Browser-App teilen sie)
      '@lib': path.resolve(__dirname, '../src/lib'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), form: path.resolve(__dirname, 'form.html') } },
    emptyOutDir: true,
    commonjsOptions: { include: [/node_modules/, /src[\\/]lib[\\/]/], transformMixedEsModules: true },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3010', '/static': 'http://localhost:3010', '/live': { target: 'ws://localhost:3010', ws: true } },
  },
});
