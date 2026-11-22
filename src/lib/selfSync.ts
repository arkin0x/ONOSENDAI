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
 *
 * Kept caught up (owner, 2026-11-21: "when I go to my tablet and refresh, it
 * doesn't immediately get the movement chain events I did on my phone"):
 *
 * | When | What is asked | Cost |
 * |---|---|---|
 * | load, identity switch | the self-check: spawns and the newest page of the chain, then every page down to what this device holds (chains.ts gatherChain); the HUD says CHECKING YOUR CHAIN meanwhile, and a move waits for it (useCyberspace confirmHead) | one check |
 * | the tab shown or focused, the network back, a dead socket replaced | the chain from the newest event the relays hold that this device has (the head check's question), paged the same way | one ask, at most every CATCH_UP_GAP_MS |
 * | another device publishes | the live watch delivers it (chains.ts watchOwnChain: no `since`, so moves signed hours ago while LOCAL and published now arrive too); one that does not link to the chain in hand asks the relays for what lies between | nothing per step |
 *
 * None of it ever signs anything. Every signature checks the head first
 * (confirmHead): from the standing subscriptions when a relay is current and
 * nothing it delivered is missing here (lib/ownWatch.ts, owner's ruling of
 * 2026-11-22), and otherwise by asking the relays, so a catch-up that is late
 * or fails costs a moment of a stale view, never a fork.
 */

import { askChainEvents, fetchChainEvents } from './chains'
import { reopenOwnWatch, retryWaitingOwnWatch, startOwnWatch } from './ownWatch'
import { decideSelfCheck } from './chainHold'
import { onCanonicalSignIn, onResume, retryFailedAuth } from './relay'
import { chainHolders } from './chainHolders'
import { signerHeld } from './authOpen'
import { actionLink, newestSpawn, type NostrEvent } from './events'
import type { RelayAnswer } from './relayOutcome'
import { requeueForCanonical } from './publisher'
import { normalizeURL } from 'nostr-tools/utils'
import { DEFAULT_RELAY } from '../store/useRelays'
import { newestOnRelays, useCyberspace } from '../store/useCyberspace'

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
  // Only the identity's first look on this page is CHECKING YOUR CHAIN and
  // holds a move: a recheck while the relays stay silent (every resume, every
  // dead probe) leaves CHAIN NOT CHECKED up until one answers.
  const first = useCyberspace.getState().chainSync?.pubkey !== pubkey
  if (first) setSync(pubkey, 'checking')
  try {
    const answers = await askChainEvents(pubkey, knownGenesis(pubkey), knownEvents(pubkey))
    if (useCyberspace.getState().identity.pubkey !== pubkey) return
    const verdict = decideSelfCheck(answers, DEFAULT_RELAY, online(), chainHolders(pubkey))
    useCyberspace.getState().applySelfCheck(pubkey, verdict)
    setSync(pubkey, verdict.status === 'unknown' ? 'unreachable' : 'done')
    requeueMissingOnCanonical(pubkey, answers)
  } catch {
    // The query reports rather than throws; anything that escapes is a
    // relay we could not ask.
    if (useCyberspace.getState().identity.pubkey === pubkey) {
      useCyberspace.getState().applySelfCheck(pubkey, { status: 'unknown', cause: online() ? { kind: 'unreachable', reason: 'query failed' } : { kind: 'offline' } })
    }
    setSync(pubkey, 'unreachable')
  } finally {
    if (checking === pubkey) checking = null
    // A check that was not taken in (an identity switch) leaves no CHECKING behind.
    const s = useCyberspace.getState()
    if (s.chainSync?.pubkey === pubkey && s.chainSync.status === 'checking') setSync(pubkey, 'unreachable')
    if (again) { again = false; recheckIfUnknown() }
    if (catchAgain) { catchAgain = false; catchUp('again') }
  }
}

/** What the HUD and a waiting move read about the check (store chainSync). */
function setSync(pubkey: string, status: 'checking' | 'done' | 'unreachable'): void {
  const cur = useCyberspace.getState().chainSync
  if (cur?.pubkey === pubkey && cur.status === status) return
  useCyberspace.setState({ chainSync: { pubkey, status } })
}

/** The least time between two catch-ups that a tab return or a focus asks for. */
export const CATCH_UP_GAP_MS = 3000
/** A catch-up out right now. */
let catching = false
/** One was asked for while a check or a catch-up was out: it runs once that one ends. */
let catchAgain = false
let lastCatchUp = -Infinity
/** Catch-ups in a row that got no answer: each doubles the gap before the next (to 16 times CATCH_UP_GAP_MS). */
let failures = 0
/** A catch-up put off to the end of the gap, at most one. */
let later: ReturnType<typeof setTimeout> | null = null

/**
 * Why a catch-up was asked for: `gap` is a live event that did not link to
 * the chain in hand, `again` one asked for while another was out. Every
 * reason is held to one per CATCH_UP_GAP_MS (doubled after each that got
 * no answer); a gap or a resume asked inside it runs once at its end,
 * since it may be about something new. A focus inside it is dropped: the
 * last catch-up answered it.
 */
export type CatchUpReason = 'focus' | 'resume' | 'gap' | 'again'

/**
 * Ask the relays for the chain from the newest event they hold that this
 * device has (the head check's question, paged the same way: chains.ts
 * gatherChain) and fold in what is newer, so the position, the chip and the
 * scene go to the true head without a move. Never signs; a fork against
 * unpublished moves raises the diverged-branch prompt (adoptChain). One at a
 * time, and nothing while the self-check is out, which asks the same
 * question already.
 */
export function catchUp(reason: CatchUpReason = 'focus'): void {
  const s = useCyberspace.getState()
  const pubkey = s.identity.pubkey
  // One out already answers a focus; a gap or a resume may be about something
  // newer than its question, so it is asked once more when that one ends.
  if (checking === pubkey || catching) { if (reason !== 'focus') catchAgain = true; return }
  // No chain here yet: the question is the self-check's, asked again when it could not say.
  if (s.events.length === 0) { recheckIfUnknown(); return }
  const now = Date.now()
  const gap = CATCH_UP_GAP_MS * 2 ** Math.min(failures, 4)
  if (now - lastCatchUp < gap) {
    if (reason !== 'focus' && later === null) later = setTimeout(() => { later = null; catchUp('again') }, gap - (now - lastCatchUp))
    return
  }
  lastCatchUp = now
  catching = true
  const since = newestOnRelays(s.events, s.published)
  void fetchChainEvents(pubkey, knownGenesis(pubkey), knownEvents(pubkey), since)
    .then((events) => {
      // Nothing back at all is no answer: a relay holding this chain sends
      // at least the event `since` was taken from.
      failures = events.length === 0 && since !== undefined ? failures + 1 : 0
      if (useCyberspace.getState().identity.pubkey !== pubkey) return
      useCyberspace.getState().adoptChain(events)
      const sync = useCyberspace.getState().chainSync
      if (failures === 0 && sync?.pubkey === pubkey && sync.status === 'unreachable') setSync(pubkey, 'done')
    })
    .catch(() => { failures++ /* unreachable, or a hole: the head check before any signature asks again */ })
    .finally(() => {
      catching = false
      if (catchAgain) { catchAgain = false; catchUp('again') }
    })
}

/**
 * A live event of the chain in hand that the fold did not take: its
 * previous event is not here (it was published while this socket was
 * down, or the watch only just opened). The relays are asked for what lies
 * between. Not during a proof, a held chain or a pending choice, where the
 * store keeps what arrives for later on purpose.
 */
function linkMissing(ev: NostrEvent): boolean {
  const s = useCyberspace.getState()
  if (s.held || s.chainConflict || s.proof.status === 'computing' || s.events.length === 0) return false
  const link = actionLink(ev)
  if (!link || link.genesisId !== s.genesisId) return false
  return !s.events.some((e) => e.id === ev.id)
}

/**
 * Published events of this device's chain that the canonical relay's answer
 * just now did not include: another relay may have taken them and the
 * canonical relay never did, and a reload forgot that it still had to
 * (verification of #236, finding 3).
 *
 * That answer is not a list of everything the relay holds. The relay sends
 * at most 500 events to a filter (relay.onosendai.tech, grain), and the chain
 * read fills the holes below that page from this device's own events rather
 * than paging (chains.ts gatherChain), so on a chain longer than one page
 * every older event is left out of it. Read as "missing", that made every
 * load requeue the whole older chain: 1520 of the owner's actions the relay
 * held, warned about as not there (2026-11-09). So these are only suspects:
 * the publisher checks them by id on the canonical relay (a COUNT, then the
 * ids of a batch that counted short) before it counts any of them
 * (publisher.ts reconcileCanonical). What it lacks goes out again, and so
 * does what it could not be asked about (a read refused for want of AUTH,
 * or no answer three passes in a row), where its "duplicate:" clears what
 * it had.
 *
 * They are never dropped from this device's chain for it: the chain this
 * device holds stays the chain, and the canonical relay is brought up to it.
 * Nothing is handed over when the canonical relay did not answer (a timeout,
 * a refusal, a hole: unknown, never missing), or when its newest spawn is
 * newer than this chain's (this chain is the old one then).
 */
function requeueMissingOnCanonical(pubkey: string, answers: RelayAnswer[]): void {
  const canonical = normalizeURL(DEFAULT_RELAY)
  const answer = answers.find((a) => normalizeURL(a.url) === canonical && a.outcome === 'answered')
  if (!answer) return
  const s = useCyberspace.getState()
  if (s.identity.pubkey !== pubkey || s.events.length === 0) return
  const ours = newestSpawn(s.events, pubkey)
  const theirs = newestSpawn(answer.events, pubkey)
  if (ours && theirs && theirs.id !== ours.id && theirs.created_at > ours.created_at) return
  const held = new Set(answer.events.map((e) => e.id))
  const missing = s.events.filter((e) => s.published[e.id] === 'ok' && !held.has(e.id))
  if (missing.length > 0) requeueForCanonical(missing)
}

/** Ask again, but only when the last answer for the current identity was "nobody could say". */
export function recheckIfUnknown(): void {
  const s = useCyberspace.getState()
  if (s.selfCheck.pubkey === s.identity.pubkey && s.selfCheck.status === 'unknown') void check(s.identity.pubkey)
}

/** Ask again now, whatever the last answer was: the CHECK AGAIN button on a held chain. */
export function recheckNow(): void {
  // A deliberate tap, as RETRY is: every relay this chain lives on (the
  // canonical relay and its known holders) whose AUTH the signer turned down
  // or let run out asks it again, so the check that follows can be read
  // signed in, and the prompt the panel speaks of is really shown. No other
  // relay is asked: the check does not wait on it.
  const pubkey = useCyberspace.getState().identity.pubkey
  const holders = chainHolders(pubkey)
  for (const url of [...signerHeld]) if (holders.has(url)) retryFailedAuth(url)
  void check(pubkey)
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
  // One standing subscription per relay (lib/ownWatch.ts), which the head
  // check before a signature also reads (owner's ruling of 2026-11-22). Every
  // relay delivers the same move: it is taken in once.
  const seen = new Set<string>()
  close = startOwnWatch(
    pubkey,
    (ev) => ifCurrent(() => {
      if (seen.has(ev.id)) return
      seen.add(ev.id)
      if (seen.size > 512) seen.delete(seen.values().next().value as string)
      useCyberspace.getState().adoptChain([ev])
      if (linkMissing(ev)) catchUp('gap')
    }),
    // A relay's subscription reaching EOSE is the relay talking again; if the
    // check could not get through before, it may now.
    () => ifCurrent(recheckIfUnknown),
    // A (re)subscription also asks from the second of the newest move on the relays, inclusive.
    () => { const s = useCyberspace.getState(); return s.identity.pubkey === pubkey ? newestOnRelays(s.events, s.published) : undefined },
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
  onResume(() => catchUp('resume'))
  // The sockets were dropped: every relay's watch opens again, and is not current until its EOSE.
  onResume(reopenOwnWatch)
  onCanonicalSignIn(retryWaitingOwnWatch)
  watchShown(() => catchUp('focus'))
}

/**
 * The tab shown again or the window focused. Its own listeners rather than
 * relay.ts watchTabReturn, which also asks the signer to sign in again after
 * an absence: App.tsx already does that once.
 */
function watchShown(fn: () => void): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return
  const shown = (): void => { if (document.visibilityState === 'visible') fn() }
  document.addEventListener('visibilitychange', shown)
  window.addEventListener('focus', shown)
  window.addEventListener('pageshow', shown)
}
