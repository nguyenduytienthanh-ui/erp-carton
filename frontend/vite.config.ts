import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@ant-design/icons')) {
            return 'vendor-antd-icons';
          }
          if (id.includes('@tanstack/react-query')) {
            return 'vendor-query';
          }
          if (id.includes('dayjs')) {
            return 'vendor-dayjs';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    host: '127.0.0.1', // Ensure Vite listens on IPv4
    port: 5173,
  },
})
