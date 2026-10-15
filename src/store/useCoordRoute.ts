/**
 * useCoordRoute.ts: what onosendai.tech/C/<hex> opens on (lib/coordRoute.ts).
 *
 * Read once, when the app starts. A full coordinate becomes a free view of
 * that place, the same focus the POSITION panel's VIEW makes, so the pad can
 * look around from there and the discovery scan, which follows the anchor
 * wherever it goes (hooks/useDiscovery.ts), runs there exactly as after a
 * hop. Nothing is signed and your own avatar does not move.
 *
 * A prefix becomes a region: the yellow box (scene/PrefixRegionBox.tsx) and
 * a free view of its middle, framed so the whole box is in view, which also
 * scans the middle, as any view does.
 *
 * A Bitcoin block's merkle root or block hash, as an explorer shows it, is
 * looked up among the loaded anchors as they arrive. A port's root is its
 * own stop coordinate, so the view is already there and only gains the
 * block's name; a landfall's root or any block's hash is not where the stop
 * is, so the view moves to the stop and a toast says why.
 *
 * When the view the link opened ends (RETURN, another place, a spectation),
 * the address goes back to the site's root, so a reload does not reopen it.
 */

import { create } from 'zustand'
import { coordToXyz, type Plane } from 'cyberspace-core'
import { coordPlace, frameScale, parseCoordRoute, prefixRegion, type PrefixRegion } from '../lib/coordRoute'
import { rowByLandfallCoord, rowByRootOrHash, stopAt } from '../lib/hyperspace/compactIndex'
import { stopCoordExact, type Stop } from '../lib/hyperspace/stops'
import { hexToBytes } from '../lib/events'
import { MAX_SCALE_EXP, type Position } from '../lib/space'
import { useCyberspace } from './useCyberspace'
import { getStopIndex, markViewedStop, ownHyperspaceView, useHyperspace } from './useHyperspace'
import { BRIEF_TOAST_MS, useToast } from './useToast'

export interface RouteRegion extends PrefixRegion {
  prefix: string
  plane: Plane
}

interface CoordRouteState {
  /** The region a prefix link named, drawn while its view lasts. */
  region: RouteRegion | null
  /** The focus label the link's view carries; null once it has ended. */
  label: string | null
}

export const useCoordRoute = create<CoordRouteState>(() => ({ region: null, label: null }))

/** How often, at most, the loaded anchors are searched for the link's block while they load. */
const BLOCK_LOOKUP_MS = 2_000

function stopPlace(stop: Stop): { position: Position; plane: Plane } {
  const { x, y, z } = coordToXyz(stopCoordExact(stop))
  return { position: { x, y, z }, plane: coordToXyz(stop.coordApprox).plane }
}

/**
 * Open the route in the current address, if there is one. Returns what
 * undoes the watching it set up (tests, and a remount in development).
 */
export function startCoordRoute(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location, history: Pick<History, 'replaceState'> = window.history): () => void {
  const route = parseCoordRoute(loc.pathname)
  if (!route) return () => {}
  const home = (): void => { try { history.replaceState(null, '', `/${loc.search}${loc.hash}`) } catch { /* no history here */ } }

  if (route.kind === 'invalid') {
    useToast.getState().show({ label: 'Not a coordinate', meta: 'A /C/ link is 1 to 64 hex characters.', mark: 'place', ms: BRIEF_TOAST_MS })
    home()
    return () => {}
  }

  const cs = useCyberspace.getState()
  const stops: Array<() => void> = []
  const end = (): void => {
    for (const s of stops.splice(0)) s()
    useCoordRoute.setState({ region: null, label: null })
    home()
  }

  if (route.kind === 'prefix') {
    const region = prefixRegion(route.hex)
    // Only all 64 characters fix the plane bit: a region is drawn in the
    // plane you are in.
    const plane = cs.anchorPlane
    const label = `C/${route.hex}`
    useCoordRoute.setState({ region: { ...region, prefix: route.hex, plane }, label })
    cs.focusOn(region.center, plane, label, frameScale(region.maxHeight, MAX_SCALE_EXP), true)
  } else {
    const { position, plane } = coordPlace(route.hex)
    const label = `C/${route.hex.slice(0, 8)}…${route.hex.slice(-4)}`
    useCoordRoute.setState({ region: null, label })
    cs.focusOn(position, plane, label, undefined, true)
    stops.push(watchForBlock(route.hex))
  }

  // The link's view ended: anything that replaced its focus, or cleared it.
  stops.push(useCyberspace.subscribe((s) => {
    const label = useCoordRoute.getState().label
    if (label !== null && s.focus?.label !== label) end()
  }))
  return () => { for (const s of stops.splice(0)) s() }
}

/**
 * Look for a block whose merkle root or hash is `hex` among the anchors, now
 * and as more load, until one matches or the link's view ends.
 */
function watchForBlock(hex: string): () => void {
  const bytes = hexToBytes(hex)
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = 0
  let done = false
  const look = (): void => {
    timer = null
    if (done) return
    last = Date.now()
    const index = getStopIndex()
    // A merkle root or block hash first (a port's root is its own stop);
    // then a landfall's own stop coordinate, its anchor's C tag.
    let row = rowByRootOrHash(index, bytes)
    if (row === -1) row = rowByLandfallCoord(index, bytes)
    if (row === -1) return
    done = true
    unsub()
    landOnStop(stopAt(index, row))
  }
  const schedule = (): void => {
    if (done || timer !== null) return
    timer = setTimeout(look, Math.max(0, BLOCK_LOOKUP_MS - (Date.now() - last)))
  }
  const unsub = useHyperspace.subscribe((s, prev) => { if (s.indexVersion !== prev.indexVersion) schedule() })
  look()
  return () => { done = true; unsub(); if (timer !== null) clearTimeout(timer) }
}

/** The link named a block: show its stop, under the block's name. */
function landOnStop(stop: Stop): void {
  const cs = useCyberspace.getState()
  const linkLabel = useCoordRoute.getState().label
  if (linkLabel === null || cs.focus?.label !== linkLabel) return
  const at = stopPlace(stop)
  const label = `BLOCK ${stop.height} · ${stop.kind === 'port' ? 'PORT' : 'LANDFALL'}`
  // The view is the stop's now, as a block picked in the scene is
  // (HyperspacePanel selectStopInScene); RETURN goes home, not back to the
  // raw coordinate the link held.
  useCoordRoute.setState({ label })
  ownHyperspaceView()
  useHyperspace.setState({ returnFocus: null })
  markViewedStop(stop.height)
  cs.focusOn(at.position, at.plane, label)
  // arkinox's words (2026-10-14). The title names the kind of stop, which
  // also says where the view is, whether or not it had to move there.
  useToast.getState().show(blockToast(stop))
}

/** What the toast for a block a /C/ link named says. */
export function blockToast(stop: Pick<Stop, 'height' | 'kind'>): { label: string; meta: string; mark: 'place'; sticky: true } {
  const height = stop.height.toLocaleString('en-US')
  return stop.kind === 'port'
    ? { label: `Block ${height} · port`, meta: "A hyperspace port is a bitcoin block's merkle root read as a cyberspace coordinate.", mark: 'place', sticky: true }
    : { label: `Block ${height} · landfall`, meta: "A hyperspace landfall is a bitcoin block's hash read as a point on Earth's surface.", mark: 'place', sticky: true }
}
