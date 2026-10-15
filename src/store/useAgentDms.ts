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
 *   says "No DM inbox". Your 10050 is published only on an explicit tap of
 *   SET UP DM INBOX with a confirmation (arkinox, 2026-10-13: the panel goes
 *   public, and "never published for you" left a new operator with no way
 *   to talk to an agent): setUpDmInbox, offered only when the relays
 *   answered that you have none, so it never replaces a list you chose.
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
 * - Reactions (arkinox, 2026-10-12). The agent answers each of your messages
 *   it sees with a private kind 7 (lib/dm.ts REACTION_KIND), wrapped like a
 *   message. It is kept under the conversation of its two parties only, and
 *   shown under the message its e tag names once that message is loaded.
 *   A reaction is never unread: it lights no dot and raises no toast.
 *
 * - Keeping (arkinox, 2026-10-12: "We shouldn't have to decrypt messages ever
 *   again once they're decrypted once"). Every message and reaction decrypted
 *   or sent here is kept in IndexedDB per identity (lib/agentDmDb.ts), with
 *   every wrap this identity decrypted, so opening TALK shows the history at
 *   once and only wraps never opened on this device are decrypted. THE
 *   TRADE-OFF: the plaintext of these private messages now rests on the
 *   device; anyone with the unlocked device or a copy of the browser's data
 *   can read it. CLEAR HISTORY deletes one conversation's stored messages.
 *   The watch's own record (below, in localStorage) stays ids and times: it
 *   also notes wraps it never decrypted (its first run), so it is not the
 *   set of opened wraps, which lives in IndexedDB beside what they held.
 *   Without IndexedDB (a private window that refuses it) the conversation
 *   lasts the session, as it did before. A change of identity clears
 *   everything in memory, and another identity's rows are never read.
 *
 * The relays and the keys come in through `dmDeps`, so the tests stand in
 * fake ones and nothing here can reach a real relay from a test.
 */

import { create } from 'zustand'
import { generateSecretKey } from 'nostr-tools/pure'
import {
  counterpartOf, currentStrategy, MAX_BACKDATE_S, mergeMessages, mergeReactions, REACTION_KIND, toMessage, toReaction, unwrapRumor,
  wrapMessage, WRAP_KIND, type DmMessage, type DmReaction, type DmReader, type DmSender, type Rumor,
} from '../lib/dm'
import {
  deleteConversation, messageRow, openAgentDmDb, openedRow, reactionRow, readStored, writeStored,
  type ItemRow, type OpenedRow,
} from '../lib/agentDmDb'
import { DEFAULT_DM_RELAYS, dmInboxAnnounceRelays, dmInboxOf, dmInboxTemplate, type DmInbox } from '../lib/inbox'
import { authForRead, onResume, publishMany, subscribeOne, type PublishResult } from '../lib/relay'
import { localSigner, NIP44_UNAVAILABLE, signerCannotJudge } from '../lib/signers'
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

function openRealDb(): Promise<IDBDatabase> { return openAgentDmDb() }

/** The relays, keys, storage and database in use; exported so a test can stand in fakes. */
export const dmDeps: { transport: DmTransport; keys: DmKeys; storage: DmStorage; openDb: () => Promise<IDBDatabase> } = {
  transport: realTransport, keys: realKeys, storage: realStorage, openDb: openRealDb,
}

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
  /** Each agent's conversation's reactions, oldest first; shown under the message each names, once it is loaded. */
  reactions: Record<string, DmReaction[]>
  /** Whether what this device keeps for this identity has been read (or found unavailable). */
  historyLoaded: boolean
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
  /** SET UP DM INBOX (arkinox, 2026-10-13): publishing your 10050, or why it failed. */
  inboxSetup: InboxSetup
}

/** Where SET UP DM INBOX stands. */
export interface InboxSetup { status: 'idle' | 'publishing' | 'failed'; error: string | null }
const SETUP_IDLE: InboxSetup = { status: 'idle', error: null }

const LOADING: InboxState = { status: 'loading', relays: [] }

function initial(me: string): AgentDmsState {
  return { me, myInbox: LOADING, inboxes: {}, messages: {}, reactions: {}, historyLoaded: false, reading: 'idle', readError: null, sending: {}, sendError: {}, unread: {}, talking: null, inboxSetup: SETUP_IDLE }
}

