/**
 * ownWatch.ts: one standing subscription per relay to your own new moves,
 * and what each relay has told it, which the head check before a signature
 * reads instead of asking every relay again (owner's ruling of 2026-11-22:
 * "if we have an open subscription to the relays for new moves, we'll get it
 * immediately when the relay receives it, so we shouldn't be opening a new
 * subscription to check for every action").
 *
 * | Per relay | Kept |
 * |---|---|
 * | the subscription | open, or reopening after a close (with a backoff) |
 * | caught up | its first EOSE since it last opened: until then it is not current |
 * | every own move it delivered | the head check finds each in the chain in hand, once; one that is not there is a move from elsewhere |
 * | liveness | the socket's last frame (relay.ts frameAge) and how long it has owed one (unansweredFor): one silent past LIVE_MS, or asked something and silent past STALL_MS, is not current; before a move, quiet relays are asked for a frame (freshenOwnWatch) |
 *
 * A relay is current when its subscription is open, has reached its EOSE
 * since it last opened, and its socket has sent something within LIVE_MS and
 * owes no answer older than STALL_MS (each move sent asks every relay for an
 * OK, so a socket that stalls mid-walk drops out within seconds). A
 * relay that is not current (dead, held up by AUTH, slow, not caught up) never
 * holds a signature; it is reopened in the background, and what it brings
 * when it comes back goes to the same handler as everything else.
 */
import type { Filter } from 'nostr-tools/filter'
import { normalizeURL } from 'nostr-tools/utils'
import { CYBERSPACE_RELAY, dropRelays, frameAge, signInFailed, subscribeOne, unansweredFor } from './relay'
import { HELD_BACKOFF_MS } from './liveSub'
import { PINNED_RELAYS, readRelays } from '../store/useRelays'
import { actionLink, type NostrEvent } from './events'

/**
 * A relay whose socket has sent nothing for this long is not current until it
 * is heard from again. Short: while walking, every move sent is answered by
 * an OK from each relay, so a live relay is heard from all the time, and a
 * move made after a pause first asks the quiet relays for a frame (freshen).
 */
export const LIVE_MS = 3_000
/** A relay whose socket was asked something (a REQ, an EVENT) and has sent nothing back for this long is not current. */
export const STALL_MS = 2_000
/**
 * A socket that has owed an answer this long is dropped, so the watch reopens
 * over a fresh one. Long: a drop ends everything on that socket (sends
 * waiting on an OK, other feeds) and asks for a new AUTH; a slow link is only
 * not current, never dropped.
 */
export const DROP_AFTER_MS = 8_000
/** A subscription with no EOSE after this long is asked again. */
export const EOSE_WAIT_MS = 10_000
/** The longest freshen waits for a quiet relay to answer its probe. */
export const FRESHEN_WAIT_MS = 2_500
/** How often the watch looks over its relays. */
const TICK_MS = 2_000
/** Reopen waits after successive closes. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000]

interface RelayWatch {
  url: string
  sub: { close: () => void } | null
  /** Open since `openedAt`, and its first EOSE since then has come. */
  open: boolean
  eosed: boolean
  attempts: number
  timer: ReturnType<typeof setTimeout> | null
  eoseTimer: ReturnType<typeof setTimeout> | null
}

interface Watch {
  pubkey: string
  /** The second of the newest move the relays already hold, when known: a (re)subscription asks from it, inclusive. */
  since: () => number | undefined
  /** Every own move any relay delivered that the head check has not yet found in the chain in hand. */
  pending: Map<string, NostrEvent>
  /** Whether a delivered move is this page's own, already in hand, or outside the chain in hand (never held). */
  known: (ev: NostrEvent) => boolean
  onEvent: (ev: NostrEvent, url: string) => void
  onEose: () => void
  relays: Map<string, RelayWatch>
  tick: ReturnType<typeof setInterval> | null
  stopped: boolean
}

let watch: Watch | null = null

