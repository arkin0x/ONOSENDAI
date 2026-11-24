/**
 * padMode.ts - the pad's modes, the one ring the mode button turns, and the
 * WALK toggle beside it.
 *
 * HOP plans a move and COMMIT sends it; VIEW is a free look from your head;
 * WALK is first person, every press a step (store/useWalk.ts); BUILD places
 * things at a build cursor and never moves you (store/useBuilder.ts).
 *
 * The mode button in the commit slot goes HOP, VIEW, BUILD, SCAN and back to
 * HOP (arkinox, 2026-11-11; SCAN between BUILD and HOP, 2026-11-14). BUILD
 * starts where VIEW was looking (useBuilder `enter` keeps a driven view's
 * cursor), and SCAN where BUILD's cursor was (buildToScan). B, the Stash
 * panel's BUILD, a DEPLOY, EXIT and Esc go in and out of BUILD as they
 * always have, and out of BUILD is HOP (arkinox, 2026-11-17; useBuilder
 * `exit`); N goes in and out of SCAN (store/useScan.ts).
 *
 * WALK is not in the ring: it is a toggle in RECALL's slot (arkinox,
 * 2026-11-12). With the cursor on your avatar and nothing under way, in HOP,
 * VIEW or BUILD alike, that slot is WALK, dim, and the mode button is lit.
 * Pressing WALK lights it and dims the mode button, which keeps the mode
 * WALK was entered from (enterWalk). In WALK, the lit WALK or the dim mode
 * button goes back to that mode (leaveWalk), VIEW and BUILD at your avatar.
 * While steps wait on their proofs the slot is STOP, as before. With the
 * cursor off your avatar the slot is RECALL, which brings it home and stays
 * in the mode: VIEW (viewToAvatar), BUILD (useBuilder `toAvatar`), HOP
 * (useCyberspace `cancel`), and then WALK is back (`recall`).
 *
 * MODES (owner, 2026-11-24; store/modeOrder.ts) makes all of this the
 * default list: the player can put the modes in any order and switch some
 * off. The first is where the app starts (watchStartMode), the first on
 * after it is the second button in RECALL's slot (WALK's place above), and
 * the ring is the first and every other mode on. A mode not in the ring (the
 * second button's, or one switched off and asked for by name, as B asks for
 * BUILD) is a visit: the mode button is the way back, dim, as in WALK.
 * Going between two modes keeps the hand-offs above where the default ring
 * has them (BUILD where VIEW looked, SCAN where BUILD's cursor was), and
 * otherwise leaves the one mode for HOP at your head and enters the other
 * from there (switchMode). With the default list every press does exactly
 * what it did before.
 */

import { samePosition, useCyberspace, VIEW_FOCUS_LABEL } from './useCyberspace'
import { dropViewReturns, useBuilder } from './useBuilder'
import { copyLinedUp, useShards } from './useShards'
import { useWalk } from './useWalk'
import { regionAtOriginalSize, useRegion } from './useRegion'
import { landFly } from '../lib/viewFly'
import { buildPlane, placedCursor } from '../lib/buildCursor'
import { SCAN_FOCUS_LABEL, scanBuying, useScan } from './useScan'
import { customModesApply, effectiveModes, modeInfo, modeRoles, nextInRing, useModes, type ModeId } from './modeOrder'
import { refuseTerrain, terrainRefusal, useTerrain } from './useTerrain'

export type PadMode = 'hop' | 'view' | 'walk' | 'build' | 'scan' | 'terrain'

/**
 * The mode the pad is in. WALK and BUILD never stand together: BUILD's view
 * takes you off your head, which ends WALK. SCAN is the standard VIEW made
 * SCAN's (store/useScan.ts), so it counts only while that view is up.
 */
export function padMode(walking: boolean, building: boolean, viewing: boolean, scanning = false, terrain = false): PadMode {
  // TERRAIN walks under WALK (store/useTerrain.ts): it is TERRAIN while it is on.
  if (terrain) return 'terrain'
  if (walking) return 'walk'
  if (building) return 'build'
  if (viewing && scanning) return 'scan'
  if (viewing) return 'view'
  return 'hop'
}

