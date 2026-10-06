# AZURE_ACCURACY.md — Cloud Accuracy Spec (Azure)

Hard spec, sibling of `NETWORKING_ACCURACY.md`. All cloud behavior, `az` CLI output,
canvas validation, and mission checks must comply with it.

**Last full review:** 2026-10-05

## How to use this file

Every invariant has an ID, the real-world rule, what the sim must do, a source, and
a status:

- **VERIFIED** — checked against the cited source on the review date.
- **TO-VERIFY** — believed correct, not yet checked against Microsoft Learn.
  **Claude Code: do not implement a TO-VERIFY rule.** Stop and flag it; Jasko verifies
  it and flips the status.

Source priority: `learn.microsoft.com` docs > Microsoft Q&A answers from Microsoft
staff > Azure Architecture Center > community posts. A community post is never the
only source for a VERIFIED rule.

**Azure changes over time; CCNA content mostly doesn't.** Re-review this file every
quarter and record changes in the Drift Log at the bottom.

---

## A. Addressing & subnets

**A1 — Five reserved IPs per subnet.** Azure reserves the first four addresses and
the last: `.0` network, `.1` default gateway, `.2`/`.3` Azure DNS mapping, last =
broadcast.
*Sim:* the validator refuses these on NICs/private endpoints; usable = 2^(32−prefix) − 5.
Teaching moment: on-prem a /24 has 254 usable addresses, in Azure 251.
*Source:* https://learn.microsoft.com/en-us/azure/application-gateway/configuration-infrastructure
(reserved addresses); VNet FAQ excerpt quoted at
https://learn.microsoft.com/en-us/answers/questions/2046376/ — **VERIFIED**

**A2 — Smallest subnet is /29 (3 usable).**
*Source:* https://learn.microsoft.com/en-au/azure/api-management/virtual-network-injection-resources — **VERIFIED**

**A3 — Subnets must sit inside the VNet address space and must not overlap each
other.** *Source:* VNet overview — **TO-VERIFY**

**A4 — A VNet lives in one region and one subscription.** — **TO-VERIFY**

**A5 — NIC private IPs are allocated by Azure** (dynamic or static, configured on
the NIC resource). The guest OS receives the address from Azure.
*Sim:* the IP is set on the NIC resource, not inside the VM's Linux shell.
*Source:* https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/private-ip-addresses
— **VERIFIED** (allocation methods). Behavior when a user hard-codes a different IP
inside the guest — **TO-VERIFY** (planned as a fault).

**A6 — 168.63.129.16 is the Azure-provided DNS / platform virtual IP.** VNets linked
to a private DNS zone resolve it through Azure-provided DNS at this address.
*Source:* https://learn.microsoft.com/en-us/azure/networking/foundations/network-foundations-overview — **VERIFIED**

