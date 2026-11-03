import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // rutas relativas: funciona en la raíz de un dominio y en subcarpetas (GitHub Pages)
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['lcms-wasm'],
    // evitar recargas a mitad de sesión cuando se abre por primera vez un módulo pesado
    include: ['imagetracerjs', 'utif', 'ag-psd', 'jspdf', 'pdfjs-dist'],
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  server: { port: 5173 },
});
