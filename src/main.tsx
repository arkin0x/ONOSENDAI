// First, before anything compiles a material: the scene fogs by straight-line distance (scene/radialFog.ts).
import './scene/radialFog'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { installTapGuard } from './lib/tapGuard'
import { isBroadcast, markBroadcastPage } from './lib/tv/broadcast'
import { TvStandby } from './hud/TvStandby'
import { hydrateWorkshop } from './store/useWorkshop'
import { chainReadyToDraw } from './store/useCyberspace'
import { hydrateHidden } from './store/hiddenStorage'
import { wireLocalObjects } from './store/localObjects'
import { diagWanted } from './lib/diagGate'
import { applyTutorialFlag, applyTutorialRoute, landedPath, noteLanding } from './tutorial/gate'
import { takeArrivalMode } from './store/arrivalMode'
import { inject } from '@vercel/analytics'
import { startAnalytics } from './lib/analytics'

// A tap on a modal's backdrop only closes it (lib/tapGuard.ts).
installTapGuard(window)
// The first-arrival tutorial (tutorial/gate.ts): where the page landed,
// ?tutorial=1 or =0 setting this device's switch, and /tutorial turning it on
// and asking for a run (the address goes back to /), before anything draws.
// /tutorial wins over a ?tutorial=0 on the same address: visiting it means on.
noteLanding(location.pathname)
applyTutorialFlag()
applyTutorialRoute()
// ?mode=view or ?mode=region: taken off the address now, applied once the app can (store/arrivalMode.ts).
takeArrivalMode()
// /tv?broadcast=1, the 24/7 stream: no pointer on the page (lib/tv/broadcast.ts).
markBroadcastPage()
// Vercel Web Analytics: page views as coarse routes only, never on the stream (lib/analytics.ts).
startAnalytics({ prod: import.meta.env.PROD, broadcast: isBroadcast, landed: landedPath(), inject })
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
  // The chain likewise, when it is read from its rows (store/useCyberspace.ts chainReadyToDraw).
  void Promise.allSettled([hydrateWorkshop(), hydrateHidden(), chainReadyToDraw()]).then(draw, draw)
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
