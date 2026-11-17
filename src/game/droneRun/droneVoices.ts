/**
 * droneVoices.ts - every drone you can hear, where it flies: one looping,
 * synthesised voice per drone kind, placed in space, so a drone is heard
 * coming before it is seen and louder as it closes.
 *
 * All of it goes through the app's one audio plumbing (arkinox's ruling: one
 * audio context, never a second): the shared context (lib/audioContext), the
 * camera as the ears (store/useHiddenAudio audioListener and moveListener,
 * the same three.js listener hidden audio uses), and the game's own way out
 * (audio.ts gameBus), which its mutes close. No files: oscillators, a noise
 * buffer, filters and an LFO.
 *
 * | Kind | Its voice |
 * |---|---|
 * | SCOUT | a high, fast buzz (a saw and a triangle an octave up, chopped at 46 Hz, a little hiss) that bends up as it dives |
 * | SNIPER | a low, steady 72 Hz sine hum with a soft fifth partial (360 Hz) and a narrow hiss there, so a phone speaker carries it; a whine rising through each bolt's windup, fading on its top note |
 * | HEAVY | a deep thrum: two low saws a few cents apart, beating, and a triangle three octaves up beating against their overtones (the part a phone speaker plays), chopped at 9 Hz over a rotor wash; a spin-up whine before a burst |
 * | SWARMER | a small chittering buzz (detuned triangles chopped by a fast saw LFO); every swarmer a little off the others, so a group is a cloud |
 *
 * One voice, from the drone to the ears:
 *
 *   3 oscillators + band-passed noise -> chop (LFO on its gain, and on the
 *   pitch) -> low-pass (brightness, and muffling behind a wall) <- whine
 *   -> level -> panner (HRTF on a desktop, equal power on a phone) -> the
 *   voices' compressor -> the game's bus
 *
 * - How loud is worked out here, not by the panner (its rolloff is 0, as
 *   hidden audio's is): full out to `near` gibsons, a gentle inverse law
 *   beyond with a floor, fading to nothing at `reach` times the drone's
 *   detection range, so a drone is plainly heard coming from well past the
 *   fog (owner, phone test 2026-11-16).
 * - All the voices meet in one gentle compressor before the game's bus, so
 *   many distant drones together never clip or drown the guns.
 * - Behind a solid (the simulation's segmentClear from the eye to the
 *   drone), the low-pass closes and the level drops. A few voices are
 *   checked each update, in turn, never all every frame.
 * - Doppler: the pitch follows the closing speed (eye and drone both
 *   moving), clamped.
 * - The attack cue: closing in, and in an attack (a scout's dive, a
 *   sniper's or a heavy's windup and burst, a swarmer rushing in), a voice
 *   gets louder and brighter, and a scout's and a heavy's pitch rises, so
 *   the hit is heard coming.
 * - At most `cap` voices at once (fewer on a phone), the nearest winning,
 *   an attack under way counting as much nearer, so a warning is never the
 *   voice left out; a voice already sounding keeps its place against one
 *   only a little nearer (lib/audioWorld PLAYING_MARGIN, hidden audio's own
 *   rule), and keeps playing while the one that pushed it waits for a slot.
 *   Voices are a pool made once and reused: a new drone takes a slot whose
 *   last voice has faded; nothing is made per frame.
 * - The variant's sound data is checked field by field (finite, clamped,
 *   known waveforms), so bad data never throws mid-frame.
 * - Every change eases (setTargetAtTime), so nothing clicks; an attack's
 *   pitch rise eases slowly (a dive bends up), and a whine fades out on its
 *   last pitch.
 *
 * This module is the voices and their arithmetic; Voices.tsx runs them from
 * the canvas's frames and keeps the rules (no sound before a tap, the
 * mutes, the page hidden, the run paused).
 *
 * Ledger class (c), client: how drones sound is this client's own. The
 * numbers are the variant's `client.sounds` where it has them, else the
 * base variant's (DEFAULT_SOUNDS).
 */

import type { DroneDef, SoundWave, Vec3, VoiceDef, VoiceSettings } from '../../lib/games/droneRun/types'
import baseVariant from '../../lib/games/droneRun/variants/drone-run-base.json'
import { noiseBuffer } from './audio'
import { PLAYING_MARGIN } from '../../lib/audioWorld'

/* ---------- the data (types.ts: VoiceDef, VoiceSettings, ClientSounds) ---------- */

export type { VoiceDef, VoiceSettings }

