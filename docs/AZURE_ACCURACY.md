# AZURE_ACCURACY.md — Cloud Accuracy Spec (Azure)

Hard spec, sibling of `NETWORKING_ACCURACY.md`. All cloud behavior, `az` CLI output,
canvas validation, and mission checks must comply with it.

**Last full review:** 2026-10-05 · **Phase 0.5 research pass:** 2026-10-06 (sections I–Q
added; A3, A4, A5, A7, C2, C5, C7, E4, H sourced)

## How to use this file

Every invariant has an ID, the real-world rule, what the sim must do, a source, and
a status:

- **VERIFIED** — checked against the cited source on the review date.
- **SOURCED** — Claude found the rule stated on the cited Microsoft Learn page and quoted
  or closely paraphrased it on the date given; **Jasko still checks it and flips it to
  VERIFIED.** Treat SOURCED exactly like TO-VERIFY when implementing: do not build on it.
  Entries marked *(summary)* came from a summarized page fetch, not the verbatim text —
  re-read those on the page before verifying.
- **TO-VERIFY** — believed correct, not yet checked against Microsoft Learn.
  **Claude Code: do not implement a TO-VERIFY or SOURCED rule.** Stop and flag it; Jasko
  verifies it and flips the status.

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
*Addition (2026-10-06):* "The smallest supported IPv4 subnet is /29, and the largest is
/2 … IPv6 subnets must be exactly /64 in size." *Source:* VNet FAQ
https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-faq — **SOURCED**

**A3 — Subnets must sit inside the VNet address space and must not overlap each
other.** FAQ: "Subnet address spaces can't overlap one another." A subnet can be added
when "the subnet address range is not part of another subnet" and "there's available
space in the virtual network's address range." A subnet can be resized only "if no VMs or
services are deployed in it."
*Sim:* the validator refuses an overlapping subnet or one outside the VNet's address
space; resizing a subnet with a NIC in it is refused.
*Source:* VNet FAQ (above) — **SOURCED** 2026-10-06

**A3a — VNet address ranges.** RFC 1918 recommended; RFC 6598 (100.64.0.0/10) "is
treated as a private IP address space in Azure"; other ranges "might work but have
undesirable side effects". Can't be added: 224.0.0.0/4, 255.255.255.255/32,
127.0.0.0/8, 169.254.0.0/16, 168.63.129.16/32.
*Sim:* refuse the five blocked ranges; warn (not refuse) on public/non-RFC-1918 space.
*Source:* VNet FAQ — **SOURCED** 2026-10-06

**A4 — A VNet lives in one region and one subscription.** FAQ: "A virtual network is
limited to a single region. But a virtual network does span availability zones."
Subscription: a VNet is a resource in one resource group, which belongs to one
subscription (J1, J2); a NIC can join "only … a virtual network in the same subscription
and location" (L2).
*Source:* VNet FAQ; NIC page (L2) — **SOURCED** 2026-10-06

**A5 — NIC private IPs are allocated by Azure** (dynamic or static, configured on
the NIC resource). The guest OS receives the address from Azure.
*Sim:* the IP is set on the NIC resource, not inside the VM's Linux shell.
*Source:* https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/private-ip-addresses
— **VERIFIED** (allocation methods). Behavior when a user hard-codes a different IP
inside the guest — **SOURCED** 2026-10-06: "If the IP address assigned to an Azure NIC
that's attached to a VM changes, and the IP address within the VM operating system is
different, you lose connectivity to the VM." (Manual assignment inside the OS is allowed
but "we don't recommend it unless it's necessary".) *Source:* VNet FAQ. Planned as a fault.

**A6 — 168.63.129.16 is the Azure-provided DNS / platform virtual IP.** VNets linked
to a private DNS zone resolve it through Azure-provided DNS at this address.
*Source:* https://learn.microsoft.com/en-us/azure/networking/foundations/network-foundations-overview — **VERIFIED**

