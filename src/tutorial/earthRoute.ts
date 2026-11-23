/**
 * earthRoute.ts: the waits and effects of the tutorial's Earth route
 * (tutorial/script.ts EARTH, EARTH_PICK, EARTH_BOARD, EARTH_RIDE; owner,
 * 2026-11-13: one thing per panel). Earth itself is framed by the director's
 * 'view-earth'.
 *
 *   - 'pick-stop' (effect): a tap on a stop in the scene only views it
 *     (HyperspacePanel selectStopInScene: a view only views), so while the
 *     pick step is up the stop tapped is also made the ride's destination,
 *     through setRideDestination as every other way to set one is, but only
 *     when it is a short trip (tutorial/shortTrip.ts; new-user write-up,
 *     2026-11-21: a first trip could take hours or days). A stop further
 *     away is refused and the step says how long it would take. Only a tap
 *     in the scene (onSceneStopTap), never a scrub or VIEW STATION.
 *   - 'pick-stop' (wait): a short trip is the destination, by that tap, a
 *     tap on a trip listed under the caption (hud/EarthTrips.tsx), or any
 *     other way. A state, so one set already counts at once.
 *   - 'ride-step' (effect): 'hyperspace-first', and the step says how long
 *     the trip takes on this device.
 *   - 'hyperspace-first' (effect): the HYPERSPACE panel first in the menu
 *     while BOARD and RIDE are taught (usePanelLayout front), never written to
 *     the player's saved order, and taken away as the step goes.
 *   - 'board-step' (effect): 'hyperspace-first', and while no stop is picked
 *     (the pick step skipped, or its taps missed) the step says to pick one
 *     and a tap on a stop still picks it (new-user feedback, 2026-11-21).
 *   - 'board' (wait): on the line, as the HYPERSPACE panel judges it: in
 *     transit, or a chain head that has boarded or stands at a stop.
 *   - 'ride' (wait): a ride started, here (its proof computing) or by HOSAKA
 *     (paid for and under way: an invoice still open is not a ride yet), or
 *     one landed at another stop since the step came up. Not the ride's end:
 *     nobody waits out a ride to be told they did it.
 *   - 'ride-over' (wait): no ride under way any more, here or by HOSAKA:
 *     it arrived at the stop, or was cancelled, or failed. RIDE's second
 *     wait (TutorialStep advanceOn), armed once the ride has started: the
 *     choices come back only then, never over the ride (owner, 2026-11-14).
 * Nothing here boards, rides or spends anything: those are the player's taps.
 */

import { registerTutorialEffect, registerTutorialWatcher, useTutorial } from '../store/useTutorial'
import { useCyberspace } from '../store/useCyberspace'
import { useHyperspace } from '../store/useHyperspace'
import { usePanelLayout } from '../store/usePanelLayout'
import { lineStateOf } from '../lib/hyperspace/ride'
import { useRideRun } from '../hud/HyperspacePanel'
import { jobInProgress } from '../lib/cloud'
import { MENU_SHUT } from './script'
import { isShortTrip, measureTripSpeed, pickShortStopByTap, tooFarNote, tripBlocks, tripTime, useTripBench } from './shortTrip'
import { rideEstimateMs } from '../lib/hyperspace/ridePool'
import { canRideBigints, RIDE_CAPABILITY_ISSUE } from '../lib/proofCapability'
import { registerTutorialChoice } from '../store/useTutorial'

/**
 * Call `onDone` once `done()` holds, now or after a change in any store
 * `subscribe` lists; returns what stops the watching.
 */
function watchState(done: () => boolean, onDone: () => void, subscribe: Array<(l: () => void) => () => void>): () => void {
  let fired = false
  const offs: Array<() => void> = []
  const stop = (): void => { for (const off of offs.splice(0)) off() }
  const check = (): void => {
    if (fired || !done()) return
    fired = true
    stop()
    onDone()
  }
  for (const sub of subscribe) offs.push(sub(check))
  check()
  return stop
}

