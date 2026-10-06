/**
 * Microsoft's Azure architecture icons (src/assets/azure-icons/NOTICE.md).
 * Terms: shown unmodified, at any size, always with the full service name nearby — so
 * this module only ever renders an icon together with SERVICES[kind].name. Never
 * recolour them or use them for anything but the Azure service they represent.
 */
import { TYPES } from '../../cloud/model.js'
import managementGroups from '../../assets/azure-icons/10011-icon-service-Management-Groups.svg'
import subscriptions from '../../assets/azure-icons/10002-icon-service-Subscriptions.svg'
import resourceGroups from '../../assets/azure-icons/10007-icon-service-Resource-Groups.svg'
import virtualNetworks from '../../assets/azure-icons/10061-icon-service-Virtual-Networks.svg'
import subnet from '../../assets/azure-icons/02742-icon-service-Subnet.svg'
import networkSecurityGroups from '../../assets/azure-icons/10067-icon-service-Network-Security-Groups.svg'
import networkInterfaces from '../../assets/azure-icons/10080-icon-service-Network-Interfaces.svg'
import publicIpAddresses from '../../assets/azure-icons/10069-icon-service-Public-IP-Addresses.svg'
import virtualMachine from '../../assets/azure-icons/10021-icon-service-Virtual-Machine.svg'
import disks from '../../assets/azure-icons/10032-icon-service-Disks.svg'
import storageAccounts from '../../assets/azure-icons/10086-icon-service-Storage-Accounts.svg'

// Service names as Microsoft labels the icons (the icon file names).
export const SERVICES = Object.freeze({
  managementGroup: { icon: managementGroups, name: 'Management Groups' },
  subscription: { icon: subscriptions, name: 'Subscriptions' },
  resourceGroup: { icon: resourceGroups, name: 'Resource Groups' },
  subnet: { icon: subnet, name: 'Subnet' },
  [TYPES.VIRTUAL_NETWORK]: { icon: virtualNetworks, name: 'Virtual Networks' },
  [TYPES.NETWORK_SECURITY_GROUP]: { icon: networkSecurityGroups, name: 'Network Security Groups' },
  [TYPES.NETWORK_INTERFACE]: { icon: networkInterfaces, name: 'Network Interfaces' },
  [TYPES.PUBLIC_IP]: { icon: publicIpAddresses, name: 'Public IP Addresses' },
  [TYPES.VIRTUAL_MACHINE]: { icon: virtualMachine, name: 'Virtual Machine' },
  [TYPES.DISK]: { icon: disks, name: 'Disks' },
  [TYPES.STORAGE_ACCOUNT]: { icon: storageAccounts, name: 'Storage Accounts' },
})

/**
 * An icon with its service name. `label` is the resource's own name; the service name is
 * always rendered as the caption (FAQ: "the full name of the service should always appear
 * near the icon").
 */
export function AzureItem({ kind, label, size = 22 }) {
  const svc = SERVICES[kind]
  return (
    <span className="az-item">
      <img className="az-icon" src={svc.icon} width={size} height={size} alt="" draggable="false" />
      <span className="az-text">
        {label && <span className="az-label">{label}</span>}
        <span className="az-service">{svc.name}</span>
      </span>
    </span>
  )
}
