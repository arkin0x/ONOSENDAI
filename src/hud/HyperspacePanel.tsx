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
import { coordToHex, coordToXyz, hexToCoord, xyzToCoord, type Plane } from 'cyberspace-core'
import { coordToLatLon } from '../lib/hyperspace/landfall'
import { EARTH_SCALE_EXP } from '../lib/hyperspace/interest'
import { formatLatLonDeg } from '../lib/earthSurface'
import { expectedPricePairs, expectedRidePairs, lineStateOf, rideBlocks, zeroLengthRideRefusal } from '../lib/hyperspace/ride'
import { calibrate, computeRideProof, leafBenchmarkMs, rideFraction, type RideProgress } from '../lib/hyperspace/ridePool'
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
import { GAME_HOLDS_MESSAGE, useCyberspace, whyNoMove, type CompletedRide } from '../store/useCyberspace'
import { exitHyperspaceView, markViewedStop, ownHyperspaceView, getStopByHeight, getStopIndex, stopCount, useHyperspace } from '../store/useHyperspace'
import { Explanation } from './Explanation'
import { useChainUi } from '../store/useChainUi'

/**
 * Where a stop sits, for the camera. The float64-approximate coordinate is
 * within a meter of the exact one, invisible at any spectate scale; only the
 * signed hyperjump needs the exact coordinate.
 */
