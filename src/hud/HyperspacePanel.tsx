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
import { Cloud, Cpu } from 'lucide-react'
import { useVersionGate, VERSION_BLOCKED_MESSAGE } from '../lib/versionGate'
import { create } from 'zustand'
import { coordToHex, coordToXyz, hexToCoord, xyzToCoord, type Plane } from 'cyberspace-core'
import { coordToLatLon } from '../lib/hyperspace/landfall'
import { EARTH_SCALE_EXP } from '../lib/hyperspace/interest'
import { formatLatLonDeg } from '../lib/earthSurface'
import { expectedPricePairs, expectedRidePairs, lineStateOf, zeroLengthRideRefusal } from '../lib/hyperspace/ride'
import { calibrate, computeRideProof, rideBenchmark, rideEstimateMs, rideFraction, type RideBench, type RideProgress } from '../lib/hyperspace/ridePool'
import { findStation } from '../lib/hyperspace/station'
import { stopCoordExact, type Stop } from '../lib/hyperspace/stops'
import { formatMs, formatOps, type Position } from '../lib/space'
import { rideChoice, type RideOffer } from '../lib/cloudRide'
import { rideCapabilityIssue } from '../lib/proofCapability'
import { PAYMENT_SECONDS } from '../lib/crossover'
import { satsLabel } from '../lib/cloud'
import { useNow } from '../hooks/useNow'
import { useRideQuote } from './useRideQuote'

/** Ride estimates run to hours and days; raw seconds read as noise. */
function formatDuration(ms: number): string {
  if (ms < 90_000) return formatMs(ms)
  const m = ms / 60_000
  if (m < 90) return `${m.toFixed(0)} min`
  const h = m / 60
  if (h < 48) return `${h.toFixed(1)} h`
  return `${(h / 24).toFixed(1)} d`
}
import { GAME_HOLDS_MESSAGE, IN_GAME_HERE_MESSAGE, RELAY_STOPPED_MESSAGE, STALE_CONFIRMATION, useCyberspace, whyNoMove, type CompletedRide } from '../store/useCyberspace'
import { useV1HopList } from '../hooks/useChainStop'
import { closeScrubber, exitHyperspaceView, firstUnhashedHeight, getBlockHash, markViewedStop, ownHyperspaceView, getStopByHeight, getStopIndex, stopCount, stopScale, useHyperspace, viewHyperspace } from '../store/useHyperspace'
import { Explanation } from './Explanation'
import { useChainUi } from '../store/useChainUi'
import { setRideDestination } from '../store/destination'
import { runTutorialEffect } from '../store/useTutorial'
import { useNewcomerView } from '../newcomer/useNewcomer'
import { say } from '../newcomer/names'

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

/** VIEW a block: the standard VIEW on it, marked as the viewed block, at stopScale. */
export function viewStop(stop: Stop, label = `BLOCK ${stop.height} · ${stop.kind === 'port' ? 'PORT' : 'LANDFALL'}`, scaleExp = stopScale(stop)): void {
  viewHyperspace(stopPosition(stop), stopPlane(stop), label, scaleExp, stop.height)
}

/** A landfall as a place on Earth: "31.6°N 98.8°W". */
export function formatLatLon(stop: Stop): string {
  const { lat, lon } = coordToLatLon(stop.coordApprox)
  return formatLatLonDeg(lat, lon)
}

interface RideRun {
  /** Non-null while the worker pool is computing a ride proof. */
  progress: RideProgress | null
  /**
   * True while a ride via HOSAKA is being planned and submitted from this
   * panel, before the store holds its job (arkinox, 2026-10-11). After that
   * the store's cloud state says where it is.
   */
  hosaka: boolean
  /** The endpoints of the ride being proven, for the scene's transit ghost. */
  path: { fromHeight: number; toHeight: number } | null
  /** Why the last attempt did not produce a signed hyperjump, or a BOARD that did not board. */
  error: string | null
  /** True from a press of BOARD until it boarded or said why not. */
  boarding: boolean
}

export const useRideRun = create<RideRun>(() => ({ progress: null, hosaka: false, path: null, error: null, boarding: false }))

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

/** A ride planned and ready to prove: everything but the proof. */
interface PlannedRide {
  previousId: string
  fromHeight: number
  /** The station set bound (as_of); absent on a ride chained from a stop. */
  asOf: number | undefined
  destination: number
  destStop: Stop
}

