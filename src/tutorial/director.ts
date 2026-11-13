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
 *   - 'take': the tutorial tree's DNA from it is in their ITEMS;
 *   - 'at-start': the player stands on the course's start square
 *     (useArrival: where they stand, as their chain's head says);
 *   - 'gravity': WALK with GRAVITY on;
 *   - 'see-finish' and 'take-finish': the finish chest found (the scan does
 *     it as they land on the deck), and something from it taken;
 *   - 'workshop': the workshop opened and closed again;
 *   - 'at-plot' and 'plant': at the dirt plot, and a seed of their own planted.
 * Nothing here opens or takes anything (owner, 2026-10-26).
 */

import { create } from 'zustand'
import type { Plane } from 'cyberspace-core'
import { onTutorialLifecycle, registerTutorialEffect, registerTutorialWatcher, useTutorial } from '../store/useTutorial'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../store/useCyberspace'
import { spawnPlace } from '../store/useDemo'
import { copyLinedUp, positionOf, useShards } from '../store/useShards'
import { useOpenedChests, openedKey } from '../store/useOpenedChests'
import { useInventory } from '../store/useInventory'
import { useWalk } from '../store/useWalk'
import { useWorkshop } from '../store/useWorkshop'
import { useBuilder } from '../store/useBuilder'
import { seedItemOf } from '../lib/seeds/seedItem'
import { dnaResolver } from '../lib/seeds/seedSources'
import { TUTORIAL_DNA, TUTORIAL_DNA_EVENT, tutorialDnaId, tutorialSeedDraft } from './dna'
import { SEED_HIDE_MAX, dnaMatches, seedHideFor } from '../lib/seeds/plant'
import { bloomReachAt } from '../lib/seeds/bloomReach'
import { positionHex, type NostrEvent } from '../lib/events'
import { buildPlane, buildStepOf } from '../lib/buildCursor'
import { viewHyperspace } from '../store/useHyperspace'
import { EARTH_SCALE_EXP } from '../lib/hyperspace/interest'
import { PLOT_STAND, START_STAND, atStart, courseToWorld, onDeck, onPlot, plantCell } from './course'
import { regionKeyOffThread } from '../lib/regionKeyOffThread'
import { deployPoint, type Position } from '../lib/space'
import { setGuideBags } from './guideBags'
import { OWNER_PUBKEY } from './script'
import { arrivalCell, chestCell, inRegion, toWorld, type TutorialLayout } from './layout'
import type { Stage } from './stage'
import { HOP_FRAME_MS, setTutorialFrame, setTutorialSpin, setTutorialZoom, useTutorialCam, type HopFrame } from '../store/useTutorialCam'
import { afterHop, holdGlide } from '../lib/hopStage'
import { setMenuOpen } from '../hooks/useMenuOpen'
import { usePanelLayout } from '../store/usePanelLayout'
import { assignToFolder, createFolderPath } from '../store/useShardFolders'
import type { ShardModel } from 'sno-core/shards'

/**
 * A comfortable orbit distance (render cells) to ease in to once the player
 * HOPs onto the course, so the platform is not looked at from far away
 * (feedback item 6). START_DISTANCE is 26; this is closer.
 */
const COURSE_ZOOM = 12

/**
 * How close the camera comes after the first hop, in render cells: over the
 * avatar's shoulder, the chest just past it in view (owner, 2026-11-12).
 */
const SHOULDER_ZOOM = 6

/** Lift the ITEMS panel to the top of the left menu column (feedback items 2 and 11b). */
function itemsToTop(): void {
  const { order, move } = usePanelLayout.getState()
  const first = order.left.find((id) => id !== 'items') ?? null
  move('items', first, 'left')
}

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

/** The stager, the layout from `player`'s spawn and the guide key, loaded only when the tutorial needs them. */
async function setupFor(player: string): Promise<{ st: typeof import('./stage'); layout: TutorialLayout; guide: { pubkey: string; secret: Uint8Array } }> {
  const [{ tutorialLayout }, st, { guideKey }] = await Promise.all([import('./layout'), import('./stage'), import('./guide')])
  const spawn = spawnPlace(player)
  return { st, layout: tutorialLayout({ x: spawn.x, y: spawn.y, z: spawn.z }, spawn.plane as Plane), guide: guideKey() }
}

/** Stage the tutorial for `player` and hand its bags to discovery; a restart stages anew. */
async function stageFor(player: string, restart: boolean): Promise<void> {
  const mine = ++run
  useTutorialStage.setState({ stage: null, layout: null, error: null })
  try {
    const { st, layout, guide } = await setupFor(player)
    // A RESTART after a FINISH that kept its finds local (stop keeps them):
    // drop the old run's before staging a new chest, so none are orphaned.
    if (restart) dropGuideFinds(guide.pubkey)
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

/**
 * A load for a player who FINISHed (feedback item 9): the stage the run kept
 * on this device goes back to discovery, so what FINISH left on screen is
 * still there after a reload. Local only, as it always was; nothing is staged
 * anew, and a run starting meanwhile wins.
 */
async function restoreKept(player: string): Promise<void> {
  const mine = ++run
  try {
    const { st, layout, guide } = await setupFor(player)
    const stage = st.readStage(player, guide.pubkey, st.stageKey(layout))
    if (!stage || mine !== run || useTutorial.getState().active || useCyberspace.getState().identity.pubkey !== player) return
    setGuideBags(stage.bags, { passTaps: [stage.ids.blueBox] })
  } catch (err) {
    console.warn('[tutorial] could not put the kept stage back:', err)
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
    const offs = [useTutorialStage.subscribe(aim), useCyberspace.subscribe((s, prev) => { if (s.proof.status !== prev.proof.status || s.walking !== prev.walking || s.position !== prev.position || s.focus !== prev.focus) aim() })]
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

/**
 * The tutorial tree's DNA as this identity holds it, taken from the welcome
 * chest (tutorial feedback 2026-11-12, item 8): the owner's signed event, in
 * ITEMS (archived counts, cleared off the list does not), or null.
 */
export function heldTutorialDna(): NostrEvent | null {
  const it = useInventory.getState().items[TUTORIAL_DNA_EVENT.id]
  return it && !it.cleared && it.type === 'dna' ? it.event : null
}

/** Taken: the moon blossom's DNA, the thing the plant step plants, is in ITEMS (item 8). */
registerTutorialWatcher('take', (onDone) => watchUntil(
  () => heldTutorialDna() !== null,
  onDone,
  [(l) => useInventory.subscribe((s, prev) => { if (s.items !== prev.items) l() })],
))

onTutorialLifecycle({
  start: (player, restart) => { void stageFor(player, restart) },
  // FINISH keeps what was staged on screen, local only (feedback item 9): the
  // course, the chests and what was taken stay. A skip or a pause takes it all
  // away. The spin and the zoom are the run's either way.
  stop: (how) => {
    setTutorialSpin(false)
    setTutorialZoom(null)
    setTutorialFrame(null)
    if (how !== 'finished') unstage()
  },
  restore: (player) => { void restoreKept(player) },
})

/**
 * The box step lines the cursor up level with the chest, two gibsons in front
 * of it with one empty gibson between (tutorial feedback 2026-11-12, item 1):
 * the chest stands in line with the spawn (layout.ts chestCell), so one
 * COMMIT from there runs straight at it at its own height, and the avatar,
 * which turns to face the way it moved (lib/facing.ts), ends looking at it;
 * from anywhere else, the chest's side nearest the player. While the step is
 * up the camera idles a slow spin around the cursor (feedback item 14); it
 * stops when the step moves on.
 */
registerTutorialEffect('aim-box', () => {
  setTutorialSpin(true)
  const off = aimOnce((layout) => { const a = arrivalCell(layout, useCyberspace.getState().position); return toWorld(layout.frame, a.f, a.r, a.u) })()
  // COMMIT frames the hop; the landing eases in over the shoulder toward the chest where the stage put it.
  const offHop = showFirstHop((layout) => { const c = chestCell(layout); return toWorld(layout.frame, c.f, c.r, c.u) })
  return () => { setTutorialSpin(false); if (off) off(); offHop() }
})

/**
 * The first hop, shown so a newcomer sees it (owner, 2026-11-12: "when they
 * hit commit we pre-position the camera ... so that the user can tell oh I
 * just moved and this red ball is me"). The first COMMIT while the box step
 * is up (the cursor is lined up for it) stops the spin and frames that hop,
 * start and end from the side, while the proof is made; the avatar waits
 * where it is until the camera is there (HOP_FRAME_MS), then glides. Once it
 * has arrived (lib/hopStage.ts afterHop), the camera eases in close over its
 * shoulder, from behind it as seen from the chest (`chest`, the layout's),
 * so the chest is just past it; discovery, which reveals the chest, runs
 * then too. A hop that does not land puts the spin back. A player who takes
 * the camera meanwhile (a press, a pinch, the wheel: scene/Scene.tsx ends the
 * framing) keeps it: no shot follows. Returns the stop.
 */
export function showFirstHop(chest: (layout: TutorialLayout) => Position): () => void {
  let live = true
  let to: Position | null = null
  let framed: HopFrame | null = null
  const offStore = useCyberspace.subscribe((s, prev) => {
    if (to === null) {
      // COMMIT: a hop's proof has started, from where you stand to its target.
      if (!s.pendingTarget || prev.pendingTarget || s.walking) return
      to = { ...s.pendingTarget }
      framed = { from: { ...s.position }, to }
      setTutorialSpin(false)
      setTutorialFrame(framed)
      holdGlide(performance.now() + HOP_FRAME_MS)
      return
    }
    if (s.position !== prev.position && s.position.x === to.x && s.position.y === to.y && s.position.z === to.z) {
      // Landed: the shot over the shoulder, once the avatar has arrived, and
      // only while the hop is still framed (nobody took the camera).
      const landed = { ...s.position }
      const mine = framed
      to = null
      offStore()
      afterHop(() => {
        if (!live || useTutorialCam.getState().frame !== mine) return
        setTutorialFrame(null)
        const layout = useTutorialStage.getState().layout
        if (!layout) return
        const c = chest(layout)
        const from = { x: Number(landed.x - c.x), y: Number(landed.y - c.y), z: Number(landed.z - c.z) }
        if (from.x !== 0 || from.y !== 0 || from.z !== 0) setTutorialZoom(SHOULDER_ZOOM, from)
      })
      return
    }
    if (!s.pendingTarget) {
      // The hop did not land (refused, cancelled, or the chain replaced under
      // it): the box step as it was, and the avatar is not held for it.
      to = null
      holdGlide(0)
      if (useTutorialCam.getState().frame === framed) {
        setTutorialFrame(null)
        setTutorialSpin(true)
      }
      framed = null
    }
  })
  return () => { live = false; offStore(); if (useTutorialCam.getState().frame === framed) setTutorialFrame(null) }
}

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
 *
 * Standing, too: the walk has landed, stopped, and has nothing left to
 * prove. A jump's hops are made when it comes down (store/useWalk.ts), so a
 * bounce that overshoots the deck lands first and its head then passes
 * through the deck on the way to where it came down, on the floor below or
 * past it; and a walker still running lands on the deck's edge and runs on
 * off it. "You made it" came up there, with the chest twelve gibsons
 * overhead and behind the coach (arkinox, 2026-11-13: "having a lot of
 * trouble tapping on the chest").
 */
registerTutorialWatcher('see-finish', (onDone) => watchUntil(() => {
  const { stage, layout } = useTutorialStage.getState()
  const cs = useCyberspace.getState()
  const walk = useWalk.getState()
  const landed = !walk.falling && walk.behind === 0 && walk.running === null && walk.open === null
  return !!stage && !!layout && landed && !!useShards.getState().discovered[stage.ids.finishChest] && cs.events.length > 0 && cs.headPlane === layout.plane && onDeck(layout.frame, cs.position)
}, onDone, [onStage, (l) => useShards.subscribe((s, prev) => { if (s.discovered !== prev.discovered) l() }), (l) => useCyberspace.subscribe((s, prev) => { if (s.position !== prev.position || s.headPlane !== prev.headPlane) l() }), (l) => useWalk.subscribe((s, prev) => { if (s.falling !== prev.falling || s.behind !== prev.behind || s.running !== prev.running || s.open !== prev.open) l() })]))

registerTutorialWatcher('take-finish', (onDone) => watchUntil(() => {
  const ids = useTutorialStage.getState().stage?.ids.finishContents ?? []
  const items = useInventory.getState().items
  return ids.some((id) => { const it = items[id]; return !!it && !it.cleared })
}, onDone, [onStage, (l) => useInventory.subscribe((s, prev) => { if (s.items !== prev.items) l() })]))

/**
 * The course step lines the cursor up on the start square, so one COMMIT HOPs
 * you there, and eases the orbit camera in close once you land, so the
 * platform is not looked at from far away (feedback item 6).
 */
registerTutorialEffect('to-course', () => {
  const offAim = aimOnce((layout) => courseToWorld(layout.frame, START_STAND))()
  let zoomed = false
  const check = (): void => {
    if (zoomed) return
    const { layout } = useTutorialStage.getState()
    const cs = useCyberspace.getState()
    if (layout && cs.events.length > 0 && cs.headPlane === layout.plane && atStart(layout.frame, cs.position)) {
      zoomed = true
      setTutorialZoom(COURSE_ZOOM)
      offPos()
    }
  }
  const offPos = useCyberspace.subscribe((s, prev) => { if (s.position !== prev.position || s.headPlane !== prev.headPlane) check() })
  check()
  // The zoom outlives the step, which moves on before the ease ends; WALK or
  // a grab of the camera ends it (scene/Scene.tsx), as does the run's end.
  return () => { if (offAim) offAim(); offPos() }
})

/** The inventory step opens the menu and lifts ITEMS to the top of it (feedback item 2). */
registerTutorialEffect('teach-inventory', () => { setMenuOpen(true); itemsToTop() })

/** NEXT on the inventory step closes the menu again, as the hamburger does (feedback 2026-11-12, item 15). */
registerTutorialEffect('close-menu', () => { setMenuOpen(false) })

/** The friend step adds the owner as a TARGET and opens the menu (feedback item 11a). */
registerTutorialEffect('add-friend', () => {
  setMenuOpen(true)
  try { useCyberspace.getState().addTarget(OWNER_PUBKEY, 'arkinox') } catch (err) { console.warn('[tutorial] add friend failed:', err) }
})

/** The build step opens the menu with ITEMS at the top, to place a shard from (feedback item 11b). */
registerTutorialEffect('teach-build', () => { setMenuOpen(true); itemsToTop() })

/**
 * The workshop opened, and closed again: the player has been in it (the next
 * step comes up as they come out). DEPLOY closes the workshop and lines the
 * shard up to place: the step waits until that is placed or dropped, so the
 * next card never comes up over a placement and takes its keys.
 */
registerTutorialWatcher('workshop', (onDone) => {
  let been = useWorkshop.getState().open
  return watchUntil(() => {
    if (useWorkshop.getState().open) { been = true; return false }
    return been && useShards.getState().pending === null
  }, onDone, [(l) => useWorkshop.subscribe((s, prev) => { if (s.open !== prev.open) l() }), (l) => useShards.subscribe((s, prev) => { if (s.pending !== prev.pending) l() })])
})

/** The folder the tutorial files its copies in, and the prefix of their ids: how a copy is told from the player's own shards. */
export const TUTORIAL_FOLDER = 'Tutorial'
export const TUTORIAL_SHARD_ID = 'tutorial-'

/** The course piece the workshop opens on: one the player ran across. */
const OPEN_ON = 'Trampoline'

/**
 * Every shard the player found in this run, copied into the workshop
 * (tutorial feedback 2026-11-12, item 10; never done outside the tutorial, so
 * the workshop is not empty on its first visit): what the guide sealed in the
 * world that the scan revealed (the green box, the course, the dirt), and what
 * the player took out of the tutorial's chests. One copy per name, under an id
 * made from it (TUTORIAL_SHARD_ID), so running this again adds nothing
 * (useWorkshop addShard refuses an id it has), filed in the Tutorial folder.
 * Local only: nothing is published. The copy to open the workshop on, or null.
 */
export function copyTutorialShards(): string | null {
  const stage = useTutorialStage.getState().stage
  if (!stage) return null
  const found = new Map<string, ShardModel>()
  for (const h of Object.values(useShards.getState().discovered)) {
    if (h.author === stage.guide && h.type === 'shard' && h.shard && !found.has(h.shard.name)) found.set(h.shard.name, h.shard)
  }
  const chests = new Set([stage.ids.chest, stage.ids.finishChest])
  for (const it of Object.values(useInventory.getState().items)) {
    if (it.cleared || it.type !== 'shard' || !it.shard || !it.from || !chests.has(it.from.chestId) || found.has(it.shard.name)) continue
    found.set(it.shard.name, it.shard)
  }
  if (found.size === 0) return null
  const ws = useWorkshop.getState()
  const ids: string[] = []
  for (const [name, model] of found) {
    const id = TUTORIAL_SHARD_ID + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    ws.addShard(model, name, id)
    if (useWorkshop.getState().shards.some((m) => m.id === id)) ids.push(id)
  }
  const folder = createFolderPath([TUTORIAL_FOLDER])
  if (folder && ids.length > 0) assignToFolder(ids, folder)
  // The Trampoline, copied now or on an earlier run; else a piece found this run other than the green box.
  const open = TUTORIAL_SHARD_ID + OPEN_ON.toLowerCase()
  if (useWorkshop.getState().shards.some((m) => m.id === open)) return open
  return ids.find((id) => id !== `${TUTORIAL_SHARD_ID}green-box`) ?? ids[0] ?? null
}

/**
 * The workshop as the tutorial opens it (item 10): the shards found copied in,
 * one of the course's on the bench, and its MENU open so the player sees
 * their stuff. `opening` opens it too (OPEN WORKSHOP); otherwise the workshop
 * was just opened some other way (the menu's button) and is pointed at it.
 */
function tutorialWorkshop(opening: boolean): void {
  const id = copyTutorialShards()
  const ws = useWorkshop.getState()
  if (opening) ws.openWorkshop(id ?? undefined, 'menu')
  else { if (id) ws.select(id); useWorkshop.setState({ openPanel: 'menu' }) }
}

/**
 * Whether this workshop step has set the workshop up already: only its first
 * opening is pointed at a course piece with the MENU up, never a later one
 * (back from a DEPLOY's CANCEL, a REMIX), which keeps the shard it names.
 */
let setUp = false

/** OPEN WORKSHOP in the coach: the same workshop the menu's button opens, set up for the tutorial the first time (item 10). */
registerTutorialEffect('open-workshop', () => {
  if (setUp) { useWorkshop.getState().openWorkshop(); return }
  setUp = true
  tutorialWorkshop(true)
})

/**
 * The workshop step: the found shards are copied in as it comes up (again as
 * the workshop opens, by then all found), and its first opening by any way is
 * set up the same (item 10).
 */
registerTutorialEffect('workshop-step', () => {
  setUp = false
  copyTutorialShards()
  return useWorkshop.subscribe((s, prev) => {
    if (!s.open || prev.open || setUp) return
    setUp = true
    tutorialWorkshop(false)
  })
})

/**
 * Earth through the free view, as the view menu's EARTH shows it, but in the
 * player's own plane: EARTH lines up dataspace for the next move (it is a
 * dataspace place), and a newcomer in ideaspace would come back from the
 * tutorial in the other plane with nothing they know around them. The view
 * shows Earth's plane by itself, and RETURN puts the scene back in theirs.
 * Looking costs nothing; only a ride does (T9).
 */
registerTutorialEffect('view-earth', () => {
  viewHyperspace({ x: 1n << 84n, y: 1n << 84n, z: 1n << 84n }, 0, 'EARTH', EARTH_SCALE_EXP, null)
})

/** At the dirt plot (A5): standing on it, as the chain's head says. */
registerTutorialWatcher('at-plot', (onDone) => watchArrival((at, layout) => onPlot(layout.frame, at), onDone))

/**
 * The tutorial tree planted (A5): a seed of the player's own on the dirt,
 * growing the tutorial DNA (the owner's published event, TUTORIAL_DNA_ID, or
 * a copy of its text the player's SEED signed), and out (published)
 * unless they are LOCAL. Planting is theirs: PLANT THE SEED lines it up in
 * BUILD, and HIDE runs the deploy that mines its work (the Seeds client,
 * store/useShards), whose row appears only once the seed is mined and its
 * bag written. A state, not "since the step came up": a reload after
 * planting finds it planted.
 */
export function tutorialTreePlanted(onUnknown?: () => void, ownerId: string | null = tutorialDnaId()): boolean {
  const layout = useTutorialStage.getState().layout
  if (!layout) return false
  const live = useCyberspace.getState().live
  return useShards.getState().mine.some((d) => {
    if (d.type !== 'seed' || !d.inner || (live && !d.published)) return false
    if (d.plane !== layout.plane || !onPlot(layout.frame, positionOf(d))) return false
    const seed = seedItemOf(d.inner)
    if (!seed) return false
    if (ownerId !== null && seed.dnaId === ownerId) return true
    const v = dnaResolver.verdict(seed.dnaId)
    if (!v || v.state === 'fetching') { if (onUnknown) void dnaResolver.resolve(seed.dnaId).then(onUnknown, onUnknown); return false }
    return v.state === 'ok' && v.text === TUTORIAL_DNA.text
  })
}

registerTutorialWatcher('plant', (onDone) => {
  let again: () => void = () => {}
  const off = watchUntil(() => tutorialTreePlanted(() => again()), onDone, [onStage, (l) => { again = l; return useShards.subscribe((s, prev) => { if (s.mine !== prev.mine) l() }) }])
  return () => { again = () => {}; off() }
})

/**
 * PLANT THE SEED (the plant step's button): BUILD on the player, where they
 * stand on the dirt, with the tutorial tree lined up to hide, as SEED's
 * PLANT lines one up (hud/SeedCompose; the composer offers the DNAs it
 * lists, not this tree). The seed names the owner's published event at its
 * own size limit; that event is in the welcome chest, and the player plants
 * the copy they took into ITEMS (heldTutorialDna), noted on this device
 * first, so no relay is needed for it; not taken, it says to take it. Another
 * id waits until its event is on this device's relays, as SEED does; with
 * no id the player's SEED signs a copy of the DNA. HIDE
 * is still the player's: nothing is mined or hidden here. `reachAt` measures
 * the bloom (SEED's measure by default); `stillHere` says whether the plant
 * step is still up, asked again after the measure's wait.
 */
export async function lineUpTutorialSeed(id: string | null = tutorialDnaId(), reachAt?: (p: Position) => Promise<number | undefined>, stillHere: () => boolean = () => true): Promise<string | null> {
  // What is lined up already: the tree itself (a second tap while it waits or
  // mines does nothing), a copy AGAIN left lined up (stood down), or
  // anything else, which is the player's to finish or cancel first.
  const lined = (): string | null => {
    const sh = useShards.getState()
    if (sh.pending?.type === 'seed' && sh.pending.seed.text === TUTORIAL_DNA.text) return ''
    if (sh.deployStatus !== 'working' && copyLinedUp(sh)) sh.cancelDeploy()
    const now = useShards.getState()
    return now.pending || now.deployStatus === 'working' ? 'Finish or cancel what is lined up first.' : null
  }
  const first = lined()
  if (first !== null) return first || null
  let draft = tutorialSeedDraft(null)
  if (id) {
    // The tutorial tree comes from the welcome chest (item 8): planted from
    // the DNA the player took, noted on this device (the resolver checks its
    // signature), so no relay is needed for it.
    if (id === TUTORIAL_DNA_EVENT.id) {
      const held = heldTutorialDna()
      if (!held) return TAKE_DNA_FIRST
      dnaResolver.note(held)
    }
    const v = await dnaResolver.resolve(id)
    if (v.state === 'ok' && !dnaMatches(v.event, TUTORIAL_DNA.text, v.caps)) return 'The tutorial tree on your relays is not this one. Tell the owner.'
    if (v.state !== 'ok') return 'The tutorial tree is not on your relays yet. Try again soon.'
    draft = tutorialSeedDraft(id, v.caps)
    // Asked again after the wait: something may have been lined up meanwhile.
    const again = lined()
    if (again !== null) return again || null
  }
  // On the dirt, at zoom 2^0, with the build cursor on the dirt beside your
  // avatar (course.ts plantCell; feedback 2026-11-12, item 6): the seed then
  // lands exactly there (space.ts deployPoint at step 0), never on a cursor
  // moved elsewhere or a view's cell.
  const layout = useTutorialStage.getState().layout
  const cs = useCyberspace.getState()
  if (!layout) return 'The dirt is not placed yet.'
  if (cs.spectate) return 'Stop watching, then PLANT THE SEED.'
  const plantAt = plantCell(layout.frame, cs.position)
  if (cs.walking || cs.events.length === 0 || cs.headPlane !== layout.plane || !plantAt) return 'Stand on the dirt first.'
  if (useBuilder.getState().active) useBuilder.getState().exit()
  if (useCyberspace.getState().focus) useCyberspace.getState().clearFocus(true)
  if (useCyberspace.getState().scaleExp !== 0) useCyberspace.getState().adjustScale(-useCyberspace.getState().scaleExp)
  useBuilder.getState().enter('build')
  // BUILD starts its cursor, and its plane, where you look, which is not
  // always the dirt (a cursor moved before, a view in the other plane): the
  // cursor goes on the dirt beside you, and the plane is the one you stand
  // in. In BUILD's driven view setPlane sets the plane you build in.
  const here = useCyberspace.getState()
  useCyberspace.setState({ cursor: { ...plantAt } })
  useCyberspace.getState().setPlane(here.headPlane)
  const s = useCyberspace.getState()
  const point = deployPoint(s.cursor, buildStepOf(s), SEED_HIDE_MAX)
  if (!useBuilder.getState().active || buildPlane(s) !== layout.plane || !onPlot(layout.frame, point)) {
    if (useBuilder.getState().active) useBuilder.getState().exit()
    return 'Stand on the dirt first.'
  }
  // Its hide height, as SEED finds it (owner ruling 2026-11-10): the smallest
  // from 3 to 12 whose cube holds this DNA's bloom at its last day where it lands, 12
  // when none does; carried as the draft's fit, which the deploy uses for
  // this very cursor and step (plant.ts seedDraftHeight).
  const cursor = { ...s.cursor }
  const step = buildStepOf(s)
  const found = await seedHideFor(cursor, layout.plane, step, MAX_COMPUTE_HEIGHT, reachAt ?? bloomReachAt(draft.text, draft.caps, layout.plane, draft.scale))
  // Asked again after the measure, which waits: the tutorial moved on (then
  // nothing is lined up, and BUILD this opened closes if it holds nothing),
  // something was lined up, BUILD was left, or the cursor, step or plane moved.
  if (!stillHere()) {
    if (useBuilder.getState().active && useShards.getState().pending === null) useBuilder.getState().exit()
    return null
  }
  const late = lined()
  if (late !== null) return late || null
  if (!useBuilder.getState().active) return 'BUILD was left. Tap PLANT THE SEED again.'
  const now = useCyberspace.getState()
  if (positionHex(now.cursor, layout.plane) !== positionHex(cursor, layout.plane) || buildStepOf(now) !== step || buildPlane(now) !== layout.plane) return 'The cursor moved. Tap PLANT THE SEED again.'
  if (found.reach !== undefined) draft = { ...draft, fit: { height: found.height, reach: found.reach, cursor: positionHex(cursor, layout.plane), step } }
  useShards.getState().startDeploySeed(draft)
  return null
}

/** The plant step's note when the moon blossom was never taken from the welcome chest (item 8). */
export const TAKE_DNA_FIRST = `Take the ${TUTORIAL_DNA.name.toUpperCase()} DNA from the welcome chest first.`

/** Whether a PLANT THE SEED is measuring now: a second tap meanwhile does nothing. */
let planting = false
export function tutorialSeedMeasuring(): boolean {
  return planting
}

registerTutorialEffect('plant-tutorial-seed', () => {
  if (planting) return
  // The answer is the plant step's own note, and only while that step is still up.
  const t = useTutorial.getState()
  const index = t.index
  const pubkey = t.pubkey
  const stillHere = (): boolean => { const n = useTutorial.getState(); return n.active && n.index === index && n.pubkey === pubkey }
  planting = true
  // Measuring the bloom takes a moment.
  t.noteStep(index, 'One moment.')
  void lineUpTutorialSeed(tutorialDnaId(), undefined, stillHere).then((why) => useTutorial.getState().noteStep(index, why), (err: unknown) => {
    console.warn('[tutorial] could not line the seed up:', err)
    useTutorial.getState().noteStep(index, 'The seed could not be lined up. Try PLANT THE SEED again.')
  }).finally(() => { planting = false })
})

/** The bud: out of BUILD (planting leaves a copy of the seed lined up), so the next step's COMMIT is there to tap. */
registerTutorialEffect('leave-build', () => {
  if (useBuilder.getState().active) useBuilder.getState().exit()
})

/** The plot step lines the cursor up on the dirt, so one COMMIT moves you there. */
registerTutorialEffect('aim-plot', aimOnce((layout) => toWorld(layout.frame, PLOT_STAND.f, PLOT_STAND.r, PLOT_STAND.u)))
