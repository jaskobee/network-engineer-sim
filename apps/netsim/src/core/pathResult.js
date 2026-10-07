/**
 * PathResult — the contract every forwarding plane returns for "would this flow get
 * there and back?" (docs/platform/HYBRID_PLATFORM_ROADMAP.md §3.2).
 *
 * Phase 0 documents the object today's on-prem plane already returns
 * (`Topology.checkPing(srcIp, dstIp, service)`, built by `_pingResult` in
 * apps/netsim/src/onprem/Topology.js). Nothing here is new data. A `hops[]` decision trace is a
 * Phase 2 decision and deliberately absent.
 *
 * The result is bidirectional: `reachable` is true only when the request reaches the
 * destination AND the reply finds its way back (NETWORKING_ACCURACY.md Prompt 4).
 *
 * @typedef {Object} PathResult
 * @property {boolean} reachable      Request delivered and reply returned.
 * @property {false}   degraded       Always false today; reserved for partial loss
 *                                    (e.g. a future duplex-mismatch model).
 * @property {number}  sent           Echoes counted for the summary — always 5 (IOS default).
 * @property {number}  received       5 when reachable, else 0 (no partial loss modelled).
 * @property {number}  lossPct        0 when reachable, else 100.
 * @property {number}  rttMs          Nominal round-trip time: 2 when reachable, else 0.
 *                                    The shells print their own per-hop RTTs; this is not
 *                                    a measured value.
 * @property {?string} failureReason  null when reachable, otherwise a code from
 *                                    FAILURE_REASONS with source 'path' (apps/netsim/src/core/failureReasons.js).
 * @property {?string} failurePoint   Device id where the flow was dropped, when the plane
 *                                    knows it (firewall, NAT router, router with no route,
 *                                    the device the reply could not leave); null otherwise
 *                                    and always null when reachable.
 */

/**
 * The traffic a path is evaluated for. Omitted → ICMP echo (what `ping` sends).
 *
 * @typedef {Object} FlowService
 * @property {'icmp'|'tcp'|'udp'|'any'} protocol
 * @property {?number} port           Destination port for tcp/udp; null for icmp/any.
 */

export {}
