export const deviceCatalog = [
  {
    type: 'router',
    model: 'ISR-4321',
    displayName: 'Cisco ISR 4321 Router',
    price: 1200,
    portCount: 4,
    portPrefix: 'GigabitEthernet0/',
    description: '4-port Gigabit router',
  },
  {
    type: 'switch',
    model: 'C2960-8TC',
    displayName: 'Catalyst 2960 Switch',
    price: 800,
    portCount: 8,
    portPrefix: 'FastEthernet0/',
    portStart: 1,   // Catalyst 2960 ports are Fa0/1–Fa0/8 (1-indexed, no Fa0/0)
    description: '8-port L2 switch',
  },
  {
    type: 'pc',
    model: 'GENERIC-PC',
    displayName: 'Generic PC',
    price: 200,
    portCount: 1,
    portPrefix: 'Ethernet0/',
    description: 'Standard workstation',
  },
  {
    type: 'server',
    model: 'GENERIC-SERVER',
    displayName: 'Generic Server',
    price: 600,
    portCount: 2,
    portPrefix: 'Ethernet0/',
    description: 'Rack-mounted server',
  },
  {
    type: 'firewall',
    model: 'ASA-5506-X',
    displayName: 'Cisco ASA 5506-X Firewall',
    price: 1500,
    portCount: 4,
    portPrefix: 'GigabitEthernet0/',
    description: '4-port stateful zone-based firewall',
  },
  {
    // Simplification: real IP phones have a built-in 2-port switch and use a
    // tagged voice VLAN via `switchport voice vlan`. We model the phone as a
    // single-port host on a normal access VLAN — same engine as a PC.
    type: 'phone',
    model: 'GENERIC-PHONE',
    displayName: 'IP Phone',
    price: 150,
    portCount: 1,
    portPrefix: 'Ethernet0/',
    description: 'VoIP endpoint — DHCP host, Linux CLI',
  },
]