/** The pad's mode now, read from the stores. */
export function currentPadMode(): PadMode {
  const cs = useCyberspace.getState()
  return padMode(cs.walking, useBuilder.getState().active, cs.viewing(), useScan.getState().active, useTerrain.getState().active)
}

/**
 * A deploy lined up that leaving BUILD would cancel: that is CANCEL's (or
 * Escape's) to end (useBuilder `exit`), so the ring and WALK wait for it.
 * A copy lined up again after a placement is not one: leaving stands it down.
 */
export function buildHeld(shards = useShards.getState()): boolean {
  return shards.pending !== null && !copyLinedUp(shards)
}

/**
 * Out of BUILD and back to HOP: the mode ends, and the view it rode ends too,
 * so the cursor and the camera are home at your head.
 * Every way out of BUILD does this now (arkinox, 2026-11-17; useBuilder
 * `exit`). Spectating, there is no HOP to go to: the scene goes back to
 * watching them. Nothing while a deploy is lined up.
 */
export function buildToHop(): void {
  useBuilder.getState().exit()
}

/**
 * BUILD to SCAN (arkinox, 2026-11-14): BUILD ends, and SCAN starts where the
 * build cursor was, in its plane, at the zoom you are at: the standard VIEW
 * on that spot, made SCAN's. Nothing while a deploy is lined up (buildHeld).
 * Spectating, the spectation ends, as VIEW HERE ends it.
 */
export function buildToScan(): void {
  const b = useBuilder.getState()
  if (!b.active) return
  const before = useCyberspace.getState()
  const at = { ...placedCursor(before) }
  const plane = buildPlane(before)
  b.exit({ handoff: true })
  if (useBuilder.getState().active) return
  useCyberspace.getState().focusOn(at, plane, SCAN_FOCUS_LABEL, undefined, true, false, { view: true })
  useScan.getState().enter()
}

/**
 * SCAN to HOP: the mode ends, and the view it rode ends too, at the zoom you
 * are at, so the cursor and the camera are home at your head, as BUILD's
 * turn of the ring does. A scan under way keeps running (store/useScan.ts).
 */
export function scanToHop(): void {
  if (!useScan.getState().active) return
  useScan.getState().exit()
}

/**
 * VIEW left for a mode, not for a RETURN: a Nearby list, a door's card or
 * the Secrets list it came from stays shut (#675).
 */
function leaveViewForMode(): void {
  dropViewReturns()
}

/** VIEW to BUILD: BUILD starts where the view is looking (useBuilder `enter` keeps a driven view's cursor). */
function viewToBuild(): void {
  leaveViewForMode()
  useBuilder.getState().enter('build')
}

/**
 * BUILD to VIEW, for a list that puts VIEW after BUILD: BUILD ends, and VIEW
 * starts where the build cursor was, as SCAN does (buildToScan).
 */
function buildToView(): void {
  const b = useBuilder.getState()
  if (!b.active) return
  const before = useCyberspace.getState()
  const at = { ...placedCursor(before) }
  const plane = buildPlane(before)
  b.exit({ handoff: true })
  if (useBuilder.getState().active) return
  useCyberspace.getState().focusOn(at, plane, VIEW_FOCUS_LABEL, undefined, true, false, { view: true })
}

/** VIEW ended, back to HOP at your head at the zoom you are at. */
function viewToHop(): void {
  const cs = useCyberspace.getState()
  if (!cs.viewing()) return
  landFly(true)
  leaveViewForMode()
  useRegion.getState().exit()
  useCyberspace.getState().clearFocus(true)
}

/** Out of `from` to HOP at your head. False when it could not (a deploy lined up in BUILD). */
function toHop(from: PadMode): boolean {
  switch (from) {
    case 'hop': return true
    case 'walk':
      leaves++
      useWalk.getState().exit()
      return !useCyberspace.getState().walking
    case 'build':
      if (buildHeld()) return false
      buildToHop()
      return !useBuilder.getState().active
    case 'scan': scanToHop(); return !useScan.getState().active
    case 'view': viewToHop(); return !useCyberspace.getState().viewing()
    case 'terrain':
      void useTerrain.getState().exit()
      return !useTerrain.getState().active && !useCyberspace.getState().walking
  }
}

