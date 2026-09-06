/**
 * Shared "we're about to wipe everything" flag.
 *
 * newGame() sweeps every netsim_* localStorage key, then reloads — but
 * window.location.reload() doesn't stop JS execution immediately, and more
 * than one context has its own autosave effect (GameContext's main save,
 * CareerContext's company/reputation/clients/contracts). A pending state
 * update from just before the click can flush after the sweep and write a
 * key straight back, moments before the page actually navigates away.
 *
 * Rather than trying to out-time that race (fragile — it depends on exact
 * scheduler/microtask ordering between React and the browser), every
 * autosave effect checks this flag and skips its write once it's set.
 * markResetting() is called synchronously as the first thing newGame() does,
 * before the sweep even runs, so this is deterministic regardless of timing.
 */
let resetting = false

export function markResetting() { resetting = true }
export function isResetting() { return resetting }
