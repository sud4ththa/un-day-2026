import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode, command }) => {
  const demo = mode === 'demo'
  return {
    plugins: [react()],
    base: demo && command === 'build' ? '/un-day-2026/food-demo/' : '/',
    build: demo ? { outDir: '../food-demo', emptyOutDir: true } : undefined,
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
    },
  }
})
