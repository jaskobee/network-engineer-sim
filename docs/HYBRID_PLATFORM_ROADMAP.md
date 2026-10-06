# NetSim — Hybrid Platform Roadmap (On-prem + Cloud + Hybrid)

**Status:** Settled direction as of 2026-10-05; cloud section scope updated 2026-10-06 (§1, §2, §4–§6).
Design document — no code in this file.
**Companion specs:** `NETWORKING_ACCURACY.md` (on-prem hard spec), `AZURE_ACCURACY.md`
(cloud hard spec), `PHASE_0_KERNEL_EXTRACTION.md` (first implementation phase).

---

## 1. Decision record

NetSim expands from an on-prem networking game (Cisco IOS + Linux hosts) into a
platform covering **three learning tracks**:

| Track | What the player learns | Cert alignment (labels only, no claims of coverage) |
|---|---|---|
| **On-prem** | Routers, switches, VLANs, routing, DHCP, NAT, firewalls | CCNA, Network+ |
| **Cloud** (Azure first) | The whole infrastructure, not only the network: management groups, subscriptions, resource groups, governance (RBAC, Azure Policy), VNets/subnets/NSGs, routing, peering, VMs, storage accounts, private endpoints, private DNS | AZ-900, AZ-104, AZ-305, AZ-700 |
| **Hybrid** | Connecting on-prem to cloud: S2S VPN, address planning, hybrid DNS, routing both sides | AZ-700 + CCNA overlap |

**Cloud is its own section of the app** (decided 2026-10-06), next to Missions and
Sandbox, with its own missions, progress and sandbox. The current on-prem game is left
untouched — the Phase 0 architecture test already keeps `onprem` and `cloud` code apart.
Its purpose is to teach cloud infrastructure *and* cloud architecture by letting the
player build it and see it: the management hierarchy, resources in resource groups,
networking, private endpoint connections, private DNS resolving.

The player picks a route freely. Hybrid content is *recommended* after the basics of
both sides, never hard-locked (UX rule: don't punish curiosity). Instead, hybrid
missions show a "skills you'll use" panel, and the hint ladder links back to the
relevant on-prem or cloud lesson. Hybrid stays on the roadmap (Phase 5) but is not a
prerequisite for anything in the cloud section.

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
- **Separate progress per section** (changed 2026-10-06 — originally "one economy, one
  career"). The cloud section keeps its own missions, progress and money; the on-prem
  career is not touched. A shared career title (Network Engineer / Cloud Engineer /
  Hybrid Architect) can be layered on later without merging the two economies.
- **Build first, then see it work.** In the first cloud release the player builds with
  visual canvas + portal-*style* creation forms (our own look and icons — see open
  question 1). The `az` CLI arrives later and drives the same resource model.
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
| **0.5 — Cloud spec** | Extend `AZURE_ACCURACY.md` to the first release's scope: management groups (root, depth, moves), subscriptions, resource groups (naming, containment, region), VM + NIC + managed disk, public IP, storage accounts (naming, global uniqueness, performance/redundancy, public network access), RBAC (role definitions, assignments, scope inheritance) and Azure Policy (definitions, assignments, effects, inheritance, exclusions). Researched against Microsoft Learn; the owner flips each rule to VERIFIED | Every rule Phase 1a/1b relies on is VERIFIED with a source; anything else stays out of scope |
| **1a — Cloud section + resource model** | The Cloud section in the app (own missions, progress, sandbox); resource model + ARM-style validator for management groups, subscriptions, RGs, VNet/Subnet/NSG, VM/NIC/disk, public IP, storage account; the two canvas lenses; portal-style creation forms; first build missions. No traffic yet | Validator tests for every VERIFIED rule in §A, §B, §H and the new resource sections; on-prem game unchanged |
| **1b — Governance** | RBAC role assignments and Azure Policy on the hierarchy: inheritance down management group → subscription → RG → resource, policy effects at create time (e.g. deny a region, require a tag), the effective-access / compliance views; governance missions | Each policy effect and inheritance rule has a test; a denied deployment reports the real reason |
| **2 — Azure forwarding plane** | System routes, NSG evaluation, default-outbound behavior, VM guest = Linux engine, Network Watcher tools (IP flow verify, next hop, effective routes, effective security rules), `az` CLI subset | First 2–3 cloud missions playable; every broken scenario asserts its `failureReason` |
| **3 — Peering & UDRs** | VNet peering (both sides), non-transitivity, route tables, NVA with IP forwarding | Hub-spoke lab: spoke↔spoke fails without NVA, works with NVA + UDRs |
| **4 — DNS & Private Link** | Core DNS resolver, Azure-provided DNS, private DNS zones + VNet links, storage account, private endpoints, public-access toggle | "DNS resolves public IP" fault mission works end to end |
| **5 — Hybrid** | VPN gateway, GatewaySubnet, local network gateway, connection; on-prem router side; address-overlap rules; gateway transit; hybrid DNS | Capstone: branch PC reaches spoke VM via hub gateway, both directions |
| **6 — Tracks & progression** | Cost model ("monthly bill"), mastery scoring for cloud, optional shared career title across sections | New player can start in either section |

---

## 5. Sequencing with the existing backlog

1. **Phase 0 — done 2026-10-06** (branch `phase-0-kernel-extraction`; 833 → 861 tests,
   `CLAUDE.md` refreshed). The "then Mission 004" step is obsolete: Missions 004 and 005
   had already shipped.
2. **Phase 0.5 (cloud spec)** before any cloud code — Phase 1 cannot start on TO-VERIFY rules.
3. **Cloud Phases 1a → 1b → 2 → 3 → 4**, then **Hybrid (5)**. How these interleave with the
   on-prem backlog (DNS phase 2, Act 2 troubleshooting) is the owner's call per phase.
   Note the overlap: on-prem DNS phase 2 and cloud Phase 4 both want a shared resolver
   in `src/core` — design it once.
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
- (2026-10-06) Cloud is a **separate section with its own progress**; the on-prem game
  stays untouched.
- (2026-10-06) First cloud release = **core landing zone + governance**: management
  groups, subscriptions, RGs, networking, VM, storage, RBAC, Azure Policy (Phases 1a/1b).
  Private Link + private DNS follow in Phase 4.
- (2026-10-06) Players first build with a **visual canvas + forms**; `az` CLI later on
  the same model.

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
7. **Identities for RBAC — decided 2026-10-06: fictional principals.** Role assignments
   go to a small, labelled set of fictional users and groups (managed identities only if
   a mission needs one). No Entra ID model; group membership is defined by the mission.
   Labelled in-game as a simplification (`AZURE_ACCURACY.md` documented simplifications).
8. **Policy depth** (before Phase 1b): which effects ship first (e.g. Deny, Audit,
   Modify/Append, DeployIfNotExists) and whether built-in policy definitions are
   reproduced by name — each one must match Microsoft's real definition.

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
