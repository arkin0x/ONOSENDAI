/**
 * stampCopy.test.ts: STAMP's COPY (owner, 2026-11-23): a shard's geometry put
 * into the open shard as points and faces of its own, where a LINK would
 * stand, colours merged into the palette, nothing of a reference left, and
 * what one stamp made named as two index ranges.
 */

import { describe, expect, it } from 'vitest'
import { newShard, TICKS_PER_UNIT, toPayload, fromPayload, ticksOf, type ShardModel } from 'sno-core/shards'
import { resolveParts, partMatrix } from 'sno-core/parts'
import { BUILT_IN, toBytes, toModel } from 'sno-core/snoPalette'
import { bakeSource, mergePalette, missingIn, snapToSize, stampCopyInto, stampedIndices, stampedShard, stampPart, stampSize, type CopySource } from '../stampCopy'

const T = TICKS_PER_UNIT
const ME = 'b'.repeat(64)
type Rgb = [number, number, number]
const RED: Rgb = toModel([200, 30, 40])
const TEAL: Rgb = toModel([10, 160, 150])

/** A 16-unit square tile centred on its origin, two faces, with its own small palette, as a kit piece is. */
function tile(name = 'Tile 16', color: Rgb = RED): ShardModel {
  const s = newShard(name)
  const corners: Array<[number, number, number]> = [[-8, 0, -8], [8, 0, -8], [8, 0, 8], [-8, 0, 8]]
  return {
    ...s,
    mode: 'solid',
    extent: 9,
    palette: [toBytes(color), toBytes(TEAL), [0, 0, 0]],
    vertices: corners.map((p, i) => ({ p, c: i === 2 ? TEAL : color })),
    faces: [[0, 1, 2], [0, 2, 3]],
  }
}

const bake = async (s: ShardModel, fetch: (ref: unknown) => Promise<unknown> = async () => null): Promise<CopySource | null> =>
  bakeSource(s, await resolveParts(s, fetch as never, { author: ME }))

