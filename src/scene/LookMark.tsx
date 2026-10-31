/**
 * LookMark.tsx: a chest or a door in the world as the look it wears
 * (lib/looks.ts), closed, or open once this identity has opened it (R14).
 *
 * Placed like a shard (chest and door design, D2): the model's origin on the
 * item's place (itemCentre), at its true size, turned with the view. A chest
 * is one gibson, so zoomed out it is drawn no smaller on screen than the
 * note's cube was (NOTE_EDGE_PX), and that floor recedes past the headlamp's
 * reach as the cube's did (lib/markerSize.ts recedeShare), so a chest at the
 * far end of a hall is smaller than one at your feet. The size is always the
 * closed look's, so the open look swaps in without the chest changing size.
 *
 * Not cut at its region: a built-in look carries nothing secret, and a chest
 * cut in half at a small bag's wall would read as broken. A custom look is
 * cut at its region's walls as a hidden shard is (DECK-0003 §1.6, DECK-0004
 * §3.6): `clip`, in the look's own frame, which the scale and the view's
 * turn around it leave as it is.
 *
 * Its name and who left it stand just above it, as an item's model's do
 * (ItemModel); a tap anywhere it draws opens its card.
 */

import { useMemo, useRef, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, PerspectiveCamera } from 'three'
import { flatten, type ShardModel } from 'sno-core/shards'
import { extentOf, trueScale } from '../lib/itemModel'
import { placedPose, renderPose } from '../lib/pose'
import { CUBE_REACH, MARK_RECEDE_FLOOR, recedeShare } from '../lib/markerSize'
import type { Position, ViewAxes } from '../lib/space'
import type { Box } from '../lib/clip'
import type { Look } from '../lib/looks'
import { useCyberspace } from '../store/useCyberspace'
import { headlampUniforms } from './headlamp'
import { ShardMesh } from './ShardMesh'
import { TapTarget } from './TapTarget'
import { LABEL_PRIORITY, WorldLabel } from './WorldLabel'

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
 * Render units per model unit for a look: its true size, or larger, so its
 * longest side is never under `floorPx` on screen. `perPx` is the render
 * units one CSS pixel spans at its depth. Called every frame.
 */
export function lookScale(atTrue: number, longest: number, floorPx: number, perPx: number): number {
  if (!(longest > 0)) return atTrue
  return Math.max(atTrue, (floorPx * perPx) / longest)
}

interface Props {
  look: Look
  /** What is drawn now: the closed model, the open one, or nothing. */
  model: ShardModel | null
  /** The item's place in the render frame (itemCentre). */
  at: [number, number, number]
  axes: ViewAxes
  /** The edge of the note's cube on screen, CSS pixels: the smallest the look is ever drawn. */
  minPx: number
  label: { text: string; color: string; sub: string; subColor: string }
  onTap?: () => void
  /** How high above the origin, in the look's units, the label must clear: what floats over it (ChestLoot). */
  clearTop?: number
  /**
   * What else is drawn in the look's own frame, scaled and turned with it:
   * the model is the default, and a ceremony draws its own instead.
   */
  children?: (frame: { model: ShardModel | null }) => ReactNode
  /** Standing on the ground, by its payload's `up` and `spin` (lib/looks lookStand). */
  stand?: { at: Position; spin: number }
  /** Where a custom look is cut: its region's walls in its own frame (lib/clip regionBox). None for a built-in. */
  clip?: Box
}

/** A chest or a door as its look, sized, turned with the view, labelled and tappable. */
export function LookMark({ look, model, at, axes, minPx, label, onTap, clearTop = 0, children, clip, stand }: Props): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const turn = useMemo(() => renderPose(placedPose(axes, stand)), [axes, stand])
  const bounds = lookBounds(look.closed)
  const atTrue = useMemo(() => trueScale(look.closed.unit, scaleExp), [look.closed.unit, scaleExp])
  // The label clears the look from any side at the scale it is drawn at
  // (WorldLabel `clear`, the rule ItemModel follows): the farthest corner of
  // its bounds from the origin, at true size and at the floor alike.
  const clear = useMemo(() => {
    const reach = Math.max(bounds.reach, clearTop)
    return {
      trueSide: (reach * atTrue) / CUBE_REACH,
      minPx: bounds.longest > 0 ? (reach * minPx) / bounds.longest / CUBE_REACH : minPx,
    }
  }, [bounds, atTrue, minPx, clearTop])
  const outer = useRef<Group>(null)
  const drawn = useRef<Group | null>(null)
  useFrame((state) => {
    const g = outer.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    const depth = cam.position.distanceTo(g.position)
    const perPx = (2 * Math.tan((cam.fov * Math.PI) / 360) * depth) / state.size.height
    const floorPx = minPx * recedeShare(depth, headlampUniforms.uHeadlampReach.value, MARK_RECEDE_FLOOR)
    g.scale.setScalar(Math.max(1e-9, lookScale(atTrue, bounds.longest, floorPx, perPx)))
  }, LABEL_PRIORITY)
  return (
    <>
      <group ref={outer} position={at}>
        <group matrix={turn} matrixAutoUpdate={false}>
          <group ref={drawn}>
            {children ? children({ model }) : model && <ShardMesh shard={model} world clip={clip} />}
          </group>
        </group>
      </group>
      {/* Outside the scaled group: a target and a label size themselves from the camera. */}
      {onTap && <group position={at}><TapTarget measure={drawn} onTap={onTap} /></group>}
      <WorldLabel text={label.text} color={label.color} at={at} align="center" px={13} sub={label.sub} subColor={label.subColor} clear={clear} recede="name" />
    </>
  )
}
