/**
 * walkConstrain.test.ts - a shard's WALK setting (DECK-0003 §1.12): how it
 * is read by a walker (off unless exactly `all` or `opaque`), read by the
 * workshop (OPAQUE unless one of the three words), written (off is `"off"`),
 * carried by sno-core as a field it does not know, which faces it
 * makes walls, and the straight-ray test against them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PAYLOAD_FIELDS, fromPayload, newShard, normalizeStored, toPayload, type ShardModel } from 'sno-core/shards'
import type { Placed } from 'sno-core/parts'
import { CONSTRAIN_DEFAULT, authoredConstrain, authoredConstrainOf, blocks, constrainOf, enclosed, firstHit, readConstrain, seeThrough, solidsOf, wallMesh, wallsOf, withAuthoredConstrain, withConstrain, type Constrain } from '../walkConstrain'
import { avatarTemplate } from '../avatar'
import { objectTemplate } from '../hidden'
import { decryptForRegion } from '../shardCrypto'

/** A square wall two units across in the model's YZ plane at x = 3: two triangles. */
function wall(extra: Partial<ShardModel> = {}, c: Constrain = 'all'): ShardModel {
  const s: ShardModel = {
    ...newShard('Wall'),
    mode: 'solid',
    vertices: [
      { p: [3, -1, -1], c: [1, 1, 1] },
      { p: [3, 1, -1], c: [1, 1, 1] },
      { p: [3, 1, 1], c: [1, 1, 1] },
      { p: [3, -1, 1], c: [1, 1, 1] },
    ],
    faces: [[0, 1, 2], [0, 2, 3]],
    ...extra,
  }
  return withConstrain(s, c)
}

describe('the field', () => {
  it('reads all and opaque exactly, and everything else as off', () => {
    expect(readConstrain('all')).toBe('all')
    expect(readConstrain('opaque')).toBe('opaque')
    for (const v of [undefined, null, 'off', 'ALL', 'Opaque', ' all', 1, true, [], {}, 'solid']) expect(readConstrain(v)).toBe('off')
  })

  it('is a field sno-core does not know yet: the day it learns it, this fails and the writer here must follow', () => {
    // A sno-core that knows `constrain` lifts it out of `extra` (liftKnown) and
    // stops writing it from there, so withConstrain would silently write nothing.
    expect(PAYLOAD_FIELDS as readonly string[]).not.toContain('constrain')
    // The reader is ready either way: a top-level field is read first.
    expect(constrainOf({ ...newShard('W'), constrain: 'all' } as ShardModel)).toBe('all')
  })

  it('the workshop reads the three words exactly, and everything else, absent included, as the default OPAQUE', () => {
    expect(CONSTRAIN_DEFAULT).toBe('opaque')
    for (const v of ['all', 'opaque', 'off'] as const) expect(authoredConstrain(v)).toBe(v)
    for (const v of [undefined, null, 'OFF', 'ALL', 'Opaque', ' all', '', 'none', 1, true, false, [], {}]) expect(authoredConstrain(v)).toBe('opaque')
  })

  it('a new shard is OPAQUE', () => {
    expect(authoredConstrainOf(newShard('New'))).toBe('opaque')
    expect(toPayload(withAuthoredConstrain(newShard('New')))).toHaveProperty('constrain', 'opaque')
  })

  it('writes off as the word "off", and keeps the other carried fields', () => {
    const base: ShardModel = { ...newShard('W'), extra: { future: 7 } }
    const on = withConstrain(base, 'opaque')
    expect(on.extra).toEqual({ future: 7, constrain: 'opaque' })
    const off = withConstrain(on, 'off')
    expect(off.extra).toEqual({ future: 7, constrain: 'off' })
    expect(withConstrain({ ...newShard('W') }, 'all').extra).toEqual({ constrain: 'all' })
    expect(withConstrain(withConstrain({ ...newShard('W') }, 'all'), 'off').extra).toEqual({ constrain: 'off' })
  })

  it('returns the same object when nothing changes, and replaces a malformed value', () => {
    const s = wall({}, 'all')
    expect(withConstrain(s, 'all')).toBe(s)
    const off = withConstrain({ ...newShard('W') }, 'off')
    expect(withConstrain(off, 'off')).toBe(off)
    const odd: ShardModel = { ...newShard('W'), extra: { constrain: 'ALL' } }
    expect(constrainOf(odd)).toBe('off')
    expect(authoredConstrainOf(odd)).toBe('opaque')
    expect(withConstrain(odd, 'off').extra).toEqual({ constrain: 'off' })
  })

  it('publishes an unset or malformed shard as OPAQUE, and keeps every word its author chose', () => {
    const bare = { ...newShard('W') }
    expect(withAuthoredConstrain(bare).extra).toEqual({ constrain: 'opaque' })
    expect(withAuthoredConstrain({ ...newShard('W'), extra: { constrain: 'OFF', future: 7 } }).extra).toEqual({ future: 7, constrain: 'opaque' })
    for (const c of ['off', 'all', 'opaque'] as const) {
      const s = withConstrain({ ...newShard('W') }, c)
      expect(withAuthoredConstrain(s)).toBe(s)
    }
  })

  it('an explicit off is read as off by a walker, and survives a round trip as "off"', () => {
    const s = wall({}, 'off')
    expect(constrainOf(s)).toBe('off')
    expect(blocks(s)).toBe(false)
    const wire = JSON.parse(JSON.stringify(toPayload(withAuthoredConstrain(s))))
    expect(wire.constrain).toBe('off')
    const back = fromPayload(wire, 'x')!
    expect(authoredConstrainOf(back)).toBe('off')
    expect(constrainOf(back)).toBe('off')
    expect(authoredConstrainOf(normalizeStored(JSON.parse(JSON.stringify(back))))).toBe('off')
  })

  it('an avatar is untouched: its event carries no default, and a word it has rides as it is (DECK-0003 §3.3)', () => {
    const bare = newShard('Me')
    expect(bare).not.toHaveProperty('extra')
    expect(JSON.parse(avatarTemplate(bare, 1).content)).not.toHaveProperty('constrain')
    expect(JSON.parse(avatarTemplate(withConstrain(newShard('Me'), 'off'), 1).content)).toHaveProperty('constrain', 'off')
  })

  it('rides through sno-core as a field it does not know: payload, read back, stored', () => {
    const s = wall({}, 'opaque')
    const wire = JSON.parse(JSON.stringify(toPayload(s)))
    expect(wire.constrain).toBe('opaque')
    const back = fromPayload(wire, 'x')!
    expect(constrainOf(back)).toBe('opaque')
    expect(constrainOf(normalizeStored(JSON.parse(JSON.stringify(back))))).toBe('opaque')
    // An object without the setting reads as off to a walker, exactly as before.
    expect(constrainOf({ ...s, extra: undefined })).toBe('off')
  })
})

