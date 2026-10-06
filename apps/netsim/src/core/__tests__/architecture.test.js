/**
 * Architecture boundaries (docs/HYBRID_PLATFORM_ROADMAP.md §3.1).
 *
 *   src/core/    shared kernel — imports nothing outside src/core
 *   src/guest/   host OS shells (Linux iproute2, Windows CMD)
 *   src/onprem/  on-prem forwarding plane, IOS, DHCP, DNS resolver
 *   src/cloud/   cloud resource model + forwarding plane   (Phase 1+)
 *   src/hybrid/  the only place allowed to import both onprem and cloud (Phase 5)
 *
 * A1  core imports only core
 * A2  onprem and cloud never import each other
 * A3  only src/hybrid may import from both onprem and cloud
 * A4  onprem source does not import guest (shells sit on top of the network, not under it)
 * A5  guest → onprem is limited to a fixed list of known couplings
 * A6  core / guest / onprem / cloud / engine stay headless: no React, DOM libraries, .jsx or CSS
 * A0  the import scanner itself finds every import form we use
 *
 * Plain file scan + regex on purpose — no parser dependency. Test files are scanned
 * too, but may import across core/guest/onprem (they are integration tests); A1, A2,
 * A3 still apply to them.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// guest/ needs DHCP (dhclient, ipconfig /renew) and the DNS resolver, which are
// on-prem today. On Azure the NIC address comes from the platform, not from a DHCP
// server the player runs (AZURE_ACCURACY.md A5/A7), so this has to be revisited
// before cloud VMs reuse the Linux shell (roadmap Phase 2). Adding a coupling here
// is a design decision, not a test fix.
const KNOWN_GUEST_TO_ONPREM = new Set([
  'guest/PCCLIEngine.js -> onprem/DHCPEngine.js',
  'guest/PCCLIEngine.js -> onprem/dns.js',
  'guest/WindowsCLIEngine.js -> onprem/DHCPEngine.js',
  'guest/WindowsCLIEngine.js -> onprem/dns.js',
])

const HEADLESS = ['core', 'guest', 'onprem', 'cloud', 'engine']
const UI_PACKAGES = /^(react|react-dom|@dnd-kit\/|@xterm\/)/

/** Every module specifier in a source text: static, side-effect, re-export, dynamic. */
export function importSpecifiers(text) {
  const specs = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g
  let m
  while ((m = re.exec(text))) specs.push(m[2])
  return specs
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p)
  }
  return out
}

const toRel = p => path.relative(SRC, p).split(path.sep).join('/')
const areaOf = rel => rel.split('/')[0]
const isTest = rel => rel.includes('/__tests__/')

// [{ from: 'onprem/Topology.js', to: 'core/failureReasons.js' | 'react', relative: bool }]
const EDGES = walk(SRC).flatMap(file => {
  const from = toRel(file)
  return importSpecifiers(fs.readFileSync(file, 'utf8')).map(spec => {
    if (!spec.startsWith('.')) return { from, to: spec, relative: false }
    return { from, to: toRel(path.resolve(path.dirname(file), spec)), relative: true }
  })
})
const local = EDGES.filter(e => e.relative)
const show = list => list.map(e => `${e.from} -> ${e.to}`)

describe('A0 — import scanner', () => {
  it('finds static, multi-line, side-effect, re-export and dynamic imports', () => {
    const text = [
      "import { a } from './a.js'",
      'import {\n  b,\n  c,\n} from "../b.js"',
      "import './side.css'",
      "export { d } from './d.js'",
      "const e = await import('./e.js')",
      "// a comment mentioning from nothing",
    ].join('\n')
    expect(importSpecifiers(text)).toEqual(['./a.js', '../b.js', './side.css', './d.js', './e.js'])
  })

  it('actually sees the engine graph (guards against a scanner that silently finds nothing)', () => {
    expect(show(local)).toContain('onprem/Topology.js -> core/failureReasons.js')
    expect(show(local)).toContain('guest/PCCLIEngine.js -> onprem/DHCPEngine.js')
  })
})

describe('A1 — core imports only core', () => {
  it('no file in src/core imports another area', () => {
    const bad = local.filter(e => areaOf(e.from) === 'core' && areaOf(e.to) !== 'core')
    expect(show(bad)).toEqual([])
  })
})

describe('A2 — onprem and cloud never import each other', () => {
  it('onprem ↛ cloud and cloud ↛ onprem', () => {
    const bad = local.filter(e =>
      (areaOf(e.from) === 'onprem' && areaOf(e.to) === 'cloud') ||
      (areaOf(e.from) === 'cloud'  && areaOf(e.to) === 'onprem'))
    expect(show(bad)).toEqual([])
  })
})

describe('A3 — only src/hybrid imports both onprem and cloud', () => {
  it('no file outside src/hybrid depends on both domains', () => {
    const byFile = new Map()
    for (const e of local) {
      if (!byFile.has(e.from)) byFile.set(e.from, new Set())
      byFile.get(e.from).add(areaOf(e.to))
    }
    const bad = [...byFile]
      .filter(([from, areas]) => areaOf(from) !== 'hybrid' && areas.has('onprem') && areas.has('cloud'))
      .map(([from]) => from)
    expect(bad).toEqual([])
  })
})

describe('A4 — onprem source does not import guest', () => {
  it('the network layer has no dependency on the host shells', () => {
    const bad = local.filter(e => areaOf(e.from) === 'onprem' && !isTest(e.from) && areaOf(e.to) === 'guest')
    expect(show(bad)).toEqual([])
  })
})

describe('A5 — guest → onprem only through known couplings', () => {
  it('no new guest → onprem dependency appears unnoticed', () => {
    const bad = local.filter(e =>
      areaOf(e.from) === 'guest' && !isTest(e.from) && areaOf(e.to) === 'onprem' &&
      !KNOWN_GUEST_TO_ONPREM.has(`${e.from} -> ${e.to}`))
    expect(show(bad)).toEqual([])
  })

  it('every listed coupling still exists (remove it from the list once it is gone)', () => {
    const present = new Set(show(local))
    expect([...KNOWN_GUEST_TO_ONPREM].filter(c => !present.has(c))).toEqual([])
  })
})

describe('A6 — headless areas stay free of React / DOM code', () => {
  it(`${HEADLESS.join(', ')} import no UI package, .jsx or stylesheet`, () => {
    const bad = EDGES.filter(e =>
      HEADLESS.includes(areaOf(e.from)) && !isTest(e.from) &&
      (UI_PACKAGES.test(e.to) || /\.(jsx|css)$/.test(e.to) || /^(components|state)\//.test(e.to)))
    expect(show(bad)).toEqual([])
  })

  it('headless areas contain no .jsx files', () => {
    const jsx = walk(SRC).map(toRel).filter(r => HEADLESS.includes(areaOf(r)) && r.endsWith('.jsx'))
    expect(jsx).toEqual([])
  })
})
