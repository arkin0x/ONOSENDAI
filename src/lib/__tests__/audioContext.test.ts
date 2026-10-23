/**
 * audioContext.test.ts: the one audio context (hidden audio step 2). It is
 * made once and shared; while the browser holds it back, the next tap or
 * key anywhere (not one typed into a field) resumes it; once it runs, the
 * page stops listening for taps.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { audioContext, audioRunning, forgetAudioContext, onAudioContext, wantSound } from '../audioContext'

class FakeContext extends EventTarget {
  static made = 0
  state: 'suspended' | 'running' = 'suspended'
  resumes = 0
  constructor() { super(); FakeContext.made++ }
  async resume(): Promise<void> { this.resumes++; this.state = 'running'; this.dispatchEvent(new Event('statechange')) }
}

function fakeWindow(): EventTarget & { AudioContext: typeof FakeContext } {
  const w = new EventTarget() as EventTarget & { AudioContext: typeof FakeContext }
  w.AudioContext = FakeContext
  return w
}

afterEach(() => {
  forgetAudioContext()
  vi.unstubAllGlobals()
})

describe('the one audio context', () => {
  it('is made once and shared', () => {
    vi.stubGlobal('window', fakeWindow())
    FakeContext.made = 0
    expect(audioContext()).toBe(audioContext())
    expect(FakeContext.made).toBe(1)
  })

  it('is resumed by the next tap after sound is wanted, never by typing in a field, and then stops listening', async () => {
    const w = fakeWindow()
    vi.stubGlobal('window', w)
    const ac = audioContext() as unknown as FakeContext
    let told = 0
    const off = onAudioContext(() => { told++ })
    wantSound()
    const typing = new Event('keydown')
    Object.defineProperty(typing, 'target', { value: { closest: (s: string) => (s.includes('input') ? {} : null) } })
    w.dispatchEvent(typing)
    expect(ac.resumes).toBe(0)
    w.dispatchEvent(new Event('pointerup'))
    await Promise.resolve()
    expect(audioRunning()).toBe(true)
    expect(told).toBeGreaterThan(0)
    w.dispatchEvent(new Event('pointerup'))
    expect(ac.resumes).toBe(1)
    off()
  })

  it('is nothing where there is no Web Audio', () => {
    vi.stubGlobal('window', new EventTarget())
    expect(audioContext()).toBeNull()
    expect(audioRunning()).toBe(false)
    expect(() => wantSound()).not.toThrow()
  })
})
