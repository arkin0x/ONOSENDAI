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
 */

import { useRef, type RefObject } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Box3, Mesh, PerspectiveCamera, Vector3, type Object3D } from 'three'
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
/** How often the drawn box is measured again, in frames. */
const MEASURE_EVERY = 20

const noRaycast = (): void => {}

/** Pixels per world unit at `distance` from a perspective camera. */
export function pxPerUnit(fovDeg: number, viewportHeightPx: number, distance: number): number {
  return viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360) * Math.max(distance, 1e-9))
}

/**
 * The target box's size along one axis, in world units: the drawn size,
 * widened to MIN_TARGET_PX when smaller; null when the drawn extent is under
 * MIN_VISIBLE_PX, which means no target at all.
 */
export function targetSpan(drawn: [number, number, number], pxPerWorld: number): [number, number, number] | null {
  const across = Math.max(...drawn) * pxPerWorld
  if (!(across >= MIN_VISIBLE_PX)) return null
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
  const frame = useRef(0)
  const centre = useRef(new Vector3())
  const size = useRef(new Vector3())

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
      return
    }

    const drawn = measure?.current
    if (!drawn) { m.raycast = noRaycast; return }
    if (frame.current++ % MEASURE_EVERY === 0 || box.current.isEmpty()) box.current.setFromObject(drawn)
    if (box.current.isEmpty()) { m.raycast = noRaycast; return }
    box.current.getCenter(centre.current)
    box.current.getSize(size.current)
    const span = targetSpan([size.current.x, size.current.y, size.current.z], pxPerUnit(fov, state.size.height, cam.position.distanceTo(centre.current)))
    if (!span) { m.raycast = noRaycast; return }
    m.raycast = Mesh.prototype.raycast
    // The box is measured in world space; the target lives in its parent's.
    m.position.copy(m.parent.worldToLocal(centre.current.clone()))
    m.scale.set(span[0], span[1], span[2])
  })

  const tap = (e: ThreeEvent<MouseEvent>): void => {
    if (e.delta > TAP_SLOP_PX) return
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
