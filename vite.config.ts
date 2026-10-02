import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3200,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3201',
        changeOrigin: true,
      },
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/.agents/**', '**/dist/**'],
  },
})
