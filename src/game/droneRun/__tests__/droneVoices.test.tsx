/**
 * droneVoices.test.tsx - the drones' spatial voices (game/droneRun/
 * droneVoices.ts, Voices.tsx): the nearest few are heard, with a margin so
 * they do not flicker; the pool is made once and reused; loudness falls with
 * distance and carries past the fog; a wall muffles; an attack is louder and
 * brighter; Doppler is clamped; and nothing is made before the browser lets
 * sound out, or while the game's switch or MUTE ALL is on. A stand-in
 * context counts every node and keeps every parameter's last target.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'

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

interface FakeParam { value: number; setTargetAtTime: (v: number) => void; setValueAtTime: (v: number) => void }
function param(v = 0): FakeParam {
  const p: FakeParam = { value: v, setTargetAtTime: (x) => { p.value = x }, setValueAtTime: (x) => { p.value = x } }
  return p
}
const made = { nodes: 0, sources: 0, stopped: 0, parted: 0 }
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
  return node({ start: () => {}, stop: () => { made.stopped++ }, buffer: null, loop: false })
}
function fakeContext(): BaseAudioContext {
  return {
    state: 'running', currentTime: 0, sampleRate: 8000, destination: {},
    createGain: () => node(), createBiquadFilter: () => node(), createPanner: () => node(),
    createOscillator: () => source(), createBufferSource: () => source(),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    resume: () => Promise.resolve(),
  } as unknown as BaseAudioContext
}

/* ---------- the app's plumbing, stood in ---------- */

const plumbing = vi.hoisted(() => ({ running: false, ctx: null as BaseAudioContext | null, contextCalls: 0, listenerMoves: 0 }))
vi.mock('../../../lib/audioContext', () => ({
  audioContext: () => { plumbing.contextCalls++; return plumbing.ctx },
  audioRunning: () => plumbing.running,
  wantSound: () => {},
}))
vi.mock('../../../store/useHiddenAudio', () => ({
  audioListener: () => ({}),
  moveListener: () => { plumbing.listenerMoves++ },
}))
vi.mock('../../../lib/soundMuteDb', () => ({
  openSoundMuteDb: () => Promise.reject(new Error('none here')),
  putMasterMute: async () => {},
  putTrackMute: async () => {},
  readSoundMutes: async () => ({ tracks: [], master: false }),
}))
let frameCb: ((s: { camera: unknown }) => void) | null = null
vi.mock('@react-three/fiber', () => ({ useFrame: (cb: (s: { camera: unknown }) => void) => { frameCb = cb } }))

import {
  DEFAULT_SOUNDS, DroneVoices, attackCue, chooseVoices, distanceGain, dopplerRatio, soundsOf, voiceTargets,
  type VoiceDrone, type VoiceInput,
} from '../droneVoices'
import { Voices } from '../Voices'
import { resetSoundsForTests, useDroneRunSound } from '../audio'
import { useSoundMutes } from '../../../store/useSoundMutes'
import base from '../../../lib/games/droneRun/variants/drone-run-base.json'
import type { DroneDef, Vec3 } from '../../../lib/games/droneRun/types'
import { buildSolids } from '../../../lib/games/droneRun/sim'
import type { DroneRunView } from '../view'

const enemies = (base as unknown as { spec: { enemies: DroneDef[] } }).spec.enemies
const def = (id: string): DroneDef => enemies.find((e) => e.id === id) as DroneDef
const V = DEFAULT_SOUNDS.voices

function drone(id: number, kind: string, pos: Vec3, extra: Partial<VoiceDrone> = {}): VoiceDrone {
  return { id, def: def(kind), pos, vel: [0, 0, 0], mode: 'hunt', windup: -1, burstLeft: 0, ...extra }
}
function input(drones: VoiceDrone[], clear: VoiceInput['clear'] = () => true): VoiceInput {
  return { eye: [0, 0, 0], eyeVel: [0, 0, 0], drones, paused: false, clear }
}

beforeEach(() => {
  made.nodes = 0; made.sources = 0; made.stopped = 0; made.parted = 0
  plumbing.running = false; plumbing.ctx = null; plumbing.contextCalls = 0; plumbing.listenerMoves = 0
  resetSoundsForTests()
  useDroneRunSound.setState({ muted: false })
  useSoundMutes.setState({ master: false })
})

