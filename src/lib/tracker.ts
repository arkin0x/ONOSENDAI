/**
 * tracker.ts — keeps every target's position current.
 *
 * For each tracked pubkey: fetch its chain once, then hold a subscription so
 * a hop lands in the store the moment the relay has it. The store is the
 * list; this only reconciles against it, so adding or removing a target
 * anywhere in the UI is enough. A module singleton, for the same reason the
 * publisher and the spectator are: subscriptions outlive components.
 */

import { fetchChainEvents, mergeEvents, watchAuthor } from './chains'
import type { NostrEvent } from './events'
import { useCyberspace } from '../store/useCyberspace'

const subs = new Map<string, () => void>()
let started = false

async function track(pubkey: string): Promise<void> {
  let events: NostrEvent[] = []
  const since = Math.floor(Date.now() / 1000) - 60
  const close = watchAuthor(pubkey, since, (ev) => {
    if (!subs.has(pubkey)) return
    events = mergeEvents(events, [ev])
    useCyberspace.getState().setTargetChain(pubkey, events)
  })
  subs.set(pubkey, close)
  try {
    const fetched = await fetchChainEvents(pubkey)
    if (!subs.has(pubkey)) return
    events = mergeEvents(fetched, events)
    useCyberspace.getState().setTargetChain(pubkey, events)
  } catch {
    if (subs.has(pubkey)) useCyberspace.getState().setTargetChain(pubkey, events, 'error')
  }
}

function reconcile(): void {
  const wanted = new Set(Object.keys(useCyberspace.getState().targets))
  for (const [pk, close] of subs) {
    if (wanted.has(pk)) continue
    close()
    subs.delete(pk)
  }
  for (const pk of wanted) if (!subs.has(pk)) void track(pk)
}

/** Idempotent. Subscribes once for the life of the page. */
export function startTracker(): void {
  if (started) return
  started = true
  useCyberspace.subscribe((s, prev) => { if (s.targets !== prev.targets) reconcile() })
  reconcile()
}
