/**
 * The option lists the cloud forms offer, each tied to its docs/cloud/AZURE_ACCURACY.md rule.
 */

/** L7 — managed disk types; Ultra Disk and Premium SSD v2 can't be OS disks. */
export const DISK_TYPES = Object.freeze({
  UltraDisk:    Object.freeze({ displayName: 'Ultra Disk',     osCapable: false, maxGiB: 65536 }),
  PremiumSSDv2: Object.freeze({ displayName: 'Premium SSD v2', osCapable: false, maxGiB: 65536 }),
  PremiumSSD:   Object.freeze({ displayName: 'Premium SSD',    osCapable: true,  maxGiB: 32767 }),
  StandardSSD:  Object.freeze({ displayName: 'Standard SSD',   osCapable: true,  maxGiB: 32767 }),
  StandardHDD:  Object.freeze({ displayName: 'Standard HDD',   osCapable: true,  maxGiB: 32767 }),
})

/**
 * A short list of real VM size names. Which sizes each region offers is not modelled
 * (documented simplification); sizes don't change behaviour in Phase 1a.
 */
export const VM_SIZES = Object.freeze(['Standard_B1s', 'Standard_B2s', 'Standard_D2s_v5', 'Standard_D4s_v5'])

export const OS_TYPES = Object.freeze(['Linux', 'Windows'])

/**
 * Images offered by the VM wizard — real marketplace image names; the OS type decides the
 * name rules (K1). Which image versions exist where is not modelled.
 */
export const VM_IMAGES = Object.freeze([
  Object.freeze({ id: 'ubuntu-24_04-lts', displayName: 'Ubuntu Server 24.04 LTS', osType: 'Linux' }),
  Object.freeze({ id: 'rhel-9', displayName: 'Red Hat Enterprise Linux 9', osType: 'Linux' }),
  Object.freeze({ id: 'windows-server-2022-datacenter', displayName: 'Windows Server 2022 Datacenter', osType: 'Windows' }),
])

/** M1 — recommended storage account types and the redundancy each supports. */
export const STORAGE_KINDS = Object.freeze({
  StorageV2: Object.freeze({
    displayName: 'Standard general-purpose v2', performance: 'Standard',
    redundancy: Object.freeze(['LRS', 'ZRS', 'GRS', 'RA-GRS', 'GZRS', 'RA-GZRS']),
  }),
  BlockBlobStorage: Object.freeze({
    displayName: 'Premium block blobs', performance: 'Premium',
    redundancy: Object.freeze(['LRS', 'ZRS']),
  }),
  FileStorage: Object.freeze({
    displayName: 'Premium file shares', performance: 'Premium',
    redundancy: Object.freeze(['LRS', 'ZRS']),
  }),
})

/** M3 — standard endpoints for a storage account. */
export function storageEndpoints(accountName) {
  return {
    blob:  `https://${accountName}.blob.core.windows.net`,
    web:   `https://${accountName}.web.core.windows.net`,
    dfs:   `https://${accountName}.dfs.core.windows.net`,
    file:  `https://${accountName}.file.core.windows.net`,
    queue: `https://${accountName}.queue.core.windows.net`,
    table: `https://${accountName}.table.core.windows.net`,
  }
}

/** NSG rule fields (AZURE_ACCURACY C1/C2; NSG overview "Security rules" table). */
export const SECURITY_RULE_PROTOCOLS = Object.freeze(['TCP', 'UDP', 'ICMP', 'ESP', 'AH', 'Any'])
export const SECURITY_RULE_DIRECTIONS = Object.freeze(['Inbound', 'Outbound'])
export const SECURITY_RULE_ACCESS = Object.freeze(['Allow', 'Deny'])

/** The service tags the sim understands; other tags are refused as not_modelled. */
export const SERVICE_TAGS = Object.freeze(['VirtualNetwork', 'Internet', 'AzureLoadBalancer'])

/**
 * Public IP addresses are drawn from RFC 5737 TEST-NET-2 (198.51.100.0/24) — documentation
 * space, never a real Azure address. Azure assigns from its own pool (PIP page); the
 * exact address is not part of any lesson.
 */
export const PUBLIC_IP_POOL = Object.freeze({ prefix: '198.51.100.', first: 10, last: 254 })
