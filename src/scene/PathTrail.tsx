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
  const viewCenter = useCyberspace((s) => s.viewCenter())

  const geometry = useMemo(() => {
    if (positionHistory.length < 2) return null

    const origin = alignedOrigin(viewCenter, scaleExp)
    const vertices: number[] = []

    for (let i = 0; i < positionHistory.length; i++) {
      const pos = positionHistory[i]
      const x = cellOffset(pos[axes.right.axis], origin[axes.right.axis], scaleExp, axes.right.dir)
      const y = cellOffset(pos[axes.up.axis], origin[axes.up.axis], scaleExp, axes.up.dir)
      vertices.push(x, y, 0.02) // Slightly above terrain
    }

    const geom = new BufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    return geom
  }, [positionHistory, axes, scaleExp, viewCenter])

  if (!geometry) return null

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#ff0000" linewidth={2} toneMapped={false} />
    </lineSegments>
  )
}
