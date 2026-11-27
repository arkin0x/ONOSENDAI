/**
 * smashSound.ts - the smash's sounds, synthesised on the spot like the chime
 * (lib/chime.ts): a hum that tightens while the hold fills, a short whoosh
 * for the swing, the impact with a glassy crackle, and a soft chime for each
 * prize as it pops out of the dust, each a step higher (owner, 2026-11-27).
 * A miss is silent. Every sound goes through the Sound effects gates
 * (lib/sfx.ts sfxAllowed) and fails silent.
 */

import { audioContext } from '../audioContext'
import { sfxAllowed } from '../sfx'

function ctx(): AudioContext | null {
  if (!sfxAllowed()) return null
  try {
    const ac = audioContext()
    if (!ac) return null
    if (ac.state === 'suspended') void ac.resume()
    return ac
  } catch { return null }
}

let hum: { osc: OscillatorNode; gain: GainNode } | null = null

/** The hold's hum: rises from a low drone to a tight whine over `ms`. */
export function humStart(ms: number): void {
  humStop()
  const ac = ctx()
  if (!ac) return
  try {
    const t = ac.currentTime
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.035, t + 0.2)
    gain.gain.exponentialRampToValueAtTime(0.06, t + ms / 1000)
    gain.connect(ac.destination)
    const osc = ac.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(70, t)
    osc.frequency.exponentialRampToValueAtTime(420, t + ms / 1000)
    const filter = ac.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(400, t)
    filter.frequency.exponentialRampToValueAtTime(2400, t + ms / 1000)
    osc.connect(filter)
    filter.connect(gain)
    osc.start(t)
    hum = { osc, gain }
  } catch { hum = null }
}

/** The hum ends (let go, or the swing). */
export function humStop(): void {
  const h = hum
  hum = null
  if (!h) return
  try {
    const t = h.osc.context.currentTime
    h.gain.gain.cancelScheduledValues(t)
    h.gain.gain.setValueAtTime(Math.max(0.0001, h.gain.gain.value), t)
    h.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08)
    h.osc.stop(t + 0.1)
  } catch { /* already stopped */ }
}

/** A burst of filtered noise: the whoosh and the crackle. */
function noise(ac: AudioContext, t0: number, dur: number, from: number, to: number, peak: number, type: BiquadFilterType = 'bandpass'): void {
  const len = Math.ceil(ac.sampleRate * dur)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ac.createBufferSource()
  src.buffer = buf
  const f = ac.createBiquadFilter()
  f.type = type
  f.frequency.setValueAtTime(from, t0)
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(peak, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f); f.connect(g); g.connect(ac.destination)
  src.start(t0)
  src.stop(t0 + dur)
}

/** The swing's whoosh. */
export function whoosh(): void {
  const ac = ctx()
  if (!ac) return
  try { noise(ac, ac.currentTime, 0.2, 500, 3200, 0.12) } catch { /* silent */ }
}

/** The impact: a low thump and a glassy crackle that thins out. */
export function impact(): void {
  const ac = ctx()
  if (!ac) return
  try {
    const t = ac.currentTime
    const osc = ac.createOscillator()
    const g = ac.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(140, t)
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.25)
    g.gain.setValueAtTime(0.22, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
    osc.connect(g); g.connect(ac.destination)
    osc.start(t); osc.stop(t + 0.32)
    noise(ac, t, 0.9, 6000, 1800, 0.08, 'highpass')
  } catch { /* silent */ }
}

/** One prize's chime: a bright pair of notes, `step` semitones up for each toy in turn. */
export function prizeChime(step: number): void {
  const ac = ctx()
  if (!ac) return
  try {
    const t = ac.currentTime
    const base = 660 * Math.pow(2, (2 * step) / 12)
    const g = ac.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
    g.connect(ac.destination)
    for (const [mul, at] of [[1, 0], [1.5, 0.07]] as const) {
      const o = ac.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(base * mul, t + at)
      o.connect(g)
      o.start(t + at)
      o.stop(t + at + 0.35)
    }
  } catch { /* silent */ }
}
