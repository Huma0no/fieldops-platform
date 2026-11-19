import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Built for the pilot server, Dispatch lives at /dispatch/ next to FieldOps
// (FIRST-LAUNCH-RUNBOOK §5); the dev server stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/dispatch/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  css: {
    postcss: {},
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
}))
