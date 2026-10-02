/**
 * TapTarget.tsx: the invisible thing a tap on a world object lands on.
 *
 * A shard's target is the box the shard actually draws, measured from the
 * drawn geometry itself (faces, points, lines and placed objects), not a
 * sphere at its origin: a model wider than two units, or built off its
 * origin, used to overhang its sphere, so tapping what you saw missed
 * (arkinox, 2026-09-30: "tapping on shards is really unreliable").
 *
 * What cannot be seen cannot be tapped. Every frame the box's size on screen
 * is worked out from the camera; under MIN_VISIBLE_PX the target stops taking
 * rays. The old sphere had a floor of 0.6 render cells, so a shard shrunk far
 * below a pixel by zooming out (2^52) still caught taps. A shard that can be
 * seen but is small is given a finger-sized target, MIN_TARGET_PX across,
 * so it is easy to hit without being invisible-yet-hittable.
 *
 * A message's mark is drawn at a fixed pixel size and so is always visible;
 * its target is a fixed pixel size too (`px`).
 *
 * The other end has a limit too (arkinox, 2026-10-01). Zoomed far in, a
 * shard is larger than the screen, and a target the size of what it draws
 * would cover the whole view, so every tap anywhere would open it. A shard
 * whose box holds the camera, or whose box is more than MAX_SCREENS screens
 * across, takes no taps; it is still drawn, so its faces stand around you.
 *
 * farCullDoublings below is the guaranteed form of the same idea for shards
 * zoomed far out: past that many doublings no shard of its own geometry can
 * show MIN_VISIBLE_PX at any camera distance, so it is not drawn at all.
 */

import { useRef, type RefObject } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Box3, Mesh, PerspectiveCamera, Raycaster, Vector3, type Object3D } from 'three'
import { MAX_EXTENT } from 'sno-core/shards'
import { CAMERA_NEAR, FOV } from './camera'
import { markSceneTapHandled } from '../hooks/useCanvasTap'

/** Below this many pixels across, an object is a speck and takes no taps. */
export const MIN_VISIBLE_PX = 4
/** The smallest target a visible object gets, in pixels: a fingertip. */
export const MIN_TARGET_PX = 28
/**
 * How far a press may travel and still be a tap, in pixels: the same
 * allowance useCanvasTap gives the scene, so a thumb that drifts a little
 * does not open nothing at all.
 */
export const TAP_SLOP_PX = 12
/**
 * Past this many pixels across, a shard's box is mostly air around it, so a
 * tap must land on what it draws: a face, or within PRECISE_SLOP_PX of a point
 * or line. Smaller shards keep the fingertip box, since their geometry is too
 * small to hit exactly (arkinox, 2026-10-02: the palm tree's box took every
 * tap meant for the coin between its fronds).
 */
export const PRECISE_ABOVE_PX = 3 * 28
/** How near a point or line a tap must land, in pixels, when the hit must be exact. */
export const PRECISE_SLOP_PX = 12

/** Wider than this many screens, a shard is something you are inside, not something to tap. */
export const MAX_SCREENS = 2
/**
 * The tallest viewport the far bound is worked out for, in CSS pixels: a 4K
 * screen. A taller one would only make the bound more generous than needed.
 */
export const MAX_VIEWPORT_PX = 2160

const noRaycast = (): void => {}

const corner = new Vector3()
/**
 * The widest side of a box's outline on screen, in pixels, from its eight
 * corners; null when any corner is at or behind the camera, which means the
 * box reaches round the view.
 */
function screenAcross(b: Box3, cam: PerspectiveCamera, width: number, height: number): number | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z)
    corner.applyMatrix4(cam.matrixWorldInverse)
    if (corner.z >= 0) return null
    corner.applyMatrix4(cam.projectionMatrix)
    const x = ((corner.x + 1) / 2) * width
    const y = ((1 - corner.y) / 2) * height
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  return Math.max(maxX - minX, maxY - minY)
}

/**
 * How many doublings past a shard's own unit the view can zoom out before the
 * shard cannot show MIN_VISIBLE_PX at any distance, for a shard with no
 * placed objects. Worked out from the worst case rather than chosen: the
 * largest model (MAX_EXTENT each side of the origin, so 2 x MAX_EXTENT + 1
 * units per axis, measured along the diagonal), as close to the camera as
 * anything is drawn (CAMERA_NEAR), on a MAX_VIEWPORT_PX tall screen. At the
 * shipped constants it is 22: a shard at unit 2^X is never visible from
 * 2^(X + 22) out. Placed objects carry their own unit and scale step, up to
 * 2^84 whatever their parent's unit, so a shard with any is never culled by
 * this bound; its taps still follow the measured size.
 */
export function farCullDoublings(): number {
  const span = Math.sqrt(3) * (2 * MAX_EXTENT + 1)
  return Math.ceil(Math.log2((span * pxPerUnit(FOV, MAX_VIEWPORT_PX, CAMERA_NEAR)) / MIN_VISIBLE_PX))
}

