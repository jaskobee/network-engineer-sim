/**
 * Cloud mission 3 — Storage for the app (AZURE_ACCURACY §K, §M).
 *
 * A storage account whose name must be globally unique (K2), whose redundancy follows a
 * stated availability requirement (M2: zone outage + regional outage with read access to the
 * secondary → RA-GZRS), and whose public network access is disabled because traffic will
 * come only through a private endpoint (M4) — which a later mission adds.
 */
import { createCloudState, TYPES, resourcesInGroup } from '../model.js'
import * as op from '../operations.js'

const TENANT = '6c0d3e8a-2f4b-4a91-b7e5-1d8c6a2f9e04'
export const SUB = 'a7e3c1f9-4b2d-4e6a-9c8f-3d5b1a7e2c60'
const RG = 'rg-app-prod'

function must(r) { if (!r.ok) throw new Error(`mission setup failed: ${r.message}`); return r.state }

/** The account the mission is about: the first one in rg-app-prod named by the st… convention. */
const account = t => resourcesInGroup(t, SUB, RG).find(r => r.type === TYPES.STORAGE_ACCOUNT && /^st[a-z0-9]+$/.test(r.name)) ?? null

export const appStorageMission = {
  id: 'cloud_app_storage',
  title: 'Storage for the app',
  client: 'Contoso Ltd',
  summary: 'Create the invoice app\'s storage account to an availability requirement and lock down public access.',
  brief: [
    'The invoice app needs a storage account in rg-app-prod, West Europe. Name it with the convention '
      + 'st<app><env><nn> — for example stinvoiceprod01. The team\'s first try, "contosostorage", was already taken.',
    'Availability: the data must stay readable and writable if one availability zone fails, and stay readable from a '
      + 'second region if the whole West Europe region goes down.',
    'Security: the app will reach the account only through a private endpoint, which networking adds next sprint. Until '
      + 'then nothing should reach it over the public endpoint.',
  ],
  objectives: [
    { id: 'name', text: 'Create a storage account in rg-app-prod (West Europe) named st<app><env><nn>.',
      hint: 'Storage names are 3–24 lowercase letters and numbers and must be unique across all of Azure.',
      check: t => account(t)?.location === 'westeurope' },
    { id: 'kind', text: 'It is a Standard general-purpose v2 account.',
      hint: 'Only general-purpose v2 offers the geo-redundant options. The type can\'t be changed later — recreate it if wrong.',
      check: t => account(t)?.properties.kind === 'StorageV2' },
    { id: 'redundancy', text: 'Its redundancy meets the availability requirement.',
      hint: 'Zone failure → zone-redundant in the primary (ZRS-based). Region failure with reads from the secondary → geo with read access.',
      check: t => account(t)?.properties.redundancy === 'RA-GZRS' },
    { id: 'public-access', text: 'Public network access is disabled.',
      hint: 'Open the account → Networking (Manage) → Public network access: Disable → Save.',
      check: t => account(t)?.properties.publicNetworkAccess === 'Disabled' },
  ],
  learn: ['K2', 'M1', 'M2', 'M4'],
  debrief: [
    'Storage account names are global: they become part of the endpoint, https://<name>.blob.core.windows.net.',
    'RA-GZRS = ZRS in the primary region (survives a zone) + asynchronous copy to the paired region you can read from.',
    'With public network access disabled, traffic can only arrive through a private endpoint — the next lesson.',
  ],
  setup() {
    let s = createCloudState({ tenantId: TENANT })
    s = must(op.addSubscription(s, { id: SUB, displayName: 'Contoso Corp Production' }))
    s = must(op.createResourceGroup(s, { subscriptionId: SUB, name: RG, location: 'westeurope' }))
    return s
  },
}
