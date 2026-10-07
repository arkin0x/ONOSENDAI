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
 *
 * That fetch is the self-check (lib/chainHold.ts). It asks each relay on its
 * own and keeps what each one said (answered, refused, unreachable), because
 * the store acts differently on "this identity has a chain", "it has none"
 * and "nobody could say": a provisional identity's first move continues the
 * chain, starts one, or starts one HELD on this device. The answer is asked
 * for on every load, on every identity switch, and again whenever the last
 * answer was "nobody could say" and the connection shows signs of life: the
 * network coming back, the tab returning, a dead socket replaced
 * (relay.ts onResume), or the live subscription below reaching its EOSE.
 */

import { askChainEvents, fetchChainEvents, watchAuthor } from './chains'
import { decideSelfCheck } from './chainHold'
import { onResume } from './relay'
import type { NostrEvent } from './events'
import { DEFAULT_RELAY } from '../store/useRelays'
import { useCyberspace } from '../store/useCyberspace'

let close: (() => void) | null = null
let started = false
/** The pubkey a check is out for right now, so a recheck does not pile a second one on top. */
let checking: string | null = null
/**
 * A recheck was asked for while a check was out. The usual cause is two
 * resumes in a row (the network coming back, then the tab being shown): the
 * second one drops the sockets under the first check, which then reports
 * "unreachable". So the request is remembered and honored once the check in
 * flight has finished, if its answer was still "nobody could say".
 */
let again = false

/** The genesis of the chain this device holds for `pubkey`, which lets a fetch ask for it at once (chains.ts). */
function knownGenesis(pubkey: string): string | undefined {
  const s = useCyberspace.getState()
  return s.identity.pubkey === pubkey && s.genesisId ? s.genesisId : undefined
}

/** The events of the chain this device holds for `pubkey`, which fill holes in what the relays return. */
function knownEvents(pubkey: string): NostrEvent[] {
  const s = useCyberspace.getState()
  return s.identity.pubkey === pubkey ? s.events : []
}

/** navigator.onLine where there is a navigator; a test or a worker is taken as online. */
function online(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * Ask the relays whether `pubkey` has a chain and hand the verdict to the
 * store. Guarded: an identity switch may have raced the relay, and a chain
 * for the pubkey we just left must never land on the one we are now.
 */
async function check(pubkey: string): Promise<void> {
  if (checking === pubkey) { again = true; return }
  checking = pubkey
  again = false
  useCyberspace.getState().applySelfCheck(pubkey, { status: 'checking' })
  try {
    const answers = await askChainEvents(pubkey, knownGenesis(pubkey), knownEvents(pubkey))
    if (useCyberspace.getState().identity.pubkey !== pubkey) return
    useCyberspace.getState().applySelfCheck(pubkey, decideSelfCheck(answers, DEFAULT_RELAY, online()))
  } catch {
    // The query reports rather than throws; anything that escapes is a
    // relay we could not ask.
    if (useCyberspace.getState().identity.pubkey === pubkey) {
      useCyberspace.getState().applySelfCheck(pubkey, { status: 'unknown', cause: online() ? { kind: 'unreachable', reason: 'query failed' } : { kind: 'offline' } })
    }
  } finally {
    if (checking === pubkey) checking = null
    if (again) { again = false; recheckIfUnknown() }
  }
}

/** Ask again, but only when the last answer for the current identity was "nobody could say". */
export function recheckIfUnknown(): void {
  const s = useCyberspace.getState()
  if (s.selfCheck.pubkey === s.identity.pubkey && s.selfCheck.status === 'unknown') void check(s.identity.pubkey)
}

/** Ask again now, whatever the last answer was: the CHECK AGAIN button on a held chain. */
export function recheckNow(): void {
  void check(useCyberspace.getState().identity.pubkey)
}

/**
 * Unpublished moves, and a reason to think the relays moved on without
 * them: the switch just went LIVE, or the connection just came back. Another
 * device signed in as you may have published from the same point meanwhile.
 * The relays are asked for the chain and adoptChain compares; a fork against
 * the unpublished moves raises the diverged-branch prompt before the
 * publisher sends anything (lib/branchConflict.ts; arkinox, 2026-10-01).
 */
export function compareUnpublished(): void {
  const s = useCyberspace.getState()
  if (s.held || s.events.length === 0 || s.events.every((e) => s.published[e.id] === 'ok')) return
  const pubkey = s.identity.pubkey
  void fetchChainEvents(pubkey, knownGenesis(pubkey), knownEvents(pubkey))
    .then((events) => { if (useCyberspace.getState().identity.pubkey === pubkey) useCyberspace.getState().adoptChain(events) })
    .catch(() => { /* unreachable: the publisher's own look before sending tries again */ })
}

function resync(pubkey: string): void {
  if (close) { close(); close = null }
  const ifCurrent = (fn: () => void): void => {
    if (useCyberspace.getState().identity.pubkey === pubkey) fn()
  }
  const since = Math.floor(Date.now() / 1000) - 60
  close = watchAuthor(
    pubkey,
    since,
    (ev) => ifCurrent(() => useCyberspace.getState().adoptChain([ev])),
    // The live subscription reaching EOSE is the relay talking again; if the
    // check could not get through before, it may now.
    () => ifCurrent(recheckIfUnknown),
  )
  void check(pubkey)
}

/** Idempotent. Follows the active identity for the life of the page. */
export function startSelfSync(): void {
  if (started) return
  started = true
  resync(useCyberspace.getState().identity.pubkey)
  useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey !== prev.identity.pubkey) resync(s.identity.pubkey)
    else if (s.live && !prev.live) compareUnpublished()
  })
  // Not the window's own 'online' event: watchConnectivity answers that by
  // dropping every socket, and a check started first would be cut off by the
  // drop and read as "unreachable". onResume fires after the drop.
  onResume(recheckIfUnknown)
  onResume(compareUnpublished)
}
