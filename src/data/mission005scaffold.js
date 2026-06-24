/**
 * Mission 005 scaffold — pre-builds the completed M004 network so the player
 * starts with a working LAN and only needs to add/configure the firewall.
 *
 * PRINCIPLE: reaches its state by running real CLI commands through the real
 * engine — no direct writes to networking fields (ip, status, routes, etc.).
 * Setting device.powered = true is a physical act (plugging in), not a CLI config.
 */

import { Device } from '../models/Device.js'
import { deviceCatalog } from './deviceCatalog.js'

const cat = (type) => deviceCatalog.find(e => e.type === type)

function exec(engine, device, cmds) {
  for (const cmd of cmds) engine.execute(device, cmd)
}

/**
 * Build the M004 baseline topology inside the mission topology.
 * Called from acceptMission('mission_005') AFTER the ISP is already placed.
 *
 * @param {Topology}    topology  — mission topology (ISP already added)
 * @param {CLIEngine}   engine    — IOS CLI engine bound to this topology
 * @param {PCCLIEngine} pcEngine  — Linux CLI engine bound to this topology
 * @returns {{ placements: Record<string, {x:number, y:number}> }}
 */
export function buildMission005Scaffold(topology, engine, pcEngine) {
  // ── Create devices ──────────────────────────────────────────────────────────
  const router = new Device(cat('router'))
  router.hostname = 'R1'
  router.powered  = true

  const sw = new Device(cat('switch'))
  sw.hostname = 'SW1'
  sw.powered  = true

  const pc1 = new Device(cat('pc'))
  pc1.hostname = 'PC1'
  pc1.powered  = true

  const pc2 = new Device(cat('pc'))
  pc2.hostname = 'PC2'
  pc2.powered  = true

  const pc3 = new Device(cat('pc'))
  pc3.hostname = 'PC3'
  pc3.powered  = true

  const phone = new Device(cat('phone'))
  phone.hostname = 'PHN1'
  phone.powered  = true

  const server = new Device(cat('server'))
  server.hostname = 'SRV1'
  server.powered  = true

  // ── Add to topology ──────────────────────────────────────────────────────────
  for (const dev of [router, sw, pc1, pc2, pc3, phone, server]) {
    topology.addDevice(dev)
  }

  // ── Cable ────────────────────────────────────────────────────────────────────
  // Host ports → switch access ports
  topology.connect(`${sw.id}:FastEthernet0/1`, `${pc1.id}:Ethernet0/0`)
  topology.connect(`${sw.id}:FastEthernet0/2`, `${pc2.id}:Ethernet0/0`)
  topology.connect(`${sw.id}:FastEthernet0/3`, `${pc3.id}:Ethernet0/0`)
  topology.connect(`${sw.id}:FastEthernet0/4`, `${phone.id}:Ethernet0/0`)
  topology.connect(`${sw.id}:FastEthernet0/5`, `${server.id}:Ethernet0/0`)
  // Trunk port (Fa0/6 is the router-facing port; player moves server cable to FW in t3)
  topology.connect(`${sw.id}:FastEthernet0/6`, `${router.id}:GigabitEthernet0/0`)
  // R1 Gi0/1 is left free — player cables it to FW INSIDE port in t3

  // ── Configure SW1 ────────────────────────────────────────────────────────────
  exec(engine, sw, [
    'enable', 'configure terminal',
    // Create VLANs
    'vlan 10', 'exit',
    'vlan 20', 'exit',
    'vlan 30', 'exit',
    'vlan 40', 'exit',
    // Assign host access ports
    'interface FastEthernet0/1', 'switchport mode access', 'switchport access vlan 10', 'exit',
    'interface FastEthernet0/2', 'switchport mode access', 'switchport access vlan 10', 'exit',
    'interface FastEthernet0/3', 'switchport mode access', 'switchport access vlan 20', 'exit',
    'interface FastEthernet0/4', 'switchport mode access', 'switchport access vlan 40', 'exit',
    'interface FastEthernet0/5', 'switchport mode access', 'switchport access vlan 30', 'exit',
    // Trunk to R1
    'interface FastEthernet0/6', 'switchport mode trunk', 'exit',
  ])

  // ── Configure R1 ROAS + DHCP ─────────────────────────────────────────────────
  exec(engine, router, [
    'enable', 'configure terminal',
    // Bring up trunk port (no IP on the physical interface — ROAS puts IPs on subifs)
    'interface GigabitEthernet0/0', 'no shutdown', 'exit',
    // VLAN 10 subinterface
    'interface GigabitEthernet0/0.10',
    'encapsulation dot1Q 10',
    'ip address 192.168.10.1 255.255.255.0', 'exit',
    // VLAN 20 subinterface
    'interface GigabitEthernet0/0.20',
    'encapsulation dot1Q 20',
    'ip address 192.168.20.1 255.255.255.0', 'exit',
    // VLAN 30 subinterface (server VLAN; player reconfigures server in M005 t6)
    'interface GigabitEthernet0/0.30',
    'encapsulation dot1Q 30',
    'ip address 192.168.30.1 255.255.255.0', 'exit',
    // VLAN 40 subinterface (voice)
    'interface GigabitEthernet0/0.40',
    'encapsulation dot1Q 40',
    'ip address 192.168.40.1 255.255.255.0', 'exit',
    // DHCP pools for VLAN 10 / 20 / 40 (no pool for VLAN 30 — server is static)
    'ip dhcp pool VLAN10',
    'network 192.168.10.0 255.255.255.0',
    'default-router 192.168.10.1',
    'dns-server 8.8.8.8', 'exit',
    'ip dhcp pool VLAN20',
    'network 192.168.20.0 255.255.255.0',
    'default-router 192.168.20.1',
    'dns-server 8.8.8.8', 'exit',
    'ip dhcp pool VLAN40',
    'network 192.168.40.0 255.255.255.0',
    'default-router 192.168.40.1',
    'dns-server 8.8.8.8', 'exit',
    // Exclude the gateway IPs from DHCP pools
    'ip dhcp excluded-address 192.168.10.1 192.168.10.10',
    'ip dhcp excluded-address 192.168.20.1 192.168.20.10',
    'ip dhcp excluded-address 192.168.40.1 192.168.40.10',
  ])

  // ── DHCP clients ─────────────────────────────────────────────────────────────
  for (const client of [pc1, pc2, pc3, phone]) {
    exec(pcEngine, client, [
      'ip link set eth0 up',
      'dhclient eth0',
    ])
  }

  // ── Server static address (VLAN 30 / M004 state; player moves to DMZ in t6) ──
  exec(pcEngine, server, [
    'ip addr add 192.168.30.10/24 dev eth0',
    'ip link set eth0 up',
    'ip route add default via 192.168.30.1',
  ])

  // ── Placements ────────────────────────────────────────────────────────────────
  const placements = {
    [router.id]: { x: 430, y: 200 },
    [sw.id]:     { x: 240, y: 200 },
    [pc1.id]:    { x:  60, y:  80 },
    [pc2.id]:    { x:  60, y: 170 },
    [pc3.id]:    { x:  60, y: 260 },
    [phone.id]:  { x:  60, y: 350 },
    [server.id]: { x:  60, y: 450 },
  }

  return { placements }
}
