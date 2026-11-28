/**
 * miningHooksBlueprints.test.ts: MINING counts blueprints at their real code
 * paths: one made (useBlueprints addMade, what SEAL calls), one left in the
 * world here or in a new chest (useShards deploy), and one found (TAKE,
 * useBlueprints addFound), taken again counting once. Relays are mocked;
 * nothing touches the network.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', async () => ({
  ...(await import('../../test/offlineRelay')).offlineRelay,
  publishMany: vi.fn(async () => ({ ok: true, accepted: ['wss://relay.test'] })),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { recordTemplate, sheetShape, type Arrangement } from '../../lib/blueprint/format'
import type { BlueprintCard } from '../../lib/blueprint/blueprintDb'
import { blueprintInnerTemplate, readItem, type Hidden } from '../../lib/hidden'
import { forgeKey } from '../../lib/chests'
import { startPlaceBlueprint } from '../../lib/blueprint/place'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useBlueprints } from '../useBlueprints'
import { useShards } from '../useShards'
import { miningRecordFor, resetMiningStats, setMiningDeps } from '../miningStats'
import { totalsOf } from '../../lib/miningRecord'

const S = () => useShards.getState()
const B = () => useBlueprints.getState()
const creatorKey = generateSecretKey()
const placerKey = generateSecretKey()
const placer = getPublicKey(placerKey)
const ARRANGEMENT: Arrangement = { size: [3, 1, 3], cells: Uint16Array.from([0, 1, 0, 1, 40, 1, 0, 1, 0]) }
const me = () => useCyberspace.getState().identity.pubkey
const totals = () => totalsOf(miningRecordFor(me())).c

function signedRecord(title = 'Ferro Plus'): NostrEvent {
  const shape = sheetShape(ARRANGEMENT, (i) => i !== 4)
  const t = recordTemplate({ lookup: 'ab'.repeat(32), sheet: { ...shape, lock: 'standard', prize: { reveal: 'description', text: 'A small lamp.' } }, sealed: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', title, createdAt: 1_790_000_000 })
  return finalizeEvent(t, creatorKey) as unknown as NostrEvent
}
const cardOf = (record: NostrEvent): BlueprintCard => ({ rowKey: `me/${record.id}`, owner: 'me', lookup: 'ab'.repeat(32), record, source: 'found', at: 1 })

const store = new Map<string, string>()
beforeAll(() => {
  setMiningDeps({
    self: () => useCyberspace.getState().identity.pubkey,
    live: () => false,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) }, removeItem: (k) => { store.delete(k) } },
    prefs: null,
  })
})
afterAll(() => { setMiningDeps(null) })

beforeEach(() => {
  store.clear()
  resetMiningStats()
  useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, placedLast: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useBlueprints.setState({ owner: me(), cards: [], fresh: new Set() })
  useCyberspace.setState({ live: true })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('blueprints count for MINING', () => {
  it('made: SEAL keeps the card (addMade)', () => {
    const record = signedRecord()
    B().addMade({ lookup: 'ab'.repeat(32), record, secret: { cells: '', key: '00'.repeat(32), size: [3, 1, 3] }, prizeKind: 'sno' })
    expect(totals().bpMade).toBe(1)
  })

  it('left in the world: a card here, and two cards in a new chest', async () => {
    expect(startPlaceBlueprint(cardOf(signedRecord()), 'here')).toBeNull()
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    expect(totals().bpPlaced).toBe(1)
    const lock = forgeKey('Vault Key')
    S().startDeployChest({ name: 'Vault', lock: { pubkey: lock.itemPubkey, label: 'Vault Key' }, requires: 'the Vault Key', contents: [{ kind: 'blueprint', card: cardOf(signedRecord('One')) }, { kind: 'blueprint', card: cardOf(signedRecord('Two')) }, { kind: 'message', text: 'hi' }] })
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(totals().bpPlaced).toBe(3)
  })

  it('found: TAKE holds it once and counts once', () => {
    const record = signedRecord()
    const card = finalizeEvent(blueprintInnerTemplate(record, { x: 5n, y: 6n, z: 7n }, 0, 1_790_000_100), placerKey) as unknown as NostrEvent
    const find: Hidden = { eventId: card.id, inner: card, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: placer, at: { x: 5n, y: 6n, z: 7n }, plane: 0, height: 4, createdAt: card.created_at, ...readItem(card, placer)! }
    S().addDiscovered([find])
    S().takeFound([card.id])
    S().takeFound([card.id])
    expect(B().cards).toHaveLength(1)
    expect(totals().bpFound).toBe(1)
  })
})
