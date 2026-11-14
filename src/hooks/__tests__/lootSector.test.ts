/**
 * lootSector.test.ts - HIDDEN BAGS, your sector first (owner, 2026-11-14).
 *
 * The list read only the newest LOOT_BACKFILL bags from anywhere. Now a
 * second read asks for the bags whose hint names the sector you stand in
 * (`#S` "sx-sy-sz", spec §7.7, §10: a hinted bag carries its hint's sector
 * tags, an unhinted one none), its bags join the same list once each, and the
 * panel puts them first. Your sector changing reads again; the same sector
 * does not. Every backfill (RETRY, a sign-in, the connection back) asks for
 * your sector's too, and a sector read the canonical relay refused is trouble
 * asked again, as the newest bags' is. No network: the relay is a stand-in.
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

type Ev = { id: string; created_at: number; sector?: string }
/** The newest bags from anywhere, and the bags hinted into each sector. */
const relay = vi.hoisted(() => ({
  newest: [] as Ev[],
  bySector: {} as Record<string, Ev[]>,
  /** How the canonical relay answers a sector read next: null is an answer. */
  sectorTrouble: null as null | 'auth' | 'unreachable',
  asked: [] as Array<Record<string, unknown>>,
  signIn: [] as Array<() => void>,
}))

vi.mock('../../lib/relay', () => ({
  query: vi.fn(async () => []),
  queryChecked: vi.fn(async (filter: Record<string, unknown>) => {
    relay.asked.push(filter)
    const s = (filter['#S'] as string[] | undefined)?.[0]
    if (s === undefined) return { events: [...relay.newest], trouble: null }
    return relay.sectorTrouble ? { events: [], trouble: relay.sectorTrouble } : { events: [...(relay.bySector[s] ?? [])], trouble: null }
  }),
  subscribe: vi.fn(() => () => {}),
  onCanonicalSignIn: vi.fn((fn: () => void) => { relay.signIn.push(fn); return () => {} }),
  onResume: vi.fn(() => () => {}),
}))

vi.mock('../../lib/loot', async () => {
  const actual = await vi.importActual<typeof import('../../lib/loot')>('../../lib/loot')
  return { ...actual, summarizeBag: (ev: Ev) => ({ key: ev.id, bagId: ev.id, createdAt: ev.created_at, sector: ev.sector ?? null, bytes: 10 } as never) }
})

import { HIDDEN_KIND } from '../../lib/hidden'
import { hintedSector } from '../../lib/loot'
import { hintTags } from '../../lib/hint'
import { LOOT_BACKFILL, ensureLoot, refreshLoot, sectorFirst, sectorOf, setLootSector, useLootStore } from '../useLoot'

const sectorReads = (): string[] => relay.asked.filter((f) => f['#S']).map((f) => (f['#S'] as string[])[0])
const keys = (): string[] => useLootStore.getState().items.map((i) => i.key)
let n = 0

beforeEach(() => {
  relay.newest = []
  relay.bySector = {}
  relay.sectorTrouble = null
  relay.asked = []
  localStorage.clear()
  // A fresh relay set each test: ensureLoot reads only once per set.
  n++
  useLootStore.setState({ items: [], status: 'loading', source: '', trouble: null, sector: null })
})

describe('your sector\'s bags join the list', () => {
  it('asks for the bags hinted into your sector, and they join the newest once each', async () => {
    relay.newest = [{ id: 'new1', created_at: 50 }, { id: 'here1', created_at: 40, sector: '1-2-3' }]
    // Old bags in your sector the newest 500 left out.
    relay.bySector['1-2-3'] = [{ id: 'here1', created_at: 40, sector: '1-2-3' }, { id: 'old-here', created_at: 1, sector: '1-2-3' }]
    ensureLoot([`wss://r${n}`])
    setLootSector('1-2-3')
    await vi.waitFor(() => { expect(keys()).toContain('old-here') })
    await vi.waitFor(() => { expect(useLootStore.getState().status).toBe('ready') })
    expect(keys().sort()).toEqual(['here1', 'new1', 'old-here'])
    const filter = relay.asked.find((f) => f['#S'])!
    expect(filter).toEqual({ kinds: [HIDDEN_KIND], '#S': ['1-2-3'], limit: LOOT_BACKFILL })
  })

  it('reads again when your sector changes, and not for the same sector', async () => {
    relay.bySector['1-2-3'] = [{ id: 'a', created_at: 5, sector: '1-2-3' }]
    relay.bySector['1-2-4'] = [{ id: 'b', created_at: 6, sector: '1-2-4' }]
    ensureLoot([`wss://r${n}`])
    setLootSector('1-2-3')
    await vi.waitFor(() => { expect(keys()).toContain('a') })
    setLootSector('1-2-3')
    expect(sectorReads()).toEqual(['1-2-3'])
    setLootSector('1-2-4')
    await vi.waitFor(() => { expect(keys()).toContain('b') })
    expect(sectorReads()).toEqual(['1-2-3', '1-2-4'])
    expect(useLootStore.getState().sector).toBe('1-2-4')
  })

  it('RETRY reads your sector\'s bags again with the newest', async () => {
    ensureLoot([`wss://r${n}`])
    setLootSector('7-7-7')
    await vi.waitFor(() => { expect(useLootStore.getState().status).toBe('ready') })
    relay.bySector['7-7-7'] = [{ id: 'late', created_at: 9, sector: '7-7-7' }]
    refreshLoot()
    await vi.waitFor(() => { expect(keys()).toContain('late') })
    expect(sectorReads()).toEqual(['7-7-7', '7-7-7'])
  })

  it('a sector read the canonical relay refused is trouble, and the relay signing this visit in reads it again', async () => {
    relay.newest = [{ id: 'new1', created_at: 50 }]
    relay.sectorTrouble = 'auth'
    ensureLoot([`wss://r${n}`])
    await vi.waitFor(() => { expect(useLootStore.getState().status).toBe('ready') })
    setLootSector('1-1-1')
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe('auth') })
    // The newest bags stay on screen meanwhile.
    expect(keys()).toEqual(['new1'])
    relay.sectorTrouble = null
    relay.bySector['1-1-1'] = [{ id: 'here', created_at: 3, sector: '1-1-1' }]
    for (const fn of relay.signIn) fn()
    await vi.waitFor(() => { expect(keys()).toContain('here') })
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe(null) })
  })
})

