/**
 * tvBags.test.ts: Cyberspace TV opens bags as a spectator does (arkinox,
 * 2026-10-19). Where an avatar stands on tape, TV derives the keys a player
 * would, to SCAN_MAX_HEIGHT and no further, and shows what is in the bags
 * there as of that moment on tape: shards, keys and chests, never a message
 * or a coin. What it shows is added to your finds, the keys that opened it
 * held, and no place is recorded. The bags here are made and sealed in the
 * test with the real region keys; nothing is published.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const published: unknown[] = []
/** The bags the relay holds: only each one's newest version, as relays keep them. */
const bags: Array<{ kind: number; tags: string[][] }> = []
const asked: string[][] = []
vi.mock('../../lib/relay', () => ({
  publish: vi.fn(async (ev: unknown) => { published.push(ev); return { ok: true } }),
  publishMany: vi.fn(async (_r: string[], ev: unknown) => { published.push(ev); return { ok: true } }),
  query: vi.fn(async (f: { kinds?: number[]; '#d'?: string[] }) => {
    if (!f['#d']) return []
    asked.push(f['#d'])
    return bags.filter((b) => f.kinds?.includes(b.kind) && f['#d']!.includes(b.tags.find((t) => t[0] === 'd')?.[1] ?? ''))
  }),
  queryEach: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import type { Filter } from 'nostr-tools'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { newShard, type ShardModel } from 'sno-core/shards'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { positionHex, type NostrEvent } from '../../lib/events'
import { V2_EPOCH } from '../../lib/tv/tape'
import { regionKeyAt } from '../../lib/shardCrypto'
import { bagTemplate, messageInnerTemplate, shardInnerTemplate } from '../../lib/hidden'
import { nextAd } from '../../lib/tv/hosakaAd'
import { TvPainter, tickerItems, type TvAssets } from '../../scene/tvPainter'
import { TV_SCAN_HEIGHTS, setTvAsk, setTvScan, useTv } from '../useTv'
import { SCAN_MAX_HEIGHT, useShards } from '../useShards'
import { useSecrets } from '../useSecrets'
import { useCeremony } from '../useCeremony'

const A = '1'.repeat(64)
const B = '2'.repeat(64)
let n = 0
const id = (): string => (n++).toString(16).padStart(64, 'f')
const at = (x: bigint) => positionHex({ x, y: 5n, z: 7n }, 0)

function spawnOf(pubkey: string, t: number): NostrEvent {
  return { id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'spawn'], ['C', pubkey]], content: '', sig: '' }
}
function hop(pubkey: string, t: number, from: bigint, to: bigint): NostrEvent {
  return { id: id(), pubkey, created_at: t, kind: 3333, tags: [['A', 'hop'], ['e', '0'.repeat(64), '', 'genesis'], ['e', '0'.repeat(64), '', 'previous'], ['c', at(from)], ['C', at(to)], ['proof', 'a'.repeat(64)]], content: '', sig: '' }
}

const T0 = V2_EPOCH + 1000
// B walks 1000 -> 1003 along x; every place is in the height-2 region based at (1000, 4, 4).
const tape: NostrEvent[] = [
  spawnOf(A, T0),
  hop(B, T0 + 100, 1000n, 1001n),
  hop(B, T0 + 102, 1001n, 1002n),
  hop(B, T0 + 104, 1002n, 1003n),
]

async function ask(f: Filter): Promise<RelayAnswer[]> {
  return [{ url: 'wss://relay.test', outcome: 'answered', events: tape
    .filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (f.since === undefined || e.created_at >= f.since) && (f.until === undefined || e.created_at <= f.until) && (!f.authors || f.authors.includes(e.pubkey)))
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, f.limit ?? Infinity) }]
}

const hider = generateSecretKey()
const place = { x: 1001n, y: 5n, z: 7n }
const relic: ShardModel = { ...newShard('relic'), mode: 'points', unit: 0, vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 2, 3], c: [0, 1, 1] }], faces: [] }

