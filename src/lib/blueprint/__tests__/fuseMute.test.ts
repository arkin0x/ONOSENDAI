/**
 * fuseMute.test.ts - turning sound off while a Quarry Charge's fuse burns
 * silences its beeps there and then (review of #977; lib/blueprint/
 * smashSound.ts fuseBeeps): Sound effects off, or MUTE ALL, stops every beep
 * still to come. The audio context is a recording fake; nothing plays.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => ({ ctx: null as unknown }))
vi.mock('../../audioContext', () => ({ audioContext: () => audio.ctx }))

import { fuseBeeps, silenceFuses } from '../smashSound'
import { beepTimes } from '../../terrain/quarry'
import { forgetSfxSwitch, setSfxOn } from '../../../store/sfxSwitch'
import { useSoundMutes } from '../../../store/useSoundMutes'

interface Voice { start?: number; stops: Array<number | undefined> }

/** A fake audio context that records each oscillator's start and every stop asked of it. */
function fakeContext(): { ctx: unknown; voices: Voice[] } {
  const voices: Voice[] = []
  const param = () => ({ setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined })
  const node = () => ({ connect: () => undefined, disconnect: () => undefined })
  const ctx = {
    state: 'running',
    currentTime: 100,
    sampleRate: 8000,
    destination: {},
    createOscillator: () => {
      const v: Voice = { stops: [] }
      voices.push(v)
      return { ...node(), type: '', frequency: param(), start: (t: number) => { v.start = t }, stop: (t?: number) => { v.stops.push(t) } }
    },
    createGain: () => ({ ...node(), gain: param() }),
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() }),
    decodeAudioData: async () => ({}),
    resume: async () => undefined,
  }
  return { ctx, voices }
}

/** Whether a voice was cut at once (a stop with no time), not only at its own end. */
const cut = (v: Voice): boolean => v.stops.some((t) => t === undefined)

beforeEach(() => {
  silenceFuses()
  forgetSfxSwitch()
  setSfxOn(true)
  useSoundMutes.setState({ master: false })
  vi.stubGlobal('fetch', async () => { throw new Error('no network in tests') })
})

describe('a fuse beeping when sound is turned off', () => {
  it('Sound effects off mid-fuse stops every beep still to come', () => {
    const { ctx, voices } = fakeContext()
    audio.ctx = ctx
    fuseBeeps(beepTimes())
    expect(voices.length).toBe(beepTimes().length)
    expect(voices.some(cut)).toBe(false)
    setSfxOn(false)
    expect(voices.every(cut)).toBe(true)
  })

  it('MUTE ALL mid-fuse does the same', () => {
    const { ctx, voices } = fakeContext()
    audio.ctx = ctx
    fuseBeeps(beepTimes())
    useSoundMutes.setState({ master: true })
    expect(voices.every(cut)).toBe(true)
  })

  it('a flip that leaves sound on cuts nothing; a fuse after sound is off lays out no beeps at all', () => {
    const { ctx, voices } = fakeContext()
    audio.ctx = ctx
    fuseBeeps(beepTimes())
    setSfxOn(true)
    useSoundMutes.setState({ master: false })
    expect(voices.some(cut)).toBe(false)
    setSfxOn(false)
    const before = voices.length
    fuseBeeps(beepTimes())
    expect(voices.length).toBe(before)
  })
})
