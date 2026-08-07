/**
 * TerrainField.tsx — the terrain K field as a grid of coloured cells.
 *
 * K is the terrain-derived temporal height for a destination: it sets how much
 * non-cacheable temporal work every hop into that cell costs. Rendering it as
 * ground makes "this region is expensive" a thing you can see and walk around.
 *
 * Tiles are 3D boxes (not flat planes) so that side faces are visible during
 * camera rotation, giving depth to the gibson structure.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { GRID_RADIUS } from '../lib/space'
import { terrainColor } from '../lib/palette'
import { useCyberspace } from '../store/useCyberspace'
import type { TerrainField as TerrainFieldData } from '../hooks/useTerrainField'

const OUT_OF_BOUNDS = new Color('#120309')
const BOX_HEIGHT = 0.15

interface Props {
  field: TerrainFieldData
  /** If provided, animate opacity from 0 to this value (fade in) or from this to 0 (fade out). */
  fadeDirection?: 'in' | 'out'
  /** Duration of fade animation in seconds. */
  fadeDuration?: number
  /** Called when fade animation completes. */
  onFadeComplete?: () => void
}

export function TerrainField({ field, fadeDirection, fadeDuration = 0.5, onFadeComplete }: Props): JSX.Element {
  const meshRef = useRef<InstancedMesh>(null)
  const materialRef = useRef<THREE.MeshBasicMaterial>(null)
  const size = GRID_RADIUS * 2 + 1
  const count = size * size

  const dummy = useMemo(() => new Object3D(), [])
  
  // Fade animation state
  const fadeProgress = useRef(fadeDirection === 'in' ? 0 : 1)
  const fadeComplete = useRef(!fadeDirection)

  useFrame((_: any, delta: number) => {
    if (!materialRef.current || fadeComplete.current) return

    const speed = 1 / fadeDuration
    if (fadeDirection === 'in') {
      fadeProgress.current = Math.min(1, fadeProgress.current + delta * speed)
      materialRef.current.opacity = fadeProgress.current * 0.85
      if (fadeProgress.current >= 1) {
        fadeComplete.current = true
        onFadeComplete?.()
      }
    } else if (fadeDirection === 'out') {
      fadeProgress.current = Math.max(0, fadeProgress.current - delta * speed)
      materialRef.current.opacity = fadeProgress.current * 0.85
      if (fadeProgress.current <= 0) {
        fadeComplete.current = true
        onFadeComplete?.()
      }
    }
  })

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
    // Don't allow clicks on fading-out terrain
    if (fadeDirection === 'out') return
    event.stopPropagation()
    const point = event.point
    const col = Math.round(point.x + GRID_RADIUS)
    const row = Math.round(point.y + GRID_RADIUS)
    if (row < 0 || row >= size || col < 0 || col >= size) return
    useCyberspace.getState().setCursorAtCell(row, col)
  }

  const initialOpacity = fadeDirection === 'in' ? 0 : 0.85

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
      onClick={handleClick}
    >
      <boxGeometry args={[0.96, 0.96, BOX_HEIGHT]} />
      <meshBasicMaterial
        ref={materialRef}
        toneMapped={false}
        transparent
        opacity={initialOpacity}
      />
    </instancedMesh>
  )
}
