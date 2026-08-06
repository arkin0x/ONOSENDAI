/**
 * TerrainField.tsx — the terrain K field as a grid of coloured cells.
 *
 * K is the terrain-derived temporal height for a destination: it sets how much
 * non-cacheable temporal work every hop into that cell costs. Rendering it as
 * ground makes "this region is expensive" a thing you can see and walk around.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { Color, InstancedMesh, Object3D } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { GRID_RADIUS } from '../lib/space'
import { terrainColor } from '../lib/palette'
import { useCyberspace } from '../store/useCyberspace'
import type { TerrainField as TerrainFieldData } from '../hooks/useTerrainField'

const OUT_OF_BOUNDS = new Color('#120309')

interface Props {
  field: TerrainFieldData
}

export function TerrainField({ field }: Props): JSX.Element {
  const meshRef = useRef<InstancedMesh>(null)
  const size = GRID_RADIUS * 2 + 1
  const count = size * size

  const dummy = useMemo(() => new Object3D(), [])

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const i = row * size + col
        dummy.position.set(col - GRID_RADIUS, row - GRID_RADIUS, 0)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)

        const k = field.values ? field.values[i] : 8
        mesh.setColorAt(i, k === 255 ? OUT_OF_BOUNDS : terrainColor(k))
      }
    }

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  }, [field, size, dummy])

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation()
    const point = event.point
    // Convert intersection point to grid row/col.
    // Grid cells are centered at integer coordinates, so round to nearest.
    const col = Math.round(point.x + GRID_RADIUS)
    const row = Math.round(point.y + GRID_RADIUS)
    // Clamp to valid grid range.
    if (row < 0 || row >= size || col < 0 || col >= size) return
    useCyberspace.getState().setCursorAtCell(row, col)
  }

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
      onClick={handleClick}
    >
      <planeGeometry args={[0.96, 0.96]} />
      <meshBasicMaterial toneMapped={false} transparent opacity={0.85} />
    </instancedMesh>
  )
}
