/**
 * tvBags.test.ts: Cyberspace TV opens bags as a spectator does (arkinox,
 * 2026-10-19). Where an avatar stands on tape, TV derives the keys a player
 * would, to SCAN_MAX_HEIGHT and no further, and shows what is in the bags
 * there as of that moment on tape: shards, keys and chests, never a message
 * or a coin. What it shows is added to your finds as watched, not played:
 * no chest TV showed opens by itself, and no key it showed opens anything by
 * itself. A key is held and a bag kept only when TV shows the whole bag. No
 * place is recorded and no chip raised. Nothing is scanned under a sealed
 * bag's segment or a hyperjump's line. The bags here are made and sealed in
 * the test with the real region keys; nothing is published.
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
  query: vi.fn(async () => []),
  // The scan asks as RESCAN does: each relay's answer, with a limit.
  queryEach: vi.fn(async (f: { kinds?: number[]; '#d'?: string[]; limit?: number }) => {
    if (!f['#d']) return []
    asked.push(f['#d'])
    const events = bags.filter((b) => f.kinds?.includes(b.kind) && f['#d']!.includes(b.tags.find((t) => t[0] === 'd')?.[1] ?? '')).slice(0, f.limit ?? Infinity)
    return [{ url: 'wss://relay.test', outcome: 'answered', events }]
  }),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import type { Filter } from 'nostr-tools'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard, type ShardModel } from 'sno-core/shards'
import type { RelayAnswer } from '../../lib/relayOutcome'
import { bytesToHex, positionHex, type NostrEvent } from '../../lib/events'
import { V2_EPOCH } from '../../lib/tv/tape'
import { regionKeyAt } from '../../lib/shardCrypto'
import { bagTemplate, chestInnerTemplate, chestItemOf, keyInnerTemplate, messageInnerTemplate, shardInnerTemplate, type ChestItem, type KeyItem } from '../../lib/hidden'
import { openerFor, sealEntries } from '../../lib/chests'
import { heldFromPasted, openingKeys } from '../../lib/inventory'
import { setFoundSink } from '../../lib/foundCache'
import { nextAd } from '../../lib/tv/hosakaAd'
import { cueItem } from '../useTv'
import { TvPainter, tickerItems, type TvAssets } from '../../scene/tvPainter'
import { FIND_LINE_S, TV_SCAN_HEIGHTS, findLines, foundAsOf, sealedSegment, setTvAsk, setTvScan, useTv, type TvFound } from '../useTv'
import { SCAN_MAX_HEIGHT, useShards } from '../useShards'
import { useSecrets } from '../useSecrets'
import { useCeremony } from '../useCeremony'
import { useInventory } from '../useInventory'
import { useCyberspace } from '../useCyberspace'

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
const COIN = 'cashuBo2FteCJodHRwczovL21pbnQuZXhhbXBsZSJhdWNzYXQ'

/** A bag sealed to the region of `height` around `place`, signed at `created`. */
async function seal(height: number, created: number, inners: NostrEvent[]): Promise<NostrEvent> {
  const rk = regionKeyAt(place, height, 20)
  return finalizeEvent(await bagTemplate(inners, rk.key, rk.lookupId, height, created), hider) as NostrEvent
}
const shardIn = (): NostrEvent => finalizeEvent(shardInnerTemplate(relic, place, 0, T0), hider) as NostrEvent
const messageIn = (text: string): NostrEvent => finalizeEvent(messageInnerTemplate(text, place, 0, T0), hider) as NostrEvent

/** A key item, as the composer forges one, and its signed event. */
function keyIn(name: string): { key: KeyItem; event: NostrEvent } {
  const sk = generateSecretKey()
  const key: KeyItem = { name, about: '', itemPubkey: getPublicKey(sk), secretHex: bytesToHex(sk) }
  return { key, event: finalizeEvent(keyInnerTemplate(key, place, 0, T0), hider) as NostrEvent }
}
/** A chest sealed to `lock`, holding `inside`, as the hider's signed event. */
function chestIn(name: string, lock: string, inside: NostrEvent[]): { chest: ChestItem; event: NostrEvent } {
  const sealed = sealEntries(inside, lock)
  const item: ChestItem = { name, lockPubkey: lock, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload }
  const event = finalizeEvent(chestInnerTemplate(item, place, 0, T0), hider) as NostrEvent
  return { chest: chestItemOf(event)!, event }
}

let hold: ReturnType<typeof vi.spyOn>
let recordPlace: ReturnType<typeof vi.spyOn>
let addDiscovered: ReturnType<typeof vi.spyOn>
let kept: Array<{ outer: NostrEvent; watched: boolean }>

