/**
 * terrainGroundRevision.test.ts - the ground's revisions (DECK-0009 §3.9,
 * §3.10, §5.4, §7.5; cyberspace master f4d553f, #128), against the DECK's
 * own vectors (fixtures/deck0009-blocks-vectors.json, master's
 * decks/blocks-vectors.json byte for byte):
 *
 * - revision 2 is frozen: every revision 2 chunk of the file, byte for byte;
 * - revision 3: its feature table and its five chunks, each with its revision
 *   2 ground beside it, and the rock unchanged;
 * - the base revision of §7.5 (rank first, then `surveyed`, then author) and
 *   reading `surveyed` from a plane;
 * - the mixed chunk: a revision 3 layer that mines one cell over a revision 2
 *   base shows that cell mined and every other cell at revision 2;
 * - the write revision is 2 in this release, and one constant flips it.
 */

import { describe, expect, it, afterEach } from 'vitest'
import { sha256 } from '@noble/hashes/sha2.js'
import { idx, type ChunkBase } from '../terrain/coords'
import { B, FEATURES, FEATURES_R3, featuresOf, generate, isGroundRevision } from '../terrain/generate'
import { GROUND_WRITE_REVISION, groundWriteRevision, readSurveyed, setGroundWriteRevisionForTests, storedRevision } from '../terrain/groundRevision'
import { baseRevision, canonicalCells, decodePlane, encodePlane, nextPlaintext, parsePlaintext, plaintextJson, resolveStack, startAt, startFrom, changesOf, layerTags, LAYER_KIND, type StackLayer, type StackView } from '../terrain/blockLayer'
import { readLayer } from '../terrain/layerReader'
import { regionKeyAt, encryptForRegion } from '../shardCrypto'
import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure'
import { applyLayer, encodeLayer, layerRevision, rebaseBlocks } from '../terrain/layer'
import { composeView } from '../../store/terrainShare'
import M from './fixtures/deck0009-blocks-vectors.json'

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const base = (c: { X: string; Y: string; Z: string; plane: number }): ChunkBase => ({ x: BigInt(c.X), y: BigInt(c.Y), z: BigInt(c.Z), plane: c.plane })
const counts = (b: Uint8Array): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const id of b) out[String(id)] = (out[String(id)] ?? 0) + 1
  return out
}
const pk = (n: number): string => n.toString(16).padStart(64, '0')

afterEach(() => setGroundWriteRevisionForTests(null))

describe('revision 2 is frozen', () => {
  for (const c of M.chunks) {
    it(`the ${c.name} chunk at revision 2, byte for byte (unnamed and named)`, () => {
      const b = base(c)
      const g = generate(b)
      expect(hex(sha256(g.blocks))).toBe(c.ground_sha256)
      expect(hex(sha256(generate(b, null, 2).blocks))).toBe(c.ground_sha256)
      expect(counts(g.blocks)).toEqual(c.counts)
      expect(g.family).toBe(c.family)
      expect(g.maxK).toBe(c.max_K)
      expect(g.treeSites).toBe(c.tree_sites)
    })
  }

  it('its feature table is the one it always was', () => {
    expect(featuresOf(2)).toBe(FEATURES)
    expect(FEATURES.glowcore).toEqual({ t: 429496729, minK: 10, size: 7 })
    expect('cinder' in FEATURES).toBe(false)
  })
})