/** Injected for tests: how a relay is subscribed to, its socket's age, and the relays to watch. */
// Each read at call time, not at import: a test that mocks lib/relay without
// these exports must still be able to import the store, which imports this.
export const ownWatchDeps = {
  subscribeOne: (...a: Parameters<typeof subscribeOne>): ReturnType<typeof subscribeOne> => subscribeOne(...a),
  frameAge: (url: string): number => frameAge(url),
  unansweredFor: (url: string): number => unansweredFor(url),
  signInFailed: (url: string): boolean => signInFailed(url),
  drop: (url: string): void => dropRelays([url]),
  // Every relay read, the read-only former canonical relay too: a move of yours
  // that reaches only it still stops the next one. It is not pinned, so it
  // never vouches (useRelays READ_FALLBACK_RELAY).
  relays: (): string[] => [CYBERSPACE_RELAY, ...readRelays()],
  pinned: (): readonly string[] => PINNED_RELAYS,
}

/**
 * Whether a delivered move cannot touch the chain in hand, whose spawn is
 * `genesisId`, signed at `spawnAt`: a spawn older than it, or an action on
 * another chain dated before it (an older chain's: every action of a newer
 * chain is dated at or after that chain's spawn, so after this one's). Such
 * a move is never held. The relay that missed the respawn still hands back
 * the old chain's last move to every `limit: 1` (re)subscription (the
 * read-only old relay, after a respawn this page published elsewhere), and
 * held, it sent every move of the identity to the slow path for good. The
 * same second as the spawn is held, to be safe.
 */
export function outsideChain(ev: NostrEvent, genesisId: string, spawnAt: number | undefined): boolean {
  if (!genesisId || spawnAt === undefined || ev.created_at >= spawnAt || ev.id === genesisId) return false
  if (ev.tags.some((t) => t[0] === 'A' && t[1] === 'spawn')) return true
  const link = actionLink(ev)
  return link !== null && link.genesisId !== genesisId
}

/** Moves kept in `pending` at most; past it, they are let go and the relays asked again (overflowed). */
const PENDING_MAX = 2048

/**
 * What a (re)subscription asks for. `limit: 1` alone: the relay's newest
 * stored move, then every move it stores from then on whatever its
 * created_at (a move another device signed while LOCAL and publishes now).
 * With the second of the newest move already on the relays, also every
 * stored move from that second on, inclusive: a move of another device in the
 * same second as the head (nextCreatedAt allows it) can lose the one `limit`
 * slot to the head itself, and would never be delivered. Every move that
 * could extend or fork the head is dated at or after it, so none is missed.
 */
function filtersFor(pubkey: string, since: number | undefined): Filter[] {
  const base = { kinds: [3333], authors: [pubkey] }
  return since === undefined ? [{ ...base, limit: 1 }] : [{ ...base, limit: 1 }, { ...base, since, limit: SINCE_LIMIT }]
}

/**
 * The most stored moves a (re)subscription asks for from the second of the
 * newest move on the relays. A few cover what it is for (a move in the same
 * second as the head); a long backlog published elsewhere is not this
 * watch's to deliver: its newest moves do not link to the chain here, and
 * the catch-up fetches the stretch whole (lib/selfSync.ts). Unbounded, the
 * relay sent its 500 newest, each folded on its own (owner's tablet,
 * 2026-11-27, 3,760 moves behind).
 */
export const SINCE_LIMIT = 50

function openRelay(w: Watch, r: RelayWatch): void {
  if (w.stopped || r.sub) return
  r.open = true
  r.eosed = false
  const sub = ownWatchDeps.subscribeOne(r.url, filtersFor(w.pubkey, w.since()), {
    onevent: (ev) => {
      if (w.stopped || ev.pubkey !== w.pubkey) return
      // A move this page signed, or one already in hand, cannot be another
      // device's: never held (the echo of every move of ours, and the echo of
      // an old chain's last move landing after a respawn).
      if (!w.pending.has(ev.id) && !w.known(ev)) {
        if (w.pending.size < PENDING_MAX) w.pending.set(ev.id, ev)
        else overflowed(w)
      }
      w.onEvent(ev, r.url)
    },
    oneose: () => {
      if (w.stopped) return
      if (r.eoseTimer) { clearTimeout(r.eoseTimer); r.eoseTimer = null }
      r.eosed = true
      r.attempts = 0
      w.onEose()
    },
    onclose: () => { if (!w.stopped && r.sub === sub) ended(w, r) },
  })
  r.sub = sub
  // A subscription that never reaches its EOSE (its REQ lost, the socket
  // stalled) is asked again rather than left waiting; a socket that owes an
  // answer as well is dropped, so the next one opens over a fresh one.
  if (r.eoseTimer) clearTimeout(r.eoseTimer)
  r.eoseTimer = setTimeout(() => {
    r.eoseTimer = null
    if (w.stopped || r.sub !== sub || r.eosed) return
    try { sub.close() } catch { /* closed */ }
    if (ownWatchDeps.unansweredFor(r.url) >= DROP_AFTER_MS) ownWatchDeps.drop(r.url)
    ended(w, r)
  }, EOSE_WAIT_MS)
}