/**
 * Everything a ride needs before its proof, refusing in words on the panel:
 * the head confirmed, no game or broken chain, on the line, the station,
 * never a zero-length ride, and every passed block's hash in the index.
 * Shared by RIDE HERE and RIDE VIA HOSAKA (arkinox, 2026-10-11), so the two
 * can never plan different rides from the same screen.
 */
async function planRide(): Promise<PlannedRide | null> {
  const destination = useHyperspace.getState().destination
  if (destination === null) return null
  // A computing move holds the head (a hop, or a ride HOSAKA is computing):
  // a ride signed meanwhile would move it from under that proof.
  if (useCyberspace.getState().proof.status === 'computing') {
    useRideRun.setState({ error: 'A move is computing. Let it finish or cancel it first.' })
    return null
  }
  // The head is confirmed before any work, not only when the ride is
  // signed: a ride computed from a head another device or tab has moved
  // past is minutes of work nobody can sign (confirmHead).
  riding = true
  let refusal: string | null | typeof STALE_CONFIRMATION
  try { refusal = await useCyberspace.getState().confirmHeadNow() } finally { riding = false }
  // A respawn or an identity switch landed while it asked: this ride was for a chain that is gone.
  if (refusal === STALE_CONFIRMATION) return null
  if (refusal) {
    useRideRun.setState({ error: refusal, progress: null })
    return null
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
    return null
  }
  const line = lineStateOf(useCyberspace.getState().actions())
  if (line === null) {
    if (useCyberspace.getState().transit !== null) {
      useRideRun.setState({ error: 'Your chain moved off the line since boarding. Board again to ride.' })
    }
    return null
  }
  const previousId = line.previousId
  const destStop = getStopByHeight(destination)
  if (destStop === undefined) {
    useRideRun.setState({ error: `Block ${destination} is not in the stop index yet` })
    return null
  }
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
      return null
    }
    const station = findStation(getStopIndex(), here, tip)
    if (station === null) {
      useRideRun.setState({ error: 'No station: no stop at or below the destination height' })
      return null
    }
    fromHeight = station.stop.height
    asOf = tip
  }
  // Never a zero-length ride (arkinox, 2026-10-07): a destination that is
  // the block the ride starts from is refused here, with what to do instead.
  const zero = zeroLengthRideRefusal(fromHeight, destination, line.fromHeight !== null)
  if (zero) {
    useRideRun.setState({ error: zero, progress: null })
    return null
  }
  // Every passed block's hash seeds its leaf work (§5.3); a gap means the
  // sync has not covered that stretch of the line yet. A ride via HOSAKA
  // needs them too: its proof is checked here against these hashes. Checked
  // on the index columns, never by materializing a Stop per block: that put
  // every block of the ride into the stop cache for good, and a ride of
  // 500,000 blocks froze or killed the tab before HOSAKA was ever asked
  // (2026-11-16, a player's ride of 517,354 blocks).
  const gap = firstUnhashedHeight(Math.min(fromHeight, destination) + 1, Math.max(fromHeight, destination))
  if (gap !== null) {
    useRideRun.setState({ error: `Block ${gap} has no hash in the index yet; let the sync finish` })
    return null
  }
  return { previousId, fromHeight, asOf, destination, destStop }
}

/**
 * The blocks a ride computed here passes, with their hashes, for the worker
 * pool. Read from the index columns (getBlockHash), so nothing is cached per
 * block; only RIDE HERE needs them all, and planRide has already checked
 * every one is there.
 */
function rideBlocksWithHashes(fromHeight: number, toHeight: number): Array<{ height: number; blockHash: string }> {
  const blocks: Array<{ height: number; blockHash: string }> = []
  for (let height = Math.min(fromHeight, toHeight) + 1, hi = Math.max(fromHeight, toHeight); height <= hi; height++) {
    const blockHash = getBlockHash(height)
    if (!blockHash) throw new Error(`Block ${height} has no hash in the index yet; let the sync finish`)
    blocks.push({ height, blockHash })
  }
  return blocks
}

/**
 * The view a press of BOARD or RIDE leaves (arkinox, 2026-10-15): a block,
 * EARTH, a /C/ link or VIEW no longer has to be RETURNed from first. The press
 * acts on your chain head, and the camera comes back to your avatar so the
 * boarding is seen where it happens. A spectation or history is not a view
 * and is never ended here: BOARD and RIDE stay dark in those.
 */
