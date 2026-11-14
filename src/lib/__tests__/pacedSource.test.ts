/**
 * pacedSource.test.ts: how the paced clock is fed. Window ends come from the
 * trusted NTH publisher's own `authors` + `#B` query, a header used only when
 * it hashes to the anchor's H under NTH's signature (real anchors here: the
 * backfilled 973,727 with its header tag, a header-less copy of the same
 * height, and the tip 975,741); the header blobs are asked only for what the
 * anchors did not give; and one reading serves a whole frame.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { matchFilter, type Filter } from 'nostr-tools'
import anchors from './fixtures/nthWindowAnchors.json'
import { headerOfAnchor, HeaderBook, NTH_PUBKEY } from '../seeds/headerBook'
import type { NostrEvent } from '../events'

const events = anchors as unknown as NostrEvent[]
const asked: Filter[] = []
let served: NostrEvent[] = events

vi.mock('../relay', () => ({
  query: async (f: Filter) => { asked.push(f); return served.filter((e) => matchFilter(f, e as never)) },
}))

const book = new HeaderBook()
const fetchSeedHeaders = vi.fn(async (_heights: number[]) => {})
vi.mock('../seeds/seedSources', () => ({
  headerBook: book,
  refreshTrustedTip: async () => {
    const tip = events.find((e) => e.tags.some((t) => t[0] === 'B' && t[1] === '975741'))!
    const h = headerOfAnchor(tip)
    if (h) book.add(h)
    return h?.height ?? null
  },
  fetchSeedHeaders: (h: number[]) => fetchSeedHeaders(h),
}))

import { feedPaced, pacedState, readPaced, refresh, resetPaced } from '../pacedSource'
import { EPOCH_END_TIME, pacedHeight } from '../pacedClock'

beforeEach(() => { resetPaced(); asked.length = 0; served = events; fetchSeedHeaders.mockClear() })
afterEach(() => resetPaced())

describe('feeding the clock', () => {
  it('asks NTH by authors and #B for the window ends below the tip, and takes the header-tagged anchor', async () => {
    await refresh()
    const ends = asked.filter((f) => f['#B'])
    expect(ends.length).toBeGreaterThan(0)
    for (const f of ends) {
      expect(f.authors).toEqual([NTH_PUBKEY])
      expect(f.kinds).toEqual([321])
      expect(f['#B']).toEqual(['973727'])
    }
    const st = pacedState()
    expect(st.ends).toEqual([EPOCH_END_TIME, 1_793_300_370])
    expect(st.tip?.height).toBe(975_741)
    expect(fetchSeedHeaders).not.toHaveBeenCalled()
    // Known, and on the note's numbers, shortly after the tip.
    const t = (st.tip!.time + 600) * 1000
    const r = readPaced('frame', 1, t)
    expect(r.known).toBe(true)
    expect(r.beta).toBeCloseTo(pacedHeight(t / 1000, st.ends), 9)
  })

  it('a header that does not hash to H, or an anchor not signed by NTH, gives no time: the blobs are asked instead', async () => {
    served = events.map((e) => {
      if (!e.tags.some((t) => t[0] === 'B' && t[1] === '973727')) return e
      // The header's last byte changed: it no longer hashes to H.
      return { ...e, tags: e.tags.map((t) => (t[0] === 'header' ? ['header', t[1].slice(0, -2) + '00'] : t)) }
    })
    await refresh()
    expect(fetchSeedHeaders).toHaveBeenCalledWith([973_727])
    expect(pacedState().ends).toEqual([EPOCH_END_TIME])
    // Not known: the tip closed window 482 and its end is missing, so everything holds still.
    expect(readPaced('frame', 2, (pacedState().tip!.time + 60) * 1000).known).toBe(false)
  })

  it('one reading a frame: the same object, worked once', () => {
    feedPaced({ ends: [EPOCH_END_TIME, 1_793_300_370], tip: { height: 975_741, time: 1_794_634_000 } })
    const a = readPaced('clock', 5, 1_794_634_100_000)
    const beta = a.beta
    const b = readPaced('clock', 5, 1_794_634_999_000)
    expect(b).toBe(a)
    expect(b.beta).toBe(beta)
    expect(readPaced('clock', 6, 1_794_634_101_000).beta).toBeGreaterThan(beta)
  })
})
