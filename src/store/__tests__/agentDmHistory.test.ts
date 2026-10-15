/**
 * agentDmHistory.test.ts: private reactions and the conversation kept in
 * IndexedDB (arkinox, 2026-10-12), on fake relays and fake-indexeddb only.
 * The agent's 👀 kind 7 attaches to the message it names, waits for one not
 * yet loaded, is never unread, and is dropped from anyone but the two
 * parties. Decrypted and sent messages survive a new session and show
 * before the relays answer; a stored wrap is never decrypted again; another
 * identity sees none of them; CLEAR HISTORY deletes them for good here.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../useCyberspace'
import { generateSecretKey } from 'nostr-tools/pure'
import { localSigner } from '../../lib/signers'
import type { NostrEvent } from '../../lib/events'
import type { DmInbox } from '../../lib/inbox'
import {
  createReactionRumor, reactionsByMessage, sealRumor, wrapMessage, wrapSeal,
  type DmReader, type DmSender,
} from '../../lib/dm'
import { AGENT_DM_DB } from '../../lib/agentDmDb'
import {
  clearHistory, dmDeps, openConversation, resetAgentDms, sendToAgent, settledAgentDms, useAgentDms, watchAgentDms,
  type DmKeys, type DmTransport,
} from '../useAgentDms'

interface Key { sk: Uint8Array; pubkey: string; sender: DmSender; reader: DmReader }

function key(): Key {
  const sk = generateSecretKey()
  const s = localSigner(sk)
  return { sk, pubkey: s.pubkey, sender: { pubkey: s.pubkey, signEvent: s.signEvent, nip44Encrypt: s.nip44Encrypt! }, reader: { pubkey: s.pubkey, nip44Decrypt: s.nip44Decrypt! } }
}

const MY_RELAY = 'wss://inbox.example'
const AGENT_RELAY = 'wss://agent-inbox.example'

interface Sub { relay: string; filter: { since?: number }; deliver: (ev: NostrEvent) => void; eose: () => void; closed: boolean }

let me: Key
let agent: Key
let subs: Sub[]
let published: NostrEvent[]
let inboxes: Map<string, DmInbox>
let decrypts: number
const saved = { ...dmDeps }

const transport: DmTransport = {
  inboxOf: async (pk) => inboxes.get(pk) ?? { relays: [], answered: true },
  subscribe: (relay, filter, onEvent, _onClose, onEose) => {
    const sub: Sub = { relay, filter, deliver: onEvent, eose: () => onEose?.(), closed: false }
    subs.push(sub)
    return () => { sub.closed = true }
  },
  publish: async (_relays, ev) => { published.push(ev); return { ok: true } },
  onResume: () => () => undefined,
}

const settle = async (): Promise<void> => {
  await new Promise((r) => setTimeout(r, 30))
  await settledAgentDms()
}
const nowS = (): number => Math.floor(Date.now() / 1000)
/** The open conversation's reading (not the watch). */
const reading = (): Sub => subs.filter((s) => !s.closed && s.filter.since === undefined).at(-1)!
const watch = (): Sub => subs.filter((s) => !s.closed && s.filter.since !== undefined).at(-1)!

/** A message from `from` to `to`, wrapped to `to`. */
async function dm(from: Key, to: string, text: string, at = nowS()): Promise<NostrEvent> {
  return (await wrapMessage(from.sender, to, text, () => key().sender, { now: at })).toRecipient
}

/** A private 👀 from `from` to `to` on the rumor `target`, wrapped as the agent's side does. */
async function react(from: Key, to: string, target: string, content = '👀'): Promise<NostrEvent> {
  const rumor = createReactionRumor(from.pubkey, to, target, content)
  return wrapSeal(await sealRumor(rumor, from.sender, to), to, key().sender)
}

/** A new page load: memory gone, the database (and localStorage stand-in) kept. */
function newSession(): void { resetAgentDms() }

let mem: Map<string, string>

beforeEach(() => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  me = key()
  agent = key()
  subs = []
  published = []
  inboxes = new Map([[me.pubkey, { relays: [MY_RELAY], answered: true }], [agent.pubkey, { relays: [AGENT_RELAY], answered: true }]])
  decrypts = 0
  mem = new Map()
  const keys: DmKeys = {
    pubkey: () => me.pubkey,
    sender: () => me.sender,
    reader: () => ({ pubkey: me.pubkey, nip44Decrypt: (pk, ct) => { decrypts += 1; return me.reader.nip44Decrypt(pk, ct) } }),
    fresh: () => key().sender,
    agents: () => [agent.pubkey],
    promptFree: () => true,
  }
  dmDeps.transport = transport
  dmDeps.keys = keys
  dmDeps.storage = { get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v) } }
  resetAgentDms()
})

