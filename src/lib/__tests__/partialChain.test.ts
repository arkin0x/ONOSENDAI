/**
 * partialChain.test.ts - someone else's chain with a stretch missing on the
 * relays is shown up to the hole, marked partial (second review of #224, N-S1).
 *
 * The chain fetch rejects when a hole cannot be filled (chains.ts
 * ChainGapError), which is right for your own chain: it holds instead of
 * continuing from a head that is not the head. For a chain you are only
 * looking at, the hole may never fill, and showing nothing but an error and
 * whatever arrives live hid every action the relays do have.
 */

import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { spawnTemplate, type NostrEvent } from '../events'
import { hopEvent } from './chainFixtures'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const spawn = finalizeEvent(spawnTemplate(pk, 100), sk) as NostrEvent
const h1 = hopEvent({ pubkey: pk, createdAt: 101, genesisId: spawn.id, previousId: spawn.id, c: pk, to: { x: 7n, y: 0n, z: 0n } })
/** The relays have the spawn and the first hop; a later stretch is missing. */
const gathered = [spawn, h1]

vi.mock('../chains', async (importOriginal) => {
  const real = await importOriginal<typeof import('../chains')>()
  return {
    ...real,
    fetchChainEvents: async () => { throw new real.ChainGapError(gathered) },
    watchAuthor: () => () => {},
  }
})

const { spectate, stopSpectating } = await import('../spectator')
const { startTracker } = await import('../tracker')
const { useCyberspace } = await import('../../store/useCyberspace')

describe('a chain with a hole the relays cannot fill', () => {
  it('spectating shows it up to the hole, marked partial, not as an error', async () => {
    await spectate(pk)
    const s = useCyberspace.getState().spectate!
    expect(s.status).toBe('partial')
    expect(s.actions.map((a) => a.id)).toEqual([spawn.id, h1.id])
    stopSpectating()
  })

  it('a target is placed from it, marked partial', async () => {
    startTracker()
    useCyberspace.getState().addTarget(pk)
    await vi.waitFor(() => expect(useCyberspace.getState().targets[pk].status).toBe('partial'))
    expect(useCyberspace.getState().targets[pk].position).toEqual({ x: 7n, y: 0n, z: 0n })
  })
})
