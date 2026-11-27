/**
 * smashSound.ts - the smash's sounds, laid on the animation's own clock
 * (lib/blueprint/hammerAnim.ts), in layers (owner, 2026-11-27: "the current
 * smash sfx is weak ... several will probably be needed", and "for the
 * impact and blocks disintegrating, use a sfx that sounds like breaking
 * glass or a multitude of shattering"):
 *
 *   the hold    a soft swish as the hammer comes forward; then the charge, a
 *               hum that tightens into a whine as it fills, with spark
 *               crackles over it, more of them as it builds; then a rising
 *               rush of air as the hammer goes overhead;
 *   the swing   a short hard whoosh;
 *   the impact  shattering glass, several breaks laid over each other, more
 *               and over a longer moment the more blocks went; under it a
 *               low boom and a thump for weight, a crack, and a quiet
 *               digital zap;
 *   the tail    glass tinkling down and rubble falling, with the smoke.
 *
 * Letting go early winds the charge down: its pitch falls away and nothing
 * else sounds.
 *
 * The hum, the whine, the crackles, the whooshes and the thump are
 * synthesised on the spot, as the chime is (lib/chime.ts), so they stretch
 * to a hold of any length. The breaks, the boom, the crack, the zap and the
 * tail are recordings, all CC0 (public/audio/smash/CREDITS.md), about 100 KB
 * together, fetched the first time the Compiler is in hand
 * (preloadSmashSounds). Each smash picks and tunes them a little
 * differently, so two never sound the same. If they have not arrived, or
 * cannot be read here, the synthesised impact plays instead.
 *
 * A miss is silent. Every sound goes through the Sound effects gates
 * (lib/sfx.ts sfxAllowed) and fails silent. The app has no volume of its
 * own; the levels here sit with its other effects, a little above them at
 * the impact.
 */

import { audioContext } from '../audioContext'
import { sfxAllowed } from '../sfx'
import { readyMs, windupFromMs } from './hammerAnim'

function ctx(): AudioContext | null {
  if (!sfxAllowed()) return null
  try {
    const ac = audioContext()
    if (!ac) return null
    if (ac.state === 'suspended') void ac.resume()
    return ac
  } catch { return null }
}

/** The recordings (public/audio/smash). */
export const SMASH_FILES = [
  'shatter-big', 'shatter-1', 'shatter-2', 'shatter-3', 'shatter-4', 'shatter-5', 'shatter-6',
  'tinkle-1', 'tinkle-2', 'tinkle-3', 'boom', 'crack', 'rubble-1', 'rubble-2', 'zap',
] as const
export type SmashFile = typeof SMASH_FILES[number]
export type SmashBuffers = Partial<Record<SmashFile, AudioBuffer>>

const buffers: SmashBuffers = {}
let loading: Promise<void> | null = null

/** Where a recording is served from. */
export function smashFileUrl(name: SmashFile): string {
  return `${import.meta.env.BASE_URL}audio/smash/${name}.mp3`
}

/** Fetch and decode every recording into `into`, with `ac`. One that fails is left out. */
export async function loadSmashBuffers(ac: BaseAudioContext, into: SmashBuffers = {}): Promise<SmashBuffers> {
  await Promise.all(SMASH_FILES.map(async (name) => {
    if (into[name]) return
    try {
      const res = await fetch(smashFileUrl(name))
      if (!res.ok) return
      into[name] = await ac.decodeAudioData(await res.arrayBuffer())
    } catch { /* left out: the synthesised impact covers it */ }
  }))
  return into
}

/** Fetch the recordings, once: called the first time the Compiler is in hand, and again at a hold if that came too early for sound. */
export function preloadSmashSounds(): void {
  if (loading) return
  let ac: AudioContext | null = null
  try { ac = audioContext() } catch { ac = null }
  if (!ac) return
  loading = loadSmashBuffers(ac, buffers).then(() => {
    // Whatever is missing is asked for again the next time.
    if (SMASH_FILES.some((n) => !buffers[n])) loading = null
  })
}

/** Two seconds of white noise, made once for a context: every whoosh and crackle is cut from it. */
const noises = new WeakMap<BaseAudioContext, AudioBuffer>()
function noiseOf(ac: BaseAudioContext): AudioBuffer {
  let b = noises.get(ac)
  if (!b) {
    b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noises.set(ac, b)
  }
  return b
}

const between = (a: number, b: number): number => a + Math.random() * (b - a)

