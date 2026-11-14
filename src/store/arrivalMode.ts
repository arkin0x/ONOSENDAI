/**
 * arrivalMode.ts - ?mode=view and ?mode=region on arrival (arkinox, 2026-11-13).
 *
 * onosendai.tech/?mode=view opens in VIEW at your avatar, as the mode button
 * does from HOP (padMode cycleMode). ?mode=region goes on into region mode,
 * as the Region button does in VIEW (store/useRegion.ts). Any other value is
 * ignored and left on the address, as ?tutorial= leaves one it does not know.
 *
 * Read once, before the first render (main.tsx takeArrivalMode), and taken
 * off the address there (replaceState, no new entry), so a reload or a link
 * copied from the address bar does not do it again. Applied once, when the
 * app can show it (watchArrivalMode): the saved chain is in, so VIEW starts
 * at the avatar's place (savedChainLoaded). Only when the /tutorial address
 * also asked for a run on this load does it wait, as the tutorial does, for
 * the identity to be judged (useTutorial identitySettled), so the two never
 * both start; otherwise it does not wait on the relays at all, since the
 * tutorial does not start by itself on a load that asked for a mode. So a
 * returning player on a new device (no saved chain yet) gets the mode at
 * once, at the place known then, as it always did with the switch off.
 *
 * A mode that arrives after you have started doing something (a hop lined
 * up, the cursor moved off your avatar, a view of something else opened) is
 * dropped: it only ever turns an untouched arrival into VIEW, never undoes
 * what you did meanwhile.
 *
 * - On a /C/ link: its view is already a VIEW, so ?mode=view adds nothing,
 *   and ?mode=region turns region mode on over the link's own region (a
 *   prefix link's region is the seed; a full coordinate's place gets the
 *   region round its cell, as the Region button would). A full coordinate
 *   that turns out to be a Bitcoin block's renames its view to the block
 *   once found, which ends region mode as any other view change does.
 * - The mode wins over the first-arrival tutorial (owner, 2026-11-13): a
 *   brand-new visitor on /?mode=region (the speakeasy page's "Pick a region
 *   in ONOSENDAI" link) gets region mode, and the tutorial does not start or
 *   resume by itself on that load (useTutorial tutorialStarts reads
 *   tutorial/gate.ts arrivalModeAsked). Nothing is marked skipped or ended:
 *   a later plain load still starts it for a visitor who is still new, and
 *   the tutorial toast (tutorial/toast.ts) can offer it.
 * - A run already going still wins, and so does /tutorial: the mode is then
 *   dropped, never applied after. The tutorial's steps move the camera and
 *   the modes themselves, and a mode switched on under a step would fight it.
 * - Nothing under the /demo tour or Cyberspace TV, which own the view.
 */

import { cycleMode, currentPadMode } from './padMode'
import { samePosition, savedChainLoaded, useCyberspace } from './useCyberspace'
import { linkRegionSeed } from './useCoordRoute'
import { useRegion } from './useRegion'
import { identitySettled, tutorialMayRun, tutorialStarts, useTutorial } from './useTutorial'
import { noteArrivalModeAsked, tutorialAsked } from '../tutorial/gate'
import { useDemo } from './useDemo'
import { useTv } from './useTv'

export type ArrivalMode = 'view' | 'region'

/** The mode the address asked for, waiting to be applied; null once applied or dropped. */
let pending: ArrivalMode | null = null

/**
 * Read ?mode= off the address, keep a known value for watchArrivalMode, and
 * take it off the address. Returns the mode kept, or null when there is none
 * (no flag, or one this does not know, which stays on the address).
 */
export function takeArrivalMode(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location, history: Pick<History, 'replaceState' | 'state'> = window.history): ArrivalMode | null {
  pending = null
  noteArrivalModeAsked(false)
  let params: URLSearchParams
  try { params = new URLSearchParams(loc.search) } catch { return null }
  const raw = (params.get('mode') ?? '').trim().toLowerCase()
  if (raw !== 'view' && raw !== 'region') return null
  pending = raw
  // The tutorial stands aside for this load (useTutorial tutorialStarts).
  noteArrivalModeAsked(true)
  params.delete('mode')
  const search = params.toString()
  try { history.replaceState(history.state, '', `${loc.pathname}${search ? `?${search}` : ''}${loc.hash}`) } catch { /* no history here */ }
  return raw
}

/**
 * VIEW, and region mode after it for 'region', now: what the mode button and
 * the Region button do. Returns whether the mode is up.
 */
export function applyArrivalMode(mode: ArrivalMode): boolean {
  if (currentPadMode() === 'hop') cycleMode()
  const cs = useCyberspace.getState()
  if (!cs.viewing()) return false
  if (mode === 'view') return true
  // A /C/ prefix link's view: its region, while that view is still the one
  // up, as the Region button starts it (useRegion toggleRegion).
  useRegion.getState().enter(linkRegionSeed())
  return useRegion.getState().active
}

/**
 * Nothing done yet on arrival: HOP at your avatar with nothing lined up or
 * under way, or a view the address opened (a /C/ link's) still up.
 */
function untouched(): boolean {
  const cs = useCyberspace.getState()
  if (cs.viewing()) return true
  return currentPadMode() === 'hop' && cs.atHead() && cs.plan === null && cs.proof.status !== 'computing' && samePosition(cs.cursor, cs.position)
}

/**
 * Apply the address's mode once the app can (see the header), or drop it for
 * a tutorial run already going or asked for by /tutorial, the tour or TV.
 * Returns what stops the watching.
 */
export function watchArrivalMode(): () => void {
  if (pending === null) return () => {}
  let stopped = false
  let waiting = false
  const check = (): void => {
    if (stopped || waiting || pending === null) return
    // Only /tutorial can start a run on a load that asked for a mode: wait for its answer.
    if (tutorialAsked() && tutorialMayRun() && !identitySettled()) return
    const pubkey = useCyberspace.getState().identity.pubkey
    waiting = true
    const go = (): void => {
      waiting = false
      if (stopped || pending === null) return
      // Another identity since: wait for it to settle in turn.
      if (useCyberspace.getState().identity.pubkey !== pubkey) { check(); return }
      const mode = pending
      pending = null
      off()
      if (useTutorial.getState().active || tutorialStarts(pubkey)) return
      if (useDemo.getState().active || useTv.getState().on || !untouched()) return
      applyArrivalMode(mode)
    }
    void savedChainLoaded().then(go, go)
  }
  const off = useCyberspace.subscribe(check)
  check()
  return () => { stopped = true; off() }
}
