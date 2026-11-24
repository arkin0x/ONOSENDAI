/**
 * terrainLayer.test.ts - DECK-0009 §5 to §7 as TERRAIN reads and writes them
 * (lib/terrain/blockLayer.ts, layerReader.ts): the DECK's vectors for runs,
 * settles, the worked layer, reach and the Cell Rule; the layer event's
 * shape; sealing to the region key and opening again; and a merge of two
 * authors by the Cell Rule, withholding included (T = max(h, W)).
 *
 * Every key here is a throwaway made for the test. Nothing is published.
 */

import { describe, expect, it } from 'vitest'
import { coordToXyz } from 'cyberspace-core'
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { CELLS, idx } from '../terrain/coords'
import { generate } from '../terrain/generate'
import { reachDistance } from '../terrain/world'
import { regionKeyAt, encryptForRegion } from '../shardCrypto'
import {
  LAYER_KIND, canonicalNumbers, claimsOf, decodePlane, earlier, encodePlane, expandRuns, layerShape, layerTags, parsePlaintext, plaintextJson,
  resolveCell, resolvePlane, serializedBytes, settleId, workOf, countedAuthors,
  type CountedLayer, type LayerPlaintext, type Placement, type Settle,
} from '../terrain/blockLayer'
import { readLayer, type ReadDeps } from '../terrain/layerReader'
import V from './fixtures/deck0009-layer-vectors.json'

const ORIGIN = { x: 0n, y: 0n, z: 0n, plane: 0 }
const origin = generate(ORIGIN).blocks
const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const { key: KEY, lookupId: LOOKUP } = regionKeyAt(ORIGIN, 5, 5)

describe('the DECK vectors', () => {
  it('the origin chunk\'s lookup id is the vectors\'', () => {
    expect(LOOKUP).toBe(V.settles[0].lookup_id)
  })

  it('runs: accepted ones expand, rejected ones do not (§5.4)', () => {
    for (const a of V.runs.accepted) expect(Array.from(expandRuns(a.runs, a.length, a.limit)!)).toEqual(a.expanded)
    for (const r of V.runs.rejected) expect(expandRuns(r.runs, r.length, r.limit), r.reason).toBeNull()
    // The length is checked as it expands.
    expect(expandRuns([0, -1000000000], 4, 1)).toBeNull()
    expect(canonicalNumbers('[1,-2,0]')).toBe(true)
    for (const bad of ['[1.0]', '[1e2]', '[01]', '[-0]']) expect(canonicalNumbers(bad), bad).toBe(false)
    // Strings are not numbers.
    expect(canonicalNumbers('["1.5e3",2]')).toBe(true)
  })

  it('settles: ids, claims and work (§5.3)', () => {
    for (const s of V.settles) {
      const settle: Settle = [s.height, s.block_hash, s.nonce, s.claims as [number[], number[]]]
      const id = settleId(s.author, s.lookup_id, settle)
      expect(id).toBe(s.id)
      expect(workOf(id!)).toBe(s.work)
    }
    expect(settleId(V.layer.author, LOOKUP, JSON.parse(V.layer.survey_only_plaintext).settles[0])).toBe(V.layer.survey_only_settle_id)
  })

  it('the worked layer decodes to its 35 placements, values, grounds and settles (§5.5)', () => {
    const plain = parsePlaintext(V.layer.plaintext)!
    expect(plain).not.toBeNull()
    expect(new TextEncoder().encode(V.layer.plaintext).length).toBe(V.layer.plaintext_bytes)
    const d = decodePlane(plain.planes[0], origin, plain.settles.length)
    if (!d || d === 'aside') throw new Error('plane')
    expect(d.placements.length).toBe(V.layer.placements)
    const got = d.placements.map((c, k) => ({ x: c & 31, y: c >> 10, z: (c >> 5) & 31, value: d.values[c], ground: origin[c], t0: d.t0[k], t1: d.t1[k] }))
    expect(got).toEqual(V.layer.placement_cells)
    // Its settle tags are its settles' ids.
    const ids = plain.settles.map((s) => settleId(V.layer.author, LOOKUP, s))
    expect(V.layer.tags.filter((t: string[]) => t[0] === 'settle').map((t: string[]) => t[1])).toEqual(ids)
    // Written again from its values and times, it is the same plane.
    const t0 = new Map(d.placements.map((c, k) => [c, d.t0[k]]))
    const t1 = new Map(d.placements.map((c, k) => [c, d.t1[k]]))
    expect(encodePlane(0, true, d.values, origin, t0, t1)).toEqual(plain.planes[0])
    expect(plaintextJson(plain)).toBe(V.layer.plaintext)
    expect(plaintextJson(parsePlaintext(V.layer.survey_only_plaintext)!)).toBe(V.layer.survey_only_plaintext)
  })

  it('reach (§6.2)', () => {
    for (const r of V.reach) {
      const c = coordToXyz(BigInt(`0x${r.coord}`))
      const chunk = { x: BigInt(r.chunk[0]), y: BigInt(r.chunk[1]), z: BigInt(r.chunk[2]), plane: r.chunk[3] as number }
      const d = reachDistance({ x: c.x, y: c.y, z: c.z, plane: c.plane }, chunk)
      expect(d === Infinity ? null : d, r.name).toBe(r.distance)
      expect(d <= 16, r.name).toBe(r.within_reach)
    }
  })

  it('the Cell Rule\'s nine cells (§7.3)', () => {
    for (const c of V.cell_rule) {
      const builders = new Map(Object.entries(c.builders as Record<string, string[]>).map(([a, l]) => [a, new Set(l)]))
      const r = resolveCell(c.placements as Placement[], builders, c.home)
      expect(r, c.name).toEqual(c.expected)
    }
  })
})

