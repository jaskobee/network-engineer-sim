/**
 * Naming rules — docs/cloud/AZURE_ACCURACY.md §K (copied from Microsoft Learn "Naming rules and
 * restrictions for Azure resources"). Each validator returns null when the name is valid,
 * or a plain-language reason when it isn't. Uniqueness is checked in operations.js.
 *
 * Name comparison for uniqueness is exact for now: whether Azure compares names
 * case-insensitively is not yet in the verified spec (PHASE_1A §6a).
 */

const CONTROL = /[\u0000-\u001f\u007f]/

function lengthReason(name, min, max) {
  if (typeof name !== 'string' || name.length < min || name.length > max)
    return `must be ${min}–${max} characters long`
  return null
}

/** Microsoft.Management/managementgroups — 1–90; alphanumerics, - _ . ( ); start alnum; no trailing period. */
export function managementGroupNameReason(name) {
  return lengthReason(name, 1, 90)
    ?? (!/^[A-Za-z0-9][A-Za-z0-9\-_.()]*$/.test(name) ? 'can use letters, numbers, hyphens, underscores, periods and parentheses, and must start with a letter or number' : null)
    ?? (name.endsWith('.') ? "can't end with a period" : null)
}

/** Microsoft.Resources/resourcegroups — 1–90; Unicode letters/digits, _ - . ( ); no trailing period. */
export function resourceGroupNameReason(name) {
  return lengthReason(name, 1, 90)
    ?? (!/^[\p{L}\p{Nd}_\-.()]+$/u.test(name) ? 'can use letters, digits, underscores, hyphens, periods and parentheses' : null)
    ?? (name.endsWith('.') ? "can't end with a period" : null)
}

// Most Microsoft.Network names: alphanumerics, underscores, periods, hyphens;
// start with alphanumeric; end with alphanumeric or underscore.
function networkNameReason(name, min, max) {
  return lengthReason(name, min, max)
    ?? (!/^[A-Za-z0-9]([A-Za-z0-9_.-]*[A-Za-z0-9_])?$/.test(name)
      ? 'can use letters, numbers, underscores, periods and hyphens; must start with a letter or number and end with a letter, number or underscore'
      : null)
}

export const virtualNetworkNameReason     = name => networkNameReason(name, 2, 64)
export const subnetNameReason             = name => networkNameReason(name, 1, 80)
export const networkInterfaceNameReason   = name => networkNameReason(name, 1, 80)
export const networkSecurityGroupNameReason = name => networkNameReason(name, 1, 80)
export const publicIpNameReason           = name => networkNameReason(name, 1, 80)

/** NSG security rule — up to 80; starts with a word character; ends with a word character or _. (AZURE_ACCURACY C2) */
export function securityRuleNameReason(name) {
  return lengthReason(name, 1, 80)
    ?? (!/^\w([\w.-]*\w)?$/.test(name) ? 'can use letters, numbers, underscores, periods and hyphens; must start and end with a letter, number or underscore' : null)
}

/** Microsoft.Compute/disks — 1–80; alphanumerics, underscores, hyphens. */
export function diskNameReason(name) {
  return lengthReason(name, 1, 80)
    ?? (!/^[A-Za-z0-9_-]+$/.test(name) ? 'can use letters, numbers, underscores and hyphens' : null)
}

// The host-name characters Azure refuses for virtual machines (AZURE_ACCURACY K table).
const VM_FORBIDDEN = /[\s~!@#$%^&*()=+_[\]{}\\|;:.'",<>/?]/

/**
 * Microsoft.Compute/virtualMachines host name — Windows 1–15, Linux 1–64 (K1: the portal
 * uses one value for the resource name and the host name; the resource name alone could
 * be up to 64 characters).
 */
export function virtualMachineNameReason(name, osType) {
  const max = osType === 'Windows' ? 15 : 64
  return lengthReason(name, 1, max)
    ?? (CONTROL.test(name) || VM_FORBIDDEN.test(name)
      ? "can't contain spaces or any of ~ ! @ # $ % ^ & * ( ) = + _ [ ] { } \\ | ; : . ' \" , < > / ?"
      : null)
    ?? (name.endsWith('-') ? "can't end with a hyphen" : null)
}

/** Microsoft.Storage/storageAccounts — 3–24, lowercase letters and numbers, unique across Azure (K2). */
export function storageAccountNameReason(name) {
  return lengthReason(name, 3, 24)
    ?? (!/^[a-z0-9]+$/.test(name) ? 'can use only lowercase letters and numbers' : null)
}

/**
 * Storage account names already "taken" elsewhere in Azure. Real global uniqueness can't
 * be checked offline, so this fictional list stands in for the rest of the world
 * (documented simplification, AZURE_ACCURACY K2). Labelled as simulated in the UI.
 */
export const SIMULATED_TAKEN_STORAGE_NAMES = Object.freeze([
  'storage', 'mystorage', 'mystorageaccount', 'storageaccount', 'test', 'teststorage',
  'contoso', 'contosostorage', 'azure', 'azurestorage', 'data', 'backup', 'logs',
])
