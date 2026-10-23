/**
 * walkConstrain.test.ts - a shard's WALK setting (DECK-0003 §1.12): how it
 * is read (off unless exactly `all` or `opaque`), written (off is no field),
 * carried by sno-core 0.1.18 as a field it does not know, which faces it
 * makes walls, and the straight-ray test against them.
 */
import { describe, expect, it } from 'vitest'
import { PAYLOAD_FIELDS, fromPayload, newShard, normalizeStored, toPayload, type ShardModel } from 'sno-core/shards'
import type { Placed } from 'sno-core/parts'
import { blocks, constrainOf, firstHit, readConstrain, seeThrough, wallMesh, withConstrain, type Constrain } from '../walkConstrain'

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

  it('writes off as no field at all, and keeps the other carried fields', () => {
    const base: ShardModel = { ...newShard('W'), extra: { future: 7 } }
    const on = withConstrain(base, 'opaque')
    expect(on.extra).toEqual({ future: 7, constrain: 'opaque' })
    const off = withConstrain(on, 'off')
    expect(off.extra).toEqual({ future: 7 })
    expect(withConstrain({ ...newShard('W') }, 'all').extra).toEqual({ constrain: 'all' })
    expect(withConstrain(withConstrain({ ...newShard('W') }, 'all'), 'off')).not.toHaveProperty('extra')
  })

  it('returns the same object when nothing changes, and cleans a malformed value', () => {
    const s = wall({}, 'all')
    expect(withConstrain(s, 'all')).toBe(s)
    const bare = { ...newShard('W') }
    expect(withConstrain(bare, 'off')).toBe(bare)
    const odd: ShardModel = { ...newShard('W'), extra: { constrain: 'ALL' } }
    expect(constrainOf(odd)).toBe('off')
    expect(withConstrain(odd, 'off')).not.toHaveProperty('extra')
  })

  it('rides through sno-core as a field it does not know: payload, read back, stored', () => {
    const s = wall({}, 'opaque')
    const wire = JSON.parse(JSON.stringify(toPayload(s)))
    expect(wire.constrain).toBe('opaque')
    const back = fromPayload(wire, 'x')!
    expect(constrainOf(back)).toBe('opaque')
    expect(constrainOf(normalizeStored(JSON.parse(JSON.stringify(back))))).toBe('opaque')
    // Off writes nothing: an object without the setting is exactly as before.
    expect(toPayload(withConstrain(s, 'off'))).not.toHaveProperty('constrain')
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
