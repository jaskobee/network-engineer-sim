# GLOSSARY — Cloud Engineer names, codes and vocabulary

Rule IDs (`A1`, `K3`, `N4` …) refer to `docs/cloud/AZURE_ACCURACY.md`; each has a Microsoft Learn page in
`apps/cloud/src/azure/ruleSources.js`. Paths below are relative to `apps/cloud/src/`.

## Tenant model (`azure/model.js`)
- **Tenant state** — plain JSON: `{ tenantId, managementGroups, subscriptions, resourceGroups, resources }`, each a
  map keyed by its ARM-style ID. No classes, no mutation: operations return a new state.
- **Tenant root group** — the root management group; its ID is the tenant ID (`isRoot`). Can't be moved or deleted.
- **Scopes / IDs** — `managementGroupScope(id)` → `/providers/Microsoft.Management/managementGroups/<id>`;
  `subscriptionScope(id)` → `/subscriptions/<id>`; `resourceGroupId(sub, name)`; `resourceId(sub, rg, type, name)`;
  `subnetId(vnetId, name)` → `<vnetId>/subnets/<name>` (subnets live inside the VNet's `properties.subnets`).
- **Resource types (`TYPES`)** — `Microsoft.Network/virtualNetworks`, `…/networkSecurityGroups`,
  `…/publicIPAddresses`, `…/networkInterfaces`, `Microsoft.Compute/virtualMachines`, `Microsoft.Compute/disks`,
  `Microsoft.Storage/storageAccounts`.
- **`DEFAULT_SECURITY_RULES`** — every NSG's six default rules with Microsoft's exact names (incl. `DenyAllInbound`
  and `DenyAllOutBound`).
- **Made-up values** (allowed by the owner) — tenant/subscription GUIDs, public IPs from `198.51.100.0/24`
  (documentation range), the names `<vm>-nic` / `<vm>-ip`.

## Operations (`azure/operations.js`)
Pure `(state, args) → { ok: true, state, id?, warnings[] }` or a refusal `{ ok: false, outcome, ruleId, message }`.
Management: `createManagementGroup`, `renameManagementGroup`, `moveManagementGroup`, `deleteManagementGroup`,
`addSubscription` (simulated shortcut — hidden in missions), `moveSubscription`, `createResourceGroup`,
`deleteResourceGroup`. Network: `createVirtualNetwork`, `addSubnet`, `resizeSubnet`, `createNetworkSecurityGroup`,
`addSecurityRule`, `associateNetworkSecurityGroup`, `createPublicIp`, `createNetworkInterface`. Compute/storage:
`createDisk`, `createVirtualMachine`, **`deployVirtualMachine`** (the portal VM wizard: public IP → NIC → VM,
all-or-nothing), `createStorageAccount`, `updateStorageAccount`. Lifecycle: `deleteResource`, `moveResources`.
- **Review + create** — the UI runs the same operation as a dry run, shows "Validation passed" + a summary, and
  only Create commits it. A refusal deploys nothing.

## Outcome codes (`azure/outcomes.js`)
`OUTCOME.*` constants; every refusal carries one, plus its rule ID. An ARM error code (`armCode`) only where the
spec sources it.

| Code | Meaning |
|---|---|
| `name_invalid` | Breaks the naming rule (length / characters) for the type (§K) |
| `name_not_unique` | Name taken in its uniqueness scope (storage names: global) |
| `not_found` | Referenced subscription / RG / MG / resource doesn't exist |
| `invalid_value` | A setting value the type doesn't accept |
| `region_mismatch` | Resources that must share a region don't |
| `subscription_mismatch` | Resources that must share a subscription don't |
| `subnet_overlap` · `subnet_outside_vnet` · `subnet_size` · `subnet_in_use` | Subnet rules (A1–A3a): overlap, outside the address space, outside /29–/2, resize while in use |
| `address_range_blocked` · `address_invalid` · `address_reserved` · `address_in_use` | Address rules: blocked ranges, malformed, one of the five reserved, taken |
| `hierarchy_too_deep` · `hierarchy_cycle` · `root_immutable` | Management group rules (§I): six levels below root, no cycles, root fixed |
| `limit_reached` | An Azure limit for the scope |
| `nic_required` · `nic_attached` | VM needs a NIC; an attached NIC can't be deleted / reused |
| `disk_not_os_capable` | Disk type can't be an OS disk (L-rules) |
| `retired` | Option retired by Azure (e.g. Basic public IP, N1) |
| `immutable` | Can't be changed after creation (e.g. storage account kind) |
| `move_missing_dependents` | armCode **`MissingMoveDependentResources`** (J9) |
| `not_modelled` | The simulator doesn't model this case yet — refuses rather than guess |

## Missions (`azure/missions/`)
- **Definition** — `{ id, title, client, summary, brief[], objectives[{ id, text, hint, check(tenant) }], learn[ruleIds],
  debrief[], setup() → tenant }`. `setup` builds the customer's tenant through real operations (fixed GUIDs).
- **Progress** — `missionProgress(def, tenant)` → `{ objectives[{…, done}], doneCount, total, complete }`; never stored.
- **Conditions** (`conditions.js`) — `managementGroupIs`, `subscriptionUnder`, `resourceGroupIs`, `resourceAt`,
  `subnetOf`, `portsInclude`, `allowsInbound`.
- **Missions** — `cloud_landing_zone` (Landing zone basics, Contoso Ltd), `cloud_first_workload` (First workload;
  trap: another team's VNet in North Europe), `cloud_app_storage` (Storage for the app; traps: a taken name,
  RA-GZRS from the availability requirement, kind is immutable).

## State (`state/CloudContext.jsx`)
- **Slice** — `{ sandbox: tenant, mission: { id, tenant } | null, completedMissions: [id] }`; `cloud` = the tenant in play.
- **API** — `apply(operation, args)`, `startMission(id)`, `leaveMission()`, `resetCloud()` (sandbox only),
  `mission: { def, progress }`, `completedMissions`, `loadNotice`.
- **Save** — `cloudeng_save_v1` (kind `cloudeng-save`); unreadable → `cloudeng_save_v1_unreadable`.

## UI (`components/`)
`CloudWorkspace` (tabs) · `CloudMissions` (+ `MissionBar`, `ObjectiveLeds`) · `ManagementView` · `NetworkView` +
`NetworkForms` (`CreatePanel` with Review + create, `VirtualMachineForm` wizard) + `NetworkDetails` ·
`OperationResult` (refusal: "Simulator's explanation · rule X" + Learn link) · `AzureIcon` (`AzureItem`: icon +
service name) · `formParts` (`Field`, `Facts`, `Form`, `Select`, `DangerButton`). Styles: `cloud.css` (`cloud-*`,
`mv-` management view, `nv-` network view, `op-` operation result, `az-` icons, `cm-` missions).
