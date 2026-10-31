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
 * alone writes nothing and uploads nothing, frame after frame.
 *
 * The hit targets and the halos followed (arkinox, 2026-10-31: "locking up
 * only a minute after opening it"). A hit target per point was still a group
 * and a mesh per point: two objects for three to carry a matrix down every
 * frame, a frame callback per point, and a React element per point to diff on
 * every tap. So HandleHits is one object that answers the raycaster itself,
 * by arithmetic over the points, and HandleHalos draws every selected point's
 * glow as one set of points. Selecting all 1,731 points of a nave used to
 * make 1,731 sprites with a material each.
 */

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, Object3D, Points, PointsMaterial, SphereGeometry, Vector3, type Intersection, type PerspectiveCamera, type Raycaster, type Texture } from 'three'

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

/**
 * Every point's hit target as one object, invisible, that answers the
 * raycaster by arithmetic: a sphere around each point, `radiusPx` CSS pixels
 * across on screen wherever the camera stands, as the hit spheres were. A tap
 * still knows its point: each hit carries the point's place in the list as
 * `index`, which R3F keeps on the event (and tells hits apart by).
 *
 * Nothing runs per frame and nothing is allocated unless a point is hit: a
 * pointer press costs one pass over a typed array.
 */
export class HandleHits extends Object3D {
  /** The hit sphere's radius, in CSS pixels. */
  radiusPx = 12
  /** The canvas's height in CSS pixels, which a pixel's size depends on. */
  heightPx = 1
  private at = new Float32Array(0)
  private count = 0

  constructor() {
    super()
    this.visible = false
  }

  /** The points to answer for, in render space. A hit's `index` is a place in this list. */
  set(points: readonly (readonly [number, number, number])[]): void {
    this.count = points.length
    if (this.at.length < points.length * 3) this.at = new Float32Array(dotCapacity(points.length) * 3)
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      this.at[i * 3] = p[0]; this.at[i * 3 + 1] = p[1]; this.at[i * 3 + 2] = p[2]
    }
  }

  /** How many world units one CSS pixel covers at point `index`, for a camera standing at `eye`. */
  pixelAt(index: number, eye: Vector3, fovDeg: number): number {
    const dx = this.at[index * 3] - eye.x, dy = this.at[index * 3 + 1] - eye.y, dz = this.at[index * 3 + 2] - eye.z
    return Math.max(1e-5, Math.sqrt(dx * dx + dy * dy + dz * dz) * perPixelAt1(fovDeg, this.heightPx))
  }

  override raycast(raycaster: Raycaster, intersects: Intersection[]): void {
    const camera = raycaster.camera as PerspectiveCamera | null
    if (!camera) return
    const { origin: o, direction: d } = raycaster.ray
    const k = perPixelAt1(camera.fov, this.heightPx) * this.radiusPx
    const at = this.at
    for (let i = 0; i < this.count; i++) {
      const dx = at[i * 3] - o.x, dy = at[i * 3 + 1] - o.y, dz = at[i * 3 + 2] - o.z
      const along = dx * d.x + dy * d.y + dz * d.z
      if (along <= 0) continue
      const square = dx * dx + dy * dy + dz * dz
      const r = Math.max(1e-5, Math.sqrt(square) * k)
      const off = square - along * along
      if (off > r * r) continue
      // Where the ray enters the sphere: a sphere's near side faces the ray, as a mesh's front faces did.
      const distance = along - Math.sqrt(r * r - off)
      if (distance < raycaster.near || distance > raycaster.far) continue
      intersects.push({ distance, point: new Vector3(o.x + d.x * distance, o.y + d.y * distance, o.z + d.z * distance), object: this, index: i })
    }
  }
}

/** One halo: where it is, and its colour (a CSS colour). */
export interface Halo {
  at: readonly [number, number, number]
  color: string
}

/**
 * Every selected point's glow as one object: a set of points, each the glow
 * texture `sizePx` CSS pixels across wherever it stands, as a sprite in a
 * screen-scaled group was. One draw, one geometry and one material, however
 * much is selected. Written when the selection changes, never per frame.
 */
export class HandleHalos {
  readonly points: Points<BufferGeometry, PointsMaterial>
  private readonly geometry = new BufferGeometry()
  private readonly material: PointsMaterial
  private readonly c = new Color()
  private written = false

  constructor(capacity: number, map: Texture | null, sizePx: number, opacity: number) {
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3))
    this.geometry.setAttribute('color', new BufferAttribute(new Float32Array(Math.max(1, capacity) * 3), 3))
    this.geometry.setDrawRange(0, 0)
    this.material = new PointsMaterial({ map, size: sizePx, sizeAttenuation: false, vertexColors: true, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, toneMapped: false })
    this.points = new Points(this.geometry, this.material)
    // Written in render space, so nothing needs a bounding sphere kept in step.
    this.points.frustumCulled = false
    this.points.raycast = () => {}
    this.points.visible = false
  }

  get capacity(): number {
    return this.geometry.getAttribute('position').count
  }

  /** The halos to draw. Writes only when there is something to write, or something to take away. */
  set(halos: readonly Halo[]): void {
    const n = Math.min(halos.length, this.capacity)
    this.points.visible = n > 0
    if (n === 0 && !this.written) return
    const pos = this.geometry.getAttribute('position') as BufferAttribute
    const col = this.geometry.getAttribute('color') as BufferAttribute
    for (let i = 0; i < n; i++) {
      const h = halos[i]
      pos.setXYZ(i, h.at[0], h.at[1], h.at[2])
      this.c.set(h.color)
      col.setXYZ(i, this.c.r, this.c.g, this.c.b)
    }
    this.written = n > 0
    this.geometry.setDrawRange(0, n)
    if (n > 0) { pos.needsUpdate = true; col.needsUpdate = true }
  }

  /** Lets the GPU's copies go. */
  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