afterEach(() => {
  resetAgentDms()
  dmDeps.transport = saved.transport
  dmDeps.keys = saved.keys
  dmDeps.storage = saved.storage
  dmDeps.openDb = saved.openDb
})

describe('private reactions', () => {
  it('the agent\'s 👀 attaches to the message it names', async () => {
    const close = openConversation(agent.pubkey)
    await settle()
    await sendToAgent(agent.pubkey, 'REPORT.')
    const sent = useAgentDms.getState().messages[agent.pubkey][0]
    reading().deliver(await react(agent, me.pubkey, sent.id))
    await settle()
    const s = useAgentDms.getState()
    expect(s.messages[agent.pubkey]).toHaveLength(1)
    const by = reactionsByMessage(s.reactions[agent.pubkey], s.messages[agent.pubkey], me.pubkey, agent.pubkey)
    expect(by[sent.id].map((r) => [r.from, r.content])).toEqual([[agent.pubkey, '👀']])
    close()
  })

  it('a reaction for a message not yet loaded waits, and shows once it is', async () => {
    const close = openConversation(agent.pubkey)
    await settle()
    // My message from another device: its self-copy arrives after the 👀.
    const other = await wrapMessage(me.sender, agent.pubkey, 'HOLD.', () => key().sender)
    reading().deliver(await react(agent, me.pubkey, other.rumor.id))
    await settle()
    let s = useAgentDms.getState()
    expect(reactionsByMessage(s.reactions[agent.pubkey], s.messages[agent.pubkey] ?? [], me.pubkey, agent.pubkey)).toEqual({})
    reading().deliver(other.toSelf)
    await settle()
    s = useAgentDms.getState()
    expect(Object.keys(reactionsByMessage(s.reactions[agent.pubkey], s.messages[agent.pubkey], me.pubkey, agent.pubkey))).toEqual([other.rumor.id])
    close()
  })

  it('reactions from anyone but the two parties are never shown', async () => {
    const close = openConversation(agent.pubkey)
    await settle()
    await sendToAgent(agent.pubkey, 'REPORT.')
    const target = useAgentDms.getState().messages[agent.pubkey][0].id
    const stranger = key()
    reading().deliver(await react(stranger, me.pubkey, target))
    // A reaction from the agent that also names a third party is no one-to-one rumor.
    const third = createReactionRumor(agent.pubkey, me.pubkey, target, '👀')
    third.tags.push(['p', stranger.pubkey])
    const { getEventHash } = await import('nostr-tools/pure')
    third.id = getEventHash(third)
    reading().deliver(await wrapSeal(await sealRumor(third, agent.sender, me.pubkey), me.pubkey, key().sender))
    await settle()
    const s = useAgentDms.getState()
    expect(s.reactions[agent.pubkey]).toBeUndefined()
    expect(s.reactions[stranger.pubkey]).toBeUndefined()
    close()
  })

  it('a reaction is never unread: no dot, no toast', async () => {
    const stop = watchAgentDms(me.pubkey)
    await settle()
    watch().eose()
    watch().deliver(await react(agent, me.pubkey, 'ab'.repeat(32)))
    await settle()
    const s = useAgentDms.getState()
    expect(s.reactions[agent.pubkey]).toHaveLength(1)
    expect(s.unread).toEqual({})
    // A message from the agent still is.
    watch().deliver(await dm(agent, me.pubkey, 'Arrived.', nowS() + 60))
    await settle()
    expect(useAgentDms.getState().unread[agent.pubkey].ids).toHaveLength(1)
    stop()
  })
})

