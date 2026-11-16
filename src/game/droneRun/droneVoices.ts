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
 * | SNIPER | a low, steady sine hum with soft overtones, and a whine rising through each bolt's windup |
 * | HEAVY | a deep thrum: three low saws a few cents apart, beating, chopped at 9 Hz over a low rumble; a spin-up whine before a burst |
 * | SWARMER | a small chittering buzz (detuned triangles chopped by a fast saw LFO); every swarmer a little off the others, so a group is a cloud |
 *
 * One voice, from the drone to the ears:
 *
 *   3 oscillators + band-passed noise -> chop (LFO on its gain, and on the
 *   pitch) -> low-pass (brightness, and muffling behind a wall) <- whine
 *   -> level -> panner (HRTF on a desktop, equal power on a phone) -> bus
 *
 * - How loud is worked out here, not by the panner (its rolloff is 0, as
 *   hidden audio's is): an inverse law from `near` gibsons, fading to
 *   nothing at `reach` times the drone's detection range, so a drone is
 *   heard from past the fog.
 * - Behind a solid (the simulation's segmentClear from the eye to the
 *   drone), the low-pass closes and the level drops. A few voices are
 *   checked each update, in turn, never all every frame.
 * - Doppler: the pitch follows the closing speed (eye and drone both
 *   moving), clamped.
 * - The attack cue: closing in, and in an attack (a scout's dive, a
 *   sniper's or a heavy's windup and burst, a swarmer rushing in), a voice
 *   gets louder and brighter, and a scout's and a heavy's pitch rises, so
 *   the hit is heard coming.
 * - At most `cap` voices at once (fewer on a phone), the nearest winning; a
 *   voice already sounding keeps its place against one only a little nearer
 *   (lib/audioWorld PLAYING_MARGIN, hidden audio's own rule). Voices are a
 *   pool made once and reused: a new drone takes a slot whose last voice
 *   has faded; nothing is made per frame.
 * - Every change eases (setTargetAtTime), so nothing clicks.
 *
 * This module is the voices and their arithmetic; Voices.tsx runs them from
 * the canvas's frames and keeps the rules (no sound before a tap, the
 * mutes, the page hidden, the run paused).
 *
 * Ledger class (c), client: how drones sound is this client's own. The
 * numbers are the variant's `client.sounds` where it has them, else
 * DEFAULT_SOUNDS below.
 */

import type { DroneDef, Vec3, VoiceDef, VoiceSettings } from '../../lib/games/droneRun/types'
import { PLAYING_MARGIN } from '../../lib/audioWorld'

/* ---------- the data (types.ts: VoiceDef, VoiceSettings, ClientSounds) ---------- */

export type { VoiceDef, VoiceSettings }

export interface DroneRunSounds {
  voices: VoiceSettings
  kinds: Record<string, VoiceDef>
}

/** The sounds when the variant has none: client.sounds mirrors this shape (voices, and one entry per drone id). */
export const DEFAULT_SOUNDS: DroneRunSounds = {
  voices: {
    phone: 6, desktop: 10, reach: 1.5, near: 4, rolloff: 0.6, cueNear: 4, cueFar: 18,
    doppler: { c: 60, min: 0.85, max: 1.18 },
    occluded: { cutoff: 0.16, floor: 120, gain: 0.55 },
    checks: 3,
  },
  kinds: {
    scout: {
      base: 290,
      oscs: [{ wave: 'sawtooth', ratio: 1, mix: 0.55 }, { wave: 'triangle', ratio: 2, detune: 6, mix: 0.3 }, { wave: 'sine', ratio: 3, mix: 0.15 }],
      noise: { band: 2600, q: 1.5, mix: 0.2 },
      lfo: { rate: 46, amp: 0.35, pitch: 0, wave: 'sine' },
      filter: 2400, q: 1, gain: 0.065,
      spread: { cents: 25, rate: 0.1 },
      attack: { pitch: 700, gain: 1.5, bright: 2.2 },
    },
    sniper: {
      base: 72,
      oscs: [{ wave: 'sine', ratio: 1, mix: 0.6 }, { wave: 'triangle', ratio: 2, detune: 3, mix: 0.3 }, { wave: 'sine', ratio: 3, mix: 0.1 }],
      noise: { band: 240, q: 0.7, mix: 0.08 },
      lfo: { rate: 0.45, amp: 0.08, pitch: 4, wave: 'sine' },
      filter: 650, q: 0.7, gain: 0.09,
      spread: { cents: 8, rate: 0.1 },
      attack: { pitch: 0, gain: 1.5, bright: 3.4 },
      whine: { from: 380, to: 1900, gain: 0.5 },
    },
    heavy: {
      base: 46,
      oscs: [{ wave: 'sawtooth', ratio: 1, mix: 0.4 }, { wave: 'sawtooth', ratio: 1, detune: 34, mix: 0.33 }, { wave: 'sawtooth', ratio: 1, detune: -27, mix: 0.27 }],
      noise: { band: 160, q: 0.8, mix: 0.3 },
      lfo: { rate: 9, amp: 0.45, pitch: 0, wave: 'sine' },
      filter: 340, q: 1.2, gain: 0.11,
      spread: { cents: 6, rate: 0.08 },
      attack: { pitch: 200, gain: 1.6, bright: 2.4 },
      whine: { from: 110, to: 330, gain: 0.35 },
    },
    swarmer: {
      base: 540,
      oscs: [{ wave: 'triangle', ratio: 1, mix: 0.4 }, { wave: 'triangle', ratio: 1, detune: 18, mix: 0.35 }, { wave: 'sawtooth', ratio: 1.5, detune: -10, mix: 0.25 }],
      noise: { band: 4200, q: 2, mix: 0.1 },
      lfo: { rate: 27, amp: 0.7, pitch: 30, wave: 'sawtooth' },
      filter: 3800, q: 0.8, gain: 0.032,
      spread: { cents: 60, rate: 0.3 },
      attack: { pitch: 150, gain: 1.6, bright: 1.8 },
    },
  },
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d)

/**
 * The sounds of a variant: its `client.sounds` over DEFAULT_SOUNDS, field by
 * field, so a variant can change one number. A drone id with no entry, and
 * no default, is heard as a scout.
 */
export function soundsOf(client: unknown): DroneRunSounds {
  const given = isObj(client) && isObj(client.sounds) ? client.sounds : {}
  const gv = isObj(given.voices) ? given.voices : {}
  const dv = DEFAULT_SOUNDS.voices
  const voices: VoiceSettings = {
    phone: Math.max(1, Math.floor(num(gv.phone, dv.phone))),
    desktop: Math.max(1, Math.floor(num(gv.desktop, dv.desktop))),
    reach: num(gv.reach, dv.reach), near: Math.max(0.1, num(gv.near, dv.near)), rolloff: num(gv.rolloff, dv.rolloff),
    cueNear: num(gv.cueNear, dv.cueNear), cueFar: num(gv.cueFar, dv.cueFar),
    doppler: { ...dv.doppler, ...(isObj(gv.doppler) ? gv.doppler : {}) } as VoiceSettings['doppler'],
    occluded: { ...dv.occluded, ...(isObj(gv.occluded) ? gv.occluded : {}) } as VoiceSettings['occluded'],
    checks: Math.max(1, Math.floor(num(gv.checks, dv.checks))),
  }
  const kinds: Record<string, VoiceDef> = { ...DEFAULT_SOUNDS.kinds }
  for (const [id, v] of Object.entries(given)) {
    if (id === 'voices' || !isObj(v)) continue
    const base = DEFAULT_SOUNDS.kinds[id] ?? DEFAULT_SOUNDS.kinds.scout
    kinds[id] = { ...base, ...v } as VoiceDef
  }
  return { voices, kinds }
}

/* ---------- the arithmetic ---------- */

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x)
const smooth = (a: number, b: number, x: number): number => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }

