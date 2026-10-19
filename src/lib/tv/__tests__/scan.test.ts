/**
 * scan.test.ts: Cyberspace TV's scan derives each region once, asks the
 * relays once per new set of regions, shows a bag only as of its moment on
 * tape, only shards, keys and chests, and fades what stands in front of the
 * shot's avatar.
 */
import { describe, expect, it, vi } from 'vitest'
import type { NostrEvent } from '../../events'
import type { Hidden } from '../../hidden'
import type { Position } from '../../space'
import { TvScanner, bagAsOf, cellOf, coversSubject, newestPerAddress, scanHeights, tvShows, type ScanDeps } from '../scan'

const P = (x: bigint): Position => ({ x, y: 4n, z: 4n })
const bag = (d: string, created_at: number, pubkey = 'a'.repeat(64), id = `${d}-${created_at}`): NostrEvent =>
  ({ id, pubkey, created_at, kind: 33330, tags: [['d', d]], content: '', sig: '' })
const item = (type: Hidden['type'], eventId: string): Hidden =>
  ({ eventId, bagId: 'b', lookupId: 'l', author: 'a', at: P(0n), plane: 0, height: 0, createdAt: 0, type })

/** A deriver whose lookup id names the region, so a test can address one. */
function deps(over: Partial<ScanDeps> = {}): ScanDeps & { derive: ReturnType<typeof vi.fn>; query: ReturnType<typeof vi.fn> } {
  return {
    heights: scanHeights(12),
    derive: vi.fn(async (at: Position, heights: number[]) => heights.map((h) => ({ height: h, lookupId: `L${cellOf(at, h)}`, keyHex: '00'.repeat(32) }))),
    query: vi.fn(async () => [] as NostrEvent[]),
    open: vi.fn(async () => ({ items: [item('shard', 's1')], refs: {} })),
    batch: 150,
    ...over,
  } as never
}

