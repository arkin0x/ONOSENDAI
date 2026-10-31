import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { installTapGuard } from './lib/tapGuard'
import { isBroadcast, markBroadcastPage } from './lib/tv/broadcast'
import { TvStandby } from './hud/TvStandby'
import { hydrateWorkshop } from './store/useWorkshop'
import { chainReadyToDraw } from './store/useCyberspace'
import { wireLocalObjects } from './store/localObjects'

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
setTimeout(draw, HYDRATE_WAIT_MS)
// The chain likewise, when it is read from its rows (store/useCyberspace.ts chainReadyToDraw).
void Promise.allSettled([hydrateWorkshop(), chainReadyToDraw()]).then(draw)
