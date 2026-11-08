import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: { manager: 'manager.html', popup: 'popup.html', offscreen: 'offscreen.html' },
    },
  },
  worker: { format: 'es' },
});
