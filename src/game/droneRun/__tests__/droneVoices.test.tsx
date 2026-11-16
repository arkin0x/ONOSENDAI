/**
 * droneVoices.test.tsx - the drones' spatial voices (game/droneRun/
 * droneVoices.ts, Voices.tsx): the nearest few are heard, an attack never
 * loses its voice, with a margin so they do not flicker; the pool is made
 * once and reused; loudness falls with distance and carries past the fog; a
 * wall muffles; an attack is louder and brighter; Doppler follows the
 * closing speed and is clamped; bad sound data falls back field by field;
 * nothing is made before the browser lets sound out, or while the game's
 * switch or MUTE ALL is on; and every voice fades, stops and is parted when
 * the screen goes or the page hides. A stand-in context counts every node
 * and records every parameter call by kind, and catches any call scheduled
 * in the past.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

/* ---------- a stand-in context ---------- */

type Call = { kind: 'set' | 'target' | 'linear' | 'exp'; value: number; time: number }
interface FakeParam { value: number; calls: Call[]; setTargetAtTime: (v: number, t: number) => void; setValueAtTime: (v: number, t: number) => void; linearRampToValueAtTime: (v: number, t: number) => void; exponentialRampToValueAtTime: (v: number, t: number) => void }
const made = { nodes: 0, sources: 0, stopped: 0, parted: 0, past: [] as string[] }
let clock = { now: 0 }
function param(v = 0): FakeParam {
  const p: FakeParam = {
    value: v, calls: [],
    setTargetAtTime: (x, t) => rec('target', x, t), setValueAtTime: (x, t) => rec('set', x, t),
    linearRampToValueAtTime: (x, t) => rec('linear', x, t), exponentialRampToValueAtTime: (x, t) => rec('exp', x, t),
  }
  function rec(kind: Call['kind'], x: number, t: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(t)) made.past.push(`${kind} not finite ${x} @ ${t}`)
    if (t < clock.now - 1e-9) made.past.push(`${kind} ${x} at ${t}, before now ${clock.now}`)
    p.calls.push({ kind, value: x, time: t })
    p.value = x
  }
  return p
}
function node(extra: Record<string, unknown> = {}): Record<string, unknown> {
  made.nodes++
  return {
    connect: () => {}, disconnect: () => { made.parted++ },
    gain: param(1), frequency: param(440), detune: param(0), Q: param(1), type: 'sine',
    positionX: param(), positionY: param(), positionZ: param(),
    ...extra,
  }
}
function source(): Record<string, unknown> {
  made.sources++
  return node({ start: () => {}, stop: (t?: number) => { made.stopped++; if (t !== undefined && t < clock.now - 1e-9) made.past.push(`stop at ${t}`) }, buffer: null, loop: false })
}
function fakeContext(): BaseAudioContext {
  return {
    state: 'running', get currentTime() { return clock.now }, sampleRate: 8000, destination: {},
    createGain: () => node(), createBiquadFilter: () => node(), createPanner: () => node(),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createOscillator: () => source(), createBufferSource: () => source(),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    resume: () => Promise.resolve(),
  } as unknown as BaseAudioContext
}

/* ---------- the app's plumbing and React, stood in ---------- */

const h = vi.hoisted(() => ({
  running: false, ctx: null as BaseAudioContext | null, contextCalls: 0, listenerMoves: 0,
  effects: [] as Array<() => void | (() => void)>,
  frameCb: null as ((s: { camera: unknown }) => void) | null,
}))
vi.mock('../../../lib/audioContext', () => ({
  audioContext: () => { h.contextCalls++; return h.ctx },
  audioRunning: () => h.running,
  wantSound: () => {},
}))
vi.mock('../../../store/useHiddenAudio', () => ({
  audioListener: () => ({}),
  moveListener: () => { h.listenerMoves++ },
}))
vi.mock('../../../lib/soundMuteDb', () => ({
  openSoundMuteDb: () => Promise.reject(new Error('none here')),
  putMasterMute: async () => {},
  putTrackMute: async () => {},
  readSoundMutes: async () => ({ tracks: [], master: false }),
}))
vi.mock('@react-three/fiber', () => ({ useFrame: (cb: (s: { camera: unknown }) => void) => { h.frameCb = cb } }))
vi.mock('react', async (orig) => ({
  ...(await orig<typeof import('react')>()),
  useMemo: <T,>(f: () => T) => f(),
  useEffect: (f: () => void | (() => void)) => { h.effects.push(f) },
}))