/** Into `to` from HOP, the way each mode is entered from there. */
function fromHop(to: PadMode): void {
  switch (to) {
    case 'hop': return
    case 'view': useCyberspace.getState().viewHere(); return
    case 'build': useBuilder.getState().enter('build'); return
    case 'scan': useScan.getState().enter(); return
    case 'walk': enterWalk(); return
    case 'terrain': openTerrain('hop'); return
  }
}

/**
 * From the mode the pad is in to `to`. The default ring's hand-offs are kept
 * (HOP to VIEW, VIEW to BUILD where it looked, BUILD to SCAN at its cursor,
 * SCAN to HOP), as are the ones a list can add between the views (VIEW and
 * SCAN share their view; BUILD to VIEW at its cursor). Anything else leaves
 * the mode for HOP at your head and enters `to` from there. Nothing while a
 * deploy is lined up in BUILD (buildHeld). WALK is entered the pad's way
 * (enterWalk), so it remembers where it came from.
 */
export function switchMode(to: PadMode, opts?: { noFall?: boolean }): void {
  const from = currentPadMode()
  if (from === to) return
  if (from === 'build' && buildHeld()) return
  if (to === 'walk') { enterWalk(opts); return }
  if (to === 'terrain') { enterTerrainMode(); return }
  if (from === 'walk' || from === 'terrain') {
    if (!toHop(from)) return
    fromHop(to)
    return
  }
  if (from === 'hop') { fromHop(to); return }
  if (from === 'view' && to === 'build') { viewToBuild(); return }
  if (from === 'view' && to === 'scan') { useScan.getState().enter(); return }
  if (from === 'build' && to === 'scan') { buildToScan(); return }
  if (from === 'build' && to === 'view') { buildToView(); return }
  if (from === 'scan' && to === 'view') { useScan.getState().exit(true); return }
  if (from === 'scan' && to === 'build') {
    useScan.getState().exit(true)
    if (useCyberspace.getState().viewing()) viewToBuild()
    else useBuilder.getState().enter('build')
    return
  }
  if (!toHop(from)) return
  fromHop(to)
}

/**
 * Where the dim mode button goes back to from a mode not in the ring: WALK's
 * own `from` (enterWalk), else the mode the second button was pressed from,
 * else the last ring mode the pad was in, else the first mode.
 */
export function backOf(current: PadMode = currentPadMode()): ModeId {
  if (current === 'walk') return useWalk.getState().from
  if (current === 'terrain' && terrainFrom !== 'terrain' && terrainFrom !== 'walk') return terrainFrom
  const { start, ring } = modeRoles()
  const { back, lastRing } = useModes.getState()
  // Only a mode still in the ring: one switched off since is no way back.
  if (back && back !== current && ring.includes(back)) return back
  if (lastRing && lastRing !== current && ring.includes(lastRing)) return lastRing
  return start
}

/** Whether `mode` is in the ring the pad follows now. */
export function inRing(mode: PadMode = currentPadMode()): boolean {
  return modeRoles().ring.includes(mode)
}

/**
 * The mode button. In a ring mode, one step round the ring (with the
 * default list: HOP, VIEW, BUILD, SCAN, HOP). In any other mode, the dim
 * mode button: back to where that mode was entered from (backOf), as WALK
 * has gone back since 2026-11-12.
 */
export function cycleMode(): void {
  const cur = currentPadMode()
  const s = effectiveModes()
  if (!inRing(cur)) { goBack(); return }
  // A mode that will not open here (WALK while spectating, in history or in
  // transit) is passed over for the one after it, so the ring never sticks.
  let next = nextInRing(s, cur)
  for (let i = 0; i < s.order.length && next !== cur; i++) {
    switchMode(next)
    if (currentPadMode() !== cur) return
    next = nextInRing(s, next)
  }
}

/**
 * Out of a mode not in the ring, back to where it came from (backOf). WALK
 * the pad's way (leaveWalk). A way back that will not open here falls back
 * to the first mode, then to HOP, so the dim button never does nothing.
 */
