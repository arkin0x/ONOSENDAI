/**
 * bootMarks.ts: when each step of a load happened, for a diagnostics capture
 * (lib/diag.ts `boot`). arkinox, 2026-11-22: "startup has been way slower ...
 * its like 8 seconds til something is painted besides a black screen". The
 * capture now says when the first paint was and what the app waited on.
 *
 * Each step is a performance mark, made once per load, at the moment it
 * happened, so nothing is kept here and a capture that starts late still
 * reads them. Costs one mark per step whether or not a capture is running.
 *
 *   kv        the records moved out of localStorage are read (lib/kvStore.ts)
 *   repair    the signer pref is checked (lib/signerPrefRepair.ts)
 *   app       the app's code has loaded and run (boot.tsx)
 *   chain     the saved chain is in hand to draw (store/useCyberspace.ts chainReadyToDraw)
 *   hidden    the record of what you hid is read (store/hiddenStorage.ts)
 *   draw      the app's first render is asked for
 *   painted   the frame after that render, on screen
 *   workshop  the workshop's shards are read (store/workshopStorage.ts), after the first draw
 */

export type BootStep = 'kv' | 'repair' | 'app' | 'chain' | 'hidden' | 'draw' | 'painted' | 'workshop'
export const BOOT_STEPS: readonly BootStep[] = ['kv', 'repair', 'app', 'chain', 'hidden', 'draw', 'painted', 'workshop']

const PREFIX = 'onosendai:boot:'

/** Mark `step` now, once per load. Never throws. */
export function markBoot(step: BootStep): void {
  try {
    if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
    if (performance.getEntriesByName(PREFIX + step, 'mark').length > 0) return
    performance.mark(PREFIX + step)
  } catch { /* no marks here: the capture shows null */ }
}

/** Milliseconds since the page started for the first paint, the first contentful paint and each step; null for one that has not happened. */
export function bootTimes(): Record<'fp' | 'fcp' | BootStep, number | null> {
  const at = (name: string, type: string): number | null => {
    try {
      const e = performance.getEntriesByName(name, type)[0]
      return e ? Math.round(e.startTime) : null
    } catch { return null }
  }
  const out = { fp: at('first-paint', 'paint'), fcp: at('first-contentful-paint', 'paint') } as Record<'fp' | 'fcp' | BootStep, number | null>
  for (const s of BOOT_STEPS) out[s] = at(PREFIX + s, 'mark')
  return out
}