**A7 — No customer-visible L2 inside a VNet.** FAQ: "Virtual networks are Layer 3
overlays. Azure does not support any Layer 2 semantics." "Multicast and broadcast are not
supported." Protocols: "You can use TCP, UDP, ESP, AH, and ICMP … Multicast, broadcast,
IP-in-IP encapsulated packets, and Generic Routing Encapsulation (GRE) packets are blocked
in virtual networks."
DHCP — **corrected 2026-10-06**: "Azure virtual networks provide DHCP service and DNS to
Azure virtual machines. However, you can also deploy a DHCP server in an Azure VM to serve
on-premises clients through a DHCP relay agent." So the old wording ("a customer-run DHCP
server doesn't serve VNet clients") is too strong: VNet VMs get their address from Azure's
DHCP; a DHCP server in a VM is a hybrid scenario for on-prem clients.
**Flag for Jasko:** the same FAQ's protocol answer still says "You can't use Dynamic Host
Configuration Protocol (DHCP) by using unicast (source port UDP/68, destination port
UDP/67)", which reads as contradicting the relay answer (updated after UDP/67 rate
limiting was removed). Resolve before Phase 5 models it.
*Sim:* switches and VLANs cannot be placed inside a VNet; VNet VMs always take their
address from the NIC resource (A5); a VM-hosted DHCP server serving on-prem clients is
out of scope until Phase 5.
*Source:* VNet FAQ — **SOURCED** 2026-10-06

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
— **VERIFIED** for 65000/65500. 65001 rule names and scope — **SOURCED** 2026-10-06 from
the overview's default-rules table. Inbound 65001 `AllowAzureLoadBalancerInBound`:
source `AzureLoadBalancer`, destination `0.0.0.0/0`, Any, Allow. Outbound 65001
`AllowInternetOutBound`: source `0.0.0.0/0`, destination `Internet`, Any, Allow. 65000
rules: source and destination `VirtualNetwork`. 65500 rules: `0.0.0.0/0` both ways, Deny.
"You can't remove the default rules, but you can override them by creating rules with
higher priorities." *Protocol "Any" encompasses TCP, UDP, and ICMP.*
**Exact names as printed on the page** (Microsoft's own capitalisation is inconsistent —
copy it, don't "fix" it): `AllowVNetInBound`, `AllowAzureLoadBalancerInBound`,
`DenyAllInbound`, `AllowVnetOutBound`, `AllowInternetOutBound`, `DenyAllOutBound`.
Note that `DenyAllInbound` differs from this file's earlier `DenyAllInBound` — re-check in
the portal / `az network nsg rule list --include-default` before shipping the string.
Custom rules: "You can't create two security rules with the same priority and direction."
Rule name: up to 80 characters, starts with a word character, ends with a word character
or `_`, may contain word characters, `.`, `-`, `_`.

**C3 — Translation order:** inbound NSG rules evaluate *after* public→private
translation; outbound rules evaluate *before* private→public translation.
*Sim:* NSG rules always match private IPs, never a VM's public IP.
*Source:* NSG overview — **VERIFIED**

**C4 — NSGs are stateful;** rule changes affect only new connections.
*Source:* NSG overview ("modifying rules will only affect new connections") —
**VERIFIED** for the rule-change behavior; reuse the session model from the firewall engine.

**C5 — NSG on both subnet and NIC:** inbound = subnet NSG then NIC NSG; outbound =
NIC NSG then subnet NSG. Both must allow. FAQ: "A subnet-level NSG, followed by a NIC-level
NSG, is processed for inbound traffic. A NIC-level NSG, followed by a subnet-level NSG, is
processed for outbound traffic." *Source:* VNet FAQ — **SOURCED** 2026-10-06 (order).
"Both must allow" is the implication of sequential processing — confirm on the NSG
"how network security groups filter traffic" page before VERIFIED.

**C6 — Scope of the `VirtualNetwork` service tag** (VNet space, peered VNets, and
on-prem prefixes learned through a gateway?). Critical for hybrid missions. — **TO-VERIFY**

**C7 — Supported protocols and ICMP behavior** (within a VNet and to/from the
internet). Until verified, base mission success on TCP checks (`curl`,
connection-test tool), not `ping`. — **TO-VERIFY** (internet ICMP)
*Partly SOURCED 2026-10-06 (VNet FAQ):* TCP, UDP, ESP, AH and ICMP are supported in VNets;
"An Azure-provided default gateway doesn't respond to a ping. But you can use pings in your
virtual networks to check connectivity and for troubleshooting between VMs." `tracert`
works. → VM-to-VM ping inside a VNet is realistic (NSG permitting); pinging the subnet's
`.1` gateway must fail.

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

**E4 — VNets with overlapping address spaces can't be peered.** FAQ: "You can't enable
virtual network peering if address spaces overlap." *Source:* VNet FAQ — **SOURCED** 2026-10-06

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

## H. Management plane — summary (detail in I, J, O)

**H1 — A resource belongs to exactly one resource group.** "Each resource can exist in
only one resource group." → J1 — **SOURCED** 2026-10-06

**H2 — A resource group doesn't constrain networking.** "A resource can connect to
resources in other resource groups." A NIC "can exist in the same or a different resource
group from the VM you attach it to or the virtual network you connect it to." → J5, L2 —
**SOURCED** 2026-10-06

**H3 — RBAC inherits Management Group → Subscription → RG → resource.** "Scopes are
structured in a parent-child relationship … Lower levels inherit role permissions from
higher levels." → O3 — **SOURCED** 2026-10-06

---

# First cloud release (roadmap Phases 1a/1b) — sections I–Q

Researched 2026-10-06 for the Phase 0.5 spec pass. Every rule below is **SOURCED** at
best: nothing in I–Q may be implemented until Jasko marks it VERIFIED. Page dates are the
`updated_at` Microsoft Learn reported on the research date.

Sources used (abbreviations below):
- **MG** — Management groups overview, https://learn.microsoft.com/en-us/azure/governance/management-groups/overview (updated 2025-07-21)
- **ARM** — What is Azure Resource Manager?, https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/overview (updated 2026-08-06)
- **NAMES** — Naming rules and restrictions, https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/resource-name-rules (updated 2026-08-07)
- **LIMITS** — Subscription and service limits, https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/azure-subscription-service-limits *(summary)*
- **MOVE** — Move resources, https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/move-resource-group-and-subscription (updated 2026-03-16)
- **LOCKS** — Lock resources, https://learn.microsoft.com/en-us/azure/azure-resource-manager/management/lock-resources (updated 2026-04-10)
- **VNETFAQ** — https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-faq (updated 2026-07-09)
- **NIC** — Create, change, or delete NICs, https://learn.microsoft.com/en-us/azure/virtual-network/virtual-network-network-interface (updated 2025-10-08)
- **NSG** — NSG overview, https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview (updated 2025-10-23)
- **PIP** — Public IP addresses, https://learn.microsoft.com/en-us/azure/virtual-network/ip-services/public-ip-addresses (updated 2026-02-25)
- **DISKS** — Managed disk types, https://learn.microsoft.com/en-us/azure/virtual-machines/disks-types (updated 2026-09-16)
- **SA** — Storage account overview, https://learn.microsoft.com/en-us/azure/storage/common/storage-account-overview (updated 2026-07-17)
- **RED** — Storage redundancy, https://learn.microsoft.com/en-us/azure/storage/common/storage-redundancy (updated 2026-08-15)
- **SANET** — Storage firewall rules, https://learn.microsoft.com/en-us/azure/storage/common/storage-network-security (updated 2026-07-06)
- **SADEF** — Default public network access rule, https://learn.microsoft.com/en-us/azure/storage/common/storage-network-security-set-default-access (updated 2025-08-26)
- **RBAC** — What is Azure RBAC?, https://learn.microsoft.com/en-us/azure/role-based-access-control/overview (updated 2025-10-15)
- **SCOPE** — Understand scope, https://learn.microsoft.com/en-us/azure/role-based-access-control/scope-overview (updated 2026-02-13)
- **ROLES** — Built-in roles, https://learn.microsoft.com/en-us/azure/role-based-access-control/built-in-roles (updated 2026-09-11) *(summary)*
- **POL** — Azure Policy overview, https://learn.microsoft.com/en-us/azure/governance/policy/overview (updated 2026-07-08)
- **EFF** — Policy effect basics, https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effect-basics (updated 2025-12-01)
- **DENY** — Policy deny effect, https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effect-deny (updated 2025-12-01)

## I. Management hierarchy (management groups, subscriptions)

**I1 — One root per directory.** "Each directory has a single top-level management group
called the *root* management group." Default display name **Tenant root group**; "The ID is
the same value as the Microsoft Entra tenant ID." "All subscriptions and management groups
fold up into one root management group within the directory."
*Sim:* every tenant canvas starts with exactly one root MG, named "Tenant root group", that
the player can rename but not delete or move. *Source:* MG — **SOURCED**

**I2 — The root can't be moved or deleted.** "The root management group can't be moved or
deleted, unlike other management groups." *Source:* MG — **SOURCED**

**I3 — New subscriptions land under the root.** "New subscriptions automatically default
to the root management group when they're created." *Sim:* a new subscription appears under
the root until the player moves it. *Source:* MG — **SOURCED**

**I4 — One parent, many children.** "Each management group and subscription can support
only one parent." "Each management group can have many children." *Source:* MG — **SOURCED**

**I5 — Depth limit.** "A management group tree can support up to six levels of depth. This
limit doesn't include the root level or the subscription level." LIMITS: "Root level plus 6
levels". *Sim:* refuse a seventh level of MGs below the root. *Source:* MG, LIMITS — **SOURCED**

**I6 — Count limits.** "A single directory can support 10,000 management groups";
subscriptions per MG: unlimited. *Sim:* not a gameplay concern; enforce only if reachable.
*Source:* MG, LIMITS *(summary)* — **SOURCED**

**I7 — One tenant.** "All subscriptions within a single management group must trust the
same Microsoft Entra tenant." *Sim:* one tenant per game (already a documented
simplification). *Source:* MG — **SOURCED**

