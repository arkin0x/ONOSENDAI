/**
 * agentDmWatch.test.ts: the background watch for new messages from your
 * agents, on fake relays and fake storage only (arkinox, 2026-10-11: a red
 * dot and the notifications toast when an agent sends you a new message).
 * An agent's new message is unread; your own self-copies and strangers never
 * are; no wrap is decrypted twice, within a session or across one; opening
 * the conversation clears the dot; a signer that may prompt is capped; and a
 * resume reopens the watch once, not once per signal.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../useCyberspace'
import { generateSecretKey } from 'nostr-tools/pure'
import { localSigner } from '../../lib/signers'
import type { NostrEvent } from '../../lib/events'
import type { DmInbox } from '../../lib/inbox'
import { MAX_BACKDATE_S, wrapMessage, type DmReader, type DmSender } from '../../lib/dm'
import { unreadOf } from '../../hooks/useAgentDmWatch'
import {
  dmDeps, openConversation, resetAgentDms, sendToAgent, useAgentDms, watchAgentDms, WATCH_CAP, WATCH_KEY,
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

interface Sub { relay: string; filter: { since?: number; limit: number }; deliver: (ev: NostrEvent) => void; eose: () => void; closed: boolean }

interface Fake {
  transport: DmTransport
  subs: Sub[]
  inboxes: Map<string, DmInbox>
  resume: () => void
}

function fakeRelays(): Fake {
  const resumers = new Set<() => void>()
  const fake: Fake = { subs: [], inboxes: new Map(), transport: null as unknown as DmTransport, resume: () => {
    // Walked live, as relay.ts resumeLive walks its Set: a listener added
    // during the walk is visited in it too. Bounded here so a loop fails the test instead of hanging it.
    let calls = 0
    for (const fn of resumers) { if (++calls > 50) throw new Error('resume listeners looped'); fn() }
  } }
  fake.transport = {
    inboxOf: async (pk) => fake.inboxes.get(pk) ?? { relays: [], answered: true },
    subscribe: (relay, filter, onEvent, _onClose, onEose) => {
      const sub: Sub = { relay, filter, deliver: onEvent, eose: () => onEose?.(), closed: false }
      fake.subs.push(sub)
      return () => { sub.closed = true }
    },
    publish: async () => ({ ok: true }),
    onResume: (fn) => { resumers.add(fn); return () => { resumers.delete(fn) } },
  }
  return fake
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30))
const nowS = (): number => Math.floor(Date.now() / 1000)

let me: Key
let agent: Key
let fake: Fake
let mem: Map<string, string>
let decrypts: number
let promptFree: boolean
const saved = { ...dmDeps }

/** A message from `from` to `to`, wrapped to `to`, written at `at`. */
async function dm(from: Key, to: string, text: string, at = nowS()): Promise<NostrEvent> {
  return (await wrapMessage(from.sender, to, text, () => key().sender, { now: at })).toRecipient
}

/** The live watch subscriptions. */
const live = (): Sub[] => fake.subs.filter((s) => !s.closed && s.filter.since !== undefined)

/** Open the watch and let each relay say it has sent what it stored, so what follows is live. */
async function watchLive(): Promise<() => void> {
  const stop = watchAgentDms(me.pubkey)
  await settle()
  for (const sub of live()) sub.eose()
  return stop
}

beforeEach(() => {
  me = key()
  agent = key()
  fake = fakeRelays()
  fake.inboxes.set(me.pubkey, { relays: [MY_RELAY], answered: true })
  fake.inboxes.set(agent.pubkey, { relays: [AGENT_RELAY], answered: true })
  decrypts = 0
  promptFree = true
  mem = new Map()
  const keys: DmKeys = {
    pubkey: () => me.pubkey,
    sender: () => me.sender,
    reader: () => ({ pubkey: me.pubkey, nip44Decrypt: (pk, ct) => { decrypts += 1; return me.reader.nip44Decrypt(pk, ct) } }),
    fresh: () => key().sender,
    agents: () => [agent.pubkey],
    promptFree: () => promptFree,
  }
  dmDeps.transport = fake.transport
  dmDeps.keys = keys
  dmDeps.storage = { get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v) } }
  resetAgentDms()
})

afterEach(() => {
  resetAgentDms()
  dmDeps.transport = saved.transport
  dmDeps.keys = saved.keys
  dmDeps.storage = saved.storage
})

