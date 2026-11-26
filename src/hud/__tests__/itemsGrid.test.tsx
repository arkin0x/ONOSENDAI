/**
 * itemsGrid.test.tsx: the pictures under the ITEMS buttons (owner,
 * 2026-11-26: "show item images on a grid under these buttons, side by side
 * ... left side is loot"). OTHER LOOT's grid on the left and KEY ITEMS' on
 * the right, newest first, six tiles each always, a "+N more" tile past six,
 * a quiet line when empty, NEW on what has not been looked at until its card
 * or its list is opened, and a tap opening the item. Mounted, each store
 * brought up to date first.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../lib/relay', () => ({
  onAuthChange: () => () => {},
  onCanonicalSignIn: () => () => {},
  signInFailed: () => false,
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryEach: vi.fn(async () => []),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { createElement } from 'react'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { forgeKey } from '../../lib/chests'
import { keyInnerTemplate, messageInnerTemplate } from '../../lib/hidden'
import { heldFromForged, type HeldItem } from '../../lib/inventory'
import { SEEN_SINCE, isNewItem } from '../../lib/itemsSeen'
import { mount, settled, textOf, type Host } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { itemsSeenList, useItemsSeen } from '../../store/useItemsSeen'
import { useShards } from '../../store/useShards'
import { NEW_MARK } from '../ItemsGrid'
import { InventoryPanel, NO_KEY_ITEMS, NO_OTHER_LOOT, useItemsModal, useOpenActions } from '../InventoryPanel'

const at = { x: 1n, y: 2n, z: 3n }
const place = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }

let me = ''
let sk: Uint8Array = new Uint8Array()
let was = useCyberspace.getState().identity

/** A note taken out of a chest, held at `held` (unix seconds). */
function note(name: string, held: number): HeldItem {
  const ev = finalizeEvent(messageInnerTemplate(`${name} text`, at, 0, held), generateSecretKey()) as NostrEvent
  return { rowKey: `${me}/${ev.id}`, owner: me, id: ev.id, type: 'message', name, event: ev, author: ev.pubkey, verified: true, source: 'taken', place, from: { chestId: 'c'.repeat(64), chestName: 'Wind Chest' }, at: held, text: `${name} text` }
}

function keyItem(name: string, held: number): HeldItem {
  const lock = forgeKey(name)
  const ev = finalizeEvent(keyInnerTemplate(lock, at, 0, held), sk) as NostrEvent
  return heldFromForged(me, ev, lock, place, held)
}

function hold(items: HeldItem[]): void {
  useInventory.setState({ owner: me, items: Object.fromEntries(items.map((it) => [it.id, it])), storage: 'memory' })
}

const grids = (m: { all: () => Host[] }): Host[] => m.all().filter((h) => h.props['data-grid'] !== undefined)
function under(h: Host, pick: (n: Host) => boolean): Host[] {
  const out: Host[] = []
  const walk = (n: Host | string): void => {
    if (typeof n === 'string') return
    if (pick(n)) out.push(n)
    n.children.forEach(walk)
  }
  walk(h)
  return out
}
const tiles = (grid: Host): Host[] => under(grid, (n) => n.type === 'button' && typeof n.props['data-tile'] === 'string' && n.props['data-tile'] !== 'more')
const blanks = (grid: Host): Host[] => under(grid, (n) => String(n.props.className ?? '').includes('items-tile--blank'))
const marked = (grid: Host): string[] => tiles(grid).filter((t) => textOf(t).includes(NEW_MARK)).map((t) => String(t.props['data-tile']))
const press = async (h: Host): Promise<void> => { (h.props.onClick as () => void)(); await settled() }

beforeEach(async () => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  was = useCyberspace.getState().identity
  sk = generateSecretKey()
  me = getPublicKey(sk)
  useCyberspace.setState({ identity: { ...was, pubkey: me }, live: false })
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
  useItemsModal.setState({ open: null, focus: null })
  await itemsSeenList.setOwner(me)
  for (let i = 0; i < 200 && !(useItemsSeen.getState().ready && useItemsSeen.getState().owner === me); i++) await new Promise((r) => setTimeout(r, 1))
  expect(useItemsSeen.getState()).toMatchObject({ owner: me, ready: true })
})
afterEach(() => {
  useItemsModal.setState({ open: null, focus: null })
  useOpenActions.setState({ open: null })
  useCyberspace.setState({ identity: was })
})