/** Pixels per world unit at `distance` from a perspective camera. */
export function pxPerUnit(fovDeg: number, viewportHeightPx: number, distance: number): number {
  return viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(distance, 1e-9))
}

/**
 * The target box's size along one axis, in world units: the drawn size,
 * widened to MIN_TARGET_PX when smaller; null when the drawn extent is under
 * MIN_VISIBLE_PX, which means no target at all.
 */
export function targetSpan(drawn: [number, number, number], pxPerWorld: number, viewportPx = Infinity): [number, number, number] | null {
  const across = Math.max(...drawn) * pxPerWorld
  if (!(across >= MIN_VISIBLE_PX)) return null
  if (across > MAX_SCREENS * viewportPx) return null
  const floor = MIN_TARGET_PX / pxPerWorld
  return drawn.map((d) => Math.max(d, floor)) as [number, number, number]
}

interface Props {
  onTap: () => void
  /** The drawn object to measure (a shard). */
  measure?: RefObject<Object3D>
  /** A fixed on-screen size instead, in pixels, centred at `at` (a message's mark). */
  px?: number
  at?: [number, number, number]
}

export function TapTarget({ onTap, measure, px, at }: Props): JSX.Element {
  const hit = useRef<Mesh>(null)
  const box = useRef(new Box3())
  const centre = useRef(new Vector3())
  const size = useRef(new Vector3())
  // How wide the shard is on screen this frame, and the world size of a
  // pixel at its distance: what the tap needs to decide whether it must hit
  // the geometry itself.
  const across = useRef(0)
  const perPxWorld = useRef(0)
  const precise = useRef(new Raycaster())

  useFrame((state) => {
    const m = hit.current
    if (!m || !m.parent) return
    const cam = state.camera as PerspectiveCamera
    const fov = cam.fov ?? 50

    if (px !== undefined) {
      centre.current.set(...(at ?? [0, 0, 0]))
      m.parent.localToWorld(centre.current)
      const perPx = 1 / pxPerUnit(fov, state.size.height, cam.position.distanceTo(centre.current))
      m.position.set(...(at ?? [0, 0, 0]))
      m.scale.setScalar(px * perPx)
      m.raycast = Mesh.prototype.raycast
      // A mark (a message or a coin) is a deliberate, fixed-size target, and
      // wins over a shard's box when a tap passes through both.
      m.userData.tapPriority = 'mark'
      return
    }

    const drawn = measure?.current
    if (!drawn) { m.raycast = noRaycast; return }
    // Measured every frame, from the geometry as it is drawn now: a shard
    // clipped to its region changes shape with the zoom, and a measurement
    // even a few frames old kept a target alive over nothing (arkinox,
    // 2026-10-01: still tappable at 2^9 after vanishing at 2^5). The cost is
    // one cached bounding box per child geometry.
    box.current.setFromObject(drawn)
    if (box.current.isEmpty()) { m.raycast = noRaycast; return }
    // Inside the shard: it surrounds the view, so it is not a thing to tap.
    if (box.current.containsPoint(cam.position)) { m.raycast = noRaycast; return }
    box.current.getCenter(centre.current)
    box.current.getSize(size.current)
    // How wide the box really is on screen, from its eight corners: the
    // distance to its centre understates a large box, whose near face is
    // much closer than its middle. A corner behind the camera means the box
    // reaches round the view, which is too big to tap.
    const wide = screenAcross(box.current, cam, state.size.width, state.size.height)
    if (wide === null) { m.raycast = noRaycast; return }
    const viewport = Math.max(state.size.width, state.size.height)
    const perWorld = pxPerUnit(fov, state.size.height, cam.position.distanceTo(centre.current))
    across.current = wide
    perPxWorld.current = 1 / perWorld
    const span = wide > MAX_SCREENS * viewport ? null : targetSpan([size.current.x, size.current.y, size.current.z], perWorld)
    if (!span) { m.raycast = noRaycast; return }
    m.raycast = Mesh.prototype.raycast
    // The box is measured in world space; the target lives in its parent's.
    m.position.copy(m.parent.worldToLocal(centre.current.clone()))
    m.scale.set(span[0], span[1], span[2])
  })

  const tap = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP_PX) return
    if (measure) {
      // A coin or message under the same tap takes it: leave the event to
      // travel on to it (not stopping propagation is how R3F does that).
      if (e.intersections.some((i) => i.object.userData?.tapPriority === 'mark')) return
      // A large shard is hit only where it draws, so the air inside its box
      // lets the tap through to whatever is behind.
      const drawn = measure.current
      if (drawn && across.current > PRECISE_ABOVE_PX) {
        const ray = precise.current
        ray.set(e.ray.origin, e.ray.direction)
        const slop = PRECISE_SLOP_PX * perPxWorld.current
        ray.params.Points = { threshold: slop }
        ray.params.Line = { threshold: slop }
        if (ray.intersectObject(drawn, true).length === 0) return
      }
    }
    e.stopPropagation()
    markSceneTapHandled()
    onTap()
  }

  return (
    <mesh ref={hit} onClick={tap} raycast={noRaycast}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}