/** A bag sealed to the region of `height` around `place`, signed at `created`. */
async function seal(height: number, created: number, inners: NostrEvent[]): Promise<NostrEvent> {
  const rk = regionKeyAt(place, height, 20)
  return finalizeEvent(await bagTemplate(inners, rk.key, rk.lookupId, height, created), hider) as NostrEvent
}
const shardIn = (): NostrEvent => finalizeEvent(shardInnerTemplate(relic, place, 0, T0), hider) as NostrEvent
const messageIn = (text: string): NostrEvent => finalizeEvent(messageInnerTemplate(text, place, 0, T0), hider) as NostrEvent

let hold: ReturnType<typeof vi.spyOn>
let recordPlace: ReturnType<typeof vi.spyOn>
let addDiscovered: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  bags.length = 0
  asked.length = 0
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
  let calls = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (calls++ % 2 === 0 ? 0 : 0.999))
  setTvAsk(ask)
  setTvScan(null)
  useShards.setState({ discovered: {} })
  useCeremony.setState({ chip: null, births: {} })
  hold = vi.spyOn(useSecrets.getState(), 'hold').mockImplementation(() => {})
  recordPlace = vi.spyOn(useSecrets.getState(), 'recordPlace').mockImplementation(async () => {})
  addDiscovered = vi.spyOn(useShards.getState(), 'addDiscovered')
})

afterEach(() => {
  useTv.getState().stop()
  setTvScan(null)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Play, a tenth of a second at a time, noting what TV had found at each moment on tape. */
async function run(ms: number, seen?: Array<{ t: number | null; found: number }>): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100)
    seen?.push({ t: useTv.getState().tapeTime, found: Object.keys(useTv.getState().found).length })
  }
}

