/**
 * voiceStop.test.ts - SPEAK stopped while the voices are still loading never
 * reads (review, 2026-10-15). Some browsers list no voices until
 * `voiceschanged`, and speak() waits up to 1.5 s for them; a STOP, a new step
 * or the tour's end in that wait used to cancel nothing, and the old caption
 * then read on its own. A stand-in speechSynthesis; nothing is spoken.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { speak, stopSpeaking } from '../voice'

interface FakeSynth {
  voices: Array<{ name: string; lang: string }>
  spoken: string[]
  listeners: Array<() => void>
  getVoices: () => Array<{ name: string; lang: string }>
  speak: (u: { text: string }) => void
  cancel: () => void
  addEventListener: (type: string, fn: () => void) => void
  removeEventListener: (type: string, fn: () => void) => void
}

function fakeSynth(): FakeSynth {
  const s: FakeSynth = {
    voices: [],
    spoken: [],
    listeners: [],
    getVoices: () => s.voices,
    speak: (u) => { s.spoken.push(u.text) },
    cancel: () => {},
    addEventListener: (_t, fn) => { s.listeners.push(fn) },
    removeEventListener: (_t, fn) => { s.listeners = s.listeners.filter((f) => f !== fn) },
  }
  return s
}

describe('SPEAK and STOP while the voices load', () => {
  const g = globalThis as Record<string, unknown>
  const had = { window: g.window, utterance: g.SpeechSynthesisUtterance }
  let synth: FakeSynth

  beforeEach(() => {
    vi.useFakeTimers()
    synth = fakeSynth()
    g.window = { speechSynthesis: synth, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) }
    g.SpeechSynthesisUtterance = class { text: string; constructor(t: string) { this.text = t } }
  })
  afterEach(() => {
    vi.useRealTimers()
    g.window = had.window
    g.SpeechSynthesisUtterance = had.utterance
  })

  it('reads once the voices arrive, when nothing stopped it', async () => {
    const p = speak('caption one', () => {})
    synth.voices = [{ name: 'Daniel', lang: 'en-GB' }]
    for (const fn of [...synth.listeners]) fn()
    await p
    expect(synth.spoken).toEqual(['caption one'])
  })

  it('never reads a caption stopped before the voices came', async () => {
    const p = speak('the old step', () => {})
    stopSpeaking()
    synth.voices = [{ name: 'Daniel', lang: 'en-GB' }]
    for (const fn of [...synth.listeners]) fn()
    await p
    expect(synth.spoken).toEqual([])
  })

  it('reads only the newest of two speaks that waited on the voices', async () => {
    const first = speak('first', () => {})
    stopSpeaking()
    const second = speak('second', () => {})
    await vi.advanceTimersByTimeAsync(1500)
    await Promise.all([first, second])
    expect(synth.spoken).toEqual(['second'])
  })
})