export function goBack(): void {
  const cur = currentPadMode()
  if (cur === 'walk') { leaveWalk(); return }
  const back = backOf(cur)
  useModes.setState({ back: null })
  for (const to of [back, modeRoles().start, 'hop' as const]) {
    if (to === cur) continue
    switchMode(to)
    if (currentPadMode() !== cur) return
  }
}

/**
 * The second button (RECALL's slot at rest): into its mode, remembering the
 * mode it was pressed from (WALK keeps it in useWalk `from`). In that mode,
 * the lit second button goes back (goBack).
 */
export function pressSecond(): void {
  const { second } = modeRoles()
  if (!second) return
  const cur = currentPadMode()
  if (cur === second) { goBack(); return }
  if (second === 'walk') { enterWalk(); return }
  // The way back is a ring mode: from a mode outside it, where that one goes back to.
  const back = inRing(cur) ? cur : backOf(cur)
  switchMode(second)
  if (currentPadMode() === second) useModes.setState({ back })
}

/**
 * Keep the last ring mode the pad was in (backOf), as the pad changes mode.
 * Returns what stops it (App).
 */
export function watchLastRing(): () => void {
  let was: PadMode | null = null
  const note = (): void => {
    const now = currentPadMode()
    if (now === was) return
    was = now
    if (inRing(now) && useModes.getState().lastRing !== now) useModes.setState({ lastRing: now })
    // The second button's way back lasts only while its mode does: left another way (N, B, Esc), it is forgotten.
    if (useModes.getState().back !== null && now !== modeRoles().second) useModes.setState({ back: null })
  }
  const offs = [useCyberspace.subscribe(note), useBuilder.subscribe(note), useScan.subscribe(note), useTerrain.subscribe(note)]
  note()
  return () => { for (const off of offs) off() }
}

/**
 * WALK from the pad (arkinox, 2026-11-12), from HOP, VIEW, BUILD or SCAN, kept as
 * the mode to go back to. WALK is first person at your head, so VIEW's view
 * ends (useWalk `enter`) and BUILD ends as the ring ends it (buildToHop).
 * Nothing while a deploy is lined up in BUILD, which is PLACE's or CANCEL's
 * to settle (buildHeld), nor off your own head (spectating, in history, in
 * hyperspace transit), where there is no head to walk from.
 */
export function enterWalk(opts?: { noFall?: boolean }): void {
  const from = currentPadMode()
  if (from === 'walk') return
  const cs = useCyberspace.getState()
  if (cs.spectate !== null || cs.exploreIndex !== null || cs.transit !== null) return
  // From TERRAIN (which walks under WALK): TERRAIN ends first, and WALK goes back to HOP.
  if (from === 'terrain') { if (!toHop('terrain')) return; useWalk.getState().enter(opts); return }
  if (from === 'build') {
    if (buildHeld()) return
    buildToHop()
    if (useBuilder.getState().active) return
  }
  if (from === 'view' || from === 'scan') leaveViewForMode()
  if (from === 'scan') useScan.getState().exit(true)
  useWalk.getState().enter(opts)
  if (useCyberspace.getState().walking) useWalk.setState({ from })
}

/** How many times WALK has been left the pad's way (leaveWalk), so SET EYE's TRY WALK can tell that from any other end (store/tryEye.ts). */
let leaves = 0
export const walkLeaves = (): number => leaves

/**
 * Out of WALK, back to the mode it was entered from: the walk ends as leaving
 * WALK always has (steps not yet proved are dropped, what was signed stays),
 * then VIEW, BUILD or SCAN comes back on at your avatar.
 */
export function leaveWalk(): void {
  leaves++
  const { from } = useWalk.getState()
  useWalk.getState().exit()
  if (useCyberspace.getState().walking) return
  if (from === 'view') useCyberspace.getState().viewHere()
  else if (from === 'build') useBuilder.getState().enter('build')
  else if (from === 'scan') useScan.getState().enter()
}

