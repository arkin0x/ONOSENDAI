/**
 * LookMark.tsx: a chest or a door in the world as the look it wears
 * (lib/looks.ts), closed, or open once this identity has opened it (R14).
 *
 * Placed like a shard (chest and door design, D2): the model's origin on the
 * item's place (itemCentre), at its true size, turned with the view. Always
 * its true size, at every distance and zoom, as a shard is: a chest is one
 * gibson, and beside a block it stays a block's size (arkinox, 2026-11-26:
 * "doors and chests are not scaling with the view zoom? getting way too
 * big"). It was held to the note's old cube on screen (24.5 pixels), which at
 * BUILD's far orbit drew a chest some forty times its size. Once its true
 * size is under a few pixels a small dot stands in its place (FarDot,
 * lib/markerSize FAR_DOT_PX), never larger than that. When the dot takes
 * over is judged by the closed look's bounds, so opening it never moves that
 * moment.
 *
 * Not cut at its region: a built-in look carries nothing secret, and a chest
 * cut in half at a small bag's wall would read as broken. A custom look is
 * cut at its region's walls as a hidden shard is (DECK-0003 §1.6, DECK-0004
 * §3.6), stands as its payload says, and shares the scene's budget (LookFrame).
 *
 * No name floats over a chest or a door: its name is on its card, and a tap
 * anywhere it draws opens that card (arkinox, 2026-11-02; WorldMessages
 * FLOATING_NAME). A caller that hands it a `label` gets one just above it,
 * as an item's model's is (ItemModel).
 */

import { useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { Matrix4, type Group, type PerspectiveCamera, type Points } from 'three'
import { flatten, type ShardModel } from 'sno-core/shards'
import { extentOf, trueScale } from '../lib/itemModel'
import { renderPose, viewPose, type Pose } from '../lib/pose'
import { CUBE_REACH, farDotShown, perPixelAt } from '../lib/markerSize'
import type { ViewAxes } from '../lib/space'
import type { Box } from '../lib/clip'
import type { Look } from '../lib/looks'
import { useCyberspace } from '../store/useCyberspace'
import { FarDot } from './FarDot'
import { ShardMesh } from './ShardMesh'
import { TapTarget } from './TapTarget'
import { LABEL_PRIORITY, WorldLabel } from './WorldLabel'
import { useBuildDimmed } from './BuildOccluders'

const IDENTITY = new Matrix4()

/**
 * How large a chest or a door may be drawn and still take a tap from up
 * close: from inside it, or right beside it (TapTarget `upClose`). Its own
 * true size plus UP_CLOSE_GIBSONS for what an opened chest lines up in front
 * of it (ChestLoot, about 0.6 a thing), never more than UP_CLOSE_CAP_GIBSONS,
 * so a huge custom look keeps a shard's rules. A HALL door is 5 by 7.
 */
export const UP_CLOSE_GIBSONS = 6
export const UP_CLOSE_CAP_GIBSONS = 16

/** A look's bounds about its origin, in model units, render frame: what it is sized and labelled by. */
export interface LookBounds {
  min: [number, number, number]
  max: [number, number, number]
  /** Its longest side. */
  longest: number
  /** The farthest corner of its bounds from the origin. */
  reach: number
}

const measured = new WeakMap<ShardModel, LookBounds>()

/** The bounds of a model about its origin, once per model. */
export function lookBounds(shard: ShardModel): LookBounds {
  const held = measured.get(shard)
  if (held) return held
  const e = extentOf(flatten(shard).positions, null)
  const min: [number, number, number] = e ? [e.centre[0] - e.half[0], e.centre[1] - e.half[1], e.centre[2] - e.half[2]] : [0, 0, 0]
  const max: [number, number, number] = e ? [e.centre[0] + e.half[0], e.centre[1] + e.half[1], e.centre[2] + e.half[2]] : [0, 0, 0]
  const longest = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])
  const reach = Math.hypot(...[0, 1, 2].map((k) => Math.max(Math.abs(min[k]), Math.abs(max[k]))))
  const b = { min, max, longest, reach }
  measured.set(shard, b)
  return b
}

/**
 * What every mesh of a look is drawn with (scene/ShardMesh). `clip` is in the
 * frame the mesh is drawn in. A standing look carries `pose`, and the frame
 * around it is left unturned, so the pose and the view-frame cut are ShardMesh's
 * own, exactly as a standing hidden shard's are (WorldShards placeShard).
 */
