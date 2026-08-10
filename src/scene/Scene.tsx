/**
 * Scene.tsx — assembles the spatial view.
 *
 * The terrain is the avatar's plane, sliced from the terrain cache by
 * useTerrainPlane. The view snaps instantly to the new orientation.
 */

import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { BG } from '../lib/palette'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { useTerrainPlane } from '../hooks/useTerrainPlane'
import { useViewWindow } from '../hooks/useViewWindow'
import { Avatar } from './Avatar'
import { BoundaryGrid } from './BoundaryGrid'
import { ClickPlane } from './ClickPlane'
import { Cursor } from './Cursor'
import { PathTrail } from './PathTrail'
import { ShaderPointField } from './ShaderPointField'
import { ViewRig } from './ViewRig'

function World(): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  const win = useViewWindow()
  const plane = useTerrainPlane(win, axes)

  return (
    <group quaternion={view}>
      <ShaderPointField plane={plane} win={win} />

      <BoundaryGrid axes={axes} win={win} />
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
