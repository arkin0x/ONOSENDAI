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

import { askChainEvents, fetchChainEvents, mergeEvents } from './chains'
import { outsideChain, reopenOwnWatch, retryWaitingOwnWatch, startOwnWatch } from './ownWatch'
import { decideSelfCheck, type CheckVerdict } from './chainHold'
import { onCanonicalSignIn, onResume, retryFailedAuth } from './relay'
import { chainHolders } from './chainHolders'
import { signerHeld } from './authOpen'
import { actionLink, newestSpawn, type NostrEvent } from './events'
import { idsOf, newestOrphan, sortIncoming } from './chainOrphans'
import { backlogEvents, backlogSize, countBacklog, keepAnswers, keepEvents, resumeBacklog, settleBacklog } from './ownBacklog'
import { verifyOnce } from './verifiedSigs'
import type { RelayAnswer } from './relayOutcome'
import { requeueForCanonical } from './publisher'
import { normalizeURL } from 'nostr-tools/utils'
import { DEFAULT_RELAY, READ_FALLBACK_RELAY } from '../store/useRelays'
import { newestOnRelays, signedOnThisPage, useCyberspace } from '../store/useCyberspace'

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
    // What an earlier attempt fetched of a stretch another device published,
    // this page's and the rows' (lib/ownBacklog.ts): held as in hand, so only
    // what is still missing is asked for.
    const genesis = knownGenesis(pubkey)
    const since = sinceFor(pubkey)
    const resumed = genesis ? await resumeBacklog(pubkey, genesis, since) : []
    if (useCyberspace.getState().identity.pubkey !== pubkey) return
    if (resumed.length > 0) longBacklog(pubkey)
    const known = knownEvents(pubkey)
    const answers = await askChainEvents(pubkey, genesis, resumed.length > 0 ? known.concat(resumed) : known, {
      onAnswers: heard(pubkey),
      onPaging: () => longBacklog(pubkey),
      deadline: Date.now() + CATCH_UP_DEADLINE_MS,
    })
    if (useCyberspace.getState().identity.pubkey !== pubkey) return
    let verdict: CheckVerdict = decideSelfCheck(answers, DEFAULT_RELAY, online(), checkHolders(pubkey))
    // The answer is the newest stretch; what was kept fills it down to the chain in hand.
    if (verdict.status === 'found' && genesis) {
      const kept = backlogEvents(pubkey, genesis)
      if (kept.length > 0) verdict = { status: 'found', events: mergeEvents(verdict.events, kept) }
    }
    useCyberspace.getState().applySelfCheck(pubkey, verdict)
    if (verdict.status === 'unknown' && backlogFor(pubkey)) {
      // Cut short (its deadline, a hole for now, a relay gone quiet): what it
      // brought is kept and the next attempt goes on from there, after a wait.
      cutShort(pubkey, () => { void check(pubkey) })
      setSync(pubkey, 'unreachable')
    } else {
      if (verdict.status !== 'unknown') closeBacklog(pubkey)
      setSync(pubkey, verdict.status === 'unknown' ? 'unreachable' : 'done')
    }
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
export type CatchUpReason = 'focus' | 'resume' | 'gap' | 'again' | 'retry'

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
  // A catch-up cut short goes on when its wait is over (cutShort), or at once when the network is back.
  const waiting = backlogFor(pubkey)
  if (waiting?.retry) {
    if (reason !== 'resume') return
    clearTimeout(waiting.retry)
    waiting.retry = null
  }
  const now = Date.now()
  const gap = CATCH_UP_GAP_MS * 2 ** Math.min(failures, 4)
  // A retry of a catch-up cut short keeps its own backoff (cutShort).
  if (reason !== 'retry' && now - lastCatchUp < gap) {
    if (reason !== 'focus' && later === null) later = setTimeout(() => { later = null; catchUp('again') }, gap - (now - lastCatchUp))
    return
  }
  lastCatchUp = now
  catching = true
  const since = newestOnRelays(s.events, s.published)
  const genesis = knownGenesis(pubkey)
  void (genesis ? resumeBacklog(pubkey, genesis, since) : Promise.resolve([] as NostrEvent[]))
    .then((resumed) => {
      if (resumed.length > 0) longBacklog(pubkey)
      const known = knownEvents(pubkey)
      return fetchChainEvents(pubkey, genesis, resumed.length > 0 ? known.concat(resumed) : known, since, {
        onAnswers: heard(pubkey),
        onPaging: () => longBacklog(pubkey),
        deadline: Date.now() + CATCH_UP_DEADLINE_MS,
      })
    })
    .then((events) => {
      // Nothing back at all is no answer: a relay holding this chain sends
      // at least the event `since` was taken from.
      failures = events.length === 0 && since !== undefined ? failures + 1 : 0
      if (useCyberspace.getState().identity.pubkey !== pubkey) return
      // The stretch whole: adopted in one go, with what earlier attempts kept.
      const kept = genesis ? backlogEvents(pubkey, genesis) : []
      useCyberspace.getState().adoptChain(kept.length > 0 ? mergeEvents(events, kept) : events)
      closeBacklog(pubkey)
      const sync = useCyberspace.getState().chainSync
      if (failures === 0 && sync?.pubkey === pubkey && sync.status === 'unreachable') setSync(pubkey, 'done')
    })
    .catch(() => {
      // Unreachable, or a hole: the head check before any signature asks
      // again, and a stretch being caught up is tried again after a wait.
      failures++
      if (backlogFor(pubkey)) cutShort(pubkey, () => catchUp('retry'))
    })
    .finally(() => {
      catching = false
      if (catchAgain) { catchAgain = false; catchUp('again') }
    })
}

