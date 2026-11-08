/**
 * DoorRooms.tsx: the red cube (chest and door design, 4.4, R8).
 *
 * One outline per door of yours in view: its room, the aligned cube of its
 * height, so you can see where what you place is sealed to it. For you alone
 * and only in BUILD or DEPLOY: it is drawn from your own door rows, and only
 * while the Builder is on. A door being placed has one too, which follows its
 * height (4.2). A room too big for the view is drawn clipped, as the green
 * region box is (DeployRegionBox drawnRegion): about the door, or about you
 * while you stand in the room, so the walls near you are its real ones.
 *
 * Nesting shows as line count (R6): one line for a door at the top level, two
 * for a door sealed inside another door's room, three for the next, each an
 * outline just inside the last (roomLines).
 *
 * The clipped outline alone read as a small whole cube that grew as you
 * zoomed out (arkinox, 2026-11-08: "i need to have a sense of the door area's
 * size at any scale"). So a room is a space as well as an outline, in the
 * look the green box and the move box already have, only quieter:
 *
 * - its real faces carry the WALK grid (Rooms.tsx) in the room's red, fainter
 *   than the green box's, at the pitch WALK gives a wall of the room's height,
 *   and anchored to the room's own corner, so the lines hold still on the
 *   room while the clipped window slides with you;
 * - each face it was cut at breathes outward (ClipWalls), as a frame, not a
 *   fill, and with no words on it: the room goes on past here. A fill washed
 *   the whole view red from inside a big room, where every line of sight
 *   crosses a cut face (ClipWalls' comment).
 *
 * One grid per nest, not one per room: nested rooms share the same stretch
 * of screen, and grids stacked inside grids turn to moire. The grid goes on
 * the walls nearest you: the innermost room you stand in, and any room you
 * are not in whose every drawn room around it does hold you. From outside a
 * nest that is its outer shell, the size you would walk into; inside it, the
 * room around you and the rooms beside you in it. The rooms deeper in still
 * show as their outlines, double and triple. Side by side rooms each keep
 * theirs.
 */

import { useEffect, useLayoutEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, EdgesGeometry, MeshBasicMaterial, type BufferGeometry, type Material } from 'three'
import { deployPoint, type Position, type ViewAxes } from '../lib/space'
import { buildPlane, buildStepOf } from '../lib/buildCursor'
import type { OwnDoor } from '../lib/doors'
import { useBuilder } from '../store/useBuilder'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { doorDepth, effectiveDoorHeight, ownDoors, sealingDoor, useShards, type MyDeployment } from '../store/useShards'
import { ClipWalls, type ClipFace } from './ClipWalls'
import { drawnRegion, type DrawnRegion } from './DeployRegionBox'
import { GRID_SPAN_CELLS, UNIT_BOX, WALL_RENDER_ORDER, gridMaterial, setGrid, tickWallClock } from './Rooms'

/** The red of a lock. */
export const ROOM_RED = '#ff3b4e'
/** The widest a room is drawn, in cells, as the green box. */
const MAX_CELLS = 25
/** How far from the view's centre a room is still drawn, in cells. */
const REACH = 400

/**
 * The grid's ceiling on a room's real faces: under half the green deploy
 * box's (0.12). A room is a standing fact you build around, not the thing you
 * are aiming, and standing near a big room's corner its walls fill the view,
 * so they whisper. At 0.06 they read bold there under the bloom (2026-11-08).
 */
export const ROOM_GRID_OPACITY = 0.05

/**
 * A room's cut faces breathe as frames (ClipWalls `look`): the face's outline
 * sliding a cell outward and fading, at this peak, well under the room's own
 * outline (0.95). A filled wall, as the green and blue boxes have, is never
 * safe here: from inside a big room every line of sight crosses one.
 */
export const ROOM_WALL_LOOK = 'frame' as const
export const ROOM_WALL_OPACITY = 0.3

/** The words on a room's breathing walls: none (arkinox, 2026-11-08, no tag or label). */
export const ROOM_WALL_LABEL = null

/** Hides a face of the gridded box: a cut face, whose breathing wall stands there instead. */
const NO_FACE = new MeshBasicMaterial({ visible: false })

/**
 * Which rooms to outline: none outside BUILD and DEPLOY (R8), and only your
 * own doors, in the plane on show. Rows of one room are one outline.
 */
export function roomOutlines(mine: readonly MyDeployment[], me: string, building: boolean, plane: number): Array<OwnDoor & { depth: number }> {
  if (!building) return []
  // Rows of one room are one outline, as deep as the deepest of them.
  const rooms = new Map<string, OwnDoor & { depth: number }>()
  for (const d of ownDoors(mine, me)) {
    if (d.plane !== plane) continue
    const s = BigInt(d.height)
    const key = `${d.height}:${d.at.x >> s}:${d.at.y >> s}:${d.at.z >> s}`
    const depth = doorDepth(mine, mine.find((m) => m.eventId === d.eventId) ?? { eventId: d.eventId })
    const was = rooms.get(key)
    if (!was || depth > was.depth) rooms.set(key, { ...d, depth })
  }
  return [...rooms.values()]
}