describe('bakeSource', () => {
  it('flattens a shard and what it places from its own table into one set of points, by the matrices the bench draws with', async () => {
    const piece = tile('Piece')
    const address = `33331:${ME}:piece`
    const parent: ShardModel = {
      ...newShard('Parent'),
      author: ME,
      refs: [['a', address]],
      parts: [{ ref: 0, at: [16 * T, 0, 0], turn: [0, 90, 0], step: 0 }],
      objects: { [address]: toPayload(piece) },
    }
    const src = await bake(parent)
    expect(src).not.toBeNull()
    expect(src!.flattened).toBe(1)
    expect(src!.points).toHaveLength(4)
    expect(src!.faces).toEqual([[0, 1, 2], [0, 2, 3]])
    expect(src!.places).toEqual([address])
    // Each point is where partMatrix carries it: the bench's own drawing of the placement.
    const m = partMatrix(parent.parts![0], parent.unit, piece.unit)
    piece.vertices.forEach((v, i) => {
      const t = ticksOf(v)
      const r = [t[0] / T, t[1] / T, -t[2] / T]
      const x = m[0] * r[0] + m[4] * r[1] + m[8] * r[2] + m[12]
      const z = m[2] * r[0] + m[6] * r[1] + m[10] * r[2] + m[14]
      expect(src!.points[i].at[0]).toBe(Math.round(x * T))
      expect(src!.points[i].at[2]).toBe(Math.round(-z * T) || 0)
    })
    expect(src!.min).toEqual([8 * T, 0, -8 * T])
    expect(src!.max).toEqual([24 * T, 0, 8 * T])
  })

  it('refuses a shard with a placement nothing answers: COPY leaves no reference behind', async () => {
    const parent: ShardModel = { ...newShard('Parent'), refs: [['a', `33331:${ME}:gone`]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }
    const placed = await resolveParts(parent, async () => null, { author: ME })
    expect(missingIn(placed)).toBe(1)
    expect(bakeSource(parent, placed)).toBeNull()
  })

  it('lists every colour it uses once, as palette bytes', async () => {
    const src = await bake(tile())
    expect(src!.colors).toHaveLength(2)
  })
})

describe('stampCopyInto', () => {
  it('appends real points and faces where LINK would stand, and names exactly what it added', async () => {
    const src = (await bake(tile()))!
    const target: ShardModel = { ...newShard('Level'), extent: 32, mode: 'solid', vertices: [{ p: [0, 5, 0], c: RED }], faces: [] }
    const r = stampCopyInto(target, src, [16 * T, 0, 0], 0)
    if (!r.ok) throw new Error(r.why)
    expect(r.shard.vertices).toHaveLength(5)
    expect(r.shard.faces).toEqual([[1, 2, 3], [1, 3, 4]])
    expect(r.added).toEqual({ vertices: [1, 5], faces: [0, 2] })
    expect(stampedIndices(r.added)).toEqual({ vertices: [1, 2, 3, 4], faces: [0, 1] })
    expect(ticksOf(r.shard.vertices[1])).toEqual([8 * T, 0, -8 * T])
    // No reference: nothing placed, nothing carried.
    expect(r.shard.refs ?? []).toHaveLength(0)
    expect(r.shard.parts ?? []).toHaveLength(0)
    expect(r.shard.objects).toBeUndefined()
  })

  it('turns with the facing, a quarter at a time, exactly on the ticks', async () => {
    const src = (await bake(tile()))!
    const r = stampCopyInto({ ...newShard('Level'), extent: 32 }, src, [0, 0, 0], 1)
    if (!r.ok) throw new Error(r.why)
    for (const v of r.shard.vertices) for (const n of ticksOf(v)) expect(Math.abs(n) % (8 * T)).toBe(0)
    // The corner that was TEAL at (+8, +8) went a quarter about Y, as the placement's turn takes it.
    const m = partMatrix(stampPart([0, 0, 0], 1), 0, 0)
    const teal = r.shard.vertices[2]
    expect(Math.round(m[0] * 8 + m[8] * -8) * T).toBe(ticksOf(teal)[0])
  })

  it('keeps every colour, and an empty shard keeps the whole built-in to pick from, with the stamp’s colours in unused places', async () => {
    const src = (await bake(tile()))!
    const r = stampCopyInto({ ...newShard('Level'), extent: 32 }, src, [0, 0, 0], 0)
    if (!r.ok) throw new Error(r.why)
    expect(r.snapped).toBe(0)
    expect(r.shard.palette).toHaveLength(256)
    const back = fromPayload(JSON.parse(JSON.stringify(toPayload(r.shard))), 'x')!
    expect(back.vertices.map((v) => toBytes(v.c))).toEqual(r.shard.vertices.map((v) => toBytes(v.c)))
  })

  it('merges a second piece’s colours into the palette, never moving one the shard uses', async () => {
    const a = (await bake(tile('A', RED)))!
    const green: Rgb = toModel([20, 200, 60])
    const b = (await bake(tile('B', green)))!
    const one = stampCopyInto({ ...newShard('Level'), extent: 32 }, a, [0, 0, 0], 0)
    if (!one.ok) throw new Error(one.why)
    const two = stampCopyInto(one.shard, b, [16 * T, 0, 0], 0)
    if (!two.ok) throw new Error(two.why)
    // Every entry the first stamp's points use is where it was.
    for (const v of one.shard.vertices) {
      const i = one.shard.palette!.findIndex((c) => c.every((n, k) => n === toBytes(v.c)[k]))
      expect(i).toBeGreaterThanOrEqual(0)
      expect(two.shard.palette![i]).toEqual(one.shard.palette![i])
    }
    const back = fromPayload(JSON.parse(JSON.stringify(toPayload(two.shard))), 'x')!
    expect(back.vertices.map((v) => toBytes(v.c))).toEqual(two.shard.vertices.map((v) => toBytes(v.c)))
  })

  it('keeps seams all or none: a face without one takes its corners’ average', async () => {
    const seamed: ShardModel = { ...tile(), facecolors: [RED, TEAL] }
    const src = (await bake(seamed))!
    const target: ShardModel = { ...newShard('Level'), extent: 32, mode: 'solid', vertices: [{ p: [0, 0, 0], c: RED }, { p: [1, 0, 0], c: RED }, { p: [0, 1, 0], c: RED }], faces: [[0, 1, 2]] }
    const r = stampCopyInto(target, src, [16 * T, 0, 0], 0)
    if (!r.ok) throw new Error(r.why)
    expect(r.shard.facecolors).toHaveLength(3)
    expect(r.shard.facecolors![1]).toEqual(RED)
    expect(r.shard.facecolors![2]).toEqual(TEAL)
  })

  it('grows the grid to hold it, and refuses past the edge of any grid', async () => {
    const src = (await bake(tile()))!
    const r = stampCopyInto({ ...newShard('Level'), extent: 8 }, src, [16 * T, 0, 0], 0)
    if (!r.ok) throw new Error(r.why)
    expect(r.shard.extent).toBe(24)
    const far = stampCopyInto({ ...newShard('Level'), extent: 8 }, src, [60 * T, 0, 0], 0)
    expect(far.ok).toBe(false)
    if (!far.ok) expect(far.why).toMatch(/^Not stamped: /)
  })

  it('switches a shard to SOLID with its first faces', async () => {
    const src = (await bake(tile()))!
    const r = stampCopyInto({ ...newShard('Level'), extent: 32, mode: 'lines' }, src, [0, 0, 0], 0)
    expect(r.ok && r.shard.mode).toBe('solid')
  })
})

describe('nested and scaled', () => {
  it('flattens a placement inside a placement, each by its own matrix', async () => {
    const piece = tile('Piece')
    const a1 = `33331:${ME}:piece`, a2 = `33331:${ME}:mid`
    const mid: ShardModel = { ...newShard('Mid'), refs: [['a', a1]], parts: [{ ref: 0, at: [4 * T, 0, 0], turn: [0, 0, 0], step: 0 }] }
    const top: ShardModel = { ...newShard('Top'), author: ME, refs: [['a', a2]], parts: [{ ref: 0, at: [0, 2 * T, 0], turn: [0, 90, 0], step: 0 }], objects: { [a1]: toPayload(piece), [a2]: toPayload(mid) } }
    const src = (await bake(top))!
    expect(src.flattened).toBe(2)
    expect(src.places.sort()).toEqual([a1, a2].sort())
    // The piece's (-8, 0, -8) corner: +4 along X in Mid, then a quarter about Y and +2 up in Top.
    const m = partMatrix(top.parts![0], 0, 0)
    const inMid = [-4, 0, 8] // render frame: (-8 + 4, 0, -(-8))
    const x = m[0] * inMid[0] + m[4] * inMid[1] + m[8] * inMid[2] + m[12]
    const y = m[1] * inMid[0] + m[5] * inMid[1] + m[9] * inMid[2] + m[13]
    const z = m[2] * inMid[0] + m[6] * inMid[1] + m[10] * inMid[2] + m[14]
    expect(src.points[0].at.map((n) => Math.round(n))).toEqual([Math.round(x * T), Math.round(y * T), Math.round(-z * T)])
  })

  it('rounds once, where it lands, and says how many points fell between ticks', async () => {
    // A unit-0 piece stamped into a unit-2 shard: 4 gibsons to a unit, so 8 gibsons is 2 units, but a 1-tick offset is a quarter tick.
    const piece: ShardModel = { ...tile(), vertices: [{ p: [0, 0, 0], t: [1, 0, 0], c: RED }, { p: [8, 0, 0], c: RED }, { p: [0, 0, 8], c: RED }], faces: [[0, 1, 2]] }
    const src = (await bake(piece))!
    const r = stampCopyInto({ ...newShard('Level'), unit: 2, extent: 32 }, src, [0, 0, 0], 0)
    if (!r.ok) throw new Error(r.why)
    expect(r.rounded).toBe(1)
    expect(ticksOf(r.shard.vertices[1])).toEqual([2 * T, 0, 0])
  })
})

describe('mergePalette', () => {
  it('appends while there is room, then uses colours the shard does not use, and counts the rest as snapped', () => {
    const full = BUILT_IN.map((c) => [...c] as Rgb)
    const used = full.map((c) => ({ p: [0, 0, 0] as [number, number, number], c: toModel(c) }))
    const novel: Rgb[] = [[1, 2, 3], [4, 5, 6]]
    // Every built-in colour used: no room at all.
    expect(mergePalette({ palette: full, vertices: used, faces: [] }, novel).snapped).toBe(2)
    // Only the first used: the new ones take unused places from the end.
    const m = mergePalette({ palette: full, vertices: used.slice(0, 1), faces: [] }, novel)
    expect(m.snapped).toBe(0)
    expect(m.palette![0]).toEqual(full[0])
    expect(m.palette).toContainEqual([1, 2, 3])
    // A short palette grows.
    const short = mergePalette({ palette: [[9, 9, 9], [8, 8, 8]], vertices: used.slice(0, 1), faces: [] }, novel)
    expect(short.palette).toEqual([[9, 9, 9], [8, 8, 8], [1, 2, 3], [4, 5, 6]])
  })

  it('never moves an entry the shard uses by index, even through a colour not exactly in the palette', () => {
    const full = BUILT_IN.map((c) => [...c] as Rgb)
    const last = full[255]
    // A legacy colour one step off the last entry: the wire writes it as entry 255.
    const near: Rgb = [Math.min(255, last[0] + 1), last[1], last[2]]
    const used = full.slice(0, 254).map((c) => ({ p: [0, 0, 0] as [number, number, number], c: toModel(c) }))
    used.push({ p: [0, 0, 0], c: toModel(near) })
    const m = mergePalette({ palette: full, vertices: used, faces: [] }, [[1, 2, 3]])
    expect(m.palette![255]).toEqual(last)
    expect(m.palette![254]).toEqual([1, 2, 3])
  })

  it('leaves the palette alone when it already has every colour', () => {
    expect(mergePalette({ vertices: [], faces: [] }, [BUILT_IN[3]]).palette).toBeUndefined()
  })
})

describe('stampedShard LINK', () => {
  it('places by reference, grows the grid to hold it, and refuses itself and a shard that places it', async () => {
    const src = (await bake(tile()))!
    const target: ShardModel = { ...newShard('Level'), extent: 8 }
    const self = `33331:${ME}:${target.id}`
    const ok = stampedShard(target, { ref: ['a', `33331:${ME}:other`], copy: src }, 'link', [20 * T, 0, 0], 0, true, self)
    if (!ok.ok) throw new Error(ok.why)
    expect(ok.shard.parts).toHaveLength(1)
    expect(ok.shard.extent).toBe(20)
    expect(stampedShard(target, { ref: ['a', self], copy: src }, 'link', [0, 0, 0], 0, true, self)).toEqual({ ok: false, why: 'An object cannot place itself.' })
    const loop = stampedShard(target, { ref: ['a', `33331:${ME}:other`], copy: null, places: [self] }, 'link', [0, 0, 0], 0, true, self)
    expect(loop.ok).toBe(false)
    if (!loop.ok) expect(loop.why).toMatch(/would make a loop/)
  })
})

describe('snap to its size', () => {
  it('steps a 16-unit piece by 16 along the working plane, the level along its normal', async () => {
    const src = (await bake(tile()))!
    const size = stampSize(src, 0, 0)!
    expect(size).toEqual([16 * T, 0, 16 * T])
    expect(snapToSize([9.2 * T, 3 * T, -23 * T], 2 * T, 1, size, T)).toEqual([16 * T, 2 * T, -16 * T])
    // Flat along an axis: that axis keeps the grid's own step.
    expect(snapToSize([0, 0, 0.4 * T], 0, 0, size, T)).toEqual([0, 0, 0])
  })

  it('turns with the facing: a 16 by 8 piece steps 8 by 16 a quarter round', async () => {
    const long: ShardModel = { ...tile(), vertices: [[-8, 0, -4], [8, 0, -4], [8, 0, 4], [-8, 0, 4]].map((p) => ({ p: p as [number, number, number], c: RED })) }
    const src = (await bake(long))!
    expect(stampSize(src, 0, 0)).toEqual([16 * T, 0, 8 * T])
    expect(stampSize(src, 1, 0)).toEqual([8 * T, 0, 16 * T])
  })

  it('is in the open shard’s ticks: a unit-1 piece is twice as big on a unit-0 grid', async () => {
    const src = (await bake({ ...tile(), unit: 1 }))!
    expect(stampSize(src, 0, 0)).toEqual([32 * T, 0, 32 * T])
  })
})