describe('which objects make walls', () => {
  it('all: every face, in any mode, at any opacity', () => {
    expect(blocks(wall({}, 'all'))).toBe(true)
    expect(blocks(wall({ opacity: 30 }, 'all'))).toBe(true)
    expect(blocks(wall({ mode: 'lines' }, 'all'))).toBe(true)
  })

  it('opaque: only solid and fully opaque', () => {
    expect(blocks(wall({}, 'opaque'))).toBe(true)
    expect(blocks(wall({ opacity: 99 }, 'opaque'))).toBe(false)
    expect(blocks(wall({ mode: 'lines' }, 'opaque'))).toBe(false)
    expect(blocks(wall({ mode: 'points' }, 'opaque'))).toBe(false)
    // A malformed opacity is read as opaque (§1.11), so it holds.
    expect(blocks(wall({ opacity: 250 as number }, 'opaque'))).toBe(true)
  })

  it('off: nothing', () => {
    expect(blocks(wall({}, 'off'))).toBe(false)
  })

  it('see-through is the data, not the reader', () => {
    expect(seeThrough({ mode: 'solid', opacity: undefined })).toBe(false)
    expect(seeThrough({ mode: 'solid', opacity: 10 })).toBe(true)
    expect(seeThrough({ mode: 'lines', opacity: undefined })).toBe(true)
  })
})

describe('the ray', () => {
  const mesh = wallMesh(wall(), [])

  it('meets the wall in the render frame, model units', () => {
    expect(mesh.own).toBe(2)
    // From the origin along +X: the wall is 3 away.
    expect(firstHit(mesh, [0, 0, 0], 0, 1, 10, 1e-6)).toBeCloseTo(3, 12)
    // The other way: nothing.
    expect(firstHit(mesh, [0, 0, 0], 0, -1, 10, 1e-6)).toBeNull()
    // Short of it: nothing within reach.
    expect(firstHit(mesh, [0, 0, 0], 0, 1, 2.9, 1e-6)).toBeNull()
    // A step that would land on it exactly is met.
    expect(firstHit(mesh, [0, 0, 0], 0, 1, 3, 1e-6)).toBeCloseTo(3, 12)
  })

  it('leaves no seam: a ray down the diagonal two triangles share hits', () => {
    // The shared edge runs from (-1,-1) to (1,1) in render Y/Z: model z -1 is render z 1.
    expect(firstHit(mesh, [0, 0.5, -0.5], 0, 1, 10, 1e-6)).toBeCloseTo(3, 12)
    // And the outer edge itself counts: no squeezing past along it.
    expect(firstHit(mesh, [0, 1, 0], 0, 1, 10, 1e-6)).toBeCloseTo(3, 12)
    // Just outside it does not.
    expect(firstHit(mesh, [0, 1.01, 0], 0, 1, 10, 1e-6)).toBeNull()
  })

  it('a step along the wall never crosses it, and the face you stand on lets you go', () => {
    // Moving in Y on the wall's own plane: parallel, never crossed.
    expect(firstHit(mesh, [3, 0, 0], 1, 1, 10, 1e-6)).toBeNull()
    // Standing on it, stepping off either way is free.
    expect(firstHit(mesh, [3, 0, 0], 0, 1, 10, 1e-6)).toBeNull()
    expect(firstHit(mesh, [3, 0, 0], 0, -1, 10, 1e-6)).toBeNull()
  })

  it('a region clip lets a ray through where the shard is not drawn', () => {
    const clip = { min: [-10, -10, -10] as [number, number, number], max: [2, 10, 10] as [number, number, number] }
    expect(firstHit(mesh, [0, 0, 0], 0, 1, 10, 1e-6, clip)).toBeNull()
  })
})