**A7 — No customer-visible L2 inside a VNet** (no broadcast/multicast, so a
customer-run DHCP server doesn't serve VNet clients the way it does on a LAN).
*Sim:* switches, VLANs, and the DHCP server engine cannot be placed inside a VNet.
— **TO-VERIFY** (find the official statement before Phase 1 enforces it)

**A8 — Reserved subnet names:** `GatewaySubnet`, `AzureFirewallSubnet`,
`AzureBastionSubnet` (exact names, minimum sizes apply). — **TO-VERIFY** (sizes per service doc)

---

## B. Outbound internet access

**B1 — New VNets default to private subnets.** For API versions released after
March 31, 2026, subnets in new VNets have `defaultOutboundAccess = false`.
Existing VNets keep their behavior.
*Sim:* subnets the player creates are private by default. Mission text notes that
older real-world VNets may still have default outbound access.
*Source:* https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/default-outbound-access — **VERIFIED**

**B2 — Private-subnet VMs need an explicit outbound method:** NAT Gateway, Load
Balancer outbound rules, or an instance-level public IP.
*Source:* Microsoft staff answer https://learn.microsoft.com/en-us/answers/questions/5845237/
— **VERIFIED** (cross-check the list against the doc in B1 before implementing).

---

## C. Network Security Groups

**C1 — Custom rule priority is 100–4096. Lower number = evaluated first; the first
match stops processing.** Priority must be unique per direction.
*Source:* https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview,
https://learn.microsoft.com/en-us/azure/virtual-network/manage-network-security-group — **VERIFIED**

**C2 — Default rules exist in every NSG and can't be deleted, only overridden.**
Inbound: AllowVNetInBound 65000 · AllowAzureLoadBalancerInBound 65001 · DenyAllInBound 65500.
Outbound: AllowVnetOutBound 65000 · AllowInternetOutBound 65001 · DenyAllOutBound 65500.
*Source:* NSG overview (above);
https://learn.microsoft.com/en-us/azure/networking/design-guide/network-application-security-groups
— **VERIFIED** for 65000/65500. 65001 rule names and scope — **TO-VERIFY** (read the overview table).

**C3 — Translation order:** inbound NSG rules evaluate *after* public→private
translation; outbound rules evaluate *before* private→public translation.
*Sim:* NSG rules always match private IPs, never a VM's public IP.
*Source:* NSG overview — **VERIFIED**

**C4 — NSGs are stateful;** rule changes affect only new connections.
*Source:* NSG overview ("modifying rules will only affect new connections") —
**VERIFIED** for the rule-change behavior; reuse the session model from the firewall engine.

**C5 — NSG on both subnet and NIC:** inbound = subnet NSG then NIC NSG; outbound =
NIC NSG then subnet NSG. Both must allow. — **TO-VERIFY**

**C6 — Scope of the `VirtualNetwork` service tag** (VNet space, peered VNets, and
on-prem prefixes learned through a gateway?). Critical for hybrid missions. — **TO-VERIFY**

**C7 — Supported protocols and ICMP behavior** (within a VNet and to/from the
internet). Until verified, base mission success on TCP checks (`curl`,
connection-test tool), not `ping`. — **TO-VERIFY**

---

## D. Routing

**D1 — System routes are created automatically for every subnet.** They can't be
created or deleted, only overridden with user-defined routes (UDRs).
*Source:* https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-udr-overview,
https://learn.microsoft.com/en-us/training/modules/control-network-traffic-flow-with-routes/2-azure-virtual-network-route — **VERIFIED**

**D2 — Route selection.** Longest prefix match across system, BGP, and UDR routes.
On equal prefixes: UDR > BGP > system. Exceptions: system routes for VNet, peering,
and service-endpoint traffic are preferred, and service-endpoint routes can't be
overridden.
*Source:* udr-overview (above);
https://learn.microsoft.com/en-us/azure/virtual-network/diagnose-network-routing-problem
— **VERIFIED** (re-read the exact exception wording before implementing).

**D3 — `VirtualAppliance` next hop requires IP forwarding enabled on the NVA's NIC**
(and forwarding in the NVA's OS). Otherwise packets are dropped.
*Source:* diagnose-network-routing-problem — **VERIFIED**

**D4 — UDR next hop types:** VirtualNetworkGateway, VnetLocal, Internet,
VirtualAppliance, None. — **TO-VERIFY** (exact list and names)

**D5 — Bidirectional rule carries over from NETWORKING_ACCURACY.md.** Asymmetric
paths through a stateful NVA or firewall fail. (Core NetSim rule; Azure-specific
mission wording TO-VERIFY.)

---

## E. VNet peering

**E1 — Peering is non-transitive.** A↔B and B↔C does not give A↔C.
*Source:* https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-manage-peering,
https://learn.microsoft.com/en-us/azure/architecture/reference-architectures/hybrid-networking/virtual-network-peering — **VERIFIED**

**E2 — Peering adds system routes** with next hop `VNetPeering` for each address
space of the peer.
*Source:* https://learn.microsoft.com/en-us/troubleshoot/azure/virtual-network/virtual-network-troubleshoot-peering-issues — **VERIFIED**

**E3 — Both directions must be configured;** each side is its own peering resource,
and traffic flows only when the peering is *Connected*.
*Sim:* a one-sided peering is a planned fault (`peering_incomplete`).
*Source:* https://learn.microsoft.com/en-us/azure/vpn-gateway/vpn-gateway-different-region — **VERIFIED**

**E4 — VNets with overlapping address spaces can't be peered.** — **TO-VERIFY**

**E5 — Gateway transit:** the hub side enables *Allow gateway transit*, the spoke side
enables *Use remote gateways*. Only one peering per VNet may use remote gateways, and
not if that VNet has its own gateway.
*Source:* https://learn.microsoft.com/en-us/dotnet/api/microsoft.azure.management.network.models.virtualnetworkpeering.useremotegateways,
virtual-network-manage-peering — **VERIFIED**

**E6 — Spoke↔spoke traffic needs an NVA/firewall in the hub plus UDRs** (or a managed
alternative). Don't route spoke-to-spoke through VPN gateways.
*Source:* virtual-network-peering architecture doc (E1) — **VERIFIED**

---

## F. Private endpoints & DNS

**F1 — A private endpoint gets a private IP from the subnet.** Clients keep using the
public FQDN, and DNS decides where the traffic goes:
`account.blob.core.windows.net` → CNAME `account.privatelink.blob.core.windows.net`
→ A record (private IP) **if** the client's resolver has the private zone; otherwise
the public answer.
*Source:* https://learn.microsoft.com/en-us/azure/storage/common/storage-private-endpoints — **VERIFIED**

**F2 — Zone name per sub-resource:** blob `privatelink.blob.core.windows.net`,
file `privatelink.file.core.windows.net`, dfs `privatelink.dfs.core.windows.net`,
table, web, etc.
*Source:* storage-private-endpoints — **VERIFIED**

**F3 — The private DNS zone must be linked to the VNet whose Azure-provided DNS
answers the query** (directly, or through a hub resolver design).
*Source:* https://learn.microsoft.com/en-us/azure/architecture/networking/guide/private-link-virtual-wan-dns-guide,
network-foundations-overview — **VERIFIED**
*Flagship fault:* the zone exists but isn't linked → the VM resolves the public IP →
access fails when public network access is disabled.

**F4 — On-prem resolution:** the conditional forwarder targets the *public* zone
(e.g. `blob.core.windows.net`), not the `privatelink` zone, pointing at a resolver in
Azure. — **TO-VERIFY** (only community and Cloud Adoption Framework sources so far;
confirm in Microsoft's private endpoint DNS doc)

**F5 — Storage with public network access disabled rejects requests arriving via the
public endpoint.** Exact client error output — **TO-VERIFY**. Never invent error strings.

---

## G. Hybrid (Phase 5) — all TO-VERIFY before Phase 5

GatewaySubnet requirements · Local Network Gateway address prefixes must match the
on-prem ranges · connection shared key on both sides · BGP optional vs static ·
overlapping on-prem/VNet ranges can't be routed · the on-prem router needs a route to
the VNet prefixes (the bidirectional rule again) · gateway provisioning time (compress
in the sim, label as compressed).

## H. Management plane — TO-VERIFY before Phase 1

H1 A resource belongs to exactly one resource group · H2 a resource group doesn't
constrain networking (a VM in RG-A can use a VNet in RG-B) · H3 RBAC inherits
Management Group → Subscription → RG → resource.

---

## Cloud failureReason codes (proposed, Phase 2+)

| Code | Meaning | Real-world tool that reveals it |
|---|---|---|
| `blocked_by_nsg` | An NSG rule (custom or default) denied the flow | IP flow verify, effective security rules |
| `no_route` | No effective route / next hop `None` | Next hop, effective routes |
| `nva_forwarding_disabled` | UDR to an appliance with IP forwarding off | Next hop + NIC settings |
| `peering_not_transitive` | Destination only reachable via another peered VNet | Effective routes |
| `peering_incomplete` | Peering not Connected (one side missing) | Peering status |
| `dns_resolves_public` | Private zone not linked, so the name resolved to the public IP | `nslookup` in the VM |
| `public_access_disabled` | PaaS public endpoint is closed | Resource networking settings |
| `no_outbound_method` | Private subnet, no explicit outbound path (B1/B2) | Subnet + NIC config |
| `no_return_path` | Shared with on-prem: reply has no route back | Effective routes on both sides |

Each code maps to what the real Network Watcher tool would show. The sim's
diagnostic tools are modeled on Network Watcher, not invented.

## Documented simplifications (must be labeled in-game)

- Provisioning times are compressed.
- Prices are approximate in-game values, not live Azure pricing.
- Single tenant; Entra ID / identity modeling comes later.
- Control-plane propagation delays (e.g. Resource Graph latency) aren't modeled.

## Cloud accuracy gate (run on every cloud change)

1. Is every rule this change relies on VERIFIED in this file?
2. Would real Azure allow/deny this exact configuration, and would real `az` output
   look like this?
3. Does any flow succeed that real Azure would drop (NSG, routes, peering, DNS)?
4. Is the reserved-IP and CIDR math correct for every subnet involved?
5. Would a learner have to unlearn this for AZ-104/AZ-700 or a real job?
6. Is any simplification labeled as one?

---

## Drift Log

- **2026-10-05 — Default outbound access.** Originally announced for
  September 30, 2025. Now applies to new VNets created with API versions released
  after March 31, 2026; existing VNets unchanged. Good example of why this file is
  dated.
  Sources: default-outbound-access doc (B1); Microsoft Q&A
  https://learn.microsoft.com/en-us/answers/questions/5593965/
