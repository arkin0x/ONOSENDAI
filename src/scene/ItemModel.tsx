/**
 * ItemModel.tsx: an item drawn as the SNO it wears, in motion, inside its
 * blue box (lib/itemModel.ts has the tags, the motions and the box; arkinox,
 * 2026-10-21).
 *
 * The note's cube was a blue outline held at a fixed size on screen. An item
 * that wears a model is drawn at the model's true size instead (2^unit
 * gibsons a model unit, as WorldShards draws a shard), inside a blue outline
 * of whole gibsons that holds it through the whole of its motion, and never
 * smaller on screen than the cube was (lib/itemModel.ts modelScale). The
 * item's place means what it always did: the model's centre and the box's
 * centre sit exactly where the cube's centre sat (itemCentre).
 *
 * The frame, from the outside in:
 *   - the item's place, scaled each frame (true size, or the cube's floor);
 *   - the view's turn (lib/pose.ts viewPose), so a view turn turns the item
 *     with everything else, as it does a shard;
 *   - the box, still, in the model's own frame;
 *   - the bob on Y, then the turn about Y, then the turn about X inside it,
 *     then the model, moved so its centre is the place.
 *
 * Cut at its region's walls like a shard (clip.ts), but on the GPU: a cut
 * made once, where the model stands, would turn with the model. Only an item
 * whose box reaches a wall carries planes at all, so every other item, and
 * every shard, draws with the programs it always had.
 *
 * Built for many: the box is one shared edge geometry, a model's ShardModel
 * and extent are shared by every item that wears it (useItemModel), and a
 * frame writes a few numbers and allocates nothing.
 */

import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Matrix4, Plane, Vector3, type Group, type PerspectiveCamera } from 'three'
import type { Box } from '../lib/clip'
import { boxInRegion, boxShape, itemBoxSize, modelScale, motionAt, phaseOf, trueScale, turnBox, type ItemAnimation, type MotionPose } from '../lib/itemModel'
import { renderPose, viewPose } from '../lib/pose'
import type { ViewAxes } from '../lib/space'
import type { LoadedModel } from '../hooks/useItemModel'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useCyberspace } from '../store/useCyberspace'
import { CUBE_EDGES, ShardMesh } from './ShardMesh'
import { TapTarget } from './TapTarget'
import { WorldLabel } from './WorldLabel'
import { CUBE_REACH } from '../lib/markerSize'

/** The note's own blue, the cube's color (WorldMessages NOTE_BLUE). */
export const ITEM_BOX_BLUE = '#4aa3ff'
/** The cube's line opacity (WorldMessages MARK_LOOK.note). */
const BOX_OPACITY = 0.55

/** The six walls of a box as planes that keep its inside: x >= min, x <= max, and so on. */
function wallsOf(b: Box): Plane[] {
  const out: Plane[] = []
  for (let k = 0; k < 3; k++) {
    const n = [0, 0, 0]
    n[k] = 1
    out.push(new Plane(new Vector3(n[0], n[1], n[2]), -b.min[k]))
    n[k] = -1
    out.push(new Plane(new Vector3(n[0], n[1], n[2]), b.max[k]))
  }
  return out
}

interface MotionProps {
  model: LoadedModel
  animation: readonly ItemAnimation[]
  /** The item's id: its phase, so items bob out of step. */
  id: string
  /** The box, model units, about the place. */
  box: Box
  /** The bob's reach each way, model units. */
  amplitude: number
  /** Planes the model is cut at, in world space, kept current by the caller. */
  planes?: Plane[]
  /** Lit as on the bench (the composer's preview); the world draws unlit under its bloom. */
  lit?: boolean
  opacity?: number
  frameRef?: MutableRefObject<Group | null>
}

/** The box and the model in motion, in the model's own units, centred on the place. */
export function ModelInMotion({ model, animation, id, box, amplitude, planes, lit = false, opacity = 1, frameRef }: MotionProps): JSX.Element {
  const bob = useRef<Group>(null)
  const turnY = useRef<Group>(null)
  const turnX = useRef<Group>(null)
  const still = useReducedMotion()
  const phase = useMemo(() => phaseOf(id), [id])
  const pose = useMemo<MotionPose>(() => ({ lift: 0, turnY: 0, turnX: 0 }), [])
  useFrame((state) => {
    if (!bob.current || !turnY.current || !turnX.current) return
    motionAt(state.clock.elapsedTime, animation, phase, amplitude, still, pose)
    bob.current.position.y = pose.lift
    turnY.current.rotation.y = pose.turnY
    turnX.current.rotation.x = pose.turnX
  })
  const shape = useMemo(() => boxShape(box), [box])
  const c = model.extent.centre
  return (
    <group ref={frameRef}>
      <lineSegments geometry={CUBE_EDGES} position={shape.centre} scale={shape.size} frustumCulled={false}>
        <lineBasicMaterial color={ITEM_BOX_BLUE} toneMapped={false} transparent opacity={BOX_OPACITY * opacity} depthWrite={false} />
      </lineSegments>
      <group ref={bob}>
        <group ref={turnY}>
          <group ref={turnX}>
            <group position={[-c[0], -c[1], -c[2]]}>
              <ShardMesh shard={model.shard} world={!lit} lit={lit} clipPlanes={planes} />
            </group>
          </group>
        </group>
      </group>
    </group>
  )
}

