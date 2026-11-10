/**
 * director.ts: what runs the tutorial's staged things while it is up
 * (first-arrival tutorial design, 2026-11-10, Track A2).
 *
 * As the tutorial comes up for a player (store/useTutorial.ts lifecycle), the
 * director lays it out from their spawn (tutorial/layout.ts), stages it under
 * this device's guide key (tutorial/stage.ts, loaded only now, so its pieces
 * stay out of the page everyone loads), and hands the guide's bags to
 * discovery (tutorial/guideBags.ts). As it goes away, the bags go with it.
 *
 * It also registers the waits the steps use for what it staged:
 *   - 'see-chest': the treasure chest has been found (the scan revealed it,
 *     which it does by itself as the player enters the blue box);
 *   - 'open-chest': the player opened it, by hand (useOpenedChests);
 *   - 'take': something from it is in their ITEMS;
 *   - 'at-start': the player stands on the course's start square
 *     (useArrival: where they stand, as their chain's head says);
 *   - 'gravity': WALK with GRAVITY on;
 *   - 'see-finish' and 'take-finish': the finish chest found (the scan does
 *     it as they land on the deck), and something from it taken.
 * Nothing here opens or takes anything (owner, 2026-10-26).
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'
import { onTutorialLifecycle, registerTutorialEffect, registerTutorialWatcher, useTutorial } from '../store/useTutorial'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { spawnPlace } from '../store/useDemo'
import { useShards } from '../store/useShards'
import { useOpenedChests, openedKey } from '../store/useOpenedChests'
import { useInventory } from '../store/useInventory'
import { useWalk } from '../store/useWalk'
import { START_STAND, atStart, courseToWorld, onDeck } from './course'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import type { Position } from '../lib/space'
import { setGuideBags } from './guideBags'
import { inRegion, type TutorialLayout } from './layout'
import type { Stage } from './stage'

interface StageState {
  /** What is staged for the run on screen, once it is. */
  stage: Stage | null
  layout: TutorialLayout | null
  /** Staging failed: the sentence why, for the coach. */
  error: string | null
}

export const useTutorialStage = create<StageState>(() => ({ stage: null, layout: null, error: null }))

/** Which staging is current: a newer start (or a stop) makes an older one's answer moot. */
let run = 0

/** Stage the tutorial for `player` and hand its bags to discovery; a restart stages anew. */
async function stageFor(player: string, restart: boolean): Promise<void> {
  const mine = ++run
  useTutorialStage.setState({ stage: null, layout: null, error: null })
  try {
    const [{ tutorialLayout }, st, { guideKey }] = await Promise.all([import('./layout'), import('./stage'), import('./guide')])
    const spawn = spawnPlace(player)
    const layout = tutorialLayout({ x: spawn.x, y: spawn.y, z: spawn.z }, spawn.plane as Plane)
    const guide = guideKey()
    const current = (): boolean => mine === run && useTutorial.getState().active && useTutorial.getState().pubkey === player
    let stage = restart ? null : st.readStage(player, guide.pubkey, st.stageKey(layout))
    if (!stage) {
      stage = await st.buildStage(guide.secret, player, layout, (at, h) => regionKeyOffThread(at, h, MAX_COMPUTE_HEIGHT))
      // Kept only by the staging still current: one a RESTART overtook never overwrites what replaced it.
      if (!current()) return
      st.writeStage(stage, player)
    }
    if (!current()) return
    // The blue box lets taps through to the chest inside it.
    setGuideBags(stage.bags, { passTaps: [stage.ids.blueBox] })
    useTutorialStage.setState({ stage, layout })
  } catch (err) {
    if (mine !== run) return
    console.warn('[tutorial] staging failed:', err)
    useTutorialStage.setState({ error: 'The chest could not be placed. Try RESTART TUTORIAL in Settings.' })
  }
}

/** The tutorial went away: its bags, and everything they gave, go with it. */
function unstage(): void {
  run++
  const guide = useTutorialStage.getState().stage?.guide
  setGuideBags(null)
  useTutorialStage.setState({ stage: null, layout: null, error: null })
  if (guide) dropGuideFinds(guide)
}

/** Take every find the guide sealed off the screen (the blue box, the chest and what came out of it). */
function dropGuideFinds(guide: string): void {
  const discovered = useShards.getState().discovered
  if (!Object.values(discovered).some((h) => h.author === guide)) return
  useShards.setState({ discovered: Object.fromEntries(Object.entries(discovered).filter(([, h]) => h.author !== guide)) })
}

/**
 * Put the cursor at a place of the layout, at zoom 2^0, as the pad would line
 * it up, so one COMMIT moves you there: only at your head, never in WALK or
 * mid-proof, and only from inside the tutorial's covering region in its
 * plane, so the hop it lines up is a short one (a player who wandered off is
 * not handed a long route). The /demo `aim` counts gibsons along the view's
 * axes; this names the place itself, right whichever way the layout faces.
 * Whether it aimed.
 */
export function aimAt(at: Position, layout: TutorialLayout): boolean {
  const cs = useCyberspace.getState()
  if (!cs.atHead() || cs.walking || cs.proof.status === 'computing') return false
  if (cs.headPlane !== layout.plane || !inRegion(cs.position, layout.cover.base, layout.cover.height)) return false
  if (cs.scaleExp !== 0) cs.adjustScale(-cs.scaleExp)
  useCyberspace.setState({ cursor: { ...at }, plane: layout.plane })
  return true
}

