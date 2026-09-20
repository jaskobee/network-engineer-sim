import { describe, it, expect } from 'vitest'
import { pingTargetOf } from '../pingTarget.js'

const t = line => line.split(/\s+/)

describe('pingTargetOf — the destination, never a flag\'s value', () => {
  it('finds the destination with or without flags (Linux)', () => {
    expect(pingTargetOf(t('ping google.com'), 'linux')).toBe('google.com')
    expect(pingTargetOf(t('ping -c 4 google.com'), 'linux')).toBe('google.com')
    expect(pingTargetOf(t('ping google.com -c 4'), 'linux')).toBe('google.com')   // the count is not a host name
    expect(pingTargetOf(t('ping -t 64 8.8.8.8'), 'linux')).toBe('8.8.8.8')        // Linux -t takes a TTL
  })

  it('Windows flags: -n and -w take values, -t does not', () => {
    expect(pingTargetOf(t('ping -n 2 google.com'), 'windows')).toBe('google.com')
    expect(pingTargetOf(t('ping google.com -n 2'), 'windows')).toBe('google.com')
    expect(pingTargetOf(t('ping -t google.com'), 'windows')).toBe('google.com')
    expect(pingTargetOf(t('ping -w 500 -n 3 8.8.8.8'), 'windows')).toBe('8.8.8.8')
  })

  it('IOS takes the last word', () => {
    expect(pingTargetOf(t('ping google.com'), 'ios')).toBe('google.com')
  })

  it('no destination → null', () => {
    expect(pingTargetOf(['ping'], 'linux')).toBeNull()
    expect(pingTargetOf(t('ping -c 4'), 'linux')).toBeNull()
  })
})
