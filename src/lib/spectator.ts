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
import { useCyberspace, type KnownStand } from '../store/useCyberspace'
import { useBuilder } from '../store/useBuilder'
import { buildChain, type NostrEvent } from './events'
import { useMutes } from '../store/useMutes'
import { BRIEF_TOAST_MS, useToast } from '../store/useToast'
import { usePresence } from '../store/usePresence'
import { useRoster } from '../store/useRoster'
import { heldChain, standingOf } from './neighborChains'

/**
 * Where `pubkey` was last seen standing, before their chain is fetched: the
 * newest of what this client already holds about them, or null when it holds
 * nothing (owner, 2026-11-14: "i saw this avatar moving at block 101 yes
 * when i hit spectate it puts me all the way at his spawn and says fetching
 * chain"). Presence first, where they are drawn near you, their chain
 * already read and its stops applied (usePresence, lib/neighborChains.ts);
 * then a target already placed; then the AVATARS list's newest action,
 * placed by its cached verdict (standingOf). A tie goes to the earlier.
 */
export function knownStand(pubkey: string): KnownStand | null {
  const found: KnownStand[] = []
  const person = usePresence.getState().people[pubkey]
  if (person) found.push({ position: person.position, plane: person.plane, lastActive: person.lastActive })
  const target = useCyberspace.getState().targets[pubkey]
  if (target && (target.status === 'live' || target.status === 'partial')) found.push({ position: target.position, plane: target.plane, lastActive: target.lastActive })
  const listed = useRoster.getState().list.find((a) => a.pubkey === pubkey)
  if (listed) {
    const at = standingOf(listed)
    found.push({ position: at.position, plane: at.plane, lastActive: at.createdAt })
  }
  let best: KnownStand | null = null
  for (const k of found) if (best === null || (k.lastActive ?? -1) > (best.lastActive ?? -1)) best = k
  return best ? { ...best, position: { ...best.position } } : null
}

/**
 * Their chain as presence already read it (lib/neighborChains.ts), when it
 * reaches the action presence draws them at: shown at once, trail and all,
 * while the relays are asked again. Empty when presence has not read it, or
 * read it before the action it shows, which would stand them somewhere older.
 */
function chainInHand(pubkey: string): NostrEvent[] {
  const person = usePresence.getState().people[pubkey]
  if (!person) return []
  const held = heldChain(pubkey)
  return buildChain(held, pubkey).some((a) => a.id === person.actionId) ? held : []
}

let current: { pubkey: string; close: () => void } | null = null

export async function spectate(pubkey: string, seed: NostrEvent[] = []): Promise<void> {
  // Someone blocked is not watched: their avatar and chain are what the block hides (store/useMutes).
  if (useMutes.getState().muted.pubkeys.has(pubkey)) {
    useToast.getState().show({ label: 'BLOCKED', meta: 'Unblock them to spectate.', mark: 'block', ms: BRIEF_TOAST_MS })
    return
  }
  // From one avatar to the next, only the old watch closes: the spectation
  // itself is replaced by beginSpectate, which carries the first one's
  // return view over. Ending it here first dropped that view in BUILD mode,
  // where ending a spectation puts no angle back, so the camera came home
  // to the angle of the switch (review of #235).
  closeWatch()
  const store = useCyberspace.getState()
  // In BUILD mode the build cursor's view stays up and is aimed at them, so
  // the mode carries on beside the spectation (store/useBuilder.ts).
  // They start where they were last seen, if anywhere (knownStand), and
  // FETCHING CHAIN says the rest is on its way.
  store.beginSpectate(pubkey, useBuilder.getState().active, knownStand(pubkey))

  // Anything published while the fetch is in flight is caught by the watch,
  // which starts from a minute ago so nothing falls between the two.
  const since = Math.floor(Date.now() / 1000) - 60
  // A chain already in hand (a spectation being resumed) stands at once, so
  // the explored link survives the refetch: the ids match and the store keeps it.
  let events: ReturnType<typeof mergeEvents> = mergeEvents([], seed)
  if (events.length > 0) store.setSpectateChain(pubkey, events)
  else {
    // The chain presence already read is shown while the relays are asked
    // again; FETCHING CHAIN stays up until they answer.
    events = mergeEvents([], chainInHand(pubkey))
    if (events.length > 0) store.setSpectateChain(pubkey, events, 'loading')
  }
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

function closeWatch(): void {
  current?.close()
  current = null
}

export function stopSpectating(): void {
  closeWatch()
  if (useCyberspace.getState().spectate) useCyberspace.getState().endSpectate()
}

let watchingBlocks = false

/**
 * A block of the person being spectated ends the spectation: their avatar
 * and chain are what it hides (store/useMutes). Started from App, once every
 * store has loaded: the mute store is imported by the stores this one
 * imports, so a subscription made while this module loads could run first.
 */
export function watchBlockedSpectation(): void {
  if (watchingBlocks) return
  watchingBlocks = true
  useMutes.subscribe((s, prev) => {
    if (s.muted === prev.muted) return
    const watched = useCyberspace.getState().spectate?.pubkey
    if (watched && s.muted.pubkeys.has(watched)) stopSpectating()
  })
}

// However a spectation ends (END SPECTATION, a view that replaces it, an
// identity switch), the relay watch on that pubkey goes with it. focusOn
// clears the spectation in the store and could not reach the socket here,
// so the subscription used to stay open (review of #235).
useCyberspace.subscribe((s) => {
  if (current && s.spectate?.pubkey !== current.pubkey) closeWatch()
})
