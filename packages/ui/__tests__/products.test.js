/**
 * Product links — the products are separate apps on one site.
 *
 * U1  production: links are site-relative and land on each product's own path
 * U2  dev: links go to the target product's own dev server
 * U3  every product has a distinct id, path and dev port
 */
import { describe, it, expect } from 'vitest'
import { PRODUCTS, productHref } from '../products.js'

describe('U1 — production links', () => {
  it('NetSim (site root) → Cloud Engineer, and back', () => {
    expect(productHref('cloud', 'netsim', { baseUrl: '/network-engineer-sim/' })).toBe('/network-engineer-sim/cloud/')
    expect(productHref('netsim', 'cloud', { baseUrl: '/network-engineer-sim/cloud/' })).toBe('/network-engineer-sim/')
  })
  it('a base that does not match the running product is a configuration error', () => {
    expect(() => productHref('netsim', 'cloud', { baseUrl: '/network-engineer-sim/' })).toThrow(/does not end with/)
  })
})

describe('U2 — dev links', () => {
  it('point at the other dev server', () => {
    expect(productHref('cloud', 'netsim', { baseUrl: '/network-engineer-sim/', dev: true }))
      .toBe('http://localhost:5180/network-engineer-sim/cloud/')
  })
})

describe('U3 — the list', () => {
  it('ids, paths and dev ports are unique', () => {
    for (const key of ['id', 'path', 'devPort']) expect(new Set(PRODUCTS.map(p => p[key])).size).toBe(PRODUCTS.length)
  })
})