import {
  DEFAULT_SOUNDS, DroneVoices, attackCue, chooseVoices, distanceGain, dopplerRatio, soundsOf, voiceTargets,
  type VoiceDrone, type VoiceInput,
} from '../droneVoices'
import { Voices, setVoiceTap } from '../Voices'
import { resetSoundsForTests, useDroneRunSound } from '../audio'
import { useSoundMutes } from '../../../store/useSoundMutes'
import base from '../../../lib/games/droneRun/variants/drone-run-base.json'
import type { DroneDef, Vec3 } from '../../../lib/games/droneRun/types'
import { buildSolids } from '../../../lib/games/droneRun/sim'
import type { DroneRunView } from '../view'

const enemies = (base as unknown as { spec: { enemies: DroneDef[] } }).spec.enemies
const def = (id: string): DroneDef => enemies.find((e) => e.id === id) as DroneDef
const V = DEFAULT_SOUNDS.voices
const OUT = {} as AudioNode

function drone(id: number, kind: string, pos: Vec3, extra: Partial<VoiceDrone> = {}): VoiceDrone {
  return { id, def: def(kind), pos, vel: [0, 0, 0], mode: 'hunt', windup: -1, burstLeft: 0, ...extra }
}
function input(drones: VoiceDrone[], clear: VoiceInput['clear'] = () => true): VoiceInput {
  return { eye: [0, 0, 0], eyeVel: [0, 0, 0], drones, paused: false, clear }
}

beforeEach(() => {
  made.nodes = 0; made.sources = 0; made.stopped = 0; made.parted = 0; made.past = []
  clock = { now: 0 }
  h.running = false; h.ctx = null; h.contextCalls = 0; h.listenerMoves = 0
  resetSoundsForTests()
  useDroneRunSound.setState({ muted: false })
  useSoundMutes.setState({ master: false })
})
afterEach(() => {
  // No parameter change, ramp or stop is ever scheduled before the context's now, and none is not finite.
  expect(made.past).toEqual([])
  vi.useRealTimers()
})

