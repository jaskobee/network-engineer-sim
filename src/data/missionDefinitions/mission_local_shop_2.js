/**
 * mission_local_shop_2 — "Sam's Corner Store: Hiring Help"
 *
 * Follow-up job for client_local_shop, unlocked by mission_local_shop_1's
 * followUpMissionIds. Reuses the SAME persistent topology from mission 1
 * (router/switch/PC-1..3 are already bought, placed, cabled, and configured —
 * nothing about them needs to change) and adds two new hosts to it. This is
 * the concrete proof that a client's infrastructure survives between missions:
 * the player will see their earlier work still standing, still working, and
 * builds directly on top of it rather than starting from a blank map.
 *
 * No new contractOutcome — the ongoing support contract from mission 1
 * already covers this kind of work.
 */

export const mission_local_shop_2 = {
  id: 'mission_local_shop_2',
  clientId: 'client_local_shop',
  title: "Sam's Corner Store: Hiring Help",
  client: "Sam's Corner Store",
  avatar: '🏪',
  description: "Business is good — Sam just hired a fourth employee and wants a dedicated point-of-sale computer to track inventory. Add a PC for the new hire and a statically-addressed server for the POS system, both on the existing shop LAN.",
  difficulty: 1,
  reward: 400,
  optionalObjectiveBonus: 100,
  requiredReputation: 0,
  requiredKnowledge: ['ip-addressing', 'static-addressing'],
  estimatedDuration: '10-15 min',
  financialModel: 'keep',
  followUpMissionIds: [],
  contractOutcome: null,

  hardware: [
    { type: 'pc',     qty: 1, label: 'PC (new hire)' },
    { type: 'server', qty: 1, label: 'Server (POS system)' },
  ],

  deviceRoles: {
    router: { type: 'router', match: 'first', label: 'Router' },
    switch: { type: 'switch', match: 'first', label: 'Switch' },
    pc1:    { type: 'pc',     match: 'first', label: 'PC-1 (Register)' },
    pc4:    { type: 'pc',     match: 3,       label: 'PC-4 (New Hire)' },
    server: { type: 'server', match: 'first', label: 'POS Server' },
  },

  objectives: [
    {
      id: 't1',
      label: 'Buy a PC and a Server',
      hint: 'Open the Shop tab and purchase one PC and one Server.',
      condition: {
        type: 'and',
        conditions: [
          { type: 'deviceExists', deviceType: 'pc', count: 4 },
          { type: 'deviceExists', deviceType: 'server', count: 1 },
        ],
      },
    },
    {
      id: 't2',
      label: 'Place both new devices on the map',
      hint: 'Drag each new device from Inventory onto the floorplan.',
      condition: { type: 'devicesPlaced', roles: ['pc4', 'server'] },
    },
    {
      id: 't3',
      label: 'Cable both into the existing Switch',
      hint: 'Right-click the Switch → Connect Cable → click the new PC. Repeat for the Server.',
      condition: {
        type: 'and',
        conditions: [
          { type: 'cabled', roleA: 'switch', roleB: 'pc4' },
          { type: 'cabled', roleA: 'switch', roleB: 'server' },
        ],
      },
    },
    {
      id: 't4',
      label: "Configure the new PC's address",
      hint: ['On the new PC terminal:', 'ip addr add 10.0.10.104/24 dev eth0', 'ip link set eth0 up'],
      condition: { type: 'sameSubnet', roleA: 'pc4', roleB: 'router' },
    },
    {
      id: 't5',
      label: 'Give the POS server a static address',
      hint: ['On the Server terminal:', 'ip addr add 10.0.10.50/24 dev eth0', 'ip link set eth0 up'],
      condition: { type: 'sameSubnet', roleA: 'server', roleB: 'router' },
    },
    {
      id: 't6',
      label: 'Router can reach both new devices',
      hint: ['From the Router terminal:', 'ping 10.0.10.104', 'ping 10.0.10.50'],
      condition: {
        type: 'and',
        conditions: [
          { type: 'pingSucceeded', roleA: 'router', roleB: 'pc4' },
          { type: 'pingSucceeded', roleA: 'router', roleB: 'server' },
        ],
      },
    },
    {
      id: 't7',
      label: 'Bonus: the Register PC can reach the new POS server',
      optional: true,
      hint: ["From PC-1 (Register)'s terminal, ping the POS server:", 'ping 10.0.10.50'],
      condition: { type: 'pingSucceeded', roleA: 'pc1', roleB: 'server' },
    },
  ],

  blueprint: {
    segments: [
      {
        id: 'lan',
        label: "Sam's Shop LAN (expanded)",
        subnet: '10.0.10.0/24',
        devices: [
          { role: 'Router', type: 'router' },
          { role: 'Switch', type: 'switch' },
          { role: 'PC-1 (Register)', type: 'pc' },
          { role: 'PC-2 (Office)', type: 'pc' },
          { role: 'PC-3 (Back Room)', type: 'pc' },
          { role: 'PC-4 (New Hire)', type: 'pc' },
          { role: 'POS Server', type: 'server' },
        ],
        svgX: 100, svgY: 20,
      },
    ],
    links: [],
    svgViewBox: '0 0 360 320',
    notes: 'Same LAN as mission 1 — two new hosts join the existing switch. The router and the first three PCs are untouched.',
  },
  layout: [
    {
      zone: "Sam's Shop LAN",
      subnet: '10.0.10.0/24',
      devices: 'PC-4 (.104) · POS Server (.50, static)',
      note: 'Reuses the router and switch from the first job — this is the same network, just bigger.',
    },
  ],
}