describe('a part far finer than its parent', () => {
  it('is still a wall: the edge-on test is relative to the triangle', () => {
    // A two-tick square at x = 3 ticks, placed in a parent 2^26 times coarser.
    const tiny = wallMesh({ ...newShard('Fine'), mode: 'solid', vertices: [], faces: [], unit: 26 }, [{
      part: { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 },
      ref: ['a', `33331:${'a'.repeat(64)}:fine`],
      model: withConstrain({ ...newShard('T'), unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], t: [3, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 0], t: [3, 2, 0], c: [1, 1, 1] }, { p: [0, 0, 0], t: [3, 2, 2], c: [1, 1, 1] }], faces: [[0, 1, 2]] }, 'all'),
      children: [],
    }])
    const s = 2 ** -26
    const hit = firstHit(tiny, [0, 1.5 / 120 * s, -0.5 / 120 * s], 0, 1, s, 1e-6 * s)
    expect(hit).not.toBeNull()
    expect(hit! / s).toBeCloseTo(3 / 120, 9)
  })
})

describe('placed objects keep their own setting (§1.10)', () => {
  const part = (model: ShardModel, at: [number, number, number] = [0, 0, 0]): Placed => ({
    part: { ref: 0, at: [at[0] * 120, at[1] * 120, at[2] * 120], turn: [0, 0, 0], step: 0 },
    ref: ['a', `33331:${'a'.repeat(64)}:w`],
    model,
    children: [],
  })
  const host = (c: Constrain): ShardModel => withConstrain({ ...newShard('Room'), mode: 'solid', vertices: [], faces: [], refs: [['a', `33331:${'a'.repeat(64)}:w`]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] }, c)

  it('a part set to ALL holds you though its parent is off', () => {
    const m = wallMesh(host('off'), [part(wall({}, 'all'))])
    expect(m.own).toBe(0)
    expect(firstHit(m, [0, 0, 0], 0, 1, 10, 1e-6)).toBeCloseTo(3, 12)
  })

  it('a part left off lets you through though its parent is ALL', () => {
    const m = wallMesh(host('all'), [part(wall({}, 'off'))])
    expect(firstHit(m, [0, 0, 0], 0, 1, 10, 1e-6)).toBeNull()
  })

  it('a solid room with see-through water placed in it: the water, set OPAQUE, lets you through', () => {
    const water = wall({ opacity: 40 }, 'opaque')
    const m = wallMesh(host('opaque'), [part(water)])
    expect(firstHit(m, [0, 0, 0], 0, 1, 10, 1e-6)).toBeNull()
  })

  it('a placed wall is moved by its placement, and a placeholder stops nothing', () => {
    const m = wallMesh(host('off'), [part(wall({}, 'all'), [2, 0, 0]), { ...part(wall()), model: null, missing: 'unreachable' }])
    expect(firstHit(m, [0, 0, 0], 0, 1, 10, 1e-6)).toBeCloseTo(5, 12)
  })
})

describe('a sealed object', () => {
  it('a shard hidden as its own sealed event goes out "opaque" when it never chose, and keeps "off"', async () => {
    const key = new Uint8Array(32).map((_, i) => i + 1)
    for (const [s, want] of [[wall({}, 'all'), 'all'], [{ ...wall(), extra: undefined }, 'opaque'], [wall({}, 'off'), 'off']] as const) {
      const ev = await objectTemplate(s, key, 'd1', 1)
      const sealed = ev.tags.find((t) => t[0] === 'encrypted')![2]
      const plain = await decryptForRegion(key, sealed)
      expect(JSON.parse(plain!)).toHaveProperty('constrain', want)
    }
  })
})

