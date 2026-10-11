/**
 * useAgentDms.ts: the private conversation between you and each of your
 * agents (arkinox, 2026-10-10, the operator and agent DMs contract).
 *
 * All operator and agent talk is NIP-17 gift-wrapped DMs (lib/dm.ts), and
 * nothing about it is public. The pieces:
 *
 * - Inboxes. Each side's kind 10050 names its DM relays (lib/inbox.ts
 *   dmInboxOf). A message goes to the agent's 10050 relays and its self-copy
 *   to yours. Either side without one: nothing is sent, and the conversation
 *   says "No DM inbox". Your 10050 is never published for you: what your DM
 *   relays are is yours to choose, in a client that manages them.
 * - Reading. One subscription per relay of your 10050, for kind 1059 `#p`
 *   you, opened while a conversation is on screen. Inbox relays gate these
 *   reads behind NIP-42 AUTH (wheat.oslim.dev answers CLOSED auth-required
 *   without it), so each relay is authenticated first and a CLOSED
 *   auth-required is answered and asked again (relay.ts subscribeOne).
 * - Opening. Each wrap is opened once, in order, through your signer: two
 *   NIP-44 decrypts per wrap, which on a bunker or an extension is two
 *   requests, so they are never fired in parallel. A wrap whose rumor is not
 *   between you and one of your agents is dropped as soon as it is opened:
 *   its text is never kept, so your other DMs are not held here.
 *
 * - Watching (arkinox, 2026-10-11: "a red dot notification in the ui when
 *   XOR has sent a new message to me", then "or just use the existing
 *   notification toast"). While you have at least one agent, one more
 *   subscription per relay of your 10050 stays open in the background, from
 *   the last check minus two days (NIP-59 backdates a wrap up to two days, so
 *   a later since would miss new ones). Every wrap it has opened is
 *   remembered on this device, so no wrap is decrypted twice, in a session or
 *   across them. A new message from one of your agents, written after you
 *   last opened that conversation, is unread until you open it: that lights
 *   the dot on AGENTS and on its TALK, and raises the notifications toast.
 *   Your own self-copies and anyone not your agent never notify. A local key
 *   decrypts without asking anyone; an extension or a bunker may ask you
 *   every time, and which of those prompts cannot be told from here, so with
 *   either the watch opens at most WATCH_CAP wraps a session.
 *
 * Messages live in memory for the session only, never in storage: they are
 * private, and the relays hold them for the next session. What the watch
 * keeps on this device is only ids and times (which wraps were opened, which
 * messages are unread, when each conversation was last opened), never a
 * word of any message. A change of identity clears everything in memory.
 *
 * The relays and the keys come in through `dmDeps`, so the tests stand in
 * fake ones and nothing here can reach a real relay from a test.
 */

import { create } from 'zustand'
import { generateSecretKey } from 'nostr-tools/pure'
import {
  counterpartOf, currentStrategy, MAX_BACKDATE_S, mergeMessages, toMessage, unwrapMessage, wrapMessage,
  WRAP_KIND, type DmMessage, type DmReader, type DmSender, type Rumor,
} from '../lib/dm'
import { dmInboxOf, type DmInbox } from '../lib/inbox'
import { authForRead, onResume, publishMany, subscribeOne, type PublishResult } from '../lib/relay'
import { localSigner, NIP44_UNAVAILABLE } from '../lib/signers'
import type { NostrEvent } from '../lib/events'
import { useCyberspace } from './useCyberspace'
import { useMyAgentsAnswer } from '../hooks/useMyAgents'

/**
 * How many wraps one inbox relay is asked for, newest first. Every wrap costs
 * two decrypts through the signer before its sender is known (a bunker or an
 * extension may ask a person each time), and the inbox holds all your DMs,
 * not only your agents', so the read is kept to recent history.
 */
export const WRAP_LIMIT = 100

/**
 * How many wraps the background watch opens in one session through a signer
 * that may ask a person each time (an extension or a bunker), newest first:
 * two decrypts each. A local key is not capped (arkinox, 2026-10-11).
 */
export const WATCH_CAP = 20

