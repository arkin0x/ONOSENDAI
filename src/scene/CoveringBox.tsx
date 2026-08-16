/**
 * CoveringBox.tsx — the box you would pay for, drawn before you pay for it.
 *
 * The smallest aligned box containing both the avatar and the cursor is exactly
 * the region the proof would cover, and its size is exactly the work: 2^h leaves
 * per axis (§4.5, §4.7). So it is the one box on screen that answers "what does
 * this move cost", and it answers it in the only unit that matters, which is
 * how much of the space you have to reach around to make the move at all.
 *
 * It replaces two fixed-height room highlights that marked where the avatar and
 * the cursor each sat. Those were drawn at scaleExp+3 for no reason beyond it
 * being a convenient size, so they named nothing in particular. This box is
 * chosen by the two positions rather than by a constant, which means it grows
 * the instant you line up an expensive crossing and stays tight when you do not.
 *
 * The same box flashes on commit (see CrossingFlash), so the thing you were
 * shown and the thing you paid for are visibly the same object.
 */

import { useMemo } from 'react'
import { BoxGeometry, FrontSide } from 'three'
import { GRID_RADIUS, formatOps, type ViewAxes } from '../lib/space'
import { estimateHopCost } from 'cyberspace-core'
import { boxEdges, coveringBox } from '../lib/covering'
import { ACCENT, DANGER } from '../lib/palette'
import { MAX_COMPUTE_HEIGHT, alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { WorldLabel } from './WorldLabel'

/** Clamp on the drawn extent; the reported cost is never clamped. */
const MAX_CELLS = GRID_RADIUS * 3

interface Props {
  axes: ViewAxes
}

export function CoveringBox({ axes }: Props): JSX.Element | null {
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const pendingTarget = useCyberspace((s) => s.pendingTarget)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.plane)

  const target = pendingTarget ?? cursor

  const box = useMemo(() => {
    const origin = alignedOrigin(position, scaleExp)
    const c = coveringBox(position, target, origin, scaleExp, axes, MAX_CELLS)
    // Nothing is being crossed while the cursor sits on the avatar, and a box
    // around a single cell would just be a duplicate of the cursor outline.
    if (c.degenerate) return null
    const est = estimateHopCost(
      position.x, position.y, position.z,
      target.x, target.y, target.z,
      plane, MAX_COMPUTE_HEIGHT,
    )
    return {
      geometry: boxEdges(c.centre, c.size),
      // Filled as well as outlined. The covering box IS an aligned subtree, so
      // against a lattice of aligned subtrees it was one more wireframe box
      // among wireframe boxes, and at some heights it lands exactly on a lattice
      // cell and competes with it outright. A volume and a grid are different
      // KINDS of mark, which the eye separates without being told; two
      // wireframes only differ once you have decoded their colours.
      fill: new BoxGeometry(c.size[0], c.size[1], c.size[2]),
      centre: c.centre,
      // Faint in proportion to how big it is. A covering box grows by powers of
      // two, so an expensive crossing is tens of cells across and a fill tuned
      // for a small one turns the screen into a wash. The outline carries the
      // extent at any size; the fill only has to say "this is a volume".
      fillOpacity: Math.max(0.02, Math.min(0.09, 0.09 * (8 / Math.max(...c.size)))),
      // Cyan, not a point on the LCA ramp. This box is the live readout of what
      // you are lining up, and it has to be told apart from the lattice at a
      // glance rather than decoded: with both on the ramp, a cheap move drew a
      // violet box inside a violet grid. Red when the crossing is past what this
      // machine will compute, which is the one distinction worth a hue change.
      color: est.exceedsLimit ? DANGER : ACCENT,
      // The panel's figure, not a second opinion on it. estimateHopCost also
      // counts the terrain tree, which is real work and would otherwise make
      // the label quietly under-report every move.
      // All three heights, not just the largest. The box is dimensioned by one
      // height per axis, which is exactly why it draws a slab rather than a cube
      // when they differ, so quoting only the peak describes a shape that is not
      // on screen. Reported as X / Y / Z to match the panel rather than in
      // screen order, which changes under rotation.
      label: `h ${est.lcaX}/${est.lcaY}/${est.lcaZ}\n${formatOps(est.totalOps)} cantor ops`,
      // Bottom corner. The cursor's own label hangs off its top right, and a
      // small covering box has its top right in exactly that spot, so the two
      // printed over each other. Opposite corners cannot collide however tight
      // the box gets.
      at: [
        c.centre[0] + c.size[0] / 2,
        c.centre[1] - c.size[1] / 2,
        c.centre[2],
      ] as [number, number, number],
    }
  }, [position, target, scaleExp, plane, axes])

  if (!box) return null

  return (
    <group>
      {/* Front faces only. A box wide enough to contain the camera would, with
          DoubleSide, render its interior across the entire frame: a two-gibson
          step that happens to cross a height-6 boundary covers 64 cells, and the
          camera orbits 26 back, so it sits inside. Culling back faces means the
          fill simply stops once you are within it, which is also when the
          outline and the lattice are doing the work anyway. */}
      <mesh geometry={box.fill} position={box.centre} frustumCulled={false}>
        <meshBasicMaterial
          color={box.color}
          toneMapped={false}
          transparent
          opacity={box.fillOpacity}
          side={FrontSide}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={box.geometry} frustumCulled={false}>
        <lineBasicMaterial color={box.color} toneMapped={false} transparent opacity={0.85} />
      </lineSegments>
      <WorldLabel text={box.label} color={box.color} at={box.at} offset={[0.4, -0.9, 0]} px={13} />
    </group>
  )
}
