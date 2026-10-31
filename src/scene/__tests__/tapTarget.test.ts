/**
 * tapTarget.test.ts: what can be tapped in the world. A shard too small to
 * see takes no taps; a small visible one gets a fingertip-sized target; a
 * large one's target is exactly what it draws (arkinox, 2026-09-30).
 */

import { describe, expect, it } from 'vitest'
import { MAX_EXTENT } from 'sno-core/shards'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from 'three'
import { MAX_SCREENS, MAX_VIEWPORT_PX, MIN_TARGET_PX, MIN_VISIBLE_PX, farCullDoublings, pxPerUnit, tapRaycast, targetSpan, yieldsTap, type TapSpec, type TapView } from '../TapTarget'
import { CAMERA_NEAR, FOV } from '../camera'

describe('pxPerUnit', () => {
  it('is the viewport height over the view height at that distance', () => {
    // fov 90: at distance 1 the view is 2 units tall.
    expect(pxPerUnit(90, 800, 1)).toBeCloseTo(400)
    expect(pxPerUnit(90, 800, 4)).toBeCloseTo(100)
  })
})

describe('targetSpan', () => {
  it('takes no taps under the visible floor: a speck zoomed out to 2^52', () => {
    expect(targetSpan([1e-9, 1e-9, 1e-9], 1000)).toBeNull()
    expect(targetSpan([0.003, 0.001, 0.001], 1000)).toBeNull()
  })

  it('a visible but small shard gets a fingertip-sized target', () => {
    const span = targetSpan([0.01, 0.005, 0.005], 1000)!
    for (const d of span) expect(d * 1000).toBeCloseTo(MIN_TARGET_PX)
  })

  it("a large shard's target is exactly what it draws, each axis on its own", () => {
    const span = targetSpan([2, 0.001, 1], 1000)!
    expect(span[0]).toBe(2)
    expect(span[2]).toBe(1)
    expect(span[1] * 1000).toBeCloseTo(MIN_TARGET_PX)
  })

  it('the floor sits where the drawn extent crosses MIN_VISIBLE_PX', () => {
    expect(targetSpan([MIN_VISIBLE_PX / 1000 - 1e-6, 0, 0], 1000)).toBeNull()
    expect(targetSpan([MIN_VISIBLE_PX / 1000, 0, 0], 1000)).not.toBeNull()
  })
})

describe('the far bound (arkinox, 2026-10-01)', () => {
  // The largest model, along its diagonal, at the nearest drawn distance on the tallest screen.
  const worstPx = (doublings: number, extent = 64): number => Math.sqrt(3) * (2 * extent + 1) * 2 ** -doublings * pxPerUnit(FOV, MAX_VIEWPORT_PX, CAMERA_NEAR)

  it('is 22 doublings at the shipped constants', () => {
    expect(farCullDoublings()).toBe(22)
  })

  it('is the tightest safe value: the worst case still shows at one less, and cannot at the bound', () => {
    const n = farCullDoublings()
    expect(worstPx(n - 1)).toBeGreaterThanOrEqual(MIN_VISIBLE_PX)
    expect(worstPx(n)).toBeLessThan(MIN_VISIBLE_PX)
  })

  it('gives a larger grid its own bound, still the tightest safe one, and leaves the rest of the world alone', () => {
    expect(farCullDoublings(8)).toBe(22)
    expect(farCullDoublings(64)).toBe(22)
    for (const extent of [65, 200, 4096, MAX_EXTENT]) {
      const n = farCullDoublings(extent)
      expect(worstPx(n - 1, extent)).toBeGreaterThanOrEqual(MIN_VISIBLE_PX)
      expect(worstPx(n, extent)).toBeLessThan(MIN_VISIBLE_PX)
    }
    expect(farCullDoublings(MAX_EXTENT)).toBe(32)
  })
})

describe('too big to tap', () => {
  it('a shard wider than MAX_SCREENS screens takes no taps; one just under still does', () => {
    const viewport = 844
    expect(targetSpan([3, 1, 1], 1000, viewport)).toBeNull()
    expect(targetSpan([MAX_SCREENS * viewport / 1000 - 0.01, 1, 1], 1000, viewport)).not.toBeNull()
  })
})