describe('what the controls show', () => {
  it('the workshop row lights the setting a shard publishes as: OPAQUE for one that never chose', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'workshop', 'Workshop.tsx'), 'utf8')
    const row = src.slice(src.indexOf('CONSTRAIN MOVEMENT IN WALK MODE'), src.indexOf('</div>', src.indexOf('CONSTRAIN MOVEMENT IN WALK MODE')))
    expect(row).toContain('authoredConstrainOf(shard) === c')
    // The walker's reading would light OFF for a shard that never chose.
    expect(row).not.toMatch(/\bconstrainOf\(shard\)/)
    expect(authoredConstrainOf(newShard('Unset'))).toBe('opaque')
  })
})

describe('closed solids, for the space above a walker (store/walkWalls.ts stepLimit, `stand`)', () => {
  type V = [number, number, number]
  /** A box from `lo` to `hi` in whole units, as twelve triangles wound any old way: winding is never read. */
  const box = (lo: V, hi: V, at = 0): { v: ShardModel['vertices']; f: Array<[number, number, number]> } => {
    const v: ShardModel['vertices'] = []
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) v.push({ p: [x, y, z], c: [1, 1, 1] })
    const quads = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
    // Half the quads wound the other way round: a face cannot say which side is inside.
    const f = quads.flatMap(([a, b, c, d], n) => (n % 2 ? [[at + a, at + c, at + b], [at + a, at + d, at + c]] : [[at + a, at + b, at + c], [at + a, at + c, at + d]]) as Array<[number, number, number]>)
    return { v, f }
  }
  const shard = (parts: Array<{ v: ShardModel['vertices']; f: Array<[number, number, number]> }>): ShardModel =>
    withConstrain({ ...newShard('S'), mode: 'solid', vertices: parts.flatMap((p) => p.v), faces: parts.flatMap((p) => p.f) }, 'all')

  it('a box is one closed solid; a plate, or a box with a face gone, is none', () => {
    const b = shard([box([-2, 0, -2], [2, 4, 2])])
    expect(solidsOf(wallsOf(b)).count).toBe(1)
    expect([...solidsOf(wallsOf(b)).of]).toEqual(new Array(12).fill(0))
    const open = { ...b, faces: b.faces.slice(2) }
    expect(solidsOf(wallsOf(open)).count).toBe(0)
    const plate = withConstrain({ ...newShard('P'), mode: 'solid', vertices: [[-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2]].map((p) => ({ p: p as V, c: [1, 1, 1] as V })), faces: [[0, 1, 2], [0, 2, 3]] }, 'all')
    expect(solidsOf(wallsOf(plate)).count).toBe(0)
  })

  it('two boxes, apart or touching along an edge, are closed; duplicate corners are matched by place', () => {
    const apart = shard([box([-2, 0, -2], [0, 2, 0]), box([4, 0, 4], [6, 2, 6], 8)])
    expect(solidsOf(wallsOf(apart)).count).toBe(2)
    // The second on the first's top edge at x = 0: four triangles on that edge, an even number.
    const touching = shard([box([-2, 0, -2], [0, 2, 0]), box([0, 2, -2], [2, 4, 0], 8)])
    expect(solidsOf(wallsOf(touching)).count).toBe(1)
    expect([...solidsOf(wallsOf(touching)).of].every((x) => x === 0)).toBe(true)
  })

  it('a point is enclosed inside a box, not above it or below it, nor anywhere in an open shell', () => {
    const b = shard([box([-2, 0, -2], [2, 4, 2])])
    const m = wallMesh(b, [])
    // Render Z is model -Z; the box is symmetric in Z.
    expect(enclosed(m, [0, 1e-6, 0])).toBe(true)
    expect(enclosed(m, [1.5, 3.9, -1.5])).toBe(true)
    expect(enclosed(m, [0, 4 + 1e-6, 0])).toBe(false)
    expect(enclosed(m, [0, -1e-6, 0])).toBe(false)
    expect(enclosed(m, [3, 1, 0])).toBe(false)
    const shell = wallMesh({ ...b, faces: b.faces.slice(2) }, [])
    expect(enclosed(shell, [0, 1, 0])).toBe(false)
  })

  it('a placed box encloses where it is placed', () => {
    const b = shard([box([-2, 0, -2], [2, 4, 2])])
    const holder = withConstrain({ ...newShard('H'), mode: 'solid', vertices: [], faces: [] }, 'off')
    const placed: Placed[] = [{ part: { ref: 0, at: [0, 1200, 0], turn: [0, 0, 0], step: 0 }, ref: ['a', `33331:${'e'.repeat(64)}:box`], model: b, children: [] }]
    const m = wallMesh(holder, placed)
    expect(enclosed(m, [0, 10 + 1e-6, 0])).toBe(true)
    expect(enclosed(m, [0, 1e-6, 0])).toBe(false)
  })
})
