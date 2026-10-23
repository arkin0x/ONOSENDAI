/**
 * audioContext.ts: the one Web Audio context ONOSENDAI makes (arkinox's
 * ruling for hidden audio, 2026-10-23: one audio plumbing, never a second
 * context).
 *
 * The chime of a message arriving, hidden audio placed in space, and hidden
 * audio played from its card all sound through it, and three.js is handed
 * it (THREE.AudioContext.setContext, lib/audioEngine), so its listener and
 * panners are on it too. Cyberspace TV's music is the one sound that is not:
 * it plays from other hosts with no CORS, and a media element sent into a
 * context without CORS is silenced, so it stays a plain audio element
 * (store/useTvMusic) and is ducked by its volume instead.
 *
 * Browsers keep a context suspended until the page has been touched. It is
 * made lazily, and resumed on the first tap or key after it is wanted
 * (wantSound), as TV's music waits for one; until then, whoever wants sound
 * can say so (the TAP FOR SOUND chip).
 */

let ctx: AudioContext | null = null
const listeners = new Set<() => void>()
let version = 0

function notify(): void {
  version++
  for (const l of listeners) l()
}

/** The context, made on first use; null where there is no Web Audio. */
export function audioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }

  ctx.addEventListener?.('statechange', notify)
  notify()
  return ctx
}

/** Whether sound can be heard now: the context exists and is running. */
export function audioRunning(): boolean {
  return ctx?.state === 'running'
}

/** Ask the browser to let sound out. Works only inside a tap or a key, or after one. */
export function resumeAudio(): void {
  const ac = audioContext()
  if (ac && ac.state !== 'running') void ac.resume().catch(() => { /* still held back */ })
}

/** For useSyncExternalStore: told when the context is made or changes state. */
export function onAudioContext(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function audioContextVersion(): number {
  return version
}

/** What a tap on a control is for: the control, not the sound (as TV's music has it). */
function onControl(e: Event): boolean {
  const t = e.target as { closest?: (s: string) => unknown } | null
  return typeof t?.closest === 'function' && t.closest('input, select, textarea') !== null
}

let waiting: (() => void) | null = null

/**
 * Sound is wanted: the context is made, and if the browser holds it back,
 * the next tap or key anywhere resumes it. Called by whatever is about to
 * sound in space; a tap on the TAP FOR SOUND chip does the same.
 */
export function wantSound(): void {
  const ac = audioContext()
  if (!ac || ac.state === 'running' || waiting || typeof window === 'undefined') return
  const go = (e: Event): void => {
    if (onControl(e)) return
    resumeAudio()
    if (audioRunning()) waiting?.()
  }
  const kinds = ['pointerup', 'touchend', 'click', 'keydown'] as const
  for (const k of kinds) window.addEventListener(k, go, { capture: true })
  const off = (): void => {
    for (const k of kinds) window.removeEventListener(k, go, { capture: true })
    waiting = null
  }
  waiting = off
  // Running by another way (a card's PLAY): stop listening.
  const stop = (): void => { if (audioRunning()) { off(); ac.removeEventListener?.('statechange', stop) } }
  ac.addEventListener?.('statechange', stop)
}

/**
 * Safari's audio session (iOS 17+): `playback` while hidden audio sounds,
 * so the ringer switch does not silence it, and `auto` the rest of the
 * time, since `playback` does not mix and would stop the person's own music
 * or podcast for a chime (useHiddenAudio sets it from what plays).
 */
export function setAudioSession(type: 'playback' | 'auto'): void {
  try {
    const session = typeof navigator === 'undefined' ? undefined : (navigator as unknown as { audioSession?: { type: string } }).audioSession
    if (session && session.type !== type) session.type = type
  } catch { /* not this browser */ }
}

/** Forget the context (tests). */
export function forgetAudioContext(): void {
  waiting?.()
  ctx = null
  notify()
}
