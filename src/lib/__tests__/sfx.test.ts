/**
 * sfx.test.ts: the sound effects' one door (lib/sfx.ts; arkinox, 2026-11-24).
 * The bounce is a short synthesised boing through the one audio context,
 * under 0.4 s and as quiet as the message chime; a harder bounce is a little
 * deeper. It is kept quiet by Settings' Sound effects switched off (per
 * identity), MUTE ALL, a hidden page, TV's broadcast and TV being on, and a
 * second play within SFX_GAP_MS. While the browser holds sound back it asks
 * for sound and plays only if it is let out at once. The audio context is a
 * recording fake; nothing plays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => ({ ctx: null as unknown, wanted: 0 }))
vi.mock('../audioContext', () => ({ audioContext: () => audio.ctx, wantSound: () => { audio.wanted++ } }))

import { DEFAULT_BOUNCE, SFX_GAP_MS, resetSfx, sfx, sfxAllowed } from '../sfx'
import { setBroadcastForTest } from '../tv/broadcast'
import { setTvOn } from '../../store/tvOn'
import { useSoundMutes } from '../../store/useSoundMutes'
import { forgetSfxSwitch, setSfxOn } from '../../store/sfxSwitch'
import { useCyberspace } from '../../store/useCyberspace'

interface Voice { type: string; freqs: number[]; start?: number; stop?: number }

/** A fake audio context recording each oscillator (its type, the frequencies it is set to, its start and stop) and the levels of each gain that goes out to the speakers. */
function fakeContext(state: 'running' | 'suspended' = 'running') {
  const voices: Voice[] = []
  const gains: number[] = []
  const destination = {}
  const param = (onSet?: (v: number) => void) => ({
    setValueAtTime: (v: number) => { onSet?.(v) },
    exponentialRampToValueAtTime: (v: number) => { onSet?.(v) },
  })
  const node = () => ({ connect: () => undefined })
  const ctx = {
    state,
    currentTime: 100,
    destination,
    resume: vi.fn(async () => { ctx.state = 'running' }),
    createGain: () => {
      const levels: number[] = []
      return { connect: (to: unknown) => { if (to === destination) gains.push(...levels) }, gain: param((v) => levels.push(v)) }
    },
    createBiquadFilter: () => ({ ...node(), type: '', frequency: param(), Q: param() }),
    createOscillator: () => {
      const v: Voice = { type: '', freqs: [] }
      voices.push(v)
      return {
        ...node(),
        set type(t: string) { v.type = t },
        frequency: param((f) => v.freqs.push(f)),
        start: (t: number) => { v.start = t },
        stop: (t: number) => { v.stop = t },
      }
    },
  }
  return { ctx, voices, gains }
}

let fake: ReturnType<typeof fakeContext>

beforeEach(() => {
  fake = fakeContext()
  audio.ctx = fake.ctx
  audio.wanted = 0
  resetSfx()
  setBroadcastForTest(false)
  setTvOn(false)
  useSoundMutes.setState({ master: false })
  forgetSfxSwitch()
})

afterEach(() => {
  setBroadcastForTest(null)
  setTvOn(false)
  useSoundMutes.setState({ master: false })
  vi.unstubAllGlobals()
})

describe('the bounce', () => {
  it('one play is one boing: three oscillators, all stopped within 0.4 s, no louder than the chime', () => {
    expect(sfx.play('bounce', 0.5, 1000)).toBe(true)
    expect(fake.voices).toHaveLength(3)
    for (const v of fake.voices) {
      expect(v.start).toBe(100)
      expect(v.stop! - 100).toBeLessThan(0.4)
    }
    expect(fake.gains.length).toBeGreaterThan(0)
    expect(Math.max(...fake.gains)).toBeLessThanOrEqual(0.08)
  })

  it('a harder bounce is a little deeper', () => {
    const soft = fakeContext()
    DEFAULT_BOUNCE(soft.ctx as unknown as AudioContext, 0, 0)
    const hard = fakeContext()
    DEFAULT_BOUNCE(hard.ctx as unknown as AudioContext, 0, 1)
    const tri = (f: ReturnType<typeof fakeContext>) => f.voices.find((v) => v.type === 'triangle')!.freqs[0]
    expect(tri(hard)).toBeLessThan(tri(soft))
  })

  it('a strength out of 0 to 1 is held to it', () => {
    const wild = fakeContext()
    DEFAULT_BOUNCE(wild.ctx as unknown as AudioContext, 0, 40)
    const hard = fakeContext()
    DEFAULT_BOUNCE(hard.ctx as unknown as AudioContext, 0, 1)
    expect(wild.voices.map((v) => v.freqs)).toEqual(hard.voices.map((v) => v.freqs))
  })
})