describe('which drones are heard', () => {
  it('the nearest win, up to the cap', () => {
    const c = [{ key: 'a', dist: 30, act: 0 }, { key: 'b', dist: 5, act: 0 }, { key: 'c', dist: 12, act: 0 }, { key: 'd', dist: 50, act: 0 }]
    expect(chooseVoices(c, new Set(), 2)).toEqual(['b', 'c'])
  })

  it('one already heard keeps its place against one only a little nearer, not against one much nearer', () => {
    const playing = new Set(['far'])
    expect(chooseVoices([{ key: 'far', dist: 10.5, act: 0 }, { key: 'new', dist: 10, act: 0 }], playing, 1)).toEqual(['far'])
    expect(chooseVoices([{ key: 'far', dist: 10.5, act: 0 }, { key: 'new', dist: 8, act: 0 }], playing, 1)).toEqual(['new'])
  })

  it('an attack never loses its voice to a nearby idle swarm: a winding-up sniper and a diving scout are heard', () => {
    const one = soundsOf({ sounds: { voices: { desktop: 1 } } })
    const swarm = [drone(1, 'swarmer', [0, 2, -8]), drone(2, 'swarmer', [1, 2, -8.5]), drone(3, 'swarmer', [-1, 2, -9])]
    const sniper = new DroneVoices(one, false)
    sniper.frame(fakeContext(), OUT, input([...swarm, drone(9, 'sniper', [0, 12, -30], { windup: 0.79 })]), 0)
    expect(sniper.heard()).toEqual(['d9'])
    const scout = new DroneVoices(one, false)
    scout.frame(fakeContext(), OUT, input([...swarm, drone(9, 'scout', [0, 8, -40], { mode: 'dive' })]), 0)
    expect(scout.heard()).toEqual(['d9'])
    // Idle, the same sniper loses to the swarm.
    const idle = new DroneVoices(one, false)
    idle.frame(fakeContext(), OUT, input([...swarm, drone(9, 'sniper', [0, 12, -30])]), 0)
    expect(idle.heard()).not.toContain('d9')
  })

  it('a voice pushed out keeps playing until the drone that pushed it has a slot', () => {
    // A cap of 1 and a pool of 3: fill the pool with fading voices, then bring a nearer drone.
    const one = soundsOf({ sounds: { voices: { desktop: 1 } } })
    const v = new DroneVoices(one, false)
    const ac = fakeContext()
    for (const [i, z] of [[1, -10], [2, -9], [3, -8]] as const) {
      v.frame(ac, OUT, input([drone(i, 'heavy', [0, 4, z])]), clock.now)
      clock.now += 0.04
    }
    expect(v.slots.length).toBe(3)
    expect(v.heard()).toEqual(['d3'])
    // Every other slot is still fading (not free), so the newcomer at 5 has nowhere to go: d3 plays on.
    v.frame(ac, OUT, input([drone(3, 'heavy', [0, 4, -8]), drone(4, 'heavy', [0, 4, -5])]), clock.now)
    expect(v.heard()).toEqual(['d3'])
    expect(v.slots.find((s) => s.key === 'd3')?.last.level).toBeGreaterThan(0)
    // Once a slot is free, the newcomer takes it and d3 lets go.
    clock.now += 1
    v.frame(ac, OUT, input([drone(3, 'heavy', [0, 4, -8]), drone(4, 'heavy', [0, 4, -5])]), clock.now)
    expect(v.heard()).toEqual(['d4'])
  })

  it('a dive bends the pitch up slowly, and a whine fades out holding its last pitch (no chirp down)', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const ac = fakeContext()
    v.frame(ac, OUT, input([drone(1, 'sniper', [0, 10, -20], { windup: 0.1 })]), 0)
    const held = v.slots[0].last.whineHz
    expect(held).toBeGreaterThan(DEFAULT_SOUNDS.kinds.sniper.whine?.from as number)
    clock.now = 0.1
    v.frame(ac, OUT, input([drone(1, 'sniper', [0, 10, -20], { windup: -1 })]), clock.now)
    expect(v.slots[0].last.whineLevel).toBe(0)
    expect(v.slots[0].last.whineHz).toBe(held)
    const scout = new DroneVoices(DEFAULT_SOUNDS, false)
    clock.now = 0
    scout.frame(fakeContext(), OUT, input([drone(2, 'scout', [0, 5, -20], { mode: 'dive' })]), 0)
    expect(scout.slots[0].last.rise).toBe(DEFAULT_SOUNDS.kinds.scout.attack.pitch)
  })

  it('the cap is fewer on a phone', () => {
    expect(new DroneVoices(DEFAULT_SOUNDS, true).cap).toBe(6)
    expect(new DroneVoices(DEFAULT_SOUNDS, false).cap).toBe(10)
  })

  it('the pool is made once and reused as drones come and go: no nodes made per frame', () => {
    const ac = fakeContext()
    const v = new DroneVoices(DEFAULT_SOUNDS, true)
    const kinds = ['scout', 'sniper', 'heavy', 'swarmer']
    let afterWarm = -1
    for (let f = 0; f < 600; f++) {
      clock.now = f / 30
      // Twenty drones circling at distances that keep changing who is nearest.
      const ds = Array.from({ length: 20 }, (_, i) => drone(i, kinds[i % 4], [Math.cos(clock.now + i) * (10 + i * 2), 6, Math.sin(clock.now * 0.7 + i) * (10 + ((i * 7 + f) % 30))]))
      v.frame(ac, OUT, input(ds), clock.now)
      expect(v.heard().length).toBeLessThanOrEqual(6)
      expect(v.slots.length).toBeLessThanOrEqual(8)
      if (f === 120) afterWarm = made.nodes
    }
    expect(afterWarm).toBeGreaterThan(0)
    expect(made.nodes).toBe(afterWarm)
  })

  it('a drone beyond reach is not heard; one past the fog but in reach is', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const reach = V.reach * def('scout').detect
    v.frame(fakeContext(), OUT, input([drone(1, 'scout', [0, 0, -(reach + 1)]), drone(2, 'scout', [0, 0, -60])]), 0)
    expect(v.heard()).toEqual(['d2'])
    expect(v.slots[0].last.level).toBeGreaterThan(0)
  })

  it('the drones gone (a RESTART, a NEXT WAVE) release every voice: it fades to silence', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const ac = fakeContext()
    v.frame(ac, OUT, input([drone(1, 'heavy', [0, 4, -10]), drone(2, 'scout', [3, 4, -12])]), 0)
    expect(v.heard().length).toBe(2)
    clock.now = 0.1
    v.frame(ac, OUT, input([]), clock.now)
    expect(v.heard()).toEqual([])
    for (const s of v.slots) expect(s.last.level).toBe(0)
  })
})

