/**
 * startMode.ts - the mode the app starts in: the Default Mode, first in the
 * ring of the player's MODES list (store/modeOrder.ts; owner, 2026-11-24: "someone could make WALK be
 * the default mode instead of HOP").
 *
 * HOP is where the app has always started, and with the default list
 * nothing here does anything. With another default mode, it is entered once
 * per load, the way the mode button enters it (padMode switchMode), when:
 *
 * - the page landed on the bare address: not /tutorial, /demo, /tv, a /C/
 *   link, /workshop or any other route, each of which opens its own view;
 * - the address asked for no arrival mode (?mode=view or ?mode=region,
 *   store/arrivalMode.ts), which wins;
 * - the saved chain is in (savedChainLoaded), and the relays' check of
 *   its head has answered with no conflict standing (useTutorial
 *   headUnsettled, what a tutorial RESTART waits for), so the mode starts
 *   at your avatar's real place, never at a head about to be corrected; a
 *   check still out after HEAD_WAIT_MS leaves the app in HOP;
 * - the player's own list applies (customModesApply: not the newcomer view,
 *   a tour run, the /demo tour or TV), and no tour run starts on this load
 *   (useTutorial tutorialStarts);
 * - nothing has been done yet: HOP at your head, nothing lined up, placing,
 *   proving or under way, the cursor on your avatar. A mode never undoes
 *   what the player started meanwhile.
 *
 * WALK FIRST. WALK is entered as its button enters it (useWalk `enter`):
 * first person at your head, the cursor on you, the walls of the shards
 * around warmed, gravity's down read from the view. It waits, after the
 * chain, for the world around you to arrive (worldSettled: your things are
 * in at once, what your keys open comes from the relays), at most
 * WORLD_WAIT_MS. And under GRAVITY it asks for no floor until the first
 * press (`noFall`): the app never falls, makes a hop or switches gravity off
 * for a player who has not touched anything yet.
 */

import { savedChainLoaded, samePosition, useCyberspace } from './useCyberspace'
import { currentPadMode, switchMode } from './padMode'
import { customModesApply, modeRoles } from './modeOrder'
import { headUnsettled, tutorialStarts, useTutorial } from './useTutorial'
import { arrivalModeAsked, landedPath } from '../tutorial/gate'
import { useDemo } from './useDemo'
import { useTv } from './useTv'
import { useShards } from './useShards'
import { useGame } from './useGame'
import { useWorkshop } from './useWorkshop'
import { moveUnderWay } from '../lib/buildCursor'

/** The world's things unchanged for this long counts as arrived, ms. */
export const WORLD_QUIET_MS = 1200
/** The longest WALK waits for the world before starting anyway, ms. */
export const WORLD_WAIT_MS = 6000
/** The longest the default mode waits for the relays' check of the head; past it the app stays in HOP, ms. */
export const HEAD_WAIT_MS = 15000

/** Whether the page landed on the bare address. */
export function plainLanding(path: string = landedPath()): boolean {
  return path === '/' || path === ''
}

/** Nothing done yet: HOP at your head, nothing lined up, placing, proving or under way, the cursor on your avatar. */
export function untouchedStart(): boolean {
  const cs = useCyberspace.getState()
  if (currentPadMode() !== 'hop' || !cs.atHead()) return false
  if (cs.plan !== null || cs.proof.status === 'computing' || cs.cloud.status !== 'idle' || moveUnderWay(cs)) return false
  if (useShards.getState().pending !== null) return false
  return samePosition(cs.cursor, cs.position)
}

/** Whether something else owns the screen now: a tour run, the /demo tour, TV, a game, the workshop. */
function screenOwned(): boolean {
  return useTutorial.getState().active || useDemo.getState().active || useTv.getState().on
    || useGame.getState().session !== null || useWorkshop.getState().open
}

/**
 * The default mode, now, if it applies (see the header): true when the pad is
 * in it. HOP the default mode, or anything in the way, does nothing.
 */
export function applyStartMode(): boolean {
  if (!customModesApply() || screenOwned() || !untouchedStart()) return false
  const { start } = modeRoles()
  if (start === 'hop') return false
  switchMode(start, { noFall: true })
  return currentPadMode() === start
}

/** Resolves true once `pubkey`'s head is settled (headUnsettled), false after `maxMs`. */
export function headSettled(pubkey: string, maxMs = HEAD_WAIT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    if (!headUnsettled(pubkey)) { resolve(true); return }
    const cap = setTimeout(() => { off(); resolve(false) }, maxMs)
    const off = useCyberspace.subscribe(() => {
      if (headUnsettled(pubkey)) return
      clearTimeout(cap)
      off()
      resolve(true)
    })
  })
}

/** Resolves once the world's things have been still for WORLD_QUIET_MS, or after WORLD_WAIT_MS. */
export function worldSettled(quietMs = WORLD_QUIET_MS, maxMs = WORLD_WAIT_MS): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | null = null
    const done = (): void => {
      if (quiet) clearTimeout(quiet)
      clearTimeout(cap)
      off()
      resolve()
    }
    const cap = setTimeout(done, maxMs)
    const restart = (): void => {
      if (quiet) clearTimeout(quiet)
      quiet = setTimeout(done, quietMs)
    }
    const off = useShards.subscribe((s, prev) => {
      if (s.mine !== prev.mine || s.discovered !== prev.discovered) restart()
    })
    restart()
  })
}

/**
 * Enter the default mode once the app can (see the header). Returns what
 * stops the watching (App).
 */
export function watchStartMode(): () => void {
  if (!plainLanding() || arrivalModeAsked()) return () => {}
  let stopped = false
  const run = async (): Promise<void> => {
    // Whoever is on screen once their chain, its head and (for WALK) the
    // world are in; an identity that changes meanwhile is waited for in turn.
    for (;;) {
      const pubkey = useCyberspace.getState().identity.pubkey
      try { await savedChainLoaded() } catch { /* start where the app knows */ }
      if (stopped) return
      if (useCyberspace.getState().identity.pubkey !== pubkey) continue
      if (tutorialStarts(pubkey)) return
      if (!customModesApply() || modeRoles().start === 'hop') return
      if (!await headSettled(pubkey)) { if (useCyberspace.getState().identity.pubkey === pubkey) return; continue }
      if (stopped) return
      if (modeRoles().start === 'walk') await worldSettled()
      if (stopped) return
      if (useCyberspace.getState().identity.pubkey !== pubkey) continue
      break
    }
    applyStartMode()
  }
  void run()
  return () => { stopped = true }
}
