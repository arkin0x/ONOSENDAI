/**
 * blueprintLanding.test.tsx: the BLUEPRINT tool's first page
 * (hud/blueprint/BlueprintLanding). CREATE NEW on top; under it every
 * blueprint held and not archived, the one just made first with NEW; each
 * tile's DEPLOY lines it up where you stand and closes the tool, PUT IN A
 * CHEST lines up a chest, a refusal shows on the tile, and the picture opens
 * EXAMINE. With nothing held, only CREATE NEW and one line. Mounted with no
 * DOM; the canvas model and the sheet are stand-ins.
 */
import 'fake-indexeddb/auto'
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
vi.mock('../blueprint/BlueprintModel', async () => {
  const { createElement } = await import('react')
  return {
    BlueprintModel: ({ view, label }: { view: { revealed: Map<number, number> }; label?: string }) =>
      createElement('i', { 'data-model': label ?? '', 'data-shown': view.revealed.size }),
  }
})
vi.mock('../blueprint/ExamineSheet', async (importOriginal) => {
  const { createElement } = await import('react')
  return {
    ...(await importOriginal<typeof import('../blueprint/ExamineSheet')>()),
    ExamineSheet: ({ bp, maker }: { bp: { name: string }; maker?: unknown }) =>
      createElement('div', { role: 'dialog', 'aria-label': `Examine blueprint ${bp.name}`, 'data-maker': maker ? 'yes' : 'no', 'data-item': (bp as { item?: boolean }).item ? 'yes' : 'no' }, `by ${(bp as { maker?: string }).maker}`),
  }
})
const placed = vi.hoisted(() => ({ calls: [] as Array<[string, string]>, refuse: null as string | null }))
vi.mock('../../lib/blueprint/place', () => ({
  startPlaceBlueprint: (card: { rowKey: string }, where: string) => { placed.calls.push([card.rowKey, where]); return placed.refuse },
}))

import { createElement } from 'react'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import type { BlueprintCard } from '../../lib/blueprint/blueprintDb'
import { recordTemplate, sheetShape, type Arrangement, type Sheet } from '../../lib/blueprint/format'
import { makerSecret } from '../../lib/blueprint/make'
import { SEEN_SINCE } from '../../lib/itemsSeen'
import { mount, textOf, type Host } from '../../test/elementRoot'
import { useBlueprints } from '../../store/useBlueprints'
import { useBlueprintTool } from '../../store/useBlueprintTool'
import { useCyberspace } from '../../store/useCyberspace'
import { BlueprintLanding, NO_LANDING } from '../blueprint/BlueprintLanding'
import { COMPILER_LOOKUP, GAME_NO_DEPLOY, compilerRecord } from '../../lib/blueprint/gameBlueprint'
import { bytesFromCells, toBase64 } from '../../lib/blueprint/format'
import { COMPILER_RECIPE } from '../../lib/blueprint/recipes'

const ARR: Arrangement = { size: [2, 1, 1], cells: Uint16Array.from([1, 42]) }
let me = ''
let sk: Uint8Array = new Uint8Array()
let was = useCyberspace.getState().identity

function record(title: string, signer: Uint8Array, lookup: string): NostrEvent {
  const sheet: Sheet = { ...sheetShape(ARR, (i) => i === 1), lock: 'standard', prize: { reveal: 'silhouette', views: { iso: 'data:image/png;base64,AAAA' } } }
  return finalizeEvent(recordTemplate({ lookup, sheet, sealed: 'AAAA', title, createdAt: SEEN_SINCE }), signer) as NostrEvent
}
function made(title: string, at: number, extra: Partial<BlueprintCard> = {}): BlueprintCard {
  const rec = record(title, sk, at.toString(16).padStart(64, '0'))
  return { rowKey: `${me}/${rec.id}`, owner: me, lookup: rec.tags[0]![1]!, record: rec, source: 'made', at, secret: makerSecret(ARR, new Uint8Array(32)), ...extra }
}
function found(title: string, at: number): BlueprintCard {
  const rec = record(title, generateSecretKey(), (at + 1000).toString(16).padStart(64, '0'))
  return { rowKey: `${me}/${rec.id}`, owner: me, lookup: rec.tags[0]![1]!, record: rec, source: 'found', at }
}

/** The game's Compiler blueprint, as the grant makes it. */
async function gameCard(): Promise<BlueprintCard> {
  const record = await compilerRecord({ iso: 'data:image/png;base64,AAAA' })
  return { rowKey: `${me}/${record.id}`, owner: me, lookup: COMPILER_LOOKUP, record: record as NostrEvent, source: 'game', prizeKind: 'tool', at: SEEN_SINCE + 20, secret: { cells: toBase64(bytesFromCells(COMPILER_RECIPE.cells)), key: '00'.repeat(32), size: [...COMPILER_RECIPE.size] as [number, number, number] } }
}

