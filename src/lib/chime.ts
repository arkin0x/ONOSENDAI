/**
 * chime.ts — the sound of a message arriving.
 *
 * Two short sine notes a fifth apart, synthesised on the spot: no asset to
 * load, nothing to cache, and quiet enough to sit under whatever else the
 * machine is doing. Browsers keep audio silent until the page has been
 * touched, so the shared context (lib/audioContext) is made lazily and
 * resumed on each play; a play
 * that the browser refuses is simply a message that arrived without a sound.
 */

import { audioContext } from './audioContext'

/** The one context every sound shares (lib/audioContext). */
const context = audioContext

/**
 * The chime's two notes, scheduled at `t0` on the context's clock: what a
 * message arriving plays now, and what the OPEN ceremony plays as the loot
 * lands (lib/ceremonySound). Throws where the context does; callers catch.
 */
export function chimeAt(ac: AudioContext, t0: number, peak = 0.08): void {
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28)
  gain.connect(ac.destination)
  for (const [freq, at] of [[880, 0], [1318.5, 0.09]] as const) {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, t0 + at)
    osc.connect(gain)
    osc.start(t0 + at)
    osc.stop(t0 + at + 0.2)
  }
}

/** Play the arrival chime. Safe to call anywhere; fails silent. */
export function chime(): void {
  try {
    const ac = context()
    if (!ac) return
    if (ac.state === 'suspended') void ac.resume()
    chimeAt(ac, ac.currentTime)
  } catch {
    /* no audio here */
  }
}
