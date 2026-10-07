/**
 * The product family. Each product is its own app with its own build, URL and saves; they
 * are published side by side on one site, so each can link to the others.
 *
 *   path      where the product lives, relative to the site root ('' = the root itself)
 *   devPort   the product's Vite dev server (each app's vite.config.js uses the same port)
 *
 * In a production build every product shares one origin, so the beta sign-in carries over.
 * Under `npm run dev` each product runs on its own port (its own origin), so you sign in
 * once per product there.
 */
export const PRODUCTS = Object.freeze([
  Object.freeze({ id: 'netsim', name: 'NetSim', pitch: 'On-prem networking', path: '', devPort: 5173 }),
  Object.freeze({ id: 'cloud', name: 'Cloud Engineer', pitch: 'Azure infrastructure', path: 'cloud/', devPort: 5180, preview: true }),
])

export function findProduct(id) {
  return PRODUCTS.find(p => p.id === id) ?? null
}

/**
 * Link from the product `fromId` to the product `toId`.
 * `baseUrl` is the running app's import.meta.env.BASE_URL; the site root is that base minus
 * the running product's own path. `dev` (import.meta.env.DEV) switches to the target's dev port.
 */
export function productHref(toId, fromId, { baseUrl, dev = false }) {
  const from = findProduct(fromId)
  const to = findProduct(toId)
  if (!from || !to) throw new Error(`Unknown product: ${!from ? fromId : toId}`)
  if (!baseUrl.endsWith(from.path)) throw new Error(`Base URL ${baseUrl} does not end with ${from.path}`)
  const siteRoot = baseUrl.slice(0, baseUrl.length - from.path.length)
  const path = `${siteRoot}${to.path}`
  return dev ? `http://localhost:${to.devPort}${path}` : path
}