/** Back from an absence, the watch reopens at most this often, however many times the connection says it came back. */
export const WATCH_REOPEN_MIN_MS = 10_000

/** Wrap ids remembered as opened, at most; the newest are kept. */
export const WATCHED_MAX = 2000

/** Unread message ids kept per agent, at most. */
export const UNREAD_MAX = 99

/** Where the watch keeps its ids and times, per identity, in the repo's key style. */
export const WATCH_KEY = (me: string): string => `onosendai:agent-dm-watch:${me}`

/** NIP44_UNAVAILABLE speaks of chests; the same lack, for messages. */
const NO_DECRYPT = 'Your signer offers no NIP-44 decrypt, so messages sent to you cannot be opened with it.'

/** Where someone's DM inbox stands: being looked up, found, found to be absent, or not known (no relay answered). */
export type InboxStatus = 'loading' | 'ready' | 'none' | 'unknown'
export interface InboxState { status: InboxStatus; relays: string[] }

/** What the reading of your inbox is doing. */
export type ReadingStatus = 'idle' | 'live' | 'failed'

/** The relays, as the store uses them. A test hands in fake ones. */
export interface DmTransport {
  inboxOf: (pubkey: string, extra: readonly string[]) => Promise<DmInbox>
  /** A live read of one relay, authenticated; the returned function closes it. `onEose` hears when the stored events are all in. */
  subscribe: (relay: string, filter: { kinds: number[]; '#p': string[]; limit: number; since?: number }, onEvent: (ev: NostrEvent) => void, onClose: (reason: string) => void, onEose?: () => void) => () => void
  publish: (relays: string[], ev: NostrEvent) => Promise<PublishResult>
  /** Be told when the connection comes back after an absence; returns the unsubscribe. */
  onResume: (fn: () => void) => () => void
}

/** Who you are, as the store uses it: your pubkey, signing, and NIP-44 both ways. */
export interface DmKeys {
  pubkey: () => string
  sender: () => DmSender
  reader: () => DmReader
  /** A new key for one gift wrap (contract: signed by localSigner(generateSecretKey())). */
  fresh: () => DmSender
  /** The pubkeys whose conversations may be kept: your agents. */
  agents: () => string[]
  /**
   * Whether your signer decrypts without asking anyone: a local key does; an
   * extension or a bunker may ask every time, and which do cannot be told,
   * so they count as asking (arkinox, 2026-10-11).
   */
  promptFree: () => boolean
}

/** This device's storage, as the watch uses it. A test hands in a Map. */
export interface DmStorage {
  get: (key: string) => string | null
  set: (key: string, value: string) => void
}

const realStorage: DmStorage = {
  get: (key) => { try { return localStorage.getItem(key) } catch { return null } },
  set: (key, value) => { try { localStorage.setItem(key, value) } catch { /* storage blocked: kept for this visit only */ } },
}

const realTransport: DmTransport = {
  inboxOf: dmInboxOf,
  subscribe: (relay, filter, onEvent, onClose, onEose) => {
    let sub: { close: () => void } | null = null
    let closed = false
    // Authenticate before asking, as every read of a gated relay here does;
    // subscribeOne also answers a CLOSED auth-required once and asks again.
    void authForRead(relay).catch(() => undefined).then(() => {
      if (closed) return
      sub = subscribeOne(relay, filter, { onevent: onEvent, oneose: () => onEose?.(), onclose: (r) => onClose(r ?? 'closed') })
    })
    return () => { closed = true; sub?.close() }
  },
  publish: publishMany,
  onResume,
}

/** A signer's NIP-44 encrypt, which a local key always has. */
function freshSender(): DmSender {
  const s = localSigner(generateSecretKey())
  return { pubkey: s.pubkey, signEvent: s.signEvent, nip44Encrypt: s.nip44Encrypt! }
}