describe('the layer event (§5.1)', () => {
  it('has exactly the DECK\'s tags, and nothing public about the place', () => {
    const tags = layerTags({ lookupId: LOOKUP, author: 'a'.repeat(64), reach: ['e'.repeat(64)], settleIds: ['1'.repeat(64), '2'.repeat(64)], encrypted: 'AAAA' })
    expect(tags).toEqual([
      ['d', LOOKUP], ['p', 'a'.repeat(64)], ['e', 'e'.repeat(64), '', 'reach'], ['settle', '1'.repeat(64)], ['settle', '2'.repeat(64)],
      ['encrypted', 'aes-256-gcm', 'AAAA'], ['version', '1'],
    ])
    for (const t of tags) expect(['d', 'p', 'e', 'settle', 'encrypted', 'version']).toContain(t[0])
    expect(layerShape({ kind: LAYER_KIND, tags })).not.toBeNull()
    // Each of check 2's requirements.
    expect(layerShape({ kind: LAYER_KIND, tags: tags.filter((t) => t[0] !== 'p') })).toBeNull()
    expect(layerShape({ kind: LAYER_KIND, tags: tags.filter((t) => t[0] !== 'e') })).toBeNull()
    expect(layerShape({ kind: LAYER_KIND, tags: tags.filter((t) => t[0] !== 'settle') })).toBeNull()
    expect(layerShape({ kind: LAYER_KIND, tags: tags.map((t) => (t[0] === 'version' ? ['version', '2'] : t)) })).toBeNull()
    expect(layerShape({ kind: LAYER_KIND, tags: [...tags, ['d', LOOKUP]] })).toBeNull()
    expect(layerShape({ kind: 33336, tags })).toBeNull()
  })
})

/** A layer of `author` at the origin chunk, signed by a throwaway builder key. */
async function signedLayer(plain: LayerPlaintext, author: string, builderSk: Uint8Array, reach = 'f'.repeat(64)): Promise<ReturnType<typeof finalizeEvent>> {
  const ids = plain.settles.map((s) => settleId(author, LOOKUP, s)!)
  const encrypted = await encryptForRegion(KEY, plaintextJson(plain))
  return finalizeEvent({ kind: LAYER_KIND, created_at: 1_790_000_000, tags: layerTags({ lookupId: LOOKUP, author, reach: [reach], settleIds: ids, encrypted }), content: '' }, builderSk)
}

const deps = (over: Partial<ReadDeps> = {}): ReadDeps => ({
  verify: (ev) => verifyEvent(ev as never),
  key: KEY,
  lookupId: LOOKUP,
  chunk: ORIGIN,
  ground: async () => origin,
  reach: async (_a, _b, ids) => new Map(ids.map((id) => [id, { x: 3n, y: 40n, z: 3n, plane: 0 }])),
  header: async () => 'ok',
  ...over,
})

describe('sealing and opening (§5.2, §6.1)', () => {
  it('a layer sealed to the chunk\'s key opens again to the same plaintext, and counts', async () => {
    const plain = parsePlaintext(V.layer.plaintext)!
    const ev = await signedLayer(plain, V.layer.author, generateSecretKey())
    // Nothing in the clear but the DECK's tags: the plaintext's numbers never show.
    expect(JSON.stringify(ev.tags)).not.toContain('925010')
    expect(serializedBytes(ev)).toBeLessThan(240_000)
    const r = await readLayer(ev as never, deps())
    expect(r.status).toBe('counted')
    if (r.status !== 'counted') return
    expect(plaintextJson(r.plaintext)).toBe(V.layer.plaintext)
    expect(r.layer.author).toBe(V.layer.author)
    expect(r.layer.planes[0].placements.length).toBe(35)
  })

  it('drops what fails a check, and leaves what is not yet 6 deep pending', async () => {
    const plain = parsePlaintext(V.layer.plaintext)!
    const sk = generateSecretKey()
    const ev = await signedLayer(plain, V.layer.author, sk)
    const forged = { ...ev, tags: ev.tags.map((t) => (t[0] === 'p' ? ['p', 'd'.repeat(64)] : t)) }
    expect((await readLayer(forged as never, deps())).status).toBe('dropped')
    expect((await readLayer(ev as never, deps({ key: generateSecretKey() }))).status).toBe('dropped')
    expect((await readLayer(ev as never, deps({ reach: async () => new Map() }))).status).toBe('dropped')
    expect((await readLayer(ev as never, deps({ header: async () => 'bad' }))).status).toBe('dropped')
    expect((await readLayer(ev as never, deps({ header: async () => 'pending' }))).status).toBe('pending')
    // A placement whose first settle does not claim its cell (§6.1 check 8).
    const bad: LayerPlaintext = JSON.parse(JSON.stringify(plain))
    bad.settles[0][3] = [[0, -32767], [0, -32767]]
    expect((await readLayer(await signedLayer(bad, V.layer.author, sk) as never, deps())).status).toBe('dropped')
    // A reach event out of reach drops the plane, and with no plane left nothing is placed.
    const far = await readLayer(ev as never, deps({ reach: async (_a, _b, ids) => new Map(ids.map((id) => [id, { x: 500n, y: 0n, z: 0n, plane: 0 }])) }))
    expect(far.status === 'counted' && far.layer.planes.length).toBe(0)
  })
})