/**
 * More moves arrived than are kept (a long backlog published elsewhere): what
 * is held is let go and every relay is asked again, from the second of the
 * newest move on the relays. Each is not current until its EOSE, so nothing
 * is vouched for meanwhile, and what it hands back that is not in hand by
 * then is held again. A move dated before that second cannot fork the head.
 */
function overflowed(w: Watch): void {
  w.pending.clear()
  setTimeout(() => { if (watch === w && !w.stopped) reopenOwnWatch() }, 0)
  for (const r of w.relays.values()) r.eosed = false
}

/** The relay's subscription ended: not current until it has opened again and caught up to its EOSE. */
function ended(w: Watch, r: RelayWatch): void {
  r.sub = null
  r.open = false
  r.eosed = false
  if (r.eoseTimer) { clearTimeout(r.eoseTimer); r.eoseTimer = null }
  // A relay whose sign-in failed waits longer (as the live feeds do), so a
  // signer is not asked for its AUTH every 30 seconds; RETRY or a sign-in
  // reopens it sooner (retryWaitingOwnWatch).
  const wait = ownWatchDeps.signInFailed(r.url) ? HELD_BACKOFF_MS : BACKOFF_MS[Math.min(r.attempts, BACKOFF_MS.length - 1)]
  r.attempts++
  if (r.timer) clearTimeout(r.timer)
  r.timer = setTimeout(() => { r.timer = null; openRelay(w, r) }, wait)
}

/** The relays to watch now: a relay added is opened, one removed is closed. */
function reconcile(w: Watch): void {
  const want = new Set(ownWatchDeps.relays().map((u) => normalizeURL(u)))
  for (const url of want) {
    if (w.relays.has(url)) continue
    const r: RelayWatch = { url, sub: null, open: false, eosed: false, attempts: 0, timer: null, eoseTimer: null }
    w.relays.set(url, r)
    openRelay(w, r)
  }
  for (const [url, r] of w.relays) {
    if (want.has(url)) continue
    closeRelay(r)
    w.relays.delete(url)
  }
}

function closeRelay(r: RelayWatch): void {
  if (r.timer) { clearTimeout(r.timer); r.timer = null }
  if (r.eoseTimer) { clearTimeout(r.eoseTimer); r.eoseTimer = null }
  const sub = r.sub
  r.sub = null
  r.open = false
  r.eosed = false
  try { sub?.close() } catch { /* already closed */ }
}

/**
 * A quiet relay asked for nothing (an id no event has): its EOSE is a frame,
 * and as it comes after everything the relay pushed before it on the same
 * socket, it also says the standing subscription has been handed everything
 * the relay held when it answered. Resolves when the EOSE comes, or after
 * `waitMs` without one.
 */
function probe(r: RelayWatch, waitMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    let sub: { close: () => void } | null = null
    const end = (): void => { if (done) return; done = true; clearTimeout(timer); try { sub?.close() } catch { /* closed */ } resolve() }
    const timer = setTimeout(end, waitMs)
    sub = ownWatchDeps.subscribeOne(r.url, { ids: ['0'.repeat(64)], limit: 1 }, { onevent: () => {}, oneose: end, onclose: end })
  })
}

function tick(w: Watch): void {
  if (!w.stopped) reconcile(w)
}

/**
 * Watch `pubkey`'s own moves on every relay, one subscription each, for as
 * long as it is not stopped. Events go to `onEvent` (with the relay that
 * delivered them); each relay's EOSE to `onEose`. Returns the stopper.
 */
export function startOwnWatch(
  pubkey: string,
  onEvent: (ev: NostrEvent, url: string) => void,
  onEose: () => void = () => {},
  since: () => number | undefined = () => undefined,
  known: (ev: NostrEvent) => boolean = () => false,
): () => void {
  stopOwnWatch()
  const w: Watch = { pubkey, since, known, pending: new Map(), onEvent, onEose, relays: new Map(), tick: null, stopped: false }
  watch = w
  reconcile(w)
  w.tick = setInterval(() => tick(w), TICK_MS)
  return () => { if (watch === w) stopOwnWatch() }
}

