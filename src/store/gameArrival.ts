/**
 * gameArrival.ts - ?game=drone-run on arrival: a link that opens ONOSENDAI
 * ready to play DRONE RUN, a test game on a DEV key (lib/games/droneRun/
 * game.ts), and nothing of it ever reaching a relay.
 *
 * Honoured only where the games device switch is (lib/games/flag.ts
 * deviceSwitchHonoured): off the production host, or in a dev build. On the
 * production host it is ignored and left on the address, as ?games=1 is.
 *
 * Read once, before the first render (main.tsx takeGameArrival, after
 * takeArrivalMode, which resets the arrival note this sets), and taken off the
 * address (replaceState) so a reload or a copied link does not do it again.
 * At once, before anything can be signed:
 *
 * 1. LOCAL: the store's setLive(false), saved as `onosendai:live` = 0, as the
 *    capture harness sets it. Nothing this device signs is sent anywhere until
 *    the player turns LIVE on again, and DRONE RUN refuses to enter while LIVE
 *    (store/useGame localOnlyRefusal).
 * 2. Games on for this device, as ?games=1 (flag.ts turnGamesOnHere).
 * 3. The first-arrival tutorial stands aside for this load, and its toast is
 *    not shown, as for ?mode=view (tutorial/gate.ts noteArrivalModeAsked).
 *
 * Then, once the saved chain is in (watchGameArrival, from App), the menu
 * opens with GAMES unfolded and first, DRONE RUN listed with ENTER. The game
 * is offered, not entered: nothing is signed until the player taps ENTER,
 * which on a first visit signs the spawn and then the entry, both kept on
 * this device (store/useGame signEnter). That is the calmer way: a page load
 * never signs anything in ONOSENDAI (store/useCyberspace signFirstSpawn), the
 * player sees LOCAL and the game before anything happens, and a refusal is
 * shown where ENTER is. The panel goes back to its place once a game opens.
 * Nothing under the /demo tour or Cyberspace TV, which own the screen.
 */

import { deviceSwitchHonoured, turnGamesOnHere } from '../lib/games/flag'
import { noteArrivalModeAsked } from '../tutorial/gate'
import { setMenuOpen } from '../hooks/useMenuOpen'
import { savedChainLoaded, useCyberspace } from './useCyberspace'
import { usePanelLayout } from './usePanelLayout'
import { useDemo } from './useDemo'
import { useTv } from './useTv'
import { useGame } from './useGame'

export type ArrivalGame = 'drone-run'

/** The game the address asked for, waiting to be offered; null once offered or dropped. */
let pending: ArrivalGame | null = null

/** Where the store keeps LIVE (useCyberspace LIVE_KEY): written here too, so it holds even before the store reads it again. */
const LIVE_KEY = 'onosendai:live'

/**
 * Read ?game= off the address: for `drone-run`, where honoured, switch to
 * LOCAL, turn games on, set the tutorial aside, take the flag off the address,
 * and keep it for watchGameArrival. Returns the game kept, or null (no flag,
 * one this does not know, or the production host), leaving the address as it
 * was.
 */
export function takeGameArrival(loc: Pick<Location, 'pathname' | 'search' | 'hash'> = window.location, history: Pick<History, 'replaceState' | 'state'> = window.history): ArrivalGame | null {
  pending = null
  let params: URLSearchParams
  try { params = new URLSearchParams(loc.search) } catch { return null }
  const raw = (params.get('game') ?? '').trim().toLowerCase()
  if (raw !== 'drone-run' || !deviceSwitchHonoured()) return null
  // LOCAL first: nothing reaches a relay from here on.
  useCyberspace.getState().setLive(false)
  try { localStorage.setItem(LIVE_KEY, '0') } catch { /* private mode: the store's LOCAL holds for this page */ }
  turnGamesOnHere()
  noteArrivalModeAsked(true)
  params.delete('game')
  const search = params.toString()
  try { history.replaceState(history.state, '', `${loc.pathname}${search ? `?${search}` : ''}${loc.hash}`) } catch { /* no history here */ }
  pending = raw
  return raw
}

/** Whether a ?game= arrival is waiting to be offered (for tests). */
export function gameArrivalPending(): ArrivalGame | null {
  return pending
}

/** Offer the asked-for game: the menu open, GAMES unfolded and first, until a game opens. */
export function offerArrivalGame(): void {
  const layout = usePanelLayout.getState()
  if (layout.collapsed.games) layout.toggle('games')
  layout.setFront('games')
  setMenuOpen(true)
  const stop = useGame.subscribe((g) => {
    if (!g.session) return
    stop()
    if (usePanelLayout.getState().front === 'games') usePanelLayout.getState().setFront(null)
  })
}

/** Offer the game the address asked for once the saved chain is in (see the header). Returns what stops the waiting. */
export function watchGameArrival(): () => void {
  if (pending === null) return () => {}
  let stopped = false
  const go = (): void => {
    if (stopped || pending === null) return
    pending = null
    if (useDemo.getState().active || useTv.getState().on) return
    offerArrivalGame()
  }
  void savedChainLoaded().then(go, go)
  return () => { stopped = true }
}