describe('two authors merged by the Cell Rule', () => {
  const A = getPublicKey(generateSecretKey())
  const B = getPublicKey(generateSecretKey())
  const cell = idx(4, 30, 4)
  const layerOf = (author: string, value: number, height: number, witness: number | null): CountedLayer => {
    const values = Int32Array.from(origin)
    values[cell] = value
    const t = new Map([[cell, 0]])
    const pl = encodePlane(0, true, values, origin, t, t)
    const d = decodePlane(pl, origin, 1)
    if (!d || d === 'aside') throw new Error('plane')
    return { author, builder: author, builders: [], retiredKey: false, times: [{ height, witness, work: 0 }], planes: [d] }
  }

  it('the first placer owns the cell; a later stranger is not drawn', () => {
    const r = resolvePlane([layerOf(B, 41, 925_020, null), layerOf(A, 40, 925_010, null)], 0, null)
    expect(r.values[cell]).toBe(40)
    expect(r.surveyed).toBe(true)
    // Cells nobody placed show the base.
    expect(r.values[idx(0, 0, 0)]).toBe(-1)
  })

  it('withholding loses: committed early but first seen late, T = max(h, W)', () => {
    // A committed to an old block but the witness saw it only at 925,050; B committed later and was seen at once.
    const late = layerOf(A, 40, 925_000, 925_050)
    const prompt = layerOf(B, 41, 925_020, 925_021)
    expect(resolvePlane([late, prompt], 0, null).values[cell]).toBe(41)
    // Without the witness (every settle unwitnessed), the committed block alone orders them, the DECK's fallback.
    expect(resolvePlane([layerOf(A, 40, 925_000, null), layerOf(B, 41, 925_020, null)], 0, null).values[cell]).toBe(40)
    // A witnessed settle comes before any unwitnessed one.
    expect(earlier({ height: 925_100, witness: 925_100, work: 0, author: B, builder: B }, { height: 925_000, witness: null, work: 0, author: A, builder: A })).toBeLessThan(0)
  })

  it('a listed builder changes the owner\'s cell; a retired key lists nobody', () => {
    const owner = { ...layerOf(A, 40, 925_010, null), builders: [B] }
    const helper = layerOf(B, 41, 925_030, null)
    expect(resolvePlane([owner, helper], 0, null).values[cell]).toBe(41)
    expect(resolvePlane([{ ...owner, retiredKey: true }, helper], 0, null).values[cell]).toBe(40)
  })

  it('mutes and the cap: a muted author is never counted; you and whom you follow come first', () => {
    const authors = Array.from({ length: 70 }, (_, i) => i.toString(16).padStart(64, '0'))
    const earliest = (a: string) => ({ height: 925_000 + parseInt(a, 16), witness: null, work: 0, author: a, builder: a })
    const me = authors[69], friend = authors[68]
    const kept = countedAuthors(authors, { me, follows: new Set([friend]), muted: new Set([authors[0]]), home: null, earliest })
    expect(kept.size).toBe(64)
    expect(kept.has(authors[0])).toBe(false)
    expect(kept.has(me) && kept.has(friend)).toBe(true)
    // The rest by earliest settle: the latest are the ones left out.
    expect(kept.has(authors[1]) && !kept.has(authors[67])).toBe(true)
  })

  it('a home chunk is its owner\'s whoever placed first', () => {
    const stranger = layerOf(B, 41, 925_000, null)
    const owner = layerOf(A, 40, 925_090, null)
    expect(resolvePlane([stranger, owner], 0, A).values[cell]).toBe(40)
    expect(resolvePlane([stranger], 0, A).values[cell]).toBe(-1)
  })

  it('claims are written for exactly the cells given', () => {
    const c = claimsOf(new Set([cell]), new Set())
    const bits = expandRuns(c[0], CELLS, 2)!
    expect(bits[cell]).toBe(1)
    expect(bits.reduce((n, v) => n + v, 0)).toBe(1)
    expect(c[1]).toEqual([0, -32767])
    expect(hex(new Uint8Array([1]))).toBe('01')
  })
})
