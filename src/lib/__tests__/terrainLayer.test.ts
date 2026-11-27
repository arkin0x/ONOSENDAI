/**
 * terrainLayer.test.ts - DECK-0009 (cyberspace c4930ff) as TERRAIN reads and
 * writes it (lib/terrain/blockLayer.ts, layerReader.ts): the DECK's vectors
 * for runs, the worked layer, builder keys, the home and the Stack with
 * co-builders; planes with explicit changes at the base value; the event's
 * tags and limits; sealing and opening; the checks that drop a layer; and a
 * new key's start from the author's other keys' layers.
 *
 * Every key here is a throwaway made for the test. Nothing is published.
 */

import { describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure'
import { idx } from '../terrain/coords'
import { generate } from '../terrain/generate'
import { regionKeyAt, encryptForRegion } from '../shardCrypto'
import {
  FUTURE_SLACK_SECONDS, LAYER_KIND, builderKeyValid, canonicalNumbers, changesOf, countedLayers, decodePlane, emptiedPlaintext, encodePlane, expandRuns,
  freeTextWithinBounds, inHome, layerShape, layerTags, nextPlaintext, ownRank, parsePlaintext, plaintextJson, resolveStack, serializedBytes, startFrom,
  type LayerPlaintext, type PlaneAt, type StackLayer, type StackView,
} from '../terrain/blockLayer'
import { readLayer, type KeyStatus, type ReadDeps } from '../terrain/layerReader'
import V from './fixtures/deck0009-layer-vectors.json'

const ORIGIN = { x: 0n, y: 0n, z: 0n, plane: 0 }
const origin = generate(ORIGIN).blocks
/** What these tests' planes name: revision 2, first surveyed at 100. */
const R2: PlaneAt = { revision: 2, surveyed: 100 }
const { key: KEY, lookupId: LOOKUP } = regionKeyAt(ORIGIN, 5, 5)
const pk = (n: number): string => n.toString(16).padStart(64, '0')
let air = -1, rock = -1
for (let c = 0; c < origin.length && (air < 0 || rock < 0); c++) { if (origin[c] === 0 && air < 0) air = c; if (origin[c] !== 0 && rock < 0) rock = c }
const chunkOfVector = (c: (string | number)[]) => ({ x: BigInt(c[0]), y: BigInt(c[1]), z: BigInt(c[2]), plane: Number(c[3]) })

describe('the DECK vectors', () => {
  it('runs (§5.3)', () => {
    for (const a of V.runs.accepted) expect(Array.from(expandRuns(a.runs, a.length, a.limit)!)).toEqual(a.expanded)
    for (const r of V.runs.rejected) expect(expandRuns(r.runs, r.length, r.limit), r.reason).toBeNull()
    expect(expandRuns([0, -1000000000], 4, 1)).toBeNull()
    for (const bad of ['[1.0]', '[1e2]', '[01]', '[-0]']) expect(canonicalNumbers(bad), bad).toBe(false)
  })

  it('the worked layer: 36 changed cells, an explicit change at the base value among them, one co-builder; written back byte for byte', () => {
    const plain = parsePlaintext(V.layer.plaintext)!
    expect(plain.cobuilders).toEqual(['1'.repeat(1) + 'b'.repeat(63)])
    const d = decodePlane(plain.planes[0], origin)
    if (!d || d === 'aside') throw new Error('plane')
    expect(d.changed.length).toBe(V.layer.changed)
    expect(d.changed.map((c) => ({ x: c & 31, y: c >> 10, z: (c >> 5) & 31, value: d.values[c], ground: origin[c] }))).toEqual(V.layer.changed_cells)
    const explicit = new Set(d.changed.filter((c) => d.values[c] === origin[c]))
    expect(explicit.size).toBeGreaterThan(0)
    // Written back byte for byte, but for `surveyed`, which every surveyed plane now names (§5.4, revision 3's DECK).
    expect(encodePlane(0, true, d.values, origin, R2, explicit)).toEqual({ ...plain.planes[0], surveyed: R2.surveyed })
    expect(parsePlaintext(V.layer.survey_only_plaintext)?.planes[0].cells).toEqual([0, -32767])
  })

  it('builder keys (§4.4)', () => {
    for (const c of V.builder_keys) expect(builderKeyValid(c.key, c.events), c.name).toBe(c.valid)
  })

  it('the home (§7.2)', () => {
    for (const c of V.home) expect(inHome(c.identity, chunkOfVector(c.chunk)), c.name).toBe(c.in_home)
  })

  it('the Stack and co-builders (§7, §8)', () => {
    const S = V.stack
    expect(V.future_slack).toBe(FUTURE_SLACK_SECONDS)
    for (const c of S.cases) {
      const chunk = chunkOfVector(c.chunk)
      const view: StackView = { me: S.reader, follows: new Set(S.follows), home: (a) => inHome(a, chunk) }
      const layers: StackLayer[] = c.layers.map((l) => {
        const values = new Int32Array(32768)
        const changed = Object.keys(l.changed).map(Number).sort((a, b) => a - b)
        for (const k of changed) values[k] = (l.changed as Record<string, number>)[String(k)]
        return { id: l.id, author: l.author, builder: l.builder, createdAt: l.created_at, cobuilders: l.cobuilders, planes: [{ plane: chunk.plane as 0 | 1, survey: false, ground: 2 as const, surveyed: l.created_at, values, changed }] }
      })
      const counted = countedLayers(layers, view, new Set(c.mutes), S.now, c.cap)
      const r = resolveStack(counted, chunk.plane as 0 | 1, view)
      for (const cell of c.cells) {
        const i = r.from[cell.cell]
        expect(i < 0 ? null : r.values[cell.cell], `${c.name}: cell ${cell.cell}`).toBe(cell.value)
        expect(i < 0 ? null : counted[i].id, `${c.name}: cell ${cell.cell} from`).toBe(cell.from)
        expect(i < 0 ? null : r.rank[cell.cell], `${c.name}: cell ${cell.cell} rank`).toBe(cell.rank)
      }
    }
  })
})

describe('planes and the plaintext (§5.4)', () => {
  it('in a diff a cell set explicitly to its base value is a change; a whole cannot say it, so the plane stays a diff', () => {
    const values = Int32Array.from(origin)
    values[rock] = 0
    const pl = encodePlane(0, true, values, origin, R2, new Set([air]))
    expect(pl.form).toBe('diff')
    const d = decodePlane(pl, origin)
    if (!d || d === 'aside') throw new Error('plane')
    expect(d.changed).toEqual([air, rock].sort((a, b) => a - b))
    expect(d.values[air]).toBe(0)
    // Without it, only the mined rock is a change.
    const d2 = decodePlane(encodePlane(0, true, values, origin, R2), origin)
    expect(d2 !== 'aside' && d2?.changed).toEqual([rock])
    // Every plane carries ground 2; a surveyed plane under another revision is set aside.
    expect(pl.ground).toBe(2)
    expect(decodePlane({ ...pl, ground: 1 }, origin)).toBe('aside')
  })

  it('the next plaintext carries the twin plane and the Crew, and is null when nothing changed', () => {
    const v = origin.slice()
    v[air] = 8
    const first = nextPlaintext(null, 0, v, origin, R2, [pk(5)])!
    expect(first.cobuilders).toEqual([pk(5)])
    expect(parsePlaintext(plaintextJson(first))).toEqual(first)
    expect(nextPlaintext(first, 0, v, origin, R2, [pk(5)])).toBeNull()
    expect(nextPlaintext(first, 0, v, origin, R2, [])?.cobuilders).toEqual([])
    const twin: LayerPlaintext = { cobuilders: [], planes: [{ ...first.planes[0], plane: 1 }] }
    const both = nextPlaintext(twin, 0, v, origin, R2)!
    expect(both.planes.map((p) => p.plane)).toEqual([0, 1])
    expect(both.planes[1]).toEqual(twin.planes[0])
    expect(parsePlaintext(JSON.stringify({ cobuilders: ['nope'], planes: first.planes }))).toBeNull()
    // No cobuilders field: an empty list.
    expect(parsePlaintext(JSON.stringify({ planes: first.planes }))?.cobuilders).toEqual([])
  })
})

describe('the layer event (§5.1, §5.5)', () => {
  it('has exactly the DECK\'s tags; at most one alt', () => {
    const tags = layerTags({ lookupId: LOOKUP, author: 'a'.repeat(64), encrypted: 'AAAA' })
    expect(tags).toEqual([['d', LOOKUP], ['p', 'a'.repeat(64)], ['encrypted', 'aes-256-gcm', 'AAAA'], ['version', '1']])
    expect(layerShape({ kind: LAYER_KIND, tags })).not.toBeNull()
    expect(layerShape({ kind: LAYER_KIND, tags: [...tags, ['alt', 'a'], ['alt', 'b']] })).toBeNull()
    expect(layerShape({ kind: LAYER_KIND, tags: tags.filter((t) => t[0] !== 'p') })).toBeNull()
    expect(layerShape({ kind: LAYER_KIND, tags: tags.map((t) => (t[0] === 'version' ? ['version', '2'] : t)) })).toBeNull()
  })

  it('content and alt at most 280 bytes of UTF-8', () => {
    const tags = layerTags({ lookupId: LOOKUP, author: 'a'.repeat(64), encrypted: 'AAAA' })
    expect(freeTextWithinBounds({ content: 'x'.repeat(280), tags: [...tags, ['alt', 'y'.repeat(280)]] })).toBe(true)
    expect(freeTextWithinBounds({ content: 'é'.repeat(140), tags })).toBe(true)
    expect(freeTextWithinBounds({ content: 'é'.repeat(141), tags })).toBe(false)
    expect(freeTextWithinBounds({ content: '', tags: [...tags, ['alt', 'y'.repeat(281)]] })).toBe(false)
  })
})

async function signed(plain: LayerPlaintext, author: string, builder: Uint8Array, extra: { content?: string; tags?: string[][] } = {}) {
  const encrypted = await encryptForRegion(KEY, plaintextJson(plain))
  return finalizeEvent({ kind: LAYER_KIND, created_at: 1_790_000_000, tags: [...layerTags({ lookupId: LOOKUP, author, encrypted }), ...(extra.tags ?? [])], content: extra.content ?? '' }, builder)
}
const deps = (status: KeyStatus = 'valid', over: Partial<ReadDeps> = {}): ReadDeps => ({
  verify: (ev) => verifyEvent(ev as never), key: KEY, lookupId: LOOKUP, ground: async () => origin, keyStatus: async () => status, ...over,
})

describe('sealing and opening (§5.2, §6)', () => {
  const v = origin.slice()
  v[air] = 8
  const plain = nextPlaintext(null, 0, v, origin, R2, [pk(9)])!

  it('a layer sealed to the chunk\'s key opens again and counts', async () => {
    const ev = await signed(plain, pk(1), generateSecretKey())
    expect(serializedBytes(ev)).toBeLessThan(240_000)
    const r = await readLayer(ev as never, deps())
    expect(r.status).toBe('counted')
    if (r.status !== 'counted') return
    expect(r.layer.cobuilders).toEqual([pk(9)])
    expect(r.layer.planes[0].changed).toEqual([air])
  })

  it('drops what fails a check (a void key among them); a key not checked yet waits', async () => {
    const sk = generateSecretKey()
    const ev = await signed(plain, pk(1), sk)
    expect(await readLayer(ev as never, deps('void'))).toEqual({ status: 'dropped', why: 'builder key not valid' })
    expect((await readLayer(ev as never, deps('unknown'))).status).toBe('pending')
    expect((await readLayer(ev as never, deps('valid', { key: generateSecretKey() }))).status).toBe('dropped')
    expect((await readLayer(await signed(plain, pk(1), sk, { content: 'x'.repeat(281) }) as never, deps())).status).toBe('dropped')
  })
})

describe('the Stack (§7)', () => {
  const cell = idx(4, 30, 4)
  const layer = (author: string, value: number, createdAt: number, cells: number[] = [cell], cobuilders: string[] = []): StackLayer => {
    const values = Int32Array.from(origin)
    for (const c of cells) values[c] = value
    const d = decodePlane(encodePlane(0, true, values, origin, R2), origin)
    if (!d || d === 'aside') throw new Error('plane')
    return { id: `${author.slice(0, 8)}${createdAt}`.padEnd(64, '0'), author, builder: author, createdAt, cobuilders, planes: [d] }
  }
  const view = (o: Partial<StackView> = {}): StackView => ({ me: pk(1), follows: new Set(), home: () => false, ...o })
  const show = (layers: StackLayer[], v: StackView, now = 2_000_000_000) => resolveStack(countedLayers(layers, v, new Set(), now), 0, v).values[cell]

  it('ranks 1 to 4: home owner, you, whom you follow, everyone else', () => {
    const v = view({ follows: new Set([pk(3)]), home: (a) => a === pk(7) })
    expect([pk(7), pk(1), pk(3), pk(9)].map((a) => ownRank(a, v))).toEqual([1, 2, 3, 4])
  })

  it('a stranger\'s newer layer never overrides yours, for you or for those who follow you', () => {
    const mine = layer(pk(1), 5, 100)
    const stranger = layer(pk(9), 41, 900)
    expect(show([mine, stranger], view())).toBe(5)
    expect(show([mine, stranger], view({ me: pk(2), follows: new Set([pk(1)]) }))).toBe(5)
    expect(show([mine, stranger], view({ me: pk(2) }))).toBe(41)
  })

  it('inside a home only the owner\'s surveys count', () => {
    const owner = layer(pk(7), 5, 1, [])
    const stranger = { ...layer(pk(9), 41, 1, []) }
    const v = view({ home: (a) => a === pk(7) })
    expect(resolveStack([stranger], 0, v).surveyed).toBe(true)
    expect(resolveStack([owner, stranger], 0, v).surveyed).toBe(true)
    const unsurveyedOwner: StackLayer = { ...owner, planes: [{ ...owner.planes[0], survey: false }] }
    expect(resolveStack([unsurveyedOwner, stranger], 0, v).surveyed).toBe(false)
  })

  it('a layer dated more than 600 s ahead waits', () => {
    const now = 1_000_000
    expect(show([layer(pk(9), 41, now + 601), layer(pk(8), 40, now)], view(), now)).toBe(40)
    expect(show([layer(pk(9), 41, now + 600), layer(pk(8), 40, now)], view(), now)).toBe(41)
  })
})

describe('a new builder key at a chunk (§5.6)', () => {
  const other = idx(6, 30, 6)
  const ground = (): Uint8Array => origin

  it('starts from the other keys\' layers, the newer winning, then applies its own changes; an emptied version changes nothing', () => {
    const a = origin.slice(); a[air] = 8; a[other] = 9
    const b = origin.slice(); b[air] = 10
    const pa = nextPlaintext(null, 0, a, origin, R2)!
    const pb = nextPlaintext(null, 0, b, origin, R2)!
    const mine = new Map([[0 as const, { survey: true, cells: new Map([[rock, 0]]), revision: 2 as const, surveyed: 300 }]])
    const start = startFrom([
      { changes: changesOf(pa, ground), createdAt: 100, builder: pk(2), id: pk(20) },
      { changes: changesOf(pb, ground), createdAt: 200, builder: pk(3), id: pk(30) },
    ], mine, ground, [pk(5)])
    const d = decodePlane(start.planes[0], origin)
    if (!d || d === 'aside') throw new Error('plane')
    expect(d.values[air]).toBe(10)
    expect(d.values[other]).toBe(9)
    expect(d.values[rock]).toBe(0)
    expect(start.cobuilders).toEqual([pk(5)])
    const e = emptiedPlaintext(start, [pk(5)])
    expect(e.cobuilders).toEqual([pk(5)])
    const ed = decodePlane(e.planes[0], origin)
    expect(ed !== 'aside' && ed?.changed).toEqual([])
    expect(e.planes[0].survey).toBe(true)
    expect(e.planes[0].ground).toBe(2)
  })
})
