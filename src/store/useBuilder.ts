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
 * - The chain explorer aims the build cursor (arkinox, 2026-10-08: "Chain ui
 *   chip comes back; scrubbing a chain moves the build cursor to that chain
 *   position"). In BUILD mode a step along a chain, yours or a spectated
 *   avatar's, by the CHAIN chip or [ ] Home End, puts the build cursor on
 *   that action's place in that action's plane (`scrubTo`) and nothing else:
 *   the scene does not go into history (`exploreIndex` stays null), your
 *   head, chain and lined-up plane are untouched, and nothing is signed. The
 *   explorer's mark is `scrub`, the action last aimed at; the cursor stays
 *   where that action put it until you move it some other way, and the mark
 *   stays too, so ] carries on from there. Every other way of opening an
 *   action (the Chain panel, a notification, a broken chain's SHOW THE ROW)
 *   goes through `walkChain` and aims the same way.
 * - Spectating does not end the mode (arkinox, 2026-10-08: "Spectating
 *   should be allowed in build mode and shouldnt end it. Then you can scrub
 *   thru other avatars chains and build near them."). The driven view stays
 *   up beside the spectation (useCyberspace `beginSpectate` with keepView):
 *   the build cursor goes to their spawn, then to their head when the chain
 *   arrives, the pad keeps driving it, and END SPECTATION leaves it where it
 *   is. Spectating stays read-only: your head is not on screen, so nothing
 *   can commit. Entering BUILD while spectating or in history starts the
 *   build cursor on what is on screen and keeps the spectation. Leaving
 *   BUILD while spectating goes back to plain spectating, at the action
 *   last aimed at, since a free view does not stand beside a spectation
 *   outside the mode.
 * - The mode ends by itself when the view it rides ends some other way
 *   (Earth, a stop, a deployment, an identity switch), or when your
 *   position is replaced under it (a respawn, a ride arriving, the relays'
 *   version of your chain chosen), which carries the cursor off to your
 *   new head. A deploy still lined up then cannot stay, since a
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
import { buildPlane, placedCursor } from '../lib/buildCursor'

/** How a session of BUILD mode began: the BUILD control (or B), or a DEPLOY. */
export type BuildEntry = 'build' | 'deploy'

/** The label the free view carries while it is the build cursor. */
export const BUILD_FOCUS_LABEL = 'BUILD'

/** Why BUILD mode ended without EXIT, for the toast that says so. */
export type BuildEndReason = 'view' | 'moved' | 'identity'

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
   * The action of the chain on show (yours, or the spectated avatar's) that
   * the build cursor was last aimed at by the chain explorer; null for the
   * head, or before any scrub. The explorer's mark in BUILD mode, in place
   * of `exploreIndex`, which stays null so the scene never goes into history.
   */
  scrub: number | null
  /**
   * Aim the build cursor at action `index` of the chain on show, in its
   * plane; null or past the end is the head. Moves nothing else.
   */
  scrubTo: (index: number | null) => void
  /** Step the aimed action; clamps at both ends. */
  scrubStep: (delta: number) => void
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

/**
 * The free view the build cursor rides is standing: driven, and not in
 * history. A spectation may stand beside it (arkinox, 2026-10-08).
 */
function viewStands(s: ReturnType<typeof useCyberspace.getState>): boolean {
  return s.focus?.drive === true && s.exploreIndex === null
}

/** The center of all cyberspace, where HyperspacePanel's EARTH, CYBERSPACE and THE RIDE views point. */
const CUBE_CENTER = 1n << 84n

/** A plain view of the whole cube (EARTH, CYBERSPACE, THE RIDE), not of a place in it. */
function wholeCube(f: { position: { x: bigint; y: bigint; z: bigint }; drive?: boolean }): boolean {
  return !f.drive && f.position.x === CUBE_CENTER && f.position.y === CUBE_CENTER && f.position.z === CUBE_CENTER
}

/** The build cursor sits on your avatar, in the plane your head shows. */
function onAvatar(s: ReturnType<typeof useCyberspace.getState>): boolean {
  return samePosition(placedCursor(s), s.position) && buildPlane(s) === s.plane
}

/**
 * What the free view becomes once the mode is off. A free view that sits on
 * your avatar shows what your head shows: end it, keeping the zoom. One kept
 * through a spectation cannot stand without the mode, so it ends and the
 * scene goes back to watching them, at the action last aimed at (`scrub`).
 */
function settleView(scrub: number | null): void {
  const cs = useCyberspace.getState()
  if (!cs.focus?.drive) return
  if (cs.spectate) {
    cs.clearFocus(true)
    if (scrub !== null) useCyberspace.getState().explore(scrub)
    return
  }
  if (onAvatar(cs)) cs.clearFocus(true)
}

const END_REASON: Record<BuildEndReason, string> = {
  view: 'The view moved somewhere you cannot build from (Earth, a stop, a deployment).',
  moved: 'Your avatar was moved under it (a respawn, a ride arriving, or the relays\' version of your chain), and the build cursor went with it.',
  identity: 'You switched identity; the build cursor belonged to the one you left.',
}

export const useBuilder = create<BuilderState>((set, get) => ({
  active: false,
  via: null,
  leftAvatar: false,
  messageDraft: null,
  scrub: null,

  scrubTo: (index) => {
    if (!get().active) return
    const cs = useCyberspace.getState()
    const chain = cs.focusChain()
    const last = chain.length - 1
    // A spectated pubkey with no chain on the relay: nothing to aim at.
    if (last < 0) return
    const i = index === null || index >= last ? null : Math.max(0, Math.floor(index))
    const action = chain[i ?? last]
    // Its place, in its plane, as history would show it: the coordinate the
    // chain stands on there (a game's entry point, a broken chain's last
    // valid place). Only the view's cursor moves (aimView).
    cs.aimView(action.position, action.plane)
    set({ scrub: i })
  },

  scrubStep: (delta) => {
    const last = useCyberspace.getState().focusChain().length - 1
    const from = get().scrub ?? last
    get().scrubTo(Math.min(last, Math.max(0, from + delta)))
  },

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
    // Spectating or in history, what is on screen is an avatar at an action:
    // the build cursor starts there, the spectation stays, and the action in
    // history becomes the explorer's mark (arkinox, 2026-10-08).
    if (cs.spectate !== null || cs.exploreIndex !== null) {
      const scrub = cs.exploreIndex
      cs.driveHere(BUILD_FOCUS_LABEL)
      set({ active: true, via, scrub, leftAvatar: !onAvatar(useCyberspace.getState()) })
      return
    }
    const looking = cs.focus !== null && !wholeCube(cs.focus)
    if (!looking) cs.focusOn(cs.position, cs.plane, BUILD_FOCUS_LABEL, undefined, true)
    else if (!cs.focus?.drive) cs.focusOn(cs.anchor, cs.anchorPlane, BUILD_FOCUS_LABEL, undefined, true)
    set({ active: true, via, scrub: null, leftAvatar: !onAvatar(useCyberspace.getState()) })
  },

  exit: () => {
    if (!get().active || useShards.getState().pending) return
    const scrub = get().scrub
    // Off first, so the view change below is not read as the view ending
    // under a live build mode.
    set({ active: false, via: null, leftAvatar: false, scrub: null })
    settleView(scrub)
  },

  toggle: () => { if (get().active) get().exit(); else get().enter('build') },

  toAvatar: () => {
    if (!get().active) return
    const cs = useCyberspace.getState()
    // The mark goes with it: back at your avatar, the CHAIN chip and the
    // trail are at your head again, not at the action last aimed at (review
    // of #235: the chip read 2/4 and the trail split at 2 after RETURN).
    set({ scrub: null })
    // While spectating, aimed rather than re-focused, which would end the
    // spectation: you are still watching them.
    if (cs.spectate) cs.aimView(cs.position, cs.plane)
    else cs.focusOn(cs.position, cs.plane, BUILD_FOCUS_LABEL, undefined, true)
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
  useBuilder.setState({ active: false, via: null, leftAvatar: false, scrub: null })
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
    useStash.setState({ returnToModels: false })
    shards.cancelDeploy()
  }
  useToast.getState().show({ label: 'BUILD MODE ENDED', meta: END_REASON[reason] + kept + ' Press BUILD to start again.', mark: 'build' })
}

useCyberspace.subscribe((s, prev) => {
  const b = useBuilder.getState()
  if (!b.active) return
  // Why the mode ends is asked in order, most particular first, since an
  // identity switch and a chain chosen from the relays also clear the view:
  // reading them as the view moving away gave the wrong reason (review of
  // #235). Another identity first: everything about the old one is gone.
  if (s.identity.pubkey !== prev.identity.pubkey) { endUnder('identity'); settleView(null); return }
  // Your position replaced under the mode, carrying the cursor to the new
  // head: a new chain head that also wrote the cursor. Only a respawn, a ride
  // arriving and a chain chosen from the relays do both. A move committed
  // before building lands without touching the cursor, and the mode stays.
  const headChanged = s.prevEventId !== prev.prevEventId || s.genesisId !== prev.genesisId
  if (headChanged && s.cursor !== prev.cursor) {
    endUnder('moved')
    settleView(null)
    return
  }
  // The view the build cursor rides ended some other way.
  if (!viewStands(s)) { endUnder('view'); return }
  // The mark is an index into the chain on show; it stands only while that
  // index is still the same action. Another chain on show (a spectation
  // begun, switched or ended), or the same avatar's chain replaced (they
  // respawned), drops it, as history's `keep` does outside the mode
  // (setSpectateChain). The cursor stays where it was aimed.
  if (b.scrub !== null) {
    const same = s.spectate?.pubkey === prev.spectate?.pubkey
      && (s.spectate === null || s.spectate.actions === prev.spectate?.actions
        || s.spectate.actions[b.scrub]?.id === prev.spectate?.actions[b.scrub]?.id)
    if (!same) useBuilder.setState({ scrub: null })
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

/**
 * Go to action `index` of the chain on show, from the CHAIN chip, [ ] Home
 * End, the Chain panel, a notification or a broken chain's row: in BUILD
 * mode it aims the build cursor there (`scrubTo`), and otherwise the scene
 * goes there in history (useCyberspace `explore`), as it always has.
 */
export function walkChain(index: number | null): void {
  if (useBuilder.getState().active) useBuilder.getState().scrubTo(index)
  else useCyberspace.getState().explore(index)
}

/** One action back or forward along the chain on show: `walkChain` by a step. */
export function stepChain(delta: number): void {
  if (useBuilder.getState().active) useBuilder.getState().scrubStep(delta)
  else useCyberspace.getState().exploreStep(delta)
}

// Escape leaves BUILD mode: on the stack from the moment the mode turns on
// until it turns off, however it turns off.
let offEscape: (() => void) | null = null
useBuilder.subscribe((s, prev) => {
  if (s.active === prev.active) return
  offEscape?.()
  offEscape = s.active ? registerEscape('chip', () => useBuilder.getState().exit()) : null
})
