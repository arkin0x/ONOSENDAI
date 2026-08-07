/**
 * Avatar.tsx — you.
 *
 * A red wireframe icosahedron marks your exact position in cyberspace.
 * This is the same avatar shape from Onosendai v1, representing your
 * presence at this coordinate.
 *
 * The avatar rests on top of the terrain sphere at its coordinate.
 */

import { useMemo } from 'react'
import { IcosahedronGeometry, EdgesGeometry } from 'three'
import { cellOffset, GRID_RADIUS, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import type { TerrainField as TerrainFieldData } from '../hooks/useTerrainField'

interface Props {
  axes: ViewAxes
  field: TerrainFieldData
}

export function Avatar({ axes, field }: Props): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const viewCenter = useCyberspace((s) => s.viewCenter())
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const [ax, ay, k] = useMemo(() => {
    const origin = alignedOrigin(viewCenter, scaleExp)
    const ax = cellOffset(position[axes.right.axis], origin[axes.right.axis], scaleExp, axes.right.dir)
    const ay = cellOffset(position[axes.up.axis], origin[axes.up.axis], scaleExp, axes.up.dir)
    
    // Get K value at avatar position from field data
    const row = Math.round(ay + GRID_RADIUS)
    const col = Math.round(ax + GRID_RADIUS)
    const size = GRID_RADIUS * 2 + 1
    let k = 8 // default
    if (row >= 0 && row < size && col >= 0 && col < size && field.values) {
      k = field.values[row * size + col]
    }
    
    return [ax, ay, k]
  }, [position, viewCenter, scaleExp, axes, field])

  // Sphere radius at avatar position: 0.4 * (K/16)
  const normalizedK = k === 255 ? 0 : k / 16
  const radius = 0.4 * normalizedK

  const avatarGeometry = useMemo(() => {
    const geo = new IcosahedronGeometry(0.5, 1)
    return new EdgesGeometry(geo)
  }, [])

  return (
    <group position={[ax, ay, radius + 0.1]}>
      <lineSegments geometry={avatarGeometry} frustumCulled={false}>
        <lineBasicMaterial color="#ff2323" toneMapped={false} />
      </lineSegments>
    </group>
  )
}
