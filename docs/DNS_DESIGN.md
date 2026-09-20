# DNS in NetSim — design (not built yet)

Status: **design agreed, not built.** The owner answered the open questions on 2026-09-20 (see "Decisions" at the end); building phase 1 still needs an explicit go-ahead.
Written 2026-09-20 after the host Configure GUI shipped without a DNS field, because there
was no engine behind one and NetSim does not fake settings.

Big missions will need DNS (name → address, a DNS server on the LAN, a firewall that must
let UDP/53 through, "the site works by IP but not by name"). This doc records how Cisco Packet
Tracer models it, what real gear does that a learner must not have to unlearn, and a phased plan
that fits the engine we have.

## 1. Where we are today

- `device.dns_server` exists on hosts but is only ever **filled by DHCP** (`DHCPEngine`,
  `dhclient`, `ipconfig /renew`). Nothing can set it by hand and nothing reads it except
  `ipconfig /all` / `netsh … show config`.
- Names resolve from a **static table** (`_DNS_MAP` in `models/ipUtils.js`: google.com → 8.8.8.8 …)
  in `ping <name>` (Linux, IOS) and in `TerminalPane`. It is consulted whether or not the device
  has any DNS server, or can reach one. That is fake data: a host with no DNS configured "resolves"
  google.com.
- No mission, hint or test depends on it except one (`nat.test.js`: a router `ping google.com`).
  Making resolution real touches very little existing content.
- Firewall service matching already knows `DNS = udp/53`, so a policy that blocks DNS is
  expressible today — nothing generates DNS traffic to be blocked yet.

## 2. How Packet Tracer does it

| Piece | Packet Tracer |
|---|---|
| DNS server | **Server-PT → Services → DNS**: service On/Off, and a record table (Name, Type — A, AAAA, CNAME, NS, SOA — Address) with Add / Save / Remove. A server needs a static IP first. |
| Client setting | **PC → Desktop → IP Configuration → "DNS Server"** field (next to IP / mask / gateway). DHCP can hand it out (the DHCP service / a router pool has a DNS Server field). |
| Client tools | Command Prompt `nslookup <name>` and `ping <name>`; Web Browser resolves `www.example.com`. If DNS fails: "Ping request could not find host …". |
| Routers | Real IOS: `ip name-server <ip>`, `ip domain-lookup`, `ip host <name> <ip>`, `ip domain-name`; a router can itself answer with `ip dns server`. |
| Scope | Authoritative answers from the server's own table only — no root hints, no recursion. If the record isn't there: not found. |
| Teaching value | The whole chain is visible: client setting → reachability of the server → service on → record present. Simulation mode shows the UDP/53 query and reply as PDUs. |

Two things to copy: the **shape** (client field + server service + a resolver that really walks
the network) and the **failure ladder** (no server configured / server unreachable / service off /
name not found are four different problems, each with its own symptom). One thing to improve on:
PT's client fields are just data; here the resolver must go through the real path.

## 3. What real gear does that we must not get wrong (CCNA / Network+)

- A resolver needs a **configured name server** and a **working path to it** (both directions,
  through NAT and firewalls) on **UDP/53** (TCP/53 for large answers and zone transfers).