**I8 — MG name.** Microsoft.Management/managementgroups: scope tenant, 1–90 characters,
"Alphanumerics, hyphens, underscores, periods, and parentheses. Start with a letter or
number. Can't end with period." The ID and the display name are separate fields ("Use the
management group's ID and not the management group's display name. This common error
happens because both are custom-defined fields"). *Source:* NAMES, MG — **SOURCED**

**I9 — Root access.** "No one has default access to the root management group. Microsoft
Entra Global Administrators are the only users who can elevate themselves to gain access."
"Any assignment of user access or policy on the root management group applies to all
resources within the directory." *Sim:* governance missions warn when the player assigns at
the root ("must have" only). *Source:* MG — **SOURCED**

**I10 — Moving an MG or subscription needs write on child, old parent and new parent**
(Owner on the child; Owner / Contributor / Management Group Contributor on both parents),
"if the target or the existing parent management group is the root management group, the
permission requirements don't apply." A move is refused if it breaks the path from a role
assignment to a custom role definition's assignable scope. *Sim:* Phase 1b; until then the
player is Owner everywhere. *Source:* MG — **SOURCED**

**I11 — Hierarchy changes can lag.** "Azure Resource Manager caches details of the
management group hierarchy for up to 30 minutes." *Sim:* not modelled — add to documented
simplifications. *Source:* MG — **SOURCED**