/** A burst of filtered noise from `t0`, its filter sweeping `from` to `to` Hz, rising to `peak` by `attack` and gone by `dur`. */
function noise(ac: BaseAudioContext, out: AudioNode, t0: number, dur: number, from: number, to: number, peak: number, type: BiquadFilterType = 'bandpass', attack = 0.004, q = 0.9): AudioBufferSourceNode {
  const src = ac.createBufferSource()
  src.buffer = noiseOf(ac)
  src.loop = true
  const f = ac.createBiquadFilter()
  f.type = type
  f.Q.setValueAtTime(q, t0)
  f.frequency.setValueAtTime(from, t0)
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  const g = ac.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(attack, dur * 0.8))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f); f.connect(g); g.connect(out)
  src.start(t0, Math.random() * 1.5)
  src.stop(t0 + dur + 0.02)
  return src
}

/** One recording at `t0`, at `gain` and `rate` (its pitch and speed together). False when it is not loaded. */
function sample(ac: BaseAudioContext, out: AudioNode, bufs: SmashBuffers, name: SmashFile, t0: number, gain: number, rate = 1): boolean {
  const b = bufs[name]
  if (!b) return false
  const src = ac.createBufferSource()
  src.buffer = b
  src.playbackRate.setValueAtTime(rate, t0)
  const g = ac.createGain()
  g.gain.setValueAtTime(gain, t0)
  src.connect(g); g.connect(out)
  src.start(t0)
  return true
}

/** What a charge under way needs to be stopped or wound down. */
export interface Charge { bus: GainNode; oscs: OscillatorNode[]; srcs: AudioScheduledSourceNode[]; end: number }

/** The most crackles one hold schedules, however long it is. */
const CRACKLES_MAX = 140

/**
 * The hold's sounds from `t0`, for a hold of `ms`: the swish in, the hum and
 * whine from when the hammer is forward, the crackles, the rush of the
 * wind-up. A bare hand has no hammer to spark: it only hums, quieter.
 */
export function scheduleCharge(ac: BaseAudioContext, out: AudioNode, t0: number, ms: number, bare = false): Charge {
  const len = Math.max(0.05, ms / 1000)
  const from = t0 + readyMs(ms) / 1000, wind = t0 + windupFromMs(ms) / 1000, end = t0 + len
  const bus = ac.createGain()
  bus.gain.setValueAtTime(bare ? 0.4 : 0.6, t0)
  bus.connect(out)
  const oscs: OscillatorNode[] = [], srcs: AudioScheduledSourceNode[] = []
  // The hammer coming forward.
  if (!bare) srcs.push(noise(ac, bus, t0, Math.max(0.08, from - t0), 380, 1500, 0.05, 'bandpass', 0.08))

  // The hum: two saws a few cents apart, opening up as they rise, with a shiver that quickens.
  const hum = ac.createGain()
  hum.gain.setValueAtTime(0.0001, from)
  hum.gain.exponentialRampToValueAtTime(0.05, from + Math.min(0.25, (end - from) * 0.3))
  hum.gain.exponentialRampToValueAtTime(0.11, end)
  hum.connect(bus)
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.Q.setValueAtTime(3, from)
  filter.frequency.setValueAtTime(320, from)
  filter.frequency.exponentialRampToValueAtTime(3200, end)
  filter.connect(hum)
  for (const detune of [-9, 9]) {
    const osc = ac.createOscillator()
    osc.type = 'sawtooth'
    osc.detune.setValueAtTime(detune, from)
    osc.frequency.setValueAtTime(58, from)
    osc.frequency.exponentialRampToValueAtTime(360, end)
    osc.connect(filter)
    osc.start(from); osc.stop(end + 0.6)
    oscs.push(osc)
  }
  const shiver = ac.createOscillator()
  shiver.type = 'sine'
  shiver.frequency.setValueAtTime(7, from)
  shiver.frequency.exponentialRampToValueAtTime(31, end)
  const depth = ac.createGain()
  depth.gain.setValueAtTime(0.012, from)
  depth.gain.linearRampToValueAtTime(0.04, end)
  shiver.connect(depth); depth.connect(hum.gain)
  shiver.start(from); shiver.stop(end + 0.6)
  srcs.push(shiver)

  // The whine: a thin tone climbing over the hum, loudest at the top.
  const whine = ac.createOscillator()
  whine.type = 'triangle'
  whine.frequency.setValueAtTime(520, from)
  whine.frequency.exponentialRampToValueAtTime(2900, end)
  const wg = ac.createGain()
  wg.gain.setValueAtTime(0.0001, from)
  wg.gain.exponentialRampToValueAtTime(0.012, from + (end - from) * 0.5)
  wg.gain.exponentialRampToValueAtTime(0.05, end)
  whine.connect(wg); wg.connect(bus)
  whine.start(from); whine.stop(end + 0.6)
  oscs.push(whine)

  if (!bare) {
    // The crackles: sparks off the lit edges, a few a second at first and a hail of them at the top.
    const span = end - from
    let t = from + 0.1
    for (let n = 0; n < CRACKLES_MAX && t < end; n++) {
      const c = (t - from) / span
      const dur = between(0.012, 0.045)
      srcs.push(noise(ac, bus, t, dur, between(2800, 7500), between(1800, 5000), between(0.03, 0.09) * (0.5 + 0.8 * c), 'highpass', 0.001))
      // A snap now and then: a short falling chirp.
      if (Math.random() < 0.18) {
        const o = ac.createOscillator(), g = ac.createGain()
        o.type = 'square'
        o.frequency.setValueAtTime(between(2200, 5200), t)
        o.frequency.exponentialRampToValueAtTime(between(300, 900), t + 0.03)
        g.gain.setValueAtTime(0.02 * (0.5 + c), t)
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035)
        o.connect(g); g.connect(bus)
        o.start(t); o.stop(t + 0.04)
        srcs.push(o)
      }
      t += between(0.4, 1.6) / (3 + 26 * c * c)
    }
    // The wind-up: air rushing as the hammer goes overhead.
    srcs.push(noise(ac, bus, wind, Math.max(0.08, end - wind), 260, 1700, 0.09, 'bandpass', (end - wind) * 0.7))
  }
  return { bus, oscs, srcs, end }
}

