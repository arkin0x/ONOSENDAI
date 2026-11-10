/**
 * walkBounce.test.ts - BOUNCE, EXPERIMENTAL (lib/walkBounce.ts): how the
 * provisional `bounce` field is read (a whole number 1 to 24, or "reflect"
 * exactly; anything else none), carried by sno-core as a field it does not
 * know, how high a landing launches, and whose bounce a face has: the
 * payload that owns it, never its parent's.
 */
import { describe, expect, it } from 'vitest'
import { fromPayload, newShard, toPayload, type ShardModel } from 'sno-core/shards'
import type { Placed } from 'sno-core/parts'
import { BOUNCE_MAX, bounceOf, launchHeight, readBounce } from '../walkBounce'
import { firstHit, wallMesh, withConstrain, type Constrain } from '../walkConstrain'

/** A square plate two units across in the model's XZ plane at y = -3: a floor under the origin. */
function plate(bounce?: unknown, c: Constrain = 'all'): ShardModel {
  const s: ShardModel = {
    ...newShard('Plate'),
    mode: 'solid',
    vertices: [
      { p: [-1, -3, -1], c: [1, 1, 1] },
      { p: [1, -3, -1], c: [1, 1, 1] },
      { p: [1, -3, 1], c: [1, 1, 1] },
      { p: [-1, -3, 1], c: [1, 1, 1] },
    ],
    faces: [[0, 1, 2], [0, 2, 3]],
    ...(bounce !== undefined ? { extra: { bounce } } : {}),
  }
  return withConstrain(s, c)
}

describe('the field', () => {
  it('reads a whole number from 1 to 24, or "reflect" exactly; anything else is no bounce', () => {
    expect(readBounce(1)).toBe(1)
    expect(readBounce(24)).toBe(24)
    expect(readBounce(8)).toBe(8)
    expect(readBounce('reflect')).toBe('reflect')
    for (const v of [undefined, null, 0, 25, -3, 2.5, NaN, Infinity, '8', 'Reflect', 'reflect ', 'bounce', true, [], {}]) expect(readBounce(v)).toBe(0)
  })

  it('rides through sno-core as a field it does not know, both ways', () => {
    for (const b of [7, 'reflect']) {
      const p = { ...toPayload(newShard('Pad')), bounce: b }
      const m = fromPayload(p, 'x')!
      expect(bounceOf(m)).toBe(b)
      expect((toPayload(m) as { bounce?: unknown }).bounce).toBe(b)
    }
    expect(bounceOf(newShard('Plain'))).toBe(0)
  })
})

describe('the launch', () => {
  it('a fixed bounce is its own height, whatever the fall', () => {
    expect(launchHeight(8, 2, false, 3)).toBe(8)
    expect(launchHeight(8, 40, false, 3)).toBe(8)
    expect(launchHeight(0, 40, false, 3)).toBe(0)
  })

  it('reflect is the height fallen from, at most 24, and nothing under 1', () => {
    expect(launchHeight('reflect', 5, false, 3)).toBe(5)
    expect(launchHeight('reflect', 4.9999999, false, 3)).toBe(5)
    expect(launchHeight('reflect', 40, false, 3)).toBe(BOUNCE_MAX)
    expect(launchHeight('reflect', 0.2, false, 3)).toBe(0)
  })

  it('a jump on landing adds its height, still at most 24', () => {
    expect(launchHeight(8, 0, true, 3)).toBe(11)
    expect(launchHeight('reflect', 5, true, 3)).toBe(8)
    expect(launchHeight(23, 0, true, 3)).toBe(BOUNCE_MAX)
    expect(launchHeight('reflect', 40, true, 3)).toBe(BOUNCE_MAX)
  })
})

describe('whose bounce a face has: the payload that owns it', () => {
  const part = (model: ShardModel, at: [number, number, number] = [0, 0, 0]): Placed => ({
    part: { ref: 0, at: [at[0] * 120, at[1] * 120, at[2] * 120], turn: [0, 0, 0], step: 0 },
    ref: ['a', `33331:${'a'.repeat(64)}:w`],
    model,
    children: [],
  })
  const host = (bounce?: unknown): ShardModel => withConstrain({ ...newShard('Rig'), mode: 'solid', vertices: [], faces: [], refs: [['a', `33331:${'a'.repeat(64)}:w`]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }], ...(bounce !== undefined ? { extra: { bounce } } : {}) }, 'off')
  const down = (m: ReturnType<typeof wallMesh>) => {
    const who = { bounce: 0 as number | 'reflect' }
    const t = firstHit(m, [0, 0, 0], 1, -1, 10, 1e-6, undefined, who)
    return { t, bounce: who.bounce }
  }

  it("a shard's own face bounces by the shard's field", () => {
    expect(down(wallMesh(plate(6), []))).toEqual({ t: 3, bounce: 6 })
    expect(down(wallMesh(plate('reflect'), []))).toEqual({ t: 3, bounce: 'reflect' })
    expect(down(wallMesh(plate(), []))).toEqual({ t: 3, bounce: 0 })
  })

  it("a placed object's face bounces by its own field, never its parent's", () => {
    expect(down(wallMesh(host(), [part(plate(9))]))).toEqual({ t: 3, bounce: 9 })
    expect(down(wallMesh(host(12), [part(plate())]))).toEqual({ t: 3, bounce: 0 })
  })

  it('the nearest face decides: a plain plate over a bouncy one shields it', () => {
    const m = wallMesh(host(), [part(plate(9)), part(plate(), [0, 1, 0])])
    expect(down(m)).toEqual({ t: 2, bounce: 0 })
  })

  it('a face that does not collide is not there to bounce on', () => {
    expect(down(wallMesh(plate(6, 'off'), []))).toEqual({ t: null, bounce: 0 })
  })
})
