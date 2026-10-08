/**
 * StepBox.tsx - where inside the build cursor's cube a placement snaps.
 *
 * While a deploy is lined up with the build STEP finer than the zoom
 * (store/buildStep.ts), the placement snaps to the center of a 2^STEP cell
 * inside the zoom-sized white cube (space.ts deployPoint), not to the cube's
 * center. This draws that cell as a small white box, at the exact place the
 * ghost sits, so lowering STEP visibly shrinks the box and each move visibly
 * steps it while the camera stays where it is. When the bag's region is
 * smaller than the STEP cell the item snaps to the region's center instead,
 * and the box is the region, as deployPoint has it.
 *
 * Below a twenty-fifth of the cube the true size would be invisible, so it is
 * drawn at that size, centered on the same point: at 2^0 inside 2^15 it marks
 * the gibson rather than measuring it. At the zoom there is nothing to draw:
 * the snap cell is the cube itself.
 */

import { useMemo } from 'react'
import { BoxGeometry, EdgesGeometry } from 'three'
import { alignTo, cellDelta, type ViewAxes } from '../lib/space'
import { buildStepOf } from '../lib/buildCursor'
import { BUILD } from '../lib/palette'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useShards } from '../store/useShards'

/** The smallest side drawn, in cells of the zoom. */
const MIN_SIDE = 0.04

interface Props {
  axes: ViewAxes
}

export function StepBox({ axes }: Props): JSX.Element | null {
  const pending = useShards((s) => s.pending !== null)
  const height = useShards((s) => s.deployHeight)
  const step = useCyberspace(buildStepOf)
  const cursor = useCyberspace((s) => s.cursor)
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const geometry = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])

  const box = useMemo(() => {
    if (!pending || step >= scaleExp) return null
    // The cell deployPoint centers the item in.
    const k = Math.max(0, Math.min(step, height))
    const side = 1 / Number(1n << BigInt(scaleExp - k))
    const origin = alignedOrigin(anchor, scaleExp)
    // A cell drawn at index i spans [i - 0.5, i + 0.5]: one starting `lo`
    // cells from the origin and `side` cells wide is centered at
    // lo + (side - 1) / 2.
    const centre = [axes.right, axes.up, axes.out].map(
      (a) => (cellDelta(alignTo(cursor[a.axis], k), origin[a.axis], scaleExp) + (side - 1) / 2) * a.dir + 0,
    ) as [number, number, number]
    return { centre, side: Math.max(side, MIN_SIDE) }
  }, [pending, step, height, cursor, anchor, scaleExp, axes])

  if (!box) return null

  return (
    <lineSegments name="step-cell" geometry={geometry} position={box.centre} scale={box.side} frustumCulled={false} renderOrder={11}>
      <lineBasicMaterial color={BUILD} toneMapped={false} transparent opacity={0.95} depthTest={false} />
    </lineSegments>
  )
}