export function returnToAvatarForRide(): void {
  const cs = useCyberspace.getState()
  if (cs.spectate !== null || cs.exploreIndex !== null) return
  if (useHyperspace.getState().viewOwned) exitHyperspaceView()
  if (useCyberspace.getState().focus !== null) useCyberspace.getState().clearFocus()
}

/**
 * BOARD: back to your avatar from any view, then board from your chain head.
 * Every press ends boarded or with the reason on the panel, never silent: a
 * BOARD that did nothing read as a broken game (2026-11-16).
 */
export async function boardFromAnywhere(): Promise<void> {
  if (useRideRun.getState().boarding) return
  returnToAvatarForRide()
  useRideRun.setState({ boarding: true, error: null })
  try {
    const refusal = await useCyberspace.getState().boardHyperspace()
    if (refusal) useRideRun.setState({ error: refusal })
  } catch (err) {
    useRideRun.setState({ error: err instanceof Error ? err.message : String(err) })
  } finally {
    useRideRun.setState({ boarding: false })
  }
}

/**
 * Build the job and run the proof. Module-level rather than a handler so the
 * guard against a second concurrent ride is global: two pools racing
 * completeRide against the same boarding would fork the chain.
 */
export async function startRide(): Promise<void> {
  if (riding || useRideRun.getState().hosaka) return
  // A browser whose numbers cannot hold a ride's would fail partway, after
  // minutes of work: refused before any of it.
  const rideIssue = rideCapabilityIssue()
  if (rideIssue) {
    useRideRun.setState({ error: rideIssue })
    return
  }
  const planned = await planRide()
  if (planned === null) return
  const { previousId, fromHeight, asOf, destination, destStop } = planned
  const kept = keptRide && keptRide.previousId === previousId && keptRide.fromHeight === fromHeight && keptRide.toHeight === destination ? keptRide : null
  // Only a proof still to compute needs every block's hash.
  let blocks: Array<{ height: number; blockHash: string }> = []
  if (!kept) {
    try {
      blocks = rideBlocksWithHashes(fromHeight, destination)
    } catch (err) {
      useRideRun.setState({ error: err instanceof Error ? err.message : String(err) })
      return
    }
  }
  const { plane } = useCyberspace.getState()
  riding = true
  const controller = new AbortController()
  rideAbort = controller
  // A HOSAKA ride's old refusal is not about this ride.
  if (useCyberspace.getState().cloud.rideError !== null) useCyberspace.setState({ cloud: { ...useCyberspace.getState().cloud, rideError: null } })
  useRideRun.setState({
    error: null,
    progress: { done: 0, total: Math.abs(destination - fromHeight), etaMs: null, price: null },
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
    const ride: CompletedRide = kept
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

/**
 * RIDE VIA HOSAKA (onosendai-launch #35 P5; arkinox, 2026-10-11): the same
 * ride RIDE HERE would compute, planned by the same planRide, bought from
 * HOSAKA at the price on the button. The store takes it from the submit to
 * the signed hyperjump (rideViaHosaka): the invoice or the balance, the poll,
 * this device's own Level 1 check, the head confirmed, the signature. A
 * quote for a ride other than the one planned now is refused, so the price
 * tapped is the price of the ride bought.
 */
export async function startHosakaRide(offer: RideOffer): Promise<void> {
  if (riding || useRideRun.getState().hosaka) return
  useRideRun.setState({ hosaka: true, error: null })
  try {
    const planned = await planRide()
    if (planned === null) return
    if (planned.fromHeight !== offer.fromHeight || planned.destination !== offer.toHeight) {
      useRideRun.setState({ error: `The ride changed since HOSAKA priced it (it now runs from block ${planned.fromHeight} to block ${planned.destination}). Check the new price and ride again.` })
      return
    }
    const signed = await useCyberspace.getState().rideViaHosaka({
      previousId: planned.previousId,
      fromHeight: planned.fromHeight,
      toHeight: planned.destination,
      asOf: planned.asOf,
      toCoordHex: coordToHex(stopCoordExact(planned.destStop)),
      estSeconds: offer.estSeconds,
    })
    if (signed) useHyperspace.getState().setDestination(null)
  } finally {
    useRideRun.setState({ hosaka: false })
  }
}

/** Where a ride via HOSAKA stands, in the panel's one-line voice. */
function hosakaRideLabel(status: string, progress: number | null, submitting: boolean): string {
  if (submitting) return 'HOSAKA: PLANNING THE RIDE'
  switch (status) {
    case 'quoting': return 'HOSAKA: SUBMITTING'
    case 'awaiting_payment': return 'HOSAKA: AWAITING PAYMENT'
    case 'paid': return 'HOSAKA: PAID, STARTING'
    case 'computing': return `HOSAKA: COMPUTING${progress !== null ? ` ${Math.round(progress * 100)}%` : ''}`
    case 'verifying': return 'HOSAKA: CHECKING AND SIGNING'
    default: return 'HOSAKA'
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
  // Your own chain can act: not history, not someone else's chain. A view of
  // a block or anywhere else does not hold BOARD or RIDE back (arkinox,
  // 2026-10-15); pressing either comes back to your avatar first.
  const ownChain = useCyberspace((s) => s.exploreIndex === null && s.spectate === null)
  // Where the chain head already puts you: boarded (an enter-hyperspace head)
  // or at a stop (a hyperjump head). Neither needs a BOARD.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const line = useMemo(() => lineStateOf(useCyberspace.getState().actions()), [events])
  // A game holds the avatar, or a newer deploy requires a RELOAD
  // (lib/versionGate.ts): BOARD and RIDE stand down, and say why. The
  // gate's verdict is read here so a block shows at once, not at the next
  // change of chain.
  const versionVerdict = useVersionGate((s) => s.verdict)
  // The 5.13 list arriving can stop the chain (lib/chainStop.ts): read again then too.
  const hopList = useV1HopList()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const noMove = useMemo(() => whyNoMove(useCyberspace.getState().actions()), [events, versionVerdict, hopList])
  const inGame = noMove !== null
  const atStop = line !== null && line.fromHeight !== null
  const onLine = transit !== null || line !== null
  const progress = useRideRun((s) => s.progress)
  const rideError = useRideRun((s) => s.error)
  const hosakaPlanning = useRideRun((s) => s.hosaka)
  const boarding = useRideRun((s) => s.boarding)
  // A tap on a stop in the scene picks the destination right now (the tour's pick and board steps).
  const tapPicks = useStopTapPicks((s) => s.on)
  // The newcomer view (newcomer/names.ts): plain names, and a trip time in place of the work figures.
  const plain = useNewcomerView()
  const cloud = useCyberspace((s) => s.cloud)
  const profile = useCyberspace((s) => s.cloudPrefs.profile)
  const ready = sync.status === 'ready'
  // A ride HOSAKA is computing (arkinox, 2026-10-11): the store's job record
  // says so from the submit's answer on, across a reload too; before that,
  // this panel's own flag covers the plan and the submit.
  const hosakaJob = cloud.job?.action === 'ride' ? cloud.job : null
  const cloudBusy = cloud.status !== 'idle' && cloud.status !== 'error'
  const hosakaRiding = hosakaPlanning || (hosakaJob !== null && cloudBusy)
  const now = useNow(hosakaRiding ? 1000 : 0)

  // The pool's measured throughput prices a ride in wall-clock time before
  // you commit to it. Calibrated once, on every worker the ride uses; until
  // the number exists the estimate says so rather than guessing.
  const [bench, setBench] = useState<RideBench | null>(() => rideBenchmark())
  useEffect(() => {
    // Nothing to measure where a ride cannot run (its sample would only throw).
    if (rideCapabilityIssue() !== null) return
    let alive = true
    calibrate().then((b) => { if (alive) setBench(b) }).catch(() => {})
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
      return { from: line.fromHeight, fromLabel: 'At block', length: Math.abs(destination - line.fromHeight) }
    }
    const here = xyzToCoord(position.x, position.y, position.z, plane)
    const asOf = useHyperspace.getState().tipHeight
    const station = findStation(getStopIndex(), here, Math.max(asOf ?? destination, destination))
    if (station === null) return null
    return { from: station.stop.height, fromLabel: 'Station', length: Math.abs(destination - station.stop.height) }
  }, [destination, position, plane, indexVersion, line])

  // A destination that is where the ride would start: refused before RIDE
  // is pressed, with the way to get there (ride elsewhere and back).
  const zeroRide = estimate && destination !== null ? zeroLengthRideRefusal(estimate.from, destination, atStop) : null

  // Whether this browser can ride at all (proofCapability): no estimate,
  // no RIDE HERE and no HOSAKA ride where it cannot, since a bought proof is
  // checked here with the same numbers before it is signed.
  const rideIssue = rideCapabilityIssue()
  // This device's own wait for the ride, as the Est. time row shows it.
  const localMs = estimate && bench !== null && rideIssue === null ? rideEstimateMs(estimate.length, bench) : null
  // HOSAKA's price beside it, when the provider sells rides and this one
  // fits (useRideQuote); hidden otherwise, and never for a zero-length ride.
  // Not asked at all where this browser could not check what it sells.
  const quotable = estimate !== null && !zeroRide && rideIssue === null
  const quote = useRideQuote(quotable ? estimate.from : null, quotable ? destination : null)
  const offer = quote.status === 'ready' ? quote.offer : null
  // The highlighted choice follows the cloud profile; it is only a highlight.
  const best = rideChoice(profile, localMs === null ? null : localMs / 1000, offer, PAYMENT_SECONDS, rideIssue === null)
  const rideDisabled = inGame || !onLine || destination === null || zeroRide !== null || !ready || !ownChain || rideIssue !== null
  // Why RIDE VIA HOSAKA is dark although the price is shown.
  const hosakaHeld = cloudBusy || cloud.job !== null
    ? 'Another HOSAKA job is in progress or kept in the Cloud compute panel'
    : null

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
            onClick={() => { const hs = useHyperspace.getState(); if (hs.scrubHeight === null) hs.setScrubHeight(hs.viewedStop ?? hs.tipHeight ?? 0); else closeScrubber() }}
          >{tag}</button>
        ) : (
          <span className={`tag ${sync.status === 'error' ? 'tag--danger' : ''}`}>{tag}</span>
        )}
      </header>

      <div className="hyper__group">
        <span className="legend__label hyper__kicker hyper__kicker--nearest">{say('Nearest station', plain)}</span>
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
              {!plain && (
                <div>
                  <dt>Distance</dt>
                  <dd>2^{nearest.distance}</dd>
                </div>
              )}
              {nearest.stop.kind === 'landfall' && (
                <div>
                  <dt>Surface</dt>
                  <dd>{formatLatLon(nearest.stop)}</dd>
                </div>
              )}
            </dl>
            <button
              className="hyper__btn hyper__btn--view"
              // 2^34: one render cell is 2 meters, the spec's h34 human
              // scale, so the stop reads as a place you could stand at.
              onClick={() => viewStop(nearest.stop, `STATION · BLOCK ${nearest.stop.height}`, 34)}
            >VIEW STATION</button>
          </>
        ) : (
          <p className="legend__note">No blocks in the index yet.</p>
        )}
      </div>

      <div className="hyper__group">
        <span className="legend__label hyper__kicker hyper__kicker--destination">Destination</span>
        {destination === null ? (
          // How to pick one is BOARD's reason line, with PICK ONE (and SHOW EARTH in the tour), so it is said once.
          <p className="legend__note">None set.</p>
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
                  {!plain && (
                    <>
                      <div>
                        <dt>Ride length</dt>
                        <dd>{estimate.length} BLOCK{estimate.length === 1 ? '' : 'S'}</dd>
                      </div>
                      <div>
                        <dt>Expected work</dt>
                        <dd>{formatOps(expectedRidePairs(estimate.length) + expectedPricePairs(estimate.length))} PAIRS</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt>{say('Est. time', plain)}</dt>
                    {/* The pool's wall-clock per average block; the price is priced in blocks by its pairings. */}
                    <dd>{rideIssue !== null ? 'NOT IN THIS BROWSER' : localMs === null ? 'CALIBRATING' : formatDuration(localMs)}</dd>
                  </div>
                  {quote.status !== 'hidden' && (
                    <div title="What HOSAKA charges to compute this ride's proof, and how long it expects to take">
                      <dt>HOSAKA</dt>
                      <dd>
                        {quote.status === 'loading' ? 'ASKING'
                          : quote.status === 'unavailable' ? 'UNAVAILABLE'
                            : `${satsLabel(quote.offer.costMsats).toUpperCase()}${quote.offer.estSeconds !== null ? ` · ${formatDuration(quote.offer.estSeconds * 1000)}` : ''}`}
                      </dd>
                    </div>
                  )}
                </>
              )}
            </dl>
            <Explanation>
              STATION is where boarding sets you down: your nearest block as
              of the synced tip, ties to the lowest height. The ride runs from
              it to the destination; all of the per-block work runs locally
              and resumes if interrupted. A re-roll price of about one
              thirty-second more follows the blocks, so a proof that skipped
              some cannot cheaply retry its samples. Est. time is measured on
              this device, working the same way the ride does. A phone slows
              or pauses a tab that is hidden or behind another app, so keep
              this tab open and in front until the ride is done.
              {quote.status !== 'hidden' && (
                <>
                  {' '}RIDE VIA HOSAKA buys the same proof from HOSAKA, computed on
                  many machines at once, for the price shown. This device checks
                  it the way every reader checks a hyperjump before signing it; a
                  proof that fails is never signed, and a job HOSAKA cannot finish
                  is refunded to your HOSAKA balance. Nothing is paid until you
                  choose it. The highlighted choice follows your Cloud compute
                  profile: COST rides here, TIME and LOOT take the faster one.
                </>
              )}
            </Explanation>
          </>
        )}
      </div>

      {hosakaRiding && (
        <>
          <p className="hyper__progress">
            {hosakaRideLabel(cloud.status, cloud.progress, hosakaPlanning && hosakaJob === null && !cloudBusy)}
            {cloud.status === 'computing' && hosakaJob?.estSeconds !== undefined && hosakaJob.computingAt !== undefined
              && ` · ETA ${formatDuration(Math.max(0, hosakaJob.computingAt + hosakaJob.estSeconds * 1000 - now))}`}
          </p>
          <div className="bar">
            <div
              className="bar__fill bar__fill--cloud"
              style={{ width: `${Math.round((cloud.status === 'computing' ? cloud.progress ?? 0 : cloud.status === 'verifying' ? 1 : 0) * 100)}%` }}
            />
          </div>
        </>
      )}

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

      {/* Nothing left in the row when the two ways to ride replace RIDE on the line. */}
      {(!onLine || hosakaRiding || progress !== null || offer === null) && (
        <div className="hyper__actions">
          {/* BOARD only when the chain head is off the line. After a ride you
              stand at a stop and the next ride chains from it (§4.3); a second
              enter-hyperspace there is a needless event, and the panel used to
              demand one. */}
          {!onLine && (
            <button
              className="hyper__btn hyper__btn--board"
              disabled={inGame || !ownChain || !ready || destination === null || boarding}
              onClick={() => void boardFromAnywhere()}
            >{say(boarding ? 'BOARDING' : 'BOARD', plain)}</button>
          )}
          {hosakaRiding ? (
            <>
              {cloud.status === 'awaiting_payment' && !cloud.invoiceOpen && (
                <button className="hyper__btn" onClick={() => useCyberspace.getState().setInvoiceOpen(true)}>SHOW INVOICE</button>
              )}
              <button
                className="hyper__btn hyper__btn--abort"
                title="Stop following the HOSAKA job. Unpaid, nothing is charged; paid, the job is kept in the Cloud compute panel for RESUME"
                disabled={hosakaJob === null && !cloudBusy}
                onClick={() => useCyberspace.getState().cancelCloud()}
              >CANCEL</button>
            </>
          ) : progress !== null ? (
            <button className="hyper__btn hyper__btn--abort" onClick={abortRide}>ABORT</button>
          ) : offer === null ? (
            <button
              className="hyper__btn hyper__btn--ride"
              disabled={rideDisabled}
              onClick={() => void startRide()}
            >RIDE</button>
          ) : null}
        </div>
      )}
      {/* Two ways to ride once HOSAKA has priced it: here for free, or bought.
          The profile's choice is lit; neither ever runs without a tap. */}
      {offer !== null && progress === null && !hosakaRiding && (
        <div className="hyper__choice">
          <button
            className={`hyper__btn hyper__choicebtn hyper__choicebtn--here ${best === 'local' ? 'hyper__btn--ride' : ''}`}
            title={rideIssue ?? "Compute the ride's proof on this device. Free; it resumes if interrupted"}
            disabled={rideDisabled}
            onClick={() => void startRide()}
          >
            <Cpu size={12} strokeWidth={2.25} aria-hidden />
            <span className="hyper__choicelabel">RIDE HERE</span>
            <span className="hyper__choicemeta">FREE{localMs !== null ? ` · ${formatDuration(localMs).toUpperCase()}` : ''}</span>
          </button>
          <button
            className={`hyper__btn hyper__choicebtn ${best === 'hosaka' ? 'hyper__btn--ride' : ''}`}
            title={rideIssue ?? hosakaHeld ?? 'HOSAKA computes the proof; this device checks it before signing. You pay the price shown, by invoice or from your HOSAKA balance'}
            disabled={rideDisabled || hosakaHeld !== null}
            onClick={() => void startHosakaRide(offer)}
          >
            <Cloud size={12} strokeWidth={2.25} aria-hidden />
            <span className="hyper__choicelabel">RIDE VIA HOSAKA</span>
            <span className="hyper__choicemeta">
              {satsLabel(offer.costMsats).toUpperCase()}{offer.estSeconds !== null ? ` · ${formatDuration(offer.estSeconds * 1000).toUpperCase()}` : ''}
            </span>
          </button>
        </div>
      )}
      {/* A dead button that never says why reads as broken. One line names
          the gate that is actually holding BOARD shut; the answer is never
          proof of work, because boarding itself costs none. */}
      {inGame && progress === null && (noMove === VERSION_BLOCKED_MESSAGE
        ? <p className="hyper__why">NEW VERSION: RELOAD TO BOARD OR RIDE</p>
        : noMove === GAME_HOLDS_MESSAGE
        ? <p className="hyper__why">A GAME HOLDS YOUR AVATAR: LEAVE THE GAME IN THE CLIENT YOU ENTERED IT WITH, OR RESPAWN, TO BOARD OR RIDE</p>
        : noMove === IN_GAME_HERE_MESSAGE
        ? <p className="hyper__why">IN A GAME: EXIT GAME TO BOARD OR RIDE</p>
        : (
          <p className="hyper__why">
            {noMove === RELAY_STOPPED_MESSAGE ? 'YOUR CHAIN STOPS' : 'YOUR CHAIN IS BROKEN'}: NOTHING MOVES UNTIL YOU RESPAWN
            <button className="tag tag--tap hyper__whybtn" onClick={() => useChainUi.getState().setBrokenView('notice')}>WHY</button>
          </p>
        ))}
      {!inGame && rideIssue && progress === null && <p className="notice" role="status">{rideIssue}</p>}
      {!inGame && zeroRide && progress === null && <p className="notice">{zeroRide}</p>}
      {/* Every gate that holds BOARD dark says so (new-user feedback, 2026-11-21:
          "The board button was never available, so I couldn't ride"). A
          destination missing used to say nothing at all. */}
      {!inGame && !onLine && progress === null && (
        !ready ? (
          <p className="hyper__why">{boardLoadingLine(sync)}</p>
        ) : destination === null ? (
          <p className="hyper__why">
            {tapPicks > 0 ? BOARD_TAP_A_STOP : BOARD_NEEDS_DESTINATION}
            {/* The tour's Earth view again, to tap a stop on; and, everywhere, the overlay's list with SET DESTINATION, for when taps miss. */}
            {tapPicks > 0 && <button className="tag tag--tap hyper__whybtn" onClick={() => runTutorialEffect('view-earth')}>SHOW EARTH</button>}
            <button className="tag tag--tap hyper__whybtn" onClick={openOverlayToPick}>PICK ONE</button>
          </p>
        ) : !ownChain ? (
          <p className="hyper__why">BOARD STARTS FROM YOUR OWN CHAIN: STOP SPECTATING OR LEAVE HISTORY FIRST</p>
        ) : null
      )}
      {atStop && progress === null && (
        <p className="hyper__why">ON THE LINE AT BLOCK {line!.fromHeight}: PICK A BLOCK AND RIDE, OR HOP TO LEAVE</p>
      )}
      {sync.error && <p className="notice">{sync.error}</p>}
      {rideError && <p className="notice">{rideError}</p>}
      {!hosakaRiding && cloud.rideError && <p className="notice">{cloud.rideError}</p>}

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


