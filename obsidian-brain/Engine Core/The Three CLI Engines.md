---
tags: [engine, cli]
---

# The Three CLI Engines

**Each OS keeps its own idioms — no leakage, ever.** This is a locked design decision
(see [[Decisions Log]]): a player configuring a router should never
see a Linux command work, and vice versa. Every device's terminal (`@xterm/xterm`,
mounted and kept alive even when hidden — see [[UI Component Map]])
is backed by exactly one of these three engines, chosen by device type.

## `CLIEngine` — IOS (router / switch / firewall)

`src/models/CLIEngine.js`. The file opens with the project's L2-vs-L3 device
contract as a comment block (quoted in full in
[[Layer 2 Switching and VLANs]]) —
read that before touching this file.

- Modal prompt matching real IOS: `hostname>` (user exec) → `hostname#` (priv exec)
  → `hostname(config)#` → `hostname(config-if)#` / `(config-subif)#` /
  `(config-vlan)#` / `(dhcp-config)#`.
- `execute(device, input)` dispatches on the first token; unrecognized/malformed
  input returns real IOS error strings (`% Invalid input detected at '^' marker.`,
  `% Incomplete command.`) — never an invented message. See
  [[Failure Reason Codes]].
- `executePingAsync(device, targetIp, { onStart, onPacket, onDone })` — fires
  `onPacket(index, reachable)` once per ICMP echo (5 echoes, ~1100ms apart, matching
  the felt cadence of a real `ping` in a terminal), backed by `checkPing()` under the
  hood (see
  [[Ping Reachability Engine (checkPing)|checkPing]]). Returns a
  `cancel()` closure so a device switch or reset can abort pending timers cleanly.
- Owns router-on-a-stick subinterface config, VLAN/trunk config, DHCP pool config,
  NAT ACL/overload config, and (on `firewall`-type devices) `nameif`/`firewall-rule`
  zone policy — the full IOS-and-ASA-inspired surface described across the
  [[Home|Networking Model]] notes.

## `PCCLIEngine` — Linux iproute2 (pc / server, and laptop when `os_type !== 'windows'`)

Real iproute2 idioms: `ip addr add|del <ip>/<prefix> dev eth0`, `ip link set eth0 up/down`,
`ip route add|replace|del`, `ping`, `dhclient [-r]`. It fails where the real tools fail
(`RTNETLINK answers: File exists` / `No such process` / `Cannot assign requested address`,
`Error: Nexthop has invalid gateway.` when no enabled interface covers the gateway, `dhclient …
is already running - exiting.`), and deleting an interface's address flushes the routes that
depended on it — see the "Host shell rules" section of `docs/NETWORKING_ACCURACY.md`.
**Simplification:** in NetSim every interface — hosts included — boots administratively down
(real Linux hosts boot with the NIC up), which is why missions teach `ip link set eth0 up` and
why addr → up → route is the working order (see [[Interface States and Cabling]]).
Device-model interface names like `Ethernet0/0` are shown to the player as `eth0`,
matching how Linux actually names NICs.

## `WindowsCLIEngine` — Windows CMD (admin laptop, when `os_type === 'windows'`)

A third, distinct idiom set for the one device type that's the player's own machine
rather than client-purchased gear. See [[Admin Laptop and Tools]].

Commands: `ipconfig [/all|/release|/renew]`, `route print|add|delete`, `ping`, `arp -a`, and
`netsh interface …` — `ip set address` (positional or `name= source= addr= mask= gateway=`),
`ip delete address`, `ip show config`, `set interface name=… admin=enabled|disabled` and
`show interface`. Until 2026-09 a Windows laptop could never get link at all (its adapter
boots administratively down and there was no enable command); the shell now has one, switching
static ↔ DHCP works, `ipconfig /renew` keeps the address, and bad `netsh` values are refused
rather than silently corrected. It has its own test file, `winshell.test.js`.

## The shared contract across all three

- No engine ever accepts a command real hardware/OS would reject, and no engine ever
  fabricates a `show`/`ip addr`/`ip route` output field that the underlying `Device`/
  `Topology` state doesn't actually have. If a GUI tool (Firewall Web UI, future
  scanner) writes config, it writes to the exact same `Device` fields these CLI
  engines read and write — `show running-config` (or the Linux/Windows equivalent)
  is always the arbiter of true state, never a second, parallel store.
- Before adding or changing any command, argument form, error string, or `show`
  output: would this literally appear on real IOS / iproute2 / Windows CMD? If
  unsure, reject with the real error rather than accept something invented. See
  `docs/NETWORKING_ACCURACY.md` and the `/cli-command` skill in
  [[Working with Claude Code]].

## Related

[[Device and Topology Model]] · [[Layer 2 Switching and VLANs]] ·
[[Admin Laptop and Tools]]
