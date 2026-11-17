/**
 * clicks.test.ts - the short sounds in the player's head (game/droneRun/
 * clicks.ts): every control and the hitmarker, the kill and the wide miss
 * have their own sound from the variant's data; they go through the game's
 * bus and never through a panner, so the drones' voices keep every slot;
 * the game's switch and MUTE ALL silence them; a repeat inside its gap is
 * dropped and a retrigger cuts the last one. A stand-in context counts the
 * nodes and records the parameter calls.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

type Call = [string, number, number]
interface P { value: number; calls: Call[] }
function param(v = 0): P {
  const p: P = { value: v, calls: [] }
  const rec = (k: string) => (x: number, t: number) => { p.calls.push([k, x, t]); p.value = x }
  return Object.assign(p, { setValueAtTime: rec('set'), setTargetAtTime: rec('target'), exponentialRampToValueAtTime: rec('exp'), linearRampToValueAtTime: rec('linear'), cancelScheduledValues: (t: number) => { p.calls.push(['cancel', 0, t]) } })
}
const made = { nodes: 0, panners: 0, oscs: [] as Array<{ frequency: P }>, gains: [] as Array<{ gain: P; to: unknown[] }> }
const clock = { now: 0 }
function node(extra: Record<string, unknown> = {}): Record<string, unknown> {
  made.nodes++
  const n: Record<string, unknown> = { to: [] as unknown[], disconnect: () => {}, gain: param(1), frequency: param(440), detune: param(0), Q: param(1), type: '', ...extra }
  n.connect = (x: unknown) => { (n.to as unknown[]).push(x) }
  return n
}
const BUS = { bus: true }
function fakeContext(): BaseAudioContext {
  return {
    state: 'running', get currentTime() { return clock.now }, sampleRate: 8000, destination: {},
    createGain: () => { const g = node(); made.gains.push(g as never); return g },
    createBiquadFilter: () => node(),
    createPanner: () => { made.panners++; return node({ positionX: param(), positionY: param(), positionZ: param() }) },
    createOscillator: () => { const o = node({ start: () => {}, stop: () => {} }); made.oscs.push(o as never); return o },
    createBufferSource: () => node({ start: () => {}, stop: () => {}, buffer: null }),
    createDynamicsCompressor: () => node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
    resume: () => Promise.resolve(),
  } as unknown as BaseAudioContext
}

const h = vi.hoisted(() => ({ ctx: null as BaseAudioContext | null }))
vi.mock('../../../lib/audioContext', () => ({ audioContext: () => h.ctx, audioRunning: () => true, wantSound: () => {} }))
vi.mock('../../../lib/soundMuteDb', () => ({
  openSoundMuteDb: () => Promise.reject(new Error('none here')),
  putMasterMute: async () => {},
  putTrackMute: async () => {},
  readSoundMutes: async () => ({ tracks: [], master: false }),
}))

import { CONTROLS, DEFAULT_CLICKS, clickAt, clickDef, clicksOf, playClick, type Click } from '../clicks'
import { gameBus, resetSoundsForTests, useDroneRunSound } from '../audio'
import { useSoundMutes } from '../../../store/useSoundMutes'
import { DEFAULT_SOUNDS, DroneVoices } from '../droneVoices'
import base from '../../../lib/games/droneRun/variants/drone-run-base.json'
import type { DroneDef } from '../../../lib/games/droneRun/types'

const ALL: Click[] = [...CONTROLS.map((c) => `ui:${c}` as Click), 'hit', 'kill', 'miss']

beforeEach(() => {
  made.nodes = 0; made.panners = 0; made.oscs = []; made.gains = []
  clock.now = 10
  h.ctx = fakeContext()
  resetSoundsForTests()
  useDroneRunSound.setState({ muted: false })
  useSoundMutes.setState({ master: false })
})

describe('the clicks', () => {
  it('every control, the hitmarker, the kill and the miss have a sound of their own, from the base variant', () => {
    const sounds = (base as { client: { sounds: Record<string, unknown> } }).client.sounds
    expect(Object.keys(sounds.ui as object).sort()).toEqual([...CONTROLS].sort())
    const sigs = ALL.map((c) => JSON.stringify(clickDef(DEFAULT_CLICKS, c).layers))
    expect(new Set(sigs).size).toBe(ALL.length)
  })

  it('each plays through the game\'s bus, and never through a panner', () => {
    const ac = h.ctx as BaseAudioContext
    for (const c of ALL) { clock.now += 1; expect(playClick(c)).toBe(true) }
    expect(made.panners).toBe(0)
    const bus = gameBus(ac)
    const voices = made.gains.filter((g) => (g as unknown as { to: unknown[] }).to.includes(bus))
    expect(voices.length).toBe(ALL.length)
  })

  it('the game\'s switch (M) and MUTE ALL silence every one, and nothing is made', () => {
    useDroneRunSound.setState({ muted: true })
    for (const c of ALL) { clock.now += 1; expect(playClick(c)).toBe(false) }
    useDroneRunSound.setState({ muted: false })
    useSoundMutes.setState({ master: true })
    for (const c of ALL) { clock.now += 1; expect(playClick(c)).toBe(false) }
    expect(made.nodes).toBe(0)
  })

  it('nothing where there is no Web Audio yet', () => {
    h.ctx = null
    expect(playClick('hit')).toBe(false)
    expect(made.nodes).toBe(0)
  })

  it('eight pellets landing at once are one hitmarker; the next pull ticks again', () => {
    let n = 0
    for (let i = 0; i < 8; i++) if (playClick('hit', 1)) n++
    expect(n).toBe(1)
    clock.now += 0.25
    expect(playClick('hit', 1)).toBe(true)
  })

  it('played again, a click cuts its last one cleanly (a quick fade), and other clicks are left alone', () => {
    const ac = h.ctx as BaseAudioContext
    expect(clickAt(ac, BUS as never, 1, 'hit', DEFAULT_CLICKS.hit)).toBe(true)
    const first = made.gains.find((g) => (g as unknown as { to: unknown[] }).to.includes(BUS)) as { gain: P }
    expect(clickAt(ac, BUS as never, 1.01, 'kill', DEFAULT_CLICKS.kill)).toBe(true)
    expect(first.gain.calls).toEqual([])
    expect(clickAt(ac, BUS as never, 1.3, 'hit', DEFAULT_CLICKS.hit)).toBe(true)
    expect(first.gain.calls.map((c) => c[0])).toEqual(['cancel', 'target'])
    expect(first.gain.calls[1][1]).toBe(0)
  })

  it('each gun ticks at its own pitch', () => {
    const ac = h.ctx as BaseAudioContext
    const tone = DEFAULT_CLICKS.hit.layers.find((l) => l.kind === 'tone')!
    clickAt(ac, BUS as never, 1, 'hit', DEFAULT_CLICKS.hit, 2)
    const k = DEFAULT_CLICKS.hit.gunPitch?.[2] as number
    expect(k).not.toBe(1)
    expect(made.oscs[0].frequency.calls[0][1]).toBeCloseTo(tone.from * k, 6)
  })

  it('the drones\' voices keep every slot while clicks play', () => {
    const ac = h.ctx as BaseAudioContext
    const enemies = (base as unknown as { spec: { enemies: DroneDef[] } }).spec.enemies
    const v = new DroneVoices(DEFAULT_SOUNDS, true)
    const drones = enemies.map((d, i) => ({ id: i + 1, def: d, pos: [i * 3, 4, -15] as [number, number, number], vel: [0, 0, 0] as [number, number, number], mode: 'hunt', windup: -1, burstLeft: 0 }))
    const input = { eye: [0, 0, 0] as [number, number, number], eyeVel: [0, 0, 0] as [number, number, number], drones, paused: false, clear: () => true }
    v.frame(ac, gameBus(ac), input, clock.now)
    const before = { heard: v.heard(), slots: v.slots.length, panners: made.panners }
    for (const c of ALL) { clock.now += 0.2; playClick(c) }
    clock.now += 0.1
    v.frame(ac, gameBus(ac), input, clock.now)
    expect(v.heard()).toEqual(before.heard)
    expect(v.slots.length).toBe(before.slots)
    expect(made.panners).toBe(before.panners)
  })

  it('the controls stay soft and the hits stay under the guns (by their data)', () => {
    const peak = (c: Click): number => Math.max(...clickDef(DEFAULT_CLICKS, c).layers.map((l) => l.gain))
    for (const c of CONTROLS) expect(peak(`ui:${c}`)).toBeLessThanOrEqual(0.02)
    // The guns' shots peak at 0.035 to 0.08 (audio.ts).
    expect(peak('hit')).toBeLessThanOrEqual(0.04)
    expect(peak('kill')).toBeLessThanOrEqual(0.08)
    expect(peak('miss')).toBeLessThan(peak('hit') / 4)
    for (const c of ALL) for (const l of clickDef(DEFAULT_CLICKS, c).layers) expect((l.at ?? 0) + l.dur).toBeLessThanOrEqual(0.13)
  })

  it('a variant may change one sound; a broken one falls back to the base variant\'s', () => {
    const c = clicksOf({ sounds: {
      ui: { jump: { layers: [{ kind: 'tone', from: 400, dur: 0.02, gain: 0.01 }] }, fire: { layers: [{ kind: 'zap' }, 'x'] } },
      hit: { gunPitch: [1, Number.NaN, 9], gap: -3 },
      kill: { layers: [{ kind: 'noise', from: Number.POSITIVE_INFINITY, dur: 5, gain: 2 }] },
    } })
    expect(c.ui.jump.layers).toEqual([expect.objectContaining({ kind: 'tone', from: 400, wave: 'sine' })])
    expect(c.ui.fire).toEqual(DEFAULT_CLICKS.ui.fire)
    expect(c.ui.reload).toEqual(DEFAULT_CLICKS.ui.reload)
    expect(c.hit.layers).toEqual(DEFAULT_CLICKS.hit.layers)
    expect(c.hit.gunPitch).toEqual([1, 1, 4])
    expect(c.hit.gap).toBe(0)
    expect(c.kill.layers[0]).toMatchObject({ kind: 'noise', from: 1000, dur: 0.5, gain: 0.2, filter: 'bandpass' })
  })

  it('the drones\' sound data does not take the clicks for drones', () => {
    expect(Object.keys(DEFAULT_SOUNDS.kinds).sort()).toEqual(['heavy', 'scout', 'sniper', 'swarmer'])
  })
})
