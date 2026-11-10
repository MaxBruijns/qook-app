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
      // Twee pagina's: de landingspagina (/) en de app (/app/).
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            app: path.resolve(__dirname, 'app/index.html'),
          },
        },
      },
      resolve: {
        alias: {
  '@': path.resolve(__dirname, './'),
}
      }
    };
});