export interface LookFrame {
  clip?: Box
  pose?: Pose
  /** Its placed objects are drawn within the scene's budget, by trust and nearest first (scene/meshBudget.ts). */
  budget?: { key: string; trusted: boolean; centre: [number, number, number]; scale: number }
}

interface Props {
  look: Look
  /** What is drawn now: the closed model, the open one, or nothing. */
  model: ShardModel | null
  /** The item's place in the render frame (itemCentre). */
  at: [number, number, number]
  axes: ViewAxes
  /** The colour of the dot it is drawn as once too small on screen to be itself (FarDot). */
  dot?: string
  /** A name to float just above it; absent, none (FLOATING_NAME). */
  label?: { text: string; color: string; sub: string; subColor: string }
  onTap?: () => void
  /** How high above the origin, in the look's units, the label must clear: what floats over it (ChestLoot). */
  clearTop?: number
  /**
   * What else is drawn in the look's own frame, scaled and turned with it:
   * the model is the default, and a ceremony draws its own instead.
   */
  children?: (frame: { model: ShardModel | null; dim: number } & LookFrame) => ReactNode
  /** How a custom look is drawn: where it is cut, how it stands, and its share of the scene's budget. */
  frame?: LookFrame
  /** Its key among what may block the build cursor (BuildOccluders); absent, it never dims. Dimmed, a tap passes through it. */
  occluder?: string
}

/** A chest or a door as its look, sized, turned with the view, and tappable. */
export function LookMark({ look, model, at, axes, dot = '#ffd27d', label, onTap, clearTop = 0, children, frame, occluder }: Props): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // A standing look's pose is ShardMesh's (LookFrame); any other turns with the view here.
  const standing = !!frame?.pose
  const turn = useMemo(() => (standing ? IDENTITY : renderPose(viewPose(axes))), [axes, standing])
  const bounds = lookBounds(look.closed)
  // Sized by what is drawn: an open look may be of another unit than the closed one.
  const drawnUnit = (model ?? look.closed).unit
  const atTrue = useMemo(() => trueScale(drawnUnit, scaleExp), [drawnUnit, scaleExp])
  // The label clears the look from any side at the size it is drawn at
  // (WorldLabel `clear`, the rule ItemModel follows): the farthest corner of
  // its bounds from the origin, at true size.
  const clear = useMemo(() => ({ trueSide: (Math.max(bounds.reach, clearTop) * atTrue) / CUBE_REACH, minPx: 0 }), [bounds, atTrue, clearTop])
  const gibson = trueScale(0, scaleExp)
  const upClose = Math.min(bounds.longest * atTrue + UP_CLOSE_GIBSONS * gibson, UP_CLOSE_CAP_GIBSONS * gibson)
  const outer = useRef<Group>(null)
  const body = useRef<Group>(null)
  const far = useRef<Points>(null)
  const drawn = useRef<Group | null>(null)
  // Dimmed while it stands between the camera and the build cursor.
  const dim = useBuildDimmed(occluder, drawn)
  useFrame((state) => {
    const g = outer.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    // The look itself at its true size, or the dot once that is too small to be anything.
    const shown = farDotShown(bounds.longest * atTrue, perPixelAt(cam.position.distanceTo(g.position), cam.fov, state.size.height))
    if (body.current) body.current.visible = !shown
    if (far.current) far.current.visible = shown
  }, LABEL_PRIORITY)
  return (
    <>
      <group ref={outer} position={at} scale={Math.max(1e-9, atTrue)}>
        <FarDot dotRef={far} color={dot} />
        <group ref={body} matrix={turn} matrixAutoUpdate={false}>
          <group ref={drawn}>
            {children ? children({ model, dim, ...frame }) : model && <ShardMesh shard={model} world {...frame} dim={dim} />}
          </group>
        </group>
      </group>
      {/* Outside the scaled group: a target and a label size themselves from the camera. */}
      {onTap && <group position={at}><TapTarget measure={drawn} occluder={occluder} onTap={onTap} upClose={upClose} /></group>}
      {label && <WorldLabel text={label.text} color={label.color} at={at} align="center" px={13} sub={label.sub} subColor={label.subColor} clear={clear} recede="name" />}
    </>
  )
}
