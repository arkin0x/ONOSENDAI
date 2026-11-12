/**
 * seedsClock.test.ts: the seeds clock (DECK-0008 §4.1, §4.2). Header times
 * come only from verified headers (DECK-0001 §2.5): an NTH anchor whose
 * header hashes to its H and whose signature is NTH's (a real one, block
 * 975,256, copied from the relay), or a header blob whose chain ends at its
 * checkpoint. The planted-height clamp, fed injected headers, gives the
 * vectors' E, F and effective heights; a missing header leaves the seed
 * waiting for blocks rather than failing. No network: queries are mocks.
 */

import { describe, expect, it, vi } from 'vitest'
import { clockHeight } from 'sno-core/seeds'
import anchor975256 from './vectors/nth-anchor-975256.json'
import { blobChainTimes, fetchAnchorHeaders, headerOfAnchor, HeaderBook, NTH_PUBKEY, B_PER_QUERY } from '../seeds/headerBook'
import { clockAtAnchor, predictedHeights, settlePlanted } from '../seeds/seedClock'
import { reverse32, sha256d, writeRecord, wireHeader, HEADER_RECORD_SIZE } from '../hyperspace/headers'
import { bytesToHex, type NostrEvent } from '../events'
import { clampTimes, vectors } from './seedsFixture'

const SPEC_H = '0000000000000000000132b722697381ee70f3c565ed8c2168ef68d54e3b4f04'
const SPEC_HEADER = '00a04b20f3f9aa1aaa2bb91f5d8acd5112a3c428814c3e4087ff0100000000000000000042ab8f9c176bd1993227e826305521f4c23f96b9dfb66354b08bab9f8a004d309297e36a9300021765ed2b3c'
const yes = (): boolean => true

function anchorOf(tags: string[][], pubkey = NTH_PUBKEY): NostrEvent {
  return { id: '00'.repeat(32), sig: '00'.repeat(64), kind: 321, pubkey, created_at: 1, content: '', tags }
}

describe('the clock height (§4.1)', () => {
  it('is NTH\'s newest anchor itself: NTH publishes a block only once it is 6 deep, so 6 more are not taken', () => {
    expect(clockAtAnchor(975256)).toBe(975256)
    // The same block a reader that saw the real tip would read: NTH's gate puts that tip 6 or more above its newest anchor.
    expect(clockAtAnchor(975256)).toBe(clockHeight(975256 + 6))
  })
})

describe('a header from an NTH anchor (DECK-0001 §2.5)', () => {
  it('the real anchor of block 975,256: signed by NTH, its header hashing to H', () => {
    const h = headerOfAnchor(anchor975256 as NostrEvent)
    expect(h).toEqual({ height: 975256, hash: '0000000000000000000141f15457e748a34aefc732f7ee674c7ef89b04d00de9', time: expect.any(Number) })
    // 2026-11-09: the header's own time, not the anchor's created_at.
    expect(h!.time).toBeGreaterThan(1794200000)
    expect(h!.time).not.toBe(anchor975256.created_at)
  })

  it('the spec\'s vector, block 973,727: its time is 1793300370', () => {
    expect(headerOfAnchor(anchorOf([['B', '973727'], ['H', SPEC_H], ['header', SPEC_HEADER]]), yes)).toEqual({ height: 973727, hash: SPEC_H, time: 1793300370 })
  })

  it('is refused: another publisher, a bad signature, an H it does not hash to, two header tags, upper case, a short one', () => {
    const tags = [['B', '973727'], ['H', SPEC_H], ['header', SPEC_HEADER]]
    expect(headerOfAnchor(anchorOf(tags, 'ab'.repeat(32)), yes)).toBeNull()
    // A fresh copy: nostr-tools marks a verified object, and a spread would carry the mark.
    expect(headerOfAnchor({ ...(JSON.parse(JSON.stringify(anchor975256)) as NostrEvent), sig: 'ab'.repeat(64) })).toBeNull()
    expect(headerOfAnchor(anchorOf([['B', '973727'], ['H', 'ff'.repeat(32)], ['header', SPEC_HEADER]]), yes)).toBeNull()
    expect(headerOfAnchor(anchorOf([...tags, ['header', SPEC_HEADER]]), yes)).toBeNull()
    expect(headerOfAnchor(anchorOf([['B', '973727'], ['H', SPEC_H], ['header', SPEC_HEADER.toUpperCase()]]), yes)).toBeNull()
    expect(headerOfAnchor(anchorOf([['B', '973727'], ['H', SPEC_H], ['header', SPEC_HEADER.slice(2)]]), yes)).toBeNull()
    expect(headerOfAnchor(anchorOf([['B', '0973727'], ['H', SPEC_H], ['header', SPEC_HEADER]]), yes)).toBeNull()
    // A changed time changes the hash: it no longer hashes to H.
    const forged = SPEC_HEADER.slice(0, 136) + '00000000' + SPEC_HEADER.slice(144)
    expect(headerOfAnchor(anchorOf([['B', '973727'], ['H', SPEC_H], ['header', forged]]), yes)).toBeNull()
  })

  it('a header of easy bits is refused even when it hashes to its H', () => {
    // version 1, zero prev and merkle, a time, bits 0x207fffff (regtest), nonce 0: hashes to whatever it hashes to.
    const bytes = new Uint8Array(80)
    const dv = new DataView(bytes.buffer)
    dv.setInt32(0, 1, true); dv.setUint32(68, 1794000000, true); dv.setUint32(72, 0x207fffff, true)
    const h = bytesToHex(reverse32(sha256d(bytes)))
    expect(headerOfAnchor(anchorOf([['B', '5'], ['H', h], ['header', bytesToHex(bytes)]]), yes)).toBeNull()
  })
})