const realKeys: DmKeys = {
  pubkey: () => useCyberspace.getState().identity.pubkey,
  sender: () => {
    const cs = useCyberspace.getState()
    return { pubkey: cs.identity.pubkey, signEvent: (t) => cs.signEvent(t), nip44Encrypt: cs.encryptSealed }
  },
  reader: () => {
    const cs = useCyberspace.getState()
    return { pubkey: cs.identity.pubkey, nip44Decrypt: cs.decryptSealed }
  },
  fresh: freshSender,
  agents: () => useMyAgentsAnswer.getState().agents,
  promptFree: () => useCyberspace.getState().signerKind === 'local',
}

/** The relays, keys and storage in use; exported so a test can stand in fakes. */
export const dmDeps: { transport: DmTransport; keys: DmKeys; storage: DmStorage } = { transport: realTransport, keys: realKeys, storage: realStorage }

/** Unread messages from one agent: the rumor ids and the newest one's time. Never their words. */
export interface Unread { ids: string[]; at: number }

export interface AgentDmsState {
  /** Whose conversations these are. */
  me: string
  myInbox: InboxState
  /** Each agent's DM inbox, by pubkey. */
  inboxes: Record<string, InboxState>
  /** Each agent's conversation, oldest first. */
  messages: Record<string, DmMessage[]>
  reading: ReadingStatus
  /** Why reading failed or a wrap could not be opened, in words. */
  readError: string | null
  /** A send in flight, by agent. */
  sending: Record<string, boolean>
  /** The last send's problem, by agent, in words; null when it went. */
  sendError: Record<string, string | null>
  /** New messages from each agent since its conversation was last opened, kept on this device. */
  unread: Record<string, Unread>
  /** The agent whose TALK modal is up, if any: here, so the toast can open it with the menu closed. */
  talking: string | null
}

const LOADING: InboxState = { status: 'loading', relays: [] }

function initial(me: string): AgentDmsState {
  return { me, myInbox: LOADING, inboxes: {}, messages: {}, reading: 'idle', readError: null, sending: {}, sendError: {}, unread: {}, talking: null }
}

export const useAgentDms = create<AgentDmsState>(() => initial(''))

// ---------------------------------------------------------------------------
// Module state: what is open, what has been opened, the reading's sockets.

/** Open conversations, by agent, counted (a re-render may open one twice). */
const open = new Map<string, number>()
/** Wraps already opened (or dropped) for this identity: never decrypted twice. */
let seen = new Set<string>()
/** The decrypt queue: one wrap at a time through the signer. */
let queue: Promise<void> = Promise.resolve()
/** The reading's closers, and the resume listener. */
let closers: (() => void)[] = []
let stopResume: (() => void) | null = null
/** Bumped whenever the identity changes or reading stops, so late work for the old one is dropped. */
let epoch = 0

/**
 * What the watch keeps per identity on this device (WATCH_KEY): when it first
 * ran (nothing older notifies), when it last had every stored wrap in, the
 * wraps it opened (id to the wrap's created_at, so old ones can be let go),
 * when each conversation was last opened, and the unread rumor ids.
 */
interface WatchRecord {
  baseline: number
  checkedAt: number
  watched: Record<string, number>
  readAt: Record<string, number>
  unread: Record<string, Unread>
}

function emptyRecord(): WatchRecord {
  return { baseline: 0, checkedAt: 0, watched: {}, readAt: {}, unread: {} }
}

function loadRecord(me: string): WatchRecord {
  if (!me) return emptyRecord()
  try {
    const raw = dmDeps.storage.get(WATCH_KEY(me))
    const v = raw ? (JSON.parse(raw) as Partial<WatchRecord>) : null
    if (!v || typeof v !== 'object') return emptyRecord()
    return {
      baseline: Number(v.baseline) || 0,
      checkedAt: Number(v.checkedAt) || 0,
      watched: v.watched && typeof v.watched === 'object' ? v.watched : {},
      readAt: v.readAt && typeof v.readAt === 'object' ? v.readAt : {},
      unread: Object.fromEntries(Object.entries(v.unread && typeof v.unread === 'object' ? v.unread : {})
        .filter(([, u]) => u && Array.isArray(u.ids) && typeof u.at === 'number')),
    }
  } catch { return emptyRecord() }
}

/** The record for the identity in the store, read once per identity. */
let record: WatchRecord = emptyRecord()

