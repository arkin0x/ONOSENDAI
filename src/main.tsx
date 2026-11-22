/**
 * main.tsx: the first thing the page runs. The records that moved out of
 * localStorage (lib/kvStore.ts) are read from IndexedDB, and what is still in
 * localStorage is moved, before any module of the app is loaded: many read
 * their record the moment they load, as they did when it was in localStorage.
 * Then the app (boot.tsx). A database slow to answer holds the page at most
 * HYDRATE_WAIT_MS; past that the app loads without it (kvStore withoutDatabase).
 * The signer pref is checked against the identities store next
 * (lib/signerPrefRepair.ts), waiting at most REPAIR_WAIT_MS, and only when the
 * pref would lock the identity.
 */
import { hydrateKv } from './lib/kvStore'
import { repairSignerPref } from './lib/signerPrefRepair'

void hydrateKv()
  .catch(() => undefined)
  // Before the store reads the signer pref: a pref that would lock the identity
  // as "key not saved" while the device holds a way back to it is put right.
  .then(() => repairSignerPref())
  .catch(() => undefined)
  .then(() => import('./boot'))
  .catch((err) => console.error('[boot] the app could not load:', err))
