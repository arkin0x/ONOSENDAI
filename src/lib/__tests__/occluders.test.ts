/**
 * occluders.test.ts - which shards stand between the camera and the build
 * cursor (arkinox, 2026-11-08). Real three meshes and three's own ray test, no
 * canvas: a wall in front dims, a structure beside or behind the cursor stays
 * solid, a cursor inside a room dims the room's walls between, and the test is
 * the faces, not their bounds.
 */

import { describe, expect, it } from 'vitest'
import { BoxGeometry, BufferGeometry, DoubleSide, Float32BufferAttribute, FrontSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial, Raycaster, Vector3, type Intersection } from 'three'
import { CORNER_INSET, cellPoints, fadeToward, nineVectors, pickOccluders, pickWithin, sameSet, settleDimmed, type OccluderTarget } from '../occluders'

/** A solid box, centred at `at`, `size` across, as a shard's group holds its faces. */
function box(key: string, at: [number, number, number], size: [number, number, number]): OccluderTarget {
  const g = new Group()
  const m = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ side: DoubleSide }))
  g.add(m)
  g.position.set(...at)
  g.updateMatrixWorld(true)
  return { key, object: g }
}

/** A hollow room: the six faces of a box, drawn from inside and out (DoubleSide), as a shard's walls are. */
function room(key: string, at: [number, number, number], side: number): OccluderTarget {
  return box(key, at, [side, side, side])
}

/** Two slabs with a gap between them: their bounds cross the gap, their faces do not. */
function gate(key: string): OccluderTarget {
  const g = new Group()
  for (const x of [-2, 2]) {
    const m = new Mesh(new BoxGeometry(1, 4, 1), new MeshBasicMaterial({ side: DoubleSide }))
    m.position.set(x, 0, 0)
    g.add(m)
  }
  g.position.set(0, 0, 5)
  g.updateMatrixWorld(true)
  return { key, object: g }
}

const eye = new Vector3(0, 0, 10)
const cursorAt = (x: number, y: number, z: number): Vector3[] => cellPoints(new Vector3(x, y, z), nineVectors())

