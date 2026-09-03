/**
 * HyperspacePanel.tsx - board the Bitcoin block transit line and ride it.
 *
 * DECK-0001 v3: every block is a stop, boarding assigns you the stop nearest
 * your coordinate (the station), and a ride to any other stop costs seeded
 * Cantor work for every block passed. This panel is the whole flow in one
 * column: what your station would be, what a chosen destination would cost,
 * then BOARD and RIDE. Exiting needs no button because leaving a stop is an
 * ordinary hop.
 *
 * The ride computation outlives the panel: the HUD folds on a phone and on
 * the hamburger, and a ten-minute proof must not die with a component. So the
 * run lives at module scope in a tiny store, and both this panel and the
 * HyperspaceBar subscribe to it.
 */

import { useEffect, useMemo, useState } from 'react'
import { Earth } from 'lucide-react'
import { create } from 'zustand'
import { coordToHex, coordToXyz, xyzToCoord, type Plane } from 'cyberspace-core'
import { coordToLatLon } from '../lib/hyperspace/landfall'
import { expectedRidePairs, rideBlocks } from '../lib/hyperspace/ride'
import { calibrate, computeRideProof, leafBenchmarkMs, type RideProgress } from '../lib/hyperspace/ridePool'
import { findStation } from '../lib/hyperspace/station'
import { stopCoordExact, type Stop } from '../lib/hyperspace/stops'
import { formatMs, formatOps, type Position } from '../lib/space'

/** Ride estimates run to hours and days; raw seconds read as noise. */
function formatDuration(ms: number): string {
  if (ms < 90_000) return formatMs(ms)
  const m = ms / 60_000
  if (m < 90) return `${m.toFixed(0)} min`
  const h = m / 60
  if (h < 48) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} d`
}
import { useCyberspace } from '../store/useCyberspace'
import { markViewedStop, ownHyperspaceView, getStopByHeight, getStopIndex, stopCount, useHyperspace } from '../store/useHyperspace'
import { Explanation } from './Explanation'

/**
 * Where a stop sits, for the camera. The float64-approximate coordinate is
 * within a metre of the exact one, invisible at any spectate scale; only the
 * signed hyperjump needs the exact coordinate.
 */
export function stopPosition(stop: Stop): Position {
  // Exact, not approx: the float64 landfall shortcut is good to about a
  // nanometre, which is TENS OF GIBSONS, so at human zooms an approx marker
  // renders visibly beside the avatar standing exactly on the stop. The
  // decimal derivation is lazy and cached per stop, and everything that
  // calls this touches a handful of stops, not the field.
  const { x, y, z } = coordToXyz(stopCoordExact(stop))
  return { x, y, z }
}

export function stopPlane(stop: Stop): Plane {
  return coordToXyz(stop.coordApprox).plane
}

/** A landfall as a place on Earth: "31.6°N 98.8°W". */
export function formatLatLon(stop: Stop): string {
  const { lat, lon } = coordToLatLon(stop.coordApprox)
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`
}

interface RideRun {
  /** Non-null while the worker pool is computing a ride proof. */
  progress: RideProgress | null
  /** The endpoints of the ride being proven, for the scene's transit ghost. */
  path: { fromHeight: number; toHeight: number } | null
  /** Why the last attempt did not produce a signed hyperjump. */
  error: string | null
}

export const useRideRun = create<RideRun>(() => ({ progress: null, path: null, error: null }))

let riding = false
let rideAbort: AbortController | null = null

/** Stop the pool. The boarded state survives; EXIT clears that separately. */
export function abortRide(): void {
  rideAbort?.abort()
}

/**
 * Build the job and run the proof. Module-level rather than a handler so the
 * guard against a second concurrent ride is global: two pools racing
 * completeRide against the same boarding would fork the chain.
 */