describe('how loud and how bright', () => {
  it('full within near, falling gently with distance, nothing at reach, plainly heard past the fog', () => {
    const reach = V.reach * def('scout').detect
    expect(distanceGain(2, V, reach)).toBe(1)
    expect(distanceGain(V.near, V, reach)).toBe(1)
    const g = [15, 25, 40, 55, 70].map((d) => distanceGain(d, V, reach))
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeLessThan(g[i - 1])
    // At the fog's edge (55) and at 1.5 times the detection range, at least the far floor.
    expect(distanceGain(55, V, reach)).toBeGreaterThanOrEqual(V.farFloor)
    expect(distanceGain(1.5 * def('scout').detect, V, reach)).toBeGreaterThanOrEqual(V.farFloor)
    expect(distanceGain(reach, V, reach)).toBe(0)
    expect(distanceGain(200, V, reach)).toBe(0)
  })

  it('a drone at the fog\'s edge is no more than about 12 dB under the attack peak, and the attack is still the loudest', () => {
    const fog = 55
    for (const e of enemies) {
      const k = DEFAULT_SOUNDS.kinds[e.id]
      const s = { reach: V.reach * e.detect, act: 0, charge: 0, occluded: false, ratio: 1, spreadCents: 0 }
      const far = voiceTargets(k, V, { ...s, dist: fog, cue: 0 }).level
      const peak = voiceTargets(k, V, { ...s, dist: 3, cue: 1, act: 1 }).level
      const db = 20 * Math.log10(far / peak)
      expect(db).toBeGreaterThan(-12.5)
      expect(db).toBeLessThan(-6)
    }
  })

  it('every voice meets in one gentle compressor before the game\'s bus', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const made0 = made.nodes
    const ac = fakeContext() as BaseAudioContext & { createDynamicsCompressor: () => unknown }
    let comps = 0
    const real = ac.createDynamicsCompressor
    ac.createDynamicsCompressor = () => { comps++; return real() }
    v.frame(ac, OUT, input(Array.from({ length: 8 }, (_, i) => drone(i, 'heavy', [i, 4, -40]))), 0)
    expect(comps).toBe(1)
    expect(made.nodes).toBeGreaterThan(made0)
    // The voices' default trim after it comes from the data.
    expect(DEFAULT_SOUNDS.voices.mix).toBeGreaterThan(0)
    expect(DEFAULT_SOUNDS.voices.mix).toBeLessThan(1)
  })

  it('behind a wall the low-pass closes and the level drops (segmentClear says blocked)', () => {
    const open = new DroneVoices(DEFAULT_SOUNDS, false)
    const walled = new DroneVoices(DEFAULT_SOUNDS, false)
    const blocked: Array<[Vec3, Vec3]> = []
    open.frame(fakeContext(), OUT, input([drone(1, 'scout', [0, 4, -20])]), 0)
    walled.frame(fakeContext(), OUT, input([drone(1, 'scout', [0, 4, -20])], (a, b) => { blocked.push([a, b]); return false }), 0)
    expect(blocked.length).toBeGreaterThan(0)
    expect(walled.slots[0].occluded).toBe(true)
    expect(open.slots[0].occluded).toBe(false)
    expect(walled.slots[0].last.cutoff).toBeLessThan(open.slots[0].last.cutoff * 0.5)
    expect(walled.slots[0].last.level).toBeLessThan(open.slots[0].last.level)
  })

  it('a walled voice is never muffled below the floor, so a heavy behind a wall stays audible', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    v.frame(fakeContext(), OUT, input([drone(1, 'heavy', [0, 4, -20])], () => false), 0)
    expect(v.slots[0].last.cutoff).toBeGreaterThanOrEqual(V.occluded.floor)
  })

  it('walls are checked for a few voices each update, in turn, not all of them every time', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const ac = fakeContext()
    const ds = Array.from({ length: 10 }, (_, i) => drone(i, 'swarmer', [i * 2, 3, -10 - i]))
    let checks = 0
    v.frame(ac, OUT, input(ds, () => { checks++; return true }), 0)
    checks = 0
    clock.now = 1 / 30
    v.frame(ac, OUT, input(ds, () => { checks++; return true }), clock.now)
    expect(checks).toBe(V.checks)
  })

  it('closer is louder and brighter (the attack cue grows as the distance falls)', () => {
    const far = attackCue({ dist: 30, def: def('heavy'), mode: 'hunt', windup: -1, burstLeft: 0, closing: 0 }, V)
    const near = attackCue({ dist: 5, def: def('heavy'), mode: 'hunt', windup: -1, burstLeft: 0, closing: 0 }, V)
    expect(far.cue).toBe(0)
    expect(near.cue).toBeGreaterThan(0.5)
    const s = { reach: 82.5, act: 0, charge: 0, occluded: false, ratio: 1, spreadCents: 0 }
    const k = DEFAULT_SOUNDS.kinds.heavy
    const a = voiceTargets(k, V, { ...s, dist: 8, cue: 0 })
    const b = voiceTargets(k, V, { ...s, dist: 8, cue: near.cue })
    expect(b.level).toBeGreaterThan(a.level)
    expect(b.cutoff).toBeGreaterThan(a.cutoff)
  })

  it('a scout in its dive is louder, brighter and higher than one hovering at the same distance', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const w = new DroneVoices(DEFAULT_SOUNDS, false)
    v.frame(fakeContext(), OUT, input([drone(1, 'scout', [0, 5, -20], { mode: 'hunt' })]), 0)
    w.frame(fakeContext(), OUT, input([drone(1, 'scout', [0, 5, -20], { mode: 'dive' })]), 0)
    const calm = v.slots[0].last, diving = w.slots[0].last
    expect(diving.level).toBeGreaterThan(calm.level * 1.3)
    expect(diving.cutoff).toBeGreaterThan(calm.cutoff * 1.8)
    expect(diving.rise - calm.rise).toBeCloseTo(DEFAULT_SOUNDS.kinds.scout.attack.pitch, 5)
  })

  it('a sniper winding up whines, rising with the charge; a heavy winding up rises too', () => {
    const windupS = def('sniper').attack.shot?.windupS as number
    const start = attackCue({ dist: 30, def: def('sniper'), mode: 'hunt', windup: windupS * 0.9, burstLeft: 0, closing: 0 }, V)
    const late = attackCue({ dist: 30, def: def('sniper'), mode: 'hunt', windup: windupS * 0.1, burstLeft: 0, closing: 0 }, V)
    expect(late.charge).toBeGreaterThan(start.charge)
    const s = { dist: 30, reach: 82.5, occluded: false, ratio: 1, spreadCents: 0 }
    const k = DEFAULT_SOUNDS.kinds.sniper
    const a = voiceTargets(k, V, { ...s, ...start }), b = voiceTargets(k, V, { ...s, ...late })
    expect(b.whineHz).toBeGreaterThan(a.whineHz)
    expect(b.whineLevel).toBeGreaterThan(a.whineLevel)
    expect(voiceTargets(k, V, { ...s, cue: 0, act: 0, charge: 0 }).whineLevel).toBe(0)
    const heavy = attackCue({ dist: 25, def: def('heavy'), mode: 'hunt', windup: 0.1, burstLeft: 0, closing: 0 }, V)
    expect(heavy.act).toBeGreaterThan(0.5)
    expect(attackCue({ dist: 25, def: def('heavy'), mode: 'hunt', windup: -1, burstLeft: 2, closing: 0 }, V).cue).toBe(1)
  })

  it('a swarmer rushing in is cued; one drifting away at the same distance is not', () => {
    const rushing = attackCue({ dist: 8, def: def('swarmer'), mode: 'hunt', windup: -1, burstLeft: 0, closing: 7 }, V)
    const leaving = attackCue({ dist: 8, def: def('swarmer'), mode: 'hunt', windup: -1, burstLeft: 0, closing: -7 }, V)
    expect(rushing.act).toBeGreaterThan(0.4)
    expect(leaving.act).toBe(0)
  })

  it('Doppler: higher coming, lower going, clamped both ways', () => {
    expect(dopplerRatio(0, V.doppler)).toBe(1)
    expect(dopplerRatio(10, V.doppler)).toBeGreaterThan(1)
    expect(dopplerRatio(-10, V.doppler)).toBeLessThan(1)
    expect(dopplerRatio(1000, V.doppler)).toBe(V.doppler.max)
    expect(dopplerRatio(-1000, V.doppler)).toBe(V.doppler.min)
    expect(dopplerRatio(Number.POSITIVE_INFINITY, V.doppler)).toBe(V.doppler.max)
  })

  it('Doppler through a frame: a drone flying at you sounds higher than the same drone still, and one flying off lower', () => {
    const cents = (vel: Vec3): number => {
      const v = new DroneVoices(DEFAULT_SOUNDS, false)
      v.frame(fakeContext(), OUT, input([drone(7, 'heavy', [0, 0, -20], { vel })]), 0)
      return v.slots[0].last.cents
    }
    // The eye is at the origin and the drone at z -20: +z is toward the eye.
    const still = cents([0, 0, 0]), coming = cents([0, 0, 8]), going = cents([0, 0, -8])
    expect(coming - still).toBeGreaterThan(0)
    expect(going - still).toBeLessThan(0)
  })

  it('a paused run hushes every voice and keeps its drone', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const ac = fakeContext()
    v.frame(ac, OUT, input([drone(1, 'heavy', [0, 4, -10])]), 0)
    expect(v.slots[0].last.level).toBeGreaterThan(0)
    clock.now = 0.1
    v.frame(ac, OUT, { ...input([drone(1, 'heavy', [0, 4, -10])]), paused: true }, clock.now)
    expect(v.slots[0].last.level).toBe(0)
    expect(v.heard()).toEqual(['d1'])
  })
})