/** The scales of a room's lines, one per level of depth, each just inside the last, so they read as double and triple lines. */
export function roomLines(depth: number): number[] {
  return Array.from({ length: Math.max(1, depth) }, (_, i) => 1 - i * 0.025)
}

/** A room to draw: the region of `height` holding `at`, with its nesting depth. */
export interface RoomSpec {
  key: string
  at: Position
  height: number
  depth: number
}

/**
 * Every room to draw: your doors' rooms and the one a door being placed
 * would have, or none while the Builder is off (R8).
 */
export function doorRooms(
  mine: readonly MyDeployment[], me: string, building: boolean, plane: number,
  placing: { at: Position; height: number; depth: number } | null,
): RoomSpec[] {
  if (!building) return []
  const out: RoomSpec[] = roomOutlines(mine, me, building, plane).map((d) => ({ key: d.eventId, at: d.at, height: d.height, depth: d.depth }))
  if (placing) out.push({ key: 'placing', ...placing })
  return out
}

/** Whether `p` stands in the room of `height` holding `at`. */
export function inRoom(p: Position, at: Position, height: number): boolean {
  const h = BigInt(height)
  return (p.x >> h) === (at.x >> h) && (p.y >> h) === (at.y >> h) && (p.z >> h) === (at.z >> h)
}

/** Whether room `a` lies strictly inside room `b`: lower, and in it. */
function nestsIn(a: RoomSpec, b: RoomSpec): boolean {
  return a.height < b.height && inRoom(a.at, b.at, b.height)
}

/** Whether `a` and `b` are one room. */
function sameRoom(a: RoomSpec, b: RoomSpec): boolean {
  return a.height === b.height && inRoom(a.at, b.at, b.height)
}

/**
 * The corner the grid of a room is measured from, in render cells: the
 * room's own low corner on each render axis, brought to within one grid pitch
 * of the origin. Lines at every pitch from here are lines at every pitch from
 * the room's real corner, so they hold still on the room however its drawn
 * window is clipped, and the room's real corner is never itself a float too
 * big to hold (a room can be 2^84 cells across). Exact: the pitch is
 * GRID_SPAN_CELLS / height cells, so the reduction is a BigInt remainder.
 */
export function gridCorner(at: Position, origin: Position, height: number, scaleExp: number, axes: ViewAxes): [number, number, number] {
  const h = BigInt(height)
  const per = BigInt(Math.max(1, height))
  const span = BigInt(GRID_SPAN_CELLS)
  const side = height >= scaleExp ? 1n << BigInt(height - scaleExp) : 0n
  return [axes.right, axes.up, axes.out].map((a) => {
    const base = (at[a.axis] >> h) << h
    // The room's first cell, counted from the render origin.
    const first = (base - origin[a.axis]) >> BigInt(scaleExp)
    // Its low corner in render space is the low face of its first cell, or,
    // on a flipped axis, the far face of its last.
    const n = a.dir > 0 ? first : -(first + side)
    const r = ((n * per) % span + span) % span
    return Number(r) / Number(per) - 0.5 * a.dir
  }) as [number, number, number]
}

/**
 * Which of the gridded box's six faces are the room's own, in UNIT_BOX's
 * material group order (+right, -right, +up, -up, +out, -out): every face but
 * the ones it was cut at.
 */
export function realFaces(faces: readonly ClipFace[]): boolean[] {
  const real = [true, true, true, true, true, true]
  for (const f of faces) real[f.slot * 2 + (f.sign > 0 ? 0 : 1)] = false
  return real
}

/** A room as drawn: its box, cut faces and depth, whether it carries the grid, and where the grid is measured from. */
export interface RoomBox extends DrawnRegion {
  key: string
  height: number
  depth: number
  /** Clipped about the viewer (true) rather than the door. */
  aboutViewer: boolean
  grid: boolean
  corner: [number, number, number]
}

/**
 * The rooms as drawn in the render frame anchored at `origin`, seen by a
 * viewer at `viewer`: each clipped about the viewer while the viewer stands
 * in it, else about its door; those too small or too far left out; the grid
 * on the walls nearest the viewer (see the file's comment).
 */
export function roomBoxes(rooms: readonly RoomSpec[], viewer: Position, origin: Position, scaleExp: number, axes: ViewAxes): RoomBox[] {
  const drawn: Array<{ spec: RoomSpec; region: DrawnRegion; inside: boolean }> = []
  for (const spec of rooms) {
    const inside = inRoom(viewer, spec.at, spec.height)
    const region = drawnRegion(spec.at, origin, spec.height, scaleExp, axes, MAX_CELLS, inside ? viewer : spec.at)
    if (region && Math.hypot(...region.centre) <= REACH) drawn.push({ spec, region, inside })
  }
  // The walls nearest you (see the file's comment). Only a room that can
  // carry a grid takes it from another: a room smaller than a cell has none.
  const gridded = drawn.filter((d) => d.region.whole)
  return drawn.map(({ spec, region, inside }, i) => {
    const repeat = drawn.slice(0, i).some((o) => sameRoom(o.spec, spec))
    const nearest = inside
      ? !gridded.some((o) => o.inside && nestsIn(o.spec, spec))
      : gridded.every((o) => !nestsIn(spec, o.spec) || o.inside)
    return {
      ...region,
      key: spec.key,
      height: spec.height,
      depth: spec.depth,
      aboutViewer: inside,
      grid: region.whole && !repeat && nearest,
      corner: gridCorner(spec.at, origin, spec.height, scaleExp, axes),
    }
  })
}

