/**
 * mission_local_shop_1 — "Sam's Corner Store: Getting Online"
 *
 * The player's first job for their first persistent client (client_local_shop,
 * see src/data/clients.js). A friend's small shop needs a basic LAN: one
 * router, one switch, three PCs — the canonical "inspect → configure → verify"
 * small-business deployment described in the design doc, authored as data
 * against the new declarative objective DSL (src/engine/missionEngine.js)
 * instead of a hand-written checkNNN() function.
 *
 *                 Internet
 *                    |
 *                  Router  (10.0.10.1/24)
 *                    |
 *                  Switch
 *              /      |      \
 *           PC-1     PC-2     PC-3
 *         (.101)    (.102)   (.103)
 *
 * financialModel: 'keep' — this client's hardware persists across missions
 * (GameContext's acceptMission/completeMission became financialModel-aware in
 * a later phase). Followed by mission_local_shop_2 once this one completes.
 */

export const mission_local_shop_1 = {
  id: 'mission_local_shop_1',
  clientId: 'client_local_shop',
  title: "Sam's Corner Store: Getting Online",
  client: "Sam's Corner Store",
  avatar: '🏪',
  description: "Your friend Sam just opened a corner store and needs a basic network: one router online, a switch to expand the LAN, and three PCs at the register, the office, and the back room — all able to reach each other.",
  difficulty: 1,
  reward: 750,
  optionalObjectiveBonus: 150,
  requiredReputation: 0,
  requiredKnowledge: ['ip-addressing', 'switch-cabling', 'basic-troubleshooting'],
  estimatedDuration: '15-20 min',
  financialModel: 'keep',
  followUpMissionIds: ['mission_local_shop_2'],
  contractOutcome: { type: 'monthly-support' },

  hardware: [
    { type: 'router', qty: 1, label: 'Router' },
    { type: 'switch', qty: 1, label: 'Switch' },
    { type: 'pc',     qty: 3, label: 'PCs (×3)' },
  ],

  blueprint: {
    segments: [
      {
        id: 'lan',
        label: "Sam's Shop LAN",
        subnet: '10.0.10.0/24',
        devices: [
          { role: 'Router', type: 'router' },
          { role: 'Switch', type: 'switch' },
          { role: 'PC-1 (Register)', type: 'pc' },
          { role: 'PC-2 (Office)', type: 'pc' },
          { role: 'PC-3 (Back Room)', type: 'pc' },
        ],
        svgX: 100, svgY: 20,
      },
    ],
    links: [],
    svgViewBox: '0 0 360 240',
    notes: 'One flat LAN — the router is the default gateway, the switch fans out to all three PCs.',
  },
  layout: [
    {
      zone: "Sam's Shop LAN",
      subnet: '10.0.10.0/24',
      devices: 'Router (10.0.10.1) · Switch · PC-1/2/3 (.101–.103)',
      note: 'Single flat subnet, no VLANs — the router\'s LAN interface is the default gateway for all three PCs.',
    },
  ],

  deviceRoles: {
    router: { type: 'router', match: 'first',  label: 'Router' },
    switch: { type: 'switch', match: 'first',  label: 'Switch' },
    pc1:    { type: 'pc',     match: 'first',  label: 'PC-1 (Register)' },
    pc2:    { type: 'pc',     match: 'second', label: 'PC-2 (Office)' },
    pc3:    { type: 'pc',     match: 'third',  label: 'PC-3 (Back Room)' },
  },

  objectives: [
    {
      id: 't1',
      label: 'Buy a Router, a Switch, and 3 PCs',
      hint: 'Open the Shop tab and purchase one Router, one Switch, and three PCs.',
      condition: {
        type: 'and',
        conditions: [
          { type: 'deviceExists', deviceType: 'router', count: 1 },
          { type: 'deviceExists', deviceType: 'switch', count: 1 },
          { type: 'deviceExists', deviceType: 'pc',     count: 3 },
        ],
      },
    },
    {
      id: 't2',
      label: 'Place all 5 devices on the map',
      hint: 'Drag each device from Inventory onto the floorplan.',
      condition: { type: 'devicesPlaced', roles: ['router', 'switch', 'pc1', 'pc2', 'pc3'] },
    },
    {
      id: 't3',
      label: 'Cable: Router → Switch, Switch → each PC',
      hint: 'Right-click Router → Connect Cable → click Switch. Then right-click Switch → Connect Cable → click each PC.',
      condition: {
        type: 'and',
        conditions: [
          { type: 'cabled', roleA: 'router', roleB: 'switch' },
          { type: 'cabled', roleA: 'switch', roleB: 'pc1' },
          { type: 'cabled', roleA: 'switch', roleB: 'pc2' },
          { type: 'cabled', roleA: 'switch', roleB: 'pc3' },
        ],
      },
    },
    {
      id: 't4',
      label: 'Configure the router LAN interface & bring it up',
      hint: [
        'Right-click the Router → Open Terminal, then type:',
        'enable', 'configure terminal',
        'interface GigabitEthernet0/0', 'ip address 10.0.10.1 255.255.255.0', 'no shutdown',
      ],
      condition: {
        type: 'interfaceConfigured', role: 'router',
        requires: ['ip', 'subnetMask', 'notAdminDown'],
      },
    },
    {
      id: 't5',
      label: 'Configure all 3 PCs with IPs in 10.0.10.0/24',
      hint: [
        'Each PC needs its own IP, configured on its own terminal:',
        { role: 'pc1', cmd: 'ip addr add 10.0.10.101/24 dev eth0' },
        { role: 'pc1', cmd: 'ip link set eth0 up' },
        { role: 'pc2', cmd: 'ip addr add 10.0.10.102/24 dev eth0' },
        { role: 'pc2', cmd: 'ip link set eth0 up' },
        { role: 'pc3', cmd: 'ip addr add 10.0.10.103/24 dev eth0' },
        { role: 'pc3', cmd: 'ip link set eth0 up' },
      ],
      condition: {
        type: 'and',
        conditions: [
          { type: 'sameSubnet', roleA: 'pc1', roleB: 'router' },
          { type: 'sameSubnet', roleA: 'pc2', roleB: 'router' },
          { type: 'sameSubnet', roleA: 'pc3', roleB: 'router' },
        ],
      },
    },
    {
      id: 't6',
      label: 'Router can ping all 3 PCs',
      hint: [
        'Open the Router terminal and ping each PC (use their actual IPs):',
        { role: 'router', cmd: 'ping 10.0.10.101' },
        { role: 'router', cmd: 'ping 10.0.10.102' },
        { role: 'router', cmd: 'ping 10.0.10.103' },
      ],
      condition: {
        type: 'and',
        conditions: [
          { type: 'pingSucceeded', roleA: 'router', roleB: 'pc1' },
          { type: 'pingSucceeded', roleA: 'router', roleB: 'pc2' },
          { type: 'pingSucceeded', roleA: 'router', roleB: 'pc3' },
        ],
      },
    },
    {
      id: 't7',
      label: 'Bonus: PC-1 can ping PC-2 directly (proves switch forwarding)',
      optional: true,
      hint: [
        "From PC-1's terminal, ping PC-2 directly — the switch forwards this on its own, without the router:",
        { role: 'pc1', cmd: 'ping 10.0.10.102' },
      ],
      condition: { type: 'pingSucceeded', roleA: 'pc1', roleB: 'pc2' },
    },
  ],
}
