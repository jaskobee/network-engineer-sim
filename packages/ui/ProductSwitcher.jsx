/**
 * The products as one row in the header: the one you're in is marked, the others are plain
 * links to their own apps. Nothing is shared at runtime beyond the link.
 */
import { PRODUCTS, productHref } from './products.js'

export default function ProductSwitcher({ current }) {
  const opts = { baseUrl: import.meta.env.BASE_URL, dev: import.meta.env.DEV }
  return (
    <nav className="product-switch" aria-label="Products">
      {PRODUCTS.map(p => {
        const label = <>{p.name}{p.preview && <span className="preview-tag">Preview</span>}</>
        return p.id === current
          ? <span key={p.id} aria-current="page" title={p.pitch}>{label}</span>
          : <a key={p.id} href={productHref(p.id, current, opts)} title={p.pitch}>{label}</a>
      })}
    </nav>
  )
}
