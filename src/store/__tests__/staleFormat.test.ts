/**
 * staleFormat.test.ts - signed hops that were never sent and are in the old
 * proof format (cutover checklist item 1, lib/chainRulesEpoch.ts).
 *
 * A tab of the build before hop proof version 2 left hops signed and unsent
 * (LOCAL, offline, held, or held by the version gate). The build after loads
 * them and must never publish them: an unlisted version 1 hop published after
 * the census freezes the chain for good. So a page that loads such a chain
 * cuts it back to the event before the first of them; one such hop alone is
 * put back on the cursor to be made again with one COMMIT, anything more is
 * dropped with a notice, and nothing already on the relays is touched. The
 * publisher, the last place one could slip out, never sends one either.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storage, sent } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage: Storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: Storage }).localStorage = storage
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    ;(globalThis as { window?: unknown }).window = { setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) }
  }
  return { storage, sent: [] as string[] }
})

vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn(), cancelProof: vi.fn() }
})
vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []), confirmChainEvents: vi.fn(async () => []), askChainEvents: vi.fn(async () => []) }
})
vi.mock('../../lib/relay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/relay')>()
  return {
    ...actual,
    publish: async (ev: { id: string }) => { sent.push(ev.id); return { ok: true as const, accepted: [actual.CYBERSPACE_RELAY] } },
    publishMany: async () => ({ ok: true as const, accepted: [actual.CYBERSPACE_RELAY] }),
  }
})

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { ACTION_KIND, hopTemplate, positionHex, sectorTags, spawnTemplate, type NostrEvent } from '../../lib/events'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const at = (dx: bigint) => ({ x: home.x ^ dx, y: home.y, z: home.z })
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => ({ ...finalizeEvent(t, sk) }) as NostrEvent
const spawn = sign(spawnTemplate(pk, 1_000))

/** A hop as the build before the cutover signed it: proof alone, no mn, no mp. */
function v1Hop(createdAt: number, previous: NostrEvent, fromHex: string, to: { x: bigint; y: bigint; z: bigint }): NostrEvent {
  return sign({
    kind: ACTION_KIND, created_at: createdAt, content: '',
    tags: [['A', 'hop'], ['e', spawn.id, '', 'genesis'], ['e', previous.id, '', 'previous'], ['c', fromHex], ['C', positionHex(to, home.plane)], ['proof', '1'.repeat(64)], ...sectorTags(to)],
  })
}
const v2Hop = (createdAt: number, previous: NostrEvent, fromHex: string, to: { x: bigint; y: bigint; z: bigint }): NostrEvent =>
  sign(hopTemplate({ createdAt, genesisId: spawn.id, previousId: previous.id, prevCoordHex: fromHex, to, plane: home.plane, proofHash: '2'.repeat(64), mn: '0'.repeat(16), mp: '00' }))

const stale = v1Hop(1_010, spawn, pk, at(4n))
const after = v2Hop(1_020, stale, positionHex(at(4n), home.plane), at(6n))

/** Store a chain for this identity, `published` the ids on the relays, then load the store fresh, as a page load does. */
async function loadWith(events: NostrEvent[], published: string[]) {
  storage.clear()
  storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  storage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events, published, stats: {} }))
  vi.resetModules()
  const store = await import('../useCyberspace')
  return { S: store.useCyberspace.getState, store }
}

describe('unsent hops in the old format, after a reload', () => {
  beforeEach(() => { storage.clear(); sent.length = 0 })

  it('one at the head is taken back and put on the cursor, to be made again with one COMMIT', async () => {
    const { S } = await loadWith([spawn, stale], [spawn.id])
    expect(S().events.map((e) => e.id)).toEqual([spawn.id])
    expect(S().prevEventId).toBe(spawn.id)
    expect(S().position).toEqual({ x: home.x, y: home.y, z: home.z })
    expect(S().cursor).toEqual(at(4n))
    expect(S().proof.message).toContain('COMMIT makes the same hop with the new proof')
    // Saved that way: the next load does not bring it back.
    expect(JSON.parse(storage.getItem(`onosendai:chain:${pk}`)!).events.map((e: NostrEvent) => e.id)).toEqual([spawn.id])
  })

  it('one with more after it: all of them are set aside, none made again', async () => {
    const { S } = await loadWith([spawn, stale, after], [spawn.id])
    expect(S().events.map((e) => e.id)).toEqual([spawn.id])
    expect(S().cursor).toEqual(S().position)
    expect(S().proof.message).toContain('2 actions signed by the previous version')
  })

  it('a version 1 hop already on the relays is left alone: the census decides it', async () => {
    const { S } = await loadWith([spawn, stale], [spawn.id, stale.id])
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, stale.id])
    expect(S().proof.message).toBeNull()
  })

  it('an unsent version 2 hop stays and is sent; an old one folded in later is never sent', async () => {
    const fresh = v2Hop(1_010, spawn, pk, at(4n))
    const { S, store } = await loadWith([spawn, fresh], [spawn.id])
    expect(S().events.map((e) => e.id)).toEqual([spawn.id, fresh.id])
    const pub = await import('../../lib/publisher')
    pub.startPublisher()
    // The release gate opens on an action taken while LIVE; a fresh head does it.
    store.useCyberspace.setState({ live: true })
    store.useCyberspace.setState({ publishRequest: S().publishRequest + 1 })
    // What another tab of the old build saved, folded in unsent.
    const old = v1Hop(1_020, fresh, positionHex(at(4n), home.plane), at(6n))
    store.useCyberspace.setState({ events: [...S().events, old], prevEventId: old.id, published: { ...S().published, [old.id]: 'queued' } })
    await vi.waitFor(() => expect(S().events.map((e) => e.id)).toEqual([spawn.id, fresh.id]))
    // The publisher ran: the version 2 hop went out, the old one never did.
    await vi.waitFor(() => expect(sent).toContain(fresh.id))
    await new Promise((r) => setTimeout(r, 50))
    expect(sent).not.toContain(old.id)
  })
})
