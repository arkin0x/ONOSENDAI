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
import { GRID_RADIUS, formatOps, stepFor, type AxisDirection, type ViewAxes } from '../lib/space'
import { subtreeCantorOps } from 'cyberspace-core'
import { LATTICE } from '../lib/palette'

import { WorldLabel } from './WorldLabel'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

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

export function Rooms({ axes }: Props): JSX.Element {
  const position = useCyberspace((s) => s.position)
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
        // One fixed hue for both heights, separated by weight alone. They are
        // the same kind of thing at two resolutions, so they should read that
        // way; the height is stated in the label rather than in the colour.
        opacity: d === FINE ? 0.11 : 0.3,
        // Named, once, on the cell holding the avatar. An 8-cell box is
        // meaningless until you know it is a height-27 wall costing 134M to
        // cross, and that number changes with zoom while the box does not.
        label: `h${height}  ${formatOps(subtreeCantorOps(height))}`,
        labelAt: [axes.right, axes.up, axes.out].map((a, i) => {
          const base = (position[a.axis] >> BigInt(height)) << BigInt(height)
          const lo = Number((base - origin[a.axis]) / stepFor(scaleExp))
          const cells = 2 ** d
          // Far top corner, so the two heights' labels never stack.
          return (lo + (i === 1 ? cells - 0.5 : cells / 2)) * a.dir
        }) as [number, number, number],
      }
    })
  }, [position, scaleExp, axes])

  return (
    <group>
      {levels.map((l) => (
        <group key={l.height}>
          <lineSegments geometry={l.geometry} frustumCulled={false}>
            <lineBasicMaterial color={LATTICE} toneMapped={false} transparent opacity={l.opacity} />
          </lineSegments>
          <WorldLabel text={l.label} color={LATTICE} at={l.labelAt} px={9} opacity={0.55} />
        </group>
      ))}

    </group>
  )
}