/** Keep the record, letting go of wraps too old for any since to return again. */
function saveRecord(): void {
  const me = useAgentDms.getState().me
  if (!me) return
  const floor = record.checkedAt - MAX_BACKDATE_S
  const kept = Object.entries(record.watched).filter(([, at]) => at >= floor).sort((a, b) => b[1] - a[1]).slice(0, WATCHED_MAX)
  record.watched = Object.fromEntries(kept)
  record.unread = useAgentDms.getState().unread
  dmDeps.storage.set(WATCH_KEY(me), JSON.stringify(record))
}

/** The watch: whether it is wanted, its sockets, its resume listener, its own epoch. */
let watching = false
let watchClosers: (() => void)[] = []
let stopWatchResume: (() => void) | null = null
let watchEpoch = 0
let lastReopen = 0
/** Wraps the watch opened this session, for WATCH_CAP; and whether it hit the cap, which holds checkedAt where it is. */
let watchOpened = 0
let capped = false
/** The signer has no NIP-44 decrypt at all: the watch stops trying. */
let noDecrypt = false

const nowS = (): number => Math.floor(Date.now() / 1000)

function inboxState(found: DmInbox): InboxState {
  if (found.relays.length) return { status: 'ready', relays: found.relays }
  return { status: found.answered ? 'none' : 'unknown', relays: [] }
}

/** Start over for a new identity: nothing of the old one survives. */
function resetFor(me: string): void {
  stopReading()
  closeWatch()
  epoch += 1
  seen = new Set()
  queue = Promise.resolve()
  record = loadRecord(me)
  watchOpened = 0
  capped = false
  noDecrypt = false
  useAgentDms.setState({ ...initial(me), unread: record.unread }, true)
}

function stopReading(): void {
  for (const c of closers) c()
  closers = []
  stopResume?.()
  stopResume = null
  epoch += 1
}

/**
 * Open one wrap, in turn, and keep it only when it is between me and one of
 * my agents. `alive` says whether the read that brought it still stands.
 * From the watch, a wrap opened in an earlier session is skipped, and the
 * cap applies to a signer that may ask (arkinox, 2026-10-11).
 */
function take(wrap: NostrEvent, alive: () => boolean, fromWatch = false): void {
  if (wrap.kind !== WRAP_KIND || seen.has(wrap.id)) return
  if (fromWatch) {
    if (noDecrypt || wrap.id in record.watched) return
    if (!dmDeps.keys.promptFree()) {
      if (watchOpened >= WATCH_CAP) { capped = true; return }
      watchOpened += 1
    }
  }
  seen.add(wrap.id)
  const me = useAgentDms.getState().me
  queue = queue.then(async () => {
    if (!alive()) { seen.delete(wrap.id); return }
    const reader = dmDeps.keys.reader()
    // unwrapMessage drops a wrap that will not open, rightly, but a signer
    // with no NIP-44 decrypt at all opens none, and that is said in words.
    let unavailable = false
    const rumor = await unwrapMessage(wrap, {
      pubkey: reader.pubkey,
      nip44Decrypt: (pk, ct) => reader.nip44Decrypt(pk, ct).catch((err: unknown) => {
        if (err instanceof Error && err.message === NIP44_UNAVAILABLE) {
          unavailable = true
          if (!fromWatch) useAgentDms.setState({ readError: NO_DECRYPT })
        }
        throw err
      }),
    })
    if (useAgentDms.getState().me !== me) return
    if (unavailable) { if (fromWatch) noDecrypt = true; seen.delete(wrap.id); return }
    // Opened (or found not to open): never decrypted again on this device.
    record.watched[wrap.id] = wrap.created_at
    saveRecord()
    if (!rumor) return
    const agent = counterpartOf(rumor, me)
    if (!agent || !(open.has(agent) || dmDeps.keys.agents().includes(agent))) return
    const s = useAgentDms.getState()
    useAgentDms.setState({ messages: { ...s.messages, [agent]: mergeMessages(s.messages[agent] ?? [], [toMessage(rumor)]) } })
    noteUnread(rumor, agent, me)
  })
}

