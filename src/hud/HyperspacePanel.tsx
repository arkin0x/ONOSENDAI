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
import { create } from 'zustand'
import { coordToHex, coordToXyz, xyzToCoord, type Plane } from 'cyberspace-core'
import { coordToLatLon } from '../lib/hyperspace/landfall'
import { expectedRidePairs, rideBlocks } from '../lib/hyperspace/ride'
import { calibrate, computeRideProof, leafBenchmarkMs, type RideProgress } from '../lib/hyperspace/ridePool'
import { findStation, nearestStops } from '../lib/hyperspace/station'
import { stopCoordExact, type Stop } from '../lib/hyperspace/stops'
import { formatMs, formatOps, type Position } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { exitHyperspaceView, ownHyperspaceView, getStopByHeight, getStopIndex, stopCount, useHyperspace } from '../store/useHyperspace'

/**
 * Where a stop sits, for the camera. The float64-approximate coordinate is
 * within a metre of the exact one, invisible at any spectate scale; only the
 * signed hyperjump needs the exact coordinate.
 */
export function stopPosition(stop: Stop): Position {
  const { x, y, z } = coordToXyz(stop.coordApprox)
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
  /** Why the last attempt did not produce a signed hyperjump. */
  error: string | null
}

export const useRideRun = create<RideRun>(() => ({ progress: null, error: null }))

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
  const station = findStation(getStopIndex(), here, destination)
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
  useRideRun.setState({ error: null, progress: { done: 0, total: blocks.length, etaMs: null } })
  try {
    const { rootHex, mp } = await computeRideProof(
      { previousEventIdHex: transit.enterEventId, blocks },
      (p) => useRideRun.setState({ progress: p }),
      controller.signal,
    )
    await useCyberspace.getState().completeRide({
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
    useRideRun.setState({ progress: null })
  }
}

const kindLabel = (stop: Stop): string => (stop.kind === 'port' ? 'PORT' : 'LANDFALL')

export function HyperspacePanel(): JSX.Element {
  const sync = useHyperspace((s) => s.sync)
  const viewOwned = useHyperspace((s) => s.viewOwned)
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

  // Your station candidate, live: the stop you would appear at if you boarded
  // here. indexVersion is the store's signal that stops arrived, because the
  // index itself is a mutable structure, not state.
  const nearest = useMemo(() => {
    const here = xyzToCoord(position.x, position.y, position.z, plane)
    return nearestStops(getStopIndex(), here, 1)[0] ?? null
  }, [position, plane, indexVersion])

  // The cost estimate for the chosen destination, from the same findStation
  // call the ride itself will make, so the number you approve is the number
  // you get (§4.2 binds the station to the destination height).
  const estimate = useMemo(() => {
    if (destination === null) return null
    const here = xyzToCoord(position.x, position.y, position.z, plane)
    const station = findStation(getStopIndex(), here, destination)
    if (station === null) return null
    return { station, length: rideBlocks(station.stop.height, destination).length }
  }, [destination, position, plane, indexVersion])

  const destStop = destination !== null ? getStopByHeight(destination) : undefined
  const tag = ready ? `READY ${stopCount()} STOPS`
    : sync.status === 'error' ? 'ERROR'
      : sync.status === 'idle' ? 'IDLE'
        : `SYNCING ${sync.loaded}/${sync.total}`

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Hyperspace</h2>
        <span className={`tag ${sync.status === 'error' ? 'tag--danger' : ''}`}>{tag}</span>
      </header>

      <div className="hyper__group">
        <span className="legend__label">Nearest stop</span>
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
                <dd>h{nearest.distance}</dd>
              </div>
              {nearest.stop.kind === 'landfall' && (
                <div>
                  <dt>Surface</dt>
                  <dd>{formatLatLon(nearest.stop)}</dd>
                </div>
              )}
            </dl>
            <button
              className="avatars__spectate"
              onClick={() => { ownHyperspaceView(); useCyberspace.getState().focusOn(
                stopPosition(nearest.stop),
                stopPlane(nearest.stop),
                `STATION · BLOCK ${nearest.stop.height}`,
                34,
              ) }}
            >VIEW</button>
          </>
        ) : (
          <p className="legend__note">No stops in the index yet.</p>
        )}
      </div>

      <div className="hyper__group">
        <span className="legend__label">Destination</span>
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
                    <dd>{benchMs === null ? 'CALIBRATING' : formatMs(estimate.length * benchMs)}</dd>
                  </div>
                </>
              )}
            </dl>
            <p className="legend__note">
              All of the per-block work runs locally and resumes if interrupted.
            </p>
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
      <button
        className="hyper__btn hyper__btn--earth"
        onClick={() => { ownHyperspaceView(); useCyberspace.getState().focusOn({ x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }, 0, 'EARTH', 52) }}
      >EARTH</button>
      {viewOwned && (
        <button className="hyper__btn hyper__btn--earth" onClick={() => exitHyperspaceView()}>RETURN</button>
      )}

      {sync.error && <p className="notice">{sync.error}</p>}
      {rideError && <p className="notice">{rideError}</p>}

      <p className="legend__note">
        The nearest stop is your station: the stop boarding sets you down at. VIEW flies the camera there; RETURN or Escape brings it home. Boarding marks your chain; the ride proves fresh work for every block
        passed and sets you down exactly at the stop. Leaving is an ordinary
        hop, so the last mile from any stop is normal movement.
      </p>
    </section>
  )
}
