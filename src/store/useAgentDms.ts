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
 * Messages live in memory for the session only, never in storage: they are
 * private, and the relays hold them for the next session. A change of
 * identity clears everything.
 *
 * The relays and the keys come in through `dmDeps`, so the tests stand in
 * fake ones and nothing here can reach a real relay from a test.
 */

import { create } from 'zustand'
import { generateSecretKey } from 'nostr-tools/pure'
import {
  counterpartOf, currentStrategy, mergeMessages, toMessage, unwrapMessage, wrapMessage,
  WRAP_KIND, type DmMessage, type DmReader, type DmSender,
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
  /** A live read of one relay, authenticated; the returned function closes it. */
  subscribe: (relay: string, filter: { kinds: number[]; '#p': string[]; limit: number }, onEvent: (ev: NostrEvent) => void, onClose: (reason: string) => void) => () => void
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
}

const realTransport: DmTransport = {
  inboxOf: dmInboxOf,
  subscribe: (relay, filter, onEvent, onClose) => {
    let sub: { close: () => void } | null = null
    let closed = false
    // Authenticate before asking, as every read of a gated relay here does;
    // subscribeOne also answers a CLOSED auth-required once and asks again.
    void authForRead(relay).catch(() => undefined).then(() => {
      if (closed) return
      sub = subscribeOne(relay, filter, { onevent: onEvent, oneose: () => undefined, onclose: (r) => onClose(r ?? 'closed') })
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
}

/** The relays and keys in use; exported so a test can stand in fakes. */
export const dmDeps: { transport: DmTransport; keys: DmKeys } = { transport: realTransport, keys: realKeys }

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
}

const LOADING: InboxState = { status: 'loading', relays: [] }

function initial(me: string): AgentDmsState {
  return { me, myInbox: LOADING, inboxes: {}, messages: {}, reading: 'idle', readError: null, sending: {}, sendError: {} }
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

function inboxState(found: DmInbox): InboxState {
  if (found.relays.length) return { status: 'ready', relays: found.relays }
  return { status: found.answered ? 'none' : 'unknown', relays: [] }
}

/** Start over for a new identity: nothing of the old one survives. */
function resetFor(me: string): void {
  stopReading()
  epoch += 1
  seen = new Set()
  queue = Promise.resolve()
  useAgentDms.setState(initial(me), true)
}

function stopReading(): void {
  for (const c of closers) c()
  closers = []
  stopResume?.()
  stopResume = null
  epoch += 1
}

/** Open one wrap, in turn, and keep it only when it is between me and one of my agents. */
function take(wrap: NostrEvent, at: number): void {
  if (wrap.kind !== WRAP_KIND || seen.has(wrap.id)) return
  seen.add(wrap.id)
  const me = useAgentDms.getState().me
  queue = queue.then(async () => {
    if (at !== epoch) { seen.delete(wrap.id); return }
    const reader = dmDeps.keys.reader()
    // unwrapMessage drops a wrap that will not open, rightly, but a signer
    // with no NIP-44 decrypt at all opens none, and that is said in words.
    const rumor = await unwrapMessage(wrap, {
      pubkey: reader.pubkey,
      nip44Decrypt: (pk, ct) => reader.nip44Decrypt(pk, ct).catch((err: unknown) => {
        if (err instanceof Error && err.message === NIP44_UNAVAILABLE) useAgentDms.setState({ readError: NO_DECRYPT })
        throw err
      }),
    })
    if (!rumor || at !== epoch || useAgentDms.getState().me !== me) return
    const agent = counterpartOf(rumor, me)
    if (!agent || !(open.has(agent) || dmDeps.keys.agents().includes(agent))) return
    const s = useAgentDms.getState()
    useAgentDms.setState({ messages: { ...s.messages, [agent]: mergeMessages(s.messages[agent] ?? [], [toMessage(rumor)]) } })
  })
}

/** Subscribe to my inbox relays for wraps to me. */
function startReading(): void {
  const s = useAgentDms.getState()
  if (s.myInbox.status !== 'ready' || closers.length) return
  const at = ++epoch
  const relays = s.myInbox.relays
  const filter = { kinds: [WRAP_KIND], '#p': [s.me], limit: WRAP_LIMIT }
  const ended = new Map<string, string>()
  // Live once asked: an empty inbox sends nothing to say it is there.
  useAgentDms.setState({ reading: 'live', readError: null })
  for (const relay of relays) {
    closers.push(dmDeps.transport.subscribe(relay, filter, (ev) => { if (at === epoch) take(ev, at) }, (reason) => {
      if (at !== epoch) return
      ended.set(relay, reason)
      if (ended.size === relays.length) {
        useAgentDms.setState({ reading: 'failed', readError: [...ended.entries()].map(([u, r]) => `${u}: ${r}`).join('; ') })
      }
    }))
  }
  // Back from an absence, the sockets may be dead: ask again over fresh ones.
  stopResume = dmDeps.transport.onResume(() => {
    if (!open.size) return
    for (const c of closers) c()
    closers = []
    stopResume?.()
    stopResume = null
    startReading()
  })
}

async function lookUpMine(): Promise<void> {
  const me = useAgentDms.getState().me
  const found = inboxState(await dmDeps.transport.inboxOf(me, []).catch(() => ({ relays: [], answered: false })))
  if (useAgentDms.getState().me !== me) return
  useAgentDms.setState({ myInbox: found })
  if (open.size) startReading()
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
  resetFor('')
}