describe('which drones are heard', () => {
  it('the nearest win, up to the cap', () => {
    const c = [{ key: 'a', dist: 30 }, { key: 'b', dist: 5 }, { key: 'c', dist: 12 }, { key: 'd', dist: 50 }]
    expect(chooseVoices(c, new Set(), 2)).toEqual(['b', 'c'])
  })

  it('one already heard keeps its place against one only a little nearer, not against one much nearer', () => {
    const playing = new Set(['far'])
    expect(chooseVoices([{ key: 'far', dist: 10.5 }, { key: 'new', dist: 10 }], playing, 1)).toEqual(['far'])
    expect(chooseVoices([{ key: 'far', dist: 10.5 }, { key: 'new', dist: 8 }], playing, 1)).toEqual(['new'])
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
      const t = f / 30
      // Twenty drones circling at distances that keep changing who is nearest.
      const ds = Array.from({ length: 20 }, (_, i) => drone(i, kinds[i % 4], [Math.cos(t + i) * (10 + i * 2), 6, Math.sin(t * 0.7 + i) * (10 + ((i * 7 + f) % 30))]))
      v.frame(ac, {} as AudioNode, input(ds), t)
      expect(v.heard().length).toBeLessThanOrEqual(6)
      expect(v.slots.length).toBeLessThanOrEqual(8)
      if (f === 120) afterWarm = made.nodes
    }
    expect(afterWarm).toBeGreaterThan(0)
    expect(made.nodes).toBe(afterWarm)
  })

  it('a drone beyond reach is not heard; one past the fog but in reach is', () => {
    const ac = fakeContext()
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const reach = V.reach * def('scout').detect
    v.frame(ac, {} as AudioNode, input([drone(1, 'scout', [0, 0, -(reach + 1)]), drone(2, 'scout', [0, 0, -60])]), 0)
    expect(v.heard()).toEqual(['d2'])
    expect(v.slots[0].last.level).toBeGreaterThan(0)
  })
})