describe('the conversation kept in IndexedDB', () => {
  it('sent and received messages and reactions come back in a new session before any relay answers, with no decrypt', async () => {
    let close = openConversation(agent.pubkey)
    await settle()
    await sendToAgent(agent.pubkey, 'COME TO ME.')
    const sentId = useAgentDms.getState().messages[agent.pubkey][0].id
    const reply = await dm(agent, me.pubkey, 'On my way.', nowS() + 1)
    const seen = await react(agent, me.pubkey, sentId)
    reading().deliver(reply)
    reading().deliver(seen)
    await settle()
    expect(decrypts).toBe(4)
    close()

    newSession()
    // Nobody answers this time: the history comes from the device alone.
    inboxes = new Map()
    close = openConversation(agent.pubkey)
    await settle()
    const s = useAgentDms.getState()
    expect(s.historyLoaded).toBe(true)
    expect(s.messages[agent.pubkey].map((m) => m.text)).toEqual(['COME TO ME.', 'On my way.'])
    expect(s.reactions[agent.pubkey].map((r) => r.target)).toEqual([sentId])
    expect(decrypts).toBe(4)
    close()
  })

  it('a stored wrap is never decrypted again, even when the relay answers before the history is read', async () => {
    let close = openConversation(agent.pubkey)
    await settle()
    const reply = await dm(agent, me.pubkey, 'REPORT: all quiet.', nowS() - 5)
    reading().deliver(reply)
    await settle()
    expect(decrypts).toBe(2)
    close()
    // The self-copy of a sent message is never decrypted either.
    newSession()
    close = openConversation(agent.pubkey)
    await settle()
    await sendToAgent(agent.pubkey, 'Hold.')
    const selfCopy = published[published.length - 1]
    close()

    newSession()
    // The kept history is held back until the relay has answered, so
    // "before the history is read" is a fact of the test, not a race
    // between a timer tick and IndexedDB (flaky under load, 2026-10-14).
    let release!: () => void
    const held = new Promise<void>((r) => { release = r })
    const openDb = dmDeps.openDb
    dmDeps.openDb = () => held.then(() => openDb())
    close = openConversation(agent.pubkey)
    for (let i = 0; i < 100 && !subs.some((s) => !s.closed && s.filter.since === undefined); i++) await new Promise((r) => setTimeout(r, 5))
    expect(useAgentDms.getState().historyLoaded).toBe(false)
    reading().deliver(reply)
    reading().deliver(selfCopy)
    await new Promise((r) => setTimeout(r, 30))
    expect(useAgentDms.getState().historyLoaded).toBe(false)
    release()
    await settle()
    expect(useAgentDms.getState().historyLoaded).toBe(true)
    reading().deliver(reply)
    reading().deliver(selfCopy)
    await settle()
    expect(decrypts).toBe(2)
    expect(useAgentDms.getState().messages[agent.pubkey].map((m) => m.text)).toEqual(['REPORT: all quiet.', 'Hold.'])
    close()
  })

  it('another identity never sees these messages', async () => {
    let close = openConversation(agent.pubkey)
    await settle()
    await sendToAgent(agent.pubkey, 'secret orders')
    reading().deliver(await dm(agent, me.pubkey, 'secret reply', nowS() + 1))
    await settle()
    close()

    const first = me
    me = key()
    inboxes.set(me.pubkey, { relays: [MY_RELAY], answered: true })
    close = openConversation(agent.pubkey)
    await settle()
    expect(useAgentDms.getState().me).toBe(me.pubkey)
    expect(useAgentDms.getState().messages).toEqual({})
    expect(useAgentDms.getState().reactions).toEqual({})
    close()

    // Back to the first: its history returns.
    me = first
    close = openConversation(agent.pubkey)
    await settle()
    expect(useAgentDms.getState().messages[agent.pubkey].map((m) => m.text)).toEqual(['secret orders', 'secret reply'])
    close()
  })

  it('CLEAR HISTORY deletes the conversation here and on the device, and the relays\' copies are not kept again', async () => {
    const other = key()
    dmDeps.keys = { ...dmDeps.keys, agents: () => [agent.pubkey, other.pubkey] }
    inboxes.set(other.pubkey, { relays: [AGENT_RELAY], answered: true })
    let close = openConversation(agent.pubkey)
    const closeOther = openConversation(other.pubkey)
    await settle()
    await sendToAgent(agent.pubkey, 'to be cleared')
    const sentId = useAgentDms.getState().messages[agent.pubkey][0].id
    const reply = await dm(agent, me.pubkey, 'also cleared')
    reading().deliver(reply)
    reading().deliver(await react(agent, me.pubkey, sentId))
    reading().deliver(await dm(other, me.pubkey, 'kept'))
    await settle()

    await clearHistory(agent.pubkey)
    expect(useAgentDms.getState().messages[agent.pubkey]).toBeUndefined()
    expect(useAgentDms.getState().reactions[agent.pubkey]).toBeUndefined()
    close()
    closeOther()

    newSession()
    const before = decrypts
    close = openConversation(agent.pubkey)
    await settle()
    reading().deliver(reply)
    await settle()
    const s = useAgentDms.getState()
    expect(s.messages[agent.pubkey]).toBeUndefined()
    expect(s.reactions[agent.pubkey]).toBeUndefined()
    expect(decrypts).toBe(before)
    // Another conversation is untouched.
    expect(s.messages[other.pubkey].map((m) => m.text)).toEqual(['kept'])
    close()
  })

  it('the database is named for this feature and holds no row for a wrap that was not mine to keep', async () => {
    const close = openConversation(agent.pubkey)
    await settle()
    reading().deliver(await dm(key(), me.pubkey, 'a stranger\'s words'))
    await settle()
    close()
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(AGENT_DM_DB); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })
    const items = await new Promise<unknown[]>((res) => { const r = db.transaction('items').objectStore('items').getAll(); r.onsuccess = () => res(r.result) })
    const opened = await new Promise<unknown[]>((res) => { const r = db.transaction('opened').objectStore('opened').getAll(); r.onsuccess = () => res(r.result) })
    db.close()
    expect(items).toEqual([])
    expect(opened).toHaveLength(1)
    expect(JSON.stringify(opened)).not.toContain('stranger')
  })
})