export const useAgentDms = create<AgentDmsState>(() => initial(''))

// ---------------------------------------------------------------------------
// Module state: what is open, what has been opened, the reading's sockets.

/** Open conversations, by agent, counted (a re-render may open one twice). */
const open = new Map<string, number>()
/** Wraps already taken this session for this identity: never queued twice. */
let seen = new Set<string>()
/** Wraps this identity decrypted on this device, from IndexedDB and this session: never decrypted again. */
let opened = new Set<string>()
/** Bumped per identity, so a late read of the database for another identity is dropped. */
let loadGen = 0
/** The lookup of my 10050 under way from checkMyInbox, so the panel asks once. */
let mineLookup: Promise<void> | null = null

/** The conversation database, opened once; null when this browser will not have it (the session then keeps all in memory). */
let db: Promise<IDBDatabase | null> | null = null
function database(): Promise<IDBDatabase | null> {
  if (!db) {
    // No IndexedDB at all (a test without one): memory only, said nowhere.
    if (dmDeps.openDb === openRealDb && typeof indexedDB === 'undefined') return (db = Promise.resolve(null))
    db = dmDeps.openDb().catch((err: unknown) => {
      console.warn(`[agent-dms] IndexedDB unavailable, conversations last this session only: ${err instanceof Error ? err.message : String(err)}`)
      return null
    })
  }
  return db
}

/** The database writes so far, one after another, so a test can wait for them. */
let writes: Promise<void> = Promise.resolve()

/** Keep opened wraps and items, off the frame; a failed write is said and the session keeps them in memory. */
function persist(openedRows: OpenedRow[], items: ItemRow[]): void {
  writes = writes
    .then(() => database())
    .then((d) => (d ? writeStored(d, openedRows, items) : undefined))
    .catch((err: unknown) => { console.warn(`[agent-dms] could not keep a message: ${err instanceof Error ? err.message : String(err)}`) })
}

/** Show a message or a reaction in its conversation. */
function showItem(agent: string, item: { message?: DmMessage; reaction?: DmReaction }): void {
  const s = useAgentDms.getState()
  if (item.message) useAgentDms.setState({ messages: { ...s.messages, [agent]: mergeMessages(s.messages[agent] ?? [], [item.message]) } })
  if (item.reaction) useAgentDms.setState({ reactions: { ...s.reactions, [agent]: mergeReactions(s.reactions[agent] ?? [], [item.reaction]) } })
}

/**
 * Read what this device keeps for `me` and show it at once, merged with
 * anything already in memory. Every wrap noted opened joins `opened`, so the
 * relays' copies of it are skipped without a decrypt.
 */
