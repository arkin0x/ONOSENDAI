/**
 * nearbyInfo.test.tsx: every DISCOVERED NEARBY row has INFO beside VIEW, and
 * INFO opens that thing's own card, the one a tap on it in the world opens
 * (arkinox, 2026-11-22: "I can't tap on a shard when it's only fog. I should
 * be able to trigger its modal from the Nearby modal but I can only trigger
 * View which doesn't help").
 *
 * A tap in the world selects the thing by its key (WorldShards, ChestLooks,
 * WorldMessages, AudioSpheres: selectSecret(w.key)), and the card
 * (SecretModal) draws whatever is selected. INFO makes the same selection,
 * the card stacked over the list, which is there again when it closes, for a shard (fog, glow and solid alike), a
 * message, hidden audio, a chest, a door and a seed. A key's INFO is its key
 * card, as the owner named it (KeyItemInfo). Mounted for real
 * (test/elementRoot.ts), the buttons pressed. No network.
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
;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  signInFailed: () => false,
  publish: vi.fn(async () => ({ ok: true })),
  publishMany: vi.fn(async () => ({ ok: true })),
  publishLight: vi.fn(async () => true),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryAnyChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
vi.mock('../../hooks/useNearbyLoot', () => ({ useNearbyLoot: () => [] }))

import { newShard, type ShardModel } from 'sno-core/shards'
import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { NearbyLootModal, Row, SeedRow } from '../NearbyLootModal'
import { leaveModals, stackedOpen } from '../modalStack'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards } from '../../store/useShards'
import type { NearbyItem } from '../../hooks/useNearbyLoot'

const ME = useCyberspace.getState().identity.pubkey
const base = { at: { x: 1n, y: 2n, z: 3n }, plane: 0, height: 4, mine: false, author: 'a'.repeat(64), createdAt: 1, distance: 0n }
const chestBody = { name: 'Strongbox', lockPubkey: 'b'.repeat(64), senderPubkey: 'c'.repeat(64), requires: '', payload: '' }

/** A fog shard: POINTS, point size 0, a FOG glow. Nothing to tap in the world. */
const fog: ShardModel = { ...newShard('Morning Fog'), mode: 'points', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }], faces: [], extra: { pointsize: 0, glow: ['fog', 240, 60] } }
/** A glow and nothing else: opacity 0, a LIGHT glow. */
const glow: ShardModel = { ...fog, name: 'Lantern', opacity: 0, extra: { glow: ['light', 240, 60] } }

const ROWS: Array<[string, NearbyItem]> = [
  ['a fog shard', { ...base, key: '1'.repeat(64), type: 'shard', shard: fog } as unknown as NearbyItem],
  ['a glow shard', { ...base, key: '2'.repeat(64), type: 'shard', shard: glow } as unknown as NearbyItem],
  ['a solid shard', { ...base, key: '3'.repeat(64), type: 'shard', shard: { ...newShard('Crate'), mode: 'solid', vertices: [], faces: [] } } as unknown as NearbyItem],
  ['a message', { ...base, key: '4'.repeat(64), type: 'message', text: 'meet me at the gate' } as unknown as NearbyItem],
  ['hidden audio', { ...base, key: '5'.repeat(64), type: 'audio', audio: { title: 'Rain', url: 'https://example.test/rain.mp3' } } as unknown as NearbyItem],
  ['a chest', { ...base, key: '6'.repeat(64), type: 'chest', chest: chestBody, event: { tags: [] } } as unknown as NearbyItem],
  ['a door', { ...base, key: '7'.repeat(64), type: 'chest', chest: { ...chestBody, name: 'Hall Door' }, event: { tags: [['door', '4']] } } as unknown as NearbyItem],
]

/** The buttons beside VIEW, by their words, VIEW last. */
const actions = (r: Mounted): string[] => (r.all().find((h) => h.props.className === 'nearby__acts')?.children ?? [])
  .flatMap((c) => (typeof c !== 'string' && c.props.className === 'nearby__door' ? c.children : [c]))
  .map((c) => textOf(c as Host))
  .filter((w) => w !== '')

beforeEach(() => {
  useShards.setState({ mine: [], discovered: {}, selectedSecret: null, nearbyOpen: true })
  useInventory.setState({ owner: ME, items: {}, storage: 'memory' })
})

describe('DISCOVERED NEARBY among the stacked modals', () => {
  it('an action that leaves for the world (leaveModals) closes the list under the card too', async () => {
    const r = await mount(<NearbyLootModal />)
    expect(stackedOpen()).toBe(1)
    leaveModals()
    expect(useShards.getState().nearbyOpen).toBe(false)
    await r.unmount()
  })
})

describe('INFO on a DISCOVERED NEARBY row', () => {
  for (const [what, item] of ROWS) {
    it(`${what}: INFO beside VIEW opens its own card, as a tap on it in the world does`, async () => {
      const r = await mount(<ul><Row item={item} me={ME} onView={() => undefined} /></ul>)
      const acts = actions(r)
      expect(acts.slice(-2)).toEqual(['INFO', 'VIEW'])
      // One INFO, and VIEW still there.
      expect(r.buttons(/^INFO$/)).toHaveLength(1)
      await r.press(/^INFO$/)
      expect(useShards.getState().selectedSecret).toBe(item.key)
      // The list stays under the card, as a key's INFO card stacks over it.
      expect(useShards.getState().nearbyOpen).toBe(true)
      await r.unmount()
    })
  }

  it('a seed: INFO beside VIEW opens its card, as its name does', async () => {
    const seed = { ...base, key: '8'.repeat(64), type: 'seed' } as unknown as NearbyItem
    const r = await mount(<ul><SeedRow item={seed} me={ME} onView={() => undefined} /></ul>)
    expect(actions(r)).toEqual(['INFO', 'VIEW'])
    await r.press(/^INFO$/)
    expect(useShards.getState().selectedSecret).toBe(seed.key)
    expect(useShards.getState().nearbyOpen).toBe(true)
    await r.unmount()
  })

  it('a key: INFO is its key card, as before; the list stays and nothing else is selected', async () => {
    const key = { ...base, key: '9'.repeat(64), type: 'key', keyItem: { name: 'Brass Key', about: '', itemPubkey: 'b'.repeat(64), secretHex: 'd'.repeat(64) } } as unknown as NearbyItem
    const r = await mount(<ul><Row item={key} me={ME} onView={() => undefined} /></ul>)
    expect(r.buttons(/^INFO$/)).toHaveLength(1)
    await r.press(/^INFO$/)
    expect(r.says('KEY ITEM')).toBe(true)
    expect(useShards.getState().selectedSecret).toBe(null)
    expect(useShards.getState().nearbyOpen).toBe(true)
    await r.unmount()
  })
})