describe('header times from a blob', () => {
  /** A blob of `n` records chained from `prev`, and the display hash of its last block. */
  function chain(n: number, prev = '00'.repeat(32)): { bytes: Uint8Array; last: string; times: number[] } {
    const bytes = new Uint8Array(n * HEADER_RECORD_SIZE)
    let p = reverse32(new Uint8Array(Buffer.from(prev, 'hex')))
    const times: number[] = []
    for (let i = 0; i < n; i++) {
      const rec = { version: 1, merkleInternal: new Uint8Array(32).fill(i), time: 1700000000 + i * 600, bits: 0x1d00ffff, nonce: i }
      writeRecord(bytes, i, rec)
      times.push(rec.time)
      p = sha256d(wireHeader(rec, p))
    }
    return { bytes, last: bytesToHex(reverse32(p)), times }
  }

  it('reads every time and block hash when the chain ends at its checkpoint', () => {
    const { bytes, last, times } = chain(5)
    const read = blobChainTimes(bytes, 5, '00'.repeat(32), last)!
    expect([...read.times]).toEqual(times)
    expect(bytesToHex(read.hashes.subarray(4 * 32))).toBe(last)
    // Kept whole in the book: a time and a hash at any of its heights, no map of 50,000.
    const book = new HeaderBook()
    book.addBlob({ start: 100, ...read })
    expect(book.time(104)).toBe(times[4])
    expect(book.hash(104)).toBe(last)
    expect(book.has(105)).toBe(false)
  })

  it('reads nothing when a record was changed, or the checkpoint is another', () => {
    const { bytes, last } = chain(5)
    const bad = bytes.slice()
    bad[HEADER_RECORD_SIZE * 2 + 36] ^= 1
    expect(blobChainTimes(bad, 5, '00'.repeat(32), last)).toBeNull()
    expect(blobChainTimes(bytes, 5, '00'.repeat(32), 'ab'.repeat(32))).toBeNull()
    expect(blobChainTimes(bytes, 4, '00'.repeat(32), last)).toBeNull()
  })
})

describe('fetching headers by authors and #B', () => {
  it('asks NTH for the heights it lacks, a hundred a query, keeps what verifies, marks the rest absent', async () => {
    const book = new HeaderBook()
    const query = vi.fn(async (f: { authors: string[]; '#B': string[] }) => {
      expect(f.authors).toEqual([NTH_PUBKEY])
      return f['#B'].includes('975256') ? [anchor975256 as NostrEvent] : []
    })
    const heights = Array.from({ length: 150 }, (_, i) => 975200 + i)
    await fetchAnchorHeaders(book, heights, query)
    // Two chunks, and the heights of the first that did not come back asked once more on their own.
    expect(query).toHaveBeenCalledTimes(Math.ceil(150 / B_PER_QUERY) + 1)
    expect(query.mock.calls[1][0]['#B']).toHaveLength(B_PER_QUERY - 1)
    expect(book.has(975256)).toBe(true)
    expect(book.isAbsent(975255)).toBe(true)
    // Asked again: nothing it holds or knows to be absent goes out.
    await fetchAnchorHeaders(book, heights, query)
    expect(query).toHaveBeenCalledTimes(3)
  })

  it('an absent height is asked for again after a while', () => {
    let now = 0
    const book = new HeaderBook(() => now)
    book.markAbsent([10])
    expect(book.isAbsent(10)).toBe(true)
    now = 10 * 60_000
    expect(book.isAbsent(10)).toBe(false)
  })
})

