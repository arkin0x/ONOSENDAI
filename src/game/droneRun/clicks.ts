/**
 * clicks.ts - DRONE RUN's short sounds in the player's head: a press sound
 * for each control, and the hits (owner, 2026-11-17: "small distinct hit
 * noises should be added for the ui controls"; "hit noises for bullet hits
 * of drones").
 *
 * Each is a few layers of synth (a swept tone, or noise through a swept
 * filter), 10 to 120 ms, original, no files. They go through the game's bus
 * (audio.ts gameBus) like the guns, never through a drone's panner, so they
 * take no drone voice slot; the game's sound switch (M, the speaker) and
 * MUTE ALL silence them, and nothing sounds before the browser lets sound
 * out (the shared context, lib/audioContext).
 *
 * | Sound | What it is |
 * |---|---|
 * | ui:fire | a soft low knock (sine 520 to 300 Hz) with a dry tick, 25 ms |
 * | ui:jump | a rising triangle blip, 600 to 1100 Hz, 45 ms |
 * | ui:sprintOn | two quick rising triangle notes |
 * | ui:sprintOff | the same two notes falling |
 * | ui:lockout | a dull falling buzz (a filtered saw, 260 to 150 Hz), 90 ms |
 * | ui:switch | a mechanical clack-clack: two filtered noise clicks 30 ms apart |
 * | ui:reload | a slide (band-passed noise) and a latch tick |
 * | ui:restart, ui:nextWave, ui:exit | soft sine glides: up a fifth, up a higher fifth, down |
 * | ui:sound | sound back on: two sine notes rising (none going off: it is silent) |
 * | hit | the hitmarker: a crisp high noise tick over a tiny metallic ping (two inharmonic sines), a little higher or lower for each gun |
 * | kill | the kill shot: a low thunk and a crunch with a ringing ping, heavier and longer |
 * | miss | an aimed pull the assist sent wide: a faint whiff, no hit |
 *
 * The numbers are the variant's (client.sounds.ui.<control>, client.sounds
 * .hit, .kill, .miss), the base variant's where a variant has none. Each
 * sound is one voice: played again, it cuts its last one cleanly (a 4 ms
 * fade), and one sooner than its `gap` after the last is dropped, so eight
 * pellets landing at once are one hitmarker.
 *
 * Ledger class (c), client: how the controls and hits sound is this
 * client's own.
 */

import type { ClickDef, ClickLayer, SoundWave } from '../../lib/games/droneRun/types'
import baseVariant from '../../lib/games/droneRun/variants/drone-run-base.json'
import { audioContext } from '../../lib/audioContext'
import { droneRunSilent, gameBus, noiseBuffer } from './audio'
import { activeRunner } from './runner'

/** The controls that sound when pressed. */
export const CONTROLS = ['fire', 'jump', 'sprintOn', 'sprintOff', 'lockout', 'switch', 'reload', 'restart', 'nextWave', 'exit', 'sound'] as const
export type Control = typeof CONTROLS[number]
export type Click = `ui:${Control}` | 'hit' | 'kill' | 'miss'

