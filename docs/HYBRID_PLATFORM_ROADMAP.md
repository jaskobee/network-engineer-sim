# NetSim — Hybrid Platform Roadmap (On-prem + Cloud + Hybrid)

**Status:** Settled direction as of 2026-10-05. Design document — no code in this file.
**Companion specs:** `NETWORKING_ACCURACY.md` (on-prem hard spec), `AZURE_ACCURACY.md`
(cloud hard spec), `PHASE_0_KERNEL_EXTRACTION.md` (first implementation phase).

---

## 1. Decision record

NetSim expands from an on-prem networking game (Cisco IOS + Linux hosts) into a
platform covering **three learning tracks**:

| Track | What the player learns | Cert alignment (labels only, no claims of coverage) |
|---|---|---|
| **On-prem** | Routers, switches, VLANs, routing, DHCP, NAT, firewalls | CCNA, Network+ |
| **Cloud** (Azure first) | VNets, subnets, NSGs, routing, peering, private endpoints, DNS | AZ-900, AZ-104, AZ-700 |
| **Hybrid** | Connecting on-prem to cloud: S2S VPN, address planning, hybrid DNS, routing both sides | AZ-700 + CCNA overlap |

The player picks a route freely. Hybrid content is *recommended* after the basics of
both sides, never hard-locked (UX rule: don't punish curiosity). Instead, hybrid
missions show a "skills you'll use" panel, and the hint ladder links back to the
relevant on-prem or cloud lesson.

**What does NOT change:**
- Accuracy outranks convenience. Every hard rule in `CLAUDE.md` still applies.
- Web-first, install-free. No game engine migration.
- Every simulated thing is a real node evaluated by a real engine — on-prem devices
  and cloud resources alike. No synthesized results.
- **NetSim never connects to real Azure.** No real credentials, no real API calls,
  no "import my subscription". (Security by design. If an import feature is ever
  considered, it is a separate, read-only, opt-in project with its own threat model.)

---

## 2. Player experience

```
                 ┌────────────── Foundations (shared) ──────────────┐
                 │ IP addressing · subnetting · DNS basics · ping   │
                 └───────┬──────────────────┬───────────────────────┘
                         │                  │
              ┌──────────▼───┐        ┌─────▼──────────┐
              │  On-prem     │        │  Cloud (Azure) │
              │  track       │        │  track         │
              └──────────┬───┘        └─────┬──────────┘
                         └───────┬──────────┘
                          ┌──────▼──────┐
                          │   Hybrid    │   capstone: branch office ↔ Azure hub-spoke
                          └─────────────┘
```

- **Foundations** is shared because subnet math is identical on both sides — and the
  differences (Azure reserves 5 IPs per subnet, not 2) become explicit teaching moments.
- **One economy, one career.** Money, reputation, and unlocks are shared across
  tracks. A player's career title reflects what they've done (Network Engineer /
  Cloud Engineer / Hybrid Architect), not a choice made on day one.
- **Cloud-native gamification hook:** cost is part of the job. Cloud missions end
  with a "monthly bill" built from the resources the player deployed. Mastery stars
  reward real best practice: no public IPs on VMs, least-privilege NSG rules,
  private endpoints over public access, right-sized subnets. Prices are labeled as
  approximate in-game values, never presented as real Azure pricing.
- **Two lenses on the cloud canvas** (core design insight):
  - *Management view*: Management Group → Subscription → Resource Group → resources.
  - *Network view*: Region → VNet → Subnet → NICs, with PaaS services drawn
    *outside* VNets, connected via private endpoints (a NIC inside the subnet).
  The same resource appears in both. Teaching that resource groups do not constrain
  networking is one of the highest-value lessons in the cloud track.
- **Hybrid canvas:** on-prem floorplan on one side, Azure region on the other,
  joined by gateway/connection objects. One map, one evaluator.

---

## 3. Architecture

### 3.1 Code boundaries (start simple)

Do **not** introduce a multi-package workspace yet — it adds tooling cost with no
payoff until there's a second deployable. Start with folder boundaries inside the
existing Vite app, enforced by an architecture test:

```
src/
  core/       ipUtils, PathResult + failureReason registry, evaluator interfaces,
              mission/fault framework, save-format versioning, DNS resolver (later)
  guest/      Linux shell engine (today's PCCLIEngine) — shared by on-prem PCs/servers
              AND Azure VMs. One Linux, two worlds.
  onprem/     Device, Topology (on-prem forwarding plane), IOS CLIEngine, DHCPEngine
  cloud/      Resource model, ARM-style validator, Azure forwarding plane,
              az CLI engine, Network Watcher tools        (Phase 1+)
  hybrid/     Boundary adapters: VPN gateway ↔ on-prem router  (Phase 5)
  components/ UI (canvas lenses, inspectors, terminals, mission panel)
```

Rule: `core` imports nothing from `onprem`/`cloud`/`hybrid`. `onprem` and `cloud`
never import each other — only `hybrid` may import both.

### 3.2 One evaluator contract, pluggable forwarding planes

Today `checkPing` returns a result object with `failureReason`. Generalize that
contract (it already has the right shape) rather than building a parallel cloud one:

```js
evaluatePath(src, dst, service) → PathResult {
  reachable, failureReason, failurePoint,
  hops: [ { nodeId, ingress, egress, decision } ]   // decision = the route / NSG rule /
}                                                   // firewall rule that ACTUALLY decided
```

Each domain provides a forwarding plane: `onprem` (existing BFS), `cloud` (effective
routes + NSG + peering), and `hybrid` adapters that hand a flow across the boundary.
The bidirectional rule applies end to end: a reply from Azure to on-prem must also
find a route back through the on-prem router.

**Relationship to the open WireFish / packet-event question:** `hops[].decision` is
the real evaluation record — the engine logging *why* it forwarded — not a
synthesized packet trace, so it does not violate the "no fake traces" rule. It's
also exactly what Azure Network Watcher shows (next hop, matching security rule),
and a natural stepping stone toward a packet-event model later. Decide this before
cloud Phase 2.

### 3.3 Cloud is declarative

On-prem is an imperative CLI state machine. Azure is desired-state. The cloud side
gets a **resource model + validator** (ARM-like: names, containment, CIDR rules,
reserved subnet names) as its source of truth. Every input surface produces the same
deployment operations:

1. Canvas/forms (visual-first players) — Phase 1
2. `az` CLI subset in the existing xterm terminal — Phase 2
3. Bicep (read-only view first, then authoring) — later

### 3.4 Reuse that keeps things honest

- **Azure VMs run the existing Linux engine** — `ip addr`, `ping`, plus new
  `nslookup`/`dig` and `curl` (needed for DNS and port-based NSG lessons). The NIC
  IP comes from Azure; a player hand-editing it inside the guest OS breaks
  connectivity, which is accurate and makes a great fault.
- **Service model** (`{protocol, port}`) from the firewall engine is reused by NSGs.
- **Fault injection** works unchanged: cloud faults mutate real resource state
  (unlinked DNS zone, missing peering side, wrong UDR next hop, NSG deny at lower
  priority number).
- **Not reused in VNets:** switches, VLANs, and the DHCP server engine. Azure VNets
  don't expose L2 to customers (see `AZURE_ACCURACY.md` A7). The validator must
  refuse to place them inside a VNet, with an explanation.

### 3.5 Save format

Add a `schemaVersion` and a `domain` field (`onprem` | `cloud`) per node now, so
save/load and topology sharing work across tracks without a migration later.
XSS reminder carries over: resource names are user strings — escape at render,
validate at input (Azure naming rules make good input validators).

---

## 4. Phased plan

Each phase ends with green `npm test`, clean `npx vite build`, and its exit criteria.
Claude Code receives **one phase at a time**.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Kernel extraction** | Folder boundaries, failureReason registry, PathResult contract, `domain`/`schemaVersion` in save data. **Zero behavior change.** | Same test count passes; missions 001–003 + sandbox labs unchanged; architecture test enforces import rules |
| **1 — Cloud resource model** | Subscription, RG, VNet, Subnet, NIC, VM, Public IP, NSG as resources; validator; the two canvas lenses; no traffic yet | Validator tests for every VERIFIED rule in `AZURE_ACCURACY.md` §A, §B |
| **2 — Azure forwarding plane** | System routes, NSG evaluation, default-outbound behavior, VM guest = Linux engine, Network Watcher tools (IP flow verify, next hop, effective routes, effective security rules), `az` CLI subset | First 2–3 cloud missions playable; every broken scenario asserts its `failureReason` |
| **3 — Peering & UDRs** | VNet peering (both sides), non-transitivity, route tables, NVA with IP forwarding | Hub-spoke lab: spoke↔spoke fails without NVA, works with NVA + UDRs |
| **4 — DNS & Private Link** | Core DNS resolver, Azure-provided DNS, private DNS zones + VNet links, storage account, private endpoints, public-access toggle | "DNS resolves public IP" fault mission works end to end |
| **5 — Hybrid** | VPN gateway, GatewaySubnet, local network gateway, connection; on-prem router side; address-overlap rules; gateway transit; hybrid DNS | Capstone: branch PC reaches spoke VM via hub gateway, both directions |
| **6 — Tracks & progression** | Track picker, shared career/economy, cost model, mastery scoring for cloud | New player can start on any track |

---

## 5. Sequencing with the existing backlog

1. **Phase 0 first.** It's a refactor protected by ~220 tests — cheapest while the
   codebase is still small.
2. **Then Mission 004.** It's the on-prem track's capstone, the engine already
   supports it, and it proves Phase 0 broke nothing in a real playthrough.
3. **Refresh `CLAUDE.md`** alongside Phase 0 (known drift: NAT, `subnet_mismatch`,
   missing `nat_required`/`blocked_by_firewall`). Proposed new section below.
4. **Cloud Phases 1 → 4**, then **Hybrid (5)**.
5. **Admin Laptop** (firewall GUI, netscan) is paused, not cancelled. WireFish's
   engine question is folded into the PathResult decision in §3.2.

---

## 6. Settled decisions vs open questions

### Settled
- Azure is the first cloud. The core stays cloud-agnostic so AWS/GCP can be added later.
- Cloud accuracy is governed by `AZURE_ACCURACY.md`; rules marked TO-VERIFY are not
  implemented until verified.
- Azure VMs reuse the Linux guest engine.
- The sim never talks to real Azure.
- The sim models **current** Azure defaults (e.g. private subnets for new VNets),
  with mission notes when older behavior still exists in the real world.

### Open (decide before the phase that needs it)
1. **Azure icons & naming** (before Phase 1 UI): Microsoft publishes architecture
   icons under specific terms; read them before shipping. Until then, use our own
   icon set. Using "Azure" in marketing → check Microsoft trademark guidelines.
2. **Packet-event engine vs decision-trace PathResult** (before Phase 2): §3.2.
3. **ICMP behavior in Azure** (before Phase 2): verify, or base mission success on
   TCP checks (`curl`, Network Watcher-style connection tests).
4. **On-prem VPN fidelity** (before Phase 5): real IOS IKEv2/IPsec + tunnel-interface
   config subset vs a simpler on-prem "VPN appliance" device. Accuracy rule says
   whatever we ship must be real syntax — likely a deliberately small but genuine
   IOS subset.
5. **Provisioning time** (Phase 5): real VPN gateways take a long time to deploy.
   Model a compressed timer, labeled as compressed, so the lesson ("plan ahead")
   survives.
6. **Product name**: "NetSim" still fits; confirm before any public launch.

---

## 7. Proposed CLAUDE.md addition

```
## Platform scope (updated 2026-10-05)
NetSim covers three tracks: On-prem (IOS + Linux), Cloud (Azure first), Hybrid.
- Cloud behavior is governed by docs/AZURE_ACCURACY.md (hard spec, same status as
  NETWORKING_ACCURACY.md). Never implement a rule marked TO-VERIFY — stop and flag.
- Code boundaries: src/core never imports onprem/cloud/hybrid; onprem and cloud never
  import each other; only src/hybrid may import both. Enforced by an architecture test.
- NetSim never connects to real Azure or handles real cloud credentials.
- Roadmap and phase order: docs/HYBRID_PLATFORM_ROADMAP.md.
```