/**
 * RECALL in VIEW (arkinox, 2026-11-12): the cursor, and the view with it,
 * home to your avatar, still in VIEW and at the zoom you are at. BUILD's
 * is useBuilder `toAvatar`, the same move. A fly not yet landed lands
 * first, so it cannot carry the cursor off again. What the view was a look
 * at goes as the old RECALL's RETURN let it go: the pin, and the Nearby
 * list, door card or Secrets list a later RETURN would have reopened.
 */
export function viewToAvatar(): void {
  if (!useCyberspace.getState().viewing()) return
  landFly(true)
  leaveViewForMode()
  const cs = useCyberspace.getState()
  cs.clearPin()
  cs.focusOn(cs.position, cs.plane, VIEW_FOCUS_LABEL, undefined, true, false, { view: true })
}

/**
 * RECALL on the pad, outside WALK. A proof, a route or a cloud job is
 * stopped first (useCyberspace `cancel`), as the STOP on the button says;
 * not a SCAN's HOSAKA purchase, which is no move and finishes (useScan).
 * A grown region is RESET (useRegion `resetSize`). Otherwise the cursor comes home and the mode stays: BUILD's
 * build cursor (`toAvatar`), VIEW's (viewToAvatar), HOP's (`cancel`). In
 * region mode, as X: the cursor back to where region mode started
 * (`collapseToEntry`); already there, region mode ends and the cursor comes
 * home, still in VIEW, so RECALL never stands on screen doing nothing.
 */
export function recall(): void {
  const cs = useCyberspace.getState()
  const region = useRegion.getState()
  // A SCAN's HOSAKA purchase is not a move: RECALL leaves it to finish (store/useScan.ts).
  const cloudBusy = cs.cloud.status !== 'idle' && !scanBuying()
  if (cs.proof.status === 'computing' || cloudBusy || cs.plan !== null) { cs.cancel(); return }
  if (region.active && !regionAtOriginalSize(region)) { region.resetSize(); return }
  if (useBuilder.getState().active) { useBuilder.getState().toAvatar(); return }
  if (cs.viewing()) {
    if (region.active && region.entry && !samePosition(cs.cursor, region.entry)) { region.collapseToEntry(); return }
    region.exit()
    viewToAvatar()
    return
  }
  cs.cancel()
}

/** The mode TERRAIN was entered from: where EXIT, T and Esc go back to (leaveTerrain), as WALK keeps `from`. */
let terrainFrom: PadMode = 'hop'

/** TERRAIN on, from HOP, remembering `from`. */
function openTerrain(from: PadMode): void {
  terrainFrom = from
  void useTerrain.getState().enter()
}

/**
 * TERRAIN from anywhere: the pad's ring or second button, the build bar's
 * TERRAIN, T while building, MODES. The mode you are in ends the way the
 * ring ends it (BUILD to HOP, VIEW and SCAN let their view go), and is kept
 * as the way back. Refused in a short toast where there is no head of yours
 * to walk from (spectating, in history, in transit) or while something is
 * lined up to place.
 */
export function enterTerrainMode(): boolean {
  const from = currentPadMode()
  if (from === 'terrain') return true
  // Newcomers, the tour, /demo and TV keep to the teaching list, which has TERRAIN off: not by its key or button either.
  if (!customModesApply()) return false
  const why = terrainRefusal()
  if (why) { refuseTerrain(why); return false }
  if (from === 'build' && buildHeld()) return false
  // From WALK the walk goes on (TERRAIN is WALK with tools): its steps waiting on proofs are kept, not dropped.
  if (from !== 'walk' && !toHop(from)) return false
  openTerrain(from)
  return true
}

/** EXIT, T or Esc in TERRAIN: back to the mode it was entered from, at your avatar (WALK and TERRAIN itself go back to HOP). */
export function leaveTerrain(): void {
  const back = terrainFrom
  if (!toHop('terrain')) return
  if (back !== 'hop' && back !== 'walk' && back !== 'terrain') fromHop(back)
}

/** The word of the mode the mode button goes to from TERRAIN: the next in the ring, or the way back when TERRAIN is not in it. */
export function nextModeWord(): string {
  const cur: PadMode = 'terrain'
  const next = inRing(cur) ? nextInRing(effectiveModes(), cur) : backOf(cur)
  return modeInfo(next).word
}
