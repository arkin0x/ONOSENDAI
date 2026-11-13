/**
 * earthRoute.ts: the waits and effects of the tutorial's Earth route
 * (tutorial/script.ts EARTH, EARTH_PICK, EARTH_BOARD, EARTH_RIDE; owner,
 * 2026-11-13: one thing per panel). Earth itself is framed by the director's
 * 'view-earth'.
 *
 *   - 'pick-stop' (effect): a tap on a stop in the scene only views it
 *     (HyperspacePanel selectStopInScene: a view only views), so while the
 *     pick step is up the stop tapped is also made the ride's destination,
 *     through setRideDestination as every other way to set one is. Only a
 *     tap in the scene (onSceneStopTap), never a scrub or VIEW STATION. A
 *     destination already set is kept, as it always is.
 *   - 'pick-stop' (wait): a destination is set, by that tap or any other way
 *     (the scrubber's SET DESTINATION, GOAL). A state, so one set already
 *     counts at once.
 *   - 'hyperspace-first' (effect): the HYPERSPACE panel first in the menu
 *     while BOARD and RIDE are taught (usePanelLayout front), never written to
 *     the player's saved order, and taken away as the step goes.
 *   - 'board' (wait): on the line, as the HYPERSPACE panel judges it: in
 *     transit, or a chain head that has boarded or stands at a stop.
 *   - 'ride' (wait): a ride started, here (its proof computing) or by HOSAKA
 *     (paid for and under way: an invoice still open is not a ride yet), or
 *     one landed at another stop since the step came up. Not the ride's end:
 *     nobody waits out a ride to be told they did it.
 * Nothing here boards, rides or spends anything: those are the player's taps.
 */

import { registerTutorialEffect, registerTutorialWatcher } from '../store/useTutorial'
import { useCyberspace } from '../store/useCyberspace'
import { useHyperspace } from '../store/useHyperspace'
import { usePanelLayout } from '../store/usePanelLayout'
import { setRideDestination } from '../store/destination'
import { lineStateOf } from '../lib/hyperspace/ride'
import { onSceneStopTap, useRideRun } from '../hud/HyperspacePanel'
import { jobInProgress } from '../lib/cloud'

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

registerTutorialEffect('pick-stop', () => onSceneStopTap((height) => {
  if (useHyperspace.getState().destination === null) setRideDestination(height)
}))

registerTutorialWatcher('pick-stop', (onDone) => watchState(
  () => useHyperspace.getState().destination !== null,
  onDone,
  [(l) => useHyperspace.subscribe((s, prev) => { if (s.destination !== prev.destination) l() })],
))

registerTutorialEffect('hyperspace-first', () => {
  usePanelLayout.getState().setFront('hyperspace')
  return () => { if (usePanelLayout.getState().front === 'hyperspace') usePanelLayout.getState().setFront(null) }
})

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