export function stopOwnWatch(): void {
  const w = watch
  if (!w) return
  w.stopped = true
  if (w.tick) clearInterval(w.tick)
  for (const r of w.relays.values()) closeRelay(r)
  watch = null
}

/** Open, caught up since it last opened, and its socket heard from lately with nothing owed for long. */
function isCurrent(r: RelayWatch): boolean {
  return r.open && r.eosed && ownWatchDeps.frameAge(r.url) <= LIVE_MS && ownWatchDeps.unansweredFor(r.url) <= STALL_MS
}

/** What the head check reads, per relay: whether it is current, and whether it is pinned (on every device's relay list). */
export interface RelayHead { url: string; current: boolean; pinned: boolean }

/** For `pubkey`, each relay watched and where it stands; null when nothing watches that identity. */
export function ownWatchState(pubkey: string): RelayHead[] | null {
  const w = watch
  if (!w || w.stopped || w.pubkey !== pubkey) return null
  const pinned = new Set(ownWatchDeps.pinned().map((u) => normalizeURL(u)))
  return [...w.relays.values()].map((r) => ({ url: r.url, current: isCurrent(r), pinned: pinned.has(r.url) }))
}

/**
 * How many moves the relays delivered that are not in the chain in hand,
 * after taking out those that now are (`inHand`). Each delivered move is
 * looked for until it is found once, so the check costs nothing per
 * signature in the steady walk. Null when nothing watches `pubkey`.
 */
export function unexplainedMoves(pubkey: string, inHand: (id: string) => boolean): number | null {
  const w = watch
  if (!w || w.stopped || w.pubkey !== pubkey) return null
  for (const id of w.pending.keys()) if (inHand(id)) w.pending.delete(id)
  return w.pending.size
}

/** Let go of every move held (a respawn: the chain they were measured against is gone). */
export function forgetOwnWatchMoves(): void {
  watch?.pending.clear()
}

/**
 * When no pinned relay is current but some are caught up and only quiet (a pause in
 * the walk), ask each of those for a frame and wait for the first answer, up
 * to FRESHEN_WAIT_MS: one round trip that carries no events, not a question
 * about the chain. A relay that stalled answers nothing and stays not current.
 * Resolves at once when a relay is current already, or none could become so.
 */
export async function freshenOwnWatch(pubkey: string): Promise<void> {
  const w = watch
  if (!w || w.stopped || w.pubkey !== pubkey) return
  // Only the pinned relays vouch (useCyberspace standingHead), so only they are asked.
  const pinned = new Set(ownWatchDeps.pinned().map((u) => normalizeURL(u)))
  const all = [...w.relays.values()].filter((r) => pinned.has(r.url))
  if (all.some(isCurrent)) return
  const quiet = all.filter((r) => r.open && r.eosed)
  if (quiet.length === 0) return
  await new Promise<void>((resolve) => {
    let left = quiet.length
    for (const r of quiet) {
      void probe(r, FRESHEN_WAIT_MS).then(() => {
        // Asked and silent: the socket has stalled. Dropped, so the watch
        // reopens over a fresh one and catches up to its EOSE before it counts.
        if (!isCurrent(r) && ownWatchDeps.unansweredFor(r.url) >= DROP_AFTER_MS) ownWatchDeps.drop(r.url)
        if (isCurrent(r) || --left === 0) resolve()
      })
    }
  })
}

/** Reopen every relay now (the tab back from the background, the sockets dropped): each is not current until its EOSE. */
export function reopenOwnWatch(): void {
  const w = watch
  if (!w) return
  for (const r of w.relays.values()) { closeRelay(r); r.attempts = 0; openRelay(w, r) }
}

/** Reopen now the relays waiting out a backoff, and leave the open ones be (a sign-in just succeeded). */
export function retryWaitingOwnWatch(): void {
  const w = watch
  if (!w) return
  for (const r of w.relays.values()) {
    if (!r.timer) continue
    clearTimeout(r.timer)
    r.timer = null
    openRelay(w, r)
  }
}
