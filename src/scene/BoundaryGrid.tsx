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
import type { ViewWindow } from '../hooks/useViewWindow'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'

const EXTENT = GRID_RADIUS + 0.5

interface Props {
  axes: ViewAxes
  /** Visible window centre, so the lines follow the camera pan. */
  win: ViewWindow
}

export function BoundaryGrid({ axes, win }: Props): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const ref = useRef<LineSegments>(null)
  const geometry = useMemo(() => new BufferGeometry(), [])

  useLayoutEffect(() => {
    const origin: Position = alignedOrigin(position, scaleExp)
    const step = stepFor(scaleExp)

    const vertices: number[] = []
    const colors: number[] = []

    const pushLine = (
      ax: number, ay: number,
      bx: number, by: number,
      height: number,
    ) => {
      const color = boundaryColor(height)
      vertices.push(ax, ay, 0, bx, by, 0)
      colors.push(color.r, color.g, color.b, color.r, color.g, color.b)
    }

    // Indices are offset by the window centre so the lattice covers whatever
    // the camera is looking at, not just the cells around the avatar.
    for (let i = -GRID_RADIUS; i <= GRID_RADIUS + 1; i++) {
      // Boundaries perpendicular to the screen-right axis (vertical lines).
      const iR = i + win.right
      const localR = iR - 0.5
      const cx = boundaryCoord(origin[axes.right.axis], iR, step, axes.right.dir)
      pushLine(localR, win.up - EXTENT, localR, win.up + EXTENT, boundaryHeight(cx, scaleExp))

      // Boundaries perpendicular to the screen-up axis (horizontal lines).
      const iU = i + win.up
      const localU = iU - 0.5
      const cy = boundaryCoord(origin[axes.up.axis], iU, step, axes.up.dir)
      pushLine(win.right - EXTENT, localU, win.right + EXTENT, localU, boundaryHeight(cy, scaleExp))
    }

    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.color.needsUpdate = true
  }, [position, scaleExp, axes, win.right, win.up, geometry])

  return (
    <lineSegments ref={ref} geometry={geometry} frustumCulled={false} position={[0, 0, 0.01]}>
      <lineBasicMaterial vertexColors toneMapped={false} transparent opacity={0.95} linewidth={3} />
    </lineSegments>
  )
}