/** How loud a drone `d` gibsons away is, 0..1: full within `near`, an inverse law beyond, fading to 0 from 70% of `reach` to `reach`. */
export function distanceGain(d: number, v: Pick<VoiceSettings, 'near' | 'rolloff'>, reach: number): number {
  if (!(d < reach)) return 0
  const inv = d <= v.near ? 1 : v.near / (v.near + v.rolloff * (d - v.near))
  return inv * (1 - smooth(reach * 0.7, reach, d))
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
  /** Added to every oscillator's own detune: the drone's spread, the Doppler and the attack's rise. */
  cents: number
  whineHz: number
  whineLevel: number
}

/** A voice's settings from where its drone is and what it does. */
export function voiceTargets(def: VoiceDef, v: VoiceSettings, s: { dist: number; reach: number; cue: number; act: number; charge: number; occluded: boolean; ratio: number; spreadCents: number }): VoiceTargets {
  const a = def.attack
  const level = def.gain * distanceGain(s.dist, v, s.reach) * (1 + (a.gain - 1) * s.cue) * (s.occluded ? v.occluded.gain : 1)
  const open = def.filter * (1 + (a.bright - 1) * s.cue)
  const cutoff = clamp(s.occluded ? Math.min(open, Math.max(open * v.occluded.cutoff, v.occluded.floor)) : open, 60, 18000)
  const cents = s.spreadCents + 1200 * Math.log2(s.ratio) + a.pitch * s.act
  const w = def.whine
  const whineHz = w ? w.from * Math.pow(w.to / w.from, s.charge) : 0
  const whineLevel = w && s.charge > 0 ? w.gain * (0.3 + 0.7 * s.charge) : 0
  return { level, cutoff, cents, whineHz, whineLevel }
}