## J. Resource groups and resources

**J1 — A resource is in exactly one RG.** "Each resource can exist in only one resource
group." Resource groups, subscriptions, MGs and tags "are also resources." *Source:* ARM — **SOURCED**

**J2 — RG location is metadata.** "The resources in a resource group can be located in
different regions than the resource group, but we recommend that you use the same
location." "The resource group stores metadata about resources. When you specify a location
for the resource group, you're also specifying where that metadata is stored."
*Sim:* the RG form asks for a region; a resource may pick another region (allowed, with a
best-practice note). *Source:* ARM — **SOURCED**

**J3 — Deleting an RG deletes its resources.** "When you delete a resource group, all
resources in the resource group are also deleted." *Source:* ARM — **SOURCED**

**J4 — RGs don't nest; RGs can't move between subscriptions.** "You can't move a resource
group to a new subscription. But, you can move all resources in a resource group to a
resource group in another subscription." (Nesting: RGs sit only directly under a
subscription in the four-level scope model; no doc sentence says "can't nest" verbatim —
**TO-VERIFY** wording.) *Source:* MOVE, ARM — **SOURCED** (move) / **TO-VERIFY** (nesting sentence)

**J5 — Cross-RG connections are normal.** "A resource can connect to resources in other
resource groups." *Source:* ARM — **SOURCED**

**J6 — Tags don't inherit.** "You can apply tags to a resource group. The resources in the
resource group don't inherit those tags." *Sim:* the "require a tag" lesson relies on this
(P-section policies add/require tags per resource). *Source:* ARM — **SOURCED**

**J7 — Four scopes and inheritance.** "Azure provides four levels of management scope:
management groups, subscriptions, resource groups, and resources … Lower levels inherit
settings from higher levels." *Source:* ARM — **SOURCED**

**J8 — Limits.** 980 resource groups per subscription; "up to 800 instances of a resource
type in each resource group" (some types exempt). *Source:* LIMITS *(summary)*, ARM — **SOURCED**

**J9 — Moving resources.** Both RGs are locked during the move ("can't create, delete, or
update resources within these resource groups"); "Moving a resource only changes its
associated resource group and doesn't alter the physical region of the resource"; the
resource ID changes; cross-subscription moves need the same Entra tenant, the destination
registered for the resource provider, and "the resource and its dependent resources must be
located in the same resource group and they must be moved together" (VM + disks + NIC …,
error `MissingMoveDependentResources`); role assignments on a moved resource "don't move and
become orphaned"; tags, role assignments and policies "don't transfer automatically" to the
destination RG; a read-only lock on source, destination or subscription blocks the move;
policy can refuse the move with `RequestDisallowedByPolicy`.
*Sim:* the move is instant (documented simplification: real moves can lock RGs up to four
hours). *Source:* MOVE — **SOURCED**

## K. Naming rules (validator input rules)

Copied from NAMES (2026-08-07). "Scope" is the uniqueness scope.

