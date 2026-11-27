/**
 * blueprintsItems.test.tsx: ITEMS › BLUEPRINTS (design page
 * craft-design/block-uses 4). The panel has three kinds side by side, OTHER
 * LOOT, KEY ITEMS and BLUEPRINTS, BLUEPRINTS a well of six smoke-model tiles
 * with NEW on unseen cards. Its modal lists MINE (made) and HELD (found)
 * from the store with each row's three settings in a line, who made it and
 * who left it there; BUILT has the prizes waiting with TAKE and the
 * blueprints built; ARCHIVED holds what was filed away. A row's actions,
 * EXAMINE, PLACE HERE, PUT IN A CHEST and ARCHIVE, sit on the row on a wide
 * screen and behind one ACTIONS button on a phone, never both; ARCHIVE
 * leaves UNDO in the row's place. Mounted with no DOM; the canvas model and
 * the sheet are stand-ins.
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
// The canvas drawings stand in as plain marks that say what they would draw.
vi.mock('../blueprint/BlueprintModel', async () => {
  const { createElement } = await import('react')
  return {
    BlueprintModel: ({ view, label }: { view: { revealed: Map<number, number> }; label?: string }) =>
      createElement('i', { 'data-model': label ?? '', 'data-shown': view.revealed.size }),
  }
})
vi.mock('../blueprint/ExamineSheet', async (importOriginal) => {
  const { createElement } = await import('react')
  // The words it shares with the list stay real; the sheet is a stand-in.
  return {
    ...(await importOriginal<typeof import('../blueprint/ExamineSheet')>()),
    ExamineSheet: ({ bp, maker }: { bp: { name: string; maker: string; view: { revealed: Map<number, number> }; prize: { name?: string | null } }; maker?: { view: { revealed: Map<number, number> }; prizeName: string | null } }) =>
      createElement('div', { role: 'dialog', 'aria-label': `Examine blueprint ${bp.name}`, 'data-shown': bp.view.revealed.size, 'data-maker-shown': maker ? maker.view.revealed.size : -1, 'data-prize-name': bp.prize.name ?? null }, `by ${bp.maker}`),
  }
})
const placed = vi.hoisted(() => [] as Array<[string, string]>)
vi.mock('../../lib/blueprint/place', () => ({
  startPlaceBlueprint: (card: { rowKey: string }, where: string) => { placed.push([card.rowKey, where]) },
}))

import { createElement } from 'react'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import type { BlueprintCard, ToyRow } from '../../lib/blueprint/blueprintDb'
import { recordTemplate, sheetShape, type Arrangement, type Sheet } from '../../lib/blueprint/format'
import { makerSecret } from '../../lib/blueprint/make'
import { SEEN_SINCE, isNewBlueprint } from '../../lib/itemsSeen'
import { mount, settled, textOf, type Host } from '../../test/elementRoot'
import { useBlueprints } from '../../store/useBlueprints'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { itemsSeenList, useItemsSeen } from '../../store/useItemsSeen'
import { useShards } from '../../store/useShards'
import { NEW_MARK } from '../ItemsGrid'
import { InventoryPanel, useItemsModal, useOpenActions } from '../InventoryPanel'
import { NO_BLUEPRINTS, NO_HELD, cardViews, settingsLine, useBlueprintsModal } from '../blueprint/BlueprintsModal'

/** Two blocks side by side: a Gridstone and a Glowcore. */
const ARR: Arrangement = { size: [2, 1, 1], cells: Uint16Array.from([1, 42]) }

let me = ''
let sk: Uint8Array = new Uint8Array()
let was = useCyberspace.getState().identity

/** A signed record: the Glowcore alone shown, the prize as a silhouette, works anywhere. */
function record(title: string, signer: Uint8Array, lookup: string, lock: Sheet['lock'] = 'standard'): NostrEvent {
  const sheet: Sheet = { ...sheetShape(ARR, (i) => i === 1), lock, ...(lock === 'location' ? { height: 4 } : {}), prize: { reveal: 'silhouette', views: { iso: 'data:image/png;base64,AAAA' } } }
  return finalizeEvent(recordTemplate({ lookup, sheet, sealed: 'AAAA', title, createdAt: SEEN_SINCE }), signer) as NostrEvent
}