/** End a charge at `t`: cut for the swing, or (let go early) wound down, its pitch falling away. */
export function stopCharge(charge: Charge, t: number, letGo: boolean): void {
  const fall = letGo ? 0.32 : 0.05
  try {
    const g = charge.bus.gain
    g.cancelScheduledValues(t)
    g.setValueAtTime(Math.max(0.0001, g.value), t)
    g.exponentialRampToValueAtTime(0.0001, t + fall)
    for (const o of charge.oscs) {
      if (letGo) {
        const f = o.frequency
        f.cancelScheduledValues(t)
        f.setValueAtTime(Math.max(20, f.value), t)
        f.exponentialRampToValueAtTime(Math.max(20, f.value * 0.3), t + fall)
      }
      o.stop(t + fall + 0.03)
    }
    for (const s of charge.srcs) { try { s.stop(t + fall + 0.03) } catch { /* already over */ } }
  } catch { /* already stopped */ }
}

/** The swing's whoosh from `t0`: a hard rush with a low body under it. */
export function scheduleWhoosh(ac: BaseAudioContext, out: AudioNode, t0: number): void {
  noise(ac, out, t0, 0.24, 500, 4600, 0.3, 'bandpass', 0.11, 1.4)
  noise(ac, out, t0, 0.22, 140, 520, 0.22, 'lowpass', 0.12)
}

/** The synthesised impact: a low thump, and (when the recordings are not there) a glassy crackle that thins out. */
function thump(ac: BaseAudioContext, out: AudioNode, t: number, crackle: boolean): void {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(150, t)
  osc.frequency.exponentialRampToValueAtTime(36, t + 0.28)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.7, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42)
  osc.connect(g); g.connect(out)
  osc.start(t); osc.stop(t + 0.45)
  if (crackle) {
    noise(ac, out, t, 0.9, 6000, 1800, 0.14, 'highpass')
    noise(ac, out, t, 0.12, 1800, 300, 0.3, 'bandpass', 0.002)
  }
}

/** How many glass breaks a smash of `blocks` blocks lays over each other: three for one block, more for more, eight at most. */
export function shatterLayers(blocks: number): number {
  return Math.min(8, 3 + Math.floor(Math.log2(Math.max(1, blocks)) * 1.1))
}

const BREAKS = ['shatter-1', 'shatter-2', 'shatter-3', 'shatter-4', 'shatter-5', 'shatter-6'] as const
const TINKLES = ['tinkle-1', 'tinkle-2', 'tinkle-3'] as const

/**
 * The impact at `t0` and its tail, for a smash of `blocks` blocks: the glass
 * leads, over the boom and the thump, the crack and the zap; then the
 * tinkling and the rubble. Every pick, pitch and level is a little different
 * each time. With no recordings, the synthesised impact alone.
 */
