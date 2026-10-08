/**
 * branchChain.test.ts - a device's unpublished moves meet another device's
 * published moves from the same point: nothing is folded, nothing is sent,
 * and the person's answer does what it says.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { sent, relayHas } = vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => { m.clear() },
  }
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    ;(globalThis as { window?: unknown }).window = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) }
  }
  return { sent: [] as string[], relayHas: { events: [] as unknown[], down: false } }
})

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publish: (e: { id: string }) => { sent.push(e.id); return Promise.resolve({ ok: true as const }) },
}))
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: () => Promise.resolve(relayHas.events),
  confirmChainEvents: () => Promise.resolve(relayHas.events),
  askChainEvents: () => Promise.resolve([{ url: 'wss://cyberspace.nostr1.com', outcome: relayHas.down ? 'unreachable' as const : 'answered' as const, reason: 'down', events: relayHas.down ? [] : relayHas.events }]),
}))

import { ACTION_KIND, type NostrEvent } from '../../lib/events'
import { startPublisher } from '../../lib/publisher'
import { useCyberspace } from '../useCyberspace'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = useCyberspace.getState
const hex = (n: number): string => n.toString(16).padStart(64, '0')

function hop(id: number, prev: string, at: number): NostrEvent {
  const me = S().identity.pubkey
  const genesis = S().genesisId
  return {
    id: hex(id), pubkey: me, created_at: at, kind: ACTION_KIND, content: '', sig: '0'.repeat(128),
    tags: [['A', 'hop'], ['C', hex(0xaa + id)], ['c', me], ['S', '0-0-0'], ['e', genesis, '', 'genesis'], ['e', prev, '', 'previous'], ['proof', hex(0xbeef)]],
  }
}

const until = async (fn: () => boolean): Promise<void> => {
  for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 2)) }
}
const idle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

let spawn: NostrEvent
let h1: NostrEvent

/** Spawn and h1 published; `mine` unpublished on top, the way a LOCAL stretch leaves it. */
function setUp(mine: NostrEvent[]): void {
  const events = [spawn, h1, ...mine]
  const published: Record<string, 'ok' | 'queued'> = { [spawn.id]: 'ok', [h1.id]: 'ok' }
  for (const e of mine) published[e.id] = 'queued'
  useCyberspace.setState({ events, published, prevEventId: events[events.length - 1].id, chainConflict: null, held: false })
}

describe('unpublished moves against another device\'s published ones', () => {
  beforeAll(async () => {
    await placeSpawn()
    spawn = S().events[0]
    h1 = hop(0x10, spawn.id, spawn.created_at + 10)
    startPublisher()
  })
  beforeEach(async () => {
    useCyberspace.setState({ live: false })
    await idle()
    sent.length = 0
    relayHas.events = []
    relayHas.down = false
  })

  it('raises the prompt instead of folding, and keeps the chain as it was', () => {
    const m1 = hop(0x20, h1.id, spawn.created_at + 20)
    setUp([m1])
    const r1 = hop(0x30, h1.id, spawn.created_at + 25)
    S().adoptChain([r1])
    expect(S().chainConflict).toMatchObject({ kind: 'branch', forkId: h1.id })
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, h1.id, m1.id])
  })

  it('takes the relays\' version on that answer and drops the unpublished moves', () => {
    const m1 = hop(0x20, h1.id, spawn.created_at + 20)
    setUp([m1, hop(0x21, m1.id, spawn.created_at + 21)])
    const r1 = hop(0x30, h1.id, spawn.created_at + 25)
    S().adoptChain([spawn, h1, r1])
    S().resolveBranchConflict('relay')
    expect(S().chainConflict).toBeNull()
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, h1.id, r1.id])
    expect(S().published[r1.id]).toBe('ok')
    expect(S().prevEventId).toBe(r1.id)
  })

  it('never publishes this device\'s side: a fork ends the whole chain (2026-10-08 ruling), so "mine" is refused and the choice stays', () => {
    const m1 = hop(0x22, h1.id, spawn.created_at + 20)
    setUp([m1])
    const r1 = hop(0x32, h1.id, spawn.created_at + 25)
    S().adoptChain([r1])
    const before = S().publishRequest
    S().resolveBranchConflict('mine')
    expect(S().chainConflict?.kind).toBe('branch')
    expect(S().publishRequest).toBe(before)
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, h1.id, m1.id])
    expect(S().published[m1.id]).not.toBe('ok')
  })

  it('sends nothing while LIVE when the look before a backlog finds the fork', async () => {
    const m1 = hop(0x23, h1.id, spawn.created_at + 20)
    const m2 = hop(0x24, m1.id, spawn.created_at + 21)
    setUp([m1])
    relayHas.events = [spawn, h1, hop(0x33, h1.id, spawn.created_at + 25)]
    useCyberspace.setState({ live: true })
    await idle()
    // An action taken while LIVE opens the gate with two events waiting.
    useCyberspace.setState({ events: [...S().events, m2], prevEventId: m2.id, published: { ...S().published, [m2.id]: 'queued' } })
    await until(() => S().chainConflict !== null)
    await idle()
    expect(S().chainConflict?.kind).toBe('branch')
    expect(sent).toEqual([])
  })

  it('sends the backlog when the look finds nothing new', async () => {
    const m1 = hop(0x25, h1.id, spawn.created_at + 20)
    const m2 = hop(0x26, m1.id, spawn.created_at + 21)
    setUp([m1])
    relayHas.events = [spawn, h1]
    useCyberspace.setState({ live: true })
    await idle()
    useCyberspace.setState({ events: [...S().events, m2], prevEventId: m2.id, published: { ...S().published, [m2.id]: 'queued' } })
    await until(() => sent.length === 2)
    expect(sent).toEqual([m1.id, m2.id])
  })

  it('sends nothing while the look cannot reach a relay, and finds the fork once it can', async () => {
    const m1 = hop(0x27, h1.id, spawn.created_at + 20)
    const m2 = hop(0x28, m1.id, spawn.created_at + 21)
    setUp([m1])
    relayHas.down = true
    relayHas.events = [spawn, h1, hop(0x34, h1.id, spawn.created_at + 25)]
    useCyberspace.setState({ live: true })
    await idle()
    useCyberspace.setState({ events: [...S().events, m2], prevEventId: m2.id, published: { ...S().published, [m2.id]: 'queued' } })
    await idle()
    // No relay answered the look: nothing went out, and no choice was raised
    // on a look that saw nothing.
    expect(sent).toEqual([])
    expect(S().chainConflict).toBeNull()
    // The relay is back; the next look (the retry, or any reconnect) finds it.
    relayHas.down = false
    S().adoptChain(relayHas.events as NostrEvent[])
    expect(S().chainConflict?.kind).toBe('branch')
    expect(sent).toEqual([])
  })
})