describe('the planted height, clamped with injected headers (§4.2)', () => {
  const times = clampTimes()
  /** Fills the book from the vectors' header times; a height they lack is absent. */
  function fetcher(book: HeaderBook, source: Map<number, number> = times): (heights: number[]) => Promise<void> {
    return async (heights) => {
      for (const h of heights) {
        const t = source.get(h)
        if (t !== undefined) book.addTimes(h, [t])
      }
      book.markAbsent(heights)
    }
  }

  for (const c of vectors.clamp.cases) {
    it(c.what, async () => {
      const book = new HeaderBook()
      const got = await settlePlanted(c.stated, c.created_at, c.settled_from_clock, book, fetcher(book))
      if (c.effective === 'none') {
        expect(got.state).toBe('cannot-grow')
        return
      }
      expect(got).toMatchObject({ state: 'settled', height: c.effective, E: c.E, F: c.F })
      // One clock earlier it is not settled yet: drawn at generation 0, and not for want of headers.
      const earlier = new HeaderBook()
      const before = await settlePlanted(c.stated, c.created_at, c.not_settled_at_clock, earlier, fetcher(earlier))
      expect(before).toEqual({ state: 'pending' })
    })
  }

  describe('below a run of missing headers (975,227 to 975,255 today)', () => {
    // The vectors' header times, then one every ten minutes to a later clock, and a run of 29 nobody has.
    const longer = new Map(times)
    for (let h = 970620; h <= 971050; h++) longer.set(h, 1791544000 + (h - 970620) * 600)
    // 29 blocks where the gallop down from the clock looks (clock - 256), as the real gap does today.
    const holed = new Map(longer)
    for (let h = 970734; h <= 970762; h++) holed.delete(h)
    const clock = 971000

    it('a seed settled below the gap is judged there: the same E, F and height as with every header', async () => {
      for (const c of vectors.clamp.cases.filter((x: { effective: unknown }) => x.effective !== 'none')) {
        const full = new HeaderBook()
        const whole = await settlePlanted(c.stated, c.created_at, clock, full, fetcher(full, longer))
        const book = new HeaderBook()
        const got = await settlePlanted(c.stated, c.created_at, clock, book, fetcher(book, holed))
        expect(whole, JSON.stringify(whole)).toMatchObject({ state: 'settled', height: c.effective, E: c.E, F: c.F })
        expect(got).toEqual(whole)
        // It did meet the gap on the way down, and judged beneath it.
        expect(book.isAbsent(970762)).toBe(true)
      }
    })

    it('a seed above the gap is judged as ever; one planted in it waits for blocks', async () => {
      const book = new HeaderBook()
      // Planted above the gap: judged at the clock as ever.
      const got = await settlePlanted(970900, longer.get(970900)! + 300, clock, book, fetcher(book, holed))
      expect(got).toMatchObject({ state: 'settled', height: 970900 })
      // Planted inside it: its E and F lie in the gap, so it waits.
      const young = new HeaderBook()
      const inGap = await settlePlanted(970745, longer.get(970745)! + 300, clock, young, fetcher(young, holed))
      expect(inGap).toMatchObject({ state: 'pending', waiting: true })
    })
  })

  it('a header nobody has: pending, waiting for blocks, never a failure', async () => {
    const c = vectors.clamp.cases[0]
    const holed = new Map(times)
    holed.delete(c.settled_from_clock - 3)
    const book = new HeaderBook()
    const got = await settlePlanted(c.stated, c.created_at, c.settled_from_clock, book, fetcher(book, holed))
    expect(got).toMatchObject({ state: 'pending', waiting: true })
  })

  it('what is fetched follows created_at, never the planted height a planter wrote', async () => {
    const c = vectors.clamp.cases[0]
    const asked: number[] = []
    const book = new HeaderBook()
    const fetch = async (heights: number[]): Promise<void> => {
      asked.push(...heights)
      for (const h of heights) { const t = times.get(h); if (t !== undefined) book.addTimes(h, [t]) }
      book.markAbsent(heights)
    }
    const got = await settlePlanted(0, c.created_at, c.settled_from_clock, book, fetch)
    // Stated 0, raised to E: and nothing near height 0 was asked for.
    expect(got).toMatchObject({ state: 'settled', height: c.E })
    expect(Math.min(...asked)).toBeGreaterThan(c.settled_from_clock - 400)
  })

  it('the prediction covers the median window at the clock and the blocks around the planted height', () => {
    const p = predictedHeights(975300, 975800)
    for (let h = 975790; h <= 975800; h++) expect(p).toContain(h)
    for (let h = 975270; h <= 975330; h++) expect(p).toContain(h)
    expect(p.length).toBeLessThan(300)
  })
})
