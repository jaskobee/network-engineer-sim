import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// NetSim is served at the site root (/network-engineer-sim/). It builds first and owns
// dist/; the other products build into sub-folders of it afterwards (root `npm run build`).
export default defineConfig({
  base: '/network-engineer-sim/',
  plugins: [react()],
  build: { outDir: '../../dist', emptyOutDir: true },
  server: { port: 5173 }, // matches @sim/ui/products.js
  test: {
    environment: 'node',
  },
})