/**
 * A step effect that aims once at a place of the layout, as soon as it can:
 * the stage in, and the player at their head, in the cover (aimAt).
 */
function aimOnce(place: (layout: TutorialLayout) => Position): () => (() => void) | void {
  return () => {
    let aimed = false
    const aim = (): void => {
      const layout = useTutorialStage.getState().layout
      if (aimed || !layout) return
      aimed = aimAt(place(layout), layout)
      if (aimed) off()
    }
    const offs = [useTutorialStage.subscribe(aim), useCyberspace.subscribe((s, prev) => { if (s.proof.status !== prev.proof.status || s.walking !== prev.walking || s.position !== prev.position) aim() })]
    const off = (): void => { for (const o of offs.splice(0)) o() }
    aim()
    return off
  }
}

/** Run `check` now and on every change of the stores it reads, until it says done; then `onDone` once. */
function watchUntil(check: () => boolean, onDone: () => void, subscribe: Array<(l: () => void) => () => void>): () => void {
  let fired = false
  const offs: Array<() => void> = []
  const run = (): void => {
    if (fired || !check()) return
    fired = true
    for (const off of offs.splice(0)) off()
    onDone()
  }
  for (const sub of subscribe) offs.push(sub(run))
  run()
  return () => { for (const off of offs.splice(0)) off() }
}

const onStage = (l: () => void): (() => void) => useTutorialStage.subscribe(l)

registerTutorialWatcher('see-chest', (onDone) => watchUntil(() => {
  const id = useTutorialStage.getState().stage?.ids.chest
  return !!id && !!useShards.getState().discovered[id]
}, onDone, [onStage, (l) => useShards.subscribe((s, prev) => { if (s.discovered !== prev.discovered) l() })]))

registerTutorialWatcher('open-chest', (onDone) => watchUntil(() => {
  const id = useTutorialStage.getState().stage?.ids.chest
  const me = useTutorial.getState().pubkey
  return !!id && !!me && !!useOpenedChests.getState().opened[openedKey(me, id)]
}, onDone, [onStage, (l) => useOpenedChests.subscribe(l)]))

registerTutorialWatcher('take', (onDone) => watchUntil(() => {
  const ids = useTutorialStage.getState().stage?.ids.chestContents ?? []
  const items = useInventory.getState().items
  return ids.some((id) => { const it = items[id]; return !!it && !it.cleared })
}, onDone, [onStage, (l) => useInventory.subscribe((s, prev) => { if (s.items !== prev.items) l() })]))

onTutorialLifecycle({
  start: (player, restart) => { void stageFor(player, restart) },
  stop: unstage,
})

/** The box step lines the cursor up in the blue box, once it is staged, so one COMMIT moves you in. */
registerTutorialEffect('aim-box', aimOnce((layout) => {
  const b = layout.frame.boxBase
  return { x: b.x + 4n, y: b.y + 4n, z: b.z + 4n }
}))

/**
 * Arrival (T7): `inside` is true of where the player stands, their chain's
 * head, in the plane they stand in. One mechanism for the start square and
 * anything else a step waits to be reached.
 */
function watchArrival(inside: (at: Position, layout: TutorialLayout) => boolean, onDone: () => void): () => void {
  return watchUntil(() => {
    const layout = useTutorialStage.getState().layout
    const cs = useCyberspace.getState()
    return !!layout && cs.events.length > 0 && cs.headPlane === layout.plane && inside(cs.position, layout)
  }, onDone, [onStage, (l) => useCyberspace.subscribe((s, prev) => { if (s.position !== prev.position || s.headPlane !== prev.headPlane) l() })])
}

registerTutorialWatcher('at-start', (onDone) => watchArrival((at, layout) => atStart(layout.frame, at), onDone))

registerTutorialWatcher('gravity', (onDone) => watchUntil(
  () => useCyberspace.getState().walking && useWalk.getState().gravity,
  onDone,
  [(l) => useCyberspace.subscribe((s, prev) => { if (s.walking !== prev.walking) l() }), (l) => useWalk.subscribe(l)],
))

/**
 * The finish (T7): standing on the deck, and the finish chest found. Both:
 * a boosted bounce can fly through the deck's region and come down past it,
 * which reveals the chest to a player who did not finish.
 */
registerTutorialWatcher('see-finish', (onDone) => watchUntil(() => {
  const { stage, layout } = useTutorialStage.getState()
  const cs = useCyberspace.getState()
  return !!stage && !!layout && !!useShards.getState().discovered[stage.ids.finishChest] && cs.events.length > 0 && cs.headPlane === layout.plane && onDeck(layout.frame, cs.position)
}, onDone, [onStage, (l) => useShards.subscribe((s, prev) => { if (s.discovered !== prev.discovered) l() }), (l) => useCyberspace.subscribe((s, prev) => { if (s.position !== prev.position || s.headPlane !== prev.headPlane) l() })]))

registerTutorialWatcher('take-finish', (onDone) => watchUntil(() => {
  const ids = useTutorialStage.getState().stage?.ids.finishContents ?? []
  const items = useInventory.getState().items
  return ids.some((id) => { const it = items[id]; return !!it && !it.cleared })
}, onDone, [onStage, (l) => useInventory.subscribe((s, prev) => { if (s.items !== prev.items) l() })]))

/** The course step lines the cursor up on the start square, so one COMMIT moves you there. */
registerTutorialEffect('aim-start', aimOnce((layout) => courseToWorld(layout.frame, START_STAND)))
