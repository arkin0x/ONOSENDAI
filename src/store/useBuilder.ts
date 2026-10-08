/**
 * useBuilder.ts - BUILD mode: placing things anywhere in cyberspace without
 * going there.
 *
 * arkinox, 2026-10-07 (R5, R6): "deploying shards and messages should now use
 * the builder system instead [of piggybacking on the avatar position]. Deploy
 * will center the builder at the avatar's position but the position should be
 * easily changeable." and "you can exit build mode like you exit the
 * workshop; exiting leaves the view where it is (does not snap back to
 * avatar)."
 *
 * What the mode is made of:
 *
 * - The build cursor is the free view's cursor (lib/buildCursor.ts). Entering
 *   starts a free view, so the pad, W A S D, R and F, + and - and the Position
 *   panel's VIEW all move the build cursor with no new wiring, and the zoom
 *   sets its step and the cell a placement is centered in: zoom out to 2^6 and
 *   every step is 2^6 gibsons and a dropped shard is centered in a 2^6 cell.
 *   No second cursor, no second camera.
 * - Building never moves you and never signs a move. A free view is not your
 *   head (`atHead` is false), and every path to a movement action (COMMIT,
 *   the route overlay, the next-action button, the HOSAKA offer, the tether
 *   and its landing ghost) is taken only from your head. The keyboard's Space
 *   and X are routed here too (useKeyboard), so neither reaches the movement
 *   store while building.
 * - DEPLOY happens in BUILD mode. Any deploy that starts while the mode is off
 *   turns it on (the subscription at the bottom), with the build cursor where
 *   you are looking if a view is up and on your avatar if not, and the deploy
 *   lands at the build cursor (useShards `deploy`). A deploy started while
 *   building leaves the cursor where you put it.
 * - Exiting leaves the view where it is: the free view stays, with its RETURN
 *   (FocusBar) to take you home. The one exception is a build cursor already
 *   on your avatar in your plane, where the view and your head are the same
 *   picture: exiting then simply ends the view, at the zoom you are at, so
 *   the movement controls come back without a RETURN that would change
 *   nothing on screen.
 * - Escape leaves the mode, like the workshop's close. The mode is a chip on
 *   the Escape stack (hooks/useEscape.ts), registered here when it turns on
 *   rather than by a component, because the mode outlives its bar: the bar
 *   steps aside while a deploy is lined up, and the mode does not. A deploy's
 *   bar, opened later, is the more recent chip and closes first; a modal or
 *   the menu closes before either.
 * - A session that began from DEPLOY and never moved the build cursor off
 *   your avatar ends with that deploy, hidden or canceled: it was only ever
 *   a deploy at your avatar, and staying in BUILD mode afterwards left COMMIT
 *   and the phone's COMMIT and RECALL hidden until EXIT (found in review,
 *   2026-10-07). Once the cursor has left your avatar, you are building
 *   somewhere, and the mode stays for the next placement.
 * - Entering takes the camera back from a hyperspace view (EARTH, a stop, the
 *   scrubber), the way starting to spectate does, so the gibson field comes
 *   back and no second bar offers a RETURN that would end the mode.
 * - The mode ends by itself when the view it rides ends some other way
 *   (Earth, a stop, a deployment, history, spectating, an identity switch),
 *   or when your position is replaced under it (a respawn, a ride arriving,
 *   the relays' version of your chain chosen), which carries the cursor off
 *   to your new head. A deploy still lined up then cannot stay, since a
 *   deploy happens only at a build cursor, but the work is not lost: a
 *   message's text waits in the composer (`messageDraft`), a model is still
 *   in the workshop, and a toast says what happened and why.
 *
 * Room for the next PRs. Build regions and drafts (PR 2, ruling B2: a cube
 * per room, one bag per region, one region key per region at COMMIT) belong
 * in this store beside `active`: a list of regions, each a cube at a chosen
 * height around a corner the build cursor picks, and a list of drafts, each a
 * placement inside one region. Both read the cursor and plane through
 * lib/buildCursor.ts, as a single deploy does now, and both are local until a
 * grouped COMMIT, which is why nothing here touches the chain.
 */