const stopTapListeners = new Set<(height: number) => void>()

/** What BOARD says while no destination is set and a tap on a stop picks one (the tour's Earth route). */
export const BOARD_TAP_A_STOP = 'PICK A STOP FIRST: TAP A GLOWING DOT ON EARTH'
/** What BOARD says while no destination is set anywhere else: a tap only views a stop there (arkinox, 2026-11-11), so the overlay's SET DESTINATION is the way. */
export const BOARD_NEEDS_DESTINATION = 'BOARD NEEDS A DESTINATION: PICK A STOP, THEN SET DESTINATION'

/** What BOARD says while the stops are still loading, with how far along. Pure. */
export function boardLoadingLine(sync: { status: string; loaded: number; total: number }): string {
  if (sync.status === 'error') return 'THE STOPS DID NOT LOAD YET: TRYING AGAIN. BOARD OPENS WHEN THEY ARE IN'
  const pct = sync.total > 0 ? Math.min(99, Math.floor((sync.loaded / sync.total) * 100)) : 0
  return `LOADING THE STOPS: ${pct}%. BOARD OPENS WHEN THEY ARE ALL IN`
}

/** How many places make a tap on a stop pick the destination now (pickStopByTap); the panel's reason line follows it. */
export const useStopTapPicks = create<{ on: number }>(() => ({ on: 0 }))

