/**
 * Product boundaries (docs/platform/PLATFORM_ARCHITECTURE.md).
 *
 *   apps/<product>/   one app per product (netsim, cloud) — its own build, URL, saves
 *   packages/kernel   domain-free building blocks (IPv4 math, save envelope) — imports nothing
 *   packages/ui       design system + app frame — knows no simulator's domain
 *
 * B1  an app never imports another app — not by relative path, not by package name
 * B2  a package never imports an app; kernel imports nothing outside itself; ui imports
 *     nothing outside itself except React and bcryptjs
 * B3  code reaches another workspace only by package name (@sim/…), never by a relative
 *     path that climbs out of its own workspace
 * B4  every package a workspace imports is declared in its package.json (no reliance on hoisting)
 * B5  headless code — apps/cloud/src/azure and packages/kernel — has no React, DOM libraries, .jsx or CSS
 * B0  the scan sees the workspaces and real imports
 *
 * Hybrid (roadmap Phase 5) will be a package allowed to import both products' engines;
 * until it exists, nothing may. The import scanner repeats NetSim's architecture test on
 * purpose: importing it from there would itself cross a boundary.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rel = p => path.relative(ROOT, p).split(path.sep).join('/')

function importSpecifiers(source) {
  // Comment lines are skipped, so prose like "moves from 'admin_down'" is not an import.
  const text = source.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n')
  const specs = []
  const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g
  let m
  while ((m = re.exec(text))) specs.push(m[2])
  return specs
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(js|jsx)$/.test(e.name)) out.push(p)
  }
  return out
}

// Every workspace: { dir: 'apps/cloud', name: 'cloud-engineer', manifest }
const WORKSPACES = ['apps', 'packages'].flatMap(group =>
  fs.readdirSync(path.join(ROOT, group), { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(ROOT, group, e.name, 'package.json')))
    .map(e => {
      const dir = `${group}/${e.name}`
      const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8'))
      return { dir, name: manifest.name, manifest }
    }))
const workspaceOf = relPath => WORKSPACES.find(w => relPath === w.dir || relPath.startsWith(`${w.dir}/`)) ?? null
const byName = new Map(WORKSPACES.map(w => [w.name, w]))
const PACKAGE_SPEC = /^(node:[a-z_/]+|(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(\/[\w.@/-]+)?)$/
const packageName = spec => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0])

// [{ from: 'apps/cloud/src/App.jsx', spec, to: workspace-relative target or null, pkg }]
const EDGES = WORKSPACES.flatMap(w => walk(path.join(ROOT, w.dir)).flatMap(file => {
  const from = rel(file)
  // The regex scan also catches prose like "… from admin_down" in comments and strings; a
  // bare specifier only counts when it is shaped like a package name.
  return importSpecifiers(fs.readFileSync(file, 'utf8')).flatMap(spec => {
    if (spec.startsWith('.')) return [{ from, spec, to: rel(path.resolve(path.dirname(file), spec)), pkg: null }]
    if (!PACKAGE_SPEC.test(spec)) return []
    return [{ from, spec, to: null, pkg: packageName(spec) }]
  })
}))
const show = list => list.map(e => `${e.from} -> ${e.spec}`)
const isTest = p => p.includes('/__tests__/')

describe('B0 — the scan', () => {
  it('finds both apps and both packages', () => {
    expect(WORKSPACES.map(w => w.dir).sort()).toEqual(['apps/cloud', 'apps/netsim', 'packages/kernel', 'packages/ui'])
  })
  it('sees real cross-workspace imports', () => {
    expect(show(EDGES)).toContain('apps/cloud/src/azure/cidr.js -> @sim/kernel/ipUtils.js')
    expect(show(EDGES)).toContain('apps/netsim/src/App.jsx -> @sim/ui/LoginPage.jsx')
  })
})

describe('B1 — apps never import each other', () => {
  it('no relative path and no package name reaches another app', () => {
    const bad = EDGES.filter(e => {
      const own = workspaceOf(e.from)
      const target = e.to ? workspaceOf(e.to) : byName.get(e.pkg)
      return target && target !== own && target.dir.startsWith('apps/')
    })
    expect(show(bad)).toEqual([])
  })
})

describe('B2 — packages stay below the apps and free of domain code', () => {
  it('kernel imports only itself (plus node: builtins and vitest in its tests)', () => {
    const bad = EDGES.filter(e => e.from.startsWith('packages/kernel/') && (e.to
      ? workspaceOf(e.to)?.dir !== 'packages/kernel'
      : !(e.spec.startsWith('node:') || (isTest(e.from) && e.pkg === 'vitest'))))
    expect(show(bad)).toEqual([])
  })
  it('ui imports only itself, React and bcryptjs (plus vitest in its tests)', () => {
    const allowed = new Set(['react', 'bcryptjs'])
    const bad = EDGES.filter(e => e.from.startsWith('packages/ui/') && (e.to
      ? workspaceOf(e.to)?.dir !== 'packages/ui'
      : !(allowed.has(e.pkg) || (isTest(e.from) && e.pkg === 'vitest'))))
    expect(show(bad)).toEqual([])
  })
})

describe('B3 — other workspaces only by package name', () => {
  it('no relative import climbs out of its own workspace', () => {
    const bad = EDGES.filter(e => e.to && workspaceOf(e.to) !== workspaceOf(e.from))
    expect(show(bad)).toEqual([])
  })
})

describe('B4 — imports are declared', () => {
  const ROOT_DEV = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies ?? {}
  it('every bare import is a dependency of its workspace (tooling from the root manifest)', () => {
    const bad = EDGES.filter(e => {
      if (!e.pkg || e.spec.startsWith('node:')) return false
      const { manifest } = workspaceOf(e.from)
      const declared = { ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.devDependencies }
      return !(e.pkg in declared) && !(e.pkg in ROOT_DEV)
    })
    expect(show(bad)).toEqual([])
  })
})

describe('B5 — headless code stays headless', () => {
  const HEADLESS = ['apps/cloud/src/azure/', 'packages/kernel/']
  const UI = /^(react|react-dom|@dnd-kit\/|@xterm\/|@sim\/ui)/
  it(`${HEADLESS.join(', ')} import no UI package, .jsx or stylesheet`, () => {
    const bad = EDGES.filter(e => HEADLESS.some(h => e.from.startsWith(h)) &&
      (UI.test(e.spec) || /\.(jsx|css)$/.test(e.spec)))
    expect(show(bad)).toEqual([])
  })
  it('and contain no .jsx files', () => {
    const jsx = HEADLESS.flatMap(h => walk(path.join(ROOT, h)).map(rel)).filter(r => r.endsWith('.jsx'))
    expect(jsx).toEqual([])
  })
})
