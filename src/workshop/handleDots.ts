/**
 * handleDots.ts: every handle's dot on the bench, drawn as one object
 * (2026-10-23).
 *
 * The bench shows a dot at every point of the shard on it, the same size on
 * screen at every zoom (Bench.tsx ScreenScale). Each dot used to be a mesh of
 * its own, with its own sphere geometry and material, beside an invisible
 * but still drawn hit sphere: two objects a point. A Maze Kit Basilica nave
 * has 1,731 points, so 3,462 objects went through three's render loop every
 * frame, each uploading its matrices, and half of them were transparent and
 * sorted by depth each frame as well. That made about 147 KB of garbage a
 * frame, which a 144 Hz desktop turns into more than a gigabyte a minute. It
 * kept going with the tab behind other windows: a browser draws frames for a
 * tab that is still on screen (arkinox, 2026-10-23: "i let onosendai sit in
 * the background on the workshop with that basilica piece open and the tab
 * froze. memory says 12.7GB").
 *
 * Now the dots are one InstancedMesh: one draw, one geometry and one
 * material, however many points. Each instance is placed and scaled to its
 * pixel radius from the camera, and only when something it depends on has
 * changed (the camera, the viewport, the points or their looks). A bench left
 * alone writes nothing and uploads nothing, frame after frame. The hit
 * targets stay one per point, since a tap must know its point, but they are
 * invisible: three's raycaster still finds them, and its renderer skips
 * them.
 */

import { Color, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, SphereGeometry, Vector3, type PerspectiveCamera } from 'three'

/** One dot: where it is (render space), its radius in CSS pixels, its colour (a CSS colour). */
export interface Dot {
  at: readonly [number, number, number]
  radiusPx: number
  color: string
}

/** World units per CSS pixel at distance 1 for a perspective camera, on a canvas `heightPx` tall. */
export function perPixelAt1(fovDeg: number, heightPx: number): number {
  return (2 * Math.tan((fovDeg * Math.PI) / 360)) / heightPx
}

const SEGMENTS = 12

/**
 * The bench's dots as one InstancedMesh. `set` hands it the dots; `update`,
 * called every frame, rewrites the instances only when the camera, the
 * viewport or the dots changed since it last did, and says whether it wrote.
 */
export class HandleDots {
  readonly mesh: InstancedMesh
  private dots: readonly Dot[] = []
  private dirty = true
  // What the last write was for. A sphere looks the same from every side, so
  // only where the camera stands, its field of view and the canvas height
  // change a dot's size; turning the camera changes nothing here.
  private readonly lastEye = new Vector3(Number.NaN, 0, 0)
  private lastFov = Number.NaN
  private lastHeight = Number.NaN
  private readonly m = new Matrix4()
  private readonly p = new Vector3()
  private readonly c = new Color()
  private readonly geometry: SphereGeometry
  private readonly material: MeshBasicMaterial

  constructor(capacity: number) {
    // A unit sphere, scaled per instance to its radius in world units.
    this.geometry = new SphereGeometry(1, SEGMENTS, SEGMENTS)
    this.material = new MeshBasicMaterial({ toneMapped: false })
    this.mesh = new InstancedMesh(this.geometry, this.material, Math.max(1, capacity))
    this.mesh.count = 0
    // Made now rather than at the first setColorAt, so the material is compiled once, with its colours.
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(this.capacity * 3), 3)
    // The instances move with the camera, so a bounding sphere kept from one
    // frame would cull the dots in the next.
    this.mesh.frustumCulled = false
    // Nothing to tap here: the hit targets are separate (Bench.tsx Handles).
    this.mesh.raycast = () => {}
  }

  /** How many dots fit before a bigger one has to be made. */
  get capacity(): number {
    return this.mesh.instanceMatrix.count
  }

  /** The dots to draw. Their colours are written now; their places at the next `update`. */
  set(dots: readonly Dot[]): void {
    const n = Math.min(dots.length, this.capacity)
    this.dots = dots
    this.mesh.count = n
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, this.c.set(dots[i].color))
    this.mesh.instanceColor!.needsUpdate = true
    this.dirty = true
  }

  /**
   * Places and scales every dot for this camera and canvas height, if the
   * dots, where the camera stands, its field of view or the height changed
   * since the last write. Whether it wrote. Reads the camera's position, not
   * its matrix: the orbit controls move the camera in their own frame
   * callback, before the renderer brings its matrix up to date.
   */
  update(camera: PerspectiveCamera, heightPx: number): boolean {
    const eye = camera.position
    if (!this.dirty && heightPx === this.lastHeight && camera.fov === this.lastFov && eye.equals(this.lastEye)) return false
    this.dirty = false
    this.lastHeight = heightPx
    this.lastFov = camera.fov
    this.lastEye.copy(eye)
    const k = perPixelAt1(camera.fov, heightPx)
    const n = this.mesh.count
    for (let i = 0; i < n; i++) {
      const d = this.dots[i]
      this.p.set(d.at[0], d.at[1], d.at[2])
      const r = Math.max(1e-5, this.p.distanceTo(eye) * k) * d.radiusPx
      this.m.makeScale(r, r, r).setPosition(this.p)
      this.mesh.setMatrixAt(i, this.m)
    }
    this.mesh.instanceMatrix.needsUpdate = true
    return true
  }

  /** Lets the GPU's copies go. */
  dispose(): void {
    this.mesh.dispose()
    this.geometry.dispose()
    this.material.dispose()
  }
}

/** Room for `n` dots and some to spare: a power of two, at least 64, so adding points rarely makes a new one. */
export function dotCapacity(n: number): number {
  let c = 64
  while (c < n) c *= 2
  return c
}