export function scheduleImpact(ac: BaseAudioContext, out: AudioNode, t0: number, blocks: number, bufs: SmashBuffers): void {
  const have = !!bufs['shatter-1'] || !!bufs['shatter-big']
  thump(ac, out, t0, !have)
  if (!have) return
  const n = Math.max(1, blocks)
  sample(ac, out, bufs, 'boom', t0, between(0.9, 1.05), between(0.88, 1.06))
  sample(ac, out, bufs, 'crack', t0, between(0.4, 0.5), between(0.9, 1.2))
  sample(ac, out, bufs, 'zap', t0 + 0.012, between(0.1, 0.15), between(0.75, 1.25))

  // The glass: one break right on the blow (the big one for a real build), the rest scattered just after it, a wider scatter for more blocks.
  const layers = shatterLayers(n)
  const spread = Math.min(0.42, 0.1 + 0.035 * Math.sqrt(n) * 2)
  sample(ac, out, bufs, n >= 4 ? 'shatter-big' : BREAKS[Math.floor(Math.random() * 4)], t0, between(0.8, 0.95), between(0.92, 1.1))
  let last = -1
  for (let i = 1; i < layers; i++) {
    let pick = Math.floor(Math.random() * BREAKS.length)
    if (pick === last) pick = (pick + 1) % BREAKS.length
    last = pick
    sample(ac, out, bufs, BREAKS[pick], t0 + between(0.01, spread) * (i / layers + 0.3), between(0.36, 0.56), between(0.8, 1.35))
  }

  // The tail: pieces tinkling down, and rubble, as the smoke falls.
  const tinkles = Math.min(6, 2 + Math.floor(n / 5))
  for (let i = 0; i < tinkles; i++) {
    sample(ac, out, bufs, TINKLES[Math.floor(Math.random() * TINKLES.length)], t0 + between(0.25, 0.5) + i * between(0.18, 0.32), between(0.2, 0.34) * (1 - i / (tinkles + 3)), between(0.9, 1.5))
  }
  sample(ac, out, bufs, Math.random() < 0.5 ? 'rubble-1' : 'rubble-2', t0 + between(0.16, 0.26), between(0.26, 0.36), between(0.85, 1.1))
  if (n > 8) sample(ac, out, bufs, 'rubble-2', t0 + between(0.5, 0.7), between(0.18, 0.26), between(0.7, 0.9))
}

/** Where the app's smash sounds go: a limiter before the speakers, so the impact's layers never clip. One for a context. */
const outs = new WeakMap<BaseAudioContext, AudioNode>()
export function smashOut(ac: BaseAudioContext): AudioNode {
  let out = outs.get(ac)
  if (!out) {
    const limit = ac.createDynamicsCompressor()
    limit.threshold.setValueAtTime(-6, ac.currentTime)
    limit.knee.setValueAtTime(8, ac.currentTime)
    limit.ratio.setValueAtTime(6, ac.currentTime)
    limit.attack.setValueAtTime(0.002, ac.currentTime)
    limit.release.setValueAtTime(0.18, ac.currentTime)
    const level = ac.createGain()
    level.gain.setValueAtTime(0.9, ac.currentTime)
    limit.connect(level); level.connect(ac.destination)
    out = limit
    outs.set(ac, out)
  }
  return out
}

let charge: Charge | null = null

/** The hold begins: its sounds, for a hold of `ms`. */
export function humStart(ms: number, bare = false): void {
  humStop()
  const ac = ctx()
  if (!ac) return
  preloadSmashSounds()
  try { charge = scheduleCharge(ac, smashOut(ac), ac.currentTime, ms, bare) } catch { charge = null }
}

/** The hold ends: cut for the swing, or, let go early (`letGo`), wound down. */
export function humStop(letGo = false): void {
  const c = charge
  charge = null
  if (!c) return
  try { stopCharge(c, c.bus.context.currentTime, letGo) } catch { /* already stopped */ }
}

/** The swing's whoosh. */
export function whoosh(): void {
  const ac = ctx()
  if (!ac) return
  try { scheduleWhoosh(ac, smashOut(ac), ac.currentTime) } catch { /* silent */ }
}

/** The impact, for a smash of `blocks` blocks, and its tail. */
export function impact(blocks = 1): void {
  const ac = ctx()
  if (!ac) return
  try { scheduleImpact(ac, smashOut(ac), ac.currentTime, blocks, buffers) } catch { /* silent */ }
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