/** Live events that land within this long of the first are folded together, once. */
export const LIVE_BATCH_MS = 40
/** One catch-up attempt asks for no more pages after this long; what it brought is kept, and the next goes on from there. */
export const CATCH_UP_DEADLINE_MS = 60_000
/** The wait before the next attempt, by attempts in a row that brought nothing (the first entry after one that brought something). */
export const CATCH_UP_RETRY_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 60_000]
/** Attempts in a row that brought nothing before the HUD says CHAIN NOT CHECKED rather than CATCHING UP. */
export const STUCK_AFTER = 3

/**
 * Catching up with your other device: a stretch of this chain the relays
 * hold and this device does not (owner's tablet, 2026-11-27: 3,760 moves
 * made on the phone). Opened when the first answer of a fetch leaves a hole
 * (the pages begin), when an earlier attempt's pages were kept, or when the
 * live watch delivers a move whose previous one is not here. While it is
 * open the HUD says CATCHING UP got / total, the newest move from the other
 * device is shown at once (showCatchUpHead), and nothing is signed
 * (whyNoMove, confirmHead). Every page is kept as it lands
 * (lib/ownBacklog.ts); an attempt cut short by its deadline or a hole is
 * tried again with a backoff, and only STUCK_AFTER attempts in a row that
 * bring nothing say CHAIN NOT CHECKED. Closed when the stretch is whole and
 * adopted in one go, or when the chain it was for is gone.
 *
 * | Step | Cost |
 * |---|---|
 * | live moves, folded with whatever lands within LIVE_BATCH_MS; one that does not link to the chain in hand set aside after a lookup (lib/chainOrphans.ts) | no build of the chain |
 * | the stretch, a page per 500 moves from the relays that hold the chain, kept as it lands | one attempt, retried with a backoff |
 * | its adoption | one fold |
 */
interface Backlog {
  pubkey: string
  genesisId: string
  /** The newest event of the chain in hand the relays held when it opened: what the count is from. */
  since: number | undefined
  total: number | null
  /** The canonical relay was asked to count it (longBacklog). */
  counted: boolean
  /** Attempts in a row that brought nothing. */
  idle: number
  /** Events this attempt brought so far. */
  added: number
  retry: ReturnType<typeof setTimeout> | null
  /** The other device's newest move, shown already. */
  headId: string | null
}
let backlog: Backlog | null = null

function backlogFor(pubkey: string): Backlog | null {
  const b = backlog
  return b && b.pubkey === pubkey && b.genesisId === useCyberspace.getState().genesisId ? b : null
}

/** The second of the newest event of `pubkey`'s chain in hand that the relays hold. */
function sinceFor(pubkey: string): number | undefined {
  const s = useCyberspace.getState()
  return s.identity.pubkey === pubkey ? newestOnRelays(s.events, s.published) : undefined
}

/** Open the catch-up for the chain in hand, or the one open already. Null with no chain in hand. */
function openBacklog(pubkey: string): Backlog | null {
  const s = useCyberspace.getState()
  if (s.identity.pubkey !== pubkey || !s.genesisId || s.events.length === 0) return null
  const cur = backlogFor(pubkey)
  if (cur) return cur
  dropBacklog()
  const since = newestOnRelays(s.events, s.published)
  const b: Backlog = { pubkey, genesisId: s.genesisId, since, total: null, counted: false, idle: 0, added: 0, retry: null, headId: null }
  backlog = b
  showBacklog(b)
  return b
}

/**
 * The catch-up for a stretch longer than one answer (the pages began, or an
 * earlier attempt's were kept): opened, and its size asked of the canonical
 * relay once, with one COUNT, for the chip's total.
 */
