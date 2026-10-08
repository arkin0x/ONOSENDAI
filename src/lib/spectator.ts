/**
 * spectator.ts — follows one avatar's chain off the relay and into the store.
 *
 * The store holds the spectated chain and decides what the scene does with
 * it; this is the socket side: fetch the chain, then keep a subscription open
 * for whatever that pubkey publishes next, so their hops arrive while you
 * watch. A module singleton, because there is one spectated avatar at a time
 * and a subscription has to outlive any component.
 */

import { ChainGapError, fetchChainEvents, mergeEvents, watchAuthor } from './chains'
import { useCyberspace } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import type { NostrEvent } from './events'

let current: { pubkey: string; close: () => void } | null = null

export async function spectate(pubkey: string, seed: NostrEvent[] = []): Promise<void> {
  stopSpectating()
  const store = useCyberspace.getState()
  // In BUILD mode the build cursor's view stays up and is aimed at them, so
  // the mode carries on beside the spectation (store/useBuilder.ts).
  store.beginSpectate(pubkey, useBuilder.getState().active)

  // Anything published while the fetch is in flight is caught by the watch,
  // which starts from a minute ago so nothing falls between the two.
  const since = Math.floor(Date.now() / 1000) - 60
  // A chain already in hand (a spectation being resumed) stands at once, so
  // the explored link survives the refetch: the ids match and the store keeps it.
  let events: ReturnType<typeof mergeEvents> = mergeEvents([], seed)
  if (events.length > 0) store.setSpectateChain(pubkey, events)
  // Set when the relays hold the chain with a stretch missing; kept for every
  // later update, since a new action does not fill an old hole.
  let partial = false
  const close = watchAuthor(pubkey, since, (ev) => {
    if (current?.pubkey !== pubkey) return
    events = mergeEvents(events, [ev])
    useCyberspace.getState().setSpectateChain(pubkey, events, partial ? 'partial' : undefined)
  })
  current = { pubkey, close }

  try {
    const fetched = await fetchChainEvents(pubkey)
    if (current?.pubkey !== pubkey) return
    events = mergeEvents(fetched, events)
    useCyberspace.getState().setSpectateChain(pubkey, events)
  } catch (err) {
    if (current?.pubkey !== pubkey) return
    // A stretch of the chain is on no relay: show it up to the hole and say
    // so, because for a viewer the hole may never fill. Your own chain holds
    // on the same answer instead (chainHold.ts).
    if (err instanceof ChainGapError) {
      partial = true
      events = mergeEvents(err.events, events)
      useCyberspace.getState().setSpectateChain(pubkey, events, 'partial')
      return
    }
    useCyberspace.getState().setSpectateChain(pubkey, events, 'error')
  }
}

export function stopSpectating(): void {
  current?.close()
  current = null
  if (useCyberspace.getState().spectate) useCyberspace.getState().endSpectate()
}
