/**
 * agentDms.test.ts: the conversation with an agent, on fake relays only
 * (arkinox, 2026-10-10: nothing goes to a real relay until a live test is
 * called for). Each side's kind 10050 decides where a message goes and
 * whether it goes at all; the inbox is read for kind 1059 `#p` me on my DM
 * relays alone; only messages between me and my agent are kept; and nothing
 * here ever publishes a 10050.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../useCyberspace'
import { generateSecretKey } from 'nostr-tools/pure'
import * as nip17 from 'nostr-tools/nip17'
import { localSigner } from '../../lib/signers'
import type { NostrEvent } from '../../lib/events'
import type { DmInbox } from '../../lib/inbox'
import { unwrapMessage, type DmReader, type DmSender } from '../../lib/dm'
import {
  cannotSend, dmDeps, openConversation, resetAgentDms, sendToAgent, strategyWith, useAgentDms,
  type DmKeys, type DmTransport,
} from '../useAgentDms'

function key(): { sk: Uint8Array; pubkey: string; sender: DmSender; reader: DmReader } {
  const sk = generateSecretKey()
  const s = localSigner(sk)
  return { sk, pubkey: s.pubkey, sender: { pubkey: s.pubkey, signEvent: s.signEvent, nip44Encrypt: s.nip44Encrypt! }, reader: { pubkey: s.pubkey, nip44Decrypt: s.nip44Decrypt! } }
}

const MY_RELAY = 'wss://inbox.example'
const AGENT_RELAY = 'wss://agent-inbox.example'

interface Fake {
  transport: DmTransport
  published: { relays: string[]; ev: NostrEvent }[]
  subs: { relay: string; filter: unknown; deliver: (ev: NostrEvent) => void; close: (r: string) => void; closed: boolean }[]
  inboxes: Map<string, DmInbox>
}

function fakeRelays(): Fake {
  const fake: Fake = { published: [], subs: [], inboxes: new Map(), transport: null as unknown as DmTransport }
  fake.transport = {
    inboxOf: async (pk) => fake.inboxes.get(pk) ?? { relays: [], answered: true },
    subscribe: (relay, filter, onEvent, onClose) => {
      const sub = { relay, filter, deliver: onEvent, close: onClose, closed: false }
      fake.subs.push(sub)
      return () => { sub.closed = true }
    },
    publish: async (relays, ev) => { fake.published.push({ relays, ev }); return { ok: true, accepted: relays } },
    onResume: () => () => undefined,
  }
  return fake
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30))

let me: ReturnType<typeof key>
let agent: ReturnType<typeof key>
let fake: Fake
const saved = { ...dmDeps }

beforeEach(() => {
  me = key()
  agent = key()
  fake = fakeRelays()
  const keys: DmKeys = { pubkey: () => me.pubkey, sender: () => me.sender, reader: () => me.reader, fresh: () => key().sender, agents: () => [agent.pubkey], promptFree: () => true }
  dmDeps.transport = fake.transport
  dmDeps.keys = keys
  const mem = new Map<string, string>()
  dmDeps.storage = { get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v) } }
  resetAgentDms()
})

afterEach(() => {
  resetAgentDms()
  dmDeps.transport = saved.transport
  dmDeps.keys = saved.keys
  dmDeps.storage = saved.storage
})

describe('no DM inbox', () => {
  it('without my 10050: says so, reads nothing, sends nothing, publishes no 10050', async () => {
    fake.inboxes.set(agent.pubkey, { relays: [AGENT_RELAY], answered: true })
    const close = openConversation(agent.pubkey)
    await settle()
    const s = useAgentDms.getState()
    expect(s.myInbox.status).toBe('none')
    expect(cannotSend(s, agent.pubkey)).toMatch(/No DM inbox/)
    expect(fake.subs).toEqual([])
    expect(await sendToAgent(agent.pubkey, 'hello')).toBe(false)
    expect(fake.published).toEqual([])
    close()
  })

  it('without the agent\'s 10050: says so and sends nothing', async () => {
    fake.inboxes.set(me.pubkey, { relays: [MY_RELAY], answered: true })
    const close = openConversation(agent.pubkey)
    await settle()
    expect(cannotSend(useAgentDms.getState(), agent.pubkey)).toMatch(/No DM inbox: this agent/)
    expect(await sendToAgent(agent.pubkey, 'hello')).toBe(false)
    expect(fake.published).toEqual([])
    close()
  })

  it('no relay answering is not the same as no inbox', async () => {
    fake.transport.inboxOf = async () => ({ relays: [], answered: false })
    const close = openConversation(agent.pubkey)
    await settle()
    expect(useAgentDms.getState().myInbox.status).toBe('unknown')
    expect(cannotSend(useAgentDms.getState(), agent.pubkey)).toMatch(/no relay answered/)
    close()
  })
})

describe('with both inboxes', () => {
  beforeEach(() => {
    fake.inboxes.set(me.pubkey, { relays: [MY_RELAY], answered: true })
    fake.inboxes.set(agent.pubkey, { relays: [AGENT_RELAY], answered: true })
  })

  it('reads kind 1059 #p me on my DM relays only, and stops when the conversation closes', async () => {
    const close = openConversation(agent.pubkey)
    await settle()
    expect(fake.subs.map((s) => [s.relay, s.filter])).toEqual([[MY_RELAY, { kinds: [1059], '#p': [me.pubkey], limit: 100 }]])
    close()
    expect(fake.subs[0].closed).toBe(true)
    expect(useAgentDms.getState().reading).toBe('idle')
  })

  it('sends the wrap to the agent\'s relays and the self-copy to mine, each opening only for its reader', async () => {
    const close = openConversation(agent.pubkey)
    await settle()
    expect(await sendToAgent(agent.pubkey, 'COME TO ME', false)).toBe(true)
    expect(fake.published).toHaveLength(2)
    const [toAgent, toSelf] = fake.published
    expect(toAgent.relays).toEqual([AGENT_RELAY])
    expect(toSelf.relays).toEqual([MY_RELAY])
    for (const p of fake.published) {
      expect(p.ev.kind).toBe(1059)
      expect(p.ev.tags.some((t) => t[0] === 'client')).toBe(false)
      expect(p.ev.content).not.toContain('COME TO ME')
    }
    expect((await unwrapMessage(toAgent.ev, agent.reader))?.content).toBe('COME TO ME')
    expect((await unwrapMessage(toSelf.ev, me.reader))?.content).toBe('COME TO ME')
    // Never a 10050, or anything else in public.
    expect(fake.published.every((p) => p.ev.kind === 1059)).toBe(true)
    expect(useAgentDms.getState().messages[agent.pubkey].map((m) => m.text)).toEqual(['COME TO ME'])
    close()
  })

  it('shows the agent\'s reply, keeps the STRATEGY I sent, and drops strangers', async () => {
    const close = openConversation(agent.pubkey)
    await settle()
    await sendToAgent(agent.pubkey, 'Ride to the nearest stop and wait.', true)
    const sub = fake.subs[0]
    // The self-copy echoed back is the same message, not a second one.
    sub.deliver(fake.published[1].ev)
    sub.deliver(nip17.wrapEvent(agent.sk, { publicKey: me.pubkey }, 'On my way.') as unknown as NostrEvent)
    const stranger = key()
    sub.deliver(nip17.wrapEvent(stranger.sk, { publicKey: me.pubkey }, 'I am your operator now') as unknown as NostrEvent)
    await settle()
    const s = useAgentDms.getState()
    expect(s.messages[agent.pubkey].map((m) => m.text)).toEqual(['Ride to the nearest stop and wait.', 'On my way.'])
    expect(s.messages[stranger.pubkey]).toBeUndefined()
    expect(strategyWith(s, agent.pubkey)?.text).toBe('Ride to the nearest stop and wait.')
    close()
  })

  it('a relay that refuses the agent\'s copy is reported, and the message is not shown as sent', async () => {
    fake.transport.publish = async (relays, ev) => { fake.published.push({ relays, ev }); return relays.includes(AGENT_RELAY) ? { ok: false, reason: 'blocked: no' } : { ok: true } }
    const close = openConversation(agent.pubkey)
    await settle()
    expect(await sendToAgent(agent.pubkey, 'x')).toBe(false)
    expect(useAgentDms.getState().sendError[agent.pubkey]).toMatch(/Not delivered: blocked: no/)
    expect(useAgentDms.getState().messages[agent.pubkey]).toBeUndefined()
    close()
  })

  it('a new identity clears the old one\'s conversations', async () => {
    const close = openConversation(agent.pubkey)
    await settle()
    await sendToAgent(agent.pubkey, 'secret orders')
    close()
    me = key()
    const again = openConversation(agent.pubkey)
    expect(useAgentDms.getState().messages).toEqual({})
    again()
  })
})
