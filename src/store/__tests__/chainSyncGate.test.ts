/**
 * chainSyncGate.test.ts - a move pressed while the page's first look at the
 * relays is out waits for it, then confirms the head for itself as always;
 * it never signs on the head this device had before the look (owner,
 * 2026-11-21: "I'm afraid to move because I dont want to fork my chain").
 * And LIVE or LOCAL belongs to each identity: a new key is LIVE, never LOCAL
 * because the last identity was (his phone, LOCAL after LOG OUT and PAIR
 * AGAIN, kept about 460 moves to itself). And the CHAIN chip says each state.
 *
 * What would go wrong silently: a press racing the load's look and signing
 * onto the stale head; a press that waits forever, or with no word said; a
 * key that inherits LOCAL; the chip silent about moves kept on the device.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

/** Every key read from storage, in order. */
const reads = vi.hoisted(() => ({ keys: [] as string[] }))
vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => { reads.keys.push(k); return mem.get(k) ?? null },
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})

const posted: Array<{ id: number; mode: string }> = []
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

/** What the canonical relay answers each confirmation, in turn: events, or null for no answer. Empty when out: "nothing new". */
const relay = vi.hoisted(() => ({ answers: [] as Array<unknown[] | null>, asked: 0, onAsk: null as (() => void) | null, args: [] as Array<{ since?: number; reconnect?: boolean }> }))
vi.mock('../../lib/chains', async (orig) => ({
  ...(await orig() as object),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async (_pk: string, _g: string, _have: unknown[], opts: { since?: number; reconnect?: boolean } = {}) => {
    relay.args.push({ since: opts.since, reconnect: opts.reconnect })
    relay.asked++
    relay.onAsk?.()
    return relay.answers.length ? relay.answers.shift() : []
  }),
}))
vi.mock('../../lib/workers', async (orig) => ({
  ...(await orig() as object),
  postProof: (m: { id: number; mode: string }) => { posted.push(m) },
  cancelProof: () => {},
}))
vi.mock('../../lib/hyperspace/enter', async (orig) => ({ ...(await orig() as object), computeEnterProof: () => '0'.repeat(64) }))

import { CHAIN_SYNC_MESSAGE, CHAIN_SYNC_WAIT_MS, HEAD_UNCONFIRMED_MESSAGE, useCyberspace } from '../useCyberspace'
import { chainChipState } from '../../hud/ChainExplorer'
import { actionEvent } from '../../lib/__tests__/chainFixtures'
import { placeSpawn } from '../fixtures/placeSpawn'
import { moveDirection } from '../../lib/moves'
import type { NostrEvent } from '../../lib/events'

const S = () => useCyberspace.getState()
let clock = Date.now()
const pastWindow = (): void => { clock += 60_000; vi.setSystemTime(clock) }
const settle = async (): Promise<void> => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) }

beforeEach(async () => {
  posted.length = 0
  relay.answers = []
  relay.asked = 0
  relay.onAsk = null
  await placeSpawn()
  S().clearFocus()
  useCyberspace.setState({ proof: { ...S().proof, status: 'idle', message: null }, transit: null, pendingTarget: null, chainConflict: null, plan: null, chainSync: null, live: true })
  vi.useFakeTimers({ toFake: ['Date'] })
  pastWindow()
})

