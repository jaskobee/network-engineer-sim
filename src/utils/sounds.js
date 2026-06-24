let _ctx = null

function getCtx() {
  try {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
    if (_ctx.state === 'suspended') _ctx.resume().catch(() => {})
    return _ctx
  } catch { return null }
}

function osc(freq, dur, type = 'sine', vol = 0.12, startAt = 0) {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime + startAt
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.connect(g); g.connect(ctx.destination)
  o.type = type
  o.frequency.setValueAtTime(freq, now)
  g.gain.setValueAtTime(vol, now)
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur)
  o.start(now); o.stop(now + dur + 0.01)
}

export function playPowerOn() {
  [200, 320, 480, 640].forEach((f, i) => osc(f, 0.1, 'sine', 0.12, i * 0.08))
}

export function playPowerOff() {
  [600, 440, 300, 160].forEach((f, i) => osc(f, 0.1, 'sine', 0.1, i * 0.09))
}

export function playPingSuccess() {
  osc(880, 0.12, 'sine', 0.1)
  osc(1100, 0.08, 'sine', 0.06, 0.06)
}

export function playPingFail() {
  osc(180, 0.18, 'sawtooth', 0.08)
}

export function playCableConnect() {
  const ctx = getCtx()
  if (!ctx) return
  const now = ctx.currentTime
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'; f.frequency.setValueAtTime(800, now)
  o.connect(f); f.connect(g); g.connect(ctx.destination)
  o.type = 'square'; o.frequency.setValueAtTime(320, now)
  g.gain.setValueAtTime(0.07, now)
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06)
  o.start(now); o.stop(now + 0.07)
}

export function playPurchase() {
  osc(523, 0.08, 'sine', 0.1)
  osc(659, 0.1, 'sine', 0.12, 0.09)
  osc(784, 0.14, 'sine', 0.14, 0.18)
}

export function playMissionComplete() {
  [523, 659, 784, 1047].forEach((f, i) => osc(f, 0.22, 'sine', 0.15, i * 0.13))
}

export function playSave() {
  osc(660, 0.08, 'sine', 0.06)
}

export function playCableDisconnect() {
  osc(200, 0.12, 'sawtooth', 0.06)
}
