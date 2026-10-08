/**
 * backgroundSigCheck.test.ts - the saved chain is drawn at once, its
 * signatures are checked off the main thread, and every chain action waits
 * for that check.
 *
 * What would go wrong silently: the first draw held for seconds while
 * thousands of signatures are checked on the main thread; a move signed onto
 * a stored event nobody had checked yet; a move that waits with nothing
 * said, or is dropped; and a forged stored event that stays on the chain
 * because the check ran after the chain was in use.
 */

import { describe, expect, it, vi } from 'vitest'

const { storage, checked, posted } = vi.hoisted(() => {
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
  return { storage, checked: { pubkeys: [] as string[] }, posted: [] as Array<{ id: number }> }
})

vi.mock('nostr-tools/pure', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nostr-tools/pure')>()
  return {
    ...actual,
    verifyEvent: (e: Parameters<typeof actual.verifyEvent>[0]) => {
      checked.pubkeys.push(e.pubkey)
      return actual.verifyEvent(e)
    },
  }
})
vi.mock('../../lib/workers', async (orig) => ({
  ...(await orig() as object),
  postProof: (m: { id: number }) => { posted.push(m) },
  cancelProof: () => {},
}))
vi.mock('../../lib/chains', async (orig) => ({
  ...(await orig() as object),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, positionHex, spawnTemplate, type NostrEvent } from '../../lib/events'
import { moveDirection } from '../../lib/moves'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const step = (dx: bigint): { x: bigint; y: bigint; z: bigint } => ({ x: home.x + dx, y: home.y, z: home.z })
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => JSON.parse(JSON.stringify(finalizeEvent(t, sk))) as NostrEvent

/** A saved chain: a spawn and `hops` hops. */
function chainOf(hops: number): NostrEvent[] {
  const spawn = sign(spawnTemplate(pk, 1_000))
  const out = [spawn]
  for (let n = 1; n <= hops; n++) {
    out.push(sign(hopTemplate({ createdAt: 1_000 + n, genesisId: spawn.id, previousId: out[n - 1].id, prevCoordHex: n === 1 ? pk : positionHex(step(BigInt(n - 1)), home.plane), to: step(BigInt(n)), plane: home.plane, proofHash: '0'.repeat(64) })))
  }
  return out
}

const mine = (): number => checked.pubkeys.filter((p) => p === pk).length

/** A page load with `events` saved for this identity. */
async function boot(events: NostrEvent[]): Promise<typeof import('../useCyberspace')> {
  storage.clear()
  storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
  storage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events, published: events.map((e) => e.id), stats: {} }))
  checked.pubkeys = []
  posted.length = 0
  vi.resetModules()
  return import('../useCyberspace')
}

describe('the saved chain is drawn first, and its signatures checked off the boot path', () => {
  it('draws every saved event before checking any signature, then checks each once', async () => {
    const stored = chainOf(60)
    const { useCyberspace } = await boot(stored)
    const S = useCyberspace.getState
    expect(S().events).toHaveLength(stored.length)
    expect(S().prevEventId).toBe(stored[stored.length - 1].id)
    expect(mine()).toBe(0)
    await vi.waitFor(() => expect(mine()).toBe(stored.length))
    expect(performance.getEntriesByName('onosendai:chain-loaded').length).toBeGreaterThan(0)
    await vi.waitFor(() => expect(performance.getEntriesByName('onosendai:chain-verified').length).toBeGreaterThan(0))
  })

  it('a move pressed during the check waits for it, says so, and then goes', async () => {
    const stored = chainOf(60)
    const { useCyberspace, SIG_CHECK_MESSAGE } = await boot(stored)
    const S = useCyberspace.getState
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const committing = S().commit()
    expect(S().proof.message).toBe(SIG_CHECK_MESSAGE)
    expect(posted).toEqual([])
    await committing
    expect(mine()).toBe(stored.length)
    expect(posted).toHaveLength(1)
    expect(S().proof.message).not.toBe(SIG_CHECK_MESSAGE)
  })

  it('a forged saved event: drawn, then cut where it fails once the check finds it, said, and saved', async () => {
    const stored = chainOf(4)
    const forged = { ...stored[2], sig: stored[2].sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) }
    const { useCyberspace } = await boot([stored[0], stored[1], forged, stored[3], stored[4]])
    const S = useCyberspace.getState
    expect(S().events).toHaveLength(5)
    await vi.waitFor(() => expect(S().events.map((e) => e.id)).toEqual([stored[0].id, stored[1].id]))
    expect(S().prevEventId).toBe(stored[1].id)
    expect(S().proof.message).toBe('One saved action failed the signature check and was set aside. Your chain continues from the action before it.')
    const saved = JSON.parse(storage.getItem(`onosendai:chain:${pk}`) ?? 'null') as { events: NostrEvent[] }
    expect(saved.events.map((e) => e.id)).toEqual([stored[0].id, stored[1].id])
  })

  it('a move waiting when the check cuts the chain is refused with the cut\'s words, and nothing is computed', async () => {
    const stored = chainOf(4)
    const forged = { ...stored[4], sig: stored[4].sig.replace(/^./, (c) => (c === '0' ? '1' : '0')) }
    const { useCyberspace } = await boot([...stored.slice(0, 4), forged])
    const S = useCyberspace.getState
    S().moveCursor(moveDirection(S().axes(), 'right'))
    await S().commit()
    expect(posted).toEqual([])
    expect(S().events).toHaveLength(4)
    expect(S().proof.message).toMatch(/^One saved action failed the signature check/)
  })
})
