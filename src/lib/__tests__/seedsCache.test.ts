/**
 * seedsCache.test.ts: seeds start from what the last visit kept (DECK-0008
 * §4.1, §4.2). A refresh with headers and settled planted heights kept in
 * IndexedDB grows a seed at once, with no relay asked and never "waiting for
 * blocks"; a newer NTH anchor moves it on by a generation; an empty cache
 * still waits for blocks; a newer anchor for a height kept replaces it, and
 * the tip never goes lower than the one kept. A read nobody answered does not
 * mark heights absent. fake-indexeddb, mock relays, the grower inline: no
 * network.
 */

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import anchor975256 from './vectors/nth-anchor-975256.json'
import type { NostrEvent } from '../events'
import { crystalDna, mineSeedEvent } from './seedsFixture'
import { seedItemOf } from '../seeds/seedItem'
import { DESKTOP_BUDGET } from '../seeds/bloomBudget'
import type { BloomStatus, BloomView } from '../seeds/bloomEngine'
import { bloomStateLine } from '../seeds/bloomWords'
import { fetchAnchorHeaders, HeaderBook } from '../seeds/headerBook'

const query = vi.fn<(filter: Record<string, unknown>) => Promise<NostrEvent[]>>()
const queryEach = vi.fn<(filter: Record<string, unknown>) => Promise<Array<{ url: string; outcome: string; events: NostrEvent[] }>>>()
vi.mock('../relay', () => ({
  query: (f: Record<string, unknown>) => query(f),
  queryEach: (f: Record<string, unknown>) => queryEach(f),
  publishMany: vi.fn(),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../hyperspace/headerSync', () => ({ fetchManifest: async () => null, blobUrl: (m: string, f: string) => `${m}/${f}` }))

const anchor = (): NostrEvent => JSON.parse(JSON.stringify(anchor975256)) as NostrEvent
const ANCHOR_HEIGHT = 975256
const synthetic = (h: number): string => (h.toString(16).padStart(8, '0')).repeat(8)

const crystal = crystalDna()
// Planted three days below the real anchor: day 2 at the kept tip, day 3 at the anchor.
const P = ANCHOR_HEIGHT - 3 * 144
const KEPT_TIP = ANCHOR_HEIGHT - 50
const seedEvent = mineSeedEvent({ dnaId: crystal.id, planted: P, at: { x: 77_000n, y: 1_200n, z: 33n }, plane: 0, createdAt: 1_793_000_000 })
const seed = seedItemOf(seedEvent)!

/** Rows straight into the seeds database, as an earlier visit would have left them. */
async function keep(headers: Array<{ height: number; hash: string; time: number }>, planted: Array<{ id: string; height: number; E: number | null; F: number; clock: number }> = []): Promise<void> {
  const db = await import('../seeds/seedsDb')
  await db.saveHeaders(headers)
  await db.savePlanted(planted)
}

async function loadEngine() {
  const s = await import('../seeds/seedSources')
  const { BloomEngine } = await import('../seeds/bloomEngine')
  const { growInWorker, resetInlineGrowth } = await import('../seeds/growClient')
  resetInlineGrowth()
  s.dnaResolver.hold([crystal])
  const seen: BloomStatus[] = []
  const views = new Map<string, BloomView>()
  const fetchHeaders = vi.fn(s.fetchSeedHeaders)
  const engine = new BloomEngine({
    dna: s.dnaResolver,
    book: s.headerBook,
    fetchHeaders,
    tip: s.trustedTip,
    grow: growInWorker,
    budget: DESKTOP_BUDGET,
    onView: (id, v) => { views.set(id, v); seen.push(v.status) },
    ready: s.headersReady,
    settledBefore: s.settledBefore,
    noteSettled: s.noteSettled,
  })
  return { s, engine, views, seen, fetchHeaders }
}

beforeEach(() => {
  vi.resetModules()
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  query.mockReset()
  queryEach.mockReset()
  query.mockResolvedValue([])
  queryEach.mockImplementation(async (f) => [{ url: 'wss://relay.test', outcome: 'answered', events: await query(f) }])
})

describe('a refresh with a cache', () => {
  it('grows the seed at once from the kept tip and planted height: no relay asked, never waiting for blocks', async () => {
    await keep(
      [P + 144, P + 288, KEPT_TIP].map((h) => ({ height: h, hash: synthetic(h), time: 1_793_000_000 + (h - P) * 600 })),
      [{ id: seed.id, height: P, E: P - 3, F: P + 12, clock: P + 30 }],
    )
    const { s, engine, views, seen, fetchHeaders } = await loadEngine()
    engine.want([seed])
    await engine.refresh(seed.id)
    const v = views.get(seed.id)!
    expect(v.status).toBe('grown')
    expect(v.clock).toBe(KEPT_TIP)
    expect(v.planted).toBe(P)
    expect(v.growth?.generation).toBe(2)
    expect(v.growth?.behind).toBeFalsy()
    expect(seen).not.toContain('no-clock')
    expect(seen).not.toContain('waiting')
    expect(query).not.toHaveBeenCalled()
    expect(queryEach).not.toHaveBeenCalled()
    expect(fetchHeaders).not.toHaveBeenCalled()
    expect(s.trustedTip()).toBe(KEPT_TIP)
  })

  it('a newer NTH anchor moves it on a generation, and its header is kept for the next visit', async () => {
    await keep(
      [P + 144, P + 288, KEPT_TIP].map((h) => ({ height: h, hash: synthetic(h), time: 1_793_000_000 + (h - P) * 600 })),
      [{ id: seed.id, height: P, E: P - 3, F: P + 12, clock: P + 30 }],
    )
    const { s, engine, views } = await loadEngine()
    engine.want([seed])
    await engine.refresh(seed.id)
    expect(views.get(seed.id)!.growth?.generation).toBe(2)
    query.mockResolvedValue([anchor()])
    expect(await s.refreshTrustedTip(null, Date.now() + 10 * 60_000)).toBe(ANCHOR_HEIGHT)
    await engine.refresh(seed.id)
    const v = views.get(seed.id)!
    expect(v.clock).toBe(ANCHOR_HEIGHT)
    expect(v.growth?.generation).toBe(3)
    expect(v.growth?.behind).toBeFalsy()
    await new Promise((r) => setTimeout(r, s.SAVE_DELAY_MS + 100))
    const db = await import('../seeds/seedsDb')
    const rows = await db.loadHeaders()
    expect(rows.find((r) => r.height === ANCHOR_HEIGHT)?.hash).toBe(s.headerBook.hash(ANCHOR_HEIGHT))
  })

  it('a seed settled this visit is kept, and the next visit reads no header for its clamp', async () => {
    const { s } = await loadEngine()
    s.noteSettled({ id: seed.id, height: P, E: P - 3, F: P + 12, clock: KEPT_TIP })
    await new Promise((r) => setTimeout(r, 50))
    vi.resetModules()
    const again = await import('../seeds/seedSources')
    await again.headersReady()
    expect(again.settledBefore(seed.id)).toMatchObject({ height: P, clock: KEPT_TIP })
  })
})

describe('an empty cache', () => {
  it('waits for blocks until NTH answers', async () => {
    const { engine, views } = await loadEngine()
    engine.want([seed])
    await engine.refresh(seed.id)
    const v = views.get(seed.id)!
    expect(v.status).toBe('no-clock')
    expect(bloomStateLine(v)).toBe('Waiting for blocks.')
  })

  it('a tip still unknown is asked for again in seconds, not minutes', async () => {
    const s = await import('../seeds/seedSources')
    const t0 = 1_000_000_000
    expect(await s.refreshTrustedTip(null, t0)).toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
    query.mockResolvedValue([anchor()])
    expect(await s.refreshTrustedTip(null, t0 + s.TIP_RETRY_MS + 1)).toBe(ANCHOR_HEIGHT)
    expect(query).toHaveBeenCalledTimes(2)
  })
})

describe('a reorganization', () => {
  it('a newer anchor for a kept height replaces the kept header, here and in IndexedDB', async () => {
    await keep([{ height: ANCHOR_HEIGHT, hash: 'aa'.repeat(32), time: 1_793_100_000 }])
    const s = await import('../seeds/seedSources')
    await s.headersReady()
    expect(s.headerBook.hash(ANCHOR_HEIGHT)).toBe('aa'.repeat(32))
    query.mockResolvedValue([anchor()])
    await s.refreshTrustedTip(null, Date.now() + 10 * 60_000)
    const fresh = s.headerBook.hash(ANCHOR_HEIGHT)
    expect(fresh).not.toBe('aa'.repeat(32))
    await new Promise((r) => setTimeout(r, s.SAVE_DELAY_MS + 100))
    const db = await import('../seeds/seedsDb')
    expect((await db.loadHeaders()).find((r) => r.height === ANCHOR_HEIGHT)?.hash).toBe(fresh)
  })

  it('the tip never goes lower than the one kept, so growth never goes back', async () => {
    await keep([{ height: ANCHOR_HEIGHT + 40, hash: synthetic(ANCHOR_HEIGHT + 40), time: 1_793_100_000 }])
    const s = await import('../seeds/seedSources')
    await s.headersReady()
    expect(s.trustedTip()).toBe(ANCHOR_HEIGHT + 40)
    query.mockResolvedValue([anchor()])
    expect(await s.refreshTrustedTip(null, Date.now() + 10 * 60_000)).toBe(ANCHOR_HEIGHT + 40)
    expect(s.trustedTip()).toBe(ANCHOR_HEIGHT + 40)
  })
})

describe('the store itself', () => {
  it('keeps at most HEADERS_KEPT headers, the lowest heights going first', async () => {
    const db = await import('../seeds/seedsDb')
    await db.saveHeaders(Array.from({ length: 30 }, (_, i) => ({ height: 1000 + i, hash: synthetic(1000 + i), time: 1_700_000_000 + i })))
    const kept = await db.loadHeaders(10)
    expect(kept.map((r) => r.height)).toEqual(Array.from({ length: 10 }, (_, i) => 1020 + i))
    await new Promise((r) => setTimeout(r, 20))
    expect((await db.loadHeaders()).length).toBe(10)
  })

  it('a malformed row is skipped, never believed', async () => {
    const db = await import('../seeds/seedsDb')
    await db.saveHeaders([{ height: 5, hash: 'nothex', time: 1 }, { height: 6, hash: synthetic(6), time: 1_700_000_000 }])
    expect((await db.loadHeaders()).map((r) => r.height)).toEqual([6])
  })
})

describe('a read nobody answered', () => {
  it('marks nothing absent, so the next pass asks again', async () => {
    const book = new HeaderBook()
    await fetchAnchorHeaders(book, [975300, 975301], async () => ({ events: [], answered: false }))
    expect(book.isAbsent(975300)).toBe(false)
    await fetchAnchorHeaders(book, [975300, 975301], async () => ({ events: [], answered: true }))
    expect(book.isAbsent(975300)).toBe(true)
  })
})