| Resource type | Scope | Length | Valid characters |
|---|---|---|---|
| Microsoft.Management/managementgroups | tenant | 1–90 | Alphanumerics, hyphens, underscores, periods, parentheses. Start with letter or number. Can't end with period. |
| Microsoft.Resources/resourcegroups | subscription | 1–90 | Underscores, hyphens, periods, parentheses, and letters or digits (Unicode letter/digit categories). Can't end with period. |
| Microsoft.Network/virtualNetworks | resource group | 2–64 | Alphanumerics, underscores, periods, hyphens. Start with alphanumeric. End with alphanumeric or underscore. |
| Microsoft.Network/virtualNetworks/subnets | virtual network | 1–80 | Same character rule as VNet. |
| Microsoft.Network/networkInterfaces | resource group | 1–80 | Same character rule as VNet. |
| Microsoft.Network/networkSecurityGroups (and /securityRules) | resource group (NSG) | 1–80 | Same character rule as VNet. |
| Microsoft.Network/publicIPAddresses | resource group | 1–80 | Same character rule as VNet. |
| Microsoft.Network/privateEndpoints | resource group | 2–64 | Same character rule as VNet. |
| Microsoft.Network/privateDnsZones | resource group | 1–63 characters, 2 to 34 labels | Each label: alphanumerics, underscores, hyphens; labels separated by periods. |
| Microsoft.Network/privateDnsZones/virtualNetworkLinks | private DNS zone | 1–80 | Same character rule as VNet. |
| Microsoft.Compute/virtualMachines | resource group | 1–15 (Windows), 1–64 (Linux) | No spaces, control characters or `` ~ ! @ # $ % ^ & * ( ) = + _ [ ] { } \ \| ; : . ' " , < > / ? `` (the list includes the pipe character). Windows: no periods, can't end with hyphen. Linux: can't end with period or hyphen. |
| Microsoft.Compute/disks | resource group | 1–80 | Alphanumerics, underscores, hyphens. |
| Microsoft.Storage/storageAccounts | **global** | 3–24 | Lowercase letters and numbers. |
| Microsoft.Storage/storageAccounts/blobServices/containers | storage account | 3–63 | Lowercase letters, numbers, hyphens. Start with letter or number. No consecutive hyphens. |
| Microsoft.Authorization/roleAssignments | tenant | 36 | Must be a GUID. |
| Microsoft.Authorization/policyAssignments | assignment scope | display name 1–128; resource name 1–64 (1–24 at management-group scope) | Resource name can't use `#<>%&:\?/` or control characters; can't end with period or space. |
| Microsoft.Authorization/policyDefinitions | definition scope | display name 1–128; resource name 1–64 | Same as policy assignments. |

**K1 — VM names are two names.** "Azure virtual machines have two distinct names: resource
name and host name … The restrictions in the preceding table are for the host name. The
actual resource name can have up to 64 characters." *Sim:* validate the host name rule;
teach the 15-character Windows limit. *Source:* NAMES — **SOURCED**

**K2 — Storage account names are globally unique.** "Your storage account name must be
unique within Azure. No two storage accounts can have the same name." *Sim:* the game keeps
a fictional "already taken" list (labelled as simulated) so the lesson exists offline.
*Source:* SA, NAMES — **SOURCED**

*Caution:* the NAMES page also lists a `virtualMachines | resource group | 2-64 |
Alphanumerics` row — that row belongs to **Microsoft.NetworkCloud**, not Compute. Don't use it.

## L. Compute — VM, NIC, managed disks

**L1 — A VM always has at least one NIC.** "A VM must always have at least one NIC
attached to it, so you can't delete the only NIC from a VM." "You can delete a NIC only when
the NIC isn't attached to a VM." *Source:* NIC — **SOURCED**

**L2 — NIC ↔ VNet ↔ VM: same subscription and location.** "You can assign a NIC only to a
virtual network in the same subscription and location as the NIC. Once you create a NIC,
you can't change the virtual network … The VM you add the NIC to must also be in the same
location and subscription as the NIC." The subnet *can* be changed later (all private IPs
must be Dynamic first). A NIC "can exist in the same or a different resource group from the
VM … or the virtual network". NIC name unique within the RG and can't be changed.
*Sim:* validator refuses a NIC in a different region/subscription from its VNet or VM.
*Source:* NIC — **SOURCED**

**L3 — Private IP from Azure DHCP.** "The Azure DHCP server assigns the private IP address
to the NIC in the VM's operating system." Dynamic = "next available address from the address
space of the subnet"; Static = "manually assign an available IP address from within the
address space of the subnet". "Static and dynamic addresses don't change until you change
them or delete the NIC." *Source:* NIC — **SOURCED** (complements A5)

**L4 — MAC address.** "Azure assigns a MAC address to the NIC only after the NIC is
attached to a VM and the VM starts for the first time. You can't specify the MAC address."
*Source:* NIC — **SOURCED**

**L5 — IP forwarding is per NIC and off by default** ("Disabled, the default"), "you must
enable IP forwarding for every NIC attached to the VM that needs to forward traffic", and
"the VM must also run an application that's able to forward the traffic". *Source:* NIC —
**SOURCED** (complements D3)

**L6 — DNS servers: NIC setting overrides VNet setting.** "The NIC can inherit the settings
from the virtual network, or use its own unique settings that override the setting for the
virtual network." Changing VNet DNS needs a DHCP lease renewal on the VMs ("ipconfig /renew"
on Windows). *Source:* NIC, VNETFAQ — **SOURCED** (feeds Phase 4)