export interface Clicks {
  ui: Record<Control, ClickDef>
  hit: ClickDef
  kill: ClickDef
  miss: ClickDef
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
const fin = (x: unknown, d: number, lo: number, hi: number): number => clamp(typeof x === 'number' && Number.isFinite(x) ? x : d, lo, hi)
const WAVES: ReadonlySet<string> = new Set(['sine', 'triangle', 'sawtooth', 'square'])
const FILTERS: ReadonlySet<string> = new Set(['lowpass', 'highpass', 'bandpass'])

/** The last resort, where even the base variant has no sound: a faint sine tick. */
const FALLBACK: ClickDef = { layers: [{ kind: 'tone', wave: 'sine', from: 1000, dur: 0.03, gain: 0.01 }], gap: 0.03 }

/** One layer, every number finite and clamped, kinds, waves and filters from their lists; null when it is not a layer. */
function layerOf(g: unknown): ClickLayer | null {
  if (!isObj(g)) return null
  const kind = g.kind === 'noise' ? 'noise' : g.kind === 'tone' ? 'tone' : null
  if (!kind) return null
  const from = fin(g.from, 1000, 20, 20000)
  const out: ClickLayer = { kind, from, to: fin(g.to, from, 20, 20000), dur: fin(g.dur, 0.03, 0.005, 0.5), gain: fin(g.gain, 0.01, 0, 0.2), at: fin(g.at, 0, 0, 0.5), attack: fin(g.attack, 0.002, 0.0005, 0.05), q: fin(g.q, 1, 0.05, 50) }
  if (kind === 'tone') out.wave = typeof g.wave === 'string' && WAVES.has(g.wave) ? (g.wave as SoundWave) : 'sine'
  if (typeof g.filter === 'string' && FILTERS.has(g.filter)) out.filter = g.filter as ClickLayer['filter']
  else if (kind === 'noise') out.filter = 'bandpass'
  if (kind === 'tone' && out.filter) out.cutoff = fin(g.cutoff, 2000, 20, 20000)
  return out
}

/** One sound: `g`'s layers if it gives any good ones, else `d`'s; its gap and gun pitches checked. */
function clickOf(g: unknown, d: ClickDef): ClickDef {
  if (!isObj(g)) return d
  const layers = Array.isArray(g.layers) ? g.layers.slice(0, 8).map(layerOf).filter((l): l is ClickLayer => l !== null) : []
  const pitch = Array.isArray(g.gunPitch) ? g.gunPitch.slice(0, 8).map((x) => fin(x, 1, 0.25, 4)) : d.gunPitch
  return { layers: layers.length ? layers : d.layers, gap: fin(g.gap, d.gap ?? 0.03, 0, 1), ...(pitch ? { gunPitch: pitch } : {}) }
}

function clicksFrom(sounds: unknown, d: Clicks): Clicks {
  const s = isObj(sounds) ? sounds : {}
  const ui = isObj(s.ui) ? s.ui : {}
  const out = { ui: {} as Record<Control, ClickDef>, hit: clickOf(s.hit, d.hit), kill: clickOf(s.kill, d.kill), miss: clickOf(s.miss, d.miss) }
  for (const c of CONTROLS) out.ui[c] = clickOf(ui[c], d.ui[c])
  return out
}

const BLANK: Clicks = { ui: Object.fromEntries(CONTROLS.map((c) => [c, FALLBACK])) as Record<Control, ClickDef>, hit: FALLBACK, kill: FALLBACK, miss: FALLBACK }

/** The base variant's clicks (client.sounds.ui, .hit, .kill, .miss). */
export const DEFAULT_CLICKS: Clicks = clicksFrom((baseVariant as { client?: { sounds?: unknown } }).client?.sounds, BLANK)

/** A variant's clicks: its client.sounds over the base variant's, sound by sound. */
export function clicksOf(client: unknown): Clicks {
  return clicksFrom(isObj(client) ? client.sounds : undefined, DEFAULT_CLICKS)
}

/** A click's def in a set. */
export function clickDef(c: Clicks, name: Click): ClickDef {
  return name === 'hit' || name === 'kill' || name === 'miss' ? c[name] : c.ui[name.slice(3) as Control] ?? FALLBACK
}

/** Per context, each sound's last start and its way out (to cut it when it plays again). */
const last = new WeakMap<BaseAudioContext, Map<string, { at: number; out: GainNode }>>()

/** One layer at `t` into `to`, every frequency times `k`. */
function layerAt(ac: BaseAudioContext, to: AudioNode, t: number, l: ClickLayer, k: number): void {
  const t0 = t + (l.at ?? 0)
  const end = t0 + l.dur
  const env = ac.createGain()
  env.gain.setValueAtTime(0.0001, t0)
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, l.gain), t0 + Math.min(l.attack ?? 0.002, l.dur * 0.5))
  env.gain.exponentialRampToValueAtTime(0.0001, end)
  env.connect(to)
  const f0 = l.from * k, f1 = (l.to ?? l.from) * k
  let src: AudioScheduledSourceNode
  let into: AudioNode = env
  if (l.filter) {
    const f = ac.createBiquadFilter()
    f.type = l.filter
    f.Q.value = l.q ?? 1
    const c0 = l.kind === 'noise' ? f0 : (l.cutoff ?? 2000) * k
    const c1 = l.kind === 'noise' ? f1 : c0
    f.frequency.setValueAtTime(c0, t0)
    if (c1 !== c0) f.frequency.exponentialRampToValueAtTime(c1, end)
    f.connect(env)
    into = f
  }
  if (l.kind === 'tone') {
    const o = ac.createOscillator()
    o.type = l.wave ?? 'sine'
    o.frequency.setValueAtTime(f0, t0)
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, end)
    src = o
  } else {
    const n = ac.createBufferSource()
    n.buffer = noiseBuffer(ac)
    src = n
  }
  src.connect(into)
  // Noise from a different place each time, so a run of ticks is not one tick looped.
  if (l.kind === 'noise') (src as AudioBufferSourceNode).start(t0, Math.random() * 1.5)
  else src.start(t0)
  src.stop(end + 0.02)
}

/**
 * One click at `t` on `ac`'s clock into `out` (the game's bus): what
 * playClick plays now, and what a recording renders offline at its moment.
 * `weapon` picks a gun's pitch. Returns false when dropped (sooner than its
 * gap after the last). Played again, the last one is cut with a 4 ms fade.
 */
export function clickAt(ac: BaseAudioContext, out: AudioNode, t: number, name: Click, def: ClickDef, weapon = 0): boolean {
  let m = last.get(ac)
  if (!m) { m = new Map(); last.set(ac, m) }
  const prev = m.get(name)
  if (prev && t >= prev.at && t - prev.at < (def.gap ?? 0.03)) return false
  if (prev) {
    prev.out.gain.cancelScheduledValues(t)
    prev.out.gain.setTargetAtTime(0, t, 0.004)
  }
  const voice = ac.createGain()
  voice.connect(out)
  const k = def.gunPitch?.[weapon] ?? 1
  for (const l of def.layers) layerAt(ac, voice, t, l, k)
  m.set(name, { at: t, out: voice })
  return true
}

/** The clicks of a variant's client data, worked out once per variant object. */
const byVariant = new WeakMap<object, Clicks>()

/** The run on screen's clicks (runner.ts activeRunner); the base variant's with no run. */
function clicksNow(): Clicks {
  const v = activeRunner()?.state.world.variant
  if (!v) return DEFAULT_CLICKS
  let c = byVariant.get(v)
  if (!c) { c = clicksOf(v.client); byVariant.set(v, c) }
  return c
}

/**
 * Play a click now. Silent (returns false) when the game's sound is off or
 * MUTE ALL is on, where there is no Web Audio, or when it is a repeat
 * inside its gap.
 */
export function playClick(name: Click, weapon = 0): boolean {
  if (droneRunSilent()) return false
  try {
    const ac = audioContext()
    if (!ac) return false
    if (ac.state === 'suspended') void ac.resume().catch(() => { /* held back until a tap */ })
    return clickAt(ac, gameBus(ac), ac.currentTime, name, clickDef(clicksNow(), name), weapon)
  } catch {
    return false
  }
}