function longBacklog(pubkey: string): void {
  const b = openBacklog(pubkey)
  if (!b || b.counted || b.since === undefined) return
  b.counted = true
  const since = b.since
  let atOrAfter = 0
  for (const e of useCyberspace.getState().events) if (e.created_at >= since) atOrAfter++
  void countBacklog(pubkey, b.genesisId, since, atOrAfter).then((n) => {
    if (backlog !== b || n === null) return
    b.total = n
    showBacklog(b)
  })
}

/** What the HUD shows of it (store chainCatchUp). */
function showBacklog(b: Backlog): void {
  if (backlog !== b) return
  const got = backlogSize(b.pubkey)
  useCyberspace.getState().setChainCatchUp({ pubkey: b.pubkey, got, total: b.total === null ? null : Math.max(b.total, got), stuck: b.idle >= STUCK_AFTER, headId: b.headId })
}

/** Forget the catch-up without a word to the store (an identity switch resets it there). */
function dropBacklog(): void {
  if (backlog?.retry) clearTimeout(backlog.retry)
  backlog = null
}

/** The stretch is in (or the chain it was for is gone): the HUD and the hold on moves go. */
function closeBacklog(pubkey: string): void {
  const b = backlog
  if (!b || b.pubkey !== pubkey) return
  dropBacklog()
  const s = useCyberspace.getState()
  settleBacklog(pubkey, idsOf(s.events), s.genesisId)
  if (s.chainCatchUp?.pubkey === pubkey) s.setChainCatchUp(null)
}

/** Each relay's checked answer, as it lands: kept (lib/ownBacklog.ts), counted and shown. */
function heard(pubkey: string): (answers: RelayAnswer[]) => void {
  return (answers) => {
    const s = useCyberspace.getState()
    if (s.identity.pubkey !== pubkey || !s.genesisId) return
    const n = keepAnswers(pubkey, s.genesisId, answers, idsOf(s.events))
    const b = backlogFor(pubkey)
    if (b) { b.added += n; showBacklog(b) }
  }
}

/** An attempt that ended with the stretch still not whole: `retry` after a wait, longer for each in a row that brought nothing. */
function cutShort(pubkey: string, retry: () => void): void {
  const b = backlogFor(pubkey)
  if (!b) return
  b.idle = b.added > 0 ? 0 : b.idle + 1
  b.added = 0
  showBacklog(b)
  if (b.retry) clearTimeout(b.retry)
  const wait = CATCH_UP_RETRY_MS[Math.min(b.idle, CATCH_UP_RETRY_MS.length - 1)]
  b.retry = setTimeout(() => {
    b.retry = null
    // Offline, the network coming back asks again (onResume).
    if (backlog === b && online()) retry()
  }, wait)
}

/**
 * Live events of your own, folded together (LIVE_BATCH_MS). Those whose
 * previous event is not here are set aside by the store after a lookup
 * (lib/chainOrphans.ts) and start one catch-up; the newest of them is shown
 * at once. Not during a proof, a held chain or a pending choice, where the
 * store keeps what arrives for later on purpose.
 */
