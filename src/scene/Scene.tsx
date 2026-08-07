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
import type { TerrainField as TerrainFieldData } from '../hooks/useTerrainField'
import { Avatar } from './Avatar'
import { BoundaryGrid } from './BoundaryGrid'
import { Cursor } from './Cursor'
import { PathTrail } from './PathTrail'
import { TerrainField } from './TerrainField'
import { ViewRig } from './ViewRig'

function World(): JSX.Element {
  const displayView = useCyberspace((s) => s.displayView)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const field = useTerrainField()
  const axes = useMemo(() => useCyberspace.getState().axes(), [displayView])

  // Track old terrain for fade-out and new terrain for fade-in during rotation.
  // displayView only changes in finishRotation(), so it is a reliable signal
  // that a rotation just completed. The terrain worker response arrives later
  // (async), so we remember the rotation signal and apply it to the next
  // field change regardless of when that happens.
  const [oldField, setOldField] = useState<TerrainFieldData | null>(null)
  const [newFieldFading, setNewFieldFading] = useState(false)
  const prevFieldRef = useRef(field)
  const prevDisplayViewRef = useRef(displayView)
  const rotationPending = useRef(false)

  // A new displayView means finishRotation() just ran. Flag the next field
  // change as rotation-driven.
  if (displayView !== prevDisplayViewRef.current) {
    rotationPending.current = true
    prevDisplayViewRef.current = displayView
  }

  useEffect(() => {
    if (field !== prevFieldRef.current) {
      if (rotationPending.current) {
        setOldField(prevFieldRef.current)
        setNewFieldFading(true)
        rotationPending.current = false
      }
      prevFieldRef.current = field
    }
  }, [field])

  const handleOldFadeComplete = () => {
    setOldField(null)
  }

  const handleNewFadeComplete = () => {
    setNewFieldFading(false)
  }

  return (
    <group quaternion={displayView}>
      {/* Old terrain fading out */}
      {oldField && (
        <TerrainField
          field={oldField}
          fadeDirection="out"
          fadeDuration={0.5}
          onFadeComplete={handleOldFadeComplete}
        />
      )}

      {/* Current terrain — fade in after rotation, full opacity otherwise */}
      <TerrainField
        field={field}
        fadeDirection={newFieldFading ? 'in' : undefined}
        fadeDuration={0.5}
        onFadeComplete={newFieldFading ? handleNewFadeComplete : undefined}
      />

      <BoundaryGrid axes={axes} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
      <Cursor axes={axes} />
      <Avatar axes={axes} field={field} />
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
      <ambientLight intensity={0.6} />
      <directionalLight position={[10, 10, 10]} intensity={0.8} />
      <ViewRig />
      <World />
    </Canvas>
  )
}

export { GRID_RADIUS }
