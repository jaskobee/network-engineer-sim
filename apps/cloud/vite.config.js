import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Cloud Engineer lives under cloud/ on the shared site, next to NetSim at the root. It builds
// after NetSim (root `npm run build`), into dist/cloud. Dev port matches @sim/ui/products.js.
export default defineConfig({
  base: '/network-engineer-sim/cloud/',
  plugins: [react()],
  build: { outDir: '../../dist/cloud', emptyOutDir: true },
  server: { port: 5180 },
  preview: { port: 5181 },
  test: {
    environment: 'node',
  },
})
