/**
 * useHandlers.ts - the apps that sell listed objects (NIP-89 handlers).
 *
 * A listing names the app it was published with (sno-core `listingApp`: the
 * `client` tag's coordinate, else an `a` naming a kind 31990). Its BUY button
 * opens that app's page for the listing when the app's handler says it shows
 * kind 33331 (sno-core `sellerLink`). This store fetches each handler once a
 * session, from the relays profiles are read from, and keeps it:
 *
 * - **Never in the card's way:** the card draws its fallback link at once and
 *   upgrades when a handler arrives.
 * - **Once per app:** a request already answered or in flight is not sent
 *   again, so a feed full of one app's listings asks the relays once.
 * - **Bounded:** at most HANDLERS_KEPT apps are remembered; the oldest go first.
 * - **Checked:** a handler counts only when its signature verifies and it is
 *   the coordinate's own (its author, kind 31990, its `d`); the newest wins.
 */

import { create } from 'zustand'
import { HANDLER_KIND, handlerFilter, type ListingApp } from 'sno-core/feed'
import { askEach, relaySet } from '../lib/relay'
import { GENERAL_RELAYS } from '../lib/contacts'
import type { NostrEvent } from '../lib/events'
import { verifiedFresh } from '../lib/foundCache'

/** The most apps remembered in a session. */
export const HANDLERS_KEPT = 200
/** How long the relays get to answer, as for a profile. */
const HANDLER_WAIT_MS = 4000

interface HandlersState {
  /** Each app's newest valid handler by coordinate; null when the relays had none. */
  handlers: Record<string, NostrEvent | null>
  /** Ask for an app's handler, unless it is known or already being asked for. */
  request: (app: ListingApp) => void
}

/** Coordinates being asked for now. */
const inFlight = new Set<string>()

/** Whether an event is this app's handler, signed by it. */
export function isHandlerOf(ev: NostrEvent, app: Pick<ListingApp, 'pubkey' | 'd'>): boolean {
  return ev.kind === HANDLER_KIND && ev.pubkey === app.pubkey && ev.tags.some((t) => t[0] === 'd' && t[1] === app.d) && verifiedFresh(ev)
}

export const useHandlers = create<HandlersState>((set, get) => ({
  handlers: {},
  request: (app) => {
    if (app.address in get().handlers || inFlight.has(app.address)) return
    inFlight.add(app.address)
    let best: NostrEvent | null = null
    const take = (ev: NostrEvent): void => {
      if (!isHandlerOf(ev, app)) return
      if (!best || ev.created_at > best.created_at || (ev.created_at === best.created_at && ev.id < best.id)) best = ev
    }
    void askEach([...new Set([...GENERAL_RELAYS, ...relaySet()])], handlerFilter(app), take, { maxWait: HANDLER_WAIT_MS, skipDead: true })
      .catch(() => [])
      .then(() => {
        inFlight.delete(app.address)
        const next = { ...get().handlers, [app.address]: best }
        const keys = Object.keys(next)
        // Insertion order is arrival order: past the bound, the oldest go.
        for (const k of keys.slice(0, Math.max(0, keys.length - HANDLERS_KEPT))) delete next[k]
        set({ handlers: next })
      })
  },
}))
