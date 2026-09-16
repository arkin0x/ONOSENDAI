/**
 * shards.test.ts - the wire form round-trips, and refuses what would crash a
 * drawer.
 */

import { describe, it, expect } from 'vitest'
import { TICKS_PER_UNIT, expandFaceColors, flatten, fromPayload, newShard, normalizeStored, packFaceColors, packTicks, ticksOf, toPayload, toRender, unitsLabel, unpackFaceColors, unpackTicks, validFace, validPoint, vertexAt, type ShardModel } from './shards'
import { BUILT_IN, indexOf, readPalette, resolvePalette } from './snoPalette'

const tri: ShardModel = {
  ...newShard('tri'),
  mode: 'solid',
  unit: 3,
  vertices: [
    { p: [0, 0, 0], c: [1, 0, 0] },
    { p: [2, 0, 0], c: [0, 1, 0] },
    { p: [0, 2, 0], c: [0, 0, 1] },
  ],
  faces: [[0, 1, 2]],
}

/**
 * A v2 payload as a genuine v1 one. Flipping the version number is not enough
 * any more: v1 predates the palette, so its colours are literal triples, which
 * is what every shard written before DECK-0003 actually looks like.
 */
function asV1(p: ReturnType<typeof toPayload>): Record<string, unknown> {
  return { ...p, v: 1, colors: p.colors.map((i) => BUILT_IN[i as number].map((n) => n / 255)) }
}

