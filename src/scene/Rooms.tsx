/**
 * Rooms.tsx — the aligned-subtree lattice, drawn as the building you are in.
 *
 * Per §4.5 an aligned subtree of height h has base `(v >> h) << h` and owns 2^h
 * leaves per axis, so the blocks are fixed and universal: everyone standing in
 * one computes the same root without communicating. They are a property of the
 * SPACE, not of you.
 *
 * This used to draw only the nest containing the avatar, six boxes deep,
 * recomputed on every move. That was egocentric and it read wrong: the boxes
 * looked attached to you, so moving felt like the rooms teleported rather than
 * like you walked into the next one. Worse, it hid the structure that generates
 * them. A cube is three per-axis rulers crossing, and everything you actually
 * want to know (which way is cheap, what leaving costs) lives in the rulers.
 *
 * So the lattice is drawn instead, at two heights, across the whole view whether
 * or not you are inside any given cell. Nothing appears or vanishes when you
 * move. You are simply in a different cell of a grid that was already there.
 *
 * Two heights rather than six because wall density halves with each height, so
 * the fine grid carries the texture and the coarse one carries the structure.
 * Both are measured from the scale floor: at scaleExp s the cheapest possible
 * crossing is already height s+1, so anything below that is sub-cell and cannot
 * be drawn. That is what `boundaryIntensity(height, floor)` was written for.
 */

import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { GRID_RADIUS, stepFor, type AxisDirection, type ViewAxes } from '../lib/space'
import { ACCENT, WARN, boundaryColor, boundaryIntensity } from '../lib/palette'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import type { Position } from '../lib/space'

/**
 * Heights drawn, as an excess above the current scale floor.
 *
 * 3 gives cells 8 wide and 5 gives cells 32 wide, so across the drawn extent
 * you see roughly six fine cells and two coarse ones per axis. Enough to read
 * as a grid, few enough not to streak.
 */
const FINE = 3
const COARSE = 5

/** Half-extent of the lattice, in cells. */
const EXTENT = GRID_RADIUS

/** The cell containing the cursor is lit, so you can see the room you would land in. */
const CURSOR_ROOM_HEIGHT = FINE

interface Props {
  axes: ViewAxes
}

/**
 * Offsets, in cells, of every height-h lattice plane crossing the drawn extent.
 *
 * The planes sit at world multiples of 2^h. Both those and the render origin are
 * multiples of the cell step, so the division is exact and the offsets land on
 * whole cells.
 */
function latticeOffsets(
  origin: bigint, scaleExp: number, height: number, extent: number,
): number[] {
  const step = stepFor(scaleExp)
  const h = BigInt(height)
  const span = BigInt(extent) * step
  // Arithmetic shift floors, which is what aligning down means for negatives too.
  let base = ((origin - span) >> h) << h
  const stride = 1n << h

  const out: number[] = []
  for (;;) {
    const offset = Number((base - origin) / step)
    if (offset > extent) break
    if (offset >= -extent) out.push(offset)
    base += stride
  }
  return out
}

/** A 3D grid of lines at the given lattice offsets, as one merged geometry. */
function gridGeometry(
  right: number[], up: number[], out: number[], axes: ViewAxes, extent: number,
): BufferGeometry {
  const v: number[] = []
  const dir = (a: AxisDirection, n: number): number => n * a.dir
  const lo = -extent
  const hi = extent

  for (const u of up) {
    for (const o of out) {
      v.push(dir(axes.right, lo), dir(axes.up, u), dir(axes.out, o))
      v.push(dir(axes.right, hi), dir(axes.up, u), dir(axes.out, o))
    }
  }
  for (const r of right) {
    for (const o of out) {
      v.push(dir(axes.right, r), dir(axes.up, lo), dir(axes.out, o))
      v.push(dir(axes.right, r), dir(axes.up, hi), dir(axes.out, o))
    }
  }
  for (const r of right) {
    for (const u of up) {
      v.push(dir(axes.right, r), dir(axes.up, u), dir(axes.out, lo))
      v.push(dir(axes.right, r), dir(axes.up, u), dir(axes.out, hi))
    }
  }

  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(v, 3))
  return geom
}

