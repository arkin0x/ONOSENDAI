/**
 * audio.test.ts - DRONE RUN's sounds (game/droneRun/audio.ts) go through the
 * app's one audio context and respect the mutes: the game's own sound switch
 * (M) and MUTE ALL (store/useSoundMutes). A stand-in context counts the
 * nodes each sound makes.
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

const made = { osc: 0, noise: 0, gain: 0 }
let now = 0
function param(): Record<string, unknown> {
  return { value: 0, setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {}, linearRampToValueAtTime: () => {} }
}
function node(): Record<string, unknown> {
  return { connect: () => {}, start: () => {}, stop: () => {}, frequency: param(), gain: param(), Q: param(), type: '', buffer: null }
}
const fakeCtx = {
  state: 'running',
  get currentTime() { return now },
  sampleRate: 8000,
  destination: {},
  resume: () => Promise.resolve(),
  createGain: () => { made.gain++; return node() },
  createOscillator: () => { made.osc++; return node() },
  createBiquadFilter: () => node(),
  createBufferSource: () => { made.noise++; return node() },
  createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
}

vi.mock('../../../../lib/audioContext', () => ({
  audioContext: () => fakeCtx,
  wantSound: vi.fn(),
}))
vi.mock('../../../../lib/soundMuteDb', () => ({
  openSoundMuteDb: () => Promise.reject(new Error('none here')),
  putMasterMute: async () => {},
  putTrackMute: async () => {},
  readSoundMutes: async () => ({ tracks: [], master: false }),
}))

import { droneRunSilent, playSound, resetSoundsForTests, toggleDroneRunSound, useDroneRunSound, type DroneSound } from '../../audio'
import { useSoundMutes } from '../../../../store/useSoundMutes'

const ALL: DroneSound[] = ['shot', 'hurt', 'overheat', 'reload', 'wave', 'clear', 'fail']

beforeEach(() => {
  resetSoundsForTests()
  made.osc = 0; made.noise = 0; made.gain = 0
  now = 0
  useDroneRunSound.setState({ muted: false })
  useSoundMutes.setState({ master: false })
})

describe('DRONE RUN sounds', () => {
  it('every sound plays through the shared context while sound is on', () => {
    for (const s of ALL) {
      now += 1
      expect(playSound(s)).toBe(true)
    }
    for (const w of [0, 1, 2]) { now += 1; expect(playSound('shot', w)).toBe(true) }
    expect(made.osc + made.noise).toBeGreaterThan(ALL.length)
  })

  it('the game\'s own switch silences every sound and is remembered on this device', () => {
    toggleDroneRunSound()
    expect(droneRunSilent()).toBe(true)
    expect(localStorage.getItem('onosendai:drone-run:muted')).toBe('1')
    for (const s of ALL) { now += 1; expect(playSound(s)).toBe(false) }
    expect(made.osc + made.noise + made.gain).toBe(0)
    toggleDroneRunSound()
    expect(localStorage.getItem('onosendai:drone-run:muted')).toBe('0')
    expect(playSound('hurt')).toBe(true)
  })

  it('MUTE ALL silences them too', () => {
    useSoundMutes.setState({ master: true })
    expect(playSound('hurt')).toBe(false)
    expect(made.osc + made.noise + made.gain).toBe(0)
  })

  it('eight pellets of one pull are one shot', () => {
    let played = 0
    for (let i = 0; i < 8; i++) if (playSound('shot', 1)) played++
    expect(played).toBe(1)
    now += 0.2
    expect(playSound('shot', 1)).toBe(true)
    // Another gun's shot is its own sound.
    expect(playSound('shot', 0)).toBe(true)
  })
})