/** A change to the chain (its events), transit or HOSAKA's job, never the per-frame position. */
const onChain = (l: () => void): (() => void) => useCyberspace.subscribe((s, prev) => { if (s.events !== prev.events || s.transit !== prev.transit || s.cloud !== prev.cloud) l() })

/** The player's own chain is on the line: in transit, boarded, or at a stop (HyperspacePanel's onLine). */
export function onTheLine(): boolean {
  const cs = useCyberspace.getState()
  return cs.transit !== null || lineStateOf(cs.actions()) !== null
}

/**
 * The pick step's tap (new-user write-up, 2026-11-21: a first trip could
 * take hours or days): a tap on a stop picks it only when it is a short trip
 * from here (tutorial/shortTrip.ts); a stop further away is refused, and the
 * step says how long it would take and points at the short trips listed
 * under the caption (hud/EarthTrips.tsx).
 */
function shortPicks(index: number): () => void {
  return pickShortStopByTap((height) => useTutorial.getState().noteStep(index, tooFarNote(height)))
}

registerTutorialEffect('pick-stop', () => shortPicks(useTutorial.getState().index))

/** A short trip is set: a destination set some other way that would take longer does not count (the tour never rides it). */
function shortDestination(): boolean {
  const d = useHyperspace.getState().destination
  return d !== null && isShortTrip(d)
}

registerTutorialWatcher('pick-stop', (onDone) => watchState(
  shortDestination,
  onDone,
  [
    (l) => useHyperspace.subscribe((s, prev) => { if (s.destination !== prev.destination || s.indexVersion !== prev.indexVersion || s.sync !== prev.sync) l() }),
    (l) => useTripBench.subscribe(l),
  ],
))

/** HYPERSPACE first in the menu, never written to the saved order; returns what takes it away. */
function hyperspaceFirst(): () => void {
  usePanelLayout.getState().setFront('hyperspace')
  return () => { if (usePanelLayout.getState().front === 'hyperspace') usePanelLayout.getState().setFront(null) }
}

registerTutorialEffect('hyperspace-first', hyperspaceFirst)

/** What the BOARD step says in place of its hint while no stop is picked. */
export const BOARD_PICK_FIRST_NOTE = 'Pick a stop first: one of the short trips below.'
/** What glows then: the hamburger while the menu is shut, then BOARD's reason line with its SHOW EARTH and PICK ONE. */
export const BOARD_PICK_FIRST_GLOW = `${MENU_SHUT}, [data-panel-id="hyperspace"] .hyper__why`

/**
 * The BOARD step (new-user feedback, 2026-11-21: BOARD "was never
 * available, so I couldn't ride"). BOARD needs a destination, and the pick
 * step before it can be skipped, or its taps can miss every dot; a tap on a
 * stop then only viewed it, so nothing the player did could ever light
 * BOARD. Now, as long as no stop is picked, the step says to pick one in
 * place of its hint, and a tap on a stop still picks it here, as on the pick
 * step. HYPERSPACE stays first in the menu.
 */
registerTutorialEffect('board-step', () => {
  const index = useTutorial.getState().index
  const unfront = hyperspaceFirst()
  const unpick = shortPicks(index)
  // While no short trip is picked, the note asks for one (the trips are listed under the caption) and the glow is on BOARD's reason line, not on a dark BOARD.
  const note = (): void => {
    const dest = useHyperspace.getState().destination
    const none = dest === null || !isShortTrip(dest)
    useTutorial.getState().noteStep(index, none ? (dest === null ? BOARD_PICK_FIRST_NOTE : tooFarNote(dest)) : null)
    // A long destination: the glow is on the short trips listed under the caption, never on BOARD.
    useTutorial.getState().highlightStep(index, none ? (dest === null ? BOARD_PICK_FIRST_GLOW : TRIPS_GLOW) : null)
  }
  note()
  const off = useHyperspace.subscribe((s, prev) => { if (s.destination !== prev.destination) note() })
  const offBench = useTripBench.subscribe(note)
  return () => { off(); offBench(); unpick(); unfront() }
})