describe('a refused sector read is not lost to a backfill that began before it', () => {
  it('a backfill begun before your sector was known, answered after its refusal, leaves the trouble and its retry', async () => {
    relay.newest = [{ id: 'new1', created_at: 50 }]
    relay.sectorTrouble = 'auth'
    // The newest bags' answer is held back until the sector read has been refused.
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    const { queryChecked } = await import('../../lib/relay')
    const real = vi.mocked(queryChecked).getMockImplementation()!
    vi.mocked(queryChecked).mockImplementationOnce(async (f) => { await held; return real(f) })
    ensureLoot([`wss://r${n}`])
    setLootSector('2-2-2')
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe('auth') })
    release()
    await vi.waitFor(() => { expect(keys()).toContain('new1') })
    // Still trouble: the backfill never asked about 2-2-2.
    expect(useLootStore.getState().trouble).toBe('auth')
    // And the relay signing this visit in reads it again.
    relay.sectorTrouble = null
    relay.bySector['2-2-2'] = [{ id: 'here', created_at: 3, sector: '2-2-2' }]
    for (const fn of relay.signIn) fn()
    await vi.waitFor(() => { expect(keys()).toContain('here') })
    await vi.waitFor(() => { expect(useLootStore.getState().trouble).toBe(null) })
  })

  it('a late refusal for a sector already left is no trouble', async () => {
    relay.newest = [{ id: 'new1', created_at: 50 }]
    ensureLoot([`wss://r${n}`])
    await vi.waitFor(() => { expect(useLootStore.getState().status).toBe('ready') })
    let release: () => void = () => {}
    const held = new Promise<void>((r) => { release = r })
    const { queryChecked } = await import('../../lib/relay')
    vi.mocked(queryChecked).mockImplementationOnce(async () => { await held; return { events: [], trouble: 'auth' } })
    setLootSector('3-3-3')
    setLootSector('3-3-4')
    await vi.waitFor(() => { expect(sectorReads()).toContain('3-3-4') })
    release()
    await new Promise((r) => setTimeout(r, 20))
    expect(useLootStore.getState().trouble).toBe(null)
  })
})

describe('the order the panel shows', () => {
  const item = (key: string, sector: string | null) => ({ key, sector } as never)

  it('your sector first, then everything else as it was; a bag without a hint is elsewhere', () => {
    const items = [item('n1', null), item('h1', '1-2-3'), item('o1', '9-9-9'), item('h2', '1-2-3'), item('n2', null)]
    const { here, elsewhere } = sectorFirst(items, '1-2-3')
    expect(here.map((i: { key: string }) => i.key)).toEqual(['h1', 'h2'])
    expect(elsewhere.map((i: { key: string }) => i.key)).toEqual(['n1', 'o1', 'n2'])
    expect(sectorFirst(items, null).here).toEqual([])
    expect(sectorFirst(items, null).elsewhere).toBe(items)
  })

  it('names your sector as a hinted bag names its own', () => {
    const at = { x: (5n << 30n) + 17n, y: (6n << 30n) + 99n, z: (7n << 30n) + 3n }
    expect(sectorOf(at)).toBe('5-6-7')
    // A hint at that place, at a sector-sized box or smaller, names the same sector, as its S tag does.
    const tags = hintTags(at, 0, [10, 10, 10])
    expect(hintedSector(tags, 0)).toBe(sectorOf(at))
    expect(tags.find((t) => t[0] === 'S')?.[1]).toBe(sectorOf(at))
  })
})
