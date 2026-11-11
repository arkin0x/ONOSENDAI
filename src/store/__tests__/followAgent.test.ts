/**
 * followAgent.test.ts: ACTIVATE (arkinox, 2026-11-11, D5), on fake relays and
 * a fake signer only; nothing is published anywhere. The pasted npub is
 * trimmed and checked; the newest kind 3 is edited with every tag and the
 * content kept; a new list is made only when every relay that counts
 * answered "none"; and a fetch that fell short publishes nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../useCyberspace'
import { generateSecretKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { localSigner } from '../../lib/signers'
import { GENERAL_RELAYS } from '../../lib/contacts'
import { DEFAULT_RELAY } from '../useRelays'
import type { NostrEvent } from '../../lib/events'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { ACTIVATE_WORDS, activateAgent, checkAgentKey, followTemplate, setFollowDeps, type FollowDeps } from '../followAgent'

const me = localSigner(generateSecretKey())
const agent = localSigner(generateSecretKey())
const other = 'b'.repeat(64)
const agentNpub = nip19.npubEncode(agent.pubkey)

let published: NostrEvent[]
let saved: FollowDeps

/** Each general relay (and the canonical one) answering with `events`, or as `outcome` says. */
function answers(events: NostrEvent[], silent: string[] = []): RelayAnswer[] {
  return [...GENERAL_RELAYS, DEFAULT_RELAY].map((url) => silent.includes(url)
    ? { url, outcome: 'unreachable', reason: 'no answer in time', events: [] }
    : { url, outcome: 'answered', events })
}

function relaysSay(list: RelayAnswer[] | Error): void {
  setFollowDeps({
    fetch: async () => { if (list instanceof Error) throw list; return { answers: list, writeRelays: [] } },
    publish: async (ev) => { published.push(ev); return { ok: true, accepted: ['wss://fake'] } },
    sign: (t) => me.signEvent(t),
    self: () => me.pubkey,
    now: () => 2_000_000_000,
  })
}

async function existingList(): Promise<NostrEvent> {
  return me.signEvent({ kind: 3, created_at: 1_900_000_000, tags: [['p', other, 'wss://r.example', 'bob'], ['t', 'kept'], ['client', 'Elsewhere']], content: '{"wss://old.example":{"read":true,"write":true}}' })
}

beforeEach(() => { published = []; saved = setFollowDeps(null) })
afterEach(() => { setFollowDeps(saved) })

describe('checking the pasted npub', () => {
  it('trims whitespace and takes an npub or 64 hex', () => {
    expect(checkAgentKey(`  ${agentNpub}\n`, me.pubkey)).toEqual({ pubkey: agent.pubkey })
    expect(checkAgentKey(` ${agent.pubkey.toUpperCase()} `, me.pubkey)).toEqual({ pubkey: agent.pubkey })
  })

  it('refuses empty, invalid, your own key and one you already follow, in plain words', () => {
    expect(checkAgentKey('   ', me.pubkey)).toEqual({ error: ACTIVATE_WORDS.empty })
    expect(checkAgentKey('npub1nope', me.pubkey)).toEqual({ error: ACTIVATE_WORDS.invalid })
    expect(checkAgentKey('nsec1abc', me.pubkey)).toEqual({ error: ACTIVATE_WORDS.invalid })
    expect(checkAgentKey(nip19.npubEncode(me.pubkey), me.pubkey)).toEqual({ error: ACTIVATE_WORDS.self })
    expect(checkAgentKey(agentNpub, me.pubkey, [other, agent.pubkey])).toEqual({ error: ACTIVATE_WORDS.already })
    for (const w of Object.values(ACTIVATE_WORDS)) expect(w).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('ACTIVATE', () => {
  it('appends to the newest list, keeping every tag and the content', async () => {
    const prev = await existingList()
    const older = await me.signEvent({ kind: 3, created_at: 1_800_000_000, tags: [], content: '' })
    relaysSay(answers([older, prev]))
    expect(await activateAgent(` ${agentNpub} `)).toEqual({ ok: true, pubkey: agent.pubkey })
    expect(published).toHaveLength(1)
    const [ev] = published
    expect(ev.kind).toBe(3)
    expect(ev.pubkey).toBe(me.pubkey)
    expect(ev.content).toBe(prev.content)
    expect(ev.tags).toEqual([...prev.tags, ['p', agent.pubkey]])
    expect(ev.created_at).toBeGreaterThan(prev.created_at)
  })

  it('a list dated in the future still gets a newer one', () => {
    const t = followTemplate({ kind: 3, created_at: 3_000_000_000, tags: [], content: '', id: 'x', pubkey: me.pubkey, sig: '' }, agent.pubkey, 2_000_000_000)
    expect(t.created_at).toBe(3_000_000_001)
  })

  it('creates a new list when every relay answered that there is none', async () => {
    relaysSay(answers([]))
    expect((await activateAgent(agentNpub)).ok).toBe(true)
    expect(published).toHaveLength(1)
    expect(published[0].tags.filter((t) => t[0] === 'p')).toEqual([['p', agent.pubkey]])
    expect(published[0].content).toBe('')
  })

  it('refuses, and publishes nothing, when the fetch failed', async () => {
    relaysSay(new Error('socket closed'))
    expect(await activateAgent(agentNpub)).toEqual({ ok: false, error: ACTIVATE_WORDS.unread })
    relaysSay(answers([], [...GENERAL_RELAYS, DEFAULT_RELAY]))
    expect(await activateAgent(agentNpub)).toEqual({ ok: false, error: ACTIVATE_WORDS.unread })
    expect(published).toEqual([])
  })

  it('never creates a list when a relay that holds lists was silent: "none" from some is not "none"', async () => {
    relaysSay(answers([], [GENERAL_RELAYS[0]]))
    expect(await activateAgent(agentNpub)).toEqual({ ok: false, error: ACTIVATE_WORDS.unread })
    // The canonical relay alone answering proves nothing.
    relaysSay(answers([], [...GENERAL_RELAYS]))
    expect(await activateAgent(agentNpub)).toEqual({ ok: false, error: ACTIVATE_WORDS.unread })
    expect(published).toEqual([])
  })

  it('refuses an agent the newest list already follows, and publishes nothing', async () => {
    const prev = await me.signEvent({ kind: 3, created_at: 1_900_000_000, tags: [['p', agent.pubkey]], content: '' })
    relaysSay(answers([prev]))
    expect(await activateAgent(agentNpub)).toEqual({ ok: false, error: ACTIVATE_WORDS.already })
    expect(published).toEqual([])
  })

  it('a refused publish says why', async () => {
    setFollowDeps({ fetch: async () => ({ answers: answers([]), writeRelays: [] }), sign: (t) => me.signEvent(t), self: () => me.pubkey, now: () => 2_000_000_000, publish: vi.fn(async () => ({ ok: false as const, reason: 'blocked: no' })) })
    expect(await activateAgent(agentNpub)).toEqual({ ok: false, error: 'Not saved: blocked: no' })
  })
})