describe('revision 3 (DECK-0009 §3.9, the owner\'s option B)', () => {
  it('has the DECK\'s feature table', () => {
    const t = M.revision_3.features as Record<string, { t: number; minK: number }>
    for (const [name, roll] of Object.entries(t)) {
      const mine = (FEATURES_R3 as Record<string, { t: number; minK: number }>)[name]
      expect({ t: mine.t, minK: mine.minK }, name).toEqual(roll)
    }
    expect(Object.keys(FEATURES_R3).sort()).toEqual(Object.keys(t).sort())
    expect(FEATURES_R3.glowcore.size).toBe(3)
    expect(featuresOf(3)).toBe(FEATURES_R3)
  })

  for (const c of M.revision_3.chunks) {
    it(`the ${c.name} chunk at revision 3, with its revision 2 ground beside it`, () => {
      const b = base(c)
      expect(c.revision).toBe(3)
      const g3 = generate(b, null, 3)
      const g2 = generate(b, null, 2)
      expect(hex(sha256(g3.blocks))).toBe(c.ground_sha256)
      expect(hex(sha256(g2.blocks))).toBe(c.revision_2_ground_sha256)
      expect(counts(g3.blocks)).toEqual(c.counts)
      expect(g3.family).toBe(c.family)
      expect(g3.maxK).toBe(c.max_K)
      expect(g3.treeSites).toBe(c.tree_sites)
      for (const s of c.samples) expect(g3.blocks[idx(s.x, s.y, s.z)], `${c.name} at ${s.x},${s.y},${s.z}`).toBe(s.id)
      // The rock and caves are revision 2's: every cell open under one is open under the other.
      expect(c.rock_same_as_revision_2).toBe(true)
      for (let o = 0; o < g3.blocks.length; o++) if ((g3.blocks[o] === 0) !== (g2.blocks[o] === 0)) {
        // Only a feature that fills open space (Tidewater, trees) may differ, never the rock.
        const filler = (id: number): boolean => id === B.TIDEWATER || id === B.LUMENWOOD || id === B.CANOPY
        expect(filler(g3.blocks[o]) || filler(g2.blocks[o]), `${c.name} cell ${o}`).toBe(true)
      }
    })
  }

  it('the vent-5 chunk: no Cinderrock under revision 2, a vent of five under revision 3', () => {
    const c = M.revision_3.chunks.find((v) => v.name === 'vent-5')!
    const b = base(c)
    expect(counts(generate(b, null, 2).blocks)[String(B.CINDERROCK)]).toBeUndefined()
    expect(counts(generate(b, null, 3).blocks)[String(B.CINDERROCK)]).toBe(5)
  })

  it('the vent-glowcore-k9 chunk: Glowcore at K 9, which revision 2 could not place', () => {
    const c = M.revision_3.chunks.find((v) => v.name === 'vent-glowcore-k9')!
    const b = base(c)
    expect(c.max_K).toBe(9)
    expect(counts(generate(b, null, 2).blocks)[String(B.GLOWCORE)]).toBeUndefined()
    expect(counts(generate(b, null, 3).blocks)[String(B.GLOWCORE)]).toBeGreaterThan(0)
  })

  it('is refused for a revision this client does not make', () => {
    expect(() => generate({ x: 0n, y: 0n, z: 0n, plane: 0 }, null, 4 as never)).toThrow()
    expect([1, 2, 3, 4, '3', null].map(isGroundRevision)).toEqual([false, true, true, false, false, false])
  })
})

