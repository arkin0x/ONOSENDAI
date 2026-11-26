/**
 * TapOccluder.tsx: what is solid in the scene without a tap target of its
 * own, standing in R3F's raycast so that nothing behind it takes a tap.
 *
 * R3F raycasts only objects with a handler, so the blocks (TerrainLayer.tsx)
 * were never under a tap at all, and a shard buried under many layers of
 * them still opened from a tap on the blocks in front (owner, 2026-11-26: "i
 * frequently click a shard when working in terrain mode - the shard is
 * completely obscured by many layers of blocks, yet I trigger it
 * accidentally"). The occluder is one invisible object with a click handler
 * whose raycast asks `distance` how far along the tap's ray the first solid
 * thing lies, and gives R3F one hit there: the same one ray R3F casts at a
 * press, a release and a click, never a ray a frame.
 *
 * The nearest thing under a tap wins, in every mode. R3F calls handlers
 * nearest hit first: met first, the occluder stops the tap there, so nothing
 * behind it hears it. A shard's target is a box round what it draws, often
 * met before the blocks even when what it draws lies behind them, so a
 * target also gives way when the occluder's hit is nearer than its own claim
 * (TapTarget.tsx blockedNearer).
 *
 * A tap on the occluder itself is nothing: outside TERRAIN a tap on blocks
 * still folds and unfolds the controls as a tap on open space does (the
 * occluder never marks it handled), and in TERRAIN the blocks' own pointer
 * (terrain/TerrainView.tsx terrainPointer) mines. `claims` says whether a tap
 * on it means something (TERRAIN's mine), which a target that yields (your
 * own avatar) gives way to; otherwise a yielding target behind it is not
 * kept from a tap the blocks would never use.
 */

import { useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Mesh, Vector3, type Intersection, type Ray, type Raycaster } from 'three'

/** The userData mark of an occluder's hit, read by the targets under the same tap. */
export const BLOCKS_TAPS = 'blocksTaps'

/** Whether an occluder hit lies nearer than `distance` among a tap's intersections: what a target drew is hidden behind it. */
export function blockedNearer(intersections: ReadonlyArray<{ object: { userData?: Record<string, unknown> }; distance: number }>, distance: number): boolean {
  return intersections.some((i) => i.object.userData?.[BLOCKS_TAPS] === true && i.distance < distance)
}

/** Whether a hit is an occluder whose tap means nothing: a yielding target does not give way to it. */
export function idleOccluder(object: { userData?: Record<string, unknown> }): boolean {
  return object.userData?.[BLOCKS_TAPS] === true && object.userData.claimsTap !== true
}

interface Props {
  /** How far along the ray, in render units, the first solid thing lies, or null for nothing. */
  distance: (ray: Ray) => number | null
  /** Whether a tap on it means something now (TERRAIN mines). */
  claims?: () => boolean
}

/**
 * The raycast of an occluder: one hit at `distance`, within the ray's near
 * and far. A wheel turn is a zoom or a hotbar slot, never a tap, so its ray
 * is refused before the blocks are walked (as a tap target refuses it).
 */
export function occluderRaycast(distance: (ray: Ray) => number | null, claims: () => boolean, lastEvent: () => Event | null = () => null): (this: Mesh, raycaster: Raycaster, intersects: Intersection[]) => void {
  return function raycast(this: Mesh, raycaster: Raycaster, intersects: Intersection[]): void {
    if (lastEvent()?.type === 'wheel') return
    const d = distance(raycaster.ray)
    this.userData.claimsTap = claims()
    if (d === null || !(d >= raycaster.near && d <= raycaster.far)) return
    intersects.push({ distance: d, point: raycaster.ray.at(d, new Vector3()), object: this })
  }
}

const never = (): boolean => false
const stop = (e: ThreeEvent<MouseEvent>): void => { e.stopPropagation() }

export function TapOccluder({ distance, claims = never }: Props): JSX.Element {
  // The raycast is made once and reads the latest props.
  const latest = useRef({ distance, claims })
  latest.current = { distance, claims }
  const get = useThree((st) => st.get)
  const raycast = useMemo(() => occluderRaycast((ray) => latest.current.distance(ray), () => latest.current.claims(), () => get().internal.lastEvent.current), [get])
  // Never drawn, only raycast (R3F raycasts an object whatever its `visible`).
  return <mesh name="tap-occluder" raycast={raycast} onClick={stop} visible={false} frustumCulled={false} userData={{ [BLOCKS_TAPS]: true }} />
}
