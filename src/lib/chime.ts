/**
 * chime.ts — the sound of a message arriving.
 *
 * Two short sine notes a fifth apart, synthesised on the spot: no asset to
 * load, nothing to cache, and quiet enough to sit under whatever else the
 * machine is doing. Browsers keep audio silent until the page has been
 * touched, so the context is made lazily and resumed on each play; a play
 * that the browser refuses is simply a message that arrived without a sound.
 */

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  return ctx
}

/** Play the arrival chime. Safe to call anywhere; fails silent. */
export function chime(): void {
  try {
    const ac = context()
    if (!ac) return
    if (ac.state === 'suspended') void ac.resume()
    const t0 = ac.currentTime
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.01)
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
  } catch {
    /* no audio here */
  }
}
