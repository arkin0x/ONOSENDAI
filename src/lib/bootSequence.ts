/**
 * bootSequence.ts: what main.tsx runs before the app's code loads, and the
 * order of it. Nothing here holds the first paint: index.html draws the
 * wordmark on black before any script runs, and the app's first render takes
 * its place.
 *
 * Two steps must finish before the app's modules run, because many of them
 * read what these steps settle the moment they load:
 *   hydrate  the records that moved out of localStorage, read from IndexedDB
 *            (lib/kvStore.ts hydrateKv, bounded by its own HYDRATE_WAIT_MS on
 *            the open)
 *   repair   the signer pref checked against the identities store
 *            (lib/signerPrefRepair.ts), so a bunker login never loads behind
 *            the "KEY NOT SAVED" lock
 * They run at once, not one after the other: neither reads what the other
 * writes (the repair reads and writes only the signer slots, which stay in
 * localStorage, kvStore STAYS_IN_LOCAL_STORAGE, and the identities database;
 * the kv move never touches either). The wait is the longer of the two, not
 * their sum, and the app's chunk is already downloading meanwhile (the
 * modulepreload links vite.config.ts bootPreload adds). Only the repair's
 * writes wait for the kv step (`writable`): a localStorage left full by older
 * builds has room for the pref once the move has freed some.
 *
 * The repair may hold the app at most `repairCapMs` past the kv step, its
 * chunk's download included (it has been running since the start). Past that
 * the app loads without it, and a repair still running is told it
 * is too late (`late()`), so it never writes the pref under a store that has
 * already read it: that load shows what it showed before #888, and the next
 * load repairs.
 */

import { markBoot } from './bootMarks'

export interface BootSteps {
  hydrate: () => Promise<unknown>
  /** `late()` turns true once the app has loaded without waiting for it: write nothing then. `writable` settles when the kv step has. */
  repair: (late: () => boolean, writable: Promise<unknown>) => Promise<unknown>
  loadApp: () => Promise<unknown>
  /** The app's chunk failed to load or to run: told once, after the console. */
  onFail?: (err: unknown) => void
}

/** The most the repair may hold the app past the kv step: its read is given signerPrefRepair REPAIR_WAIT_MS from there, and its chunk may still be arriving on a cold load. */
export const REPAIR_CAP_MS = 3_000

export function runBoot(steps: BootSteps, repairCapMs = REPAIR_CAP_MS): Promise<void> {
  let late = false
  const kv = Promise.resolve().then(steps.hydrate).catch(() => undefined).then(() => markBoot('kv'))
  const repaired = Promise.resolve().then(() => steps.repair(() => late, kv)).catch(() => undefined).then(() => markBoot('repair'))
  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = kv
    .then(() => Promise.race([repaired, new Promise<void>((resolve) => { timer = setTimeout(resolve, repairCapMs) })]))
    .finally(() => { clearTimeout(timer); late = true })
  return Promise.all([kv, capped])
    .then(() => steps.loadApp())
    .then(() => undefined, (err: unknown) => {
      console.error('[boot] the app could not load:', err)
      try { steps.onFail?.(err) } catch { /* the page's word is a courtesy; the console has it */ }
    })
}
