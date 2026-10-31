/**
 * buzz.ts: the app's one vibration gate, and the once-every gate under it.
 *
 * A buzz is for a person's attention, so it is rationed: each reason (a
 * sender's mention, a chest opening) buzzes at most once per its own gap,
 * and only while the tab is on screen, wrapped in a try since a browser
 * without vibration throws or has nothing. A reason buzzed while hidden
 * still counts as buzzed, so coming back to the tab does not set it off.
 * The chat's mention buzz (store/useChat buzzFor) and the OPEN ceremony
 * (lib/ceremonySound) both go through it.
 */

/** Whether `key` is due again at `now`, at most once per `gapMs`; when it is, it is stamped. */
export function onceEvery(last: Map<string, number>, key: string, now: number, gapMs: number): boolean {
  if (now - (last.get(key) ?? -Infinity) < gapMs) return false
  last.set(key, now)
  return true
}

const lastBuzz = new Map<string, number>()

/**
 * One vibration for these reasons, each at most once per `gapMs`, only
 * while the tab is visible. True when it buzzed (or would have, where there
 * is no vibration to call).
 */
export function buzzGate(keys: readonly string[], now: number, gapMs: number, pattern: number | number[]): boolean {
  const due = keys.filter((k) => onceEvery(lastBuzz, k, now, gapMs))
  if (due.length === 0) return false
  try {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(pattern)
  } catch { /* no vibration here */ }
  return true
}
