import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: path.resolve(__dirname, '../../..', 'app/src/main/assets'),
    emptyOutDir: true,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  }
})