**L7 — Managed disk types.** Ultra Disk, Premium SSD v2, Premium SSD, Standard SSD,
Standard HDD. Usable as OS disk: Ultra **No**, Premium SSD v2 **No**, Premium SSD Yes,
Standard SSD Yes, Standard HDD Yes "(retiring Sept 8, 2028)". "Ultra Disks must be used as
data disks and can only be created as empty disks." *Sim:* the VM form only offers Premium
SSD / Standard SSD / Standard HDD for the OS disk. *Source:* DISKS — **SOURCED**

**L8 — Managed disk redundancy.** Managed disks support LRS and ZRS (ZRS with limitations);
Ultra Disks LRS only. *Source:* RED (supported services table), DISKS — **SOURCED**

**L9 — Default outbound access** (ties to B1/B2): a VM without a public IP has a
non-configurable default outbound IP *only where default outbound access still applies*;
it's disabled by a public IP on the VM, a Standard load balancer backend pool, or a NAT
gateway on the subnet. New VNets default to private subnets (B1). *Source:* NIC note —
**SOURCED**

## M. Storage accounts

**M1 — Account types (recommended).** Standard general-purpose v2 (`StorageV2`: Blob incl.
Data Lake, Queue, Table, Files; LRS/GRS/RA-GRS/ZRS/GZRS/RA-GZRS); Premium block blobs
(`BlockBlobStorage`; LRS/ZRS); Premium file shares (`FileStorage`; LRS/ZRS); Premium page
blobs (LRS/ZRS). "You can't change a storage account to a different type after it's
created." General-purpose v1 and legacy Blob Storage are retired/retiring — don't offer them.
*Source:* SA, RED — **SOURCED**

**M2 — Redundancy options.** LRS: "a single physical datacenter located in the primary
region"; ZRS: "synchronously across three or more Azure availability zones in the primary
region"; GRS: LRS in primary, then "asynchronously to the secondary region", LRS there;
GZRS: ZRS in primary + async to secondary. GRS/GZRS secondary "isn't available for read or
write access unless there's a failover"; RA-GRS / RA-GZRS add read access; the secondary
endpoint is `<account>-secondary.blob.core.windows.net`. "The paired secondary region is
determined based on the primary region, and can't be changed." Azure Files doesn't support
RA-GRS/RA-GZRS. The archive tier isn't supported for ZRS/GZRS/RA-GZRS. *Source:* RED — **SOURCED**

**M3 — Standard endpoints.** `https://<account>.blob.core.windows.net`, `.web.`, `.dfs.`,
`.file.`, `.queue.`, `.table.core.windows.net`. (Azure DNS zone endpoints are preview and
"will enter retirement in March 2027" — don't model.) *Source:* SA — **SOURCED**

**M4 — Public network access.** "By default, storage accounts accept connections from
clients on any network." Portal options: **Enabled from all networks**, **Enabled from
selected networks** (VNet rules, IP rules, resource instances), **Disable**, **Secured by
perimeter**. CLI: `--default-action Allow|Deny`; `--public-network-access Disabled`
("Traffic will be allowed only through a private endpoint. You need to create that private
endpoint."). "Network rules have no effect unless you set the `--default-action` parameter
to `Deny`." Requests from a subnet not allowed by a VNet rule "receive a 403 error".
*Source:* SADEF, SANET — **SOURCED** (complements F5; exact client error text still TO-VERIFY)

**M5 — VNet rules need a service endpoint** on the subnet (`Microsoft.Storage` same-region,
or `Microsoft.Storage.Global` any region; only one of the two per subnet); up to 400 VNet
rules and 400 IP rules per account; up to 200 private endpoints per account. *Source:*
SANET, SA — **SOURCED** (Phase 4 material)

**M6 — Limits.** 250 storage accounts with standard endpoints per region per subscription
by default (500 by request). *Source:* SA — **SOURCED**

## N. Public IP addresses

**N1 — Basic SKU is retired.** "On September 30, 2025, Basic SKU public IPs were retired."
*Sim:* offer Standard only; mention Basic only as history. *Source:* PIP — **SOURCED**

**N2 — Standard is static and closed by default.** Standard allocation: Static. Security:
"Secure by default model and be closed to inbound traffic when used as a frontend. Allow
traffic with network security group (NSG) is required (for example, on the NIC of a virtual
machine with a Standard SKU Public IP attached)." *Sim:* a VM with a Standard public IP and
no NSG allowing the port is unreachable from the internet. *Source:* PIP — **SOURCED**

**N3 — Zones.** "All formerly Standard non-zonal IPs are now zone-redundant in all regions
that support availability zones." "Once created, a public IP address can't change its
availability zone." Standard v2 "can only be utilized with the Standard v2 NAT GW product at
this time". *Sim:* don't offer Standard v2 in the first release. *Source:* PIP — **SOURCED**

**N4 — What it attaches to.** VM network interfaces, VM scale sets (via prefixes), public
load balancers, VPN/ER gateways, NAT gateways, Application Gateways, Azure Firewall, Bastion,
Route Server, API Management. The portal "doesn't provide the option to assign a public IP
address to a NIC when you create it" (CLI/PowerShell can). *Source:* PIP, NIC — **SOURCED**

**N5 — DNS label.** `<label>.<location>.cloudapp.azure.com`, unique within the location.
*Source:* PIP — **SOURCED**

## O. Azure RBAC (Phase 1b)

**O1 — A role assignment = security principal + role definition + scope.** "A role
assignment consists of three elements: security principal, role definition, and scope."
Principals: "a user, group, service principal, or managed identity". *Source:* RBAC — **SOURCED**

**O2 — Scope levels.** "management group, subscription, resource group, or resource."
Formats: `/providers/Microsoft.Management/managementGroups/{id}`,
`/subscriptions/{subscriptionId}`, `/subscriptions/{id}/resourceGroups/{rg}`,
`…/providers/{provider}/{type}/{name}`. *Source:* SCOPE — **SOURCED**

**O3 — Inheritance down the hierarchy.** "Lower levels inherit role permissions from higher
levels." An assignment on an MG "inherits to all the subscriptions." *Source:* SCOPE, MG — **SOURCED**

**O4 — Additive.** "Azure RBAC is an additive model, so your effective permissions are the
sum of your role assignments." (Contributor on the subscription + Reader on an RG =
Contributor on that RG.) Group assignments are transitive through nested groups.
*Source:* RBAC — **SOURCED**

**O5 — Evaluation order.** "If a deny assignment applies, access is blocked. Otherwise,
evaluation continues." Effective permissions = `Actions - NotActions` (and
`DataActions - NotDataActions`). Conditions are evaluated last. *Source:* RBAC — **SOURCED**

