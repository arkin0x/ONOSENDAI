/**
 * TerrainField.tsx — the terrain K field as a lattice of spheres.
 *
 * K is the terrain-derived temporal height for a destination: it sets how much
 * non-cacheable temporal work every hop into that cell costs. Rendering it as
 * spheres makes "this region is expensive" a thing you can see and walk around.
 *
 * Spheres are sized by K value: more costly terrain = larger sphere. The avatar
 * will rest centered on top of the sphere at its coordinate. This leaves space
 * between spheres for better visibility of other elements.
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
// Sphere radius: K=1 is nearly invisible (single point), K=16 is 0.25 (half avatar size)
const MIN_RADIUS = 0.01
const MAX_RADIUS = 0.25

interface Props {
  field: TerrainFieldData
  /** If provided, animate opacity from 0 to 1 (in) or from 1 to 0 (out). */
  fadeDirection?: 'in' | 'out'
  /** Duration of fade animation in seconds. */
  fadeDuration?: number
  /** Called when fade animation completes. */
  onFadeComplete?: () => void
}

export function TerrainField({ field, fadeDirection, fadeDuration = 0.5, onFadeComplete }: Props): JSX.Element {
  const meshRef = useRef<InstancedMesh>(null)
  const materialRef = useRef<THREE.MeshStandardMaterial>(null)
  const size = GRID_RADIUS * 2 + 1
  const count = size * size

  const dummy = useMemo(() => new Object3D(), [])
  
  // Fade animation state — reset when fadeDirection changes.
  const fadeProgress = useRef(1)
  const fadeComplete = useRef(true)
  const prevFadeDir = useRef(fadeDirection)

  // Reset fade state when direction changes (refs don't re-initialize on re-render)
  if (fadeDirection !== prevFadeDir.current) {
    prevFadeDir.current = fadeDirection
    if (fadeDirection === 'in') {
      fadeProgress.current = 0
      fadeComplete.current = false
    } else if (fadeDirection === 'out') {
      fadeProgress.current = 1
      fadeComplete.current = false
    } else {
      fadeProgress.current = 1
      fadeComplete.current = true
    }
  }

  useFrame((_: any, delta: number) => {
    if (!materialRef.current || fadeComplete.current) return

    const speed = 1 / fadeDuration
    if (fadeDirection === 'in') {
      fadeProgress.current = Math.min(1, fadeProgress.current + delta * speed)
      materialRef.current.opacity = fadeProgress.current
      if (fadeProgress.current >= 1) {
        fadeComplete.current = true
        onFadeComplete?.()
      }
    } else if (fadeDirection === 'out') {
      fadeProgress.current = Math.max(0, fadeProgress.current - delta * speed)
      materialRef.current.opacity = fadeProgress.current
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
        const k = field.values ? field.values[i] : 8
        
        // Calculate sphere radius based on K value (0-16 range)
        const normalizedK = k === 255 ? 0 : k / 16
        const radius = MIN_RADIUS + normalizedK * (MAX_RADIUS - MIN_RADIUS)
        
        // Position sphere at grid cell, elevated by its radius so it sits on the plane
        dummy.position.set(col - GRID_RADIUS, row - GRID_RADIUS, radius)
        
        // Scale the sphere based on K value
        dummy.scale.set(radius, radius, radius)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)

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
    
    // Convert world-space click point to the terrain field's local frame.
    // The field lives inside a rotated group, so event.point (world space)
    // doesn't match local grid coordinates after rotation.
    const mesh = meshRef.current
    if (!mesh) return
    const localPoint = event.point.clone()
    mesh.worldToLocal(localPoint)
    
    const col = Math.round(localPoint.x + GRID_RADIUS)
    const row = Math.round(localPoint.y + GRID_RADIUS)
    if (row < 0 || row >= size || col < 0 || col >= size) return
    useCyberspace.getState().setCursorAtCell(row, col)
  }

  const initialOpacity = fadeDirection === 'in' ? 0 : 1

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      frustumCulled={false}
      onClick={handleClick}
    >
      <sphereGeometry args={[1, 16, 16]} />
      <meshStandardMaterial
        ref={materialRef}
        vertexColors
        transparent
        opacity={initialOpacity}
        roughness={0.3}
        metalness={0.1}
        toneMapped={false}
      />
    </instancedMesh>
  )
}