/**
 * A message from one of my agents, written after I last opened our
 * conversation (and after the watch first ran on this device), is unread
 * unless the conversation is on screen. My own self-copies never are.
 */
function noteUnread(rumor: Rumor, agent: string, me: string): void {
  if (rumor.pubkey === me || rumor.pubkey !== agent) return
  if (!dmDeps.keys.agents().includes(agent) || open.has(agent)) return
  if (rumor.created_at <= Math.max(record.baseline, record.readAt[agent] ?? 0)) return
  const s = useAgentDms.getState()
  const had = s.unread[agent] ?? { ids: [], at: 0 }
  if (had.ids.includes(rumor.id)) return
  // The newest UNREAD_MAX ids are enough to count and to dedupe a chatty agent.
  useAgentDms.setState({ unread: { ...s.unread, [agent]: { ids: [...had.ids, rumor.id].slice(-UNREAD_MAX), at: Math.max(had.at, rumor.created_at) } } })
  saveRecord()
}

/** The conversation with `agent` was looked at: nothing from it is unread. */
function markRead(agent: string): void {
  record.readAt[agent] = nowS()
  const s = useAgentDms.getState()
  if (s.unread[agent]) {
    const rest = { ...s.unread }
    delete rest[agent]
    useAgentDms.setState({ unread: rest })
  }
  saveRecord()
}

/** Subscribe to my inbox relays for wraps to me. */
function startReading(): void {
  const s = useAgentDms.getState()
  if (s.myInbox.status !== 'ready' || closers.length) return
  const at = ++epoch
  const alive = (): boolean => at === epoch
  const relays = s.myInbox.relays
  const filter = { kinds: [WRAP_KIND], '#p': [s.me], limit: WRAP_LIMIT }
  const ended = new Map<string, string>()
  // Live once asked: an empty inbox sends nothing to say it is there.
  useAgentDms.setState({ reading: 'live', readError: null })
  for (const relay of relays) {
    closers.push(dmDeps.transport.subscribe(relay, filter, (ev) => { if (alive()) take(ev, alive) }, (reason) => {
      if (at !== epoch) return
      ended.set(relay, reason)
      if (ended.size === relays.length) {
        useAgentDms.setState({ reading: 'failed', readError: [...ended.entries()].map(([u, r]) => `${u}: ${r}`).join('; ') })
      }
    }))
  }
  // Back from an absence, the sockets may be dead: ask again over fresh ones.
  // The listener is registered once per reading and never again from inside
  // its own call: relay.ts walks its listener Set live, and a listener that
  // removes itself and adds a new one is visited again in the same walk, so
  // one resume with a conversation open re-subscribed forever, synchronously
  // (arkinox, 2026-10-11, found while adding the watch).
  if (!stopResume) {
    stopResume = dmDeps.transport.onResume(() => {
      if (!open.size) return
      for (const c of closers) c()
      closers = []
      startReading()
    })
  }
}

async function lookUpMine(): Promise<void> {
  const me = useAgentDms.getState().me
  const found = inboxState(await dmDeps.transport.inboxOf(me, []).catch(() => ({ relays: [], answered: false })))
  if (useAgentDms.getState().me !== me) return
  useAgentDms.setState({ myInbox: found })
  if (open.size) startReading()
  openWatch()
}

/** Close the watch's sockets, so late events from them are dropped. */
function closeWatchSockets(): void {
  for (const c of watchClosers) c()
  watchClosers = []
  watchEpoch += 1
}

/** Close the watch's sockets and its resume listener; whether it is wanted is left as it was. */
function closeWatch(): void {
  closeWatchSockets()
  stopWatchResume?.()
  stopWatchResume = null
}

/**
 * Open the watch: one subscription per relay of my 10050, for wraps to me
 * since the last check minus two days. When any relay has sent all it has
 * stored, everything up to the moment the watch opened has been seen, and
 * that becomes the check, unless the cap was hit (what it skipped must be
 * asked for again next session).
 */