- Four distinct failures, worded per OS:
  - *no server configured / none answered* — Linux `ping: x: Temporary failure in name resolution`;
    `nslookup`: `;; connection timed out; no servers could be reached`; Windows `nslookup`:
    `DNS request timed out`; `ping`: `Ping request could not find host x. Please check the name and try again.`
  - *server reachable, service not running* — Linux `nslookup`: `;; communications error to <ip>#53: connection refused`
  - *name doesn't exist* (NXDOMAIN) — Linux `ping: x: Name or service not known`;
    `nslookup`: `** server can't find x: NXDOMAIN`; Windows: `*** … can't find x: Non-existent domain`
  - *answered* — `nslookup` prints `Server:`/`Address:` then `Name:`/`Address:` (with
    `Non-authoritative answer:` when the answer wasn't authoritative).
- Cisco IOS: `ip domain-lookup` is **on by default**, which is why a mistyped command makes the
  router stall on `Translating "xyz"…domain server (255.255.255.255)` — a classic CCNA detail.
  `no ip domain-lookup` turns it off. `show hosts` lists static entries and the cache.
- DHCP option 6 carries the DNS server; a DHCP-configured host learns it, a static host needs it typed.
- A host holds a **list** of name servers, tried in order: Windows has a *preferred* and an *alternate* (more under Advanced), `resolv.conf` takes up to 3 `nameserver` lines, IOS `ip name-server` takes up to 6 addresses, and a DHCP pool can hand out several. One server per host is **not** how real gear works, and CCNA teaches the primary/secondary pair.

## 4. Proposed model

**Data**
- Client: `device.dns_servers` — an ordered list (at least primary + secondary, up to 3 on hosts, 6 on routers). Set by DHCP (as now, which today writes the single `dns_server`) **or by hand**; `dns_server` stays as the first entry until the migration lands.
- Server: `device.dns_service = { enabled, records: [{ name, type: 'A', address }] }` on `server` devices.
- Router as server: `device.dns_server_enabled` + its `ip host` table (IOS parity: `ip dns server`, `ip host`).
- The public internet: the addresses of well-known public resolvers (8.8.8.8, 1.1.1.1) are treated as
  reachable virtual DNS servers that answer from the built-in public table (today's `_DNS_MAP`),
  *only if* the packet can actually get there (default route, NAT, firewall) — so `google.com` keeps
  working in a correctly built network and stops working in a broken one.

**Resolver** — one pure function, `resolveName(topology, clientDevice, name)` in a new
`src/models/dns.js` (no React/DOM). It returns `{ ok, ip, reason, server }`:
1. `name` is already an IP → done.
2. No name server on the client → `no_dns_server`.
3. For each configured server **in order**: `topology.checkPing(clientIp, dnsIp, { protocol: 'udp', port: 53 })` — the existing bidirectional,
   NAT- and firewall-aware check. Unreachable → try the next server; none reachable → `dns_unreachable` (carrying the first underlying `failureReason`). A server that answers NXDOMAIN is *not* skipped — an authoritative "no" ends the search, as on a real resolver.
4. Find the device that owns `dnsIp` (or the public resolver). Service off → `dns_refused`.
5. Look the name up (case-insensitive). Missing → `nxdomain`; found → `ok`.

Every consumer calls it, so a fault anywhere on the path shows up as the right symptom. Successful and
failed queries are recorded through the existing packet capture, so WireFish shows real UDP/53 frames
(no synthesized packets).

**Consumers** — `ping <name>` in all three shells (replacing the static lookup), `nslookup` (Linux,
Windows), `dig`/`host` (Linux, optional), IOS `ping <name>` honouring `ip domain-lookup`, the Browser panel.

**Setting it, per OS (each keeps its idioms)**
- Linux: `resolvectl dns eth0 <ip> [<ip2> …]` / `resolvectl status` (systemd-resolved, what modern Debian/Ubuntu
  use) and `cat /etc/resolv.conf` to read it.
- Windows: `netsh interface ip set dns "Ethernet0" static <ip>` (preferred) then `netsh interface ip add dns "Ethernet0" <ip2> index=2` (alternate) / `… dhcp`, `ipconfig /all`.
- IOS: `ip name-server <ip> [<ip2> …]` (up to 6), `[no] ip domain-lookup`, `ip host <name> <ip>`, `show hosts`.
- GUI: **Preferred** and **Alternate DNS server** fields in the host Configure GUI (next to the gateway), written through the
  same commands — like every other field there.

**Failure reasons** to add to the GLOSSARY table: `dns_no_server`, `dns_unreachable`, `dns_refused`,
`dns_nxdomain`. Mission conditions to add: `resolves { role, name, expect }`; Act 2 faults:
DNS server wrong / service off / record missing / firewall blocking udp/53.

## 5. Phases (each ends with `npm test` + build clean and an accuracy gate)

1. **Client + resolver.** `models/dns.js`; the three shells' resolution paths, `nslookup`, the
   set-DNS commands above; DNS field in the host GUI; the public-resolver table replaces the static
   fake; update `nat.test.js` to configure a name server first. Tests: each failure rung, path faults
   (link down, no route, firewall blocking udp/53, NAT missing), OS-specific wording.
2. **Servers.** `dns_service` on servers with a **Services → DNS** panel (record table, like PT);
   router `ip dns server` / `ip host` / `show hosts`; capture frames; save/load; a preset
   "LAN with a DNS server (solved / service off / record missing)".
3. **Depth.** forwarders (a LAN server forwards misses to 8.8.8.8), CNAME, TTL and a resolver cache with
   `ipconfig /displaydns` / `resolvectl statistics`, mission conditions and Act 2 faults, reason codes.

## 6. Simplifications to label in-game

- Hosts are capped at 3 name servers (real Windows allows more under Advanced) — the primary/secondary pair is what is taught.
- Only A records answer queries in phase 1–2 (other types can be *stored*, not served).
- No recursion until phase 3; no TCP fallback / truncation; no TTLs until phase 3.
- Source ports aren't tracked (same 4-tuple simplification as the firewall).

## 7. Decisions (owner, 2026-09-20)

1. **Server DNS is configured in a GUI, Packet-Tracer style.** Real servers run BIND / dnsmasq /
   Windows DNS Manager; Windows Server's DNS Manager *is* a GUI, and Packet Tracer does it this way.
   CCNA tests the **router** CLI (`ip name-server`, `ip domain-lookup`, `ip host`, `ip dns server`) and
   Network+ tests the concepts (records, resolution order, ports) — so routers stay CLI, servers get the
   Services → DNS panel. **Confirmed.**
2. **Resolution is strict.** A host with no DNS server (or no path to one) cannot resolve `google.com`.
   **Confirmed.**
3. **Linux clients use `resolvectl`** (systemd-resolved), with `cat /etc/resolv.conf` to read the result. **Confirmed.**
4. **Name servers are a list (primary + secondary), from phase 1.** My earlier recommendation of one
   server per host was wrong: it would teach a learner something they must unlearn (preferred/alternate,
   `resolv.conf` up to 3, IOS up to 6). **Revised the same day.**