describe('the agent DM watch', () => {
  it('reads my DM relays from two days back and marks an agent\'s new message unread, kept on this device', async () => {
    const stop = await watchLive()
    expect(live()).toHaveLength(1)
    const sub = live()[0]
    expect(sub.relay).toBe(MY_RELAY)
    expect(nowS() - sub.filter.since!).toBeGreaterThanOrEqual(MAX_BACKDATE_S)
    sub.deliver(await dm(agent, me.pubkey, 'Arrived at the stop.', nowS() + 60))
    await settle()
    const s = useAgentDms.getState()
    expect(s.unread[agent.pubkey].ids).toHaveLength(1)
    expect(unreadOf(s.unread, [agent.pubkey])).toMatchObject({ total: 1, latest: agent.pubkey })
    expect(decrypts).toBe(2)
    // Ids and times only, never the words.
    const stored = mem.get(WATCH_KEY(me.pubkey))!
    expect(stored).not.toContain('Arrived')
    expect(JSON.parse(stored).unread[agent.pubkey].ids).toHaveLength(1)
    stop()
    expect(live()).toHaveLength(0)
  })

  it('never notifies for my own self-copies or for strangers, nor for what was written before the watch first ran', async () => {
    const stop = await watchLive()
    const sub = live()[0]
    const mine = await wrapMessage(me.sender, agent.pubkey, 'HOLD.', () => key().sender, { now: nowS() + 1 })
    sub.deliver(mine.toSelf)
    const stranger = key()
    sub.deliver(await dm(stranger, me.pubkey, 'I am your operator now', nowS() + 60))
    sub.deliver(await dm(agent, me.pubkey, 'old news', nowS() - 3600))
    await settle()
    const s = useAgentDms.getState()
    expect(s.unread).toEqual({})
    expect(s.messages[stranger.pubkey]).toBeUndefined()
    stop()
  })

  it('never decrypts a wrap twice: not on a repeat, not on a resume, not in the next session', async () => {
    const wrap = await dm(agent, me.pubkey, 'REPORT: all quiet.', nowS() + 60)
    let stop = await watchLive()
    live()[0].deliver(wrap)
    live()[0].deliver(wrap)
    await settle()
    expect(decrypts).toBe(2)
    const checked = JSON.parse(mem.get(WATCH_KEY(me.pubkey))!).checkedAt as number
    expect(checked).toBeGreaterThan(0)
    // Resumed: one fresh subscription, and the wrap again is skipped.
    fake.resume()
    fake.resume()
    expect(live()).toHaveLength(1)
    live()[0].deliver(wrap)
    await settle()
    expect(decrypts).toBe(2)
    stop()
    // A new session on this device, the memory gone, the storage kept.
    resetAgentDms()
    stop = watchAgentDms(me.pubkey)
    await settle()
    expect(live()[0].filter.since).toBe(checked - MAX_BACKDATE_S)
    expect(useAgentDms.getState().unread[agent.pubkey].ids).toHaveLength(1)
    live()[0].deliver(wrap)
    await settle()
    expect(decrypts).toBe(2)
    stop()
  })

  it('opening the conversation clears its unread, here and on the device, and a message while it is open stays read', async () => {
    const stop = await watchLive()
    live()[0].deliver(await dm(agent, me.pubkey, 'Need orders.', nowS() + 60))
    await settle()
    expect(useAgentDms.getState().unread[agent.pubkey]).toBeDefined()
    const close = openConversation(agent.pubkey)
    expect(useAgentDms.getState().unread).toEqual({})
    expect(JSON.parse(mem.get(WATCH_KEY(me.pubkey))!).unread).toEqual({})
    await settle()
    live()[0].deliver(await dm(agent, me.pubkey, 'Still here.', nowS() + 61))
    await settle()
    expect(useAgentDms.getState().unread).toEqual({})
    expect(useAgentDms.getState().messages[agent.pubkey].map((m) => m.text)).toEqual(['Need orders.', 'Still here.'])
    // My reply's self-copy coming back does not light it either.
    await sendToAgent(agent.pubkey, 'Hold.')
    close()
    expect(useAgentDms.getState().unread).toEqual({})
    stop()
  })

  it('with a signer that may prompt, opens at most WATCH_CAP wraps a session and does not move the check past what it skipped', async () => {
    promptFree = false
    const stop = await watchLive()
    const checked = JSON.parse(mem.get(WATCH_KEY(me.pubkey))!).checkedAt as number
    const sub = live()[0]
    for (let i = 0; i < WATCH_CAP + 3; i++) sub.deliver(await dm(key(), me.pubkey, `spam ${i}`, nowS() + 60))
    await settle()
    expect(decrypts).toBe(2 * WATCH_CAP)
    // Ten minutes on, a resume reopens the watch and the relay says EOSE
    // again: what the cap skipped is still unread by the watch, so the
    // check stays where it was and the next session asks for it again.
    const realNow = Date.now
    const later = realNow() + 600_000
    Date.now = () => later
    try {
      fake.resume()
      live()[0].eose()
      await settle()
    } finally { Date.now = realNow }
    expect(decrypts).toBe(2 * WATCH_CAP)
    expect(JSON.parse(mem.get(WATCH_KEY(me.pubkey))!).checkedAt).toBe(checked)
    stop()
  })

  it('on its first run on this device, notes what the relays already hold without decrypting any of it', async () => {
    const old = await dm(agent, me.pubkey, 'before you installed this', nowS() - 600)
    const stop = watchAgentDms(me.pubkey)
    await settle()
    live()[0].deliver(old)
    live()[0].eose()
    await settle()
    expect(decrypts).toBe(0)
    expect(JSON.parse(mem.get(WATCH_KEY(me.pubkey))!).watched[old.id]).toBe(old.created_at)
    live()[0].deliver(await dm(agent, me.pubkey, 'new', nowS() + 60))
    await settle()
    expect(decrypts).toBe(2)
    expect(useAgentDms.getState().unread[agent.pubkey].ids).toHaveLength(1)
    stop()
  })

  it('a burst of resume signals reopens the watch once', async () => {
    const stop = await watchLive()
    const before = fake.subs.length
    for (let i = 0; i < 5; i++) fake.resume()
    expect(fake.subs.length).toBe(before + 1)
    expect(live()).toHaveLength(1)
    stop()
  })

  it('a resume with a conversation open reopens its reading once, not forever', async () => {
    const close = openConversation(agent.pubkey)
    await settle()
    const reads = (): Sub[] => fake.subs.filter((s) => !s.closed && s.filter.since === undefined)
    expect(reads()).toHaveLength(1)
    expect(() => fake.resume()).not.toThrow()
    expect(reads()).toHaveLength(1)
    expect(fake.subs.filter((s) => s.filter.since === undefined)).toHaveLength(2)
    close()
  })

  it('unread for someone no longer my agent is not shown', () => {
    expect(unreadOf({ [agent.pubkey]: { ids: ['a'], at: 1 } }, [])).toEqual({ byAgent: {}, total: 0, latest: null })
  })
})
