import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { installTapGuard } from './lib/tapGuard'
import { isBroadcast, markBroadcastPage } from './lib/tv/broadcast'
import { TvStandby } from './hud/TvStandby'
import { hydrateWorkshop } from './store/useWorkshop'
import { wireLocalObjects } from './store/localObjects'
import { diagWanted } from './lib/diagGate'

// A tap on a modal's backdrop only closes it (lib/tapGuard.ts).
installTapGuard(window)
// /tv?broadcast=1, the 24/7 stream: no pointer on the page (lib/tv/broadcast.ts).
markBroadcastPage()
// Your own objects placed by reference are drawn from your workshop first (store/localObjects.ts).
wireLocalObjects()

/**
 * The workshop's shards are read from IndexedDB before the app draws
 * (store/workshopStorage.ts), so everything that reads the list finds it
 * whole, as it did when the list was in localStorage. A database that does
 * not answer cannot hold the page: past this, the app draws anyway and the
 * list fills in when the read lands, with any change made meanwhile kept.
 */
const HYDRATE_WAIT_MS = 10_000

let drawn = false
function draw(): void {
  if (drawn) return
  drawn = true
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* The stream never goes black: it stands by and reloads (hud/TvStandby, lib/tv/standby). */}
      {isBroadcast() ? <TvStandby><App /></TvStandby> : <App />}
    </React.StrictMode>,
  )
}
/** How long the app waits for the capture's chunk before drawing without it. */
const DIAG_WAIT_MS = 3_000

function boot(): void {
  setTimeout(draw, HYDRATE_WAIT_MS)
  hydrateWorkshop().then(draw, draw)
}

/**
 * ?diag=1: the capture for a machine we cannot reach (lib/diag.ts), in before
 * the first render so it sees the contexts made. Otherwise it is never fetched.
 */
let tabStore: Storage | null = null
try { tabStore = sessionStorage } catch { /* refused: on for this load only */ }
if (diagWanted(location.search, tabStore)) {
  // A chunk that stalls cannot hold the first render: the capture starts late, and says so.
  let booted = false
  const once = (): void => { if (booted) return; booted = true; boot() }
  setTimeout(once, DIAG_WAIT_MS)
  void import('./lib/diag').then((m) => m.startDiag()).catch((e) => console.warn('[diag]', e)).finally(once)
} else boot()