describe('the base revision (§7.5)', () => {
  for (const c of M.base_revision.cases) {
    it(c.name, () => {
      expect(baseRevision(c.surveys.map((s) => ({ ...s, revision: s.revision as 2 | 3 })))).toBe(c.base_revision)
      for (const e of (c as { surveyed_examples?: Array<{ plane: Record<string, unknown>; created_at: number; surveyed: number }> }).surveyed_examples ?? []) {
        expect(readSurveyed(e.plane, e.created_at), JSON.stringify(e.plane)).toBe(e.surveyed)
      }
    })
  }

  it('the mixed chunk: a revision 3 layer mines one cell over a revision 2 base; every other cell shows revision 2', () => {
    const X = M.base_revision.mixed
    const b: ChunkBase = { x: BigInt(X.chunk[0]), y: BigInt(X.chunk[1]), z: BigInt(X.chunk[2]), plane: Number(X.chunk[3]) }
    const g2 = generate(b, null, 2).blocks
    const g3 = generate(b, null, 3).blocks
    let differ = 0
    for (let o = 0; o < g2.length; o++) if (g2[o] !== g3[o]) differ++
    expect(differ).toBe(X.cells_where_revisions_differ)
    const f = X.first_differing_cell
    expect([g2[idx(f.x, f.y, f.z)], g3[idx(f.x, f.y, f.z)]]).toEqual([f.revision_2, f.revision_3])
    // The revision 3 plane, read against revision 3's ground: the one cell it mined.
    const p3 = decodePlane(X.revision_3_plane as never, g3, 2000)
    if (!p3 || p3 === 'aside') throw new Error('plane')
    expect(p3.ground).toBe(3)
    expect(p3.changed.map((c) => ({ x: c & 31, y: c >> 10, z: (c >> 5) & 31, value: p3.values[c] }))).toEqual(X.revision_3_changed)
    // A revision 2 layer that only surveys, first.
    const survey2 = decodePlane(encodePlane(0, true, g2, g2, { revision: 2, surveyed: 1000 }), g2, 1000)
    if (!survey2 || survey2 === 'aside') throw new Error('plane')
    const layers: StackLayer[] = [
      { id: pk(1), author: pk(0xa1), builder: pk(0xb1), createdAt: 1000, cobuilders: [], planes: [survey2] },
      { id: pk(2), author: pk(0xa2), builder: pk(0xb2), createdAt: 2000, cobuilders: [], planes: [p3] },
    ]
    const view: StackView = { me: pk(0xff), follows: new Set(), home: () => false }
    expect(resolveStack(layers, 0, view).baseRevision).toBe(X.base_revision)
    const v = composeView({ ground: g2, revision: 2, groundAt: (r) => (r === 3 ? g3 : g2), own: null, explicit: new Set(), others: layers, plane: 0, view, myCrew: [], mutes: new Set(), now: 3000 })
    expect(v.baseRevision).toBe(2)
    expect(v.missing).toBeNull()
    expect(v.blocks[idx(f.x, f.y, f.z)]).toBe(X.shown_at_first_differing_cell)
    const s2 = X.shown_at_second_differing_cell
    expect(v.blocks[idx(s2.x, s2.y, s2.z)]).toBe(s2.value)
    for (let o = 0; o < g2.length; o++) if (o !== idx(f.x, f.y, f.z)) expect(v.blocks[o]).toBe(g2[o])
    // Drawn over the other revision before its ground is at hand: it says which it waits for.
    const early = composeView({ ground: g3, revision: 3, own: null, explicit: new Set(), others: layers, plane: 0, view, myCrew: [], mutes: new Set(), now: 3000 })
    expect(early.missing).toBe(2)
  })

  it('a reader who ranks the revision 3 surveyor first sees revision 3 there', () => {
    const X = M.base_revision.mixed
    const b: ChunkBase = { x: BigInt(X.chunk[0]), y: BigInt(X.chunk[1]), z: BigInt(X.chunk[2]), plane: 0 }
    const g2 = generate(b, null, 2).blocks
    const g3 = generate(b, null, 3).blocks
    const survey2 = decodePlane(encodePlane(0, true, g2, g2, { revision: 2, surveyed: 1000 }), g2, 1000) as never
    const survey3 = decodePlane(encodePlane(0, true, g3, g3, { revision: 3, surveyed: 1500 }), g3, 1500) as never
    const layers: StackLayer[] = [
      { id: pk(1), author: pk(0xa1), builder: pk(0xb1), createdAt: 1000, cobuilders: [], planes: [survey2] },
      { id: pk(2), author: pk(0xa2), builder: pk(0xb2), createdAt: 1500, cobuilders: [], planes: [survey3] },
    ]
    expect(resolveStack(layers, 0, { me: null, follows: new Set(), home: () => false }).baseRevision).toBe(2)
    expect(resolveStack(layers, 0, { me: null, follows: new Set([pk(0xa2)]), home: () => false }).baseRevision).toBe(3)
    // Inside the revision 3 surveyor's home only their survey counts.
    expect(resolveStack(layers, 0, { me: null, follows: new Set(), home: (a) => a === pk(0xa2) }).baseRevision).toBe(3)
  })
})