const tiles = (m: { all: () => Host[] }): Host[] => m.all().filter((h) => h.type === 'li' && h.props['data-landing-tile'] !== undefined)
function under(h: Host, pick: (n: Host) => boolean): Host[] {
  const out: Host[] = []
  const walk = (n: Host | string): void => { if (typeof n === 'string') return; if (pick(n)) out.push(n); n.children.forEach(walk) }
  walk(h)
  return out
}
const buttonIn = (h: Host, words: string): Host => under(h, (n) => n.type === 'button' && textOf(n) === words)[0]!
const press = async (h: Host): Promise<void> => { (h.props.onClick as () => void)(); await new Promise((r) => setTimeout(r, 5)) }

beforeEach(() => {
  was = useCyberspace.getState().identity
  sk = generateSecretKey()
  me = getPublicKey(sk)
  placed.calls.length = 0
  placed.refuse = null
  useCyberspace.setState({ identity: { ...was, pubkey: me }, live: false })
  useBlueprintTool.setState({ open: true })
})
afterEach(() => {
  useBlueprints.setState({ cards: [], toys: [] })
  useBlueprintTool.setState({ open: false })
  useCyberspace.setState({ identity: was })
})

describe('the BLUEPRINT tool\'s first page', () => {
  it('with nothing held: CREATE NEW and one short line, nothing else', async () => {
    useBlueprints.setState({ owner: me, cards: [], toys: [] })
    const onCreate = vi.fn()
    const m = await mount(createElement(BlueprintLanding, { onCreate }))
    expect(m.all().filter((h) => h.type === 'button').map(textOf)).toEqual(['CREATE NEW'])
    expect(m.says(NO_LANDING)).toBe(true)
    await m.press(/^CREATE NEW$/)
    expect(onCreate).toHaveBeenCalledTimes(1)
    await m.unmount()
  })

  it('lists MINE and HELD, not archived, newest first, the one just made first with NEW; yours shows every block', async () => {
    const old = made('Old Shrine', SEEN_SINCE + 1)
    const cipher = found('Pocket Cipher', SEEN_SINCE + 9)
    const filed = made('Filed Away', SEEN_SINCE + 5, { archived: SEEN_SINCE + 6 })
    useBlueprints.setState({ owner: me, cards: [old, cipher, filed], toys: [] })
    const m = await mount(createElement(BlueprintLanding, { onCreate: () => {}, freshRowKey: old.rowKey }))
    expect(tiles(m).map((t) => t.props['data-landing-tile'])).toEqual([old.rowKey, cipher.rowKey])
    expect(textOf(tiles(m)[0]!)).toContain('NEW')
    expect(textOf(tiles(m)[1]!)).not.toContain('NEW')
    expect(textOf(tiles(m)[0]!)).toContain('Old Shrineby you')
    expect(textOf(tiles(m)[1]!)).toMatch(/Pocket Cipherby npub1/)
    expect(under(tiles(m)[0]!, (n) => n.type === 'i')[0]!.props['data-shown']).toBe(2)
    expect(under(tiles(m)[1]!, (n) => n.type === 'i')[0]!.props['data-shown']).toBe(1)
    expect(under(tiles(m)[0]!, (n) => n.type === 'button').map(textOf)).toEqual(['NEW', 'DEPLOY', 'PUT IN A CHEST'])
    await m.unmount()
  })

  it('DEPLOY lines it up where you stand and closes the tool; PUT IN A CHEST lines up a chest', async () => {
    const shrine = made('Sky Shrine', SEEN_SINCE + 5)
    useBlueprints.setState({ owner: me, cards: [shrine], toys: [] })
    const m = await mount(createElement(BlueprintLanding, { onCreate: () => {} }))
    await press(buttonIn(tiles(m)[0]!, 'DEPLOY'))
    expect(placed.calls).toEqual([[shrine.rowKey, 'here']])
    expect(useBlueprintTool.getState().open).toBe(false)
    useBlueprintTool.setState({ open: true })
    await press(buttonIn(tiles(m)[0]!, 'PUT IN A CHEST'))
    expect(placed.calls).toEqual([[shrine.rowKey, 'here'], [shrine.rowKey, 'chest']])
    expect(useBlueprintTool.getState().open).toBe(false)
    await m.unmount()
  })

  it('a refusal shows on the tile and the tool stays open', async () => {
    const shrine = made('Sky Shrine', SEEN_SINCE + 5)
    useBlueprints.setState({ owner: me, cards: [shrine], toys: [] })
    placed.refuse = 'Finish or cancel what is lined up first.'
    const m = await mount(createElement(BlueprintLanding, { onCreate: () => {} }))
    await press(buttonIn(tiles(m)[0]!, 'DEPLOY'))
    expect(useBlueprintTool.getState().open).toBe(true)
    const status = under(tiles(m)[0]!, (n) => n.props.role === 'status')[0]!
    expect(textOf(status)).toBe('Finish or cancel what is lined up first.')
    await m.unmount()
  })

  it('the game\'s Compiler blueprint: by ONOSENDAI, NEW when it arrives, no DEPLOY or PUT IN A CHEST but the plain line, and the item mark', async () => {
    const compiler = await gameCard()
    const shrine = made('Sky Shrine', SEEN_SINCE + 5, { prizeKind: 'sno' })
    useBlueprints.setState({ owner: me, cards: [compiler, shrine], toys: [], fresh: new Set([compiler.rowKey]) })
    const m = await mount(createElement(BlueprintLanding, { onCreate: () => {} }))
    const [game, mine] = tiles(m)
    expect(game!.props['data-landing-tile']).toBe(compiler.rowKey)
    expect(textOf(game!)).toContain('The Compilerby ONOSENDAI')
    expect(textOf(game!)).toContain('NEW')
    expect(textOf(game!)).toContain(GAME_NO_DEPLOY)
    expect(under(game!, (n) => n.type === 'button').map(textOf)).toEqual(['NEW'])
    // Every block shown, as the game made it.
    expect(under(game!, (n) => n.type === 'i')[0]!.props['data-shown']).toBe(COMPILER_RECIPE.cells.filter((c) => c > 0).length)
    // The orange mark: outline class and the hammer tab, on the item blueprint only.
    const chamferOf = (t: Host): Host => under(t, (n) => String(n.props.className ?? '').split(' ').includes('chamfer'))[0]!
    expect(String(chamferOf(game!).props.className)).toContain('bp-item')
    expect(under(game!, (n) => n.props.className === 'bp-item-tab')).toHaveLength(1)
    expect(game!.props['data-item']).toBe(true)
    expect(String(chamferOf(mine!).props.className)).not.toContain('bp-item')
    expect(under(mine!, (n) => n.props.className === 'bp-item-tab')).toHaveLength(0)
    expect(textOf(mine!)).not.toContain('NEW')
    await m.unmount()
  })

  it('a tool prize of your own wears the item mark too', async () => {
    const tool = made('Hammer Kit', SEEN_SINCE + 5, { prizeKind: 'tool' })
    useBlueprints.setState({ owner: me, cards: [tool], toys: [] })
    const m = await mount(createElement(BlueprintLanding, { onCreate: () => {} }))
    expect(under(tiles(m)[0]!, (n) => n.props.className === 'bp-item-tab')).toHaveLength(1)
    expect(under(tiles(m)[0]!, (n) => n.type === 'button').map(textOf).filter(Boolean)).toEqual(['DEPLOY', 'PUT IN A CHEST'])
    await m.unmount()
  })

  it('the picture opens EXAMINE, with the maker view for your own', async () => {
    const shrine = made('Sky Shrine', SEEN_SINCE + 5)
    useBlueprints.setState({ owner: me, cards: [shrine], toys: [] })
    const m = await mount(createElement(BlueprintLanding, { onCreate: () => {} }))
    await press(under(tiles(m)[0]!, (n) => n.type === 'button' && n.props['aria-label'] === 'Examine Sky Shrine')[0]!)
    const sheet = m.all().find((h) => h.props['aria-label'] === 'Examine blueprint Sky Shrine')!
    expect(sheet.props['data-maker']).toBe('yes')
    expect(sheet.props['data-item']).toBe('no')
    await m.unmount()
  })

  it('EXAMINE on the game\'s blueprint: by ONOSENDAI, marked as an item, all of it shown', async () => {
    const compiler = await gameCard()
    useBlueprints.setState({ owner: me, cards: [compiler], toys: [] })
    const m = await mount(createElement(BlueprintLanding, { onCreate: () => {} }))
    await press(under(tiles(m)[0]!, (n) => n.type === 'button' && String(n.props['aria-label']).startsWith('Examine The Compiler'))[0]!)
    const sheet = m.all().find((h) => h.props['aria-label'] === 'Examine blueprint The Compiler')!
    expect(sheet.props['data-item']).toBe('yes')
    expect(textOf(sheet)).toBe('by ONOSENDAI')
    await m.unmount()
  })
})