/**
 * Which drones are heard: the nearest `cap` of those in reach, in order. One
 * already playing counts as PLAYING_MARGIN times nearer (hidden audio's
 * rule, lib/audioWorld), so two at about the same distance do not swap
 * back and forth; ties go by key.
 */
export function chooseVoices(cands: readonly { key: string; dist: number }[], playing: ReadonlySet<string>, cap: number): string[] {
  const score = (c: { key: string; dist: number }): number => c.dist / (playing.has(c.key) ? PLAYING_MARGIN : 1)
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

const NOISE_S = 2
const noiseBufs = new WeakMap<BaseAudioContext, AudioBuffer>()
/** Two seconds of white noise per context, looped (long enough that the loop is not heard). Seeded, so a recording renders the same. */
function noiseOf(ac: BaseAudioContext): AudioBuffer {
  let b = noiseBufs.get(ac)
  if (b) return b
  const len = Math.floor(ac.sampleRate * NOISE_S)
  b = ac.createBuffer(1, len, ac.sampleRate)
  const d = b.getChannelData(0)
  let s = 0x2545f491
  for (let i = 0; i < len; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1 }
  noiseBufs.set(ac, b)
  return b
}

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
  last: VoiceTargets = { level: 0, cutoff: 0, cents: 0, whineHz: 0, whineLevel: 0 }
  private def: VoiceDef | null = null
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
    this.noise.buffer = noiseOf(ac)
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
    this.last = g
    ease(this.level.gain, g.level, t, FADE_S)
    ease(this.tone.frequency, g.cutoff, t, this.occluded ? 0.12 : EASE_S)
    for (let i = 0; i < 3; i++) {
      const o = def.oscs[i]
      if (o) ease(this.oscs[i].detune, (o.detune ?? 0) + g.cents, t)
    }
    const k = Math.pow(2, g.cents / 1200)
    if (def.noise) ease(this.band.frequency, def.noise.band * k, t)
    if (def.whine) {
      ease(this.whine.frequency, g.whineHz * k, t, 0.03)
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
  private readonly cands: { key: string; dist: number; d: VoiceDrone }[] = []

  constructor(readonly sounds: DroneRunSounds, readonly phone: boolean) {
    this.cap = phone ? sounds.voices.phone : sounds.voices.desktop
    // A couple more than heard, so a newcomer need not wait for a fade.
    this.poolMax = this.cap + 2
  }

  /** The drones heard now, by key ("d" + id). */
  heard(): string[] {
    return this.slots.filter((s) => s.key !== null).map((s) => s.key as string)
  }

  /** One update at context time `t` into `out` (the game's bus). */
  frame(ac: BaseAudioContext, out: AudioNode, input: VoiceInput, t: number): void {
    if (this.ctx && this.ctx !== ac) this.dispose()
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
      const dist = Math.hypot(d.pos[0] - eye[0], d.pos[1] - eye[1], d.pos[2] - eye[2])
      if (dist >= v.reach * Math.max(1, d.def.detect)) continue
      const key = 'd' + d.id
      byKey.set(key, d)
      this.cands.push({ key, dist, d })
    }
    this.playing.clear()
    for (const s of this.slots) if (s.key) this.playing.add(s.key)
    const chosen = new Set(chooseVoices(this.cands, this.playing, this.cap))
    for (const s of this.slots) if (s.key && !chosen.has(s.key)) s.release(t)
    const fresh: VoiceSlot[] = []
    for (const key of chosen) {
      if (this.slots.some((s) => s.key === key)) continue
      let slot = this.slots.find((s) => s.key === null && t >= s.freeAt)
      if (!slot && this.slots.length < this.poolMax) { slot = new VoiceSlot(ac, out, this.phone, t); this.slots.push(slot) }
      if (!slot) continue
      const d = byKey.get(key) as VoiceDrone
      const kind = this.sounds.kinds[d.def.id] ? d.def.id : 'scout'
      slot.assign(key, kind, this.sounds.kinds[kind], d.id, t)
      fresh.push(slot)
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
      const def = this.sounds.kinds[s.kind as string]
      const dx = eye[0] - d.pos[0], dy = eye[1] - d.pos[1], dz = eye[2] - d.pos[2]
      const dist = Math.hypot(dx, dy, dz)
      const inv = dist > 1e-6 ? 1 / dist : 0
      // Closing speed: the drone's velocity toward the eye, less the eye's away from it.
      const closing = ((d.vel[0] - input.eyeVel[0]) * dx + (d.vel[1] - input.eyeVel[1]) * dy + (d.vel[2] - input.eyeVel[2]) * dz) * inv
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
    for (const s of gone) s.dispose(t)
    if (t !== undefined && gone.length) setTimeout(() => { for (const s of gone) s.part() }, (FREE_AFTER_S + 0.1) * 1000)
    this.slots.length = 0
    this.last = -Infinity
    this.ctx = null
  }
}
