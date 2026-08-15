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
import { GRID_RADIUS, formatOps, type ViewAxes } from '../lib/space'
import { estimateHopCost } from 'cyberspace-core'
import { boxEdges, coveringBox } from '../lib/covering'
import { boundaryColor } from '../lib/palette'
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
    return {
      geometry: boxEdges(c.centre, c.size),
      color: `#${boundaryColor(c.peak).getHexString()}`,
      // The panel's figure, not a second opinion on it. estimateHopCost also
      // counts the terrain tree, which is real work and would otherwise make
      // the label quietly under-report every move.
      label: `h${c.peak}  ${formatOps(estimateHopCost(
        position.x, position.y, position.z,
        target.x, target.y, target.z,
        plane, MAX_COMPUTE_HEIGHT,
      ).totalOps)}`,
      // Top corner, so the text clears the box rather than sitting inside it.
      at: [
        c.centre[0] + c.size[0] / 2,
        c.centre[1] + c.size[1] / 2,
        c.centre[2],
      ] as [number, number, number],
    }
  }, [position, target, scaleExp, plane, axes])

  if (!box) return null

  return (
    <group>
      <lineSegments geometry={box.geometry} frustumCulled={false}>
        <lineBasicMaterial color={box.color} toneMapped={false} transparent opacity={0.5} />
      </lineSegments>
      <WorldLabel text={box.label} color={box.color} at={box.at} offset={[0.4, 0.4, 0]} px={13} />
    </group>
  )
}