describe('the sound data', () => {
  it('the defaults are the base variant\'s client.sounds, and every kind has its own voice', () => {
    expect(soundsOf((base as { client?: unknown }).client)).toEqual(DEFAULT_SOUNDS)
    const sig = enemies.map((e) => { const k = DEFAULT_SOUNDS.kinds[e.id]; return `${k.base}|${k.oscs.map((o) => o.wave).join(',')}|${k.lfo?.rate}` })
    expect(enemies.every((e) => DEFAULT_SOUNDS.kinds[e.id])).toBe(true)
    expect(new Set(sig).size).toBe(enemies.length)
  })

  it('a variant may change one number, even inside a nested part, and keeps the rest', () => {
    const s = soundsOf({ sounds: { voices: { phone: 4, doppler: { max: 1.1 } }, scout: { base: 400, attack: { pitch: 300 } }, sniper: { whine: { to: 1500 } } } })
    expect(s.voices.phone).toBe(4)
    expect(s.voices.desktop).toBe(DEFAULT_SOUNDS.voices.desktop)
    expect(s.voices.doppler).toEqual({ ...DEFAULT_SOUNDS.voices.doppler, max: 1.1 })
    expect(s.kinds.scout.base).toBe(400)
    expect(s.kinds.scout.attack).toEqual({ ...DEFAULT_SOUNDS.kinds.scout.attack, pitch: 300 })
    expect(s.kinds.sniper.whine).toEqual({ ...DEFAULT_SOUNDS.kinds.sniper.whine, to: 1500 })
    expect(s.kinds.heavy).toEqual(DEFAULT_SOUNDS.kinds.heavy)
  })

  it('a broken field falls back to the default, never NaN, an unknown wave or a division by zero', () => {
    const s = soundsOf({ sounds: {
      voices: { phone: 'many', near: Number.NaN, cueNear: 10, cueFar: 10, doppler: { c: -5 } },
      scout: { base: Number.POSITIVE_INFINITY, gain: 'loud', oscs: [{ wave: 'zigzag', ratio: Number.NaN, mix: 0.5 }], attack: { gain: null } },
      sniper: { whine: { from: 0 } },
      newcomer: { gain: 0.02 },
    } })
    expect(s.voices.phone).toBe(DEFAULT_SOUNDS.voices.phone)
    expect(s.voices.near).toBe(DEFAULT_SOUNDS.voices.near)
    expect(s.voices.cueFar).toBeGreaterThan(s.voices.cueNear)
    expect(s.voices.doppler.c).toBeGreaterThanOrEqual(1)
    expect(s.kinds.scout.base).toBe(DEFAULT_SOUNDS.kinds.scout.base)
    expect(soundsOf({ sounds: { scout: { base: 99999 } } }).kinds.scout.base).toBe(20000)
    expect(s.kinds.scout.gain).toBe(DEFAULT_SOUNDS.kinds.scout.gain)
    expect(s.kinds.scout.oscs[0].wave).toBe(DEFAULT_SOUNDS.kinds.scout.oscs[0].wave)
    expect(s.kinds.scout.oscs[0].ratio).toBe(DEFAULT_SOUNDS.kinds.scout.oscs[0].ratio)
    expect(s.kinds.scout.attack.gain).toBe(DEFAULT_SOUNDS.kinds.scout.attack.gain)
    expect(s.kinds.sniper.whine?.from).toBeGreaterThan(0)
    expect(s.kinds.newcomer.base).toBe(DEFAULT_SOUNDS.kinds.scout.base)
    // And a frame with all of it sets only finite values (the afterEach checks every call).
    const v = new DroneVoices(s, false)
    v.frame(fakeContext(), OUT, input([drone(1, 'scout', [0, 0, -3], { mode: 'dive' }), drone(2, 'sniper', [2, 0, -10], { windup: 0.4 })]), 0)
    expect(attackCue({ dist: 10, def: def('heavy'), mode: 'hunt', windup: -1, burstLeft: 0, closing: 0 }, s.voices).cue).not.toBeNaN()
  })
})