describe('writing a plane names its revision and its first survey (§5.4, §3.10)', () => {
  const X = M.revision_3.chunks.find((v) => v.name === 'vent-glowcore-k9')!
  const b = base(X)
  const g2 = generate(b, null, 2).blocks
  const g3 = generate(b, null, 3).blocks

  it('a plane against revision 3 is read against revision 3\'s ground, never the displayed base', () => {
    const v = g3.slice()
    const cell = g3.findIndex((id) => id === B.GLOWCORE)
    v[cell] = 0
    const p = nextPlaintext(null, 0, v, g3, { revision: 3, surveyed: 500 })!
    expect(p.planes[0]).toMatchObject({ ground: 3, surveyed: 500, survey: true })
    const back = parsePlaintext(plaintextJson(p))!
    expect(back).toEqual(p)
    const d = decodePlane(back.planes[0], g3, 600)
    if (!d || d === 'aside') throw new Error('plane')
    expect(d.changed).toEqual([cell])
    expect(d.surveyed).toBe(500)
    // Encoded against revision 2's ground (the base another reader shows), the same blocks would claim, as changes, every cell the revisions differ in: never done.
    let differ = 0
    for (let o = 0; o < g2.length; o++) if (g2[o] !== v[o]) differ++
    const wrong = decodePlane(encodePlane(0, true, v, g2, { revision: 2, surveyed: 500 }), g2, 600)
    expect(wrong !== 'aside' && wrong!.changed.length).toBe(differ)
    expect(differ).toBeGreaterThan(1)
  })

  it('carries `surveyed` forward, and the twin plane gets one too when it had none', () => {
    const first = nextPlaintext(null, 0, g2, g2, { revision: 2, surveyed: 100 })!
    const v = g2.slice(); v[0] = 9
    const twinOld = { plane: 1 as const, survey: true, ground: 2, form: 'diff' as const, pal: [null], cells: [0, -32767] }
    const next = nextPlaintext({ ...first, planes: [...first.planes, twinOld] }, 0, v, g2, { revision: 2, surveyed: 100 }, [], new Set(), 400)!
    expect(next.planes[0].surveyed).toBe(100)
    expect(next.planes[1]).toEqual({ ...twinOld, surveyed: 400 })
  })

  it('a layer started from other keys\' layers names the base revision among them and the earliest survey (§5.6)', () => {
    const atR2 = nextPlaintext(null, 0, g2, g2, { revision: 2, surveyed: 100 })!
    const v3 = g3.slice(); const c3 = g3.findIndex((id) => id === B.GLOWCORE); v3[c3] = 0
    const groundAt = (_p: 0 | 1, r: 2 | 3): Uint8Array => (r === 3 ? g3 : g2)
    const mine = changesOf(nextPlaintext(null, 0, v3, g3, { revision: 3, surveyed: 900 })!, groundAt, 900)
    expect(mine.get(0)).toMatchObject({ revision: 3, surveyed: 900 })
    const start = startFrom([{ changes: changesOf(atR2, groundAt, 100), createdAt: 100, builder: pk(2), id: pk(20) }], mine, groundAt, [])
    expect(start.planes[0]).toMatchObject({ ground: 2, surveyed: 100 })
    // Your change stays a change, explicitly, though it is written against revision 2's ground.
    const d = decodePlane(start.planes[0], g2, 1000)
    if (!d || d === 'aside') throw new Error('plane')
    expect(d.values[c3]).toBe(0)
    expect(d.changed).toEqual([c3])
  })
})

