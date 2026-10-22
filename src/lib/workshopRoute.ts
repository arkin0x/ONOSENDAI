/**
 * workshopRoute.ts: onosendai.tech/workshop opens the shard workshop, the
 * same workshop OPEN WORKSHOP in the menu opens (store/useWorkshop.ts), for
 * a link that should land a first-time visitor straight in it (arkinox,
 * 2026-10-22: linked from the livestream page for beginners).
 *
 * Read when the app starts, after its normal boot: a visitor with no key
 * gets the throwaway one every first visit gets, and the workshop opens on
 * the newest model, or a new one when there is none. Closing it, by X, Esc
 * or DEPLOY, leaves the app where it is and puts the address back to the
 * site's root, so a reload does not reopen it. Back off /workshop closes
 * it, Forward onto /workshop opens it, as loading that address would.
 */

import { useWorkshop } from '../store/useWorkshop'

/** Whether an address is the workshop's: /workshop or /workshop/, in any case. */
export function isWorkshopPath(pathname: string): boolean {
  return /^\/workshop\/?$/i.test(pathname)
}

type Loc = Pick<Location, 'pathname' | 'search' | 'hash'>
type Events = Pick<Window, 'addEventListener' | 'removeEventListener'>

/**
 * Open the workshop when the current address is /workshop, and keep the
 * address and the workshop in step from then on. Returns what undoes the
 * watching (tests, and a remount in development).
 */
export function startWorkshopRoute(
  loc: Loc = window.location,
  history: Pick<History, 'replaceState'> = window.history,
  events: Events = window,
): () => void {
  if (isWorkshopPath(loc.pathname)) useWorkshop.getState().openWorkshop()
  let wasAt = isWorkshopPath(loc.pathname)

  // Closed while the address still says /workshop: the root, with whatever
  // query and fragment the link carried, as a /C/ link's ending does. Closed
  // at all, the address has no workshop of its own any more: one opened from
  // the menu later is not Back's to close (review of #445).
  const unsubscribe = useWorkshop.subscribe((s, prev) => {
    if (!prev.open || s.open) return
    wasAt = false
    if (!isWorkshopPath(loc.pathname)) return
    try { history.replaceState(null, '', `/${loc.search}${loc.hash}`) } catch { /* no history here */ }
  })

  // Only a move off a /workshop entry closes it: a workshop opened from the
  // menu is not this address's to close.
  const onPop = (): void => {
    const at = isWorkshopPath(loc.pathname)
    const ws = useWorkshop.getState()
    if (at && !ws.open) ws.openWorkshop()
    else if (!at && wasAt && ws.open) ws.closeWorkshop()
    wasAt = at
  }
  events.addEventListener('popstate', onPop)
  return () => { unsubscribe(); events.removeEventListener('popstate', onPop) }
}
