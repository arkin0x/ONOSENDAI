/**
 * spectator.ts — follows one avatar's chain off the relay and into the store.
 *
 * The store holds the spectated chain and decides what the scene does with
 * it; this is the socket side: fetch the chain, then keep a subscription open
 * for whatever that pubkey publishes next, so their hops arrive while you
 * watch. A module singleton, because there is one spectated avatar at a time
 * and a subscription has to outlive any component.
 */

import { fetchChainEvents, mergeEvents, watchAuthor } from './chains'
import { useCyberspace } from '../store/useCyberspace'

let current: { pubkey: string; close: () => void } | null = null

export async function spectate(pubkey: string): Promise<void> {
  stopSpectating()
  const store = useCyberspace.getState()
  store.beginSpectate(pubkey)

  // Anything published while the fetch is in flight is caught by the watch,
  // which starts from a minute ago so nothing falls between the two.
  const since = Math.floor(Date.now() / 1000) - 60
  let events: ReturnType<typeof mergeEvents> = []
  const close = watchAuthor(pubkey, since, (ev) => {
    if (current?.pubkey !== pubkey) return
    events = mergeEvents(events, [ev])
    useCyberspace.getState().setSpectateChain(pubkey, events)
  })
  current = { pubkey, close }

  try {
    const fetched = await fetchChainEvents(pubkey)
    if (current?.pubkey !== pubkey) return
    events = mergeEvents(fetched, events)
    useCyberspace.getState().setSpectateChain(pubkey, events)
  } catch {
    if (current?.pubkey !== pubkey) return
    useCyberspace.getState().setSpectateChain(pubkey, events, 'error')
  }
}

export function stopSpectating(): void {
  current?.close()
  current = null
  if (useCyberspace.getState().spectate) useCyberspace.getState().endSpectate()
}