describe('pickOccluders', () => {
  it('a wall between the camera and the cursor is an occluder', () => {
    const wall = box('wall', [0, 0, 5], [6, 6, 0.5])
    expect([...pickOccluders([wall], eye, cursorAt(0, 0, 0))]).toEqual(['wall'])
  })

  it('a structure beside the line of sight stays solid', () => {
    const beside = box('beside', [4, 0, 2], [2, 2, 2])
    expect(pickOccluders([beside], eye, cursorAt(0, 0, 0)).size).toBe(0)
  })

  it('a structure behind the cursor stays solid', () => {
    const behind = box('behind', [0, 0, -4], [6, 6, 2])
    expect(pickOccluders([behind], eye, cursorAt(0, 0, 0)).size).toBe(0)
  })

  it('a floor the cursor sits on stays solid', () => {
    // The floor's top is the cell's bottom face: the corner rays stop short of it.
    const floor = box('floor', [0, -1, 0], [20, 1, 20])
    expect(pickOccluders([floor], new Vector3(0, 6, 8), cursorAt(0, 0, 0)).size).toBe(0)
  })

  it('a cursor inside a room dims the room, whose wall stands between', () => {
    const r = room('room', [0, 0, 0], 6)
    expect([...pickOccluders([r], eye, cursorAt(0, 0, 0))]).toEqual(['room'])
  })

  it('a camera inside the same room as the cursor sees it: nothing dims', () => {
    const r = room('room', [0, 0, 0], 20)
    expect(pickOccluders([r], new Vector3(0, 0, 6), cursorAt(0, 0, 0)).size).toBe(0)
  })

  it('tests the faces, not the bounds: a gap the bounds span lets the cursor be seen', () => {
    const g = gate('gate')
    expect(pickOccluders([g], eye, cursorAt(0, 0, 0)).size).toBe(0)
    // Aimed through a slab instead (the ray to x = 4 crosses z = 5 at x = 2), it blocks.
    expect([...pickOccluders([g], eye, cursorAt(4, 0, 0))]).toEqual(['gate'])
  })

  it('a post hiding only one corner of the cell still dims, so the whole cell stays in sight', () => {
    // A thin post in front of the (+x, +y) corner, clear of the centre's ray.
    const h = 0.5 - CORNER_INSET
    const post = box('post', [h * 0.5, h * 0.5, 5], [0.08, 0.08, 0.08])
    const centreOnly = [new Vector3(0, 0, 0)]
    expect(pickOccluders([post], eye, centreOnly).size).toBe(0)
    expect([...pickOccluders([post], eye, cursorAt(0, 0, 0))]).toEqual(['post'])
  })

  it('picks only the blockers out of many, and never a skipped key (the shard EDIT is moving)', () => {
    const shards = [box('wall', [0, 0, 5], [4, 4, 0.5]), box('beside', [5, 0, 5], [1, 1, 1]), box('behind', [0, 0, -3], [3, 3, 1]), box('near', [0, 0, 8], [1, 1, 1])]
    expect([...pickOccluders(shards, eye, cursorAt(0, 0, 0))].sort()).toEqual(['near', 'wall'])
    expect([...pickOccluders(shards, eye, cursorAt(0, 0, 0), new Set(['wall']))]).toEqual(['near'])
  })

  it('points never block: only faces do', () => {
    const g = new Group()
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute([0, 0, 5, 0.1, 0, 5], 3))
    g.add(new Points(geo, new PointsMaterial()))
    g.updateMatrixWorld(true)
    expect(pickOccluders([{ key: 'dots', object: g }], eye, cursorAt(0, 0, 0)).size).toBe(0)
  })

  it('an invisible part is not tested', () => {
    const wall = box('wall', [0, 0, 5], [6, 6, 0.5])
    wall.object.visible = false
    expect(pickOccluders([wall], eye, cursorAt(0, 0, 0)).size).toBe(0)
  })

  it('reads the shard\'s own scale and place, as it is drawn', () => {
    // A unit cube scaled up to a wall, as a coarse-unit shard is drawn at 2^(unit - zoom).
    const t = box('scaled', [0, 0, 5], [1, 1, 0.1])
    t.object.scale.setScalar(8)
    t.object.updateMatrixWorld(true)
    expect([...pickOccluders([t], eye, cursorAt(0, 0, 0))]).toEqual(['scaled'])
  })
})

describe('cellPoints', () => {
  it('the centre, then the eight corners drawn in by the inset', () => {
    const p = cellPoints(new Vector3(1, 2, 3), nineVectors())
    expect(p[0].toArray()).toEqual([1, 2, 3])
    const h = 0.5 - CORNER_INSET
    const corners = p.slice(1).map((v) => v.toArray().map((x, i) => Math.round((x - [1, 2, 3][i]) / h)))
    expect(new Set(corners.map((c) => c.join(','))).size).toBe(8)
    for (const c of corners) for (const x of c) expect(Math.abs(x)).toBe(1)
  })
})

describe('settleDimmed', () => {
  it('dims at once, and lets go only after the hold', () => {
    const seen = new Map<string, number>()
    expect([...settleDimmed(seen, new Set(['a']), 0, 120)]).toEqual(['a'])
    // Stopped blocking: still held within the hold.
    expect([...settleDimmed(seen, new Set(), 100, 120)]).toEqual(['a'])
    // Past it: back.
    expect(settleDimmed(seen, new Set(), 121, 120).size).toBe(0)
    expect(seen.size).toBe(0)
  })

  it('blocking again within the hold restarts it', () => {
    const seen = new Map<string, number>()
    settleDimmed(seen, new Set(['a']), 0, 120)
    settleDimmed(seen, new Set(['a']), 100, 120)
    expect([...settleDimmed(seen, new Set(), 200, 120)]).toEqual(['a'])
  })
})