function openWatch(): void {
  const s = useAgentDms.getState()
  if (!watching || watchClosers.length || noDecrypt || s.myInbox.status !== 'ready' || !s.me) return
  const w = ++watchEpoch
  const alive = (): boolean => w === watchEpoch
  const openedAt = nowS()
  // The first run on this device: nothing written before now notifies, so
  // what the relays already hold is noted as seen without a single decrypt;
  // only what arrives after a relay's EOSE is opened (arkinox, 2026-10-11).
  const firstRun = !record.baseline
  if (firstRun) { record.baseline = openedAt; saveRecord() }
  const since = (record.checkedAt || openedAt) - MAX_BACKDATE_S
  const filter = { kinds: [WRAP_KIND], '#p': [s.me], limit: WRAP_LIMIT, since }
  const checked = (): void => {
    if (!alive()) return
    if (capped || record.checkedAt >= openedAt) { saveRecord(); return }
    record.checkedAt = openedAt
    saveRecord()
  }
  for (const relay of s.myInbox.relays) {
    let stored = firstRun
    const onEvent = (ev: NostrEvent): void => {
      if (!alive()) return
      if (stored) { if (ev.kind === WRAP_KIND) record.watched[ev.id] = ev.created_at; return }
      take(ev, alive, true)
    }
    watchClosers.push(dmDeps.transport.subscribe(relay, filter, onEvent, () => undefined, () => { stored = false; checked() }))
  }
  // Back from an absence the sockets may be dead: close them and reopen once,
  // never more often than WATCH_REOPEN_MIN_MS, so a resume storm (the PWA
  // backgrounded and brought back) cannot spin it. The listener is added
  // once and kept across reopens: one added from inside relay.ts's live walk
  // of its listeners would be called again in that same walk (arkinox,
  // 2026-10-11).
  if (!stopWatchResume) {
    stopWatchResume = dmDeps.transport.onResume(() => {
      const t = Date.now()
      if (!watching || t - lastReopen < WATCH_REOPEN_MIN_MS) return
      lastReopen = t
      closeWatchSockets()
      openWatch()
    })
  }
}

/**
 * Watch for new messages from my agents while `me` has any (the caller
 * decides that). The returned function stops it. Safe to call again for the
 * same identity: one watch at most.
 */
export function watchAgentDms(me: string): () => void {
  if (useAgentDms.getState().me !== me) resetFor(me)
  watching = true
  const mine = useAgentDms.getState().myInbox
  if (mine.status === 'ready') openWatch()
  else if (mine.status === 'loading') void lookUpMine()
  return () => {
    watching = false
    closeWatch()
  }
}

/** Point the store at `me`: the unread kept for this identity shows, and nothing of another's does. */
export function followIdentity(me: string): void {
  if (useAgentDms.getState().me !== me) resetFor(me)
}

/** Open the TALK modal for `agent` (TALK, or the toast), or close it with null. */
export function setTalking(agent: string | null): void {
  useAgentDms.setState({ talking: agent })
}

async function lookUpAgent(agent: string): Promise<void> {
  const me = useAgentDms.getState().me
  useAgentDms.setState((s) => ({ inboxes: { ...s.inboxes, [agent]: s.inboxes[agent]?.status === 'ready' ? s.inboxes[agent] : LOADING } }))
  // An agent copies its operator's DM relays (contract), so those are asked too.
  const extra = useAgentDms.getState().myInbox.relays
  const found = inboxState(await dmDeps.transport.inboxOf(agent, extra).catch(() => ({ relays: [], answered: false })))
  if (useAgentDms.getState().me !== me) return
  useAgentDms.setState((s) => ({ inboxes: { ...s.inboxes, [agent]: found } }))
}

/**
 * The conversation with `agent` is on screen: look up both inboxes and read
 * mine while it is. The returned function says it closed. Both inboxes are
 * looked up again on every open, so one published meanwhile is seen.
 */
