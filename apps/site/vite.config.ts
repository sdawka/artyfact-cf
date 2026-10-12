import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { manifest: true, rollupOptions: { input: 'src/client.tsx' } },
  preview: { host: '127.0.0.1', port: 4180, strictPort: true },
});
