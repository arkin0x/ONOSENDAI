/**
 * bearing.test.ts: the black sun is drawn at its bearing however far the
 * camera is from the render origin (2026-10-20).
 *
 * The scene is built as BlackSun builds it: a group at the camera's position
 * plus the offset, a face turned to the camera under it with the ring mesh,
 * and a label under it the way WorldLabel nests one (placed, scaled, turned,
 * nudged). The oracle is the same scene with the camera at the origin, where
 * three's own product has no large numbers to lose and is exact.
 */
import { describe, expect, it } from 'vitest'
import { Group, Matrix4, Mesh, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { holdAtBearing } from '../bearing'

const OFFSET = new Vector3(0, 0, 4000)
const TURN = new Quaternion().setFromAxisAngle(new Vector3(0.3, 1, 0.2).normalize(), 0.7)

function build(at: Vector3): { camera: PerspectiveCamera; root: Group; ring: Mesh; label: Mesh } {
  const camera = new PerspectiveCamera(55, 0.5, 0.1, 6000)
  camera.position.copy(at)
  camera.quaternion.copy(TURN)
  camera.updateMatrixWorld()
  const root = new Group()
  root.position.copy(at).add(OFFSET)
  const face = new Group()
  face.quaternion.copy(camera.quaternion)
  const ring = new Mesh()
  face.add(ring)
  const labelGroup = new Group()
  labelGroup.position.set(0, -450.4, 0)
  labelGroup.scale.setScalar(19.7)
  const facing = new Group()
  facing.quaternion.copy(camera.quaternion)
  const label = new Mesh()
  label.position.set(0.1, -0.2, 0)
  facing.add(label)
  labelGroup.add(facing)
  root.add(face, labelGroup)
  root.updateMatrixWorld(true)
  return { camera, root, ring, label }
}

/** What the renderer does to place a mesh, just before it draws it. */
function drawn(mesh: Mesh, camera: PerspectiveCamera): Matrix4 {
  return mesh.modelViewMatrix.multiplyMatrices(camera.matrixWorldInverse, mesh.matrixWorld).clone()
}

/** Largest gap between two matrices' elements. */
function gap(a: Matrix4, b: Matrix4): number {
  return Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])))
}

const exact = build(new Vector3())
const ringExact = drawn(exact.ring, exact.camera)
const labelExact = drawn(exact.label, exact.camera)

// Every axis far out at once, as a cut across the universe leaves it.
const far = (m: number): Vector3 => new Vector3(m, -0.61 * m, 0.83 * m)

describe('three on its own, far out', () => {
  it('loses the sun: its 4000 units are below what a double can hold there', () => {
    for (const m of [1e20, 1e25]) {
      const s = build(far(m))
      const t = new Vector3().setFromMatrixPosition(drawn(s.ring, s.camera))
      expect(t.distanceTo(new Vector3().setFromMatrixPosition(ringExact)), `at ${m}`).toBeGreaterThan(50)
    }
  })
})

describe('holdAtBearing', () => {
  for (const m of [0, 26, 1e15, 1e20, 1e25]) {
    it(`draws the ring and its label at their bearing with the camera ${m} out`, () => {
      const s = build(far(m))
      holdAtBearing(s.root, OFFSET)
      expect(gap(drawn(s.ring, s.camera), ringExact)).toBeLessThan(1e-9)
      expect(gap(drawn(s.label, s.camera), labelExact)).toBeLessThan(1e-9)
    })
  }

  it('changes nothing in an ordinary frame: the same matrix three makes itself, to the last float32', () => {
    const plain = build(new Vector3(6.27, 4.26, 24.87))
    const stock = [drawn(plain.ring, plain.camera), drawn(plain.label, plain.camera)]
    holdAtBearing(plain.root, OFFSET)
    const held = [drawn(plain.ring, plain.camera), drawn(plain.label, plain.camera)]
    for (let k = 0; k < 2; k++) {
      expect(gap(held[k], stock[k])).toBeLessThan(1e-9)
      // Translation is what a vertex lands by; upload is float32.
      for (const i of [12, 13, 14]) expect(Math.fround(held[k].elements[i])).toBe(Math.fround(stock[k].elements[i]))
    }
  })

  it('reads the offset on every draw, so a new bearing moves the sun without holding it again', () => {
    const s = build(far(1e25))
    const offset = OFFSET.clone()
    holdAtBearing(s.root, offset)
    offset.set(4000, 0, 0)
    const t = new Vector3().setFromMatrixPosition(drawn(s.ring, s.camera))
    expect(t.distanceTo(new Vector3(4000, 0, 0).applyQuaternion(TURN.clone().invert()))).toBeLessThan(1e-9)
  })

  it('stops culling what it holds, and holds a mesh mounted after the first frame', () => {
    const s = build(far(1e25))
    holdAtBearing(s.root, OFFSET)
    expect(s.ring.frustumCulled).toBe(false)
    expect(s.label.frustumCulled).toBe(false)
    const late = new Mesh()
    s.ring.parent!.add(late)
    s.root.updateMatrixWorld(true)
    holdAtBearing(s.root, OFFSET)
    expect(late.frustumCulled).toBe(false)
    expect(gap(drawn(late, s.camera), ringExact)).toBeLessThan(1e-9)
  })
})
