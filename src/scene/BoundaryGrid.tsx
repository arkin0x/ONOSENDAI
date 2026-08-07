/**
 * BoundaryGrid.tsx — LCA boundaries, the centrepiece of the visualization.
 *
 * Movement cost is O(2^h) where h is the LCA height of the crossing. Crucially
 * h is not distance: stepping 7 -> 8 costs height 4 while 8 -> 9 costs height 1,
 * for the same single gibson. Every gridline here is lit in proportion to what
 * crossing it actually costs, so the expensive walls in the terrain are visible
 * before you walk into them.
 *
 * Lines are rendered thicker (width 3) for better visibility.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { BufferGeometry, Float32BufferAttribute, LineSegments } from 'three'
import {
  GRID_RADIUS,
  boundaryCoord,
  boundaryHeight,
  stepFor,
  type Position,
  type ViewAxes,
} from '../lib/space'
import { boundaryColor } from '../lib/palette'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

const EXTENT = GRID_RADIUS + 0.5

interface Props {
  axes: ViewAxes
}

export function BoundaryGrid({ axes }: Props): JSX.Element {
  const viewCenter = useCyberspace((s) => s.viewCenter())
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const ref = useRef<LineSegments>(null)
  const geometry = useMemo(() => new BufferGeometry(), [])

  useLayoutEffect(() => {
    const origin: Position = alignedOrigin(viewCenter, scaleExp)
    const step = stepFor(scaleExp)
    // The cheapest possible crossing at this scale, used as the dark floor.
    const floor = scaleExp + 1

    const vertices: number[] = []
    const colors: number[] = []

    const pushLine = (
      ax: number, ay: number,
      bx: number, by: number,
      height: number,
    ) => {
      const excess = Math.max(0, height - floor)
      const color = boundaryColor(excess)
      vertices.push(ax, ay, 0, bx, by, 0)
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    }

    for (let i = -GRID_RADIUS; i <= GRID_RADIUS + 1; i++) {
      const local = i - 0.5

      // Boundaries perpendicular to the screen-right axis (vertical lines).
      const cx = boundaryCoord(origin[axes.right.axis], i, step, axes.right.dir)
      pushLine(local, -EXTENT, local, EXTENT, boundaryHeight(cx, scaleExp))

      // Boundaries perpendicular to the screen-up axis (horizontal lines).
      const cy = boundaryCoord(origin[axes.up.axis], i, step, axes.up.dir)
      pushLine(-EXTENT, local, EXTENT, local, boundaryHeight(cy, scaleExp))
    }

    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
  }, [viewCenter, scaleExp, axes, geometry])

  return (
    <lineSegments ref={ref} geometry={geometry} frustumCulled={false} position={[0, 0, 0.01]}>
      <lineBasicMaterial vertexColors toneMapped={false} transparent opacity={0.95} linewidth={3} />
    </lineSegments>
  )
}