export function openConversation(agent: string): () => void {
  const me = dmDeps.keys.pubkey()
  if (useAgentDms.getState().me !== me) resetFor(me)
  open.set(agent, (open.get(agent) ?? 0) + 1)
  // Opening it is reading it: its dot goes out (arkinox, 2026-10-11).
  markRead(agent)
  if (open.get(agent) === 1) {
    const mine = useAgentDms.getState().myInbox
    const lookups = mine.status === 'ready' ? Promise.resolve() : lookUpMine()
    // The agent's lookup asks my DM relays too, so it waits for mine.
    void lookups.then(() => lookUpAgent(agent))
    startReading()
  }
  let done = false
  return () => {
    if (done) return
    done = true
    const left = (open.get(agent) ?? 1) - 1
    if (left > 0) { open.set(agent, left); return }
    open.delete(agent)
    // What arrived while it was on screen was read there.
    if (useAgentDms.getState().me === me) markRead(agent)
    if (!open.size) {
      stopReading()
      useAgentDms.setState({ reading: 'idle' })
    }
  }
}

/** The words for "this cannot be sent", or null when it can. */
export function cannotSend(s: Pick<AgentDmsState, 'myInbox' | 'inboxes'>, agent: string): string | null {
  const theirs = s.inboxes[agent] ?? LOADING
  if (s.myInbox.status === 'loading' || theirs.status === 'loading') return 'Looking up the DM inboxes.'
  if (s.myInbox.status !== 'ready') return s.myInbox.status === 'none' ? 'No DM inbox: you publish no kind 10050.' : 'Could not find your DM inbox: no relay answered.'
  if (theirs.status !== 'ready') return theirs.status === 'none' ? 'No DM inbox: this agent publishes no kind 10050.' : 'Could not find the agent\'s DM inbox: no relay answered.'
  return null
}

/**
 * Send `text` to `agent`, as a STRATEGY when `strategy`. Wrapped to the
 * agent's 10050 relays, with the self-copy to mine; refused without both.
 * Resolves true when the agent's copy was accepted by at least one relay.
 */
export async function sendToAgent(agent: string, text: string, strategy = false): Promise<boolean> {
  const s = useAgentDms.getState()
  const setError = (e: string | null): void => useAgentDms.setState((st) => ({ sendError: { ...st.sendError, [agent]: e } }))
  const blocked = cannotSend(s, agent)
  if (blocked) { setError(blocked); return false }
  if (s.sending[agent]) return false
  if (!text.trim()) return false
  const me = s.me
  if (dmDeps.keys.pubkey() !== me) { setError('Your identity changed; open the conversation again.'); return false }
  useAgentDms.setState((st) => ({ sending: { ...st.sending, [agent]: true }, sendError: { ...st.sendError, [agent]: null } }))
  try {
    const wrapped = await wrapMessage(dmDeps.keys.sender(), agent, text.trim(), dmDeps.keys.fresh, { strategy })
    const [theirs, mine] = await Promise.all([
      dmDeps.transport.publish(s.inboxes[agent].relays, wrapped.toRecipient),
      dmDeps.transport.publish(s.myInbox.relays, wrapped.toSelf),
    ])
    if (useAgentDms.getState().me !== me) return false
    if (!theirs.ok) { setError(`Not delivered: ${theirs.reason}`); return false }
    // Shown at once; the self-copy, when it arrives, has the same rumor id.
    useAgentDms.setState((st) => ({ messages: { ...st.messages, [agent]: mergeMessages(st.messages[agent] ?? [], [toMessage(wrapped.rumor)]) } }))
    seen.add(wrapped.toSelf.id)
    if (!mine.ok) setError(`Delivered, but your own copy was not saved to your inbox: ${mine.reason}`)
    return true
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err))
    return false
  } finally {
    useAgentDms.setState((st) => ({ sending: { ...st.sending, [agent]: false } }))
  }
}

/** The STRATEGY in force with `agent`: the newest one I sent. */
export function strategyWith(s: Pick<AgentDmsState, 'me' | 'messages'>, agent: string): DmMessage | null {
  return currentStrategy(s.messages[agent] ?? [], s.me)
}

/** For tests: forget everything, as a fresh page would. */
export function resetAgentDms(): void {
  open.clear()
  watching = false
  lastReopen = 0
  resetFor('')
}