describe('how loud and how bright', () => {
  it('full within near, falling with distance, nothing at reach, still something past the fog', () => {
    const reach = 82.5
    expect(distanceGain(2, V, reach)).toBe(1)
    expect(distanceGain(4, V, reach)).toBe(1)
    const g = [8, 16, 30, 55, 70].map((d) => distanceGain(d, V, reach))
    for (let i = 1; i < g.length; i++) expect(g[i]).toBeLessThan(g[i - 1])
    expect(distanceGain(55, V, reach)).toBeGreaterThan(0.05)
    expect(distanceGain(reach, V, reach)).toBe(0)
    expect(distanceGain(200, V, reach)).toBe(0)
  })

  it('behind a wall the low-pass closes and the level drops (segmentClear says blocked)', () => {
    const open = new DroneVoices(DEFAULT_SOUNDS, false)
    const walled = new DroneVoices(DEFAULT_SOUNDS, false)
    const blocked: Array<[Vec3, Vec3]> = []
    open.frame(fakeContext(), {} as AudioNode, input([drone(1, 'heavy', [0, 4, -20])]), 0)
    walled.frame(fakeContext(), {} as AudioNode, input([drone(1, 'heavy', [0, 4, -20])], (a, b) => { blocked.push([a, b]); return false }), 0)
    expect(blocked.length).toBeGreaterThan(0)
    expect(walled.slots[0].occluded).toBe(true)
    expect(open.slots[0].occluded).toBe(false)
    expect(walled.slots[0].last.cutoff).toBeLessThan(open.slots[0].last.cutoff * 0.3)
    expect(walled.slots[0].last.level).toBeLessThan(open.slots[0].last.level)
  })

  it('walls are checked for a few voices each update, in turn, not all of them every time', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const ac = fakeContext()
    const ds = Array.from({ length: 10 }, (_, i) => drone(i, 'swarmer', [i * 2, 3, -10 - i]))
    let checks = 0
    v.frame(ac, {} as AudioNode, input(ds, () => { checks++; return true }), 0)
    checks = 0
    v.frame(ac, {} as AudioNode, input(ds, () => { checks++; return true }), 1 / 30)
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
    v.frame(fakeContext(), {} as AudioNode, input([drone(1, 'scout', [0, 5, -20], { mode: 'hunt' })]), 0)
    w.frame(fakeContext(), {} as AudioNode, input([drone(1, 'scout', [0, 5, -20], { mode: 'dive' })]), 0)
    const calm = v.slots[0].last, diving = w.slots[0].last
    expect(diving.level).toBeGreaterThan(calm.level * 1.5)
    expect(diving.cutoff).toBeGreaterThan(calm.cutoff * 1.8)
    expect(diving.cents - calm.cents).toBeCloseTo(DEFAULT_SOUNDS.kinds.scout.attack.pitch, 5)
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

  it('every kind of the base variant has its own voice, distinct from the others', () => {
    const s = soundsOf((base as { client?: unknown }).client)
    const sig = enemies.map((e) => { const k = s.kinds[e.id]; return `${k.base}|${k.oscs.map((o) => o.wave).join(',')}|${k.lfo?.rate}` })
    expect(enemies.every((e) => DEFAULT_SOUNDS.kinds[e.id])).toBe(true)
    expect(new Set(sig).size).toBe(enemies.length)
  })

  it('the code\'s defaults mirror the base variant\'s client.sounds', () => {
    expect(soundsOf((base as { client?: unknown }).client)).toEqual(DEFAULT_SOUNDS)
  })

  it('the variant may change one number and keep the rest', () => {
    const s = soundsOf({ sounds: { voices: { phone: 4 }, scout: { base: 400 } } })
    expect(s.voices.phone).toBe(4)
    expect(s.voices.desktop).toBe(10)
    expect(s.kinds.scout.base).toBe(400)
    expect(s.kinds.scout.attack).toEqual(DEFAULT_SOUNDS.kinds.scout.attack)
  })

  it('a paused run hushes every voice and keeps its drone', () => {
    const v = new DroneVoices(DEFAULT_SOUNDS, false)
    const ac = fakeContext()
    v.frame(ac, {} as AudioNode, input([drone(1, 'heavy', [0, 4, -10])]), 0)
    expect(v.slots[0].last.level).toBeGreaterThan(0)
    v.frame(ac, {} as AudioNode, { ...input([drone(1, 'heavy', [0, 4, -10])]), paused: true }, 0.1)
    expect(v.slots[0].last.level).toBe(0)
    expect(v.heard()).toEqual(['d1'])
  })
})

/* ---------- the rules, through the canvas's component ---------- */

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

function mount(): () => void {
  frameCb = null
  renderToString(<Voices view={fakeView()} />)
  const cb = frameCb as ((s: { camera: unknown }) => void) | null
  if (!cb) throw new Error('no frame callback')
  return () => cb({ camera: {} })
}

describe('the rules', () => {
  it('nothing is made, and the context is not even asked for, before the browser lets sound out', () => {
    plumbing.ctx = fakeContext()
    const frame = mount()
    for (let i = 0; i < 10; i++) frame()
    expect(made.nodes).toBe(0)
    expect(plumbing.contextCalls).toBe(0)
    expect(plumbing.listenerMoves).toBe(0)
  })

  it('once it runs, the voices sound and the camera is the ears', () => {
    plumbing.ctx = fakeContext()
    plumbing.running = true
    const frame = mount()
    frame()
    expect(made.sources).toBeGreaterThan(0)
    expect(plumbing.listenerMoves).toBe(1)
  })

  it('the game\'s switch (M) stops and parts every voice, and makes none while it is on', () => {
    plumbing.ctx = fakeContext()
    plumbing.running = true
    const frame = mount()
    frame()
    const sources = made.sources
    useDroneRunSound.setState({ muted: true })
    frame()
    expect(made.stopped).toBe(sources)
    const nodes = made.nodes
    for (let i = 0; i < 5; i++) frame()
    expect(made.nodes).toBe(nodes)
  })

  it('MUTE ALL does the same', () => {
    plumbing.ctx = fakeContext()
    plumbing.running = true
    useSoundMutes.setState({ master: true })
    const frame = mount()
    for (let i = 0; i < 5; i++) frame()
    expect(made.nodes).toBe(0)
    useSoundMutes.setState({ master: false })
    frame()
    expect(made.sources).toBeGreaterThan(0)
  })
})