/** The box and the bob for a model in motion, at its own unit, before any region cuts it. */
export function useItemBox(model: LoadedModel, animation: readonly ItemAnimation[]): { gibsons: [number, number, number]; amplitude: number } {
  return useMemo(() => itemBoxSize(model.extent, model.shard.unit, animation), [model, animation])
}

interface MarkProps {
  id: string
  model: LoadedModel
  animation: readonly ItemAnimation[]
  /** The item's place in the render frame (itemCentre). */
  at: [number, number, number]
  /** Its region about the place, in gibsons, in the render frame (regionBox at unit 0); null for none. */
  region: Box | null
  axes: ViewAxes
  /** The edge of the note's cube on screen, CSS pixels: the smallest the box is ever drawn. */
  minPx: number
  opacity?: number
  /** A tap on what it draws; TV's have none. */
  onTap?: () => void
  /** The item's name and who left it, stood just above the box. */
  label?: { text: string; color: string; sub: string; subColor: string }
}

/** An item in the world as the model it wears: the scene's and Cyberspace TV's (WorldMessages ItemMark). */
export function ItemModelMark({ id, model, animation, at, region, axes, minPx, opacity = 1, onTap, label }: MarkProps): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const gl = useThree((s) => s.gl)
  const unit = model.shard.unit
  const size = useItemBox(model, animation)
  // The view's turn, and its inverse to carry the region into the model's frame.
  const turn = useMemo(() => renderPose(viewPose(axes)), [axes])
  const cut = useMemo(() => {
    const perUnit = 2 ** unit
    if (!region) {
      const box: Box = { min: [0, 0, 0], max: [0, 0, 0] }
      for (let k = 0; k < 3; k++) { box.min[k] = -size.gibsons[k] / 2 / perUnit; box.max[k] = size.gibsons[k] / 2 / perUnit }
      return { box, walls: null }
    }
    const inModel = turnBox(region, new Matrix4().copy(turn).invert().elements)
    const { box, clipped } = boxInRegion(size.gibsons, inModel, unit)
    const walls: Box = { min: [inModel.min[0] / perUnit, inModel.min[1] / perUnit, inModel.min[2] / perUnit], max: [inModel.max[0] / perUnit, inModel.max[1] / perUnit, inModel.max[2] / perUnit] }
    return { box, walls: clipped ? walls : null }
  }, [region, turn, size, unit])
  // The walls in the model's frame, and the same planes in world space that the materials read.
  const planes = useMemo(() => {
    if (!cut.walls) return null
    const local = wallsOf(cut.walls)
    return { local, world: local.map((p) => p.clone()) }
  }, [cut.walls])
  useEffect(() => { if (planes) gl.localClippingEnabled = true }, [gl, planes])

  const atTrue = useMemo(() => trueScale(unit, scaleExp), [unit, scaleExp])
  const longest = Math.max(...boxShape(cut.box).size)
  // The label clears the box on screen from any side, at the same scale the
  // box is drawn at: WorldLabel lifts by a marker's side times CUBE_REACH
  // (half a cube's space diagonal, the cube's rule for any view), so the
  // side handed over is this box's half diagonal about the place over that,
  // at true size and at the floor alike (modelScale). Its top alone sat the
  // label on the box from a camera looking down (review of #439).
  const reach = useMemo(() => Math.hypot(...[0, 1, 2].map((k) => Math.max(Math.abs(cut.box.min[k]), Math.abs(cut.box.max[k])))), [cut.box])
  const clear = useMemo(() => ({ trueSide: (reach * atTrue) / CUBE_REACH, minPx: longest > 0 ? (reach * minPx) / longest / CUBE_REACH : minPx }), [reach, atTrue, longest, minPx])
  const outer = useRef<Group>(null)
  const frame = useRef<Group | null>(null)
  useFrame((state) => {
    const g = outer.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    const perPx = (2 * Math.tan((cam.fov * Math.PI) / 360) * cam.position.distanceTo(g.position)) / state.size.height
    g.scale.setScalar(Math.max(1e-9, modelScale(atTrue, longest, minPx, perPx)))
    if (planes && frame.current) {
      frame.current.updateWorldMatrix(true, false)
      for (let i = 0; i < planes.local.length; i++) planes.world[i].copy(planes.local[i]).applyMatrix4(frame.current.matrixWorld)
    }
  })

  return (
    <>
      <group ref={outer} position={at}>
        <group matrix={turn} matrixAutoUpdate={false}>
          <ModelInMotion model={model} animation={animation} id={id} box={cut.box} amplitude={size.amplitude} planes={planes?.world} opacity={opacity} frameRef={frame} />
        </group>
      </group>
      {/* Outside the scaled group: a target and a label size themselves from
          the camera, and a parent's scale would scale them again. What the
          model draws can be far larger than the cube was, so the box takes
          taps as a shard's does. */}
      {onTap && <group position={at}><TapTarget measure={frame} onTap={onTap} /></group>}
      {label && <WorldLabel text={label.text} color={label.color} at={at} align="center" px={13} sub={label.sub} subColor={label.subColor} opacity={opacity} clear={clear} />}
    </>
  )
}