async function loadStored(me: string): Promise<void> {
  const gen = ++loadGen
  if (!me) return
  try {
    const d = await database()
    const stored = d ? await readStored(d, me) : { opened: [], items: [] }
    if (gen !== loadGen || useAgentDms.getState().me !== me) return
    for (const id of stored.opened) opened.add(id)
    const msgs: Record<string, DmMessage[]> = {}
    const reacts: Record<string, DmReaction[]> = {}
    for (const it of stored.items) {
      if (it.kind === 'message') (msgs[it.agent] ??= []).push(it.message)
      else (reacts[it.agent] ??= []).push(it.reaction)
    }
    const s = useAgentDms.getState()
    const messages = { ...s.messages }
    for (const [a, list] of Object.entries(msgs)) messages[a] = mergeMessages(messages[a] ?? [], list)
    const reactions = { ...s.reactions }
    for (const [a, list] of Object.entries(reacts)) reactions[a] = mergeReactions(reactions[a] ?? [], list)
    useAgentDms.setState({ messages, reactions, historyLoaded: true })
  } catch (err) {
    console.warn(`[agent-dms] could not read kept conversations: ${err instanceof Error ? err.message : String(err)}`)
    if (gen === loadGen && useAgentDms.getState().me === me) useAgentDms.setState({ historyLoaded: true })
  }
}
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
  mineLookup = null
  stopReading()
  closeWatch()
  epoch += 1
  seen = new Set()
  opened = new Set()
  record = loadRecord(me)
  watchOpened = 0
  capped = false
  noDecrypt = false
  useAgentDms.setState({ ...initial(me), unread: record.unread }, true)
  // Every wrap waits for the kept history to be read, so one opened in an
  // earlier session is skipped even when the relay answers first.
  queue = loadStored(me)
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
  if (wrap.kind !== WRAP_KIND || seen.has(wrap.id) || opened.has(wrap.id)) return
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
    // Decrypted on this device before (found once the kept history was read): never again.
    if (opened.has(wrap.id)) return
    const reader = dmDeps.keys.reader()
    // unwrapRumor drops a wrap that will not open, rightly, but a signer
    // with no NIP-44 decrypt at all opens none, and that is said in words.
    let unavailable = false
    // Nor is a wrap kept as unopenable when the signer, not the wrap, is why:
    // a signer on another account opens nothing sealed to me, and once it is
    // switched back the same wrap opens (signerCannotJudge). It is left to be
    // opened when it comes again, this session or the next.
    let signerAway = false
    const rumor = await unwrapRumor(wrap, {
      pubkey: reader.pubkey,
      nip44Decrypt: (pk, ct) => reader.nip44Decrypt(pk, ct).catch((err: unknown) => {
        if (err instanceof Error && err.message === NIP44_UNAVAILABLE) {
          unavailable = true
          if (!fromWatch) useAgentDms.setState({ readError: NO_DECRYPT })
        } else if (signerCannotJudge(err)) {
          signerAway = true
          if (!fromWatch) useAgentDms.setState({ readError: (err as Error).message })
        }
        throw err
      }),
    })
    if (useAgentDms.getState().me !== me) return
    if (unavailable) { if (fromWatch) noDecrypt = true; seen.delete(wrap.id); return }
    if (signerAway) { seen.delete(wrap.id); return }
    // Opened (or found not to open): never decrypted again on this device.
    record.watched[wrap.id] = wrap.created_at
    saveRecord()
    opened.add(wrap.id)
    const noted = [openedRow(me, wrap.id, wrap.created_at)]
    // counterpartOf keeps only a rumor between me and exactly one other, so a
    // reaction from a third party, or one naming a third party, is dropped.
    const agent = rumor ? counterpartOf(rumor, me) : null
    if (!rumor || !agent || !(open.has(agent) || dmDeps.keys.agents().includes(agent))) { persist(noted, []); return }
    if (rumor.kind === REACTION_KIND) {
      // A reaction is shown, kept, and never unread (arkinox, 2026-10-12).
      const reaction = toReaction(rumor)
      if (reaction) showItem(agent, { reaction })
      persist(noted, reaction ? [reactionRow(me, agent, reaction)] : [])
      return
    }
    const message = toMessage(rumor)
    showItem(agent, { message })
    persist(noted, [messageRow(me, agent, message)])
    noteUnread(rumor, agent, me)
  })
}

/**
 * A message from one of my agents, written after I last opened our
 * conversation (and after the watch first ran on this device), is unread
 * unless the conversation is on screen. My own self-copies never are.
 */