export interface DroneRunSounds {
  voices: VoiceSettings
  kinds: Record<string, VoiceDef>
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
/** A finite number in [lo, hi], else `d`: bad data never reaches an AudioParam. */
const fin = (x: unknown, d: number, lo = -Infinity, hi = Infinity): number => clamp(typeof x === 'number' && Number.isFinite(x) ? x : d, lo, hi)
const WAVES: ReadonlySet<string> = new Set(['sine', 'triangle', 'sawtooth', 'square'])
const waveOf = (x: unknown, d: SoundWave): SoundWave => (typeof x === 'string' && WAVES.has(x) ? (x as SoundWave) : d)

/** The last resort, used only where even the base variant has no sounds: how voices behave, and a soft hum. */
const FALLBACK_SETTINGS: VoiceSettings = {
  phone: 6, desktop: 10, reach: 2, near: 11, rolloff: 0.35, farFloor: 0.3, mix: 0.22, cueNear: 4, cueFar: 18,
  doppler: { c: 60, min: 0.85, max: 1.18 },
  occluded: { cutoff: 0.16, floor: 260, gain: 0.55 },
  checks: 3,
}
const FALLBACK_VOICE: VoiceDef = { base: 200, oscs: [{ wave: 'sine', ratio: 1, mix: 1 }], filter: 1200, gain: 0.04, attack: { pitch: 0, gain: 1.5, bright: 2 } }

/** A nested part: the given object over the default's (or `blank` when the default has none), each field fixed; absent when neither has it. */
function part<T>(given: unknown, d: T | undefined, blank: T, fix: (g: Record<string, unknown>, d: T) => T): T | undefined {
  if (isObj(given)) return fix(given, d ?? blank)
  return d
}

/** One drone's voice: `g` over `d`, field by field and nested, every number finite and clamped, waves from the list. */
function voiceOf(g: unknown, d: VoiceDef): VoiceDef {
  const o = isObj(g) ? g : {}
  const oscs = Array.isArray(o.oscs) && o.oscs.length
    ? o.oscs.slice(0, 3).map((x, i) => {
      const b = d.oscs[i] ?? d.oscs[0] ?? FALLBACK_VOICE.oscs[0]
      const y = isObj(x) ? x : {}
      return { wave: waveOf(y.wave, b.wave), ratio: fin(y.ratio, b.ratio, 0.01, 64), detune: fin(y.detune, b.detune ?? 0, -2400, 2400), mix: fin(y.mix, b.mix, 0, 1) }
    })
    : d.oscs
  return {
    base: fin(o.base, d.base, 1, 20000),
    oscs,
    noise: part(o.noise, d.noise, { band: 1000, q: 1, mix: 0 }, (y, b) => ({ band: fin(y.band, b.band, 20, 20000), q: fin(y.q, b.q, 0.05, 50), mix: fin(y.mix, b.mix, 0, 1) })),
    lfo: part(o.lfo, d.lfo, { rate: 1, amp: 0, pitch: 0, wave: 'sine' as SoundWave }, (y, b) => ({ rate: fin(y.rate, b.rate, 0.01, 200), amp: fin(y.amp, b.amp, 0, 1), pitch: fin(y.pitch, b.pitch, -2400, 2400), wave: waveOf(y.wave, b.wave ?? 'sine') })),
    filter: fin(o.filter, d.filter, 40, 20000),
    q: fin(o.q, d.q ?? 0.7, 0.05, 50),
    gain: fin(o.gain, d.gain, 0, 1),
    spread: part(o.spread, d.spread, { cents: 0, rate: 0 }, (y, b) => ({ cents: fin(y.cents, b.cents, 0, 1200), rate: fin(y.rate, b.rate, 0, 1) })),
    attack: part(o.attack, d.attack, FALLBACK_VOICE.attack, (y, b) => ({ pitch: fin(y.pitch, b.pitch, -2400, 2400), gain: fin(y.gain, b.gain, 0, 8), bright: fin(y.bright, b.bright, 0.1, 16) })) ?? FALLBACK_VOICE.attack,
    whine: part(o.whine, d.whine, { from: 400, to: 1600, gain: 0 }, (y, b) => ({ from: fin(y.from, b.from, 20, 20000), to: fin(y.to, b.to, 20, 20000), gain: fin(y.gain, b.gain, 0, 1) })),
  }
}

/** How voices behave: `g` over `d`, nested, every number finite and clamped; cueFar always past cueNear. */
function settingsOf(g: unknown, d: VoiceSettings): VoiceSettings {
  const o = isObj(g) ? g : {}
  const dp = isObj(o.doppler) ? o.doppler : {}
  const oc = isObj(o.occluded) ? o.occluded : {}
  const cueNear = fin(o.cueNear, d.cueNear, 0, 1000)
  return {
    phone: Math.floor(fin(o.phone, d.phone, 1, 32)),
    desktop: Math.floor(fin(o.desktop, d.desktop, 1, 32)),
    reach: fin(o.reach, d.reach, 0.1, 10),
    near: fin(o.near, d.near, 0.1, 1000),
    rolloff: fin(o.rolloff, d.rolloff, 0, 10),
    farFloor: fin(o.farFloor, d.farFloor, 0, 1),
    mix: fin(o.mix, d.mix, 0, 2),
    cueNear,
    cueFar: Math.max(cueNear + 0.1, fin(o.cueFar, d.cueFar, 0, 1000)),
    doppler: { c: fin(dp.c, d.doppler.c, 1, 10000), min: fin(dp.min, d.doppler.min, 0.1, 1), max: fin(dp.max, d.doppler.max, 1, 10) },
    occluded: { cutoff: fin(oc.cutoff, d.occluded.cutoff, 0.01, 1), floor: fin(oc.floor, d.occluded.floor, 20, 20000), gain: fin(oc.gain, d.occluded.gain, 0, 1) },
    checks: Math.floor(fin(o.checks, d.checks, 1, 32)),
  }
}

/** The keys of client.sounds that are not a drone's voice (the controls' and the hits' sounds: clicks.ts). */
const NOT_DRONES: ReadonlySet<string> = new Set(['voices', 'ui', 'hit', 'kill', 'miss'])

function soundsFrom(given: unknown, d: DroneRunSounds): DroneRunSounds {
  const g = isObj(given) ? given : {}
  const kinds: Record<string, VoiceDef> = { ...d.kinds }
  for (const [id, v] of Object.entries(g)) {
    if (NOT_DRONES.has(id) || !isObj(v)) continue
    kinds[id] = voiceOf(v, d.kinds[id] ?? d.kinds.scout ?? FALLBACK_VOICE)
  }
  return { voices: settingsOf(g.voices, d.voices), kinds }
}

/** The base variant's sounds (its client.sounds): what a variant without its own, or a field left out, takes. */
export const DEFAULT_SOUNDS: DroneRunSounds = soundsFrom((baseVariant as { client?: { sounds?: unknown } }).client?.sounds, { voices: FALLBACK_SETTINGS, kinds: {} })

/**
 * The sounds of a variant: its `client.sounds` over the base variant's,
 * field by field and nested (a variant can change one number of an attack),
 * every number checked, so bad data never throws mid-frame or reaches an
 * AudioParam.
 */
export function soundsOf(client: unknown): DroneRunSounds {
  return soundsFrom(isObj(client) ? client.sounds : undefined, DEFAULT_SOUNDS)
}

/** The voice for a drone id: its own, else the scout's, else the last resort. */
export function voiceFor(sounds: DroneRunSounds, id: string): VoiceDef {
  return sounds.kinds[id] ?? sounds.kinds.scout ?? FALLBACK_VOICE
}

/* ---------- the arithmetic ---------- */

const smooth = (a: number, b: number, x: number): number => {
  if (!(b > a)) return x < a ? 0 : 1
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Where the fade at the edge of reach begins, as a share of reach. */
const EDGE_FROM = 0.85

/**
 * How loud a drone `d` gibsons away is, 0..1: full within `near`, a gentle
 * inverse law beyond, never under `farFloor` while in reach, fading to 0
 * over the last 15% of `reach`. So a drone at the fog's edge and well past
 * it is plainly heard, and the attack cue (louder and brighter, close) is
 * still the peak.
 */
export function distanceGain(d: number, v: Pick<VoiceSettings, 'near' | 'rolloff' | 'farFloor'>, reach: number): number {
  if (!(d < reach)) return 0
  const inv = d <= v.near ? 1 : v.near / (v.near + v.rolloff * (d - v.near))
  return Math.max(inv, v.farFloor) * (1 - smooth(reach * EDGE_FROM, reach, d))
}

/** The pitch ratio for a source closing at `closing` gibsons a second (negative: going away), clamped. */
export function dopplerRatio(closing: number, d: VoiceSettings['doppler']): number {
  const c = Math.max(1, d.c)
  const r = c / Math.max(c * 0.25, c - closing)
  return clamp(r, d.min, d.max)
}

/** What the attack cue reads of a drone. */
export interface CueFacts {
  dist: number
  /** The drone's def: its behaviour and attack decide which attack counts. */
  def: Pick<DroneDef, 'behaviour' | 'speed' | 'attack'>
  mode: string
  /** Seconds of windup left, or -1. */
  windup: number
  burstLeft: number
  /** Closing speed, gibsons a second (positive: coming at you). */
  closing: number
}

/**
 * The attack cue, 0..1: `cue` (how much louder and brighter), `act` (the
 * attack itself, which also raises the pitch) and `charge` (a windup's
 * progress, for the whine). Closeness alone gives up to 0.6 of the cue; an
 * attack gives all of it.
 */
export function attackCue(f: CueFacts, v: Pick<VoiceSettings, 'cueNear' | 'cueFar'>): { cue: number; act: number; charge: number } {
  const close = 1 - smooth(v.cueNear, v.cueFar, f.dist)
  let act = 0, charge = 0
  if (f.def.behaviour === 'dive') {
    act = f.mode === 'dive' ? 1 : f.mode === 'pullup' ? 0.3 : 0
  } else if (f.def.attack.kind === 'shot') {
    const w = f.def.attack.shot?.windupS ?? 0
    if (f.windup >= 0 && w > 0) { charge = clamp(1 - f.windup / w, 0, 1); act = charge }
    if (f.burstLeft > 0) act = 1
  } else {
    // A contact attack without a dive (a swarmer): rushing in, close.
    act = clamp(f.closing / Math.max(1, f.def.speed), 0, 1) * (1 - smooth(4, 14, f.dist))
  }
  return { cue: Math.max(0.6 * close, act), act, charge }
}

/** What a voice is set to this update. */
export interface VoiceTargets {
  level: number
  cutoff: number
  /** Added to every oscillator's own detune: the drone's spread and the Doppler. */
  cents: number
  /** The attack's pitch rise, cents (a dive, a windup): eased slowly, so it bends rather than steps. */
  rise: number
  whineHz: number
  whineLevel: number
}

/** A voice's settings from where its drone is and what it does. */
export function voiceTargets(def: VoiceDef, v: VoiceSettings, s: { dist: number; reach: number; cue: number; act: number; charge: number; occluded: boolean; ratio: number; spreadCents: number }): VoiceTargets {
  const a = def.attack
  const level = def.gain * distanceGain(s.dist, v, s.reach) * (1 + (a.gain - 1) * s.cue) * (s.occluded ? v.occluded.gain : 1)
  const open = def.filter * (1 + (a.bright - 1) * s.cue)
  const cutoff = clamp(s.occluded ? Math.min(open, Math.max(open * v.occluded.cutoff, v.occluded.floor)) : open, 60, 18000)
  const cents = s.spreadCents + 1200 * Math.log2(s.ratio)
  const rise = a.pitch * s.act
  const w = def.whine
  const whineHz = w ? w.from * Math.pow(w.to / w.from, s.charge) : 0
  const whineLevel = w && s.charge > 0 ? w.gain * (0.3 + 0.7 * s.charge) : 0
  return { level, cutoff, cents, rise, whineHz, whineLevel }
}

/** How much nearer an attack counts per unit of urgency: a dive or a windup (urgency at least 0.5) counts five times nearer. */
export const URGENCY = 8

/**
 * Which drones are heard: the nearest `cap` of those in reach, in order,
 * an attack counting as nearer (distance / (1 + URGENCY x urgency)), so a
 * sniper's whine or a diving scout keeps its voice over a nearby idle
 * swarm. One already playing counts as PLAYING_MARGIN times nearer (hidden
 * audio's rule, lib/audioWorld), so two at about the same distance do not
 * swap back and forth; ties go by key.
 */
export function chooseVoices(cands: readonly { key: string; dist: number; act: number }[], playing: ReadonlySet<string>, cap: number): string[] {
  const score = (c: { key: string; dist: number; act: number }): number => c.dist / (1 + URGENCY * c.act) / (playing.has(c.key) ? PLAYING_MARGIN : 1)
  return cands.slice().sort((a, b) => score(a) - score(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, Math.max(0, cap)).map((c) => c.key)
}

/** A drone's own 0..1, the same every time for its id (its spread). */
export function idShare(id: number, salt = 0): number {
  let h = (Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) + Math.imul(salt + 1, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/* ---------- the voices ---------- */

/** A drone as the voices read it: positions region-local gibsons (the simulation's), drawn between steps. */
export interface VoiceDrone {
  id: number
  def: DroneDef
  pos: Vec3
  vel: Vec3
  mode: string
  windup: number
  burstLeft: number
}

/** One update's facts. */
export interface VoiceInput {
  eye: Vec3
  eyeVel: Vec3
  drones: readonly VoiceDrone[]
  /** The run is paused (a card up): every voice fades to silence and keeps its drone. */
  paused: boolean
  /** Whether nothing solid lies between two points (sim segmentClear on the run's solids). */
  clear: (from: Vec3, to: Vec3) => boolean
}

/** Seconds of the easing on every change, and a fade in or out. */
const EASE_S = 0.05
const FADE_S = 0.09
/** A released slot is free again after this long: its voice has faded. */
const FREE_AFTER_S = 0.45
/** The voices update at most this often, seconds. */
const UPDATE_S = 1 / 30
/** The voices' compressor: dB, dB, ratio, seconds, seconds. */
const COMP = { threshold: -24, knee: 12, ratio: 4, attack: 0.01, release: 0.25 }
/** The attack's pitch rise eases over this, seconds: a bend, not a step. */
const RISE_S = 0.25

function ease(p: AudioParam, v: number, t: number, tc = EASE_S): void {
  p.setTargetAtTime(v, t, tc)
}

/** One voice's nodes, made once and reused for drone after drone. */
export class VoiceSlot {
  key: string | null = null
  kind: string | null = null
  /** The context time after which this slot may take a new drone. */
  freeAt = 0
  occluded = false
  /** What it was last set to (for tests and the debug view). */
  last: VoiceTargets = { level: 0, cutoff: 0, cents: 0, rise: 0, whineHz: 0, whineLevel: 0 }
  private def: VoiceDef | null = null
  /** The voice it plays now. */
  get voice(): VoiceDef | null { return this.def }
  private readonly oscs: OscillatorNode[] = []
  private readonly mixes: GainNode[] = []
  private readonly noise: AudioBufferSourceNode
  private readonly band: BiquadFilterNode
  private readonly noiseMix: GainNode
  private readonly body: GainNode
  private readonly lfo: OscillatorNode
  private readonly lfoAmp: GainNode
  private readonly lfoPitch: GainNode
  private readonly tone: BiquadFilterNode
  private readonly whine: OscillatorNode
  private readonly whineMix: GainNode
  private readonly level: GainNode
  readonly panner: PannerNode
  private readonly nodes: AudioNode[] = []
  private readonly sources: AudioScheduledSourceNode[] = []

  constructor(ac: BaseAudioContext, out: AudioNode, phone: boolean, t: number) {
    const keep = <N extends AudioNode>(n: N): N => { this.nodes.push(n); return n }
    this.body = keep(ac.createGain())
    for (let i = 0; i < 3; i++) {
      const o = keep(ac.createOscillator())
      const m = keep(ac.createGain())
      m.gain.value = 0
      o.connect(m)
      m.connect(this.body)
      this.oscs.push(o)
      this.mixes.push(m)
    }
    this.noise = keep(ac.createBufferSource())
    this.noise.buffer = noiseBuffer(ac)
    this.noise.loop = true
    this.band = keep(ac.createBiquadFilter())
    this.band.type = 'bandpass'
    this.noiseMix = keep(ac.createGain())
    this.noiseMix.gain.value = 0
    this.noise.connect(this.band)
    this.band.connect(this.noiseMix)
    this.noiseMix.connect(this.body)
    // The chop: the body's gain sits at 1 - amp/2 and the LFO swings it by amp/2.
    this.lfo = keep(ac.createOscillator())
    this.lfoAmp = keep(ac.createGain())
    this.lfoPitch = keep(ac.createGain())
    this.lfoAmp.gain.value = 0
    this.lfoPitch.gain.value = 0
    this.lfo.connect(this.lfoAmp)
    this.lfoAmp.connect(this.body.gain)
    this.lfo.connect(this.lfoPitch)
    for (const o of this.oscs) this.lfoPitch.connect(o.detune)
    this.tone = keep(ac.createBiquadFilter())
    this.tone.type = 'lowpass'
    this.body.connect(this.tone)
    this.whine = keep(ac.createOscillator())
    this.whine.type = 'sine'
    this.whineMix = keep(ac.createGain())
    this.whineMix.gain.value = 0
    this.whine.connect(this.whineMix)
    this.whineMix.connect(this.tone)
    this.level = keep(ac.createGain())
    this.level.gain.value = 0
    this.tone.connect(this.level)
    this.panner = keep(ac.createPanner())
    this.panner.panningModel = phone ? 'equalpower' : 'HRTF'
    // How loud is the level's (distanceGain), as hidden audio's world voices do it: the panner only places.
    this.panner.distanceModel = 'inverse'
    this.panner.refDistance = 1
    this.panner.rolloffFactor = 0
    this.level.connect(this.panner)
    this.panner.connect(out)
    for (const s of [...this.oscs, this.noise, this.lfo, this.whine]) { s.start(t); this.sources.push(s) }
  }

  /** Take a drone: its kind's sound, its own spread; silent until the next update sets its level. */
  assign(key: string, kind: string, def: VoiceDef, id: number, t: number): void {
    this.key = key
    this.def = def
    this.kind = kind
    this.occluded = false
    const spreadRate = def.spread ? 1 + (idShare(id, 1) * 2 - 1) * def.spread.rate : 1
    for (let i = 0; i < 3; i++) {
      const o = def.oscs[i]
      if (o) {
        if (this.oscs[i].type !== o.wave) this.oscs[i].type = o.wave
        this.oscs[i].frequency.setValueAtTime(def.base * o.ratio, t)
      }
      this.mixes[i].gain.setValueAtTime(o ? o.mix : 0, t)
    }
    const n = def.noise
    this.noiseMix.gain.setValueAtTime(n ? n.mix : 0, t)
    if (n) { this.band.frequency.setValueAtTime(n.band, t); this.band.Q.setValueAtTime(n.q, t) }
    const l = def.lfo
    if (l) {
      if (this.lfo.type !== (l.wave ?? 'sine')) this.lfo.type = l.wave ?? 'sine'
      this.lfo.frequency.setValueAtTime(l.rate * spreadRate, t)
    }
    const amp = l ? clamp(l.amp, 0, 1) : 0
    this.body.gain.setValueAtTime(1 - amp / 2, t)
    this.lfoAmp.gain.setValueAtTime(amp / 2, t)
    this.lfoPitch.gain.setValueAtTime(l ? l.pitch : 0, t)
    this.tone.Q.setValueAtTime(def.q ?? 0.7, t)
    this.whineMix.gain.setValueAtTime(0, t)
  }

  /** This update's settings, eased in; the drone at `at` in the render frame. */
  set(g: VoiceTargets, at: { x: number; y: number; z: number }, t: number): void {
    const def = this.def
    if (!def) return
    const was = this.last
    this.last = g
    ease(this.level.gain, g.level, t, FADE_S)
    ease(this.tone.frequency, g.cutoff, t, this.occluded ? 0.12 : EASE_S)
    // The spread and the Doppler on the detune, quick; the attack's rise on the pitch itself, slow, so a dive bends up.
    const up = Math.pow(2, g.rise / 1200)
    for (let i = 0; i < 3; i++) {
      const o = def.oscs[i]
      if (!o) continue
      ease(this.oscs[i].detune, (o.detune ?? 0) + g.cents, t)
      ease(this.oscs[i].frequency, def.base * o.ratio * up, t, RISE_S)
    }
    const k = Math.pow(2, g.cents / 1200) * up
    if (def.noise) ease(this.band.frequency, def.noise.band * k, t)
    if (def.whine) {
      // A whine starts at its first pitch, glides up with the charge, and fades out holding its last pitch: no chirp down.
      if (g.whineLevel > 0) {
        if (was.whineLevel > 0) ease(this.whine.frequency, g.whineHz * k, t, 0.03)
        else this.whine.frequency.setValueAtTime(g.whineHz * k, t)
      } else g.whineHz = was.whineHz
      ease(this.whineMix.gain, g.whineLevel, t, 0.04)
    }
    const p = this.panner
    if (p.positionX) {
      ease(p.positionX, at.x, t, 0.03)
      ease(p.positionY, at.y, t, 0.03)
      ease(p.positionZ, at.z, t, 0.03)
    } else {
      (p as unknown as { setPosition: (x: number, y: number, z: number) => void }).setPosition(at.x, at.y, at.z)
    }
  }

  /** Fade to silence, keeping the drone (a pause). */
  hush(t: number): void {
    ease(this.level.gain, 0, t, FADE_S)
    ease(this.whineMix.gain, 0, t, FADE_S)
    this.last = { ...this.last, level: 0, whineLevel: 0 }
  }

  /** Let the drone go: fade out; the slot is free once the fade is done. */
  release(t: number): void {
    this.hush(t)
    this.key = null
    this.freeAt = t + FREE_AFTER_S
  }

  /**
   * Stop every source and part every node. With `t`, the voice fades out
   * first and stops at `t` plus a fade; `part` is then called once it is
   * silent, to part the nodes (a timer the caller owns). Without, at once.
   */
  dispose(t?: number): void {
    this.key = null
    if (t === undefined) {
      for (const s of this.sources) { try { s.stop() } catch { /* stopped */ } }
      this.part()
      return
    }
    this.hush(t)
    for (const s of this.sources) { try { s.stop(t + FREE_AFTER_S) } catch { /* stopped */ } }
  }

  /** Part every node from the graph. */
  part(): void {
    for (const n of this.nodes) { try { n.disconnect() } catch { /* apart */ } }
  }
}

const panAt = { x: 0, y: 0, z: 0 }

/** Every drone voice of one run on screen. */
export class DroneVoices {
  readonly cap: number
  readonly slots: VoiceSlot[] = []
  private readonly poolMax: number
  private last = -Infinity
  private turn = 0
  private ctx: BaseAudioContext | null = null
  private readonly playing = new Set<string>()
  private readonly cands: { key: string; dist: number; act: number; d: VoiceDrone }[] = []
  /** Where every voice meets: one compressor into the game's bus, made with the first voice. */
  private mix: { comp: DynamicsCompressorNode; trim: GainNode; to: AudioNode } | null = null

  constructor(readonly sounds: DroneRunSounds, readonly phone: boolean) {
    this.cap = phone ? sounds.voices.phone : sounds.voices.desktop
    // A couple more than heard, so a newcomer need not wait for a fade.
    this.poolMax = this.cap + 2
  }

  /** The drones heard now, by key ("d" + id). */
  heard(): string[] {
    return this.slots.filter((s) => s.key !== null).map((s) => s.key as string)
  }

  /**
   * The voices' compressor into `out`, made once per pool: gentle (4:1 over
   * -24 dB, soft knee), so a crowd of drones sits under the guns. Web Audio's
   * compressor adds its own make-up gain, so a trim after it (voices.mix)
   * sets the level of all the voices together.
   */
  private mixOf(ac: BaseAudioContext, out: AudioNode): AudioNode {
    if (this.mix && this.mix.to === out) return this.mix.comp
    const comp = ac.createDynamicsCompressor()
    comp.threshold.value = COMP.threshold
    comp.knee.value = COMP.knee
    comp.ratio.value = COMP.ratio
    comp.attack.value = COMP.attack
    comp.release.value = COMP.release
    const trim = ac.createGain()
    trim.gain.value = this.sounds.voices.mix
    comp.connect(trim)
    trim.connect(out)
    this.mix = { comp, trim, to: out }
    return comp
  }

  /** Closing speed: the drone's velocity toward the eye, less the eye's away from it, gibsons a second. */
  private closing(d: VoiceDrone, eyeVel: Vec3, dx: number, dy: number, dz: number, dist: number): number {
    const inv = dist > 1e-6 ? 1 / dist : 0
    return ((d.vel[0] - eyeVel[0]) * dx + (d.vel[1] - eyeVel[1]) * dy + (d.vel[2] - eyeVel[2]) * dz) * inv
  }

  /** One update at context time `t` into `out` (the game's bus). */
  frame(ac: BaseAudioContext, out: AudioNode, input: VoiceInput, t: number): void {
    // A new context, or a new bus: every voice and the old compressor and trim are parted, and made again on the new one.
    if ((this.ctx && this.ctx !== ac) || (this.mix && this.mix.to !== out)) this.dispose()
    this.ctx = ac
    if (t - this.last < UPDATE_S - 1e-6 && t >= this.last) return
    this.last = t
    if (input.paused) {
      for (const s of this.slots) if (s.key) s.hush(t)
      return
    }
    const v = this.sounds.voices
    const eye = input.eye
    const byKey = new Map<string, VoiceDrone>()
    this.cands.length = 0
    for (const d of input.drones) {
      const dx = eye[0] - d.pos[0], dy = eye[1] - d.pos[1], dz = eye[2] - d.pos[2]
      const dist = Math.hypot(dx, dy, dz)
      if (dist >= v.reach * Math.max(1, d.def.detect)) continue
      const key = 'd' + d.id
      byKey.set(key, d)
      const closing = this.closing(d, input.eyeVel, dx, dy, dz, dist)
      const cue = attackCue({ dist, def: d.def, mode: d.mode, windup: d.windup, burstLeft: d.burstLeft, closing }, v)
      // An attack under way is at least half urgent from its first moment, so its warning is never the one left out.
      const attacking = d.windup >= 0 || d.burstLeft > 0 || (d.def.behaviour === 'dive' && d.mode === 'dive')
      this.cands.push({ key, dist, act: attacking ? Math.max(0.5, cue.act) : cue.act, d })
    }
    this.playing.clear()
    for (const s of this.slots) if (s.key) this.playing.add(s.key)
    const chosen = chooseVoices(this.cands, this.playing, this.cap)
    const chosenSet = new Set(chosen)
    const fresh: VoiceSlot[] = []
    let waiting = 0
    for (const key of chosen) {
      if (this.playing.has(key)) continue
      let slot = this.slots.find((s) => s.key === null && t >= s.freeAt)
      if (!slot && this.slots.length < this.poolMax) { slot = new VoiceSlot(ac, this.mixOf(ac, out), this.phone, t); this.slots.push(slot) }
      if (!slot) { waiting++; continue }
      const d = byKey.get(key) as VoiceDrone
      slot.assign(key, d.def.id, voiceFor(this.sounds, d.def.id), d.id, t)
      fresh.push(slot)
    }
    // A voice pushed out keeps playing while the one that pushed it has no slot yet: never fewer heard than there could be.
    const rank = new Map(this.cands.map((c) => [c.key, c.dist / (1 + URGENCY * c.act)]))
    const out2 = this.slots.filter((s) => s.key !== null && !chosenSet.has(s.key) && !fresh.includes(s))
      .sort((a, b) => (rank.get(a.key as string) ?? Infinity) - (rank.get(b.key as string) ?? Infinity))
    for (const s of out2) {
      if (waiting > 0 && byKey.has(s.key as string)) { waiting--; continue }
      s.release(t)
    }
    // Walls: every new voice at once, then a few more in turn.
    const active = this.slots.filter((s) => s.key !== null)
    for (const s of fresh) s.occluded = !input.clear(eye, (byKey.get(s.key as string) as VoiceDrone).pos)
    for (let k = 0, n = Math.min(v.checks, active.length); k < n; k++) {
      const s = active[(this.turn + k) % active.length]
      if (fresh.includes(s)) continue
      s.occluded = !input.clear(eye, (byKey.get(s.key as string) as VoiceDrone).pos)
    }
    this.turn = active.length ? (this.turn + v.checks) % active.length : 0
    for (const s of active) {
      const d = byKey.get(s.key as string) as VoiceDrone
      const def = s.voice as VoiceDef
      const dx = eye[0] - d.pos[0], dy = eye[1] - d.pos[1], dz = eye[2] - d.pos[2]
      const dist = Math.hypot(dx, dy, dz)
      const closing = this.closing(d, input.eyeVel, dx, dy, dz, dist)
      const cue = attackCue({ dist, def: d.def, mode: d.mode, windup: d.windup, burstLeft: d.burstLeft, closing }, v)
      const spreadCents = def.spread ? (idShare(d.id) * 2 - 1) * def.spread.cents : 0
      const g = voiceTargets(def, v, { dist, reach: v.reach * Math.max(1, d.def.detect), ...cue, occluded: s.occluded, ratio: dopplerRatio(closing, v.doppler), spreadCents })
      // The render frame (frame.ts toRender): z flipped.
      panAt.x = d.pos[0]; panAt.y = d.pos[1]; panAt.z = -d.pos[2]
      s.set(g, panAt, t)
    }
  }

  /**
   * Stop and part every voice (the screen gone, the page hidden, the
   * mutes); the pool is made again when next needed. With `t` (context
   * time), each fades out first and its nodes are parted once silent;
   * without, at once.
   */
  dispose(t?: number): void {
    const gone = this.slots.slice()
    const mix = this.mix
    this.mix = null
    for (const s of gone) s.dispose(t)
    const part = (): void => {
      for (const s of gone) s.part()
      try { mix?.comp.disconnect(); mix?.trim.disconnect() } catch { /* apart */ }
    }
    // At once, each voice parted itself; the compressor goes with it. Faded, all of it once silent.
    if (t === undefined) { try { mix?.comp.disconnect(); mix?.trim.disconnect() } catch { /* apart */ } } else if (gone.length || mix) setTimeout(part, (FREE_AFTER_S + 0.1) * 1000)
    this.slots.length = 0
    this.last = -Infinity
    this.ctx = null
  }
}
