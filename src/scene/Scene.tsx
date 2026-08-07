/**
 * Scene.tsx — assembles the spatial view.
 *
 * Everything lives inside a group oriented by the *display* view quaternion, so
 * the group's local axes are always (screen right, screen up, out of screen).
 * That lets the field, grid and avatar be authored as flat 2D while still
 * occupying real world-space orientation, which is what makes the shift-rotate
 * swing read as genuine 3D rather than a texture swap.
 *
 * During rotation, the old terrain fades out while the new terrain fades in,
 * giving the user visual feedback about the orientation change.
 */

import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BG } from '../lib/palette'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { useTerrainField } from '../hooks/useTerrainField'
import { Avatar } from './Avatar'
import { BoundaryGrid } from './BoundaryGrid'
import { Cursor } from './Cursor'
import { PathTrail } from './PathTrail'
import { TerrainField } from './TerrainField'
import { ViewRig } from './ViewRig'

function World(): JSX.Element {
  const displayView = useCyberspace((s) => s.displayView)
  const isRotating = useCyberspace((s) => s.isRotating)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const field = useTerrainField()
  const axes = useMemo(() => useCyberspace.getState().axes(), [displayView])
  
  // Track old terrain for fade-out during rotation
  const [oldField, setOldField] = useState<typeof field | null>(null)
  const [fading, setFading] = useState(false)
  const prevFieldRef = useRef(field)
  
  useEffect(() => {
    // When field changes and we're rotating, capture the old field for fade-out
    if (field !== prevFieldRef.current && isRotating) {
      setOldField(prevFieldRef.current)
      setFading(true)
    }
    prevFieldRef.current = field
  }, [field, isRotating])
  
  const handleFadeComplete = () => {
    setOldField(null)
    setFading(false)
  }

  return (
    <group quaternion={displayView}>
      {/* Old terrain fading out */}
      {oldField && fading && (
        <TerrainField 
          field={oldField} 
          fadeDirection="out"
          fadeDuration={0.5}
          onFadeComplete={handleFadeComplete}
        />
      )}
      
      {/* Current terrain */}
      <TerrainField field={field} />
      
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
      camera={{ position: [0, 0, 200], near: 0.01, far: 4000, zoom: 16 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ background: BG }}
      frameloop="always"
    >
      <ViewRig />
      <World />
    </Canvas>
  )
}

export { GRID_RADIUS }