describe('yieldsTap: your own avatar takes only the taps nothing else wants (arkinox, 2026-10-12)', () => {
  const self = { name: 'own avatar target' }
  it('takes a tap that hit only it', () => {
    expect(yieldsTap([{ object: self }], self)).toBe(false)
  })
  it('leaves a tap to a shard, a stop, the planet or another avatar under the same ray, nearer or farther', () => {
    expect(yieldsTap([{ object: self }, { object: { name: 'shard' } }], self)).toBe(true)
    expect(yieldsTap([{ object: { name: 'stop cube' } }, { object: self }], self)).toBe(true)
  })
})

describe('tapRaycast: a target is placed when a ray asks (2026-10-20)', () => {
  /** A shard (a 2-unit box) and its target as siblings under one placed group, a camera looking down -z. */
  function world(spec: (drawn: Group) => TapSpec) {
    const scene = new Scene()
    const holder = new Group()
    holder.position.set(0, 0, -10)
    // Built off its origin, as a model can be: the target has to move to it.
    const drawn = new Group()
    drawn.position.set(2, 0, 0)
    drawn.add(new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()))
    const target = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial())
    holder.add(drawn, target)
    scene.add(holder)
    const camera = new PerspectiveCamera(FOV, 1, CAMERA_NEAR, 6000)
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    const last: { current: Event | null } = { current: null }
    const view = (): TapView => ({ camera, size: { width: 800, height: 800 }, internal: { lastEvent: last } })
    const out = { across: 0, perPxWorld: 0 }
    target.raycast = tapRaycast(view, { current: spec(drawn) }, out)
    const hits = (x: number, y: number): number => {
      const ray = new Raycaster()
      ray.setFromCamera(new Vector2(x, y), camera)
      return ray.intersectObject(target).length
    }
    return { scene, holder, drawn, target, camera, last, out, hits }
  }

  it('is placed on what is drawn and hit there, with no frame rendered in between', () => {
    const w = world((drawn) => ({ measure: { current: drawn } }))
    // Never placed by a frame: the target starts at its parent's origin, unit size, beside the box.
    const at = new Vector3(2, 0, -10).project(w.camera)
    expect(w.hits(at.x, at.y)).toBeGreaterThan(0)
    expect(w.target.getWorldPosition(new Vector3()).distanceTo(new Vector3(2, 0, -10))).toBeLessThan(1e-9)
    expect(w.out.across).toBeGreaterThan(0)
    // The parent's origin, where the target started, is clear of the box: no hit.
    expect(w.hits(0, 0)).toBe(0)
  })

  it('follows the shard as last drawn: moved and drawn again, the next tap finds it there', () => {
    const w = world((drawn) => ({ measure: { current: drawn } }))
    w.holder.position.set(3, 0, -10)
    w.scene.updateMatrixWorld(true)
    const now = new Vector3(5, 0, -10).project(w.camera)
    const before = new Vector3(2, 0, -10).project(w.camera)
    expect(w.hits(now.x, now.y)).toBeGreaterThan(0)
    expect(w.hits(before.x, before.y)).toBe(0)
  })

  it('takes no wheel ray: a wheel turn is a zoom, and nothing is measured for it', () => {
    const w = world((drawn) => ({ measure: { current: drawn } }))
    w.last.current = { type: 'wheel' } as Event
    const at = new Vector3(2, 0, -10).project(w.camera)
    expect(w.hits(at.x, at.y)).toBe(0)
    w.last.current = { type: 'pointerdown' } as Event
    expect(w.hits(at.x, at.y)).toBeGreaterThan(0)
  })

  it('takes no taps when what is drawn is a speck', () => {
    const w = world((drawn) => ({ measure: { current: drawn } }))
    w.drawn.scale.setScalar(1e-9)
    w.scene.updateMatrixWorld(true)
    const at = new Vector3(2e-9, 0, -10).project(w.camera)
    expect(w.hits(at.x, at.y)).toBe(0)
    expect(w.hits(0, 0)).toBe(0)
  })

  it('a mark is a fixed number of pixels across, and is marked to win over a shard', () => {
    const w = world(() => ({ px: MIN_TARGET_PX, at: [0, 0, 0] }))
    expect(w.hits(0, 0)).toBeGreaterThan(0)
    expect(w.target.userData.tapPriority).toBe('mark')
    // MIN_TARGET_PX across at 10 units: its world size is that many pixels' worth.
    expect(w.target.scale.x * pxPerUnit(FOV, 800, 10)).toBeCloseTo(MIN_TARGET_PX)
  })
})