**O6 — The four fundamental roles.** Owner: "Grants full access to manage all resources,
including the ability to assign roles in Azure RBAC." Contributor: "Grants full access to
manage all resources, but does not allow you to assign roles in Azure RBAC, manage
assignments in Azure Blueprints, or share image galleries." Reader: "View all resources, but
does not allow you to make any changes." User Access Administrator: "Lets you manage user
access to Azure resources." Also Role Based Access Control Administrator: "Manage access to
Azure resources by assigning roles using Azure RBAC. This role does not allow you to manage
access using other ways, such as Azure Policy." Owner, Contributor, UAA and RBAC
Administrator are classed as **privileged administrator roles**. *Source:* ROLES
*(summary — re-read verbatim)* — **SOURCED**

**O7 — Role assignments don't follow moved resources.** (J9) *Source:* MOVE — **SOURCED**

**O8 — Limits.** Role assignments per subscription and per MG, custom roles per tenant —
the numbers came from a *summarized* fetch of LIMITS and are **TO-VERIFY** (re-read the RBAC
limits table before quoting any number in-game).

## P. Azure Policy (Phase 1b)

**P1 — Objects.** Policy definition (conditions + one effect), initiative definition
(policy set: "a collection of policy definitions"), assignment ("a policy definition or
initiative that was assigned to a specific scope"). *Source:* POL — **SOURCED**

**P2 — Assignment scope and inheritance.** Assignable "from a management group to an
individual resource"; "All child resources inherit the assignments"; "you can exclude a
subscope from the assignment" (exclusions / `notScopes`, up to 400 per assignment). "Although
a policy can be assigned at the management group level, *only* resources at the subscription
or resource group level are evaluated." *Source:* POL — **SOURCED**

**P3 — Policy is an explicit-deny system.** A more permissive assignment lower down does
**not** override a deny higher up: "If any assignment results in a resource getting denied,
then the only way to allow the resource is to modify the denying assignment" (exclude the
child scope from the parent assignment). Layering is "cumulative most restrictive."
*Sim:* this is a flagship governance lesson. *Source:* POL, EFF — **SOURCED**

**P4 — Effects.** Supported: addToNetworkGroup, append, audit, auditIfNotExists, deny,
denyAction, deployIfNotExists, disabled, manual, modify, mutate. Evaluation order on
create/update: disabled → append/modify → deny → audit → manual → auditIfNotExists →
denyAction; after the provider succeeds, auditIfNotExists and deployIfNotExists evaluate.
*Sim (first release):* deny, audit, modify (add tag), disabled. *Source:* EFF — **SOURCED**

**P5 — Deny.** "Deny prevents the request before being sent to the Resource Provider. The
request is returned as a `403 (Forbidden)`." Existing resources that match are "marked as
non-compliant" (not deleted). Error code `RequestDisallowedByPolicy` is documented on MOVE
for move validation — **TO-VERIFY** that create/update requests return the same code before
the sim prints it. *Source:* DENY, MOVE — **SOURCED** (403) / **TO-VERIFY** (code on create)

**P6 — Evaluation triggers.** A resource is evaluated when created/updated in a scope with
an assignment, when a scope gets a new assignment, when an assigned definition is updated,
and in "the standard compliance evaluation cycle that occurs once every 24 hours."
*Sim:* compliance recomputed instantly (documented simplification). *Source:* POL — **SOURCED**

