import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/network-engineer-sim/',
  plugins: [react()],
  test: {
    environment: 'node',
  },
})