function noteUnread(rumor: Rumor, agent: string, me: string): void {
  if (rumor.kind === REACTION_KIND || rumor.pubkey === me || rumor.pubkey !== agent) return
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

/**
 * Make sure my DM inbox is known for `me` (the AGENTS panel offers SET UP
 * DM INBOX when it is not there, arkinox, 2026-10-13). Asks once; a
 * conversation opening later reuses the answer.
 */
export function checkMyInbox(me: string): void {
  if (!me) return
  if (useAgentDms.getState().me !== me) resetFor(me)
  if (useAgentDms.getState().myInbox.status !== 'loading' || mineLookup) return
  const lookup = lookUpMine().finally(() => { if (mineLookup === lookup) mineLookup = null })
  mineLookup = lookup
}

/**
 * SET UP DM INBOX, after the confirmation (arkinox, 2026-10-13): sign a kind
 * 10050 naming `relays` with your own signer and publish it where it is
 * looked for. Only when the relays answered that you have none (status
 * `none`): an unknown inbox may exist, and a 10050 is replaceable, so
 * publishing then could overwrite the one you chose. Resolves true once a
 * relay accepted it; the inbox is then ready, and an open conversation
 * starts reading it.
 */
export async function setUpDmInbox(relays: readonly string[] = DEFAULT_DM_RELAYS): Promise<boolean> {
  const s = useAgentDms.getState()
  const me = s.me
  if (!me || dmDeps.keys.pubkey() !== me) return false
  if (s.myInbox.status !== 'none' || s.inboxSetup.status === 'publishing') return false
  const fail = (error: string): false => {
    if (useAgentDms.getState().me === me) useAgentDms.setState({ inboxSetup: { status: 'failed', error } })
    return false
  }
  useAgentDms.setState({ inboxSetup: { status: 'publishing', error: null } })
  try {
    const template = dmInboxTemplate(relays)
    const signed = await dmDeps.keys.sender().signEvent(template)
    if (useAgentDms.getState().me !== me) return false
    const result = await dmDeps.transport.publish(dmInboxAnnounceRelays(relays), signed)
    if (useAgentDms.getState().me !== me) return false
    if (!result.ok) return fail(`Not published: ${result.reason}`)
    const chosen = template.tags.map((t) => t[1])
    useAgentDms.setState({ myInbox: { status: 'ready', relays: chosen }, inboxSetup: SETUP_IDLE })
    if (open.size) {
      startReading()
      // An agent copies its operator's DM relays, so its inbox is asked again there.
      for (const agent of open.keys()) void lookUpAgent(agent)
    }
    openWatch()
    return true
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err))
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
 * Send `text` to `agent`, as a STRATEGY when `strategy`, as a KEEP GOING order when `keepGoing`. Wrapped to the
 * agent's 10050 relays, with the self-copy to mine; refused without both.
 * Resolves true when the agent's copy was accepted by at least one relay.
 */
export async function sendToAgent(agent: string, text: string, strategy = false, keepGoing = false): Promise<boolean> {
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
    const wrapped = await wrapMessage(dmDeps.keys.sender(), agent, text.trim(), dmDeps.keys.fresh, { strategy, keepGoing })
    const [theirs, mine] = await Promise.all([
      dmDeps.transport.publish(s.inboxes[agent].relays, wrapped.toRecipient),
      dmDeps.transport.publish(s.myInbox.relays, wrapped.toSelf),
    ])
    if (useAgentDms.getState().me !== me) return false
    if (!theirs.ok) { setError(`Not delivered: ${theirs.reason}`); return false }
    // Shown at once and kept; the self-copy, when it arrives, has the same
    // rumor id and is never decrypted (arkinox, 2026-10-12).
    const message = toMessage(wrapped.rumor)
    showItem(agent, { message })
    seen.add(wrapped.toSelf.id)
    opened.add(wrapped.toSelf.id)
    persist([openedRow(me, wrapped.toSelf.id, wrapped.toSelf.created_at)], [messageRow(me, agent, message)])
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

/** One conversation, out of memory. */
function forget(agent: string): void {
  useAgentDms.setState((s) => {
    const messages = { ...s.messages }
    const reactions = { ...s.reactions }
    delete messages[agent]
    delete reactions[agent]
    return { messages, reactions }
  })
}

/**
 * CLEAR HISTORY (arkinox, 2026-10-12): delete this identity's stored messages
 * and reactions with `agent`, here and in IndexedDB. The wraps stay noted as
 * opened (ids only), so the relays' copies are not decrypted and kept again
 * on this device; they remain on the relays and on any other device.
 */
export async function clearHistory(agent: string): Promise<void> {
  const me = useAgentDms.getState().me
  if (!me) return
  forget(agent)
  // After any write queued for this conversation, so none lands after the delete.
  await queue
  writes = writes
    .then(() => database())
    .then((d) => (d ? deleteConversation(d, me, agent) : undefined))
    .catch((err: unknown) => { console.warn(`[agent-dms] could not clear the history: ${err instanceof Error ? err.message : String(err)}`) })
  await writes
  if (useAgentDms.getState().me !== me) return
  // Anything that landed in memory while the queue drained goes too.
  forget(agent)
}

/** For tests: every decrypt queued and every write to IndexedDB done. */
export async function settledAgentDms(): Promise<void> {
  await queue
  await writes
}

/** For tests: forget everything, as a fresh page would (the database is closed and opened again on next use). */
export function resetAgentDms(): void {
  open.clear()
  watching = false
  lastReopen = 0
  // The old connection closes once the writes already asked of it are done.
  const was = db
  const pending = writes
  db = null
  writes = Promise.resolve()
  void was?.then((d) => pending.then(() => d?.close()))
  resetFor('')
}
