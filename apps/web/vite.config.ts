import { alphaTab } from '@coderline/alphatab-vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.TABGEN_API ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), alphaTab()],
  server: { host: true, port: 5173, proxy: { '/v1': api } },
  preview: { host: true, port: 4173, proxy: { '/v1': api } },
})
