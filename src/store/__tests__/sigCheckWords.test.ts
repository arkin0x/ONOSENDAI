/**
 * sigCheckWords.test.ts - the saved chain's signature check, met by a
 * finished proof on its way to signing, says so while it runs and then gives
 * back the words that were showing before it (#581, F9).
 *
 * What would go wrong silently: a proof finished while the saved chain was
 * still being checked reads "Checking the relays" (CHECKING_RELAYS_MESSAGE),
 * the check says its own words over them, and when it ended it cleared the
 * panel, so the look at the relays that still followed ran with nothing
 * said, which is the silent wait #581 was about.
 */

import { describe, expect, it, vi } from 'vitest'

const { storage, ctl, posted, relay } = vi.hoisted(() => {
  const m = new Map<string, string>()
  const storage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
  ;(globalThis as { localStorage?: unknown }).localStorage = storage
  return {
    storage,
    ctl: { release: null as null | ((bad: Set<string>) => void) },
    posted: [] as Array<{ id: number; mode: string; from: unknown; to: unknown; prevEventId: string }>,
    relay: { onAsk: null as null | (() => void) },
  }
})

// The saved chain's check answers only when the test says.
vi.mock('../../lib/sigCheck', () => ({ checkSignatures: () => new Promise<Set<string>>((resolve) => { ctl.release = resolve }) }))
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: (m: (typeof posted)[number]) => { posted.push(m) }, cancelProof: () => {} }))
vi.mock('../../lib/chains', async (orig) => ({
  ...(await orig() as object),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => { relay.onAsk?.(); return [] }),
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { hopTemplate, spawnTemplate, type NostrEvent } from '../../lib/events'
import { provedFor } from '../fixtures/provedHop'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const home = coordToXyz(hexToCoord(pk))
const sign = (t: Parameters<typeof finalizeEvent>[0]): NostrEvent => JSON.parse(JSON.stringify(finalizeEvent(t, sk))) as NostrEvent

describe('the signature check a finished proof waits on', () => {
  it('says so while it runs, then gives back the relays\' words for the look that follows', async () => {
    const spawn = sign(spawnTemplate(pk, 1_000))
    const at = { x: home.x + 1n, y: home.y, z: home.z }
    const hop = sign(hopTemplate({ createdAt: 1_001, genesisId: spawn.id, previousId: spawn.id, prevCoordHex: pk, to: at, plane: home.plane, proofHash: '0'.repeat(64), mn: '0'.repeat(16), mp: '00' }))
    storage.setItem('onosendai:nsec', nip19.nsecEncode(sk))
    storage.setItem(`onosendai:chain:${pk}`, JSON.stringify({ version: 2, events: [spawn, hop], published: [spawn.id, hop.id], stats: {} }))
    const { useCyberspace, CHECKING_RELAYS_MESSAGE, SIG_CHECK_MESSAGE } = await import('../useCyberspace')
    const S = useCyberspace.getState
    expect(ctl.release).not.toBeNull()

    // A route step starts its proof at once; only signing waits on the check.
    const to = { ...at, x: at.x + 1n }
    useCyberspace.setState({
      selfCheck: { pubkey: pk, status: 'none' },
      plan: {
        status: 'paused', target: to, done: 0, message: null, awaiting: null, startedAt: 0, requote: false,
        step: { kind: 'hop', source: 'local', from: S().position, to, maxHeight: 1 },
        ceilings: { hop: 17, sidestep: 24 }, summary: { steps: 1, hops: 1, sidesteps: 0, cloudSteps: 0, capped: false },
      } as never,
    })
    S().resumePlan()
    expect(posted).toHaveLength(1)
    const req = posted[0]

    let atRelays: string | null | undefined
    relay.onAsk = () => { atRelays = S().proof.message }
    const finishing = S().applyProofMessage({ type: 'done', id: req.id, mode: 'hop', elapsedMs: 5, ...provedFor(req, S().events), terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1, prevEventId: req.prevEventId })
    await vi.waitFor(() => expect(S().proof.message).toBe(SIG_CHECK_MESSAGE))
    expect(atRelays).toBeUndefined()

    ctl.release!(new Set())
    await finishing
    expect(atRelays).toBe(CHECKING_RELAYS_MESSAGE)
    expect(S().events).toHaveLength(3)
  })
})
