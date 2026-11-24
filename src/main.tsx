/**
 * main.tsx: the first script the page runs. The first paint is not here:
 * index.html draws the wordmark on black before this runs.
 *
 * Before any module of the app is loaded, and at the same time
 * (lib/bootSequence.ts): the records that moved out of localStorage
 * (lib/kvStore.ts) are read from IndexedDB, and what is still in localStorage
 * is moved, since many modules read their record the moment they load, as
 * they did when it was in localStorage; and the signer pref is checked against
 * the identities store (lib/signerPrefRepair.ts), so a pref that would lock
 * the identity as "key not saved" while the device holds a way back to it is
 * put right before the store reads it. Then the app (boot.tsx), whose chunk
 * has been downloading meanwhile. A database slow to open holds the app at
 * most HYDRATE_WAIT_MS (kvStore withoutDatabase); the repair at most
 * REPAIR_CAP_MS.
 */
import { hydrateKv } from './lib/kvStore'
import { runBoot } from './lib/bootSequence'
import { preflightPage } from './lib/preflight'

/**
 * index.html's preflight (README "Browsers"): it watches for this line, and
 * says the app could not start when it never runs; it has already put its
 * own word in place of the wordmark when this browser cannot run the app,
 * and then nothing here starts.
 */
const page = preflightPage()
page.__onosendaiRan = true
if (!page.__onosendaiUnsupported) {
  void runBoot({
    hydrate: () => hydrateKv(),
    repair: (late, writable) => import('./lib/signerPrefRepair').then((m) => m.repairSignerPref(undefined, late, writable)),
    loadApp: () => import('./boot'),
    // The app's chunk did not load or threw as it ran: said on the page, not only in a console nobody on a phone can open.
    onFail: (err) => page.onosendaiCannotStart?.(err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
  })
}