describe('payload', () => {
  it('round-trips', () => {
    const back = fromPayload(JSON.parse(JSON.stringify(toPayload(tri))), 'x')
    expect(back).not.toBeNull()
    expect(back!.vertices).toEqual(tri.vertices)
    expect(back!.faces).toEqual(tri.faces)
    expect(back!.mode).toBe('solid')
    expect(back!.unit).toBe(3)
    expect(back!.name).toBe('tri')
  })

  it('refuses a face that points past the vertices', () => {
    const p = toPayload(tri)
    expect(fromPayload({ ...p, faces: [[0, 1, 9]] }, 'x')).toBeNull()
  })

  it('refuses mismatched colors, unknown modes, bad units and other types', () => {
    const p = toPayload(tri)
    expect(fromPayload({ ...p, colors: p.colors.slice(1) }, 'x')).toBeNull()
    expect(fromPayload({ ...p, mode: 'voxels' }, 'x')).toBeNull()
    expect(fromPayload({ ...p, unit: 99 }, 'x')).toBeNull()
    expect(fromPayload('nope', 'x')).toBeNull()
  })

  it('ignores a `type` field rather than requiring or rejecting on it', () => {
    // DECK-0003 §1.1a: the format has no such field. Payloads written before
    // that deck carry `type: "shard"`, and rejecting on it would refuse every
    // object anyone else writes correctly.
    const p = toPayload(tri)
    expect(p).not.toHaveProperty('type')
    for (const type of ['shard', 'note', 17, null]) {
      expect(fromPayload({ ...p, type }, 'x'), String(type)).not.toBeNull()
    }
  })

  it('writes one palette index per vertex, not three numbers', () => {
    // DECK-0003 §1.3. This is what took a worst-case vertex from 52 bytes to
    // 32 and made a colour on every face affordable.
    const p = toPayload(tri)
    expect(p.colors).toHaveLength(tri.vertices.length)
    for (const c of p.colors) {
      expect(Number.isInteger(c), String(c)).toBe(true)
      expect(c).toBeGreaterThanOrEqual(0)
      expect(c).toBeLessThan(256)
    }
  })

  it('snaps a colour the palette does not have to the nearest one it does', () => {
    // The workshop only offers palette colours, so this is the legacy path: a
    // model built before the palette existed, where snapping is the
    // alternative to throwing the colour away.
    const messy = { ...tri, vertices: tri.vertices.map((v) => ({ ...v, c: [0.8039215686274510, 1 / 3, 0] as [number, number, number] })) }
    const back = fromPayload(toPayload(messy), 'x')
    const got = back!.vertices[0].c
    // Near, not exact, and every channel is a palette value.
    expect(Math.abs(got[0] - 0.8039215686274510)).toBeLessThan(0.15)
    for (const channel of got) expect(Math.round(channel * 255) / 255).toBeCloseTo(channel, 6)
  })

  it('rejects a colour that is not an index into the palette', () => {
    // There is nothing left to clamp: a colour is an index, and an index that
    // names no entry is a defect in the payload rather than a value to fix.
    const p = toPayload(tri)
    for (const bad of [[2, -1, 0.5], [256, 0, 0], [-1, 0, 0], [1.5, 0, 0], ['7', 0, 0]]) {
      expect(fromPayload({ ...p, colors: bad }, 'x'), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('the pose on the wire', () => {
  const standing: ShardModel = { ...tri, up: true, spin: 135 }

  it('is absent from a shard that lies as it was built, byte for byte as before', () => {
    const p = toPayload(tri)
    expect('up' in p).toBe(false)
    expect('spin' in p).toBe(false)
    // An older payload, which has neither, reads back as lying flat.
    const back = fromPayload(JSON.parse(JSON.stringify(p)), 'x')!
    expect(back.up).toBe(false)
    expect(back.spin).toBe(0)
  })

  it('round-trips a standing shard with its bearing', () => {
    const back = fromPayload(JSON.parse(JSON.stringify(toPayload(standing))), 'x')!
    expect(back.up).toBe(true)
    expect(back.spin).toBe(135)
  })

  it('wraps the bearing it writes into 0..359', () => {
    expect(toPayload({ ...standing, spin: 400 }).spin).toBe(40)
    expect(toPayload({ ...standing, spin: -1 }).spin).toBe(359)
  })

  it('ignores a bearing on a shard that does not say it stands', () => {
    const p = { ...toPayload(tri), spin: 90 }
    const back = fromPayload(p, 'x')!
    expect(back.up).toBe(false)
    expect(back.spin).toBe(0)
  })

  it('refuses a pose it cannot draw', () => {
    const p = toPayload(standing)
    expect(fromPayload({ ...p, up: 'yes' }, 'x')).toBeNull()
    expect(fromPayload({ ...p, spin: 1.5 }, 'x')).toBeNull()
    expect(fromPayload({ ...p, spin: 360 }, 'x')).toBeNull()
    expect(fromPayload({ ...p, spin: -1 }, 'x')).toBeNull()
    expect(fromPayload({ ...p, spin: '90' }, 'x')).toBeNull()
  })

  it('fills the pose in on a model stored before it existed', () => {
    const old = { ...tri } as Partial<ShardModel>
    delete old.up
    delete old.spin
    const back = normalizeStored(old as ShardModel)
    expect(back.up).toBe(false)
    expect(back.spin).toBe(0)
  })
})

describe('geometry', () => {
  it('flattens vertices and faces in order', () => {
    const f = flatten(tri)
    expect(Array.from(f.positions)).toEqual([0, 0, 0, 2, 0, 0, 0, 2, 0])
    expect(Array.from(f.colors)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
    expect(f.index).toEqual([0, 1, 2])
  })

  it('validates points and faces', () => {
    expect(validPoint([TICKS_PER_UNIT, -8 * TICKS_PER_UNIT, 8 * TICKS_PER_UNIT])).toBe(true)
    expect(validPoint([9 * TICKS_PER_UNIT, 0, 0])).toBe(false)
    expect(validPoint([40, 30, -24])).toBe(true)     // a third, a quarter, a fifth
    expect(validPoint([0.5, 0, 0])).toBe(false)
    expect(validFace([0, 1, 2], 3)).toBe(true)
    expect(validFace([0, 1, 1], 3)).toBe(false)
    expect(validFace([0, 1, 3], 3)).toBe(false)
  })
})

describe('ticks', () => {
  it('carries thirds, quarters and fifths exactly, with the run shorthand, and reads an old payload as whole units', () => {
    const v = (total: [number, number, number]) => vertexAt(total, [1, 0, 0])
    const s = { ...newShard('t'), vertices: [v([0, 0, 0]), v([TICKS_PER_UNIT, 0, 0]), v([40, -30, 24 + 2 * TICKS_PER_UNIT]), v([0, 0, 0])] }
    expect(s.vertices[2]).toEqual({ p: [0, -1, 2], t: [40, 90, 24], c: [1, 0, 0] })
    expect(s.vertices[1]).toEqual({ p: [1, 0, 0], c: [1, 0, 0] })
    // Out on the wire, Z is negated into the published frame (DECK-0003 §2):
    // 24 + 2 units forward becomes the same distance back, which is three
    // units short with 96 ticks of remainder.
    const wire = toPayload(s)
    expect(wire.v).toBe(2)
    expect(wire.vertices).toEqual([[0, 0, 0], [1, 0, 0], [0, -1, -3], [0, 0, 0]])
    expect(wire.ticks).toEqual([-2, [40, 90, 96], -1])
    const back = fromPayload(wire, 'x')!
    expect(back.vertices).toEqual(s.vertices)
    // A v1 payload was written in this client's own frame, so it is read as
    // it stands; the same numbers marked v2 would come back mirrored.
    const old = { ...asV1(wire), ticks: undefined }
    expect(fromPayload(old, 'y')!.vertices.map((x) => ticksOf(x))).toEqual([[0, 0, 0], [TICKS_PER_UNIT, 0, 0], [0, -TICKS_PER_UNIT, -3 * TICKS_PER_UNIT], [0, 0, 0]])
    expect(unpackTicks([-3], 4)).toBeNull()
    expect(unpackTicks([[120, 0, 0]], 1)).toBeNull()
    expect(packTicks([])).toEqual([])
  })
  it('draws model +Z along render -Z, as the world draws cyberspace', () => {
    expect(toRender([TICKS_PER_UNIT, 2 * TICKS_PER_UNIT, 3 * TICKS_PER_UNIT])).toEqual([1, 2, -3])
    const one = { ...newShard('z'), vertices: [{ p: [0, 0, 1] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
    expect(Array.from(flatten(one).positions)).toEqual([0, 0, -1])
  })
  it('normalizes a model saved while positions were kept in ticks, and leaves a unit model alone', () => {
    const units = { ...newShard('u'), vertices: [{ p: [3, 0, -2] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
    expect(normalizeStored(units)).toBe(units)
    const interim = { ...newShard('i'), vertices: [{ p: [360, 40, -240] as [number, number, number], c: [1, 1, 1] as [number, number, number] }] }
    expect(normalizeStored(interim).vertices[0]).toEqual({ p: [3, 0, -2], t: [0, 40, 0], c: [1, 1, 1] })
  })
  it('prints ticks as units', () => {
    expect(unitsLabel(0)).toBe('0')
    expect(unitsLabel(240)).toBe('2')
    expect(unitsLabel(40)).toBe('1/3')
    expect(unitsLabel(-30)).toBe('-1/4')
    expect(unitsLabel(2 * 120 + 90)).toBe('2 3/4')
  })
})

describe('DECK-0003 §2: the wire is right-handed, this client is not', () => {
  const model = {
    ...newShard('flip'),
    vertices: [
      { p: [1, 2, 3] as [number, number, number], c: [1, 0, 0] as [number, number, number] },
      { p: [0, 0, 0] as [number, number, number], t: [0, 0, 40] as [number, number, number], c: [0, 1, 0] as [number, number, number] },
    ],
    faces: [],
  }

  it('writes v2 and negates Z on the way out', () => {
    const p = toPayload(model)
    expect(p.v).toBe(2)
    expect(p.vertices[0]).toEqual([1, 2, -3])
    // A third of a unit forward becomes a third back: the floor and the
    // remainder move together, which is why the flip is done on total ticks.
    expect(p.vertices[1]).toEqual([0, 0, -1])
    expect(unpackTicks(p.ticks, 2)![1]).toEqual([0, 0, 80])
  })

  it('round trips: out and back is what went in', () => {
    const back = fromPayload(toPayload(model), 'id')!
    expect(ticksOf(back.vertices[0])).toEqual(ticksOf(model.vertices[0]))
    expect(ticksOf(back.vertices[1])).toEqual(ticksOf(model.vertices[1]))
  })

  it('reads a v1 payload unchanged, because v1 was already this frame', () => {
    const v2 = toPayload(model)
    const v1 = asV1(v2)
    const fromV2 = fromPayload(v2, 'a')!
    const fromV1 = fromPayload(v1, 'b')!
    expect(ticksOf(fromV2.vertices[0])).toEqual([120, 240, 360])
    expect(ticksOf(fromV1.vertices[0])).toEqual([120, 240, -360])
  })

  it('takes both versions and nothing else', () => {
    const p = toPayload(model)
    expect(fromPayload(asV1(p), 'x')).not.toBeNull()
    expect(fromPayload({ ...p, v: 2 }, 'x')).not.toBeNull()
    expect(fromPayload({ ...p, v: 3 }, 'x')).toBeNull()
    expect(fromPayload({ ...p, v: 0 }, 'x')).toBeNull()
  })
})

describe('face colours (DECK-0003 §1.4a)', () => {
  const cube = (facecolors?: Array<[number, number, number]>): ShardModel => ({
    id: 'c', name: 'cube', unit: 0, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0,
    vertices: [
      vertexAt([0, 0, 0], [1, 1, 1]), vertexAt([1, 0, 0], [1, 1, 1]),
      vertexAt([1, 1, 0], [1, 1, 1]), vertexAt([0, 1, 0], [1, 1, 1]),
    ],
    faces: [[0, 1, 2], [0, 2, 3]],
    ...(facecolors ? { facecolors } : {}),
  })

  it('is absent when nothing asked for it, which is not the same as black', () => {
    expect(toPayload(cube())).not.toHaveProperty('facecolors')
    expect(fromPayload(toPayload(cube()), 'x')!.facecolors).toBeUndefined()
  })

  it('round-trips one colour per face', () => {
    // Pure red and pure blue are in the built-in, so the trip is exact.
    const back = fromPayload(toPayload(cube([[1, 0, 0], [0, 0, 1]])), 'x')
    expect(back!.facecolors).toEqual([[1, 0, 0], [0, 0, 1]])
  })

  it('packs a run rather than repeating the index', () => {
    // The whole point: a stamped block is twelve triangles of one colour.
    expect(packFaceColors(Array.from({ length: 12 }, () => 7))).toEqual([7, -11])
    expect(unpackFaceColors([7, -11], 12, BUILT_IN)).toEqual(Array.from({ length: 12 }, () => 7))
  })

  it('refuses a run before there is anything to repeat', () => {
    // The sign is what separates an index from a run, so the first entry
    // cannot be one: there would be nothing to repeat.
    expect(unpackFaceColors([-3], 3, BUILT_IN)).toBeNull()
  })

  it('refuses entries that expand to the wrong number of faces', () => {
    expect(unpackFaceColors([7, -5], 2, BUILT_IN)).toBeNull()
    expect(unpackFaceColors([7], 2, BUILT_IN)).toBeNull()
    expect(unpackFaceColors([], 0, BUILT_IN)).toBeNull()
  })

  it('refuses a fractional entry, junk, and an index past the palette', () => {
    expect(unpackFaceColors([7, -1.5], 2, BUILT_IN)).toBeNull()
    expect(unpackFaceColors([7, 'red'], 2, BUILT_IN)).toBeNull()
    expect(unpackFaceColors([256, -1], 2, BUILT_IN)).toBeNull()
    // Bounded by whichever palette applies, not by 256.
    expect(unpackFaceColors([4, -1], 2, BUILT_IN.slice(0, 4))).toBeNull()
  })

  it('rejects a whole payload whose face colours do not fit its faces', () => {
    const p = { ...toPayload(cube([[1, 0, 0], [0, 0, 1]])), facecolors: [7] }
    expect(fromPayload(p, 'x')).toBeNull()
  })

  it('writes face colours as indices too', () => {
    const p = toPayload(cube([[1, 0, 0], [0, 0, 1]]))
    for (const e of p.facecolors as number[]) expect(Number.isInteger(e)).toBe(true)
  })
})

describe('the palette (DECK-0003 §1.3a and §1.3b)', () => {
  const NADDR = 'naddr1qqxnzdenxvmnxdfhxg6rwwfjqy88wumn8ghj7mn0wvhxcmmv'

  it('has 256 entries, laid out the way the deck says', () => {
    expect(BUILT_IN).toHaveLength(256)
    expect(new Set(BUILT_IN.map((c) => c.join(','))).size).toBe(256)
    // The signatures: pure red, white, and ONOSENDAI's own cyan, exact.
    expect(BUILT_IN[238]).toEqual([255, 0, 0])
    expect(BUILT_IN[225]).toEqual([255, 255, 255])
    expect(BUILT_IN[226]).toEqual([0, 229, 255])
    // A ramp climbs: hue h step s is h * 8 + s, and step 7 is the brightest.
    for (let h = 0; h < 24; h++) {
      const sum = (i: number): number => BUILT_IN[i].reduce((a, b) => a + b, 0)
      expect(sum(h * 8 + 7), `hue ${h}`).toBeGreaterThan(sum(h * 8))
    }
  })

  it('resolves absent and the registered name to the built-in', () => {
    expect(resolvePalette(undefined)).toBe(BUILT_IN)
    expect(resolvePalette('cyberspace-neon-256')).toBe(BUILT_IN)
  })

  it('refuses a name it does not know, but never a reference', () => {
    expect(resolvePalette('no-such-palette')).toBeNull()
    // §1.3b: a reference is never load-bearing. Unresolved is the built-in,
    // so the worst case is wrong colours and never an object that will not draw.
    expect(resolvePalette(NADDR)).toBe(BUILT_IN)
    expect(fromPayload({ ...toPayload(tri), palette: NADDR }, 'x')).not.toBeNull()
  })

  it('reads a fetched palette in either entry shape', () => {
    expect(resolvePalette(NADDR, '["#ff0000","#00ff00"]')).toEqual([[255, 0, 0], [0, 255, 0]])
    expect(resolvePalette(NADDR, '[[255,0,0],[0,255,0]]')).toEqual([[255, 0, 0], [0, 255, 0]])
  })

  it('treats content that is not a palette as a fetch that failed', () => {
    for (const junk of ['not json', '{}', '[]', '["#ff00"]', '[[300,0,0],[0,0,0]]']) {
      expect(resolvePalette(NADDR, junk), junk).toBe(BUILT_IN)
    }
  })

  it('carries a short palette in the payload, and bounds indices by it', () => {
    const four = { ...toPayload(tri), palette: [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]], colors: [0, 1, 2] }
    expect(fromPayload(four, 'x')!.vertices[0].c).toEqual([1, 0, 0])
    expect(fromPayload({ ...four, colors: [0, 1, 4] }, 'x')).toBeNull()
  })

  it('refuses a palette of one, or an entry that is not three bytes', () => {
    expect(readPalette([[255, 0, 0]])).toBeNull()
    expect(readPalette(Array.from({ length: 257 }, () => [0, 0, 0]))).toBeNull()
    expect(readPalette([[255, 0, 300], [0, 0, 0]])).toBeNull()
    expect(readPalette([[255, 0], [0, 0, 0]])).toBeNull()
  })

  it('finds an exact entry before it looks for a near one', () => {
    for (const i of [0, 7, 100, 226, 255]) expect(indexOf(BUILT_IN, BUILT_IN[i])).toBe(i)
  })
})

describe('expandFaceColors', () => {
  const two: ShardModel = {
    id: 'c', name: 'two', unit: 0, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0,
    vertices: [
      vertexAt([0, 0, 0], [1, 1, 1]), vertexAt([1, 0, 0], [1, 1, 1]),
      vertexAt([1, 1, 0], [1, 1, 1]), vertexAt([0, 1, 0], [1, 1, 1]),
    ],
    faces: [[0, 1, 2], [0, 2, 3]],
    facecolors: [[1, 0, 0], [0, 0, 1]],
  }

  it('gives every face three corners of its own, in the face colour', () => {
    // Shared corners cannot hold a seam: vertex 0 belongs to both faces.
    const out = expandFaceColors(two)
    expect(out.vertices).toHaveLength(6)
    expect(out.vertices.slice(0, 3).map((v) => v.c)).toEqual([[1, 0, 0], [1, 0, 0], [1, 0, 0]])
    expect(out.vertices.slice(3).map((v) => v.c)).toEqual([[0, 0, 1], [0, 0, 1], [0, 0, 1]])
  })

  it('keeps every corner where it was', () => {
    const out = expandFaceColors(two)
    expect(ticksOf(out.vertices[0])).toEqual(ticksOf(two.vertices[0]))
    expect(ticksOf(out.vertices[3])).toEqual(ticksOf(two.vertices[0]))
  })

  it('keeps face order, so a tap still lands on the same face', () => {
    expect(expandFaceColors(two).faces).toEqual([[0, 1, 2], [3, 4, 5]])
  })

  it('leaves a shard alone when it has no face colours, or the wrong number', () => {
    const plain = { ...two, facecolors: undefined }
    expect(expandFaceColors(plain)).toBe(plain)
    const wrong = { ...two, facecolors: [[1, 0, 0]] as Array<[number, number, number]> }
    expect(expandFaceColors(wrong)).toBe(wrong)
  })

  it('drops the face colours it consumed, so nothing expands twice', () => {
    expect(expandFaceColors(two).facecolors).toBeUndefined()
  })
})

describe('a shard from before the palette', () => {
  // The case that matters most: every shard ONOSENDAI wrote before DECK-0003
  // is a v1 payload with literal colours, and there are a lot more than three.
  const OLD = {
    v: 1, type: 'shard', name: 'Crucifix', unit: 0, extent: 15, mode: 'solid',
    vertices: [[0, 0, 0], [-1, 0, 0], [0, 7, 0]],
    ticks: [[60, 0, 60], [60, 0, 60], [60, 0, 60]],
    colors: [[0.9686274509803922, 0.5764705882352941, 0.10196078431372549], [1, 0.8352941176470589, 0], [1, 1, 1]],
    faces: [[1, 0, 2]],
  }

  it('reads, and keeps its colours exactly as written', () => {
    // Snapping on read would change objects nobody asked to change.
    const back = fromPayload(OLD, 'x')
    expect(back).not.toBeNull()
    expect(back!.vertices[0].c).toEqual(OLD.colors[0])
    expect(back!.vertices[2].c).toEqual([1, 1, 1])
  })

  it('snaps to the palette when it is published, which is when it becomes v2', () => {
    const back = fromPayload(OLD, 'x')!
    const out = toPayload(back)
    expect(out.v).toBe(2)
    for (const c of out.colors) expect(Number.isInteger(c)).toBe(true)
    // White is in the palette exactly, so that corner does not move at all.
    expect(BUILT_IN[out.colors[2] as number]).toEqual([255, 255, 255])
    // The orange is not, and lands somewhere near rather than anywhere.
    const orange = BUILT_IN[out.colors[0] as number].map((n) => n / 255)
    expect(Math.abs(orange[0] - 0.968)).toBeLessThan(0.12)
    expect(Math.abs(orange[1] - 0.576)).toBeLessThan(0.12)
  })

  it('refuses a v1 payload whose colours are not triples', () => {
    expect(fromPayload({ ...OLD, colors: [7, 7, 7] }, 'x')).toBeNull()
  })
})
