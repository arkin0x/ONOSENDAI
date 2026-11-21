/**
 * main.tsx: the first thing the page runs. The records that moved out of
 * localStorage (lib/kvStore.ts) are read from IndexedDB, and what is still in
 * localStorage is moved, before any module of the app is loaded: many read
 * their record the moment they load, as they did when it was in localStorage.
 * Then the app (boot.tsx). A database slow to answer holds the page at most
 * HYDRATE_WAIT_MS; past that the app loads reading localStorage.
 */
import { hydrateKv } from './lib/kvStore'

void hydrateKv().finally(() => import('./boot'))
