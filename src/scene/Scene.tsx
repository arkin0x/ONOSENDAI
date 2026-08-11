/**
 * Scene.tsx — assembles the spatial view.
 *
 * Perspective, inside a volume of gibsons, orbiting the cursor.
 *
 * The camera is a real perspective rig rather than the orthographic slice this
 * replaced. Two things carried over from the spatial-model prototype:
 *
 * - **Bloom over black**, from v1. With a threshold near zero every non-black
 *   pixel glows, which is what makes line geometry read as emitted light rather
 *   than as thin tinted strokes. Cheap, and it does most of the aesthetic work.
 * - **The aligned-subtree nest as rooms**, drawn in 3D. Per §4.5 the boxes are
 *   not chosen by anyone: everyone inside one computes the same root, so they
 *   are the shared structure of the space, and their edges are exactly the
 *   expensive boundaries.
 *
 * The world group carries no rotation. `axes` decides which cyberspace axis maps
 * to which screen axis, and the camera orbits freely within that frame, so the
 * quaternion pair the orthographic rig needed (which cancelled itself out) is
 * gone.
 */

import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { useMemo } from 'react'
import { BG } from '../lib/palette'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { useTerrainVolume } from '../hooks/useTerrainVolume'
import { useViewWindow } from '../hooks/useViewWindow'
import { Avatar } from './Avatar'
import { BoundaryGrid } from './BoundaryGrid'
import { Cursor } from './Cursor'
import { PathTrail } from './PathTrail'
import { Rooms } from './Rooms'
import { ShaderPointField } from './ShaderPointField'

/** Starting distance from the cursor, in cells. Orbit takes over from here. */
const START_DISTANCE = 26

function World(): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  const win = useViewWindow()
  const volume = useTerrainVolume(win, axes)

  return (
    <group>
      <ShaderPointField volume={volume} win={win} />
      <Rooms axes={axes} />
      <BoundaryGrid axes={axes} win={win} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
      <Cursor axes={axes} />
      <Avatar axes={axes} />
    </group>
  )
}

/** Orbit around the cursor, which is where the camera is looking. */
function Rig(): JSX.Element {
  const cursor = useCyberspace((s) => s.cursor)
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const view = useCyberspace((s) => s.view)

  const target = useMemo(
    () => useCyberspace.getState().cursorOffset(),
    [cursor, position, scaleExp, view],
  )

  return (
    <OrbitControls
      makeDefault
      target={target}
      enablePan={false}
      minDistance={2}
      maxDistance={GRID_RADIUS * 4}
      dampingFactor={0.12}
    />
  )
}

export function Scene(): JSX.Element {
  return (
    <Canvas
      camera={{ fov: 55, position: [0, 0, START_DISTANCE], near: 0.05, far: 6000 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ background: BG }}
      frameloop="always"
    >
      {/* Fog to pure black: the only distance cue in an otherwise empty field. */}
      <fog attach="fog" args={[0x000000, GRID_RADIUS * 0.9, GRID_RADIUS * 4]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 10, 10]} intensity={1.2} />
      <Rig />
      <World />
      <EffectComposer>
        <Bloom mipmapBlur levels={9} intensity={2.2} luminanceThreshold={0.001} luminanceSmoothing={0} />
      </EffectComposer>
    </Canvas>
  )
}

export { GRID_RADIUS }