/**
 * While it is on, a tap on a stop in the scene also makes it the ride's
 * destination when none is set (the tour's pick and board steps: a tap only
 * views a stop everywhere else, arkinox 2026-11-11), through
 * setRideDestination as every other way to set one is. A destination
 * already set is kept. Returns what turns it off.
 */
export function pickStopByTap(): () => void {
  const off = onSceneStopTap((height) => {
    if (useHyperspace.getState().destination === null) setRideDestination(height)
  })
  useStopTapPicks.setState((s) => ({ on: s.on + 1 }))
  let done = false
  return () => {
    if (done) return
    done = true
    off()
    useStopTapPicks.setState((s) => ({ on: Math.max(0, s.on - 1) }))
  }
}

/** PICK ONE on BOARD's reason line: the Hyperspace overlay, where any block can be found and SET DESTINATION picks it. */
export function openOverlayToPick(): void {
  const hs = useHyperspace.getState()
  if (hs.scrubHeight === null) hs.setScrubHeight(hs.viewedStop ?? hs.tipHeight ?? 0)
}

/**
 * Hear each tap on a stop in the scene (selectStopInScene), by height, before
 * it is viewed: the first-arrival tutorial's pick step makes it the ride's
 * destination (tutorial/earthRoute.ts). Returns what stops the hearing.
 */