/* ---------- the rules, through the canvas's component ---------- */

const docListeners = new Map<string, () => void>()
const fakeDoc = {
  visibilityState: 'visible',
  addEventListener: (k: string, fn: () => void) => { docListeners.set(k, fn) },
  removeEventListener: (k: string) => { docListeners.delete(k) },
}
;(globalThis as { document?: unknown }).document = fakeDoc

function fakeView(): DroneRunView {
  const variant = base as unknown as { spec: { enemies: DroneDef[]; player: { eye: number } }; client?: unknown }
  const drones = [
    { id: 1, def: enemies.findIndex((e) => e.id === 'scout'), pos: [0, 70, -20] as Vec3, vel: [0, 0, 0] as Vec3, hp: 1, mode: 'hunt', windup: -1, burstLeft: 0 },
    { id: 2, def: enemies.findIndex((e) => e.id === 'heavy'), pos: [5, 70, -25] as Vec3, vel: [0, 0, 0] as Vec3, hp: 7, mode: 'hunt', windup: -1, burstLeft: 0 },
  ]
  const runner = {
    paused: false,
    state: { drones, body: { vel: [0, 0, 0] }, world: { variant, solids: buildSolids([]) } },
    eye: (out: Vec3) => { out[0] = 0; out[1] = 66; out[2] = 0; return out },
    between: (_k: string, _id: number, p: Vec3, out: Vec3) => { out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out },
  }
  return { runner } as unknown as DroneRunView
}