describe('the ITEMS grids', () => {
  it('OTHER LOOT on the left and KEY ITEMS on the right, each newest first, six tiles each with blanks filling the rest', async () => {
    const a = note('Old note', SEEN_SINCE + 1)
    const b = note('Middle note', SEEN_SINCE + 5)
    const c = note('New note', SEEN_SINCE + 9)
    const k1 = keyItem('Iron Key', SEEN_SINCE + 2)
    const k2 = keyItem('Glass Key', SEEN_SINCE + 7)
    hold([a, k1, c, b, k2])
    const m = await mount(createElement(InventoryPanel))
    const [left, right] = grids(m)
    expect(left!.props['data-grid']).toBe('loot')
    expect(right!.props['data-grid']).toBe('keys')
    expect(tiles(left!).map((t) => t.props['data-tile'])).toEqual([c.id, b.id, a.id])
    expect(tiles(right!).map((t) => t.props['data-tile'])).toEqual([k2.id, k1.id])
    expect(blanks(left!)).toHaveLength(3)
    expect(blanks(right!)).toHaveLength(4)
    // Named for a screen reader and on hover; the counts stay on the buttons.
    expect(tiles(left!)[0]!.props.title).toBe('New note')
    expect(m.buttons(/^OTHER LOOT · 3$/)).toHaveLength(1)
    expect(m.buttons(/^KEY ITEMS · 2$/)).toHaveLength(1)
    await m.unmount()
  })

  it('past six, the newest five and a "+N more" tile that opens the full list', async () => {
    const many = Array.from({ length: 9 }, (_, i) => note(`Note ${i}`, SEEN_SINCE + i + 1))
    hold(many)
    const m = await mount(createElement(InventoryPanel))
    const [left] = grids(m)
    expect(tiles(left!).map((t) => t.props.title)).toEqual(['Note 8', 'Note 7', 'Note 6', 'Note 5', 'Note 4'])
    expect(blanks(left!)).toHaveLength(0)
    const more = m.buttons(/^\+4MORE$/)
    expect(more).toHaveLength(1)
    expect(more[0]!.props['aria-label']).toBe('4 more: open other loot')
    await m.press(/^\+4MORE$/)
    expect(useItemsModal.getState().open).toBe('loot')
    expect(m.all().filter((h) => h.type === 'li' && String(h.props.className).includes('held__row'))).toHaveLength(9)
    await m.unmount()
  })

  it('an empty side says so in a quiet line over its blank tiles, and has nothing to tap', async () => {
    hold([])
    const m = await mount(createElement(InventoryPanel))
    const [left, right] = grids(m)
    expect(textOf(left!)).toBe(NO_OTHER_LOOT)
    expect(textOf(right!)).toBe(NO_KEY_ITEMS)
    expect(blanks(left!)).toHaveLength(6)
    expect(blanks(right!)).toHaveLength(6)
    expect([...tiles(left!), ...tiles(right!)]).toHaveLength(0)
    expect(m.buttons(/MORE/)).toHaveLength(0)
    // One side empty, the other not.
    hold([note('Only note', SEEN_SINCE + 3)])
    await settled()
    expect(textOf(grids(m)[0]!)).not.toContain(NO_OTHER_LOOT)
    expect(textOf(grids(m)[1]!)).toBe(NO_KEY_ITEMS)
    await m.unmount()
  })
})

describe('NEW', () => {
  it('marks what was taken since NEW began and not looked at; opening a list clears its side only, its rows saying NEW while it is open', async () => {
    const before = note('Old note', SEEN_SINCE - 60)
    const fresh = note('Fresh note', SEEN_SINCE + 4)
    const k = keyItem('Glass Key', SEEN_SINCE + 6)
    hold([before, fresh, k])
    const m = await mount(createElement(InventoryPanel))
    expect(marked(grids(m)[0]!)).toEqual([fresh.id])
    expect(marked(grids(m)[1]!)).toEqual([k.id])
    expect(tiles(grids(m)[0]!).find((t) => t.props['data-tile'] === fresh.id)!.props['aria-label']).toBe('Fresh note, new')

    await m.press(/^OTHER LOOT · 2$/)
    const rows = m.all().filter((h) => h.type === 'li' && String(h.props.className).includes('held__row--loot'))
    expect(rows.map((r) => textOf(r).includes(NEW_MARK))).toEqual([true, false])
    expect(isNewItem(useItemsSeen.getState().seen, fresh)).toBe(false)
    expect(marked(grids(m)[0]!)).toEqual([])
    expect(marked(grids(m)[1]!)).toEqual([k.id])
    await m.unmount()

    // Kept: the next mount (the menu shown again) still has it seen.
    await itemsSeenList.flush()
    const again = await mount(createElement(InventoryPanel))
    expect(marked(grids(again)[0]!)).toEqual([])
    await again.unmount()
  })

  it('draws no NEW before this identity\'s record is read', async () => {
    hold([note('Fresh note', SEEN_SINCE + 4)])
    useItemsSeen.setState({ ready: false })
    const m = await mount(createElement(InventoryPanel))
    expect(marked(grids(m)[0]!)).toEqual([])
    useItemsSeen.setState({ ready: true })
    await settled()
    expect(marked(grids(m)[0]!)).toHaveLength(1)
    await m.unmount()
  })
})

describe('a tap on a tile', () => {
  it('a loot tile opens OTHER LOOT at its row, lit, with its ACTIONS open', async () => {
    const a = note('First note', SEEN_SINCE + 1)
    const b = note('Second note', SEEN_SINCE + 2)
    hold([a, b])
    const m = await mount(createElement(InventoryPanel))
    await press(tiles(grids(m)[0]!).find((t) => t.props['data-tile'] === a.id)!)
    expect(useItemsModal.getState()).toMatchObject({ open: 'loot', focus: a.id })
    expect(useOpenActions.getState().open).toBe(a.id)
    const lit = m.all().filter((h) => h.type === 'li' && String(h.props.className).includes('held__row--focus'))
    expect(lit.map((h) => h.props['data-actions-row'])).toEqual([a.id])
    // The list was opened: both are seen.
    expect(isNewItem(useItemsSeen.getState().seen, b)).toBe(false)
    await m.unmount()
  })

  it('a key item tile opens its card over the menu, and that key alone is seen', async () => {
    const k1 = keyItem('Iron Key', SEEN_SINCE + 2)
    const k2 = keyItem('Glass Key', SEEN_SINCE + 7)
    hold([k1, k2])
    const m = await mount(createElement(InventoryPanel))
    await press(tiles(grids(m)[1]!).find((t) => t.props['data-tile'] === k1.id)!)
    const card = m.all().find((h) => h.props.role === 'dialog')
    expect(card?.props['aria-label']).toBe('Key item Iron Key')
    expect(useItemsModal.getState().open).toBeNull()
    expect(isNewItem(useItemsSeen.getState().seen, k1)).toBe(false)
    expect(isNewItem(useItemsSeen.getState().seen, k2)).toBe(true)
    expect(marked(grids(m)[1]!)).toEqual([k2.id])
    await m.unmount()
  })
})
