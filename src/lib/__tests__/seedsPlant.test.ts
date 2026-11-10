/**
 * seedsPlant.test.ts: planting (DECK-0008 §7, §8.1, §8.2). The six starter
 * DNAs are the vectors' texts and parse; prices follow the caps; the DNA and
 * seed events are written as the DECK says; a seed mined with the avatar's
 * NIP-13 loop carries its work at its committed target (workOk); and the
 * preview grows exactly the bloom sno-core grows. No worker, no network.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import { fromPayload } from 'sno-core/shards'
import { BASE_CAPS, growBloom, parseDna, tryParseDna, workOk } from 'sno-core/seeds'
import { STARTER_CAPS, STARTER_DNAS } from '../seeds/starterDnas'
import { dnaMatches, dnaTemplate, dnaTextRefusal, draftPrice, miningSeconds, previewHash, previewRequest, seedTemplate, seedWorkHolds, PREVIEW_DAYS } from '../seeds/plant'
import { mineChunk, nonceTagged } from '../avatarMine'
import { seedItemOf } from '../seeds/seedItem'
import { GrowCache, handleGrow } from '../seeds/growJob'
import { bloomShard } from '../seeds/bloomShard'
import { checkDna } from '../seeds/dnaStore'
import { miningNote } from '../../store/plantSeed'
import { positionHex, type NostrEvent } from '../events'
import { planterSk, vectorBlocks, vectors } from './seedsFixture'

const at = { x: 1_000n, y: 2_000n, z: 3_000n }

describe('the starter DNAs', () => {
  it('are the vectors\' six, word for word, and each is valid SEEDO', () => {
    expect(STARTER_DNAS.map((d) => d.name)).toEqual(['fiddlehead', 'sword fern', 'oak', 'willow', 'coral', 'crystal'])
    for (const d of STARTER_DNAS) {
      expect(d.text).toBe(vectors.growth.dnas[d.name])
      const read = tryParseDna(d.text)
      expect(read.ok, d.name).toBe(true)
      if (read.ok) expect(read.dna.name).toBe(d.name)
      expect(d.caps).toEqual(STARTER_CAPS)
    }
  })
})

describe('the price (§7)', () => {
  it('the starters at 21 bits, the free caps at 16, the largest at 27; out of range is no price', () => {
    expect(draftPrice({ caps: STARTER_CAPS })).toBe(21)
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
    const t = dnaTemplate(STARTER_DNAS[0].text, STARTER_CAPS, 100)
    expect(t.kind).toBe(3350)
    expect(t.content).toBe(STARTER_DNAS[0].text)
    expect(t.tags).toContainEqual(['caps', '8000', '6000', '40'])
    expect(t.tags.some((x) => x[0] === '-')).toBe(false)
    expect(t.tags.find((x) => x[0] === 'alt')?.[1]).toContain('fiddlehead')
    expect(dnaTemplate(STARTER_DNAS[5].text, BASE_CAPS, 100).tags.some((x) => x[0] === 'caps')).toBe(false)
    const signed = finalizeEvent(t, planterSk) as NostrEvent
    expect(checkDna(signed, signed.id)).toMatchObject({ state: 'ok', price: 21, name: 'fiddlehead' })
    expect(dnaMatches(signed, STARTER_DNAS[0].text, STARTER_CAPS)).toBe(true)
    expect(dnaMatches(signed, STARTER_DNAS[0].text, BASE_CAPS)).toBe(false)
  })

  it('a pasted text is checked with the engine\'s own words', () => {
    expect(dnaTextRefusal(STARTER_DNAS[1].text)).toBeNull()
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
    const req = previewRequest({ text: STARTER_DNAS[0].text, caps: STARTER_CAPS, coord: vectors.growth.cases[0].coord, scale: 0, tip, day: 30, hashOf: (h) => blocks.get(h) })
    expect(req.seed.planted).toBe(970400)
    expect(req.clock).toBe(970400 + 30 * 144 + 143)
    expect(Object.keys(req.hashes)).toHaveLength(30)
    const { answer } = handleGrow({ type: 'grow', id: 1, ...req }, new GrowCache())
    if (answer.type !== 'bloom') throw new Error(answer.type)
    expect(answer.growth.generation).toBe(30)
    const bloom = growBloom(parseDna(STARTER_DNAS[0].text), req.seed, req.clock, (h) => blocks.get(h))
    expect(bloomShard(answer.buffers, 'fiddlehead', 0, 'x')).toEqual({ ...fromPayload(bloom.sno, 'x')!, updatedAt: 0 })
  })

  it('made-up hashes where the page has none, day 0 is the axiom, and the day is held to 0..30', () => {
    const req = previewRequest({ text: STARTER_DNAS[2].text, caps: STARTER_CAPS, coord: positionHex(at, 0), scale: 2, tip: 975400, day: 99, hashOf: () => undefined })
    expect(req.clock - req.seed.planted!).toBe(30 * 144 + 143)
    const first = req.seed.planted! + 144
    expect(req.hashes[first]).toBe(previewHash(first))
    const zero = previewRequest({ text: STARTER_DNAS[2].text, caps: STARTER_CAPS, coord: positionHex(at, 0), scale: 2, tip: 975400, day: 0, hashOf: () => undefined })
    expect(zero.hashes).toEqual({})
    const { answer } = handleGrow({ type: 'grow', id: 2, ...zero }, new GrowCache())
    expect(answer.type === 'bloom' && answer.growth.generation).toBe(0)
  })
})
