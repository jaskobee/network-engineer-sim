import { defineConfig } from 'vitest/config'

// One `npm test` for the whole repo: every app and package is its own Vitest project,
// configured by its own vite.config.js.
export default defineConfig({
  test: {
    projects: ['apps/*', 'packages/*'],
  },
})