/** Edges of the height-h cell containing `p`, in render space. */
function cellBoxGeometry(
  p: Position, origin: Position, scaleExp: number, height: number, axes: ViewAxes,
): BufferGeometry {
  const step = stepFor(scaleExp)
  const h = BigInt(height)
  const size = Number((1n << h) / step)

  const centre: [number, number, number] = [0, 0, 0]
  const screen = [axes.right, axes.up, axes.out]
  for (let s = 0; s < 3; s++) {
    const axis = screen[s].axis
    const base = (p[axis] >> h) << h
    const lo = Number((base - origin[axis]) / step)
    centre[s] = (lo + (size - 1) / 2) * screen[s].dir
  }

  const half = size / 2
  const c = centre
  const corner = (sx: number, sy: number, sz: number): [number, number, number] =>
    [c[0] + sx * half, c[1] + sy * half, c[2] + sz * half]

  const v: number[] = []
  const edge = (a: [number, number, number], b: [number, number, number]): void => {
    v.push(...a, ...b)
  }
  for (const sz of [-1, 1]) {
    for (const sy of [-1, 1]) edge(corner(-1, sy, sz), corner(1, sy, sz))
    for (const sx of [-1, 1]) edge(corner(sx, -1, sz), corner(sx, 1, sz))
  }
  for (const sy of [-1, 1]) {
    for (const sx of [-1, 1]) edge(corner(sx, sy, -1), corner(sx, sy, 1))
  }

  const geom = new BufferGeometry()
  geom.setAttribute('position', new Float32BufferAttribute(v, 3))
  return geom
}

export function Rooms({ axes }: Props): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const levels = useMemo(() => {
    const origin = alignedOrigin(position, scaleExp)
    return [FINE, COARSE].map((d) => {
      const height = scaleExp + d
      const offs = (a: AxisDirection): number[] =>
        latticeOffsets(origin[a.axis], scaleExp, height, EXTENT)
      return {
        height,
        geometry: gridGeometry(
          offs(axes.right), offs(axes.up), offs(axes.out), axes, EXTENT,
        ),
        color: `#${boundaryColor(height).getHexString()}`,
        // The lattice is background structure, so it stays well under the
        // opacity of anything you are meant to look at.
        opacity: 0.75 * boundaryIntensity(height, scaleExp + 1),
      }
    })
  }, [position, scaleExp, axes])

  // The two cells that answer "where am I" and "where would I land". Without
  // these the lattice is honest but anonymous: every cell looks like every
  // other one, and the whole point of a room is knowing you are in it.
  const rooms = useMemo(() => {
    const origin = alignedOrigin(position, scaleExp)
    const height = scaleExp + CURSOR_ROOM_HEIGHT
    const here = cellBoxGeometry(position, origin, scaleExp, height, axes)
    const sameRoom = [axes.right, axes.up, axes.out].every(
      (a) => (position[a.axis] >> BigInt(height)) === (cursor[a.axis] >> BigInt(height)),
    )
    return {
      here,
      there: sameRoom ? null : cellBoxGeometry(cursor, origin, scaleExp, height, axes),
    }
  }, [position, cursor, scaleExp, axes])

  return (
    <group>
      {levels.map((l) => (
        <lineSegments key={l.height} geometry={l.geometry} frustumCulled={false}>
          <lineBasicMaterial color={l.color} toneMapped={false} transparent opacity={l.opacity} />
        </lineSegments>
      ))}

      {/* The room you are standing in. */}
      <lineSegments geometry={rooms.here} frustumCulled={false}>
        <lineBasicMaterial color={ACCENT} toneMapped={false} transparent opacity={0.5} />
      </lineSegments>

      {/* The room the cursor would land in, when it is a different one. */}
      {rooms.there && (
        <lineSegments geometry={rooms.there} frustumCulled={false}>
          <lineBasicMaterial color={WARN} toneMapped={false} transparent opacity={0.55} />
        </lineSegments>
      )}
    </group>
  )
}
