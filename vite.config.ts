import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: '/photowall/',
      server: {
        port: 3000,
        host: '0.0.0.0',
        allowedHosts: true,
        proxy: {
          // Proxy API requests to the backend server
          '/photowall/api': {
            target: 'http://localhost:3001',
            changeOrigin: true,
            secure: false,
            rewrite: (path) => path.replace(/^\/photowall/, ''),
          },
          // Proxy Socket.IO connections
          '/photowall/socket.io': {
            target: 'http://localhost:3001',
            changeOrigin: true,
            ws: true,
            rewrite: (path) => path.replace(/^\/photowall/, ''),
          },
        },
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        outDir: 'dist',
        sourcemap: true,
      }
    };
});