describe('your own layers on the device (layer.ts)', () => {
  const X = M.revision_3.chunks.find((v) => v.name === 'vent-5')!
  const b = base(X)
  const g2 = generate(b, null, 2).blocks
  const g3 = generate(b, null, 3).blocks

  it('keep loading at the revision they name, either one', () => {
    for (const [g, r] of [[g2, 2], [g3, 3]] as const) {
      const cur = g.slice()
      cur[100] = 0
      cur[200] = 13
      const l = encodeLayer(g, cur, 0, r)
      expect(layerRevision(l)).toBe(r)
      expect(applyLayer(g, l, r)).toEqual(cur)
      // Never read over the other revision's ground.
      expect(applyLayer(r === 2 ? g3 : g2, l, r === 2 ? 3 : 2)).toBeNull()
    }
  })

  it('a layer without a ground is revision 1, which no diff is read against', () => {
    const l = encodeLayer(g2, g2, 0, 2)
    expect(layerRevision({ ...l, ground: undefined })).toBeNull()
    expect(applyLayer(g2, { ...l, ground: undefined }, 2)).toBeNull()
  })

  it('move to another revision with every change kept (rebaseBlocks)', () => {
    const cur = g2.slice()
    cur[100] = 0
    const moved = rebaseBlocks(cur, g2, g3)
    for (let o = 0; o < cur.length; o++) expect(moved[o]).toBe(o === 100 && g2[100] !== 0 ? 0 : g3[o])
  })
})

describe('the write revision (§3.10: read a release before writing)', () => {
  it('is 2 in this release; the flip is GROUND_WRITE_REVISION alone', () => {
    expect(GROUND_WRITE_REVISION).toBe(2)
    expect(groundWriteRevision()).toBe(2)
    setGroundWriteRevisionForTests(3)
    expect(groundWriteRevision()).toBe(3)
    setGroundWriteRevisionForTests(null)
    expect(groundWriteRevision()).toBe(GROUND_WRITE_REVISION)
  })

  it('a stored row without a revision is revision 2', () => {
    expect([undefined, null, 1, 2, 3, 4, '3'].map(storedRevision)).toEqual([2, 2, 2, 2, 3, 2, 2])
  })
})

describe('a `surveyed` that is not an integer never drops the layer (§5.4)', () => {
  const ORIGIN: ChunkBase = { x: 0n, y: 0n, z: 0n, plane: 0 }
  const g2 = generate(ORIGIN).blocks
  const v = g2.slice()
  v[g2.findIndex((id) => id !== 0)] = 0
  const text = plaintextJson(nextPlaintext(null, 0, v, g2, { revision: 2, surveyed: 123 })!)
  const withSurveyed = (raw: string | null): string => (raw === null ? text.replace('"surveyed":123,', '') : text.replace('"surveyed":123', `"surveyed":${raw}`))

  it('every one of the DECK\'s examples, read through the whole plaintext', () => {
    const ex = M.base_revision.cases.find((c) => 'surveyed_examples' in c) as unknown as { surveyed_examples: Array<{ plane: { surveyed?: unknown }; created_at: number; surveyed: number }> }
    for (const e of ex.surveyed_examples) {
      const raw = 'surveyed' in e.plane ? JSON.stringify(e.plane.surveyed) : null
      const p = parsePlaintext(withSurveyed(raw))
      expect(p, String(raw)).not.toBeNull()
      const d = decodePlane(p!.planes[0], g2, e.created_at)
      expect(d !== 'aside' && d?.surveyed, String(raw)).toBe(e.surveyed)
      expect(d !== 'aside' && d?.changed.length).toBe(1)
    }
  })

  it('a stranger\'s layer naming `surveyed: 400.5` is counted, its survey dated created_at', async () => {
    const { key, lookupId } = regionKeyAt(ORIGIN, 5, 5)
    const encrypted = await encryptForRegion(key, withSurveyed('400.5'))
    const ev = finalizeEvent({ kind: LAYER_KIND, created_at: 500, tags: layerTags({ lookupId, author: pk(0xa1), encrypted }), content: '' }, generateSecretKey())
    const r = await readLayer(ev as never, { verify: (e) => verifyEvent(e as never), key, lookupId, ground: async () => g2, keyStatus: async () => 'valid' })
    expect(r.status).toBe('counted')
    if (r.status !== 'counted') return
    expect(r.layer.planes[0].surveyed).toBe(500)
    expect(r.layer.planes[0].changed).toHaveLength(1)
  })

  it('the cells and the palette stay strict', () => {
    expect(canonicalCells('{"planes":[{"pal":[null,1],"cells":[0,-1,1]}],"x":1.5}')).toBe(true)
    expect(canonicalCells('{"planes":[{"pal":[null,1.0],"cells":[0]}]}')).toBe(false)
    expect(canonicalCells('{"planes":[{"pal":[null],"cells":[0,-1e2]}]}')).toBe(false)
    expect(canonicalCells('{"planes":[{"pal":[null],"cells":[01]}]}')).toBe(false)
    expect(canonicalCells('{"planes":[{"pal":[null],"cells":[0,-0]}]}')).toBe(false)
    // A key inside a string is not a key.
    expect(canonicalCells('{"planes":[{"note":"cells","pal":[null],"cells":[0]}],"cobuilders":[]}')).toBe(true)
    expect(parsePlaintext(text.replace('"cells":[0', '"cells":[0.0'))).toBeNull()
    expect(parsePlaintext(text.replace('"pal":[null,0]', '"pal":[null,0e0]'))).toBeNull()
  })
})

