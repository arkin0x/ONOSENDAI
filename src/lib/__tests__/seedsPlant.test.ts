/**
 * seedsPlant.test.ts: planting (DECK-0008 §7, §8.1, §8.2). The six original
 * DNAs are the vectors' texts and parse; prices follow the caps; the DNA and
 * seed events are written as the DECK says; a seed mined with the avatar's
 * NIP-13 loop carries its work at its committed target (workOk); and the
 * preview grows exactly the bloom sno-core grows. No worker, no network.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { fromPayload } from 'sno-core/shards'
import { BASE_CAPS, growBloom, parseDna, tryParseDna, workOk } from 'sno-core/seeds'
import { ORIGINAL_CAPS, ORIGINAL_DNAS } from '../seeds/originalDnas'
import { bloomReachGibsons, seedDraftHeight, seedHideFor, seedHideHeight, SEED_HIDE_MAX, SEED_HIDE_MIN, dnaMatches, dnaTemplate, dnaTextRefusal, readDnaText, draftPrice, miningSeconds, previewHash, previewRequest, seedTemplate, seedWorkHolds, PREVIEW_DAYS } from '../seeds/plant'
import { mineChunk, nonceTagged } from '../avatarMine'
import { seedItemOf } from '../seeds/seedItem'
import { GrowCache, handleGrow } from '../seeds/growJob'
import { bloomShard } from '../seeds/bloomShard'
import { checkDna } from '../seeds/dnaStore'
import { bloomReachAt } from '../seeds/bloomReach'
import { fitHeightAll } from '../deployFit'
import { deployPoint } from '../space'
import { miningNote } from '../../store/plantSeed'
import { positionHex, type NostrEvent } from '../events'
import { planterSk, vectorBlocks, vectors } from './seedsFixture'

const at = { x: 1_000n, y: 2_000n, z: 3_000n }

describe('the original DNAs', () => {
  it('are the vectors\' six, word for word after the line `seedo   1`, and each is valid SEEDO of revision 1', () => {
    expect(ORIGINAL_DNAS.map((d) => d.name)).toEqual(['fiddlehead', 'sword fern', 'oak', 'willow', 'coral', 'crystal'])
    for (const d of ORIGINAL_DNAS) {
      expect(d.text).toBe('seedo   1\n' + vectors.growth.dnas[d.name])
      const read = tryParseDna(d.text)
      expect(read.ok, d.name).toBe(true)
      if (read.ok) expect(read.dna.name).toBe(d.name)
      if (read.ok) expect(read.dna.revision).toBe(1)
      expect(d.caps).toEqual(ORIGINAL_CAPS)
    }
  })

  it('the revision line changes no bloom: each grows the vectors\' payload at day 30 and 6 blocks (DECK-0008 §3.10)', () => {
    const blocks = vectorBlocks()
    for (const d of ORIGINAL_DNAS) {
      const c = vectors.growth.cases.find((x: { dna: string; what: string }) => x.dna === d.name && x.what === 'day 30 and 6 blocks')
      const b = growBloom(parseDna(d.text), { coord: c.coord, planted: c.planted, scale: c.scale, caps: c.caps }, c.clock, (h) => blocks.get(h))
      expect(b.sha256, d.name).toBe(c.sno_sha256)
    }
  })
})

describe('the price (§7)', () => {
  it('the original DNAs at 21 bits, the free caps at 16, the largest at 27; out of range is no price', () => {
    expect(draftPrice({ caps: ORIGINAL_CAPS })).toBe(21)
    expect(draftPrice({ caps: BASE_CAPS })).toBe(16)
    expect(draftPrice({ caps: { vertices: 65536, symbols: 16384, generations: 256 } })).toBe(27)
    expect(draftPrice({ caps: { vertices: 65537, symbols: 2048, generations: 32 } })).toBeNull()
    // Every row of the vectors' price table: its bits, or null for the invalid ones.
    for (const row of vectors.price.rows) expect(draftPrice({ caps: row.caps }), JSON.stringify(row.caps)).toBe(row.bits ?? null)
  })

  it('mining time follows the price and the measured rate; unknown before calibration', () => {
    expect(miningSeconds(21, null, 4)).toBeNull()
    const s16 = miningSeconds(16, 1_000_000, 1)!
    expect(miningSeconds(21, 1_000_000, 1)! / s16).toBeCloseTo(32, 5)
  })
})

describe('the DNA event (§8.1)', () => {
  it('carries its text and caps, an alt, and no protected tag; the free caps write no tag', () => {
    const t = dnaTemplate(ORIGINAL_DNAS[0].text, ORIGINAL_CAPS, 100)
    expect(t.kind).toBe(3350)
    expect(t.content).toBe(ORIGINAL_DNAS[0].text)
    expect(t.tags).toContainEqual(['caps', '8000', '6000', '40'])
    expect(t.tags.some((x) => x[0] === '-')).toBe(false)
    expect(t.tags.find((x) => x[0] === 'alt')?.[1]).toContain('fiddlehead')
    expect(dnaTemplate(ORIGINAL_DNAS[5].text, BASE_CAPS, 100).tags.some((x) => x[0] === 'caps')).toBe(false)
    const signed = finalizeEvent(t, planterSk) as NostrEvent
    expect(checkDna(signed, signed.id)).toMatchObject({ state: 'ok', price: 21, name: 'fiddlehead' })
    expect(dnaMatches(signed, ORIGINAL_DNAS[0].text, ORIGINAL_CAPS)).toBe(true)
    expect(dnaMatches(signed, ORIGINAL_DNAS[0].text, BASE_CAPS)).toBe(false)
  })

  it('a text is read once, and a title is cut by code point, never through a pair', () => {
    expect(readDnaText(ORIGINAL_DNAS[3].text)).toBe(readDnaText(ORIGINAL_DNAS[3].text))
    expect(readDnaText(ORIGINAL_DNAS[3].text)).toEqual({ ok: true, name: 'willow' })
    const long = seedTemplate({ dnaId: 'ab'.repeat(32), relayHint: '', planted: 1, scale: 0, at, plane: 0, title: `${'a'.repeat(63)}😀😀`, createdAt: 1 })
    expect(long.tags.find((t) => t[0] === 'title')?.[1]).toBe(`${'a'.repeat(63)}😀`)
  })

  it('a pasted text is checked with the engine\'s own words', () => {
    expect(dnaTextRefusal(ORIGINAL_DNAS[1].text)).toBeNull()
    expect(dnaTextRefusal('')).toBe('Paste or pick a DNA.')
    expect(dnaTextRefusal('dna x\naxiom F(')).toEqual(expect.any(String))
    expect(dnaTextRefusal('dna x\nmutat 4\naxiom F')).toBeNull()
  })
})

describe('the seed event and its work (§8.2, §7)', () => {
  const template = seedTemplate({ dnaId: 'ab'.repeat(32), relayHint: 'wss://relay.test', planted: 975300, scale: 0, at, plane: 0, title: '  my   fern ', createdAt: 1794300000 })

  it('names the DNA, the planted block, the C, a title, and is protected; scale 0 writes no tag', () => {
    expect(template.kind).toBe(3351)
    expect(template.tags).toEqual([['dna', 'ab'.repeat(32), 'wss://relay.test'], ['planted', '975300'], ['C', positionHex(at, 0)], ['title', 'my fern'], ['-']])
    const scaled = seedTemplate({ dnaId: 'ab'.repeat(32), relayHint: '', planted: 1, scale: 4, at, plane: 1, title: '', createdAt: 1 })
    expect(scaled.tags).toContainEqual(['scale', '4'])
    expect(scaled.tags.some((t) => t[0] === 'title')).toBe(false)
  })

  it('mined at its price: the committed target is the price, the id carries it, and a reader reads it', () => {
    const pubkey = getPublicKey(planterSk)
    let found = null
    for (let from = 0; !found; from += 50_000) found = mineChunk({ pubkey, ...template }, 16, from, 50_000)
    const mined = nonceTagged(template, found.nonce, 16)
    expect(mined.tags.at(-1)).toEqual(['nonce', found.nonce, '16'])
    const signed = finalizeEvent(mined, planterSk) as NostrEvent
    expect(signed.id).toBe(found.id)
    expect(workOk(signed, 16)).toBe(true)
    expect(seedWorkHolds(signed, 16)).toBe(true)
    expect(seedWorkHolds(signed, 17)).toBe(false)
    expect(seedItemOf(signed)).toMatchObject({ dnaId: 'ab'.repeat(32), planted: 975300, target: 16, title: 'my fern' })
    // A signer that moved its time moved its id: the work is gone.
    const moved = finalizeEvent({ ...mined, created_at: mined.created_at + 1 }, planterSk) as NostrEvent
    expect(seedWorkHolds(moved, 16)).toBe(moved.id.startsWith('0000'))
  })

  it('the deploy bar\'s words while it mines', () => {
    expect(miningNote({ tries: 2 ** 20, elapsedMs: 1000 }, 21)).toBe('Mining the seed: 50%, about 1 s left')
    expect(miningNote({ tries: 2 ** 22, elapsedMs: 4000 }, 21)).toBe('Mining the seed: 99%, any moment now')
  })
})

describe('the preview', () => {
  const blocks = vectorBlocks()
  // A tip that puts the preview's planted block at the vectors' 970,400.
  const tip = 970400 + PREVIEW_DAYS * 144 + 143 + 6

  it('grows the bloom sno-core grows, with the real blocks where the page has them', () => {
    const req = previewRequest({ text: ORIGINAL_DNAS[0].text, caps: ORIGINAL_CAPS, coord: vectors.growth.cases[0].coord, scale: 0, tip, day: 30, hashOf: (h) => blocks.get(h) })
    expect(req.seed.planted).toBe(970400)
    expect(req.clock).toBe(970400 + 30 * 144 + 143)
    expect(Object.keys(req.hashes)).toHaveLength(30)
    const { answer } = handleGrow({ type: 'grow', id: 1, ...req }, new GrowCache())
    if (answer.type !== 'bloom') throw new Error(answer.type)
    expect(answer.growth.generation).toBe(30)
    const bloom = growBloom(parseDna(ORIGINAL_DNAS[0].text), req.seed, req.clock, (h) => blocks.get(h))
    expect(bloomShard(answer.buffers, 'fiddlehead', 0, 'x')).toEqual({ ...fromPayload(bloom.sno, 'x')!, updatedAt: 0 })
  })

  it('a glassy bloom keeps its opacity from the worker\'s buffers to the shard, as the payload carries it (DECK-0008 §5.4, §5.5)', () => {
    const glass = vectors.opacity.dnas['glass crystal']
    const req = previewRequest({ text: glass, caps: ORIGINAL_CAPS, coord: vectors.growth.cases[0].coord, scale: 0, tip, day: 30, hashOf: (h) => blocks.get(h) })
    const { answer } = handleGrow({ type: 'grow', id: 1, ...req }, new GrowCache())
    if (answer.type !== 'bloom') throw new Error(answer.type)
    expect(answer.buffers.opacity).toBe(40)
    const bloom = growBloom(parseDna(glass), req.seed, req.clock, (h) => blocks.get(h))
    expect(bloom.sno.opacity).toBe(40)
    const shard = bloomShard(answer.buffers, 'crystal', 0, 'x')
    expect(shard.opacity).toBe(40)
    expect(shard).toEqual({ ...fromPayload(bloom.sno, 'x')!, updatedAt: 0 })
    // a solid bloom has no opacity at all, as its payload has none
    expect('opacity' in bloomShard({ ...answer.buffers, opacity: undefined }, 'crystal', 0, 'x')).toBe(false)
  })

  it('made-up hashes where the page has none, day 0 is the axiom, and the day is held to 0..30', () => {
    const req = previewRequest({ text: ORIGINAL_DNAS[2].text, caps: ORIGINAL_CAPS, coord: positionHex(at, 0), scale: 2, tip: 975400, day: 99, hashOf: () => undefined })
    expect(req.clock - req.seed.planted!).toBe(30 * 144 + 143)
    const first = req.seed.planted! + 144
    expect(req.hashes[first]).toBe(previewHash(first))
    const zero = previewRequest({ text: ORIGINAL_DNAS[2].text, caps: ORIGINAL_CAPS, coord: positionHex(at, 0), scale: 2, tip: 975400, day: 0, hashOf: () => undefined })
    expect(zero.hashes).toEqual({})
    const { answer } = handleGrow({ type: 'grow', id: 2, ...zero }, new GrowCache())
    expect(answer.type === 'bloom' && answer.growth.generation).toBe(0)
  })
})

describe('the hide height (owner ruling 2026-11-10)', () => {
  // Thirty gibsons past a 2^12 boundary on x, far from any larger one: where the owner stood.
  const nearEdge = { x: (1n << 40n) + 4096n * 77n + 30n, y: (1n << 41n) + 1000n, z: (1n << 42n) + 1000n }

  it('the old fit, 64 units each way, climbed past 12 near a boundary: this is why it read 13', () => {
    expect(fitHeightAll(64n, [], nearEdge, 0, 0, 20)).toBe(13)
  })

  it('sized to the bloom: the smallest of 3 to 12 that holds it, 12 when none does, never above', () => {
    expect(seedHideHeight(15, nearEdge, 0, 20)).toBeGreaterThanOrEqual(SEED_HIDE_MIN)
    expect(seedHideHeight(15, nearEdge, 0, 20)).toBeLessThan(12)
    expect(seedHideHeight(64, nearEdge, 0, 20)).toBe(SEED_HIDE_MAX)
    expect(seedHideHeight(10_000, nearEdge, 0, 20)).toBe(SEED_HIDE_MAX)
    expect(seedHideHeight(undefined, nearEdge, 0, 20)).toBe(SEED_HIDE_MAX)
    // Never above this machine's key ceiling.
    expect(seedHideHeight(64, nearEdge, 0, 9)).toBe(9)
    // A tiny bloom in the middle of nowhere still hides at 3 at least.
    expect(seedHideHeight(1, { x: (1n << 40n) + 4n, y: (1n << 40n) + 4n, z: (1n << 40n) + 4n }, 0, 20)).toBe(3)
  })

  it('each height is judged with the bloom grown at its own landing point', async () => {
    // A build step of 2^8: below it the seed lands at the centre of a smaller cell, on other soil.
    const asked: string[] = []
    const reachAt = async (p: { x: bigint; y: bigint; z: bigint }): Promise<number> => {
      asked.push(positionHex(p, 1))
      // The bloom at the 2^3 and 2^4 points is too large for those cubes; at the 2^5 point it is small.
      return p.x === deployPoint(nearEdge, 8, 5).x ? 6 : 40
    }
    const got = await seedHideFor(nearEdge, 1, 8, 20, reachAt)
    expect(got.height).toBe(5)
    expect(got.point).toEqual(deployPoint(nearEdge, 8, 5))
    expect(got.reach).toBe(6)
    // Each distinct point grown once.
    expect(new Set(asked).size).toBe(asked.length)
    // Nothing fits: 12, at its own point.
    const none = await seedHideFor(nearEdge, 1, 0, 20, async () => 100_000)
    expect(none.height).toBe(SEED_HIDE_MAX)
  })

  it('bloomReachAt, the measure SEED and the tutorial hand seedHideFor, is the day-31 bloom grown at the point', async () => {
    const at = { x: (1n << 40n) + 123_457n, y: (1n << 41n) + 987_651n, z: (1n << 42n) + 55_555n }
    const reach = await bloomReachAt(ORIGINAL_DNAS[2].text, ORIGINAL_CAPS, 1, 0)(at)
    const req = previewRequest({ text: ORIGINAL_DNAS[2].text, caps: ORIGINAL_CAPS, coord: positionHex(at, 1), scale: 0, tip: 975_300, day: PREVIEW_DAYS, hashOf: () => undefined })
    const { answer } = handleGrow({ type: 'grow', id: 1, ...req }, new GrowCache())
    if (answer.type !== 'bloom') throw new Error(answer.type)
    expect(reach).toBe(bloomReachGibsons(answer.buffers.positions, 0))
  })

  it('the deploy uses the height SEED found only for that cursor and step; anywhere else 12', () => {
    const fit = { height: 5, reach: 6, cursor: positionHex(nearEdge, 1), step: 8 }
    expect(seedDraftHeight(fit, nearEdge, 1, 8, 20)).toBe(5)
    expect(seedDraftHeight(fit, { ...nearEdge, x: nearEdge.x + 1n }, 1, 8, 20)).toBe(SEED_HIDE_MAX)
    expect(seedDraftHeight(fit, nearEdge, 1, 4, 20)).toBe(SEED_HIDE_MAX)
    expect(seedDraftHeight(fit, nearEdge, 0, 8, 20)).toBe(SEED_HIDE_MAX)
    expect(seedDraftHeight(undefined, nearEdge, 1, 8, 20)).toBe(SEED_HIDE_MAX)
    expect(seedDraftHeight(fit, nearEdge, 1, 8, 4)).toBe(4)
  })

  it('reach: the farthest vertex, in gibsons at the scale, with a quarter and two gibsons more', () => {
    expect(bloomReachGibsons(new Int32Array([0, 0, 0, 1200, 0, 0]), 0)).toBe(Math.ceil(10 * 1.25) + 2)
    expect(bloomReachGibsons(new Int32Array([0, 1200, 0]), 3)).toBe(Math.ceil(80 * 1.25) + 2)
  })

  it('the six original DNAs at three spots, measured on their day-31 preview, all hide at 3 to 12', () => {
    const spots = [
      { x: (1n << 40n) + 123_457n, y: (1n << 41n) + 987_651n, z: (1n << 42n) + 55_555n },
      nearEdge,
      { x: 9_999_999_999n, y: 77_777_777_777n, z: 123_456_789n },
    ]
    for (const d of ORIGINAL_DNAS) {
      for (const at of spots) {
        const req = previewRequest({ text: d.text, caps: ORIGINAL_CAPS, coord: positionHex(at, 1), scale: 0, tip: 975_400, day: PREVIEW_DAYS, hashOf: () => undefined })
        const { answer } = handleGrow({ type: 'grow', id: 1, ...req }, new GrowCache())
        if (answer.type !== 'bloom') throw new Error(answer.type)
        const h = seedHideHeight(bloomReachGibsons(answer.buffers.positions, 0), at, 0, 20)
        expect(h, `${d.name}`).toBeGreaterThanOrEqual(3)
        expect(h, `${d.name}`).toBeLessThanOrEqual(12)
      }
    }
  })
})
