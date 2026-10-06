/**
 * heldConflictFetch.test.ts - a chain held on this device meets the relay
 * chain whole (regression, second review of #224, N-B1).
 *
 * A held chain's spawn is newer than any spawn on the relays: it was signed
 * before they could answer. When the chain fetch chose which chain to ask
 * for from local and relay events together, it chose the held chain's own
 * spawn and never asked for the relay chain. The held-chain prompt then
 * showed the relay chain as a bare spawn and offered to keep the local
 * chain, which publishes the newer spawn and replaces the real chain for
 * every reader: exactly what holding exists to prevent.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import type { Filter } from 'nostr-tools/filter'
import type { NostrEvent } from '../../lib/events'
import type { RelayAnswer } from '../../lib/relayOutcome'

const CANONICAL = 'wss://cyberspace.nostr1.com'
/** What the one relay holds; it answers three events at a time, newest first. */
let held: NostrEvent[] = []
function answer(f: Filter): NostrEvent[] {
  return held
    .filter((e) => !f.authors || f.authors.includes(e.pubkey))
    .filter((e) => !f.ids || f.ids.includes(e.id))
    .filter((e) => !f['#A'] || e.tags.some((t) => t[0] === 'A' && f['#A']!.includes(t[1])))
    .filter((e) => !f['#e'] || e.tags.some((t) => t[0] === 'e' && f['#e']!.includes(t[1])))
    .filter((e) => f.until === undefined || e.created_at <= f.until)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 3)
}

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  query: async (f: Filter) => answer(f),
  queryEach: async (f: Filter): Promise<RelayAnswer[]> => [{ url: CANONICAL, outcome: 'answered', events: answer(f) }],
  subscribe: () => () => {},
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { spawnTemplate } from '../../lib/events'
import { askChainEvents } from '../../lib/chains'
import { decideSelfCheck, summarizeChain } from '../../lib/chainHold'
import { hopEvent } from '../../lib/__tests__/chainFixtures'
import { useCyberspace } from '../useCyberspace'

const sk = generateSecretKey()
const pk = getPublicKey(sk)
const S = () => useCyberspace.getState()

/** A spawn signed at `at`, then `n` hops after it. */
function chainFrom(at: number, n: number): NostrEvent[] {
  const out: NostrEvent[] = [finalizeEvent(spawnTemplate(pk, at), sk) as NostrEvent]
  for (let i = 1; i <= n; i++) {
    out.push(hopEvent({ pubkey: pk, createdAt: at + i, genesisId: out[0].id, previousId: out[out.length - 1].id, c: pk, to: { x: BigInt(i), y: 0n, z: 0n } }))
  }
  return out
}

describe('a held chain checked against the relays', () => {
  const relayChain = chainFrom(1_000, 5)
  const localChain = chainFrom(5_000, 1)

  beforeEach(() => {
    held = relayChain
    useCyberspace.setState({
      identity: { ...S().identity, pubkey: pk },
      events: localChain, genesisId: localChain[0].id, prevEventId: localChain[1].id, published: {},
      held: true, chainConflict: null, selfCheck: { pubkey: pk, status: 'checking' },
      proof: { ...S().proof, status: 'idle' },
    })
  })

  it("asks for the relay chain under the relays' own newest spawn, and the prompt shows all of it", async () => {
    const answers = await askChainEvents(pk, S().genesisId, S().events)
    const verdict = decideSelfCheck(answers, CANONICAL, true)
    expect(verdict.status).toBe('found')
    S().applySelfCheck(pk, verdict)
    const conflict = S().chainConflict
    expect(conflict?.kind).toBe('held')
    // What the prompt draws (ChainConflict.tsx summarizeChain): the real
    // chain, six actions with its head, not a bare spawn.
    const relay = summarizeChain(conflict!.relayEvents)!
    expect(relay.actions).toBe(6)
    expect(relay.headId).toBe(relayChain[5].id)
    // The held chain is untouched and still held.
    expect(S().held).toBe(true)
    expect(S().events).toEqual(localChain)
  })
})
