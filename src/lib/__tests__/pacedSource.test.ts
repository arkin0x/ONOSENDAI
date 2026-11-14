/**
 * pacedSource.test.ts: how the paced clock is fed. The trusted tip is NTH's
 * newest verified anchor (a real one here: 975,741, its header hashed to its
 * H under NTH's signature). Window ends after the epoch (484 on) are asked of
 * NTH alone by `authors` + `#B`, a header used only when it verifies; the
 * header blobs are asked only for what the anchors did not give; and one
 * reading serves a whole frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchFilter, type Filter } from 'nostr-tools'
import anchors from './fixtures/nthTipAnchor.json'
import { headerOfAnchor, HeaderBook, NTH_PUBKEY } from '../seeds/headerBook'
import type { NostrEvent } from '../events'

const events = anchors as unknown as NostrEvent[]
const TIP_EVENT = events.find((e) => e.tags.some((t) => t[0] === 'B' && t[1] === '975741'))!
const asked: Filter[] = []
let served: NostrEvent[] = events
/** The tip the mocked seeds sources report; null for the real 975,741 anchor. */
let fakeTip: { height: number; time: number } | null = null
/** What the blob backstop puts in the book. */
let blobTimes = new Map<number, number>()

vi.mock('../relay', () => ({
  query: async (f: Filter) => { asked.push(f); return served.filter((e) => matchFilter(f, e as never)) },
}))

let book = new HeaderBook()
const fetchSeedHeaders = vi.fn(async (heights: number[]) => {
  for (const h of heights) { const t = blobTimes.get(h); if (t !== undefined) book.add({ height: h, hash: '0'.repeat(64), time: t }) }
})
vi.mock('../seeds/seedSources', () => ({
  get headerBook() { return book },
  refreshTrustedTip: async () => {
    if (fakeTip) { book.add({ height: fakeTip.height, hash: '1'.repeat(64), time: fakeTip.time }); return fakeTip.height }
    const h = headerOfAnchor(TIP_EVENT)
    if (h) book.add(h)
    return h?.height ?? null
  },
  fetchSeedHeaders: (h: number[]) => fetchSeedHeaders(h),
}))

import { feedPaced, pacedState, readPaced, refresh, resetPaced } from '../pacedSource'
import { EPOCH_ENDS, pacedHeight, windowEndHeight } from '../pacedClock'

const END_484 = windowEndHeight(484)
const A484 = 1_795_841_983

beforeEach(() => { resetPaced(); asked.length = 0; served = events; fakeTip = null; blobTimes = new Map(); book = new HeaderBook(); fetchSeedHeaders.mockClear() })
afterEach(() => resetPaced())

describe('feeding the clock', () => {
  it('with the real tip (975,741, below window 484\'s end), the epoch\'s constants are enough: known, nothing more asked', async () => {
    await refresh()
    const st = pacedState()
    expect(st.tip?.height).toBe(975_741)
    expect(st.ends).toEqual(EPOCH_ENDS)
    expect(asked.filter((f) => f['#B'])).toEqual([])
    const t = (st.tip!.time + 600) * 1000
    const r = readPaced('frame', 1, t)
    expect(r.known).toBe(true)
    expect(r.beta).toBeCloseTo(pacedHeight(t / 1000, EPOCH_ENDS), 9)
  })

  it('once the tip is past window 484\'s end, it asks NTH alone for that height by authors and #B', async () => {
    fakeTip = { height: END_484 + 5, time: A484 + 3000 }
    blobTimes.set(END_484, A484)
    await refresh()
    const ends = asked.filter((f) => f['#B'])
    expect(ends.length).toBeGreaterThan(0)
    for (const f of ends) {
      expect(f.authors).toEqual([NTH_PUBKEY])
      expect(f.kinds).toEqual([321])
      expect(f['#B']).toEqual([String(END_484)])
    }
    // No anchor carried it, so the blobs were asked, and their time is taken.
    expect(fetchSeedHeaders).toHaveBeenCalledWith([END_484])
    expect(pacedState().ends).toEqual([...EPOCH_ENDS, A484])
    expect(readPaced('f', 2, (A484 + 3600) * 1000).known).toBe(true)
  })

  it('an anchor for that height from any other key, or one whose header does not hash to H, gives no time: not known', async () => {
    fakeTip = { height: END_484 + 5, time: A484 + 3000 }
    const header = TIP_EVENT.tags.find((t) => t[0] === 'header')![1]
    served = [
      { ...JSON.parse(JSON.stringify(TIP_EVENT)), pubkey: 'ab'.repeat(32), tags: [['B', String(END_484)], ['H', '0'.repeat(64)], ['header', header]] },
      { ...JSON.parse(JSON.stringify(TIP_EVENT)), tags: [['B', String(END_484)], ['H', '0'.repeat(64)], ['header', header]] },
    ]
    await refresh()
    expect(fetchSeedHeaders).toHaveBeenCalledWith([END_484])
    expect(pacedState().ends).toEqual(EPOCH_ENDS)
    // The tip closed window 484 and its end is missing: everything holds still.
    expect(readPaced('f', 3, (A484 + 3600) * 1000).known).toBe(false)
  })

  it('a valid-looking tip anchor whose signature does not verify is no tip', () => {
    // A fresh copy, as a relay hands one over: a spread would carry nostr-tools' verified mark from earlier.
    const forged = { ...JSON.parse(JSON.stringify(TIP_EVENT)), sig: '00'.repeat(64) }
    expect(headerOfAnchor(forged)).toBeNull()
    expect(headerOfAnchor(JSON.parse(JSON.stringify(TIP_EVENT)))?.height).toBe(975_741)
  })

  it('one reading a frame: the same object, worked once', () => {
    feedPaced({ ends: EPOCH_ENDS, tip: { height: 975_741, time: 1_794_634_000 } })
    const a = readPaced('clock', 5, 1_794_634_100_000)
    const beta = a.beta
    const b = readPaced('clock', 5, 1_794_634_999_000)
    expect(b).toBe(a)
    expect(b.beta).toBe(beta)
    expect(readPaced('clock', 6, 1_794_634_101_000).beta).toBeGreaterThan(beta)
  })
})