import { create } from 'zustand'
import { samePosition, useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { useHyperspace } from './useHyperspace'
import { useToast } from './useToast'
import { useStash } from '../hud/stash'
import { registerEscape } from '../hooks/useEscape'
import { buildPlane } from '../lib/buildCursor'

/** How a session of BUILD mode began: the BUILD control (or B), or a DEPLOY. */
export type BuildEntry = 'build' | 'deploy'

/** The label the free view carries while it is the build cursor. */
export const BUILD_FOCUS_LABEL = 'BUILD'

/** Why BUILD mode ended without EXIT, for the toast that says so. */
export type BuildEndReason = 'view' | 'moved'

export interface BuilderState {
  /** BUILD mode is on: the free view is the build cursor and placements land there. */
  active: boolean
  /** How this session began; null while the mode is off. */
  via: BuildEntry | null
  /**
   * The build cursor has been somewhere other than your avatar (in your
   * plane) during this session. A session from DEPLOY that never has ends
   * when its deploy does.
   */
  leftAvatar: boolean
  /**
   * A message whose deploy was ended under it (the view moved away, or your
   * position was replaced): the composer starts with it, so nothing written
   * is lost. Taken, and cleared, by the next composer that opens.
   */
  messageDraft: string | null
  /**
   * Turn BUILD mode on. From the BUILD control and from DEPLOY alike, the
   * build cursor starts where you are looking when a view is up (a place you
   * went to see, the Earth pin, a stop), and on your avatar otherwise,
   * including in a view of the whole cube (EARTH, CYBERSPACE, THE RIDE) (R5,
   * and ruling A, 2026-10-07). Already on, this changes nothing, so a deploy
   * started while building lands where the cursor already is.
   */
  enter: (via?: BuildEntry) => void
  /**
   * Leave BUILD mode. The view stays where it is (R6). Refused while a deploy
   * is lined up: leaving would cancel it, which is CANCEL's (or Escape's) to
   * do, so the B key, EXIT BUILD and EXIT all agree.
   */
  exit: () => void
  /** On, or off. The B key and the BUILD control. */
  toggle: () => void
  /** Bring the build cursor, and the view with it, back to your avatar. Still building. */
  toAvatar: () => void
  /** The composer took the kept message. */
  takeMessageDraft: () => string | null
}

/** The free view the build cursor rides is standing: driven, not spectating, not in history. */
function viewStands(s: ReturnType<typeof useCyberspace.getState>): boolean {
  return s.focus?.drive === true && s.spectate === null && s.exploreIndex === null
}

/** The center of all cyberspace, where HyperspacePanel's EARTH, CYBERSPACE and THE RIDE views point. */
const CUBE_CENTER = 1n << 84n

/** A plain view of the whole cube (EARTH, CYBERSPACE, THE RIDE), not of a place in it. */
function wholeCube(f: { position: { x: bigint; y: bigint; z: bigint }; drive?: boolean }): boolean {
  return !f.drive && f.position.x === CUBE_CENTER && f.position.y === CUBE_CENTER && f.position.z === CUBE_CENTER
}

/** The build cursor sits on your avatar, in the plane your head shows. */
function onAvatar(s: ReturnType<typeof useCyberspace.getState>): boolean {
  return samePosition(s.cursor, s.position) && buildPlane(s) === s.plane
}

/** A free view that sits on your avatar shows what your head shows: end it, keeping the zoom. */
function settleView(): void {
  const cs = useCyberspace.getState()
  if (cs.focus?.drive && onAvatar(cs)) cs.clearFocus(true)
}

const END_REASON: Record<BuildEndReason, string> = {
  view: 'The view moved somewhere you cannot build from (Earth, a stop, a deployment, history, or someone else).',
  moved: 'Your avatar was moved under it (a respawn, a ride arriving, or the relays\' version of your chain), and the build cursor went with it.',
}

export const useBuilder = create<BuilderState>((set, get) => ({
  active: false,
  via: null,
  leftAvatar: false,
  messageDraft: null,

  enter: (via = 'build') => {
    if (get().active) return
    // The camera back from a hyperspace view first, as spectating does
    // (useHyperspace.ts): its ownership hides the gibson field and stands a
    // second bar up whose RETURN would end the mode.
    const hs = useHyperspace.getState()
    if (hs.viewOwned || hs.scrubHeight !== null) {
      useHyperspace.setState({ scrubHeight: null, viewOwned: false, returnScaleExp: null, returnFocus: null, viewedStop: null })
    }
    const cs = useCyberspace.getState()
    // Where you are looking is where building starts, from BUILD and from
    // DEPLOY alike (arkinox, 2026-10-07, ruling A on review finding 3): a
    // view you drove somewhere (VIEW, the Earth pin, a recent or starred
    // place) keeps its cursor; a plain view (a stop, a tapped block, a
    // deployment) starts the cursor on what it frames. With no view up, at
    // your head, it starts on your avatar in the plane your head shows.
    // EARTH, CYBERSPACE and THE RIDE look at the whole cube from its center:
    // there is no place in them to build, and the center is Earth's core at
    // 2^52 and up. They count as no view (found in review, 2026-10-07).
    const looking = cs.focus !== null && cs.spectate === null && cs.exploreIndex === null && !wholeCube(cs.focus)
    if (!looking) cs.focusOn(cs.position, cs.plane, BUILD_FOCUS_LABEL, undefined, true)
    else if (!cs.focus?.drive) cs.focusOn(cs.anchor, cs.anchorPlane, BUILD_FOCUS_LABEL, undefined, true)
    set({ active: true, via, leftAvatar: !onAvatar(useCyberspace.getState()) })
  },

  exit: () => {
    if (!get().active || useShards.getState().pending) return
    // Off first, so the view change below is not read as the view ending
    // under a live build mode.
    set({ active: false, via: null, leftAvatar: false })
    settleView()
  },

  toggle: () => { if (get().active) get().exit(); else get().enter('build') },

  toAvatar: () => {
    if (!get().active) return
    const cs = useCyberspace.getState()
    cs.focusOn(cs.position, cs.plane, BUILD_FOCUS_LABEL, undefined, true)
  },

  takeMessageDraft: () => {
    const draft = get().messageDraft
    if (draft !== null) set({ messageDraft: null })
    return draft
  },
}))

/**
 * BUILD mode ended by something other than EXIT. The deploy lined up at the
 * build cursor cannot stay, but what went into it is kept, and the toast says
 * why the mode ended and where the work is.
 */
function endUnder(reason: BuildEndReason): void {
  useBuilder.setState({ active: false, via: null, leftAvatar: false })
  const shards = useShards.getState()
  const pending = shards.pending
  let kept = ''
  if (pending && shards.deployStatus === 'working') {
    // Already hiding: the key is being computed for the place it was aimed
    // at, and it finishes there. Nothing to keep and nothing to cancel, only
    // to say (found in review, 2026-10-07: it used to say "kept" and publish).
    kept = pending.type === 'message'
      ? ' Your message was already being hidden, and it finishes at the place you chose.'
      : ` "${shards.pendingShard()?.name ?? 'The object'}" was already being hidden, and it finishes at the place you chose.`
  } else if (pending) {
    // What was set for this one deploy goes with it; say so plainly.
    const riddle = shards.deployBag.riddle.trim() !== ''
    const dropped = ` Its height and bag settings${riddle ? ', including the hint message you wrote,' : ''} were not kept.`
    if (pending.type === 'message') {
      useBuilder.setState({ messageDraft: pending.text })
      kept = ' Your message is kept: WRITE A MESSAGE in the Stash, or HIDE MESSAGE in build mode, opens it again.' + dropped
    } else {
      const name = shards.pendingShard()?.name ?? 'the object'
      kept = ` The deploy of "${name}" was canceled; the model is unchanged in your workshop.` + dropped
    }
    // Not back to the Models modal: the view went somewhere on purpose.
    useStash.setState({ returnToModels: false, returnToFeed: false })
    shards.cancelDeploy()
  }
  useToast.getState().show({ label: 'BUILD MODE ENDED', meta: END_REASON[reason] + kept + ' Press BUILD to start again.', mark: 'build' })
}

useCyberspace.subscribe((s, prev) => {
  const b = useBuilder.getState()
  if (!b.active) return
  // The view the build cursor rides ended some other way.
  if (!viewStands(s)) { endUnder('view'); return }
  // Your position replaced under the mode, carrying the cursor to the new
  // head: a new chain head that also wrote the cursor. Only a respawn, a ride
  // arriving and a chain chosen from the relays do both. A move committed
  // before building lands without touching the cursor, and the mode stays.
  const headChanged = s.prevEventId !== prev.prevEventId || s.genesisId !== prev.genesisId
  if (headChanged && s.cursor !== prev.cursor) {
    endUnder('moved')
    settleView()
    return
  }
  if (!b.leftAvatar && !onAvatar(s)) useBuilder.setState({ leftAvatar: true })
})

useShards.subscribe((s, prev) => {
  // Every deploy happens in BUILD mode (R5): one that starts with the mode
  // off turns it on, at the place you are looking or else your avatar, so
  // the deploy lands at the build cursor and never at a cursor lined up for
  // a move.
  // A new deploy, not only the first: one lined up while an earlier one is
  // still hiding after the mode ended starts the mode again too.
  if (s.pending !== null && s.pending !== prev.pending && !useBuilder.getState().active) useBuilder.getState().enter('deploy')
  // A DEPLOY that never left your avatar was only ever a deploy at your
  // avatar: when it ends, hidden or canceled, so does the mode.
  const b = useBuilder.getState()
  if (s.pending === null && prev.pending !== null && b.active && b.via === 'deploy' && !b.leftAvatar) b.exit()
})

// Escape leaves BUILD mode: on the stack from the moment the mode turns on
// until it turns off, however it turns off.
let offEscape: (() => void) | null = null
useBuilder.subscribe((s, prev) => {
  if (s.active === prev.active) return
  offEscape?.()
  offEscape = s.active ? registerEscape('chip', () => useBuilder.getState().exit()) : null
})