describe('a layer started from your other keys inside a home names the home owner\'s base (§5.6)', () => {
  const own = [{ changes: { survey: true, cells: new Map<number, number>(), revision: 2 as const, surveyed: 100 }, builder: pk(2), id: pk(20) }]
  const ownerAt3 = { revision: 3 as const, rank: 1, surveyed: 900, author: pk(0x70), builder: pk(0x71), id: pk(0x72) }

  it('the home owner\'s revision, your own earliest date', () => {
    expect(startAt(own, { author: pk(1), rank: 2, others: [ownerAt3] })).toEqual({ revision: 3, surveyed: 100 })
  })

  it('outside a home, or when you are the home owner, your own keys decide', () => {
    expect(startAt(own)).toEqual({ revision: 2, surveyed: 100 })
    expect(startAt(own, { author: pk(1), rank: 2, others: [{ ...ownerAt3, rank: 4, surveyed: 0 }] })).toEqual({ revision: 2, surveyed: 100 })
    expect(startAt(own, { author: pk(1), rank: 1, others: [ownerAt3] })).toEqual({ revision: 2, surveyed: 100 })
  })

  it('startFrom writes it: the owner\'s revision, your changes explicit against its ground', () => {
    const b: ChunkBase = { x: BigInt(M.base_revision.mixed.chunk[0]), y: BigInt(M.base_revision.mixed.chunk[1]), z: BigInt(M.base_revision.mixed.chunk[2]), plane: 0 }
    const g2 = generate(b, null, 2).blocks, g3 = generate(b, null, 3).blocks
    const c = g2.findIndex((id, o) => id !== g3[o] && id !== 0)
    const mine = new Map([[0 as const, { survey: true, cells: new Map([[c, g2[c]]]), revision: 2 as const, surveyed: 100 }]])
    const p = startFrom([], mine, (_pl, r) => (r === 3 ? g3 : g2), [], { builder: pk(2), id: '' }, () => ({ author: pk(1), rank: 2, others: [ownerAt3] }))
    expect(p.planes[0]).toMatchObject({ ground: 3, surveyed: 100 })
    const d = decodePlane(p.planes[0], g3, 1000)
    if (!d || d === 'aside') throw new Error('plane')
    expect(d.changed).toEqual([c])
    expect(d.values[c]).toBe(g2[c])
  })
})
