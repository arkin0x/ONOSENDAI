/**
 * nearbyLootTabs.test.tsx: DISCOVERED NEARBY opens on the first tab with
 * anything in it, ITEMS first, with every tab counted, an empty one dimmed; CHESTS and DOORS rows say LOCKED or OPEN from
 * the opened state, a door open only because of another of its room included;
 * DELETE on a held item asks first, naming it. Rendered to a string.
 */
import { renderToStaticMarkup } from 'react-dom/server'
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

const list = vi.hoisted(() => ({ items: [] as unknown[] }))
vi.mock('../../hooks/useNearbyLoot', () => ({ useNearbyLoot: () => list.items }))
const confirm = vi.hoisted(() => ({ props: null as null | { title: string; onConfirm: () => void; danger?: boolean } }))
vi.mock('../ConfirmModal', () => ({ ConfirmModal: (p: { title: string; onConfirm: () => void }) => { confirm.props = p; return null } }))

import { NearbyList, NearbyTabs, Row } from '../NearbyLootModal'
import { DeleteItem } from '../InventoryPanel'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards } from '../../store/useShards'
import { rememberOpened, resetOpenedChests } from '../../store/useOpenedChests'
import { keepDoorSecret } from '../../store/doorSecrets'
import type { NearbyItem } from '../../hooks/useNearbyLoot'
import type { HeldItem } from '../../lib/inventory'

const ME = useCyberspace.getState().identity.pubkey
const LOCK = 'b'.repeat(64)
const base = { at: { x: 1n, y: 2n, z: 3n }, plane: 0, height: 4, mine: false, author: 'a'.repeat(64), createdAt: 1, distance: 0n }
const chestBody = { name: 'Strongbox', lockPubkey: LOCK, senderPubkey: 'c'.repeat(64), requires: '', payload: '' }
const key = { ...base, key: '1'.repeat(64), type: 'key', keyItem: { name: 'Brass Key', about: '', itemPubkey: LOCK, secretHex: 'd'.repeat(64) } } as unknown as NearbyItem
const chest = { ...base, key: '2'.repeat(64), type: 'chest', chest: chestBody, event: { tags: [] } } as unknown as NearbyItem
const door = { ...base, key: '3'.repeat(64), type: 'chest', chest: { ...chestBody, name: 'Hall Door' }, event: { tags: [['door', '4']] } } as unknown as NearbyItem

const row = (item: NearbyItem): string => renderToStaticMarkup(<ul><Row item={item} me={ME} onView={() => undefined} /></ul>)

beforeEach(() => {
  localStorage.removeItem('onosendai:chests-opened')
  resetOpenedChests()
  list.items = []
  confirm.props = null
  useShards.setState({ mine: [], discovered: {} })
  useInventory.setState({ owner: ME, items: {}, storage: 'memory' })
})

