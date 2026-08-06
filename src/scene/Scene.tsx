/**
 * Scene.tsx — assembles the spatial view.
 *
 * Everything lives inside a group oriented by the *target* view quaternion, so
 * the group's local axes are always (screen right, screen up, out of screen).
 * That lets the field, grid and avatar be authored as flat 2D while still
 * occupying real world-space orientation, which is what makes the shift-rotate
 * swing read as genuine 3D rather than a texture swap.
 */

import { Canvas } from '@react-three/fiber'
import { useMemo } from 'react'
import { BG } from '../lib/palette'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace, samePosition } from '../store/useCyberspace'
import { useTerrainField } from '../hooks/useTerrainField'
import { Avatar } from './Avatar'
import { BoundaryGrid } from './BoundaryGrid'
import { Cursor } from './Cursor'
import { TerrainField } from './TerrainField'
import { ViewRig } from './ViewRig'

function World(): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const cursorOffset = useCyberspace((s) => s.cursorOffset())
  const position = useCyberspace((s) => s.position)
  const cursor = useCyberspace((s) => s.cursor)
  const field = useTerrainField()
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])
  const cursorActive = !samePosition(position, cursor)

  // When the cursor is away from the avatar, shift the world so the cursor
  // sits at screen centre. This makes zooming track the cursor rather than
  // the avatar, which is what you want when inspecting terrain at a target.
  const pan: [number, number, number] = cursorActive
    ? [-cursorOffset[0], -cursorOffset[1], -cursorOffset[2]]
    : [0, 0, 0]

  return (
    <group quaternion={view} position={pan}>
      <TerrainField field={field} />
      <BoundaryGrid axes={axes} />
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