export async function startRide(): Promise<void> {
  if (riding) return
  const destination = useHyperspace.getState().destination
  const transit = useCyberspace.getState().transit
  if (destination === null || transit === null) return
  const destStop = getStopByHeight(destination)
  if (destStop === undefined) {
    useRideRun.setState({ error: `Block ${destination} is not in the stop index yet` })
    return
  }
  // §4.2: the station is evaluated over stops with height <= the destination
  // height, so it only becomes a fact of the trip once the destination is
  // fixed. Recompute it here, with the same function the panel's estimate
  // uses, rather than trusting anything cached from before the choice.
  const { position, plane } = useCyberspace.getState()
  const here = xyzToCoord(position.x, position.y, position.z, plane)
  // DECK-0001 v3 §4.2 (as amended): the station set is bounded by a declared
  // as_of height, not the destination. Declare the tip we synced, so the
  // station is the genuine nearest stop; the bound rides in the event.
  const asOf = useHyperspace.getState().tipHeight
  if (asOf === null || asOf < destination) {
    useRideRun.setState({ error: 'The line is not synced past the destination yet.', progress: null })
    return
  }
  const station = findStation(getStopIndex(), here, asOf)
  if (station === null) {
    useRideRun.setState({ error: 'No station: no stop at or below the destination height' })
    return
  }
  // Every passed block's hash seeds its leaf work (§5.3); a gap means the
  // sync has not covered that stretch of the line yet. A zero-length ride
  // (station is the destination) passes nothing and is valid (§5.6).
  const blocks: Array<{ height: number; blockHash: string }> = []
  for (const height of rideBlocks(station.stop.height, destination)) {
    const blockHash = getStopByHeight(height)?.blockHash
    if (!blockHash) {
      useRideRun.setState({ error: `Block ${height} has no hash in the index yet; let the sync finish` })
      return
    }
    blocks.push({ height, blockHash })
  }
  riding = true
  const controller = new AbortController()
  rideAbort = controller
  useRideRun.setState({
    error: null,
    progress: { done: 0, total: blocks.length, etaMs: null },
    path: { fromHeight: station.stop.height, toHeight: destination },
  })
  // The ride is a spectacle: pull back to the whole cube so the path can be
  // watched threading through it (RidePath). RETURN undoes the seat; the
  // proof neither knows nor cares where the camera sits.
  ownHyperspaceView()
  markViewedStop(null)
  useCyberspace.getState().focusOn(
    { x: 1n << 84n, y: 1n << 84n, z: 1n << 84n },
    plane,
    'THE RIDE',
    81,
  )
  try {
    const { rootHex, mp } = await computeRideProof(
      { previousEventIdHex: transit.enterEventId, blocks },
      (p) => useRideRun.setState({ progress: p }),
      controller.signal,
    )
    await useCyberspace.getState().completeRide({
      asOf,
      toCoordHex: coordToHex(stopCoordExact(destStop)),
      fromHeight: station.stop.height,
      toHeight: destination,
      rootHex,
      mp,
    })
    useHyperspace.getState().setDestination(null)
  } catch (err) {
    // An abort is the user's own hand; only a real failure is worth a notice.
    if (!controller.signal.aborted) {
      useRideRun.setState({ error: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    riding = false
    rideAbort = null
    useRideRun.setState({ progress: null, path: null })
  }
}

const kindLabel = (stop: Stop): string => (stop.kind === 'port' ? 'PORT' : 'LANDFALL')

export function HyperspacePanel(): JSX.Element {
  const sync = useHyperspace((s) => s.sync)
  const indexVersion = useHyperspace((s) => s.indexVersion)
  const destination = useHyperspace((s) => s.destination)
  const transit = useCyberspace((s) => s.transit)
  const position = useCyberspace((s) => s.position)
  const plane = useCyberspace((s) => s.plane)
  const atHead = useCyberspace((s) => s.atHead())
  const progress = useRideRun((s) => s.progress)
  const rideError = useRideRun((s) => s.error)
  const ready = sync.status === 'ready'

  // The per-leaf benchmark prices a ride in wall-clock time before you commit
  // to it. Calibrated once; until the number exists the estimate says so
  // rather than guessing.
  const [benchMs, setBenchMs] = useState<number | null>(() => leafBenchmarkMs())
  useEffect(() => {
    let alive = true
    calibrate().then((ms) => { if (alive) setBenchMs(ms) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // Your station, live: from the same findStation the ride uses, so the
  // panel can never promise one block and depart from another. §4.1 distance
  // is the height of the smallest aligned cube holding both points, which
  // ties routinely far from the line; §4.2 breaks ties to the lowest height,
  // and a plain sort-order nearest can land on a different member of the tie.
  // indexVersion is the store's signal that stops arrived, because the index
  // itself is a mutable structure, not state.
  const nearest = useMemo(() => {
    const here = xyzToCoord(position.x, position.y, position.z, plane)
    const asOf = useHyperspace.getState().tipHeight
    return findStation(getStopIndex(), here, asOf ?? Number.MAX_SAFE_INTEGER)
  }, [position, plane, indexVersion])

  // The cost estimate for the chosen destination, from the same findStation
  // call the ride itself will make, so the number you approve is the number
  // you get (§4.2 binds the station to the destination height).
  const estimate = useMemo(() => {
    if (destination === null) return null
    const here = xyzToCoord(position.x, position.y, position.z, plane)
    const asOf = useHyperspace.getState().tipHeight
    const station = findStation(getStopIndex(), here, Math.max(asOf ?? destination, destination))
    if (station === null) return null
    return { station, length: rideBlocks(station.stop.height, destination).length }
  }, [destination, position, plane, indexVersion])

  const destStop = destination !== null ? getStopByHeight(destination) : undefined
  const tag = ready ? `READY ${stopCount()} BLOCKS`
    : sync.status === 'error' ? 'ERROR'
      : sync.status === 'idle' ? 'IDLE'
        : sync.status === 'loading-cache'
          ? `LOADING ${sync.loaded}/${sync.total}`
          : `SYNCING ${sync.loaded}/${sync.total}`

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Hyperspace</h2>
        <span className={`tag ${sync.status === 'error' ? 'tag--danger' : ''}`}>{tag}</span>
      </header>

      <div className="hyper__group">
        <span className="legend__label hyper__kicker hyper__kicker--nearest">Station</span>
        {nearest ? (
          <>
            <dl className="stats">
              <div>
                <dt>Block</dt>
                <dd>{nearest.stop.height}</dd>
              </div>
              <div>
                <dt>Kind</dt>
                <dd>{kindLabel(nearest.stop)}</dd>
              </div>
              <div>
                <dt>Distance</dt>
                <dd>2^{nearest.distance}</dd>
              </div>
              {nearest.stop.kind === 'landfall' && (
                <div>
                  <dt>Surface</dt>
                  <dd>{formatLatLon(nearest.stop)}</dd>
                </div>
              )}
            </dl>
            <button
              className="hyper__btn hyper__btn--view"
              onClick={() => { ownHyperspaceView(); markViewedStop(nearest.stop.height); useCyberspace.getState().focusOn(
                stopPosition(nearest.stop),
                stopPlane(nearest.stop),
                `STATION · BLOCK ${nearest.stop.height}`,
                // 2^34: one render cell is 2 metres, the spec's h34 human
                // scale, so the stop reads as a place you could stand at.
                34,
              ) }}
            >VIEW STATION</button>
          </>
        ) : (
          <p className="legend__note">No blocks in the index yet.</p>
        )}
      </div>

      <div className="hyper__group">
        <span className="legend__label hyper__kicker hyper__kicker--destination">Destination</span>
        {destination === null ? (
          <p className="legend__note">None set. Open the line scrubber (H) and pick a stop.</p>
        ) : (
          <>
            <dl className="stats">
              <div>
                <dt>Block</dt>
                <dd>{destination}{destStop ? ` ${kindLabel(destStop)}` : ''}</dd>
              </div>
              {estimate && (
                <>
                  <div>
                    <dt>Station</dt>
                    <dd>{estimate.station.stop.height}</dd>
                  </div>
                  <div>
                    <dt>Ride length</dt>
                    <dd>{estimate.length} BLOCK{estimate.length === 1 ? '' : 'S'}</dd>
                  </div>
                  <div>
                    <dt>Expected work</dt>
                    <dd>{formatOps(expectedRidePairs(estimate.length))} PAIRS</dd>
                  </div>
                  <div>
                    <dt>Est. time</dt>
                    <dd>{benchMs === null ? 'CALIBRATING' : formatDuration(estimate.length * benchMs)}</dd>
                  </div>
                </>
              )}
            </dl>
            <Explanation>
              STATION is where boarding sets you down: your nearest block as
              of the synced tip, ties to the lowest height. The ride runs from
              it to the destination; all of the per-block work runs locally
              and resumes if interrupted.
            </Explanation>
          </>
        )}
      </div>

      {progress !== null && (
        <>
          <p className="hyper__progress">
            RIDING {progress.done}/{progress.total}
            {progress.etaMs !== null && ` · ETA ${formatMs(progress.etaMs)}`}
          </p>
          <div className="bar">
            <div
              className="bar__fill bar__fill--computing"
              style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 100}%` }}
            />
          </div>
        </>
      )}

      <div className="hyper__actions">
        <button
          className="hyper__btn"
          disabled={!atHead || !ready || destination === null}
          onClick={() => void useCyberspace.getState().boardHyperspace()}
        >BOARD</button>
        {progress === null ? (
          <button
            className="hyper__btn hyper__btn--ride"
            disabled={transit === null || destination === null || !ready}
            onClick={() => void startRide()}
          >RIDE</button>
        ) : (
          <button className="hyper__btn hyper__btn--abort" onClick={abortRide}>ABORT</button>
        )}
      </div>
      {/* A dead button that never says why reads as broken. One line names
          the gate that is actually holding BOARD shut; the answer is never
          proof of work, because boarding itself costs none. */}
      {transit === null && progress === null && (
        !ready ? (
          <p className="hyper__why">BOARD UNLOCKS WHEN THE LINE FINISHES SYNCING</p>
        ) : destination === null ? (
          <p className="hyper__why">BOARD NEEDS A DESTINATION BLOCK: PICK ONE ON THE LINE (H)</p>
        ) : !atHead ? (
          <p className="hyper__why">BOARD STARTS FROM YOUR AVATAR: RETURN TO IT FIRST</p>
        ) : null
      )}
      <button
        className="hyper__btn hyper__btn--earth"
        onClick={viewEarth}
      ><Earth size={12} strokeWidth={2.25} aria-hidden /> EARTH</button>
      {sync.error && <p className="notice">{sync.error}</p>}
      {rideError && <p className="notice">{rideError}</p>}

      <Explanation>
        Your STATION is your nearest block, ties to the lowest height:
        distance is the size of the smallest aligned cube holding you both,
        so far from the line several blocks are equally near and every
        verifier must resolve to the same one. VIEW STATION flies the camera
        there; the viewing bar's RETURN or Escape brings it home at your
        previous zoom. Boarding marks your chain; the ride proves fresh work
        for every block passed and sets you down exactly at the block.
        Leaving is an ordinary hop, so the last mile from any block is
        normal movement.
      </Explanation>
    </section>
  )
}


/**
 * Click-select a stop in the scene: it becomes the destination and the
 * camera flies to it. With the scrubber open the height goes through the
 * scrubber so its readout follows the click; closed, the focus is set
 * directly at the current zoom so a click never yanks the scale.
 */
export function selectStopInScene(height: number): void {
  const hs = useHyperspace.getState()
  hs.setDestination(height)
  // With the scrubber open the height goes through it (its effect flies and
  // marks); a click on the very block it is parked on falls through to the
  // direct path, because a no-op set would fire no effect and no fly.
  if (hs.scrubHeight !== null && hs.scrubHeight !== height) {
    hs.setScrubHeight(height)
    return
  }
  const stop = getStopByHeight(height)
  if (!stop) return
  ownHyperspaceView()
  markViewedStop(stop.height)
  useCyberspace.getState().focusOn(
    stopPosition(stop),
    stopPlane(stop),
    `BLOCK ${stop.height} · ${stop.kind === 'port' ? 'PORT' : 'LANDFALL'}`,
  )
}

/**
 * Fly to Earth: always the planet's centre, at the zoom that frames the
 * whole globe. Shared by the panel's EARTH button and the view menu's.
 *
 * It used to divert to the chosen landfall destination when there was one,
 * meaning to show you where your block comes down. But the focus IS the
 * camera's pivot, so that made EARTH orbit a point on the surface instead
 * of the planet, and there was no way back to a planet-centred view while a
 * destination was picked. Every other control already flies to a block
 * (VIEW STATION, a click in the field, the scrubber); EARTH is the only one
 * that means the planet, so it means the planet unconditionally.
 */
export function viewEarth(): void {
  ownHyperspaceView()
  markViewedStop(null)
  // Earth is a dataspace thing (§9.1): looking at it lines up dataspace, so
  // that RETURN, and the next commit, stay in the plane the planet is in.
  useCyberspace.getState().setPlane(0)
  useCyberspace.getState().focusOn({ x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }, 0, 'EARTH', 52)
}

/**
 * The whole cube, camera on its centre, at a scale where its top and bottom
 * lattices are drawn: the view a hyperjump gives, held still. Stays in the
 * current plane; the lattices take that plane's colours.
 */
export function viewCyberspace(): void {
  ownHyperspaceView()
  markViewedStop(null)
  const plane = useCyberspace.getState().plane
  useCyberspace.getState().focusOn({ x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }, plane, 'CYBERSPACE', 82)
}
