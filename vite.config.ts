import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Lokaal ontwikkelen: start ook `npx wrangler dev` (poort 8787)
        proxy: { '/api': 'http://localhost:8787' },
      },
      plugins: [react()],
      resolve: {
        alias: {
  '@': path.resolve(__dirname, './'),
}
      }
    };
});
