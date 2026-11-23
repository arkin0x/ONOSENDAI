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
import { expectWorkshopRead } from './store/workshopStorage'
import { chainReadyToDraw } from './store/useCyberspace'
import { hydrateHidden } from './store/hiddenStorage'
import { wireLocalObjects } from './store/localObjects'
import { diagWanted } from './lib/diagGate'
import { markBoot } from './lib/bootMarks'
import { isWorkshopPath } from './lib/workshopRoute'
import { hudFlags } from './lib/hudFlags'
import { applyNewcomerFlag } from './newcomer/flag'
import { loadNewcomer } from './newcomer/useNewcomer'
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
// ?newcomer=1: this tab plays a newcomer, the tour asked for (newcomer/flag.ts); =0 ends it.
// The newcomer store read its record as the app's modules loaded: read it again for the tab's newcomer, or the stored one again after =0.
if (applyNewcomerFlag() !== null) loadNewcomer()
// ?mode=view or ?mode=region: taken off the address now, applied once the app can (store/arrivalMode.ts).
takeArrivalMode()
// /tv?broadcast=1, the 24/7 stream: no pointer on the page (lib/tv/broadcast.ts).
markBroadcastPage()
// Vercel Web Analytics: page views as coarse routes only, never on the stream (lib/analytics.ts).
startAnalytics({ prod: import.meta.env.PROD, broadcast: isBroadcast, landed: landedPath(), inject })
// Your own objects placed by reference are drawn from your workshop first (store/localObjects.ts).
wireLocalObjects()

/**
 * What the first draw waits for, and what it does not (arkinox, 2026-11-22:
 * "its like 8 seconds til something is painted besides a black screen").
 * index.html has painted the wordmark long before this runs; the first render
 * takes its place.
 *
 * Waited for, because the world draws them: the saved chain (store/useCyberspace.ts
 * chainReadyToDraw: nothing is drawn as the chain until the chain is here) and
 * the record of what you hid, with its door secrets and closed doors
 * (store/hiddenStorage.ts), so no door or hide of yours is drawn wrong first.
 *
 * Not waited for: the workshop's shards (store/workshopStorage.ts). Only the
 * workshop, the bench and a hide being placed read them, all after a tap, and
 * OPEN WORKSHOP waits for the read (useWorkshop openWorkshop). Its read starts
 * after the first frame, so its pages neither hold the first render nor sit in
 * front of the chain's read in the browser's database queue. Until it lands,
 * changes are kept and written once it has (workshopStorage `pending`). On
 * /workshop (lib/workshopRoute.ts), which opens it at once, it is waited for
 * as before.
 *
 * A database that does not answer cannot hold the page: past HYDRATE_WAIT_MS
 * the app draws anyway, and each store fills in when its read lands, with any
 * change made meanwhile kept.
 */
const HYDRATE_WAIT_MS = 10_000
/** The workshop's read starts at the first frame, or after this when no frame comes (a tab loaded hidden draws none). */
const WORKSHOP_AFTER_MS = 1_500

let workshopRead: Promise<unknown> | null = null
function readWorkshop(): Promise<unknown> {
  return workshopRead ??= hydrateWorkshop().finally(() => markBoot('workshop'))
}

let drawn = false
function draw(): void {
  if (drawn) return
  drawn = true
  markBoot('draw')
  // From here a tap can ask for the library before its read starts: it starts the read then (workshopStorage workshopReading).
  if (!isWorkshopPath(location.pathname)) expectWorkshopRead()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* The stream never goes black: it stands by and reloads (hud/TvStandby, lib/tv/standby). */}
      {isBroadcast() ? <TvStandby><App /></TvStandby> : <App />}
    </React.StrictMode>,
  )
  // The frame after the first render is the one on screen; then the workshop.
  requestAnimationFrame(() => requestAnimationFrame(() => { markBoot('painted'); void readWorkshop() }))
  setTimeout(() => void readWorkshop(), WORKSHOP_AFTER_MS)
}
/** How long the app waits for the capture's chunk before drawing without it. */
const DIAG_WAIT_MS = 3_000

function boot(): void {
  markBoot('app')
  setTimeout(draw, HYDRATE_WAIT_MS)
  void Promise.allSettled([
    hydrateHidden().finally(() => markBoot('hidden')),
    chainReadyToDraw().finally(() => markBoot('chain')),
    ...(isWorkshopPath(location.pathname) ? [readWorkshop()] : []),
  ]).then(draw, draw)
}

/**
 * ?diag=1: the capture for a machine we cannot reach (lib/diag.ts), in before
 * the first render so it sees the contexts made. Otherwise it is never fetched.
 */
let tabStore: Storage | null = null
try { tabStore = sessionStorage } catch { /* refused: on for this load only */ }
// ?nochip=1 and ?nosyncwarn=1 (lib/hudFlags.ts), latched before the first render. The
// rewrites above take out only their own params; the tab's storage covers later ones.
hudFlags()
if (diagWanted(location.search, tabStore)) {
  // A chunk that stalls cannot hold the first render: the capture starts late, and says so.
  let booted = false
  const once = (): void => { if (booted) return; booted = true; boot() }
  setTimeout(once, DIAG_WAIT_MS)
  void import('./lib/diag').then((m) => m.startDiag()).catch((e) => console.warn('[diag]', e)).finally(once)
} else boot()