/**
 * The RIDE step: HYPERSPACE first, and the step says plainly what the trip
 * costs in time on this device, in place of its hint.
 */
registerTutorialEffect('ride-step', () => {
  const index = useTutorial.getState().index
  const unfront = hyperspaceFirst()
  // A browser that cannot ride (a resume from another browser, say): said plainly, and SKIP goes on.
  if (!canRideBigints()) {
    useTutorial.getState().noteStep(index, RIDE_CANNOT_NOTE)
    return unfront
  }
  measureTripSpeed()
  // A short trip of a few blocks may still take the tap that changes it; a long one never glows RIDE.
  const unpick = shortPicks(index)
  const note = (): void => {
    const dest = useHyperspace.getState().destination
    const blocks = dest === null ? null : tripBlocks(dest)
    const bench = useTripBench.getState().bench
    const long = dest !== null && !isShortTrip(dest)
    useTutorial.getState().noteStep(index, long ? tooFarNote(dest) : blocks !== null && bench ? rideNote(rideEstimateMs(blocks, bench)) : null)
    useTutorial.getState().highlightStep(index, long ? TRIPS_GLOW : null)
  }
  note()
  const off = useTripBench.subscribe(note)
  const offDest = useHyperspace.subscribe((s, prev) => { if (s.destination !== prev.destination) note() })
  return () => { off(); offDest(); unpick(); unfront() }
})

/** What glows while the destination is not a short trip: the short trips under the caption (hud/EarthTrips.tsx). */
export const TRIPS_GLOW = '.earth-trips'

/** What the RIDE step says on a browser that cannot ride. */
export const RIDE_CANNOT_NOTE = `${RIDE_CAPABILITY_ISSUE} Tap SKIP to try something else.`

/**
 * "Where next?": on a browser that cannot ride (#896, lib/proofCapability.ts
 * canRideBigints: Firefox and Safari), TRAVEL TO EARTH would end at a RIDE
 * that can never start, so SEE EARTH takes its place (tutorial/script.ts
 * EARTH_LOOK): the planet to look at, and why there is no ride. Probed once,
 * when the card first comes up, never on load.
 */
let rideChecked = false
registerTutorialEffect('ride-check', () => {
  if (rideChecked) return
  rideChecked = true
  if (!canRideBigints()) registerTutorialChoice('cannot-ride', { run: () => undefined })
})

/** What the RIDE step says about its trip. */
export function rideNote(ms: number): string {
  return `This trip takes about ${tripTime(ms)} of computing on this device, free. Keep this tab open until you land.`
}

registerTutorialWatcher('board', (onDone) => watchState(onTheLine, onDone, [onChain]))

registerTutorialWatcher('ride', (onDone) => {
  // A stop the chain already stood at when the step came up is not this ride;
  // a ride never ends where it began (a zero-length ride is refused).
  const before = lineStateOf(useCyberspace.getState().actions())?.fromHeight ?? null
  return watchState(
    () => {
      if (useRideRun.getState().progress !== null) return true
      const cs = useCyberspace.getState()
      if (cs.cloud.job?.action === 'ride' && jobInProgress(cs.cloud.status)) return true
      const line = lineStateOf(cs.actions())
      return line !== null && line.fromHeight !== null && line.fromHeight !== before
    },
    onDone,
    [(l) => useRideRun.subscribe(l), onChain],
  )
})

/** A ride under way: its proof computing here, HOSAKA's being planned from the panel, or HOSAKA's paid for and under way. */
export function rideUnderWay(): boolean {
  const run = useRideRun.getState()
  if (run.progress !== null || run.hosaka) return true
  const cs = useCyberspace.getState()
  return cs.cloud.job?.action === 'ride' && jobInProgress(cs.cloud.status)
}

registerTutorialWatcher('ride-over', (onDone) => watchState(
  () => !rideUnderWay(),
  onDone,
  [(l) => useRideRun.subscribe(l), onChain],
))