describe('fadeToward and sameSet', () => {
  it('a whole swing in the fade time, landing exactly', () => {
    let l = 1
    l = fadeToward(l, 0.2, 75, 150, 0.8)
    expect(l).toBeCloseTo(0.6)
    l = fadeToward(l, 0.2, 100, 150, 0.8)
    expect(l).toBe(0.2)
    expect(fadeToward(0.2, 1, 1000, 150, 0.8)).toBe(1)
  })

  it('sets by members', () => {
    expect(sameSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
    expect(sameSet(new Set(['a']), new Set(['b']))).toBe(false)
  })
})

describe('the picker\'s own ray test (review of #618)', () => {
  /** Whether three's Mesh.raycast finds a face on the segment from `a` to `b`, short of `b` by `margin`. */
  function threeSays(mesh: Mesh, a: Vector3, b: Vector3, margin: number): boolean {
    const d = b.clone().sub(a)
    const len = d.length()
    const rc = new Raycaster(a, d.divideScalar(len), 0, len - margin)
    const hits: Intersection[] = []
    mesh.raycast(rc, hits)
    return hits.length > 0
  }

  it('agrees with three\'s Mesh.raycast, ray for ray, on turned, scaled, subdivided shapes', () => {
    let seed = 7
    const r = (): number => (seed = (seed * 16807) % 2147483647) / 2147483647
    const shapes = [new IcosahedronGeometry(2, 3), new BoxGeometry(3, 1, 2, 6, 3, 4), new PlaneGeometry(6, 6, 12, 12)]
    let agreed = 0, hits = 0
    for (let n = 0; n < 300; n++) {
      const mesh = new Mesh(shapes[n % 3], new MeshBasicMaterial({ side: n % 4 === 0 ? FrontSide : DoubleSide }))
      mesh.position.set(r() * 4 - 2, r() * 4 - 2, r() * 4 - 2)
      mesh.rotation.set(r() * 6, r() * 6, r() * 6)
      mesh.scale.set(0.5 + r(), 0.5 + r(), 0.5 + r())
      const g = new Group()
      g.add(mesh)
      g.updateMatrixWorld(true)
      const eye = new Vector3(r() * 20 - 10, r() * 20 - 10, 12)
      const pts = cellPoints(new Vector3(r() * 4 - 2, r() * 4 - 2, r() * 4 - 2), nineVectors())
      const expected = pts.some((p) => threeSays(mesh, eye, p, 0.02))
      const got = pickOccluders([{ key: 'm', object: g }], eye, pts).size === 1
      if (got === expected) agreed++
      if (expected) hits++
    }
    expect(agreed).toBe(300)
    // The case mix really did test both answers.
    expect(hits).toBeGreaterThan(30)
    expect(hits).toBeLessThan(270)
  })

  it('a FrontSide face is not hit from behind; a DoubleSide face is', () => {
    // A plane facing +z (toward the camera) and one turned to face away.
    const make = (side: typeof FrontSide | typeof DoubleSide, away: boolean): OccluderTarget => {
      const m = new Mesh(new PlaneGeometry(6, 6), new MeshBasicMaterial({ side }))
      if (away) m.rotation.y = Math.PI
      const g = new Group(); g.add(m); g.position.set(0, 0, 5); g.updateMatrixWorld(true)
      return { key: `${side}-${away}`, object: g }
    }
    const pts = cursorAt(0, 0, 0)
    expect(pickOccluders([make(FrontSide, false)], eye, pts).size).toBe(1)
    expect(pickOccluders([make(FrontSide, true)], eye, pts).size).toBe(0)
    expect(pickOccluders([make(DoubleSide, true)], eye, pts).size).toBe(1)
  })

  it('tests the positions a shard rests at, not its live buffer mid-birth (userData.rest)', () => {
    // A wall whose live buffer is scattered off the line of sight, as a birth's scramble leaves it, with its final positions handed over.
    const wall = new PlaneGeometry(6, 6)
    const rest = (wall.attributes.position.array as Float32Array).slice()
    const live = wall.attributes.position.array as Float32Array
    for (let i = 0; i < live.length; i += 3) live[i] += 40
    wall.userData.rest = rest
    const g = new Group(); g.add(new Mesh(wall, new MeshBasicMaterial({ side: DoubleSide }))); g.position.set(0, 0, 5); g.updateMatrixWorld(true)
    // Its sphere measured at rest too, as ShardMesh does (settleBounds).
    const at = new BufferGeometry(); at.setAttribute('position', new Float32BufferAttribute(rest, 3)); at.computeBoundingSphere()
    wall.boundingSphere = at.boundingSphere
    expect([...pickOccluders([{ key: 'w', object: g }], eye, cursorAt(0, 0, 0))]).toEqual(['w'])
  })

  it('within a budget: asks at least one shard, keeps the rest as they were, and starts the next pick where it stopped', () => {
    const shards = ['a', 'b', 'c', 'd'].map((k, i) => box(k, [0, 0, 5 + i * 0.6], i === 1 ? [0.2, 0.2, 0.2] : [4, 4, 0.2]))
    // A clock that has always just run out.
    let t = 0
    const now = (): number => (t += 10)
    const first = pickWithin(shards, eye, cursorAt(0, 0, 0), { budgetMs: 1, start: 0, carry: new Set(['c']), now })
    expect(first.done).toBe(false)
    expect(first.next).toBe(1)
    // 'a' was asked and blocks; 'c' was not reached and was blocking before, so it stays.
    expect([...first.blocking].sort()).toEqual(['a', 'c'])
    const all = pickWithin(shards, eye, cursorAt(0, 0, 0), { start: first.next })
    expect(all.done).toBe(true)
    expect([...all.blocking].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('benchmark: several 5,000-face shards whose bounds hold the line of sight cost well under a millisecond a recompute', () => {
    const mat = new MeshBasicMaterial({ side: DoubleSide })
    const shard = (key: string, geo: BufferGeometry, at: [number, number, number]): OccluderTarget => {
      const g = new Group(); g.add(new Mesh(geo, mat)); g.position.set(...at); g.updateMatrixWorld(true)
      return { key, object: g }
    }
    const faces = (geo: BufferGeometry): number => (geo.index ? geo.index.count : geo.attributes.position.count) / 3
    const camera = new Vector3(3, 4, 9)
    const shards = [
      // A room round both the camera and the cursor: its walls all about, none between.
      shard('room', new BoxGeometry(40, 20, 40, 20, 20, 20), [0, 5, 0]),
      // A floor under the cursor, its top the cell's bottom face.
      shard('floor', new PlaneGeometry(40, 40, 50, 50).rotateX(-Math.PI / 2), [0, -0.5, 0]),
      // Two dense walls beside the line of sight, their spheres over it.
      shard('left', new IcosahedronGeometry(3, 15), [-4.5, 2, 4]),
      shard('right', new IcosahedronGeometry(3, 15), [7.5, 2, 4]),
      // One dense wall right across it.
      shard('across', new PlaneGeometry(6, 6, 50, 50), [1.5, 2, 4.5]),
    ]
    for (const t of shards) expect(faces((t.object.children[0] as Mesh).geometry)).toBeGreaterThanOrEqual(4800)
    const pts = cursorAt(0, 0, 0)
    // The first pick builds each hierarchy once.
    expect([...pickOccluders(shards, camera, pts)]).toEqual(['across'])
    const runs: number[] = []
    for (let i = 0; i < 60; i++) {
      camera.x = 3 + Math.sin(i) * 0.5
      const t0 = performance.now()
      pickOccluders(shards, camera, pts)
      runs.push(performance.now() - t0)
    }
    runs.sort((a, b) => a - b)
    const median = runs[runs.length >> 1]
    console.log(`[occluders bench] 5 shards of ~5,000 faces round the line of sight: median ${median.toFixed(3)} ms, worst ${runs[runs.length - 1].toFixed(3)} ms per recompute`)
    expect(median).toBeLessThan(1)
  })
})
