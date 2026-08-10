/**
 * Scene.tsx — assembles the spatial view with 3D terrain chunks.
 *
 * The terrain is now a 3D volume of chunks managed by useTerrainChunks.
 * During normal viewing, the box culling shows only a thin slab along the
 * current view plane. During rotation, the box expands to reveal depth layers,
 * then collapses back when rotation completes.
 */

import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { BG } from '../lib/palette'
import { GRID_RADIUS, stepFor } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { useTerrainChunks } from '../hooks/useTerrainChunks'
import { Avatar } from './Avatar'
import { BoundaryGrid } from './BoundaryGrid'
import { Cursor } from './Cursor'
import { PathTrail } from './PathTrail'
import { ShaderPointVolume } from './ShaderPointVolume'
import { ViewRig } from './ViewRig'

/**
 * Compute box bounds in local grid space (same units as geometry positions).
 *
 * Geometry positions are `(cellIndex - halfSize) * step`, so the box bounds
 * must match. During normal viewing, depth is ±0.5 step (thin slab).
 * During rotation, depth expands to ±halfSize * step (full cube).
 */
function useBoxBounds(): { boxMin: [number, number, number]; boxMax: [number, number, number] } {
  const isRotating = useCyberspace((s) => s.isRotating)
  const scaleExp = useCyberspace((s) => s.scaleExp)

  const step = Number(stepFor(scaleExp))
  const halfGrid = GRID_RADIUS * step

  // Thin slab: only the current plane (±0.5 step in depth).
  const slabDepth = step * 0.5

  // Full cube: entire grid depth.
  const cubeDepth = halfGrid

  const depth = isRotating ? cubeDepth : slabDepth

  return {
    boxMin: [-halfGrid, -halfGrid, -depth],
    boxMax: [halfGrid, halfGrid, depth],
  }
}

function World(): JSX.Element {
  const displayView = useCyberspace((s) => s.displayView)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const chunks = useTerrainChunks()
  const axes = useMemo(() => useCyberspace.getState().axes(), [displayView])

  const { boxMin, boxMax } = useBoxBounds()

  return (
    <group quaternion={displayView}>
      <ShaderPointVolume
        chunks={chunks}
        boxMin={boxMin}
        boxMax={boxMax}
      />

      <BoundaryGrid axes={axes} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
      <Cursor axes={axes} />
      <Avatar axes={axes} />
    </group>
  )
}

export function Scene(): JSX.Element {
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 200], near: 0.01, far: 4000, zoom: 8 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ background: BG }}
      frameloop="always"
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 10, 10]} intensity={1.2} />
      <ViewRig />
      <World />
    </Canvas>
  )
}

export { GRID_RADIUS }