/** Mount the component (its effects run as React would), with a frame to call and an unmount. */
function mount(): { frame: () => void; unmount: () => void } {
  h.frameCb = null
  h.effects = []
  fakeDoc.visibilityState = 'visible'
  Voices({ view: fakeView() })
  const cleanups = h.effects.map((f) => f())
  const cb = h.frameCb as ((s: { camera: unknown }) => void) | null
  if (!cb) throw new Error('no frame callback')
  return { frame: () => cb({ camera: {} }), unmount: () => { for (const c of cleanups) if (typeof c === 'function') c() } }
}

describe('the rules', () => {
  it('nothing is made, and the context is not even asked for, before the browser lets sound out', () => {
    h.ctx = fakeContext()
    const m = mount()
    for (let i = 0; i < 10; i++) m.frame()
    expect(made.nodes).toBe(0)
    expect(h.contextCalls).toBe(0)
    expect(h.listenerMoves).toBe(0)
  })

  it('once it runs, the voices sound and the camera is the ears', () => {
    h.ctx = fakeContext()
    h.running = true
    mount().frame()
    expect(made.sources).toBeGreaterThan(0)
    expect(h.listenerMoves).toBe(1)
  })

  it('the game\'s switch (M) stops and parts every voice, and makes none while it is on', () => {
    vi.useFakeTimers()
    h.ctx = fakeContext()
    h.running = true
    const m = mount()
    m.frame()
    const sources = made.sources
    useDroneRunSound.setState({ muted: true })
    m.frame()
    expect(made.stopped).toBe(sources)
    vi.advanceTimersByTime(1000)
    expect(made.parted).toBeGreaterThan(0)
    const nodes = made.nodes
    for (let i = 0; i < 5; i++) m.frame()
    expect(made.nodes).toBe(nodes)
  })

  it('MUTE ALL does the same', () => {
    h.ctx = fakeContext()
    h.running = true
    useSoundMutes.setState({ master: true })
    const m = mount()
    for (let i = 0; i < 5; i++) m.frame()
    expect(made.nodes).toBe(0)
    useSoundMutes.setState({ master: false })
    m.frame()
    expect(made.sources).toBeGreaterThan(0)
  })

  it('the screen going away fades, stops and parts every node, on the context\'s clock', () => {
    vi.useFakeTimers()
    h.ctx = fakeContext()
    h.running = true
    const m = mount()
    m.frame()
    const sources = made.sources, nodes = made.nodes
    clock.now = 2
    m.unmount()
    expect(made.stopped).toBe(sources)
    vi.advanceTimersByTime(1000)
    // Every node made, but the game's bus, is parted.
    expect(made.parted).toBe(nodes - 1)
  })

  it('the page hidden fades, stops and parts every node too, and none is made while hidden', () => {
    vi.useFakeTimers()
    h.ctx = fakeContext()
    h.running = true
    const m = mount()
    m.frame()
    const sources = made.sources
    fakeDoc.visibilityState = 'hidden'
    docListeners.get('visibilitychange')?.()
    expect(made.stopped).toBe(sources)
    vi.advanceTimersByTime(1000)
    expect(made.parted).toBeGreaterThan(0)
    const nodes = made.nodes
    m.frame()
    expect(made.nodes).toBe(nodes)
  })

  it('the recording tap is taken only where the DEV handle is allowed', () => {
    const seen: number[] = []
    setVoiceTap(() => { seen.push(1) })
    const m = mount()
    m.frame()
    setVoiceTap(null)
    // Tests run as development, where the handle is allowed.
    expect(seen.length).toBe(1)
  })
})
