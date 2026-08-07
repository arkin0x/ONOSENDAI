/**
 * TerrainField.tsx — the terrain K field as a lattice of spheres.
 *
 * K is the terrain-derived temporal height for a destination: it sets how much
 * non-cacheable temporal work every hop into that cell costs. Rendering it as
 * spheres makes "this region is expensive" a thing you can see and walk around.
 *
 * K is Binomial(16, 0.5), range [0, 16]. The ramp is tuned for that range.
 */

import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Color, InstancedMesh, Object3D } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { GRID_RADIUS } from '../lib/space'
import { terrainColor } from '../lib/palette'
import { useCyberspace } from '../store/useCyberspace'
import type { TerrainField as TerrainFieldData } from '../hooks/useTerrainField'

const OUT_OF_BOUNDS = new Color('#120309')

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
    if (fadeComplete.current) return

    const speed = 1 / fadeDuration
    if (fadeDirection === 'in') {
      fadeProgress.current = Math.min(1, fadeProgress.current + delta * speed)
      if (fadeProgress.current >= 1) {
        fadeComplete.current = true
        onFadeComplete?.()
      }
    } else if (fadeDirection === 'out') {
      fadeProgress.current = Math.max(0, fadeProgress.current - delta * speed)
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

        // K ∈ [0, 16]. radius = 0.4 * (K/16). K=0 invisible, K=1 point, K=16 = half avatar.
        const normalizedK = k === 255 ? 0 : k / 16
        const radius = 0.4 * normalizedK

        // Position sphere at grid cell, elevated by its radius
        dummy.position.set(col - GRID_RADIUS, row - GRID_RADIUS, radius)

        // Scale the sphere
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
    if (fadeDirection === 'out') return
    event.stopPropagation()

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
      <meshBasicMaterial
        toneMapped={false}
        transparent
        opacity={initialOpacity}
      />
    </instancedMesh>
  )
}
