/**
 * PathTrail.tsx - renders red lines connecting all committed positions.
 *
 * Shows the movement chain as a visible trail through cyberspace.
 * Each segment connects consecutive positions in the history array.
 */

import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { cellOffset, type ViewAxes } from '../lib/space'
import { alignedOrigin } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
  scaleExp: number
}

export function PathTrail({ axes, scaleExp }: Props): JSX.Element | null {
  const positionHistory = useCyberspace((s) => s.positionHistory)
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)

  const geometry = useMemo(() => {
    if (positionHistory.length < 2) return null

    // Compute viewCenter inline to avoid selector reference issues
    const viewCenter = position === cursor ? position : cursor
    const origin = alignedOrigin(viewCenter, scaleExp)
    const vertices: number[] = []

    // Build segments: each pair of consecutive positions becomes two vertices
    for (let i = 0; i < positionHistory.length - 1; i++) {
      const from = positionHistory[i]
      const to = positionHistory[i + 1]
      
      const x1 = cellOffset(from[axes.right.axis], origin[axes.right.axis], scaleExp, axes.right.dir)
      const y1 = cellOffset(from[axes.up.axis], origin[axes.up.axis], scaleExp, axes.up.dir)
      vertices.push(x1, y1, 0.02)
      
      const x2 = cellOffset(to[axes.right.axis], origin[axes.right.axis], scaleExp, axes.right.dir)
      const y2 = cellOffset(to[axes.up.axis], origin[axes.up.axis], scaleExp, axes.up.dir)
      vertices.push(x2, y2, 0.02)
    }

    const geom = new BufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    return geom
  }, [positionHistory, axes, scaleExp, position, cursor])

  if (!geometry) return null

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#ff0000" linewidth={2} toneMapped={false} />
    </lineSegments>
  )
}