function made(title: string, held: number, extra: Partial<BlueprintCard> = {}): BlueprintCard {
  const rec = record(title, sk, held.toString(16).padStart(64, '0'))
  return { rowKey: `${me}/${rec.id}`, owner: me, lookup: rec.tags[0]![1]!, record: rec, source: 'made', at: held, secret: makerSecret(ARR, new Uint8Array(32)), ...extra }
}

function found(title: string, held: number, maker: Uint8Array, leftBy?: string, extra: Partial<BlueprintCard> = {}): BlueprintCard {
  const rec = record(title, maker, (held + 1000).toString(16).padStart(64, '0'), 'location')
  return { rowKey: `${me}/${rec.id}`, owner: me, lookup: rec.tags[0]![1]!, record: rec, source: 'found', at: held, ...(leftBy ? { leftBy } : {}), ...extra }
}

const toy = (name: string): ToyRow => ({ rowKey: `${me}/toy-${name}`, owner: me, prize: { type: 'tool', tool: 'compiler' }, name, maker: 'game', lookup: 'f'.repeat(64), at: { x: '0', y: '0', z: '0', plane: 0 }, made: SEEN_SINCE + 50 })

function holdBlueprints(cards: BlueprintCard[], toys: ToyRow[] = []): void {
  useBlueprints.setState({ owner: me, cards, toys, fresh: new Set() })
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
const rows = (m: { all: () => Host[] }): Host[] => m.all().filter((h) => h.type === 'li' && (h.props['data-blueprint'] !== undefined || h.props['data-prize'] !== undefined))
const rowOf = (m: { all: () => Host[] }, key: string): Host => rows(m).find((r) => r.props['data-blueprint'] === key)!
const press = async (h: Host): Promise<void> => { (h.props.onClick as () => void)(); await settled() }
const buttonIn = (h: Host, words: string): Host => under(h, (n) => n.type === 'button' && textOf(n) === words)[0]!

beforeEach(async () => {
  ;(globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory()
  was = useCyberspace.getState().identity
  sk = generateSecretKey()
  me = getPublicKey(sk)
  placed.length = 0
  useCyberspace.setState({ identity: { ...was, pubkey: me }, live: false })
  useShards.setState({ mine: [], discovered: {}, deleted: {} })
  useInventory.setState({ owner: me, items: {}, storage: 'memory' })
  useItemsModal.setState({ open: null, focus: null })
  useBlueprintsModal.setState({ open: false, focus: null })
  await itemsSeenList.setOwner(me)
  for (let i = 0; i < 200 && !(useItemsSeen.getState().ready && useItemsSeen.getState().owner === me); i++) await new Promise((r) => setTimeout(r, 1))
  expect(useItemsSeen.getState()).toMatchObject({ owner: me, ready: true })
})
afterEach(() => {
  useItemsModal.setState({ open: null, focus: null })
  useBlueprintsModal.setState({ open: false, focus: null })
  useOpenActions.setState({ open: null })
  useBlueprints.setState({ cards: [], toys: [] })
  useCyberspace.setState({ identity: was })
  delete (globalThis as { matchMedia?: unknown }).matchMedia
})

/** A phone's width (under 520px) for what mounts next. */
function onAPhone(): void {
  ;(globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => {}, removeEventListener: () => {} })
}

describe('the ITEMS panel with BLUEPRINTS', () => {
  it('has three kinds side by side, BLUEPRINTS on the right with its count and a well of six smoke-model tiles, newest first, NEW on unseen ones', async () => {
    const maker = generateSecretKey()
    const old = made('Old Shrine', SEEN_SINCE - 50)
    const cipher = found('Pocket Cipher', SEEN_SINCE + 9, maker)
    const shrine = made('Sky Shrine', SEEN_SINCE + 5)
    const filed = made('Filed Away', SEEN_SINCE + 7, { archived: SEEN_SINCE + 8 })
    holdBlueprints([old, shrine, cipher, filed])
    const m = await mount(createElement(InventoryPanel))
    const buttons = m.all().filter((h) => h.type === 'button' && h.props['data-tile'] === undefined).map(textOf)
    expect(buttons.filter((b) => !/^EXPLAIN|^HIDE/i.test(b))).toEqual(['OTHER LOOT · 0', 'KEY ITEMS · 0', 'BLUEPRINTS · 3'])
    const g = grids(m)
    expect(g.map((x) => x.props['data-grid'])).toEqual(['loot', 'keys', 'blueprints'])
    const bp = g[2]!
    expect(tiles(bp).map((t) => t.props.title)).toEqual(['Pocket Cipher', 'Sky Shrine', 'Old Shrine'])
    expect(blanks(bp)).toHaveLength(3)
    // Your own tile shows every block; a found one what a finder sees.
    expect(under(tiles(bp)[0]!, (n) => n.type === 'i')[0]!.props['data-shown']).toBe(1)
    expect(under(tiles(bp)[1]!, (n) => n.type === 'i')[0]!.props['data-shown']).toBe(2)
    expect(tiles(bp).filter((t) => textOf(t).includes(NEW_MARK)).map((t) => t.props.title)).toEqual(['Pocket Cipher', 'Sky Shrine'])
    await m.unmount()
  })

  it('an empty BLUEPRINTS well says so over six blank tiles', async () => {
    holdBlueprints([])
    const m = await mount(createElement(InventoryPanel))
    const bp = grids(m)[2]!
    expect(textOf(bp)).toBe(NO_BLUEPRINTS)
    expect(blanks(bp)).toHaveLength(6)
    await m.unmount()
  })
})

describe('the BLUEPRINTS modal', () => {
  it('lists MINE and HELD from the store, each row with its maker, who left it, and its three settings; opening it sees every card', async () => {
    const maker = generateSecretKey()
    const placer = getPublicKey(generateSecretKey())
    const shrine = made('Sky Shrine', SEEN_SINCE + 5)
    const cipher = found('Pocket Cipher', SEEN_SINCE + 9, maker, placer)
    holdBlueprints([shrine, cipher])
    const m = await mount(createElement(InventoryPanel))
    await m.press(/^BLUEPRINTS · 2$/)
    expect(m.all().find((h) => h.props.role === 'dialog')?.props['aria-label']).toBe('Blueprints')
    expect(m.buttons(/^(MINE|HELD|BUILT|ARCHIVED) \d+$/).map(textOf)).toEqual(['MINE 1', 'HELD 1', 'BUILT 0'])
    expect(m.buttons('✕')).toHaveLength(1)
    // MINE: yours, by you, its settings as a finder sees them, NEW while the list is open.
    expect(rows(m).map((r) => r.props['data-blueprint'])).toEqual([shrine.rowKey])
    const mine = rowOf(m, shrine.rowKey)
    expect(textOf(mine)).toContain('Sky Shrine')
    expect(textOf(mine)).toContain('by you')
    expect(textOf(mine)).toContain('MATERIALS 1 known / 1 unknown · CONSTRUCTION May be built anywhere. · PRIZE Hints only')
    expect(textOf(mine)).toContain(NEW_MARK)
    expect(isNewBlueprint(useItemsSeen.getState().seen, shrine)).toBe(false)
    expect(isNewBlueprint(useItemsSeen.getState().seen, cipher)).toBe(false)
    // HELD: found, its maker named, and who left it there.
    await m.press(/^HELD 1$/)
    const held = rowOf(m, cipher.rowKey)
    expect(textOf(held)).toMatch(/^Pocket Cipherby npub1/)
    expect(textOf(held)).toContain('left here by npub1')
    expect(textOf(held)).toContain('MATERIALS 1 known / 1 unknown · CONSTRUCTION Must be built in a specific h4 region. · PRIZE Hints only')
    await m.press(/^✕$/)
    expect(useBlueprintsModal.getState().open).toBe(false)
    await m.unmount()
  })

  it('a tile opens it at that row with its ACTIONS open: EXAMINE, PLACE HERE, PUT IN A CHEST and ARCHIVE, and no DELETE', async () => {
    const cipher = found('Pocket Cipher', SEEN_SINCE + 9, generateSecretKey())
    holdBlueprints([made('Sky Shrine', SEEN_SINCE + 5), cipher])
    const m = await mount(createElement(InventoryPanel))
    await press(tiles(grids(m)[2]!).find((t) => t.props['data-tile'] === cipher.rowKey)!)
    expect(useBlueprintsModal.getState()).toMatchObject({ open: true, focus: cipher.rowKey })
    expect(useOpenActions.getState().open).toBe(cipher.rowKey)
    const row = rowOf(m, cipher.rowKey)
    expect(String(row.props.className)).toContain('held__row--focus')
    const acts = under(row, (n) => n.props.role === 'group').map((g) => under(g, (n) => n.type === 'button').map(textOf))[0]
    expect(acts).toEqual(['EXAMINE', 'PLACE HERE', 'PUT IN A CHEST', 'ARCHIVE'])
    // On a wide screen the actions are on the row: no ACTIONS button over them.
    expect(under(row, (n) => n.type === 'button' && textOf(n) === 'ACTIONS')).toHaveLength(0)
    await press(buttonIn(row, 'PLACE HERE'))
    await press(buttonIn(rowOf(m, cipher.rowKey), 'PUT IN A CHEST'))
    expect(placed).toEqual([[cipher.rowKey, 'here'], [cipher.rowKey, 'chest']])
    await press(buttonIn(rowOf(m, cipher.rowKey), 'EXAMINE'))
    expect(m.all().find((h) => h.props['aria-label'] === 'Examine blueprint Pocket Cipher')).toBeTruthy()
    await m.unmount()
  })

  it('on a phone one ACTIONS button opens the actions under the row, and the row alone does not show them', async () => {
    onAPhone()
    const shrine = made('Sky Shrine', SEEN_SINCE + 5)
    holdBlueprints([shrine])
    useBlueprintsModal.setState({ open: true, focus: null })
    const m = await mount(createElement(InventoryPanel))
    const groups = (): Host[] => under(rowOf(m, shrine.rowKey), (n) => n.props.role === 'group')
    expect(groups()).toHaveLength(0)
    await press(buttonIn(rowOf(m, shrine.rowKey), 'ACTIONS'))
    expect(groups().map((g) => under(g, (n) => n.type === 'button').map(textOf))).toEqual([['EXAMINE', 'PLACE HERE', 'PUT IN A CHEST', 'ARCHIVE']])
    await m.unmount()
  })

  it('MINE shows every block; there is no SEE AS A FINDER, and EXAMINE opens on the finder view with the maker view to switch to', async () => {
    const shrine = made('Sky Shrine', SEEN_SINCE + 5)
    holdBlueprints([shrine])
    useBlueprintsModal.setState({ open: true, focus: shrine.rowKey })
    const m = await mount(createElement(InventoryPanel))
    const model = (): Host => under(rowOf(m, shrine.rowKey), (n) => n.type === 'i')[0]!
    expect(model().props['data-shown']).toBe(2)
    expect(m.buttons(/SEE AS A FINDER/)).toHaveLength(0)
    expect(m.says('AS A FINDER')).toBe(false)
    await press(buttonIn(rowOf(m, shrine.rowKey), 'EXAMINE'))
    const sheet = m.all().find((h) => h.props['aria-label'] === 'Examine blueprint Sky Shrine')!
    expect(sheet.props['data-shown']).toBe(1)
    expect(sheet.props['data-maker-shown']).toBe(2)
    // No prize name was chosen to be shown, and the blueprint's title does not stand in for one.
    expect(sheet.props['data-prize-name']).toBeNull()
    expect(textOf(sheet)).toBe('by you')
    await m.unmount()
  })

  it('a found card examines as a finder only: no maker view to switch to', async () => {
    const cipher = found('Pocket Cipher', SEEN_SINCE + 9, generateSecretKey())
    holdBlueprints([cipher])
    useBlueprintsModal.setState({ open: true, focus: cipher.rowKey })
    const m = await mount(createElement(InventoryPanel))
    await press(buttonIn(rowOf(m, cipher.rowKey), 'EXAMINE'))
    const sheet = m.all().find((h) => h.props['aria-label'] === 'Examine blueprint Pocket Cipher')!
    expect(sheet.props['data-maker-shown']).toBe(-1)
    await m.unmount()
  })

  it('ARCHIVE is never final on one tap: UNDO stands in the row\'s place and brings it straight back', async () => {
    const shrine = made('Sky Shrine', SEEN_SINCE + 5)
    const other = made('Low Gate', SEEN_SINCE + 4)
    holdBlueprints([shrine, other])
    useBlueprintsModal.setState({ open: true, focus: null })
    const m = await mount(createElement(InventoryPanel))
    const list = (): string[] => m.all().filter((h) => h.type === 'li' && (h.props['data-blueprint'] !== undefined || h.props['data-undo'] !== undefined)).map((h) => (h.props['data-undo'] ? `undo:${String(h.props['data-undo'])}` : String(h.props['data-blueprint'])))
    expect(list()).toEqual([shrine.rowKey, other.rowKey])
    await press(buttonIn(rowOf(m, shrine.rowKey), 'ARCHIVE'))
    expect(useBlueprints.getState().cards.find((c) => c.rowKey === shrine.rowKey)!.archived).toBeTypeOf('number')
    // The line takes the row's place, above the row that was under it.
    expect(list()).toEqual([`undo:${shrine.rowKey}`, other.rowKey])
    expect(m.says('Sky Shrine is filed under ARCHIVED.')).toBe(true)
    await m.press(/^UNDO$/)
    expect(useBlueprints.getState().cards.find((c) => c.rowKey === shrine.rowKey)!.archived).toBeUndefined()
    expect(list()).toEqual([shrine.rowKey, other.rowKey])
    expect(m.buttons(/^UNDO$/)).toHaveLength(0)
    await m.unmount()
  })

  it('ARCHIVE files a card under ARCHIVED, where UNARCHIVE brings it back', async () => {
    const shrine = made('Sky Shrine', SEEN_SINCE + 5)
    holdBlueprints([shrine])
    useBlueprintsModal.setState({ open: true, focus: shrine.rowKey })
    const m = await mount(createElement(InventoryPanel))
    await press(buttonIn(rowOf(m, shrine.rowKey), 'ARCHIVE'))
    expect(useBlueprints.getState().cards[0]!.archived).toBeTypeOf('number')
    expect(m.buttons(/^(MINE|HELD|BUILT|ARCHIVED) \d+$/).map(textOf)).toEqual(['MINE 0', 'HELD 0', 'BUILT 0', 'ARCHIVED 1'])
    expect(rows(m)).toHaveLength(0)
    expect(m.buttons(/^UNDO$/)).toHaveLength(1)
    expect(m.buttons(/^BLUEPRINTS · 0$/)).toHaveLength(1)
    await m.press(/^ARCHIVED 1$/)
    expect(textOf(rowOf(m, shrine.rowKey))).toContain('ARCHIVED')
    expect(m.buttons(/^DELETE/)).toHaveLength(0)
    await press(buttonIn(rowOf(m, shrine.rowKey), 'UNARCHIVE'))
    expect(useBlueprints.getState().cards[0]!.archived).toBeUndefined()
    expect(m.buttons(/^MINE 1$/)).toHaveLength(1)
    await m.unmount()
  })

  it('BUILT lists the prizes waiting, each with TAKE, then the blueprints built and how often', async () => {
    const shrine = made('Sky Shrine', SEEN_SINCE + 5, { built: 2 })
    holdBlueprints([shrine], [toy('Compiler')])
    const m = await mount(createElement(InventoryPanel))
    await m.press(/^BLUEPRINTS · 1$/)
    await m.press(/^BUILT 2$/)
    expect(m.says('WAITING TO BE TAKEN')).toBe(true)
    const prize = rows(m).find((r) => r.props['data-prize'] !== undefined)!
    expect(textOf(prize)).toContain('Compiler')
    expect(textOf(prize)).toContain('by a starter recipe')
    expect(under(prize, (n) => n.type === 'button').map(textOf)).toEqual(['TAKE'])
    expect(m.says('YOU HAVE BUILT')).toBe(true)
    expect(textOf(rowOf(m, shrine.rowKey))).toContain('BUILT 2 TIMES')
    await m.unmount()
  })

  it('an empty HELD says where blueprints are found', async () => {
    holdBlueprints([])
    useBlueprintsModal.setState({ open: true, focus: null })
    const m = await mount(createElement(InventoryPanel))
    await m.press(/^HELD 0$/)
    expect(m.says(NO_HELD)).toBe(true)
    await m.unmount()
  })
})

describe('a card\'s words', () => {
  it('reads its three settings in one short line, as a finder sees it', () => {
    const v = cardViews(made('Sky Shrine', SEEN_SINCE + 5))!
    expect(v.full?.revealed.size).toBe(2)
    expect(settingsLine(v)).toBe('MATERIALS 1 known / 1 unknown · CONSTRUCTION May be built anywhere. · PRIZE Hints only')
    expect(cardViews(found('Pocket Cipher', SEEN_SINCE, generateSecretKey()))!.full).toBeNull()
  })
})
