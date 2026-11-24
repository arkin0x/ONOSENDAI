/**
 * terrainBody.test.ts - the builder's body (lib/terrain/body.ts) and the
 * block cursor's ray (lib/terrain/raycast.ts): it falls to the floor and
 * stands on it, jumps a little over one block, steps up one block with a
 * jump and is stopped by two, walks about 4.5 blocks a second, floats where
 * nothing is surveyed, and is stopped by a shard's wall.
 */

import { describe, expect, it } from 'vitest'
import { BODY_HEIGHT, JUMP_HEIGHT, WALK_SPEED, RUN_SPEED, liftFree, newBody, overlaps, stepBody, type BodyWorld } from '../terrain/body'
import { raycast } from '../terrain/raycast'
import { terrainAxes } from '../terrain/world'
import { viewAxes } from '../space'
import { Quaternion, Vector3 } from 'three'

/** A floor of blocks at j = 0, and whatever else is listed. */
function world(extra: Array<[number, number, number]> = [], opts: { gravity?: boolean; wall?: BodyWorld['wall'] } = {}): BodyWorld {
  const set = new Set(extra.map((c) => c.join(',')))
  return {
    solid: (i, j, k) => j <= 0 || set.has(`${i},${j},${k}`),
    gravity: () => opts.gravity ?? true,
    wall: opts.wall,
  }
}
const idle = { forward: 0, right: 0, yaw: 0, jump: false, lift: 0 }
const run = (b: ReturnType<typeof newBody>, w: BodyWorld, input: typeof idle, seconds: number): void => {
  for (let t = 0; t < seconds; t += 1 / 60) stepBody(b, input, w, 1 / 60)
}

describe('the body', () => {
  it('falls to the floor and stands on its top face', () => {
    const b = newBody(0, 5, 0)
    run(b, world(), idle, 2)
    expect(b.y).toBeCloseTo(0.5, 2)
    expect(b.onGround).toBe(true)
  })

  it('jumps a little over one block', () => {
    const w = world()
    const b = newBody(0, 0.5, 0)
    run(b, w, idle, 0.5)
    let top = b.y
    stepBody(b, { ...idle, jump: true }, w, 1 / 60)
    for (let i = 0; i < 90; i++) { stepBody(b, idle, w, 1 / 60); top = Math.max(top, b.y) }
    expect(top - 0.5).toBeGreaterThan(1.05)
    expect(top - 0.5).toBeLessThan(JUMP_HEIGHT + 0.1)
  })

  it('climbs a one-block step with a jump, and is stopped by a two-block wall', () => {
    const step = world([[0, 1, -2], [1, 1, -2], [-1, 1, -2], [0, 1, -3], [0, 1, -4]])
    const b = newBody(0, 0.5, 0)
    run(b, step, { ...idle, forward: 1, jump: true }, 0.5)
    run(b, step, { ...idle, forward: 0.4 }, 0.6)
    run(b, step, idle, 0.5)
    expect(b.y).toBeCloseTo(1.5, 1)
    expect(b.z).toBeLessThan(-1.5)
    const wall = world([[0, 1, -2], [0, 2, -2], [1, 1, -2], [1, 2, -2], [-1, 1, -2], [-1, 2, -2]])
    const c = newBody(0, 0.5, 0)
    run(c, wall, { ...idle, forward: 1, jump: true }, 1.5)
    expect(c.z).toBeGreaterThan(-1.5)
    expect(overlaps(wall, c.x, c.y, c.z)).toBe(false)
  })

  it('walks about 4.5 blocks a second, and faster once held', () => {
    const w = world()
    const b = newBody(0, 0.5, 0)
    run(b, w, idle, 0.2)
    run(b, w, { ...idle, forward: 1 }, 1)
    expect(-b.z).toBeGreaterThan(WALK_SPEED * 0.9)
    expect(-b.z).toBeLessThan(WALK_SPEED * 1.1)
    const z1 = b.z
    run(b, w, { ...idle, forward: 1 }, 1)
    expect(z1 - b.z).toBeGreaterThan(WALK_SPEED * 1.1)
    expect(z1 - b.z).toBeLessThan(RUN_SPEED * 1.05)
  })

  it('turns with the look: forward at a quarter turn goes along -x', () => {
    const b = newBody(0, 0.5, 0)
    run(b, world(), { ...idle, forward: 1, yaw: Math.PI / 2 }, 0.5)
    expect(b.x).toBeLessThan(-1.5)
    expect(Math.abs(b.z)).toBeLessThan(0.01)
  })

  it('floats where nothing is surveyed, and goes up and down there', () => {
    const empty: BodyWorld = { solid: () => false, gravity: () => false }
    const b = newBody(0, 10, 0)
    run(b, empty, idle, 1)
    expect(b.y).toBeCloseTo(10, 5)
    run(b, empty, { ...idle, lift: 1 }, 0.5)
    expect(b.y).toBeGreaterThan(11.5)
  })

  it('is stopped by a shard\'s wall between two cells', () => {
    const w = world([], { wall: (_i, _j, k, axis, dir) => axis === 2 && dir === -1 && k === -2 })
    const b = newBody(0, 0.5, 0)
    run(b, w, { ...idle, forward: 1 }, 1.5)
    expect(Math.round(b.z)).toBe(-2)
  })

  it('stands and jumps on the top layer of a surveyed chunk under a chunk that is not', () => {
    // Surveyed below j = 0.5 only: the feet at 0.5 round into the cell above, which is not.
    const w: BodyWorld = { solid: (_i, j) => j <= 0, gravity: (_i, j) => j <= 0 }
    const b = newBody(0, 0.5, 0)
    run(b, w, idle, 0.3)
    expect(b.onGround).toBe(true)
    let top = b.y
    stepBody(b, { ...idle, jump: true }, w, 1 / 60)
    for (let i = 0; i < 60; i++) { stepBody(b, idle, w, 1 / 60); top = Math.max(top, b.y) }
    expect(top).toBeGreaterThan(1.5)
  })

  it('jumps as high on a slow phone as on a fast one', () => {
    const w = world()
    const peak = (fps: number): number => {
      const b = newBody(0, 0.5, 0)
      run(b, w, idle, 0.3)
      let top = b.y
      stepBody(b, { ...idle, jump: true }, w, 1 / fps)
      for (let i = 0; i < fps; i++) { stepBody(b, idle, w, 1 / fps); top = Math.max(top, b.y) }
      return top - 0.5
    }
    expect(Math.abs(peak(20) - peak(120))).toBeLessThan(0.05)
    expect(peak(20)).toBeGreaterThan(1.1)
  })

  it('is lifted out of ground that filled the space round it', () => {
    const w = world([[0, 1, 0], [0, 2, 0], [0, 3, 0]])
    const b = newBody(0, 1.5, 0)
    expect(overlaps(w, b.x, b.y, b.z)).toBe(true)
    expect(liftFree(b, w)).toBe(true)
    expect(b.y).toBeCloseTo(3.5, 5)
    expect(overlaps(w, b.x, b.y, b.z)).toBe(false)
    expect(BODY_HEIGHT).toBeLessThan(2)
  })
})