export function stopPosition(stop: Stop): Position {
  // Exact, not approx: the float64 landfall shortcut is good to about a
  // nanometer, which is TENS OF GIBSONS, so at human zooms an approx marker
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
  return formatLatLonDeg(lat, lon)
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

/**
 * A finished ride proof that was not signed: the head check or the signer
 * refused it at the last step. Kept so RIDE again signs it without computing
 * it again (minutes on a phone), as long as it is still the same ride from
 * the same head: the proof is seeded by that head (§5.3), so a head that
 * moved makes it worthless (review of #236).
 */
let keptRide: CompletedRide | null = null

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
  if (destination === null) return
  // The head is confirmed before any work, not only when the ride is
  // signed: a ride computed from a head another device or tab has moved
  // past is minutes of work nobody can sign (confirmHead).
  riding = true
  let refusal: string | null
  try { refusal = await useCyberspace.getState().confirmHeadNow() } finally { riding = false }
  if (refusal) {
    useRideRun.setState({ error: refusal, progress: null })
    return
  }
  // The chain head decides everything: an enter-hyperspace head is a boarding
  // (this session's or one from before a reload), a hyperjump head is standing
  // at its stop and the next ride chains from it with no second boarding
  // (§4.3). Its id is the ride's `previous`, so it is also the seed of every
  // leaf (§5.3) and of the re-roll price (§5.5). The boarding's own id is not
  // used: when the head has moved since (a fork adopted from another device),
  // leaves seeded by it would be published under a different `previous` and
  // every one of them would be wrong.
  // A game holds the avatar, or the chain is broken (useCyberspace
  // whyNoMove): a ride is a base action, and this client signs none then.
  const noRide = whyNoMove(useCyberspace.getState().actions())
  if (noRide) {
    useRideRun.setState({ error: noRide })
    return
  }
  const line = lineStateOf(useCyberspace.getState().actions())
  if (line === null) {
    if (useCyberspace.getState().transit !== null) {
      useRideRun.setState({ error: 'Your chain moved off the line since boarding. Board again to ride.' })
    }
    return
  }
  const previousId = line.previousId
  const destStop = getStopByHeight(destination)
  if (destStop === undefined) {
    useRideRun.setState({ error: `Block ${destination} is not in the stop index yet` })
    return
  }
  const { plane } = useCyberspace.getState()
  // Chained from a stop: the ride starts where the last one ended, and the
  // station set bound is not declared, because no station is computed (§5.2).
  let fromHeight: number
  let asOf: number | undefined
  if (line.fromHeight !== null) {
    fromHeight = line.fromHeight
    asOf = undefined
  } else {
    // §4.2: the station is evaluated over stops with height <= the destination
    // height, so it only becomes a fact of the trip once the destination is
    // fixed. Recompute it here, with the same function the panel's estimate
    // uses, rather than trusting anything cached from before the choice.
    // The station is the boarding's: computed from the coordinate the chain
    // says you boarded at (the line state's, the enter's C), plane bit
    // included, never from `plane`, the plane lined up for the next move,
    // which viewing EARTH sets to dataspace. A station computed in the wrong
    // plane gives the wrong from_height, and the ride is invalid (§4.3).
    const here = hexToCoord(line.coordHex)
    // DECK-0001 v3 §4.2 (as amended): the station set is bounded by a declared
    // as_of height, not the destination. Declare the tip we synced, so the
    // station is the genuine nearest stop; the bound rides in the event.
    const tip = useHyperspace.getState().tipHeight
    if (tip === null || tip < destination) {
      useRideRun.setState({ error: 'The line is not synced past the destination yet.', progress: null })
      return
    }
    const station = findStation(getStopIndex(), here, tip)
    if (station === null) {
      useRideRun.setState({ error: 'No station: no stop at or below the destination height' })
      return
    }
    fromHeight = station.stop.height
    asOf = tip
  }
  // Never a zero-length ride (arkinox, 2026-10-07): a destination that is
  // the block the ride starts from is refused here, with what to do instead.
  const zero = zeroLengthRideRefusal(fromHeight, destination, line.fromHeight !== null)
  if (zero) {
    useRideRun.setState({ error: zero, progress: null })
    return
  }
  // Every passed block's hash seeds its leaf work (§5.3); a gap means the
  // sync has not covered that stretch of the line yet.
  const blocks: Array<{ height: number; blockHash: string }> = []
  for (const height of rideBlocks(fromHeight, destination)) {
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
    progress: { done: 0, total: blocks.length, etaMs: null, price: null },
    path: { fromHeight, toHeight: destination },
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
    const kept = keptRide
    const ride: CompletedRide = kept && kept.previousId === previousId && kept.fromHeight === fromHeight && kept.toHeight === destination
      ? kept
      : {
          previousId,
          asOf,
          toCoordHex: coordToHex(stopCoordExact(destStop)),
          fromHeight,
          toHeight: destination,
          ...await computeRideProof(
            { previousEventIdHex: previousId, blocks },
            (p) => useRideRun.setState({ progress: p }),
            controller.signal,
          ),
        }
    keptRide = ride
    await useCyberspace.getState().completeRide(ride)
    keptRide = null
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
  const building = useHyperspace((s) => s.field.building)
  const sync = useHyperspace((s) => s.sync)
  const indexVersion = useHyperspace((s) => s.indexVersion)
  const destination = useHyperspace((s) => s.destination)
  const transit = useCyberspace((s) => s.transit)
  const events = useCyberspace((s) => s.events)
  const position = useCyberspace((s) => s.position)
  // The plane you stand in, not the one lined up for the next move: a
  // boarding and its station are where the chain head is (boardHyperspace).
  const plane = useCyberspace((s) => s.headPlane)
  const atHead = useCyberspace((s) => s.atHead())
  // Where the chain head already puts you: boarded (an enter-hyperspace head)
  // or at a stop (a hyperjump head). Neither needs a BOARD.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const line = useMemo(() => lineStateOf(useCyberspace.getState().actions()), [events])
  // A game holds the avatar: BOARD and RIDE stand down, and say why.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const noMove = useMemo(() => whyNoMove(useCyberspace.getState().actions()), [events])
  const inGame = noMove !== null
  const atStop = line !== null && line.fromHeight !== null
  const onLine = transit !== null || line !== null
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
    // From a stop, the ride starts at the stop; no station is involved.
    if (line !== null && line.fromHeight !== null) {
      return { from: line.fromHeight, fromLabel: 'At block', length: rideBlocks(line.fromHeight, destination).length }
    }
    const here = xyzToCoord(position.x, position.y, position.z, plane)
    const asOf = useHyperspace.getState().tipHeight
    const station = findStation(getStopIndex(), here, Math.max(asOf ?? destination, destination))
    if (station === null) return null
    return { from: station.stop.height, fromLabel: 'Station', length: rideBlocks(station.stop.height, destination).length }
  }, [destination, position, plane, indexVersion, line])

  // A destination that is where the ride would start: refused before RIDE
  // is pressed, with the way to get there (ride elsewhere and back).
  const zeroRide = estimate && destination !== null ? zeroLengthRideRefusal(estimate.from, destination, atStop) : null

  const destStop = destination !== null ? getStopByHeight(destination) : undefined
  // DRAWING while the stop field is still chipping its rebuild out across
  // frames (12 ms a slice), READY when it has committed. Same shape either
  // way, so the button does not jump; the first word is the whole signal.
  const tag = ready ? `${building ? 'DRAWING' : 'READY'} ${stopCount()} BLOCKS`
    : sync.status === 'error' ? 'ERROR'
      : sync.status === 'idle' ? 'IDLE'
        : sync.status === 'loading-cache'
          ? `LOADING ${sync.loaded}/${sync.total}`
          : `SYNCING ${sync.loaded}/${sync.total}`

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Hyperspace</h2>
        {ready ? (
          <button
            className="tag tag--tap"
            title="Open the Hyperspace overlay (H)"
            onClick={() => { const hs = useHyperspace.getState(); if (hs.scrubHeight === null) hs.setScrubHeight(hs.tipHeight ?? 0); else exitHyperspaceView() }}
          >{tag}</button>
        ) : (
          <span className={`tag ${sync.status === 'error' ? 'tag--danger' : ''}`}>{tag}</span>
        )}
      </header>

      <div className="hyper__group">
        <span className="legend__label hyper__kicker hyper__kicker--nearest">Nearest station</span>
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
                // 2^34: one render cell is 2 meters, the spec's h34 human
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
          <p className="legend__note">None set. Open the Hyperspace overlay (H) to see any block or tap one in the HUD.</p>
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
                    <dt>{estimate.fromLabel}</dt>
                    <dd>{estimate.from}</dd>
                  </div>
                  <div>
                    <dt>Ride length</dt>
                    <dd>{estimate.length} BLOCK{estimate.length === 1 ? '' : 'S'}</dd>
                  </div>
                  <div>
                    <dt>Expected work</dt>
                    <dd>{formatOps(expectedRidePairs(estimate.length) + expectedPricePairs(estimate.length))} PAIRS</dd>
                  </div>
                  <div>
                    <dt>Est. time</dt>
                    {/* The benchmark is per average block; the price is priced in blocks by its pairings. */}
                    <dd>{benchMs === null ? 'CALIBRATING' : formatDuration((estimate.length + expectedPricePairs(estimate.length) / expectedRidePairs(1)) * benchMs)}</dd>
                  </div>
                </>
              )}
            </dl>
            <Explanation>
              STATION is where boarding sets you down: your nearest block as
              of the synced tip, ties to the lowest height. The ride runs from
              it to the destination; all of the per-block work runs locally
              and resumes if interrupted. A re-roll price of about one
              thirty-second more follows the blocks, so a proof that skipped
              some cannot cheaply retry its samples.
            </Explanation>
          </>
        )}
      </div>

      {progress !== null && (
        <>
          <p className="hyper__progress">
            {progress.price === null
              ? `RIDING ${progress.done}/${progress.total}`
              : `PRICE ${progress.price.attempts}/~${progress.price.expected}`}
            {progress.etaMs !== null && ` · ETA ${formatMs(progress.etaMs)}`}
          </p>
          <div className="bar">
            <div
              className="bar__fill bar__fill--computing"
              style={{ width: `${rideFraction(progress) * 100}%` }}
            />
          </div>
        </>
      )}

      <div className="hyper__actions">
        {/* BOARD only when the chain head is off the line. After a ride you
            stand at a stop and the next ride chains from it (§4.3); a second
            enter-hyperspace there is a needless event, and the panel used to
            demand one. */}
        {!onLine && (
          <button
            className="hyper__btn"
            disabled={inGame || !atHead || !ready || destination === null}
            onClick={() => void useCyberspace.getState().boardHyperspace()}
          >BOARD</button>
        )}
        {progress === null ? (
          <button
            className="hyper__btn hyper__btn--ride"
            disabled={inGame || !onLine || destination === null || zeroRide !== null || !ready || (transit === null && !atHead)}
            onClick={() => void startRide()}
          >RIDE</button>
        ) : (
          <button className="hyper__btn hyper__btn--abort" onClick={abortRide}>ABORT</button>
        )}
      </div>
      {/* A dead button that never says why reads as broken. One line names
          the gate that is actually holding BOARD shut; the answer is never
          proof of work, because boarding itself costs none. */}
      {inGame && progress === null && (noMove === GAME_HOLDS_MESSAGE
        ? <p className="hyper__why">A GAME HOLDS YOUR AVATAR: LEAVE THE GAME IN THE CLIENT YOU ENTERED IT WITH, OR RESPAWN, TO BOARD OR RIDE</p>
        : (
          <p className="hyper__why">
            YOUR CHAIN IS BROKEN: NOTHING MOVES UNTIL YOU RESPAWN
            <button className="tag tag--tap hyper__whybtn" onClick={() => useChainUi.getState().setBrokenView('notice')}>WHY</button>
          </p>
        ))}
      {!inGame && zeroRide && progress === null && <p className="notice">{zeroRide}</p>}
      {!inGame && !onLine && progress === null && (
        !ready ? (
          <p className="hyper__why">BOARD UNLOCKS WHEN THE LINE FINISHES SYNCING</p>
        ) : destination === null ? null : !atHead ? (
          <p className="hyper__why">BOARD STARTS FROM YOUR AVATAR: RETURN TO IT FIRST</p>
        ) : null
      )}
      {atStop && progress === null && (
        <p className="hyper__why">ON THE LINE AT BLOCK {line!.fromHeight}: PICK A BLOCK AND RIDE, OR HOP TO LEAVE</p>
      )}
      <button
        className="hyper__btn hyper__btn--earth"
        onClick={viewEarth}
      ><Earth size={12} strokeWidth={2.25} aria-hidden /> EARTH</button>
      {sync.error && <p className="notice">{sync.error}</p>}
      {rideError && <p className="notice">{rideError}</p>}

      <Explanation>
        Each block in the bitcoin blockchain is a railway station in cyberspace.
        Identities can enter their nearest block for free, produce a nominally
        easy proof to move between stations, and exit at the exact coordinate of
        their desired station. This is called hyperspace. Blocks ending with a
        binary 0 are mapped to Earth, and blocks ending with a binary 1 are
        mapped to the rest of cyberspace. Without hyperspace, no identity would
        be capable of traveling any significant distance. Bitcoin's blockchain
        is used for stations because nobody can control where the next station
        (block) will appear. The hyperspace railway grows consistently and
        unpredictably and autonomously without the possibility of manipulation.
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
  useCyberspace.getState().focusOn({ x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }, 0, 'EARTH', EARTH_SCALE_EXP)
}

/**
 * The whole cube, camera on its centre, at a scale where its top and bottom
 * lattices are drawn: the view a hyperjump gives, held still. Stays in the
 * current plane; the lattices take that plane's colors.
 */
export function viewCyberspace(scaleExp = 82): void {
  ownHyperspaceView()
  markViewedStop(null)
  const plane = useCyberspace.getState().plane
  useCyberspace.getState().focusOn({ x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }, plane, 'CYBERSPACE', scaleExp)
}