**P7 — Policy vs RBAC.** "Even if an individual has access to perform an action, if the
result is a non-compliant resource, Azure Policy still blocks the create or update."
Contributor can't create/update definitions or assignments; Resource Policy Contributor and
Owner can. *Source:* POL — **SOURCED**

**P8 — Built-ins named in the overview** (each must match Microsoft's real definition if we
reproduce it): Allowed Storage Account SKUs (Deny), Allowed Resource Type (Deny), Allowed
Locations (Deny), Allowed Virtual Machine SKUs (Deny), Add a tag to resources (Modify), Not
allowed resource types (Deny). *Source:* POL — **SOURCED** (names/effects only; the JSON of
each definition is **TO-VERIFY**)

**P9 — Limits.** Per scope: 500 policy definitions, 200 initiative definitions, 200
assignments, 1000 exemptions; 400 exclusions per assignment; 20 parameters per definition.
*Source:* POL (verbatim table) — **SOURCED**

## Q. Resource locks (Phase 1b)

**Q1 — Two levels.** Portal **Delete** / **Read-only**; CLI **CanNotDelete** / **ReadOnly**.
"ReadOnly means authorized users can read a resource, but they can't delete or update it.
Applying this lock is similar to restricting all authorized users to the permissions that the
Reader role provides." "The lock overrides any user permissions." *Source:* LOCKS — **SOURCED**

**Q2 — Inheritance.** "When you apply a lock at a parent scope, all resources within that
scope inherit the same lock … The most restrictive lock in the inheritance chain takes
precedence." A Delete lock on one resource blocks deleting its whole RG ("A partial deletion
isn't possible"). *Source:* LOCKS — **SOURCED**

**Q3 — Scopes.** Subscription, resource group, resource. "You can't add a lock to management
groups." *Source:* LOCKS — **SOURCED**

**Q4 — Control plane only.** "Locks only apply to control plane Azure operations and not to
data plane operations." A lock on a storage account "doesn't protect its data from being
deleted or modified"; a ReadOnly lock on a storage account blocks listing account keys; a
ReadOnly lock on an RG with a VM blocks starting/restarting it (POST). *Source:* LOCKS — **SOURCED**

**Q5 — Who.** Creating/deleting locks needs `Microsoft.Authorization/*` or
`Microsoft.Authorization/locks/*`; Owner and User Access Administrator have it (Contributor
does not). *Source:* LOCKS — **SOURCED**

## Management-plane outcomes (proposed, Phases 1a/1b)

Unlike traffic `failureReason`s, these are refusals of a *create / update / move* request.
The sim shows a real ARM error code **only** where the code is sourced; otherwise it explains
the rule in plain words and labels it as the sim's explanation.

| Sim outcome | Rule | Real code / status (only if sourced) |
|---|---|---|
| `name_invalid` | K table | — (explain the rule) |
| `name_not_unique` | K2, K scope column | — |
| `region_mismatch` | L2 | — |
| `subnet_overlap` / `subnet_outside_vnet` | A3 | — |
| `address_range_blocked` | A3a | — |
| `hierarchy_too_deep` | I5 | — |
| `root_immutable` | I2 | — |
| `policy_denied` | P5 | `403 (Forbidden)`; `RequestDisallowedByPolicy` TO-VERIFY on create |
| `locked` | Q1–Q2 | — |
| `move_missing_dependents` | J9 | `MissingMoveDependentResources` (sourced, MOVE) |
| `not_authorized` | O1–O6 | — (Phase 1b) |
| `nic_last_on_vm` | L1 | — |

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
- Control-plane propagation delays (e.g. Resource Graph latency) aren't modeled —
  including the up-to-30-minute management-group hierarchy cache (I11).
- Resource moves complete instantly (real moves can lock both resource groups for up to
  four hours, J9).
- Policy compliance is recomputed instantly instead of on Azure's triggers and 24-hour
  cycle (P6).
- Storage account global name uniqueness is checked against a fictional "already taken"
  list, labelled as simulated (K2).

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
- **2026-10-06 — Basic public IP retired** on September 30, 2025 (N1). Offer Standard only.
- **2026-10-06 — Standard HDD as OS disk retires** September 8, 2028 (L7). Re-check before
  that date; the VM form should then drop it.
- **2026-10-06 — Storage Azure DNS zone endpoints** (preview) enter retirement March 2027
  (M3) — not modelled.
- **2026-10-06 — NSG flow logs retire** September 30, 2027 (NSG overview); VNet flow logs
  replace them. Relevant if a Network Watcher flow-log tool is built (Phase 2).
- **2026-10-06 — Storage GPv1 / legacy Blob Storage accounts** retired or retiring (M1) —
  never offer them.