export function onSceneStopTap(listener: (height: number) => void): () => void {
  stopTapListeners.add(listener)
  return () => { stopTapListeners.delete(listener) }
}

/**
 * Click a stop in the scene: VIEW it, nothing more (arkinox, 2026-11-11: a
 * view only views; the destination is set on purpose, with SET DESTINATION
 * in the Hyperspace overlay). With the scrubber open the height goes through
 * the scrubber so its readout follows the click.
 */
export function selectStopInScene(height: number): void {
  for (const l of [...stopTapListeners]) { try { l(height) } catch (err) { console.warn('[hyperspace] stop tap listener failed:', err) } }
  const hs = useHyperspace.getState()
  // With the scrubber open the height goes through it (its effect flies and
  // marks); a click on the very block it is parked on falls through to the
  // direct path, because a no-op set would fire no effect and no fly.
  if (hs.scrubHeight !== null && hs.scrubHeight !== height) {
    hs.setScrubHeight(height)
    return
  }
  const stop = getStopByHeight(height)
  if (stop) viewStop(stop)
}

/**
 * Fly to Earth: always the planet's centre, at the zoom that frames the
 * whole globe. Used by the view menu's EARTH button (the HYPERSPACE panel's was removed, 2026-10-15).
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
  // Earth is a dataspace thing (§9.1): looking at it lines up dataspace, so
  // that RETURN, and the next commit, stay in the plane the planet is in.
  useCyberspace.getState().setPlane(0)
  viewHyperspace({ x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }, 0, 'EARTH', EARTH_SCALE_EXP, null)
}

/**
 * The whole cube, camera on its centre, at a scale where its top and bottom
 * lattices are drawn: the view a hyperjump gives, held still. Stays in the
 * current plane; the lattices take that plane's colors.
 */
export function viewCyberspace(scaleExp = 82): void {
  viewHyperspace({ x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }, useCyberspace.getState().plane, 'CYBERSPACE', scaleExp, null)
}