describe('the tabs of DISCOVERED NEARBY', () => {
  it('opens on ITEMS, listing only items, with the others counted', () => {
    list.items = [door, chest, key]
    const html = renderToStaticMarkup(<NearbyList />)
    expect(html).toMatch(/aria-selected="true"[^>]*><span>ITEMS<\/span><span class="nearby__count">1</)
    expect(html).toContain('Brass Key')
    expect(html).not.toContain('Strongbox')
    expect(html).not.toContain('Hall Door')
    expect(html).toMatch(/<span>CHESTS<\/span><span class="nearby__count">1</)
    expect(html).toMatch(/<span>DOORS<\/span><span class="nearby__count">1</)
  })

  it('with no items, opens on the first tab left to right that has something: CHESTS before DOORS', () => {
    list.items = [door, chest]
    const html = renderToStaticMarkup(<NearbyList />)
    expect(html).toMatch(/aria-selected="true"[^>]*><span>CHESTS<\/span><span class="nearby__count">1</)
    expect(html).toContain('Strongbox')
    expect(html).not.toContain('Hall Door')
  })

  it('with only a door, opens on DOORS', () => {
    list.items = [door]
    const html = renderToStaticMarkup(<NearbyList />)
    expect(html).toMatch(/aria-selected="true"[^>]*><span>DOORS<\/span>/)
    expect(html).toContain('Hall Door')
  })

  it('with nothing at all, opens on ITEMS', () => {
    const html = renderToStaticMarkup(<NearbyList />)
    expect(html).toMatch(/aria-selected="true"[^>]*><span>ITEMS<\/span>/)
  })

  it('draws the tabs in his order: ITEMS, CHESTS, DOORS, MESSAGES, SOUNDS, SHARDS, SEEDS', () => {
    const html = renderToStaticMarkup(<NearbyTabs tab="items" counts={{ items: 0, shards: 0, sounds: 0, chests: 0, doors: 0, messages: 0, seeds: 0 }} onTab={() => undefined} />)
    expect([...html.matchAll(/<span>([A-Z]+)<\/span><span class="nearby__count">/g)].map((m) => m[1])).toEqual(['ITEMS', 'CHESTS', 'DOORS', 'MESSAGES', 'SOUNDS', 'SHARDS', 'SEEDS'])
  })

  it('keeps a tab with nothing, dimmed', () => {
    const html = renderToStaticMarkup(<NearbyTabs tab="items" counts={{ items: 1, shards: 0, sounds: 0, chests: 0, doors: 0, messages: 0, seeds: 0 }} onTab={() => undefined} />)
    expect(html).toMatch(/is-empty"[^>]*><span>SOUNDS/)
    expect(html).not.toMatch(/is-empty"[^>]*><span>ITEMS/)
    expect(html.match(/role="tab"/g)).toHaveLength(7)
  })
})

describe('LOCKED and OPEN', () => {
  it('a chest reads LOCKED until opened by hand, and OPEN after, contents read or not', () => {
    expect(row(chest)).toContain('>LOCKED<')
    rememberOpened(ME, chest.key, LOCK, [])
    expect(row(chest)).toContain('>OPEN<')
  })

  it('a door open only because another of its room was reads OPEN', () => {
    expect(row(door)).toContain('>LOCKED<')
    // What store/rooms.ts openDoorNow writes for a door whose seal it cannot read.
    keepDoorSecret(ME, door.key, 'e'.repeat(64), { onlySaid: true })
    rememberOpened(ME, door.key, LOCK, [])
    expect(row(door)).toContain('>OPEN<')
  })

  it('a door holding another secret, kept shut by that opening, reads LOCKED', () => {
    rememberOpened(ME, 'f'.repeat(64), LOCK, [])
    expect(row(door)).toContain('>LOCKED<')
  })

  it('an item row has no status word', () => {
    expect(row(key)).not.toMatch(/>(LOCKED|OPEN)</)
  })
})

describe('DELETE', () => {
  const held = { rowKey: `${ME}/9`, owner: ME, id: '9'.repeat(64), type: 'key', name: 'Brass Key' } as unknown as HeldItem

  it('asks nothing and deletes nothing on being drawn', () => {
    useInventory.setState({ items: { [held.id]: held } })
    const html = renderToStaticMarkup(<DeleteItem item={held} />)
    expect(html).toContain('DELETE')
    expect(confirm.props).toBeNull()
    expect(useInventory.getState().items[held.id]).toBe(held)
  })

  it('the second step names the item, and only it deletes', async () => {
    useInventory.setState({ items: { [held.id]: held } })
    renderToStaticMarkup(<DeleteItem item={held} asking />)
    expect(confirm.props?.title).toContain('Brass Key')
    expect(confirm.props?.danger).toBe(true)
    expect(useInventory.getState().items[held.id]).toBe(held)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await useInventory.getState().remove(held.id)
    expect(useInventory.getState().items[held.id]).toBeUndefined()
  })
})
