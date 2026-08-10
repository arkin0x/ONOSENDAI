/**
 * Scene.tsx — assembles the spatial view with 3D terrain chunks.
 *
 * The terrain is now a 3D volume of chunks managed by useTerrainChunks.
 * The view snaps instantly to the new orientation (no slerp animation).
 */

import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { BG } from '../lib/palette'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { useTerrainChunks } from '../hooks/useTerrainChunks'
import { Avatar } from './Avatar'
import { BoundaryGrid } from './BoundaryGrid'
import { ClickPlane } from './ClickPlane'
import { Cursor } from './Cursor'
import { PathTrail } from './PathTrail'
import { ShaderPointVolume } from './ShaderPointVolume'
import { ViewRig } from './ViewRig'

/**
 * Visible box, on screen axes, in cell units.
 *
 * The scene draws one unit per cell at every scale, so these bounds are the
 * grid radius directly and do not vary with scaleExp. The box shows the full
 * grid depth.
 */
function useBoxBounds(): { boxMin: [number, number, number]; boxMax: [number, number, number] } {
  return useMemo(() => ({
    boxMin: [-GRID_RADIUS, -GRID_RADIUS, -GRID_RADIUS] as [number, number, number],
    boxMax: [GRID_RADIUS, GRID_RADIUS, GRID_RADIUS] as [number, number, number],
  }), [])
}

function World(): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const chunks = useTerrainChunks()
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  const { boxMin, boxMax } = useBoxBounds()

  return (
    <group quaternion={view}>
      <ShaderPointVolume
        chunks={chunks}
        axes={axes}
        boxMin={boxMin}
        boxMax={boxMax}
      />

      <BoundaryGrid axes={axes} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
      <ClickPlane axes={axes} />
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
