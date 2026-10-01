import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The static build (GitHub Pages) uses a relative base so it works under any subpath.
export default defineConfig(({ mode }) => ({
  base: process.env.VITE_BASE ?? (mode === 'static' ? './' : '/'),
  plugins: [react()],
  build: { chunkSizeWarningLimit: 650 },
}));
