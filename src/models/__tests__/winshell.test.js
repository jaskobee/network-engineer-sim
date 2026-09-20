/**
 * Windows shell (WindowsCLIEngine) — the Admin Laptop when os_type === 'windows'.
 *
 * This shell had no tests, and it showed: a Windows laptop could never get link at all
 * (its adapter starts administratively down and there was no command to enable it), a
 * static address could never go back to DHCP, and bad netsh parameters were quietly
 * "corrected". These lock in the behaviour of real Windows CMD.
 *
 * W1  - the adapter switch: netsh interface set interface (both syntaxes) + show interface
 * W2  - end to end: a Windows laptop gets link, an address, and can ping its gateway
 * W3  - netsh set address: positional and name=/source=/addr=/mask=/gateway= forms
 * W4  - bad parameters are refused, not corrected
 * W5  - static replaces the whole configuration (old gateway, routes, lease)
 * W6  - static → DHCP works (it used to be refused); DHCP when already leased is a no-op
 * W7  - DHCP → static gives the lease back
 * W8  - ipconfig /renew keeps the address; refuses static / disabled adapters
 * W9  - ipconfig /release messages
 * W10 - DHCP Enabled reflects configuration, not link state
 * W11 - no Linux idioms leak into Windows output
 * W12 - netsh interface ip delete address
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Device, createAdminLaptop } from '../Device.js'
import { Topology } from '../Topology.js'
import { CLIEngine } from '../CLIEngine.js'
import { WindowsCLIEngine } from '../WindowsCLIEngine.js'

const run = (eng, dev, ...cmds) => { let out = []; for (const c of cmds) out = eng.execute(dev, c); return out }
const defaults = d => d.routing_table.filter(r => r.network === '0.0.0.0')
const ENABLE  = 'netsh interface set interface name="Ethernet0" admin=enabled'
const DISABLE = 'netsh interface set interface name="Ethernet0" admin=disabled'
const STATIC  = 'netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.255.0 192.168.1.1'

let topo, ios, win, router, lap, iface

beforeEach(() => {
  topo = new Topology(); ios = new CLIEngine(topo); win = new WindowsCLIEngine(topo)
  router = new Device({ type: 'router', model: 'R', portCount: 4, portPrefix: 'GigabitEthernet0/', portStart: 0 }); router.powered = true
  lap = createAdminLaptop(); lap.os_type = 'windows'; lap.powered = true
  topo.addDevice(router); topo.addDevice(lap)
  topo.connect(`${router.id}:GigabitEthernet0/0`, `${lap.id}:Ethernet0/0`)
  run(ios, router,
    'enable', 'configure terminal',
    'interface GigabitEthernet0/0', 'ip address 192.168.1.1 255.255.255.0', 'no shutdown', 'exit',
    'ip dhcp pool LAN', 'network 192.168.1.0 255.255.255.0', 'default-router 192.168.1.1', 'dns-server 8.8.8.8', 'exit',
  )
  iface = lap.getInterface('Ethernet0/0')
})

// ── W1 ────────────────────────────────────────────────────────────────────────

describe('W1 — the adapter switch', () => {
  it('a fresh laptop adapter is disabled and the link is down (this is why it needs enabling)', () => {
    expect(iface.status).toBe('admin_down')
    expect(router.getInterface('GigabitEthernet0/0').status).toBe('down')
  })

  it('name= / admin= form raises the link on both ends', () => {
    expect(run(win, lap, ENABLE)).toEqual([])
    expect(iface.status).toBe('up')
    expect(router.getInterface('GigabitEthernet0/0').status).toBe('up')
  })

  it('the legacy positional form works too', () => {
    run(win, lap, 'netsh interface set interface "Ethernet0" enable')
    expect(iface.status).toBe('up')
    run(win, lap, 'netsh interface set interface "Ethernet0" disable')
    expect(iface.status).toBe('admin_down')
  })

  it('disabling drops carrier at the far end at once — down, not administratively down', () => {
    run(win, lap, ENABLE, DISABLE)
    expect(iface.status).toBe('admin_down')
    expect(router.getInterface('GigabitEthernet0/0').status).toBe('down')
  })

  it('enabling with no cable leaves it "down" (enabled, no carrier)', () => {
    const lone = createAdminLaptop(); lone.os_type = 'windows'; lone.powered = true; topo.addDevice(lone)
    run(win, lone, ENABLE)
    expect(lone.interfaces[0].status).toBe('down')
  })

  it('enabling next to a shut-down peer stays down; the peer coming up then wakes it', () => {
    run(ios, router, 'configure terminal', 'interface GigabitEthernet0/0', 'shutdown', 'end')
    run(win, lap, ENABLE)
    expect(iface.status).toBe('down')
    run(ios, router, 'configure terminal', 'interface GigabitEthernet0/0', 'no shutdown', 'end')
    expect(iface.status).toBe('up')
  })

  it('show interface tells Enabled/Disabled apart from Connected/Disconnected', () => {
    const row = () => run(win, lap, 'netsh interface show interface').find(l => /Ethernet0/.test(l))
    expect(row()).toMatch(/^Disabled\s+Disconnected\s+Dedicated\s+Ethernet0$/)
    run(win, lap, ENABLE)
    expect(row()).toMatch(/^Enabled\s+Connected\s+Dedicated\s+Ethernet0$/)
    const lone = createAdminLaptop(); lone.os_type = 'windows'; topo.addDevice(lone)
    run(win, lone, ENABLE)
    expect(run(win, lone, 'netsh interface show interface').find(l => /Ethernet0/.test(l))).toMatch(/^Enabled\s+Disconnected/)
  })

  it('unknown adapter and bad keyword are errors', () => {
    expect(run(win, lap, 'netsh interface set interface name="Nope" admin=enabled')[0]).toMatch(/no interface with the specified name "Nope"/)
    expect(run(win, lap, 'netsh interface set interface name="Ethernet0" admin=sideways')[0]).toMatch(/syntax of this command/)
    expect(run(win, lap, 'netsh interface set interface')[0]).toMatch(/syntax of this command/)
  })
})

// ── W2 ────────────────────────────────────────────────────────────────────────

describe('W2 — a Windows laptop can actually get onto the network', () => {
  it('before enabling, a ping fails as admin_down and the hint says how to fix it', () => {
    run(win, lap, STATIC)
    expect(topo.checkPing('192.168.1.50', '192.168.1.1')).toMatchObject({ reachable: false, failureReason: 'admin_down' })
  })

  it('enable → static → ping the router', () => {
    run(win, lap, ENABLE, STATIC)
    expect(topo.checkPing('192.168.1.50', '192.168.1.1').reachable).toBe(true)
  })

  it('enable → DHCP → ping the router', () => {
    run(win, lap, ENABLE, 'netsh interface ip set address "Ethernet0" dhcp')
    expect(iface).toMatchObject({ dhcp_assigned: true })
    expect(topo.checkPing(iface.ip, '192.168.1.1').reachable).toBe(true)
  })

  it('the async ping hint names the Windows command, not a Linux one', () => {
    let start = []
    win.executePingAsync(lap, '192.168.1.1', { onStart: l => { start = l } })
    expect(start.join('\n')).toMatch(/netsh interface set interface name="Ethernet0" admin=enabled/)
  })
})

// ── W3 ────────────────────────────────────────────────────────────────────────

describe('W3 — netsh set address forms', () => {
  beforeEach(() => { run(win, lap, ENABLE) })

  it('positional', () => {
    expect(run(win, lap, STATIC)).toEqual(['Ok.'])
    expect(iface).toMatchObject({ ip: '192.168.1.50', subnet_mask: '255.255.255.0', dhcp_assigned: false })
    expect(defaults(lap).map(r => r.next_hop)).toEqual(['192.168.1.1'])
  })

  it('name= source= addr= mask= gateway=', () => {
    run(win, lap, 'netsh interface ip set address name="Ethernet0" source=static addr=192.168.1.60 mask=255.255.255.0 gateway=192.168.1.1')
    expect(iface.ip).toBe('192.168.1.60')
    expect(defaults(lap).map(r => r.next_hop)).toEqual(['192.168.1.1'])
  })

  it('positional name with named values, and the ipv4 context alias', () => {
    run(win, lap, 'netsh interface ipv4 set address "Ethernet0" source=static addr=192.168.1.61 mask=255.255.255.0')
    expect(iface.ip).toBe('192.168.1.61')
  })

  it('source=dhcp', () => {
    run(win, lap, 'netsh interface ip set address name="Ethernet0" source=dhcp')
    expect(iface.dhcp_assigned).toBe(true)
  })

  it('no gateway is fine (isolated segment)', () => {
    run(win, lap, 'netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.255.0')
    expect(defaults(lap)).toHaveLength(0)
  })
})

// ── W4 ────────────────────────────────────────────────────────────────────────

describe('W4 — bad parameters are refused, not corrected', () => {
  beforeEach(() => { run(win, lap, ENABLE) })
  const set = args => run(win, lap, `netsh interface ip set address "Ethernet0" static ${args}`)
  const untouched = () => { expect(iface.ip).toBeNull(); expect(defaults(lap)).toHaveLength(0) }

  it('a mask that is not a mask is refused (it used to become 255.255.255.0 silently)', () => {
    expect(set('192.168.1.50 255.0.255.0')[0]).toMatch(/not a valid subnet mask/)
    expect(set('192.168.1.50 banana')[0]).toMatch(/not a valid subnet mask/)
    untouched()
  })
  it('a malformed address is refused', () => {
    expect(set('192.168.1 255.255.255.0')[0]).toMatch(/valid IP address/)
    expect(set('192.168.1.300 255.255.255.0')[0]).toMatch(/valid IP address/)
    untouched()
  })
  it('the network and broadcast address cannot be a host address', () => {
    expect(set('192.168.1.0 255.255.255.0')[0]).toMatch(/not a valid host address/)
    expect(set('192.168.1.255 255.255.255.0')[0]).toMatch(/not a valid host address/)
    untouched()
  })
  it('a malformed gateway is refused (it used to be ignored)', () => {
    expect(set('192.168.1.50 255.255.255.0 nonsense')[0]).toMatch(/not a valid gateway/)
    untouched()
  })
  it('a gateway on another subnet is refused', () => {
    expect(set('192.168.1.50 255.255.255.0 10.0.0.1')[0]).toMatch(/not on the same subnet as 192\.168\.1\.50 \(192\.168\.1\.0\/24\)/)
    untouched()
  })
  it('the host itself, or the subnet broadcast, cannot be its gateway', () => {
    expect(set('192.168.1.50 255.255.255.0 192.168.1.50')[0]).toMatch(/cannot be used as a gateway/)
    expect(set('192.168.1.50 255.255.255.0 192.168.1.255')[0]).toMatch(/cannot be used as a gateway/)
    untouched()
  })
  it('an address already used by another device is refused', () => {
    expect(set('192.168.1.1 255.255.255.0')[0]).toMatch(/already assigned to another host/)
    untouched()
  })
  it('/31 is accepted (RFC 3021)', () => {
    expect(set('10.9.9.0 255.255.255.254')).toEqual(['Ok.'])
  })
  it('unknown adapter / missing arguments', () => {
    expect(run(win, lap, 'netsh interface ip set address "Nope" dhcp')[0]).toMatch(/no interface with the specified name "Nope"/)
    expect(run(win, lap, 'netsh interface ip set address')[0]).toMatch(/syntax of this command/)
    expect(run(win, lap, 'netsh interface ip set address "Ethernet0"').join('\n')).toMatch(/static <ip>/)
  })
})

// ── W5 ────────────────────────────────────────────────────────────────────────

describe('W5 — static replaces the whole IPv4 configuration', () => {
  beforeEach(() => { run(win, lap, ENABLE, STATIC) })

  it('omitting the gateway removes the old one (it used to linger)', () => {
    run(win, lap, 'netsh interface ip set address "Ethernet0" static 192.168.1.51 255.255.255.0')
    expect(defaults(lap)).toHaveLength(0)
    expect(iface.ip).toBe('192.168.1.51')
  })

  it('a new gateway replaces the old, never sits beside it', () => {
    run(win, lap, 'netsh interface ip set address "Ethernet0" static 192.168.1.50 255.255.255.0 192.168.1.2')
    expect(defaults(lap).map(r => r.next_hop)).toEqual(['192.168.1.2'])
  })

  it('moving to another subnet takes the routes through the old one with it', () => {
    run(win, lap, 'route add 10.5.0.0 mask 255.255.0.0 192.168.1.1')
    run(win, lap, 'netsh interface ip set address "Ethernet0" static 172.16.0.5 255.255.255.0')
    expect(lap.routing_table).toHaveLength(0)
  })
})

// ── W6 ────────────────────────────────────────────────────────────────────────

describe('W6 — static → DHCP', () => {
  beforeEach(() => { run(win, lap, ENABLE, STATIC) })

  it('is no longer refused: the static configuration is replaced by a lease', () => {
    expect(run(win, lap, 'netsh interface ip set address "Ethernet0" dhcp')).toEqual(['Ok.'])
    expect(iface.dhcp_assigned).toBe(true)
    expect(iface.ip).toMatch(/^192\.168\.1\./)
    expect(iface.ip).not.toBe('192.168.1.50')
    expect(defaults(lap)).toHaveLength(1)
    expect(defaults(lap)[0]).toMatchObject({ next_hop: '192.168.1.1', dhcp_assigned: true })
    expect(lap.dns_server).toBe('8.8.8.8')
    expect(router.dhcp_bindings).toHaveLength(1)
  })

  it('when no server answers: DHCP-enabled, no address, nothing faked, and the reason is in Windows words', () => {
    run(ios, router, 'configure terminal', 'no ip dhcp pool LAN', 'end')
    const out = run(win, lap, 'netsh interface ip set address "Ethernet0" dhcp')
    expect(out[0]).toBe('Ok.')
    expect(out.join('\n')).toMatch(/no DHCP server answered/)
    expect(out.join('\n')).not.toMatch(/ip link|ip addr/)
    expect(iface).toMatchObject({ ip: null, dhcp_assigned: false })
    expect(defaults(lap)).toHaveLength(0)
  })

  it('a link-down adapter says so', () => {
    run(win, lap, DISABLE)
    expect(run(win, lap, 'netsh interface ip set address "Ethernet0" dhcp').join('\n')).toMatch(/adapter has no link/)
  })

  it('DHCP while already leased is a no-op — no second address, no second binding', () => {
    run(win, lap, 'netsh interface ip set address "Ethernet0" dhcp')
    const first = iface.ip
    expect(run(win, lap, 'netsh interface ip set address "Ethernet0" dhcp')).toEqual(['DHCP is already enabled on this interface.'])
    expect(iface.ip).toBe(first)
    expect(router.dhcp_bindings).toHaveLength(1)
  })
})

// ── W7 ────────────────────────────────────────────────────────────────────────

describe('W7 — DHCP → static', () => {
  it('gives the lease back: binding, DHCP route and DNS all go', () => {
    run(win, lap, ENABLE, 'netsh interface ip set address "Ethernet0" dhcp')
    expect(router.dhcp_bindings).toHaveLength(1)
    run(win, lap, 'netsh interface ip set address "Ethernet0" static 192.168.1.77 255.255.255.0 192.168.1.1')
    expect(router.dhcp_bindings).toHaveLength(0)
    expect(lap.dns_server).toBeNull()
    expect(iface).toMatchObject({ ip: '192.168.1.77', dhcp_assigned: false })
    expect(defaults(lap)).toHaveLength(1)
    expect(defaults(lap)[0].dhcp_assigned).toBeUndefined()
  })
})

// ── W8 ────────────────────────────────────────────────────────────────────────

describe('W8 — ipconfig /renew', () => {
  it('keeps the address and adds no second binding', () => {
    run(win, lap, ENABLE, 'netsh interface ip set address "Ethernet0" dhcp')
    const first = iface.ip
    const out = run(win, lap, 'ipconfig /renew')
    expect(out.join('\n')).toContain(first)
    expect(iface.ip).toBe(first)
    expect(router.dhcp_bindings).toHaveLength(1)
  })

  it('refuses a static adapter with the real message, and changes nothing (it used to convert it)', () => {
    run(win, lap, ENABLE, STATIC)
    expect(run(win, lap, 'ipconfig /renew')).toEqual(['The operation failed as no adapter is in the state permissible for this operation.'])
    expect(iface).toMatchObject({ ip: '192.168.1.50', dhcp_assigned: false })
    expect(router.dhcp_bindings).toHaveLength(0)
  })

  it('an unconfigured adapter is DHCP-enabled by default, so renew acquires', () => {
    run(win, lap, ENABLE)
    run(win, lap, 'ipconfig /renew')
    expect(iface.dhcp_assigned).toBe(true)
  })

  it('a disabled adapter is not in a state to renew', () => {
    expect(run(win, lap, 'ipconfig /renew')).toEqual(['The operation failed as no adapter is in the state permissible for this operation.'])
  })

  it('no cable: names the adapter and says media disconnected', () => {
    const lone = createAdminLaptop(); lone.os_type = 'windows'; topo.addDevice(lone)
    run(win, lone, ENABLE)
    expect(run(win, lone, 'ipconfig /renew')).toEqual(['No operation can be performed on Ethernet0 while it has its media disconnected.'])
  })

  it('server gone: says so in Windows words and keeps the existing lease', () => {
    run(win, lap, ENABLE, 'netsh interface ip set address "Ethernet0" dhcp')
    const first = iface.ip
    run(ios, router, 'configure terminal', 'interface GigabitEthernet0/0', 'shutdown', 'end')
    run(win, lap, 'ipconfig /renew')
    expect(iface.ip).toBe(first)
  })
})

// ── W9 ────────────────────────────────────────────────────────────────────────

describe('W9 — ipconfig /release', () => {
  it('releases a lease: binding and address go', () => {
    run(win, lap, ENABLE, 'netsh interface ip set address "Ethernet0" dhcp')
    run(win, lap, 'ipconfig /release')
    expect(iface.ip).toBeNull()
    expect(router.dhcp_bindings).toHaveLength(0)
    expect(defaults(lap)).toHaveLength(0)
  })
  it('a static adapter has nothing to release', () => {
    run(win, lap, ENABLE, STATIC)
    expect(run(win, lap, 'ipconfig /release')).toEqual(['The operation failed as no adapter is in the state permissible for this operation.'])
    expect(iface.ip).toBe('192.168.1.50')
  })
  it('a cable-less adapter names itself', () => {
    const lone = createAdminLaptop(); lone.os_type = 'windows'; topo.addDevice(lone)
    run(win, lone, ENABLE)
    expect(run(win, lone, 'ipconfig /release')).toEqual(['No operation can be performed on Ethernet0 while it has its media disconnected.'])
  })
})

// ── W10 ───────────────────────────────────────────────────────────────────────

describe('W10 — "DHCP Enabled" is configuration, not link state', () => {
  const dhcpLine = out => out.find(l => /DHCP Enabled|DHCP enabled/.test(l)).trim().split(/\s+/).pop()
  it('a fresh (unconfigured) adapter is DHCP-enabled, in both views', () => {
    expect(dhcpLine(run(win, lap, 'ipconfig /all'))).toBe('Yes')
    expect(dhcpLine(run(win, lap, 'netsh interface ip show config'))).toBe('Yes')
  })
  it('a static adapter is not — even while its link is down', () => {
    run(win, lap, STATIC)                      // still disabled → media disconnected path
    expect(dhcpLine(run(win, lap, 'ipconfig /all'))).toBe('No')
    expect(dhcpLine(run(win, lap, 'netsh interface ip show config'))).toBe('No')
  })
  it('a leased adapter is', () => {
    run(win, lap, ENABLE, 'netsh interface ip set address "Ethernet0" dhcp')
    expect(dhcpLine(run(win, lap, 'ipconfig /all'))).toBe('Yes')
  })
})

// ── W11 ───────────────────────────────────────────────────────────────────────

describe('W11 — Windows output stays Windows', () => {
  it('none of the failure paths mention Linux commands', () => {
    const outputs = [
      run(win, lap, 'netsh interface ip set address "Ethernet0" dhcp'),         // disabled adapter
      run(win, lap, 'ipconfig /renew'),
      run(win, lap, 'ipconfig /release'),
      run(win, lap, 'netsh interface ip set address "Ethernet0" static 1.1.1.1 255.0.255.0'),
      run(win, lap, 'help'),
    ].flat().join('\n')
    expect(outputs).not.toMatch(/\bip link\b|\bip addr\b|\bip route\b|dhclient/)
  })

  it('help teaches enabling the adapter first', () => {
    expect(run(win, lap, 'help').join('\n')).toMatch(/netsh interface set interface name="Ethernet0" admin=enabled/)
  })
})

// ── W12 ───────────────────────────────────────────────────────────────────────

describe('W12 — netsh interface ip delete address', () => {
  beforeEach(() => { run(win, lap, ENABLE, STATIC) })

  it('removes the address and the routes that depended on it', () => {
    expect(run(win, lap, 'netsh interface ip delete address "Ethernet0" 192.168.1.50')).toEqual(['Ok.'])
    expect(iface).toMatchObject({ ip: null, subnet_mask: null })
    expect(defaults(lap)).toHaveLength(0)
  })

  it('naming an address that is not configured is an error and changes nothing', () => {
    expect(run(win, lap, 'netsh interface ip delete address "Ethernet0" 192.168.1.99')).toEqual(['The system cannot find the file specified.'])
    expect(iface.ip).toBe('192.168.1.50')
  })

  it('deleting a leased address hands it back to the server', () => {
    run(win, lap, 'netsh interface ip set address "Ethernet0" dhcp')
    const ip = iface.ip
    expect(router.dhcp_bindings).toHaveLength(1)
    run(win, lap, `netsh interface ip delete address "Ethernet0" ${ip}`)
    expect(iface.ip).toBeNull()
    expect(router.dhcp_bindings).toHaveLength(0)
  })

  it('named form and syntax errors', () => {
    expect(run(win, lap, 'netsh interface ip delete address name="Ethernet0" addr=192.168.1.50')).toEqual(['Ok.'])
    expect(run(win, lap, 'netsh interface ip delete address')[0]).toMatch(/syntax of this command/)
    expect(run(win, lap, 'netsh interface ip delete address "Nope" 1.1.1.1')[0]).toMatch(/no interface with the specified name "Nope"/)
  })
})