describe('what keeps it quiet', () => {
  it('Sound effects off in Settings, for this identity only', () => {
    const me = useCyberspace.getState().identity
    setSfxOn(false)
    try {
      expect(sfxAllowed()).toBe(false)
      expect(sfx.play('bounce', 0, 1000)).toBe(false)
      expect(fake.voices).toHaveLength(0)
      useCyberspace.setState({ identity: { pubkey: 'd4'.repeat(32), npub: 'npub-other' } })
      expect(sfx.play('bounce', 0, 2000)).toBe(true)
      expect(fake.voices).toHaveLength(3)
    } finally {
      useCyberspace.setState({ identity: me })
      setSfxOn(true)
    }
    expect(sfx.play('bounce', 0, 3000)).toBe(true)
  })

  it('Sound effects turned off where storage refuses the write: still off for this page', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('full') }, removeItem: () => undefined })
    setSfxOn(false)
    try {
      expect(sfxAllowed()).toBe(false)
      expect(sfx.play('bounce', 0, 1000)).toBe(false)
    } finally {
      setSfxOn(true)
    }
    expect(sfxAllowed()).toBe(true)
  })

  it('MUTE ALL', () => {
    useSoundMutes.setState({ master: true })
    expect(sfxAllowed()).toBe(false)
    expect(sfx.play('bounce', 0, 1000)).toBe(false)
    expect(fake.voices).toHaveLength(0)
  })

  it('a hidden page', () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    expect(sfx.play('bounce', 0, 1000)).toBe(false)
    expect(fake.voices).toHaveLength(0)
    vi.stubGlobal('document', { visibilityState: 'visible' })
    expect(sfx.play('bounce', 0, 2000)).toBe(true)
    expect(fake.voices).toHaveLength(3)
  })

  it('TV\'s broadcast', () => {
    setBroadcastForTest(true)
    expect(sfx.play('bounce', 0, 1000)).toBe(false)
    expect(fake.voices).toHaveLength(0)
  })

  it('TV on', () => {
    setTvOn(true)
    expect(sfx.play('bounce', 0, 1000)).toBe(false)
    expect(fake.voices).toHaveLength(0)
  })

  it('a second play within the gap; one after it sounds', () => {
    expect(sfx.play('bounce', 0, 1000)).toBe(true)
    expect(sfx.play('bounce', 0, 1000 + SFX_GAP_MS.bounce - 1)).toBe(false)
    expect(fake.voices).toHaveLength(3)
    expect(sfx.play('bounce', 0, 1000 + SFX_GAP_MS.bounce)).toBe(true)
    expect(fake.voices).toHaveLength(6)
  })

  it('a play a gate kept quiet does not hold back the next', () => {
    useSoundMutes.setState({ master: true })
    expect(sfx.play('bounce', 0, 1000)).toBe(false)
    useSoundMutes.setState({ master: false })
    expect(sfx.play('bounce', 0, 1001)).toBe(true)
  })

  it('no Web Audio: nothing, and no throw', () => {
    audio.ctx = null
    expect(sfx.play('bounce', 0, 1000)).toBe(false)
  })
})

describe('sound held back by the browser', () => {
  it('asks for sound, and plays if it is let out at once', async () => {
    fake = fakeContext('suspended')
    audio.ctx = fake.ctx
    vi.spyOn(performance, 'now').mockReturnValue(1000)
    expect(sfx.play('bounce', 0, 1000)).toBe(true)
    expect(audio.wanted).toBe(1)
    expect(fake.ctx.resume).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(fake.voices).toHaveLength(3))
  })

  it('a boing let out late is dropped: it would land after the bounce', async () => {
    fake = fakeContext('suspended')
    audio.ctx = fake.ctx
    vi.spyOn(performance, 'now').mockReturnValue(5000)
    expect(sfx.play('bounce', 0, 1000)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()
    expect(fake.ctx.state).toBe('running')
    expect(fake.voices).toHaveLength(0)
  })
})
