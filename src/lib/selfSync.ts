/**
 * selfSync.ts — your own avatar, kept in step across machines.
 *
 * The publisher pushes your chain out; this pulls it back. Move on one device
 * and the relay has the hop; this subscription hands it to the store, which
 * adopts it (§3.2), so every other device you are signed in on catches up at
 * once instead of drifting into two conflicting chains.
 *
 * It is also how a switched-in identity finds the chain it already has: login
 * places you provisionally at your spawn coordinate and signs nothing, and the
 * fetch here fills in your real position from the relay a moment later. A module
 * singleton, like the publisher and the tracker, because a subscription has to
 * outlive the components that happen to be mounted.
 */

import { fetchChainEvents, watchAuthor } from './chains'
import { useCyberspace } from '../store/useCyberspace'

let close: (() => void) | null = null
let started = false

function resync(pubkey: string): void {
  if (close) { close(); close = null }
  // Guard every callback: an identity switch may have raced the relay, and a
  // chain for the pubkey we just left must never land on the one we are now.
  const ifCurrent = (fn: () => void): void => {
    if (useCyberspace.getState().identity.pubkey === pubkey) fn()
  }
  const since = Math.floor(Date.now() / 1000) - 60
  close = watchAuthor(pubkey, since, (ev) =>
    ifCurrent(() => useCyberspace.getState().adoptChain([ev])),
  )
  void fetchChainEvents(pubkey)
    .then((events) => ifCurrent(() => useCyberspace.getState().adoptChain(events)))
    .catch(() => { /* relay unreachable: the local chain still stands */ })
}

/** Idempotent. Follows the active identity for the life of the page. */
export function startSelfSync(): void {
  if (started) return
  started = true
  resync(useCyberspace.getState().identity.pubkey)
  useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey !== prev.identity.pubkey) resync(s.identity.pubkey)
  })
}
