/**
 * DeployRegionBox.tsx — the area a hidden thing can be found from.
 *
 * While deploying, a green box marks the aligned 2^height cube the cursor sits
 * in: the region whose key opens the content (spec §7). It grows and shrinks by
 * powers of two as you change the height, so you can see how far away someone
 * could be and still find it. At height 0 it is a single gibson; each step up
 * doubles each side. Drawn from the cursor, so it moves as you aim.
 *
 * A region too big for the view used to vanish, and with it the one reference
 * the height has (arkinox, 2026-10-16). It is drawn clipped instead, the way
 * the move box is (CoveringBox): the part of the region within MAX_CELLS of
 * the cursor (12 cells either side), with ZOOM OUT walls breathing outward on each face the region
 * continues through (ClipWalls). A face that is the region's own stays still.
 *
 * Its walls carry the WALK grid (Rooms.tsx): the same shader, the same slow
 * breath, in the region's green, at the pitch WALK gives a wall of that
 * height, so the box reads as a volume you are placing into rather than one
 * more outline among the lattice's.
 *
 * Not drawn for a shard being aimed into a chest (useShards `intoChest`): the
 * content has no region of its own, only the chest's, and a box here would
 * promise one (arkinox, 2026-10-10).
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, EdgesGeometry, type Mesh } from 'three'
import { alignTo, cellDelta, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'
import { ClipWalls, type ClipFace } from './ClipWalls'
import { UNIT_BOX, WALL_RENDER_ORDER, gridMaterial, setGrid, tickWallClock } from './Rooms'

/** The green of "found here", the same as the LIVE tag. */
const REGION = '#52e39f'

/**
 * The widest the box is drawn, in cells: past it the region is clipped to
 * this many cells around the cursor. Tighter than the move box's (GRID_RADIUS
 * * 3), whose bracket spans two points: this one is centred on the cursor,
 * and at 72 cells the orbiting camera sat inside it with a breathing wall on
 * every side. At 25 the camera stays outside at the usual orbit.
 */
const MAX_CELLS = 25

/** The grid's ceiling on the box's walls: a little under WALK's own walls, since the box is drawn over the scene you are aiming in. */
const GRID_OPACITY = 0.12

interface Props {
  axes: ViewAxes
}

/** The drawn box: its centre and extent in render cells, the faces it is clipped at, and the height it stands for. */
export interface DrawnRegion {
  centre: [number, number, number]
  size: [number, number, number]
  faces: ClipFace[]
  /** Whole cells across on every axis: false for a region smaller than a cell, which gets no grid. */
  whole: boolean
}

/**
 * The region of height `height` holding `cursor`, as drawn in the render
 * frame anchored at `origin` at zoom `scaleExp`: whole when it is at most
 * `maxCells` across, else the part of it within `maxCells / 2` cells of the
 * cursor on each axis, with the faces it was cut at. Null when it is too
 * small to see.
 */
export function drawnRegion(
  cursor: { x: bigint; y: bigint; z: bigint }, origin: { x: bigint; y: bigint; z: bigint },
  height: number, scaleExp: number, axes: ViewAxes, maxCells: number,
): DrawnRegion | null {
  const exp = height - scaleExp
  const centre: [number, number, number] = [0, 0, 0]
  const size: [number, number, number] = [1, 1, 1]
  const faces: ClipFace[] = []
  const h = BigInt(height)
  const slots = [axes.right, axes.up, axes.out]
  if (exp < 0) {
    // Smaller than a cell: a fraction of the cursor cube, placed in it.
    const side = 1 / Number(1n << BigInt(-exp))
    if (side < 0.02) return null
    slots.forEach((a, i) => {
      const base = (cursor[a.axis] >> h) << h
      const lo = cellDelta(base, origin[a.axis], scaleExp)
      centre[i] = (lo + (side - 1) / 2) * a.dir
      size[i] = side
    })
    return { centre, size, faces, whole: false }
  }
  const side = Number(1n << BigInt(exp))
  const half = Math.floor(maxCells / 2)
  slots.forEach((a, i) => {
    const base = (cursor[a.axis] >> h) << h
    // The region's first and last cell, by index from the render origin,
    // each from its own bigint: `lo + side - 1` in floats cancels once the
    // region is 2^56 cells or more, and cut the box short of a cursor near
    // its top (review of #369).
    const lo = cellDelta(base, origin[a.axis], scaleExp)
    const hi = cellDelta(base + (1n << h) - (1n << BigInt(scaleExp)), origin[a.axis], scaleExp)
    let from = lo
    let to = hi
    if (side > maxCells) {
      const c = cellDelta(alignTo(cursor[a.axis], scaleExp), origin[a.axis], scaleExp)
      from = Math.max(lo, c - half)
      to = Math.min(hi, c + half)
      // In render space the low world side is the -dir side.
      if (lo < c - half) faces.push({ slot: i as 0 | 1 | 2, sign: a.dir > 0 ? -1 : 1 })
      if (hi > c + half) faces.push({ slot: i as 0 | 1 | 2, sign: a.dir > 0 ? 1 : -1 })
    }
    centre[i] = ((from + to) / 2) * a.dir
    size[i] = to - from + 1
  })
  return { centre, size, faces, whole: true }
}

export function DeployRegionBox({ axes }: Props): JSX.Element | null {
  const pending = useShards((s) => s.pending)
  const height = useShards((s) => s.deployHeight)
  const cursor = useCyberspace((s) => s.cursor)
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const box = useMemo(() => {
    if (!pending || (pending.type === 'shard' && pending.intoChest)) return null
    return drawnRegion(cursor, alignedOrigin(anchor, scaleExp), height, scaleExp, axes, MAX_CELLS)
  }, [pending, height, cursor, anchor, scaleExp, axes])

  // The grid on its walls: one material while a deploy is up, its numbers
  // written in place as the box moves (as Rooms keeps its walls' materials).
  const showing = box !== null
  const material = useMemo(() => (showing ? gridMaterial() : null), [showing])
  useEffect(() => () => material?.dispose(), [material])
  const walls = useRef<Mesh>(null)
  useLayoutEffect(() => {
    const mesh = walls.current
    if (!box || !material || !mesh) return
    mesh.scale.set(box.size[0], box.size[1], box.size[2])
    mesh.position.set(box.centre[0], box.centre[1], box.centre[2])
    const corner: [number, number, number] = [0, 1, 2].map((i) => box.centre[i] - box.size[i] / 2) as [number, number, number]
    setGrid(material, REGION, GRID_OPACITY, height, corner)
  }, [box, material, height])
  useFrame(() => { if (material) tickWallClock() })

  if (!box) return null

  return (
    <group>
      <lineSegments geometry={geometry} position={box.centre} scale={box.size} frustumCulled={false} renderOrder={9}>
        <lineBasicMaterial color={REGION} toneMapped={false} transparent opacity={box.faces.length > 0 ? 0.5 : 0.85} depthTest={false} />
      </lineSegments>
      {material && box.whole && (
        <mesh ref={walls} geometry={UNIT_BOX} material={material} frustumCulled={false} renderOrder={WALL_RENDER_ORDER} />
      )}
      <ClipWalls centre={box.centre} size={box.size} faces={box.faces} color={REGION} hideNear />
    </group>
  )
}
