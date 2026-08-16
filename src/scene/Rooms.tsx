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
import { formatOps, stepFor, type AxisDirection, type ViewAxes } from '../lib/space'
import { subtreeCantorOps } from 'cyberspace-core'
import { LATTICE } from '../lib/palette'

import { WorldLabel } from './WorldLabel'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

/**
 * The heights drawn, as an excess above the current scale floor, and how many
 * lattice cells either side of the one you occupy each of them reaches.
 *
 * `span` is how many lattice cells either side of the one you occupy a level
 * reaches. Both are 0, so each level draws exactly the cell you are standing in
 * and the two nest: the room, and the room that room is in.
 *
 * It has come down twice. The lattice first ran the full width of the view at
 * both heights, 147 lines each 48 cells long, which under perspective turns into
 * a web of diagonal streaks rather than a building. Bounding the fine level to
 * its immediate neighbours cut that to 60 segments, but 27 cells of grid still
 * competes with the two things that matter, the cell you are in and the box you
 * are about to pay for. Now 24 segments and 480 cells of ink, against 7056 at
 * the start.
 *
 * The cost of drawing only the containing cell is that it jumps to the adjacent
 * one when you cross a boundary, which is the egocentric reading this moved away
 * from. That is survivable now in a way it was not before: the crossing flash
 * marks the moment, the covering box shows the move ahead of time, and the
 * avatar visibly travels, so a box changing is explained by three other things
 * on screen rather than being an unexplained jump.
 */
const LEVELS: Array<{ d: number; span: number; opacity: number }> = [
  { d: 3, span: 0, opacity: 0.26 },
  { d: 5, span: 0, opacity: 0.34 },
]

interface Props {
  axes: ViewAxes
}

/**
 * Offsets, in cells, of the lattice planes bounding a neighbourhood of cells
 * around `here`.
 *
 * The planes sit at world multiples of 2^h. Both those and the render origin are
 * multiples of the cell step, so the division is exact and offsets land on whole
 * cells.
 */
function latticeOffsets(
  here: bigint, origin: bigint, scaleExp: number, height: number, span: number,
): number[] {
  const step = stepFor(scaleExp)
  const h = BigInt(height)
  const stride = 1n << h
  const base = (here >> h) << h

  const out: number[] = []
  for (let k = -span; k <= span + 1; k++) {
    out.push(Number((base + BigInt(k) * stride - origin) / step))
  }
  return out
}

/**
 * A 3D grid of lines at the given lattice offsets, as one merged geometry.
 *
 * Each line runs only between the first and last plane of its own axis, so the
 * whole thing is a closed block of cells rather than an infinite grid.
 */
function gridGeometry(
  right: number[], up: number[], out: number[], axes: ViewAxes,
): BufferGeometry {
  const v: number[] = []
  const dir = (a: AxisDirection, n: number): number => n * a.dir
  const span = (arr: number[]): [number, number] => [arr[0], arr[arr.length - 1]]

  const [r0, r1] = span(right)
  const [u0, u1] = span(up)
  const [o0, o1] = span(out)

  for (const u of up) {
    for (const o of out) {
      v.push(dir(axes.right, r0), dir(axes.up, u), dir(axes.out, o))
      v.push(dir(axes.right, r1), dir(axes.up, u), dir(axes.out, o))
    }
  }
  for (const r of right) {
    for (const o of out) {
      v.push(dir(axes.right, r), dir(axes.up, u0), dir(axes.out, o))
      v.push(dir(axes.right, r), dir(axes.up, u1), dir(axes.out, o))
    }
  }
  for (const r of right) {
    for (const u of up) {
      v.push(dir(axes.right, r), dir(axes.up, u), dir(axes.out, o0))
      v.push(dir(axes.right, r), dir(axes.up, u), dir(axes.out, o1))
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
    return LEVELS.map(({ d, span, opacity }) => {
      const height = scaleExp + d
      const offs = (a: AxisDirection): number[] =>
        latticeOffsets(position[a.axis], origin[a.axis], scaleExp, height, span)
      return {
        height,
        geometry: gridGeometry(offs(axes.right), offs(axes.up), offs(axes.out), axes),
        // One fixed hue for both heights, separated by weight alone. They are
        // the same kind of thing at two resolutions, so they should read that
        // way; the height is stated in the label rather than in the colour.
        opacity,
        // Named, once, on the cell holding the avatar. An 8-cell box is
        // meaningless until you know it is a height-27 wall costing 134M to
        // cross, and that number changes with zoom while the box does not.
        // What it costs to LEAVE this cell, on one axis, at the cheapest wall.
        //
        // This used to quote subtreeCantorOps(height), which is a different
        // quantity entirely: the priciest move that stays INSIDE the cell. You
        // cannot leave a height-h box without an LCA height above h, since two
        // positions share that box exactly when their crossing height is h or
        // less, so the floor to get out is subtreeCantorOps(h + 1). For the fine
        // grid the label read 7 when the real minimum is 15.
        //
        // A floor rather than a figure, because walls are not all the same
        // height. Every boundary of the height-3 lattice is at least height 4,
        // but the one at a multiple of 128 is height 8, and the ruler of
        // nested walls means a cell's six faces can each cost differently.
        label: `h${height} cell\n${formatOps(subtreeCantorOps(height + 1))}+ ops to leave`,
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