function takeLive(pubkey: string, got: Array<{ ev: NostrEvent; url: string }>): void {
  const events = got.map((g) => g.ev)
  useCyberspace.getState().adoptChain(events)
  const s = useCyberspace.getState()
  if (s.identity.pubkey !== pubkey || s.held || s.chainConflict || s.proof.status === 'computing' || s.events.length === 0 || !s.genesisId) return
  const inHand = idsOf(s.events)
  const fresh = events.filter((e) => e.pubkey === pubkey && !inHand.has(e.id))
  if (fresh.length === 0) return
  const orphans = sortIncoming(fresh, inHand, s.genesisId).orphans.filter((e) => actionLink(e)?.genesisId === s.genesisId)
  if (orphans.length === 0) return
  const b = openBacklog(pubkey)
  // Kept as rows only with their signatures checked (the pool checks them on
  // receipt; a repeat costs nothing): a kept row is flagged as checked.
  const sound = orphans.filter((e) => verifyOnce(e))
  const ids = new Set(sound.map((e) => e.id))
  const byUrl = new Map<string, NostrEvent[]>()
  for (const g of got) if (ids.has(g.ev.id)) byUrl.set(g.url, [...(byUrl.get(g.url) ?? []), g.ev])
  for (const [url, evs] of byUrl) keepEvents(pubkey, s.genesisId, evs, url, inHand)
  const head = s.events.find((e) => e.id === s.prevEventId)
  const newest = newestOrphan(sound, s.genesisId, head?.created_at ?? 0)
  if (b && newest && newest.id !== b.headId && s.showCatchUpHead(newest)) b.headId = newest.id
  if (b) showBacklog(b)
  catchUp('gap')
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

/**
 * The relays whose AUTH held up by the signer leaves the self-check saying
 * nothing (chainHold decideSelfCheck): the chain's holders, and the read-only
 * old relay (useRelays READ_FALLBACK_RELAY) too. It never holds up a move
 * (chainHolders), but a chain that lives only there (a client that publishes
 * only to it) must not be read as "none" while it cannot be read, or the
 * first move would start a live new chain over it.
 */
export function checkHolders(pubkey: string): Set<string> {
  return new Set([...chainHolders(pubkey), normalizeURL(READ_FALLBACK_RELAY)])
}

/**
 * Ask again, but only when the last answer for the current identity was
 * "nobody could say". A catch-up cut short waits out its own backoff
 * (cutShort) rather than being asked again at every relay's EOSE; `now`
 * (the network back, a dead socket replaced) asks at once.
 */
export function recheckIfUnknown(now = false): void {
  const s = useCyberspace.getState()
  if (s.selfCheck.pubkey !== s.identity.pubkey || s.selfCheck.status !== 'unknown') return
  const b = backlogFor(s.identity.pubkey)
  if (b?.retry) {
    if (!now) return
    clearTimeout(b.retry)
    b.retry = null
  }
  void check(s.identity.pubkey)
}

/** Ask again now, whatever the last answer was: the CHECK AGAIN button on a held chain. */
export function recheckNow(): void {
  // A deliberate tap, as RETRY is: every relay this chain lives on (the
  // canonical relay and its known holders) whose AUTH the signer turned down
  // or let run out asks it again, so the check that follows can be read
  // signed in, and the prompt the panel speaks of is really shown. No other
  // relay is asked: the check does not wait on it.
  const pubkey = useCyberspace.getState().identity.pubkey
  const holders = checkHolders(pubkey)
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
  if (backlog && backlog.pubkey !== pubkey) dropBacklog()
  const ifCurrent = (fn: () => void): void => {
    if (useCyberspace.getState().identity.pubkey === pubkey) fn()
  }
  // One standing subscription per relay (lib/ownWatch.ts), which the head
  // check before a signature also reads (owner's ruling of 2026-11-22). Every
  // relay delivers the same move: it is taken in once.
  const seen = new Set<string>()
  // Folded together, not one at a time: a relay's backlog arrives as a burst (LIVE_BATCH_MS).
  let batch: Array<{ ev: NostrEvent; url: string }> = []
  let flushAt: ReturnType<typeof setTimeout> | null = null
  const flush = (): void => {
    flushAt = null
    const got = batch
    batch = []
    if (got.length > 0) ifCurrent(() => takeLive(pubkey, got))
  }
  const stop = startOwnWatch(
    pubkey,
    (ev, url) => ifCurrent(() => {
      if (seen.has(ev.id)) return
      seen.add(ev.id)
      if (seen.size > 512) seen.delete(seen.values().next().value as string)
      batch.push({ ev, url })
      if (flushAt === null) flushAt = setTimeout(flush, LIVE_BATCH_MS)
    }),
    // A relay's subscription reaching EOSE is the relay talking again; if the
    // check could not get through before, it may now.
    () => ifCurrent(() => recheckIfUnknown()),
    // A (re)subscription also asks from the second of the newest move on the relays, inclusive.
    () => { const s = useCyberspace.getState(); return s.identity.pubkey === pubkey ? newestOnRelays(s.events, s.published) : undefined },
    // This page's own moves, and moves in hand, are never another device's;
    // nor is an older chain's move, which cannot touch this one (ownWatch outsideChain).
    (ev) => {
      if (signedOnThisPage(ev.id)) return true
      const s = useCyberspace.getState()
      const events = s.events
      if (idsOf(events).has(ev.id)) return true
      return outsideChain(ev, s.genesisId, events.find((e) => e.id === s.genesisId)?.created_at)
    },
  )
  close = () => { stop(); if (flushAt !== null) { clearTimeout(flushAt); flushAt = null } batch = [] }
  void check(pubkey)
}

/** For tests: whether a self-check or a catch-up is out right now. */
export function selfSyncBusy(): boolean {
  return checking !== null || catching
}

/** Idempotent. Follows the active identity for the life of the page. */
export function startSelfSync(): void {
  if (started) return
  started = true
  resync(useCyberspace.getState().identity.pubkey)
  useCyberspace.subscribe((s, prev) => {
    if (s.identity.pubkey !== prev.identity.pubkey) { resync(s.identity.pubkey); return }
    if (s.live && !prev.live) compareUnpublished()
    // A respawn, or a newer chain adopted: a stretch of the old one is nothing to wait for.
    if (s.genesisId !== prev.genesisId && backlog && backlog.pubkey === s.identity.pubkey && backlog.genesisId !== s.genesisId) closeBacklog(backlog.pubkey)
  })
  // Not the window's own 'online' event: watchConnectivity answers that by
  // dropping every socket, and a check started first would be cut off by the
  // drop and read as "unreachable". onResume fires after the drop.
  onResume(() => recheckIfUnknown(true))
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
