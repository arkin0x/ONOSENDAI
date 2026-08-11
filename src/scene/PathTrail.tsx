/**
 * PathTrail.tsx - renders red lines connecting all committed positions.
 *
 * Shows the movement chain as a visible trail through cyberspace.
 * Each segment connects consecutive positions in the history array.
 */

import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useCyberspace } from '../store/useCyberspace'
import { alignTo, cellDelta, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin } from '../store/useCyberspace'

interface Props {
  axes: ViewAxes
  scaleExp: number
}

export function PathTrail({ axes, scaleExp }: Props): JSX.Element | null {
  const positionHistory = useCyberspace((s) => s.positionHistory)
  const position = useCyberspace((s) => s.position)

  const geometry = useMemo(() => {
    if (positionHistory.length < 2) return null

    const origin = alignedOrigin(position, scaleExp)
    const vertices: number[] = []

    // All three axes. The trail used to map right and up only and pin depth to a
    // constant, so it drew a flat shadow of a 3D path: every out-axis hop
    // collapsed to nothing, and rotating the view changed which axis was being
    // flattened, so the shape changed with the view. Cell centres, matching the
    // cursor and the avatar, so a segment ends where its gibson is drawn.
    const centre = (p: Position): [number, number, number] => [
      cellDelta(alignTo(p[axes.right.axis], scaleExp), origin[axes.right.axis], scaleExp) * axes.right.dir,
      cellDelta(alignTo(p[axes.up.axis], scaleExp), origin[axes.up.axis], scaleExp) * axes.up.dir,
      cellDelta(alignTo(p[axes.out.axis], scaleExp), origin[axes.out.axis], scaleExp) * axes.out.dir,
    ]

    for (let i = 0; i < positionHistory.length - 1; i++) {
      vertices.push(...centre(positionHistory[i]), ...centre(positionHistory[i + 1]))
    }

    const geom = new BufferGeometry()
    geom.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    return geom
  }, [positionHistory, axes, scaleExp, position])

  if (!geometry) return null

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#ff0000" linewidth={2} toneMapped={false} />
    </lineSegments>
  )
}