export function DoorRooms({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const building = useBuilder((s) => s.active)
  const mine = useShards((s) => s.mine)
  const me = useCyberspace((s) => s.identity.pubkey)
  const plane = useCyberspace(buildPlane)
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  // The viewer: the build cursor, which the camera follows (buildCursor.ts)
  // and the green box is clipped about.
  const cursor = useCyberspace((s) => s.cursor)
  const step = useCyberspace(buildStepOf)
  const height = useShards((s) => s.deployHeight)
  const chosenRoom = useShards((s) => s.deployDoorHeight)
  const leaveOut = useShards((s) => s.deployLeaveOut)
  const pending = useShards((s) => s.pending)
  // A door being placed: its cube follows the height (4.2).
  const placing = useShards((s) => (s.pending?.type === 'chest' && s.pending.door && !s.pending.move ? s.pending.spot?.at ?? true : null))
  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  const boxes = useMemo(() => {
    let place: { at: Position; height: number; depth: number } | null = null
    if (building && placing) {
      const at = placing === true ? deployPoint(cursor, step, height) : placing
      // Lower than a room of yours it would seal into: as deep as it will stand.
      const into = sealingDoor({ mine, pending, deployLeaveOut: leaveOut, deployDoorHeight: chosenRoom }, me, at, plane, height)
      const outer = into ? mine.find((m) => m.eventId === into.eventId) : undefined
      place = { at, height: effectiveDoorHeight(chosenRoom, height), depth: outer ? doorDepth(mine, outer) + 1 : 1 }
    }
    return roomBoxes(doorRooms(mine, me, building, plane, place), cursor, alignedOrigin(anchor, scaleExp), scaleExp, axes)
  }, [mine, me, building, plane, anchor, scaleExp, axes, placing, cursor, step, height, chosenRoom, leaveOut, pending])

  // The grids breathe on the walls' shared clock (Rooms.tsx).
  const anyGrid = boxes.some((b) => b.grid)
  useFrame(() => { if (anyGrid) tickWallClock() })

  if (boxes.length === 0) return null
  return (
    <group>
      {boxes.map((b) => <Room key={b.key} box={b} edges={geometry} />)}
    </group>
  )
}

/** One room: its outlines, its grid on its real faces, and its breathing cut faces. */
function Room({ box, edges }: { box: RoomBox; edges: BufferGeometry }): JSX.Element {
  // The same numbers come back on every cursor step for a room you are not
  // in; held by value, so its walls' planes are not rebuilt for nothing.
  const shapeKey = `${box.centre.join()}|${box.size.join()}|${box.faces.map((f) => `${f.slot}${f.sign}`).join()}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shape = useMemo(() => ({ centre: box.centre, size: box.size, faces: box.faces }), [shapeKey])

  // One grid material per room while it carries the grid, its numbers written
  // in place (as Rooms keeps its walls'); the shader program is shared.
  const material = useMemo(() => (box.grid ? gridMaterial() : null), [box.grid])
  useEffect(() => () => material?.dispose(), [material])
  const facesKey = realFaces(shape.faces).join()
  const materials = useMemo<Material[] | null>(
    () => (material ? realFaces(shape.faces).map((real) => (real ? material : NO_FACE)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [material, facesKey],
  )
  const [cx, cy, cz] = box.corner
  useLayoutEffect(() => {
    if (material) setGrid(material, ROOM_RED, ROOM_GRID_OPACITY, box.height, [cx, cy, cz])
  }, [material, box.height, cx, cy, cz])

  return (
    <group>
      {roomLines(box.depth).map((k, i) => (
        <lineSegments key={i} geometry={edges} position={shape.centre} scale={[shape.size[0] * k, shape.size[1] * k, shape.size[2] * k]} frustumCulled={false} renderOrder={9}>
          <lineBasicMaterial color={ROOM_RED} toneMapped={false} transparent opacity={0.95} depthTest={false} />
        </lineSegments>
      ))}
      {materials && (
        <mesh geometry={UNIT_BOX} material={materials} position={shape.centre} scale={shape.size} frustumCulled={false} renderOrder={WALL_RENDER_ORDER} />
      )}
      <ClipWalls centre={shape.centre} size={shape.size} faces={shape.faces} color={ROOM_RED} hideNear look={ROOM_WALL_LOOK} opacity={ROOM_WALL_OPACITY} label={ROOM_WALL_LABEL} />
    </group>
  )
}