describe('a move pressed during the first look at the relays', () => {
  it('waits for it, saying so, and only then asks the relays and goes', async () => {
    const me = S().identity.pubkey
    useCyberspace.setState({ chainSync: { pubkey: me, status: 'checking' } })
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const pressed = S().commit()
    await settle()
    expect(relay.asked).toBe(0)
    expect(posted).toEqual([])
    expect(S().proof.message).toBe(CHAIN_SYNC_MESSAGE)
    expect(S().proof.message).toBe('Checking your chain on the relays.')
    useCyberspace.setState({ chainSync: { pubkey: me, status: 'done' } })
    await pressed
    expect(relay.asked).toBe(1)
    expect(posted).toHaveLength(1)
    expect(S().proof.message).not.toBe(CHAIN_SYNC_MESSAGE)
  })

  it('when the look brings moves from another device, the press is refused and nothing is computed on the old head', async () => {
    const me = S().identity.pubkey
    const stale = S().prevEventId!
    useCyberspace.setState({ chainSync: { pubkey: me, status: 'checking' } })
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const pressed = S().commit()
    await settle()
    // The look lands: three moves the phone made, folded in.
    let prev = S().events[S().events.length - 1]
    const theirs: NostrEvent[] = []
    for (let i = 0; i < 3; i++) {
      prev = actionEvent({ pubkey: me, createdAt: prev.created_at + 1, genesisId: S().genesisId!, previousId: prev.id, name: 'wave' })
      theirs.push(prev)
    }
    S().adoptChain(theirs)
    useCyberspace.setState({ chainSync: { pubkey: me, status: 'done' } })
    await pressed
    expect(S().prevEventId).toBe(theirs[2].id)
    expect(posted.every((p) => (p as unknown as { prevEventId?: string }).prevEventId !== stale)).toBe(true)
    expect(posted).toEqual([])
    expect(S().proof.message).toMatch(/Re-aim/)
  })

  it('relays that never answer: it waits no longer than CHAIN_SYNC_WAIT_MS, then refuses rather than signs', async () => {
    const me = S().identity.pubkey
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    useCyberspace.setState({ chainSync: { pubkey: me, status: 'checking' } })
    relay.answers = [null, null]
    S().moveCursor(moveDirection(S().axes(), 'right'))
    const pressed = S().commit()
    await vi.advanceTimersByTimeAsync(CHAIN_SYNC_WAIT_MS + 10)
    await pressed
    vi.useFakeTimers({ toFake: ['Date'] })
    expect(posted).toEqual([])
    expect(S().proof.message).toBe(HEAD_UNCONFIRMED_MESSAGE)
  })

  it('no look out (tests, or one already answered): no wait at all', async () => {
    S().moveCursor(moveDirection(S().axes(), 'right'))
    await S().commit()
    expect(relay.asked).toBe(1)
    expect(posted).toHaveLength(1)
  })
})

describe('LIVE or LOCAL is per identity', () => {
  it('a new key is LIVE though the identity before it was LOCAL; going back finds that identity LOCAL again', async () => {
    const sk = generateSecretKey()
    await S().useNsec(nip19.nsecEncode(sk))
    const first = S().identity.pubkey
    expect(first).toBe(getPublicKey(sk))
    S().setLive(false)
    expect(localStorage.getItem(`onosendai:live:${first}`)).toBe('0')
    await S().useNewKey()
    expect(S().identity.pubkey).not.toBe(first)
    expect(S().live).toBe(true)
    await S().useNsec(nip19.nsecEncode(sk))
    expect(S().identity.pubkey).toBe(first)
    expect(S().live).toBe(false)
    S().setLive(true)
  })
})

describe('the CHAIN chip', () => {
  const base = () => ({ identity: S().identity, events: S().events, published: Object.fromEntries(S().events.map((e) => [e.id, 'ok' as const])), live: true, held: false, chainConflict: null, chainSync: null })
  it('says CHECKING while the first look is out, NOT CHECKED when the relays were silent, nothing once done', () => {
    const me = S().identity.pubkey
    expect(chainChipState({ ...base(), chainSync: { pubkey: me, status: 'checking' } })).toBe('checking')
    expect(chainChipState({ ...base(), chainSync: { pubkey: me, status: 'unreachable' } })).toBe('unchecked')
    expect(chainChipState({ ...base(), chainSync: { pubkey: me, status: 'done' } })).toBe('')
    // Another identity's look says nothing about this one.
    expect(chainChipState({ ...base(), chainSync: { pubkey: 'ff'.repeat(32), status: 'checking' } })).toBe('')
  })
  it('counts the moves LOCAL keeps on this device, and says nothing of them while LIVE', () => {
    const b = base()
    const kept = { ...b.published }
    for (const e of b.events.slice(-1)) delete kept[e.id]
    expect(chainChipState({ ...b, live: false, published: kept })).toBe('local:1')
    expect(chainChipState({ ...b, live: true, published: kept })).toBe('')
    expect(chainChipState({ ...b, live: false })).toBe('')
  })
  it('leaves a held chain and a pending choice to the strip under the switch', () => {
    const me = S().identity.pubkey
    expect(chainChipState({ ...base(), held: true, chainSync: { pubkey: me, status: 'checking' } })).toBe('')
  })
})