describe('what TV shows', () => {
  it('is a shard, a key or a chest, never a message (a coin is a message)', () => {
    expect(['shard', 'key', 'chest'].map((t) => tvShows({ type: t as Hidden['type'] }))).toEqual([true, true, true])
    expect(tvShows({ type: 'message' })).toBe(false)
  })

  it('counts a bag only from when it was signed: its newest version, its last change', () => {
    expect(bagAsOf({ created_at: 100 }, 99)).toBe(false)
    expect(bagAsOf({ created_at: 100 }, 100)).toBe(true)
    const old = bag('d', 100, 'a'.repeat(64), 'x1')
    const newer = bag('d', 200, 'a'.repeat(64), 'x2')
    const someoneElse = bag('d', 50, 'b'.repeat(64), 'x3')
    expect(newestPerAddress([old, newer, someoneElse]).map((e) => e.id).sort()).toEqual(['x2', 'x3'])
  })

  it('scans the heights a player does, 0 up to the cap and no further', () => {
    expect(scanHeights(12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

describe('TvScanner', () => {
  it('derives each region once and asks about it once, in one question per new set', async () => {
    const d = deps()
    const s = new TvScanner(d)
    await s.prepare([{ position: P(1000n), plane: 0 }, { position: P(1001n), plane: 0 }])
    // 1000 and 1001 share every region from height 1 up: 13 + 1 derived.
    const derived = d.derive.mock.calls.reduce((n, c) => n + (c[1] as number[]).length, 0)
    expect(derived).toBe(14)
    expect(d.query).toHaveBeenCalledTimes(1)
    expect((d.query.mock.calls[0][0] as string[]).length).toBe(14)
    // Back to a place already scanned: nothing derived, nothing asked.
    await s.prepare([{ position: P(1000n), plane: 0 }])
    expect(d.derive).toHaveBeenCalledTimes(2)
    expect(d.query).toHaveBeenCalledTimes(1)
  })

  it('splits a long question into batches', async () => {
    const d = deps({ batch: 5 })
    const s = new TvScanner(d)
    await s.prepare([{ position: P(1000n), plane: 0 }])
    expect(d.query.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([5, 5, 3])
  })

  it('asks again later about a question no relay answered', async () => {
    const d = deps()
    d.query.mockRejectedValueOnce(new Error('down'))
    const s = new TvScanner(d)
    await s.prepare([{ position: P(1000n), plane: 0 }])
    await s.prepare([{ position: P(1000n), plane: 0 }])
    expect(d.query).toHaveBeenCalledTimes(2)
  })

  it('shows a bag at a place only as of its moment on tape, and only what TV draws of it', async () => {
    const region = `L${cellOf(P(1000n), 3)}`
    const d = deps({
      query: vi.fn(async (ids: string[]) => (ids.includes(region) ? [bag(region, 500)] : [])),
      open: vi.fn(async () => ({ items: [item('shard', 's1'), item('message', 'm1'), item('chest', 'c1')], refs: {} })),
    })
    const s = new TvScanner(d)
    await s.prepare([{ position: P(1000n), plane: 0 }])
    expect(s.at(P(1000n), 499)).toEqual([])
    const [o] = s.at(P(1000n), 500)
    expect(o.items.map((h) => h.eventId)).toEqual(['s1', 'c1'])
    // A message in it: never shown, and the bag is not kept whole.
    expect(o.whole).toBe(false)
    expect(o.key).toMatchObject({ lookupId: region, height: 3, base: { x: 1000n, y: 0n, z: 0n }, plane: 0 })
    // Elsewhere in the same region of height 3, the same bag.
    expect(s.at(P(1007n), 600)).toHaveLength(1)
    expect(s.at(P(1008n), 600)).toEqual([])
  })

  it('remembers at most maxCells regions, the oldest going first with their bags', async () => {
    const region = `L${cellOf(P(1000n), 0)}`
    const d = deps({ maxCells: 20, query: vi.fn(async (ids: string[]) => (ids.includes(region) ? [bag(region, 1)] : [])) })
    const s = new TvScanner(d)
    await s.prepare([{ position: P(1000n), plane: 0 }])
    expect(s.at(P(1000n), 10)).toHaveLength(1)
    // Far away: 13 new regions, past the cap; the first place's go, its bag with them.
    await s.prepare([{ position: P(1n << 40n), plane: 0 }])
    expect(s.size).toBeLessThanOrEqual(20)
    expect(s.at(P(1000n), 10)).toEqual([])
    // Back there: derived and asked about again.
    await s.prepare([{ position: P(1000n), plane: 0 }])
    expect(s.at(P(1000n), 10)).toHaveLength(1)
  })

  it('keeps nothing of a bag with only messages in it', async () => {
    const region = `L${cellOf(P(1000n), 0)}`
    const d = deps({
      query: vi.fn(async () => [bag(region, 1)]),
      open: vi.fn(async () => ({ items: [item('message', 'm1')], refs: {} })),
    })
    const s = new TvScanner(d)
    await s.prepare([{ position: P(1000n), plane: 0 }])
    expect(s.at(P(1000n), 10)).toEqual([])
    expect(s.version).toBe(0)
  })
})

describe('coversSubject', () => {
  const eye = [0, 0, 10]
  const subject = [0, 0, 0]
  it('is true for something on the line of sight in front of the avatar', () => {
    expect(coversSubject(eye, subject, 0.5, [0, 0, 5], 0.5)).toBe(true)
    expect(coversSubject(eye, subject, 0.5, [0.6, 0, 5], 0.5)).toBe(true)
  })
  it('is false off to the side, behind the avatar, or behind the camera', () => {
    expect(coversSubject(eye, subject, 0.5, [3, 0, 5], 0.5)).toBe(false)
    expect(coversSubject(eye, subject, 0.5, [0, 0, -3], 0.5)).toBe(false)
    expect(coversSubject(eye, subject, 0.5, [0, 0, 14], 0.5)).toBe(false)
  })
  it('is true for something the avatar stands inside, or the camera does', () => {
    expect(coversSubject(eye, subject, 0.5, [0, 0, 0], 4)).toBe(true)
    expect(coversSubject(eye, subject, 0.5, [0, 0, 10], 2)).toBe(true)
  })
})
