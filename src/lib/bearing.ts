/**
 * bearing.ts: drawing something at a fixed offset from the camera, exactly,
 * however far the camera is from the render origin.
 *
 * three.js places a mesh by multiplying the camera's inverse world matrix by
 * the mesh's world matrix. For the black sun both carry the camera's position,
 * and the product is meant to cancel it and leave the sun's 4000 units. It
 * cannot once the camera is far out. A double holds about 16 digits, so at
 * 1e24 two neighbouring values are 1.3e8 apart and 4000 is below that:
 * putting the sun at the camera's position plus 4000 rounds it back onto the
 * camera, and the subtraction that should recover the 4000 recovers nothing.
 * Render space is anchored under the avatar, and the camera does get that far
 * from it: a far cursor at 2^0, or a cut across the universe in Cyberspace TV
 * (measured 2026-10-20 at 4.4e24, every frame of it with the sun sitting on
 * the eye, culled on some and drawn on others: arkinox's flicker).
 *
 * So the sun's model-view is made without the camera's position at all: the
 * camera's turn, then the offset, then the local matrices under the sun. That
 * is the same matrix three makes whenever the numbers are small enough for it
 * to, so nothing changes in an ordinary frame.
 */

import { Matrix4, type Mesh, type Object3D, type Vector3 } from 'three'

/**
 * Scratch, so the per-draw work allocates nothing. The product is built in
 * `work` and copied out once, because Matrix4.multiply is multiplyMatrices on
 * itself, and on a held mesh's matrix that is the override below.
 */
const work = new Matrix4()
const step = new Matrix4()
const chain: Object3D[] = []

/**
 * The model-view matrix of `object`, a descendant of `root`, when `root`
 * stands at `offset` from the camera with no turn or scale of its own, into
 * `out`. `viewInverse` is the camera's inverse world matrix, and only its
 * turn is read: its translation is the camera's position, the large number
 * this exists to keep out.
 */
export function bearingModelView(out: Matrix4, viewInverse: Matrix4, offset: Vector3, root: Object3D, object: Object3D): Matrix4 {
  chain.length = 0
  for (let o: Object3D | null = object; o !== null && o !== root; o = o.parent) chain.push(o)
  work.copy(viewInverse).setPosition(0, 0, 0)
  work.multiply(step.makeTranslation(offset.x, offset.y, offset.z))
  for (let i = chain.length - 1; i >= 0; i--) work.multiply(chain[i].matrix)
  return out.copy(work)
}

/** The meshes already drawn from the camera. */
const held = new WeakSet<Object3D>()

/**
 * Draw every mesh under `root` from the camera, at `offset` from it, read on
 * every draw (so the caller changes the vector, never replaces it).
 *
 * The renderer works out a mesh's model-view in one place, a multiplyMatrices
 * call on that mesh's own matrix, just before it draws, and that call is
 * answered here instead. Every other route was worse: the mesh's
 * onBeforeRender runs before the product and is overwritten by it, and a
 * material hook would mean reaching into the label's text materials, which
 * troika makes and remakes itself.
 *
 * Frustum culling is off for the same reason: it tests the world position,
 * and far out that sits on the camera, so the sun was culled on some frames
 * and drawn on others. It is one ring and one label; drawing them when they
 * are behind you costs nothing worth measuring, and the GPU clips them.
 *
 * Called every frame. A mesh mounted later (a label's text arrives after its
 * font) is caught on the frame it appears.
 */
export function holdAtBearing(root: Object3D, offset: Vector3): void {
  root.traverse((o) => {
    if (held.has(o) || !(o as Mesh).isMesh) return
    held.add(o)
    o.frustumCulled = false
    const mv = o.modelViewMatrix
    mv.multiplyMatrices = ((viewInverse: Matrix4) => bearingModelView(mv, viewInverse, offset, root, o)) as Matrix4['multiplyMatrices']
  })
}
