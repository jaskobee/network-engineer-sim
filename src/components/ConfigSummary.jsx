/**
 * ConfigSummary — read-only, beginner-friendly view of a device's real
 * configuration: default gateway/routes, DHCP (server pools or client
 * lease), VLAN/switchport assignment, NAT, firewall zones/rules.
 *
 * Deliberately READ-ONLY. This is "let a beginner SEE what show ip route /
 * show ip dhcp pool / show vlan brief / show ip nat translations / show
 * firewall-rules would tell them" without needing the CLI vocabulary yet —
 * it is not a second way to CONFIGURE anything (that would undercut the
 * game's whole point: real CLI accuracy). Every field read here already
 * exists on the real Device instance and is already rendered, in the same
 * shape, by DevPanel.jsx's dev-only inspector — this just surfaces it to
 * real players.
 */
import { maskToPrefixLen } from '../models/ipUtils.js'

function Section({ icon, title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 13 }}>{icon}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#4a90e2', letterSpacing: 0.8, textTransform: 'uppercase' }}>{title}</span>
      </div>
      <div style={{ paddingLeft: 4 }}>{children}</div>
    </div>
  )
}

function Row({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '2px 0', fontSize: 11 }}>
      <span style={{ color: '#667' }}>{label}</span>
      <span style={{ color: accent ?? '#d0d0d0', fontFamily: 'monospace', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export default function ConfigSummary({ device }) {
  const routes = device.routing_table ?? []
  const defaultRoute = routes.find(r => r.network === '0.0.0.0')
  const staticRoutes = routes.filter(r => r.network !== '0.0.0.0')

  const dhcpPools = device.dhcp_pools ?? []
  const dhcpBindings = device.dhcp_bindings ?? []
  const dhcpClientIfaces = device.interfaces.filter(i => i.dhcp_assigned)

  const vlanEntries = Object.entries(device.vlan_db ?? {})
  const switchportIfaces = device.interfaces.filter(i => i.vlan != null || i.switchport_mode)

  const natRules = device.nat_rules ?? []
  const natTranslations = device.nat_translations ?? []
  const natInsideIfaces = device.interfaces.filter(i => i.nat_inside)
  const natOutsideIfaces = device.interfaces.filter(i => i.nat_outside)

  const fwZones = Object.entries(device.fw_zones ?? {})
  const fwRules = device.fw_rules ?? []

  const hasRouting = !!defaultRoute || staticRoutes.length > 0
  const hasDhcpServer = dhcpPools.length > 0
  const hasDhcpClient = dhcpClientIfaces.length > 0
  const hasVlan = vlanEntries.length > 0 || switchportIfaces.length > 0
  const hasNat = natRules.length > 0 || natInsideIfaces.length > 0 || natOutsideIfaces.length > 0
  const hasFirewall = fwZones.length > 0

  const nothingConfigured = !hasRouting && !hasDhcpServer && !hasDhcpClient && !hasVlan && !hasNat && !hasFirewall

  if (nothingConfigured) {
    return (
      <div style={{ fontSize: 11, color: '#333', textAlign: 'center', padding: '24px 8px' }}>
        Nothing configured on this device yet.
      </div>
    )
  }

  return (
    <div>
      {hasRouting && (
        <Section icon="🌐" title="Routing">
          {defaultRoute && (
            <Row
              label="Default Gateway"
              value={defaultRoute.next_hop ?? defaultRoute.exit_interface ?? '—'}
              accent="#50fa7b"
            />
          )}
          {staticRoutes.map((r, i) => (
            <Row
              key={i}
              label={`${r.network}/${maskToPrefixLen(r.mask)}`}
              value={`via ${r.next_hop ?? r.exit_interface ?? '?'}`}
            />
          ))}
        </Section>
      )}

      {hasDhcpServer && (
        <Section icon="📡" title="DHCP Server">
          {dhcpPools.map((p, i) => (
            <div key={i} style={{ marginBottom: 6, padding: '6px 8px', background: '#07070d', borderRadius: 4 }}>
              <Row label="Pool" value={p.name} />
              <Row label="Network" value={`${p.network}/${maskToPrefixLen(p.mask)}`} />
              {p.default_router && <Row label="Gateway handed out" value={p.default_router} />}
              {p.dns_server && <Row label="DNS handed out" value={p.dns_server} />}
            </div>
          ))}
          <Row label="Active leases" value={dhcpBindings.length} />
        </Section>
      )}

      {hasDhcpClient && (
        <Section icon="📥" title="DHCP Client">
          {dhcpClientIfaces.map(i => (
            <Row key={i.name} label={`${i.name} received via DHCP`} value={i.ip ?? '—'} accent="#8be9fd" />
          ))}
        </Section>
      )}

      {hasVlan && (
        <Section icon="🏷️" title="VLANs">
          {vlanEntries.map(([id, v]) => (
            <Row key={id} label={`VLAN ${id}`} value={v.name ?? '(unnamed)'} />
          ))}
          {switchportIfaces.map(i => (
            <Row
              key={i.name}
              label={i.name}
              value={i.switchport_mode === 'trunk' ? 'trunk' : i.vlan != null ? `access — VLAN ${i.vlan}` : '—'}
            />
          ))}
        </Section>
      )}

      {hasNat && (
        <Section icon="🔁" title="NAT">
          {natInsideIfaces.length > 0 && (
            <Row label="Inside" value={natInsideIfaces.map(i => i.name).join(', ')} />
          )}
          {natOutsideIfaces.length > 0 && (
            <Row label="Outside" value={natOutsideIfaces.map(i => i.name).join(', ')} />
          )}
          <Row label="Active translations" value={natTranslations.length} />
        </Section>
      )}

      {hasFirewall && (
        <Section icon="🛡️" title="Firewall">
          {fwZones.map(([ifName, zone]) => (
            <Row key={ifName} label={ifName} value={zone} />
          ))}
          <Row label="Rules configured" value={fwRules.length} />
        </Section>
      )}
    </div>
  )
}