describe('TV opens bags where its avatars stand', () => {
  it('derives keys to SCAN_MAX_HEIGHT and no further, whatever it is given', async () => {
    expect(TV_SCAN_HEIGHTS).toEqual(Array.from({ length: SCAN_MAX_HEIGHT + 1 }, (_, h) => h))
    const heights: number[] = []
    setTvScan({ heights: [0, 1, 30], derive: async (_at, hs) => { heights.push(...hs); return [] } })
    useTv.getState().start()
    await run(9000)
    expect(heights.length).toBeGreaterThan(0)
    expect(Math.max(...heights)).toBe(SCAN_MAX_HEIGHT)
  })

  it('shows a shard and adds it to your finds, its key held, no place recorded, no chip over the tube', async () => {
    const shard = shardIn()
    const bag = await seal(2, T0, [shard, messageIn('a note'), messageIn('cashuBo2FteCJodHRwczovL21pbnQuZXhhbXBsZSJhdWNzYXQ')])
    bags.push(bag)
    useTv.getState().start()
    await run(9000)
    const s = useTv.getState()
    // The shard only: the note and the coin in the same bag are neither shown nor added.
    expect(Object.keys(s.found)).toEqual([shard.id])
    expect(s.found[shard.id].item.type).toBe('shard')
    expect(Object.keys(useShards.getState().discovered)).toEqual([shard.id])
    for (const call of addDiscovered.mock.calls) for (const h of call[0] as Array<{ type: string }>) expect(h.type).not.toBe('message')
    // The key that opened it, held as a scan's are; no place: TV is not where you stood.
    const rk = regionKeyAt(place, 2, 20)
    expect(hold).toHaveBeenCalledTimes(1)
    expect(hold.mock.calls[0][0]).toEqual([expect.objectContaining({ lookupId: rk.lookupId, height: 2, source: 'scan', base: { x: '1000', y: '4', z: '4' } })])
    expect(recordPlace).not.toHaveBeenCalled()
    expect(useCeremony.getState().chip).toBeNull()
    // A line on the ticker instead.
    expect(tickerItems(s, () => 'X')).toContain('FOUND: RELIC')
    expect(published).toEqual([])
  })

  it('shows a bag only from the moment on tape it was signed', async () => {
    const shard = shardIn()
    bags.push(await seal(2, T0 + 103, [shard]))
    useTv.getState().start()
    const seen: Array<{ t: number | null; found: number }> = []
    await run(9000, seen)
    // B stood in the region from T0 + 100; the bag shows once the tape passes T0 + 103.
    expect(seen.some((m) => m.t !== null && m.t >= T0 + 100 && m.t < T0 + 103)).toBe(true)
    for (const m of seen) if (m.t === null || m.t < T0 + 103) expect(m.found).toBe(0)
    expect(Object.keys(useTv.getState().found)).toEqual([shard.id])
  })

  it('never shows a bag whose only version is newer than the tape, nor holds its key', async () => {
    bags.push(await seal(2, T0 + 5000, [shardIn()]))
    useTv.getState().start()
    await run(9000)
    expect(useTv.getState().found).toEqual({})
    expect(useShards.getState().discovered).toEqual({})
    expect(hold).not.toHaveBeenCalled()
  })

  it('shows nothing of a bag of messages, and holds no key for it', async () => {
    bags.push(await seal(1, T0, [messageIn('only words')]))
    useTv.getState().start()
    await run(9000)
    expect(useTv.getState().found).toEqual({})
    expect(useShards.getState().discovered).toEqual({})
    expect(hold).not.toHaveBeenCalled()
  })

  it('does not reach past SCAN_MAX_HEIGHT: a bag one height up stays shut', async () => {
    bags.push(await seal(SCAN_MAX_HEIGHT + 1, T0, [shardIn()]))
    useTv.getState().start()
    await run(9000)
    expect(useTv.getState().found).toEqual({})
    const deeper = regionKeyAt(place, SCAN_MAX_HEIGHT + 1, 20).lookupId
    expect(asked.flat()).not.toContain(deeper)
  })

  it('asks about each region once, and a new tape shows only what it opens itself', async () => {
    bags.push(await seal(2, T0, [shardIn()]))
    useTv.getState().start()
    await run(9000)
    expect(Object.keys(useTv.getState().found)).toHaveLength(1)
    const ids = asked.flat()
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain(regionKeyAt(place, 2, 20).lookupId)
    // A retune empties the picture; the same places are not asked about again.
    useTv.getState().retune()
    expect(useTv.getState().found).toEqual({})
    expect(useTv.getState().finds).toEqual([])
    const before = asked.length
    await run(6000)
    expect(asked.length).toBe(before)
    useTv.getState().stop()
    expect(useTv.getState().found).toEqual({})
  })

  it('scans nothing during the commercial', async () => {
    const derive = vi.fn(async () => [])
    setTvScan({ derive })
    useTv.getState().start()
    // Straight into a break before anything has played.
    useTv.setState({ ad: { at: performance.now(), id: nextAd(null).id } })
    await run(2000)
    expect(derive).not.toHaveBeenCalled()
  })

  it('leaves the sealed bag segment as it was: LOCATION UNKNOWN, with finds on screen', () => {
    const words: string[] = []
    const ctx = new Proxy({ measureText: (t: string) => ({ width: Array.from(t).length * 7 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }), fillText: (t: string) => { words.push(t) } } as Record<string, unknown>, {
      get: (target, key) => (key in target ? target[key as string] : () => {}),
      set: () => true,
    })
    const assets: TvAssets = { name: (pk) => pk.toUpperCase(), picture: () => null, logo: null, spin: null, segmentShard: null, color: () => '#fff' }
    vi.spyOn(performance, 'now').mockReturnValue(1e12)
    const item = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: 'p', at: 1, hint: null, height: 3, money: false, counts: null }
    const shot = { id: item.id, kind: 'bag' as const, item, pubkey: 'p', beats: [], start: 1, end: 1, offsets: [], length: 7 }
    useTv.setState({ shot, status: 'playing', finds: [{ label: 'RELIC', at: 1 }] })
    const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
    p.size(1400, 800, 1)
    p.paint({ ...useTv.getState(), tapeTime: 1 }, assets, 1e12, 1, false)
    expect(words).toContain('A BAG IS SEALED')
    expect(words).toContain('LOCATION UNKNOWN')
    expect(words).toContain('A REGION 2^3 GIBSONS ACROSS')
  })
})