beforeEach(() => {
  bags.length = 0
  asked.length = 0
  kept = []
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] })
  let calls = 0
  vi.spyOn(Math, 'random').mockImplementation(() => (calls++ % 2 === 0 ? 0 : 0.999))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  setTvAsk(ask)
  setTvScan(null)
  setFoundSink((outer, _k, _i, _r, _h, _o, watched) => { kept.push({ outer, watched }) })
  useShards.setState({ discovered: {} })
  useInventory.setState({ items: {} })
  useCeremony.setState({ chip: null, births: {} })
  hold = vi.spyOn(useSecrets.getState(), 'hold').mockImplementation(() => {})
  recordPlace = vi.spyOn(useSecrets.getState(), 'recordPlace').mockImplementation(async () => {})
  addDiscovered = vi.spyOn(useShards.getState(), 'addDiscovered')
})

afterEach(() => {
  useTv.getState().stop()
  setTvScan(null)
  setFoundSink(null)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** Play, a tenth of a second at a time, noting what TV had found at each moment on tape. */
async function run(ms: number, seen?: Array<{ t: number | null; found: number }>, each?: () => void): Promise<void> {
  for (let t = 0; t < ms; t += 100) {
    each?.()
    await vi.advanceTimersByTimeAsync(100)
    // Opening a bag is WebCrypto, which answers on the real event loop, not the fake clock.
    await new Promise((r) => setImmediate(r))
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

  it('shows a shard and adds it, but neither holds the key nor keeps a bag it shows only part of', async () => {
    const shard = shardIn()
    bags.push(await seal(2, T0, [shard, messageIn('a note'), messageIn(COIN)]))
    useTv.getState().start()
    await run(9000)
    const s = useTv.getState()
    // The shard only: the note and the coin in the same bag are neither shown nor added.
    expect(Object.keys(s.found)).toEqual([shard.id])
    expect(Object.keys(useShards.getState().discovered)).toEqual([shard.id])
    for (const call of addDiscovered.mock.calls) for (const h of call[0] as Array<{ type: string }>) expect(h.type).not.toBe('message')
    // A held key is scanned again later (RESCAN), and would open the note and the coin.
    expect(hold).not.toHaveBeenCalled()
    expect(kept).toEqual([])
    expect(recordPlace).not.toHaveBeenCalled()
    expect(useCeremony.getState().chip).toBeNull()
    // A line on the ticker instead.
    expect(tickerItems(s, () => 'X')).toContain('FOUND: RELIC')
    expect(published).toEqual([])
  })

  it('holds the key and keeps the bag, as watched, when TV shows the whole bag', async () => {
    const shard = shardIn()
    const bag = await seal(2, T0, [shard])
    bags.push(bag)
    useTv.getState().start()
    await run(9000)
    expect(Object.keys(useTv.getState().found)).toEqual([shard.id])
    const rk = regionKeyAt(place, 2, 20)
    expect(hold).toHaveBeenCalledTimes(1)
    expect(hold.mock.calls[0][0]).toEqual([expect.objectContaining({ lookupId: rk.lookupId, height: 2, source: 'scan', base: { x: '1000', y: '4', z: '4' } })])
    expect(kept).toEqual([{ outer: bag, watched: true }])
    expect(recordPlace).not.toHaveBeenCalled()
    expect(useCeremony.getState().chip).toBeNull()
  })

  it('adds a key and a chest TV showed through the real addDiscovered, and neither opens anything by itself', async () => {
    const { key, event: keyEvent } = keyIn('Wind Key')
    const coinShard = shardIn()
    const { event: chestEvent } = chestIn('Strongbox', key.itemPubkey, [messageIn('behind the door'), messageIn(COIN), coinShard])
    bags.push(await seal(2, T0, [keyEvent, chestEvent]))
    useTv.getState().start()
    await run(9000)
    // The key and the chest, and nothing out of the chest: the key that opens it is in the same bag.
    expect(Object.keys(useTv.getState().found).sort()).toEqual([keyEvent.id, chestEvent.id].sort())
    expect(Object.keys(useShards.getState().discovered).sort()).toEqual([keyEvent.id, chestEvent.id].sort())
    expect(Object.values(useShards.getState().discovered).some((h) => h.type === 'message')).toBe(false)
    expect(useCeremony.getState().chip).toBeNull()
    // The key is held, as watched.
    const held = useInventory.getState().items[keyEvent.id]
    expect(held?.watched).toBe(true)
    useTv.getState().stop()

    // Later, in play, a scan finds another chest that key opens: it stays shut.
    const { event: other } = chestIn('Second box', key.itemPubkey, [messageIn('more words')])
    const door = { ...useShards.getState().discovered[chestEvent.id], eventId: other.id, inner: other, chest: chestItemOf(other)! }
    useShards.getState().addDiscovered([door])
    expect(Object.values(useShards.getState().discovered).some((h) => h.type === 'message')).toBe(false)
    expect(useCeremony.getState().chip).toBeNull()
    // OPEN, your own action, may still use it.
    expect(openerFor(chestItemOf(chestEvent)!, openingKeys(useInventory.getState().items), '')).toMatchObject({ by: 'key' })
    expect(openingKeys(useInventory.getState().items, true)).toEqual([])
  })

  it('leaves a chest TV showed shut, even when a key you hold from play opens it', async () => {
    const { key, event: keyEvent } = keyIn('Played Key')
    const owner = useCyberspace.getState().identity.pubkey
    const row = heldFromPasted(owner, keyEvent, key, true, 1)
    useInventory.setState({ items: { [row.id]: row } })
    const { event: chestEvent } = chestIn('Strongbox', key.itemPubkey, [messageIn('behind the door'), messageIn(COIN)])
    bags.push(await seal(2, T0, [chestEvent]))
    useTv.getState().start()
    await run(9000)
    expect(Object.keys(useShards.getState().discovered)).toEqual([chestEvent.id])
    expect(useCeremony.getState().chip).toBeNull()
    // It waits for OPEN, which that key still answers.
    expect(openerFor(chestItemOf(chestEvent)!, openingKeys(useInventory.getState().items), '')).toMatchObject({ by: 'key' })
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

  it('scans nothing during a hyperjump\'s line, which shows only its two blocks', async () => {
    bags.push(await seal(2, T0, [shardIn()]))
    useTv.getState().start()
    await run(3000, undefined, () => {
      const s = useTv.getState()
      if (s.shot?.pubkey === B) useTv.setState({ jump: { phase: 'line', from: { position: place, plane: 0, height: 1, exact: true }, to: { position: place, plane: 0, height: 2, exact: true } } })
    })
    expect(useTv.getState().shot?.pubkey).toBe(B)
    expect(useTv.getState().found).toEqual({})
    useTv.setState({ jump: null })
    await run(1000)
    expect(Object.keys(useTv.getState().found)).toHaveLength(1)
  })

  it('scans nothing, and shows no FOUND line, under a sealed bag\'s segment', async () => {
    // Due at T0 + 103, while B stands in its region: the sealed segment cued
    // just before then carries the tape past it, with B still on screen.
    bags.push(await seal(2, T0 + 103, [shardIn()]))
    useTv.getState().start()
    for (let i = 0; i < 100 && !(useTv.getState().shot?.pubkey === B && (useTv.getState().tapeTime ?? 0) >= T0 + 102); i++) await run(100)
    expect(useTv.getState().tapeTime).toBe(T0 + 102)
    expect(useTv.getState().found).toEqual({})
    const sealed = { kind: 'bag' as const, id: 'b'.repeat(64), pubkey: A, at: T0 + 150, hint: null, height: 3, money: false, counts: null }
    cueItem(sealed, 5)
    await run(300)
    expect(sealedSegment(useTv.getState().shot)).toBe(true)
    expect(useTv.getState().tapeTime).toBe(T0 + 150)
    await run(4000)
    // Nothing opened under it, though the tape is past the bag and B stands in its region.
    expect(useTv.getState().found).toEqual({})
    // A line already on the ticker is not shown under it either.
    useTv.setState({ finds: [{ label: 'RELIC', at: T0 + 150, bagAt: T0 }] })
    expect(tickerItems(useTv.getState(), () => 'X')).not.toContain('FOUND: RELIC')
    expect(findLines(useTv.getState().finds, T0 + 150, useTv.getState().shot)).toEqual([])
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
    useTv.setState({ shot, status: 'playing', finds: [{ label: 'RELIC', at: 1, bagAt: 1 }] })
    const p = new TvPainter({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement)
    p.size(1400, 800, 1)
    p.paint({ ...useTv.getState(), tapeTime: 1 }, assets, 1e12, 1, false)
    expect(words).toContain('A BAG IS SEALED')
    expect(words).toContain('LOCATION UNKNOWN')
    expect(words).toContain('A REGION 2^3 GIBSONS ACROSS')
  })
})

describe('as of the moment on screen', () => {
  const f = (bagAt: number): TvFound => ({ item: { eventId: `i${bagAt}` } as TvFound['item'], birth: 0, bagAt })

  it('draws only finds whose bag was signed by the tape time, so a MEANWHILE back hides them again', () => {
    const found = { a: f(100), b: f(200) }
    expect(foundAsOf(found, 150).map((x) => x.bagAt)).toEqual([100])
    expect(foundAsOf(found, 250).map((x) => x.bagAt)).toEqual([100, 200])
    expect(foundAsOf(found, 50)).toEqual([])
    expect(foundAsOf(found, null)).toEqual([])
  })

  it('keeps a FOUND line ten minutes of tape time, never before its bag', () => {
    const lines = [{ label: 'OLD', at: 1000, bagAt: 900 }, { label: 'NEW', at: 1500, bagAt: 1400 }]
    expect(findLines(lines, 1000 + FIND_LINE_S, null).map((l) => l.label)).toEqual(['OLD', 'NEW'])
    expect(findLines(lines, 1001 + FIND_LINE_S, null).map((l) => l.label)).toEqual(['NEW'])
    // Back in a MEANWHILE, before NEW's bag.
    expect(findLines(lines, 1200, null).map((l) => l.label)).toEqual(['OLD'])
  })
})
