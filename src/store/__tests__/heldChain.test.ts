/**
 * heldChain.test.ts - no spawn on load, and what a provisional identity's
 * first move does with the self-check's answer.
 *
 * The rule (arkinox, 2026-10-01): switching identity or loading the page
 * never signs a spawn. The first move signs it, and when the relays could
 * not say whether the identity already had a chain, the new chain is HELD on
 * this device until they answer. A held chain that meets a relay chain asks;
 * it never adopts by "newest spawn wins".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { storage } = vi.hoisted(() => {
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
  return { storage }
})

// No Worker under node: the hop's proof request is observed, not run.
vi.mock('../../lib/workers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/workers')>()
  return { ...actual, postProof: vi.fn(), cancelProof: vi.fn() }
})

// No relay: the pre-move head check finds nothing.
vi.mock('../../lib/chains', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/chains')>()
  return { ...actual, fetchChainEvents: vi.fn(async () => []) }
})

import { ACTION_KIND, buildChain, spawnTemplate, type NostrEvent } from '../../lib/events'
import { postProof } from '../../lib/workers'
import { SPAWN, useCyberspace } from '../useCyberspace'

const S = useCyberspace.getState
const hex = (n: number): string => n.toString(16).padStart(64, '0')
const me = (): string => S().identity.pubkey

/** A relay chain for this identity: an old spawn and one hop. */
function relayChain(): NostrEvent[] {
  const spawn: NostrEvent = { ...spawnTemplate(me(), 100), id: hex(0x51), pubkey: me(), sig: '0'.repeat(128) }
  const hop: NostrEvent = {
    id: hex(0x52), pubkey: me(), created_at: 110, kind: ACTION_KIND, content: '', sig: '0'.repeat(128),
    tags: [['A', 'hop'], ['C', hex(0xaa)], ['c', me()], ['S', '0-0-0'], ['e', spawn.id, '', 'genesis'], ['e', spawn.id, '', 'previous'], ['proof', hex(0xbeef)]],
  }
  return [spawn, hop]
}

/** Back to the state a load with nothing saved leaves: unsigned, at the spawn coordinate. */
function provisional(status: 'checking' | 'none' | 'unknown'): void {
  useCyberspace.setState({
    events: [], genesisId: '', prevEventId: '', published: {}, held: false, chainConflict: null,
    position: SPAWN, cursor: { ...SPAWN, x: SPAWN.x ^ 1n }, positionHistory: [SPAWN], plane: S().headPlane,
    anchor: SPAWN, exploreIndex: null, proof: { ...S().proof, status: 'idle', message: null },
    selfCheck: status === 'unknown'
      ? { pubkey: me(), status, cause: { kind: 'offline' } }
      : { pubkey: me(), status },
  })
}

const stored = (): { held?: boolean; events: NostrEvent[]; published: string[] } =>
  JSON.parse(storage.getItem(`onosendai:chain:${me()}`) ?? 'null')

describe('loading with nothing saved', () => {
  it('signs nothing: the identity sits unsigned at its spawn coordinate', () => {
    expect(S().events).toEqual([])
    expect(S().genesisId).toBe('')
    expect(S().position).toEqual(SPAWN)
    expect(S().held).toBe(false)
    expect(S().selfCheck).toEqual({ pubkey: me(), status: 'checking' })
    expect(storage.getItem(`onosendai:chain:${me()}`)).toBeNull()
  })
})

describe('a provisional identity\'s first move', () => {
  beforeEach(() => { vi.mocked(postProof).mockClear() })

  it('holds the new chain when the relays could not say', async () => {
    provisional('unknown')
    await S().commit()
    expect(S().events).toHaveLength(1)
    expect(buildChain(S().events)[0].type).toBe('spawn')
    expect(S().held).toBe(true)
    expect(stored().held).toBe(true)
    // And it still moves: an unreachable relay never stops anyone.
    expect(postProof).toHaveBeenCalledTimes(1)
  })

  it('starts a normal chain when the canonical relay answered none', async () => {
    provisional('none')
    await S().commit()
    expect(S().events).toHaveLength(1)
    expect(S().held).toBe(false)
    expect(stored().held).toBeUndefined()
  })

  it('signs nothing when the relay chain places it while it waits', async () => {
    provisional('checking')
    const moving = S().commit()
    S().applySelfCheck(me(), { status: 'found', events: relayChain() })
    await moving
    expect(S().events.map((e) => e.id)).toEqual(relayChain().map((e) => e.id))
    expect(S().held).toBe(false)
    expect(S().proof.message).toMatch(/already has a chain/)
    expect(postProof).not.toHaveBeenCalled()
  })

  it('signs nothing with nothing lined up', async () => {
    provisional('none')
    useCyberspace.setState({ cursor: SPAWN })
    await S().commit()
    expect(S().events).toEqual([])
  })
})

describe('a held chain', () => {
  async function heldChain(): Promise<string[]> {
    provisional('unknown')
    await S().commit()
    expect(S().held).toBe(true)
    return S().events.map((e) => e.id)
  }

  it('is released silently when the relays answer none', async () => {
    await heldChain()
    S().applySelfCheck(me(), { status: 'none' })
    expect(S().held).toBe(false)
    expect(S().chainConflict).toBeNull()
    expect(stored().held).toBeUndefined()
  })

  it('raises the prompt on a relay chain and never adopts it', async () => {
    const local = await heldChain()
    S().applySelfCheck(me(), { status: 'found', events: relayChain() })
    expect(S().events.map((e) => e.id)).toEqual(local)
    expect(S().chainConflict?.relayEvents).toHaveLength(2)
    // The live subscription delivering more of it only grows the prompt.
    S().adoptChain(relayChain())
    expect(S().events.map((e) => e.id)).toEqual(local)
    // A "none" that comes after does not lift a hold that is waiting on a choice.
    S().applySelfCheck(me(), { status: 'none' })
    expect(S().held).toBe(true)
    // And no move is taken while the question is open.
    useCyberspace.setState({ cursor: { ...S().position, x: S().position.x ^ 1n } })
    vi.mocked(postProof).mockClear()
    await S().commit()
    expect(postProof).not.toHaveBeenCalled()
  })

  it('keeps the relay chain on that answer: the local one is gone, you stand at its head', async () => {
    await heldChain()
    S().applySelfCheck(me(), { status: 'found', events: relayChain() })
    S().resolveHeldConflict('relay')
    const ids = relayChain().map((e) => e.id)
    expect(S().events.map((e) => e.id)).toEqual(ids)
    expect(S().prevEventId).toBe(ids[1])
    expect(S().held).toBe(false)
    expect(S().chainConflict).toBeNull()
    expect(S().cursor).toEqual(S().position)
    expect(Object.values(S().published)).toEqual(['ok', 'ok'])
    expect(stored().events.map((e) => e.id)).toEqual(ids)
    expect(stored().held).toBeUndefined()
  })

  it('keeps the local chain on that answer: released, and asked to publish now', async () => {
    const local = await heldChain()
    S().applySelfCheck(me(), { status: 'found', events: relayChain() })
    const before = S().publishRequest
    S().resolveHeldConflict('local')
    expect(S().events.map((e) => e.id)).toEqual(local)
    expect(S().held).toBe(false)
    expect(S().chainConflict).toBeNull()
    expect(S().publishRequest).toBe(before + 1)
    expect(stored().held).toBeUndefined()
  })
})