describe('the block cursor\'s ray', () => {
  const solid = (i: number, j: number, k: number): boolean => j <= 0 || (i === 3 && j === 1 && k === 0)
  it('finds the first block and the face it came in through', () => {
    const hit = raycast([0, 1.4, 0], [1, 0, 0], 5, solid)
    expect(hit?.cell).toEqual([3, 1, 0])
    expect(hit?.normal).toEqual([-1, 0, 0])
    const down = raycast([0, 1.4, 0], [0, -1, 0], 5, solid)
    expect(down?.cell).toEqual([0, 0, 0])
    expect(down?.normal).toEqual([0, 1, 0])
  })
  it('reaches no further than it is told', () => {
    expect(raycast([0, 1.4, 0], [1, 0, 0], 2, solid)).toBeNull()
    expect(raycast([0, 1.4, 0], [0, 1, 0], 5, solid)).toBeNull()
  })
})

describe('which way is up in TERRAIN (ruled 2026-11-24: cyberspace +Y, the ground\'s up)', () => {
  const turn = (axis: Vector3, angle: number): Quaternion => new Quaternion().setFromAxisAngle(axis, angle)
  const Y = new Vector3(0, 1, 0), X = new Vector3(1, 0, 0), Z = new Vector3(0, 0, 1)

  it('a view turned only left or right is kept as it is', () => {
    for (let k = 0; k < 4; k++) {
      const v = viewAxes(turn(Y, (k * Math.PI) / 2))
      expect(v.up).toEqual({ axis: 'y', dir: 1 })
      expect(terrainAxes(v)).toEqual(v)
    }
  })

  it('a view turned so up is not +Y becomes upright, keeping a level heading, and is a real view', () => {
    const upright = [0, 1, 2, 3].map((k) => JSON.stringify(viewAxes(turn(Y, (k * Math.PI) / 2))))
    for (const q of [turn(Z, Math.PI / 2), turn(Z, -Math.PI / 2), turn(X, Math.PI / 2), turn(X, -Math.PI / 2), turn(Z, Math.PI), turn(X, Math.PI)]) {
      const v = viewAxes(q)
      const t = terrainAxes(v)
      expect(t.up).toEqual({ axis: 'y', dir: 1 })
      // One of the four upright views, so nothing is drawn mirrored.
      expect(upright).toContain(JSON.stringify(t))
      // The heading kept: the view's right where it was level, else its out.
      if (v.right.axis !== 'y') expect(t.right).toEqual(v.right)
      else expect(t.out).toEqual(v.out)
    }
  })
})
