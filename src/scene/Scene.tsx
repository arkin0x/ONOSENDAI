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
import { useEffect, useMemo, useRef } from 'react'
import { BG } from '../lib/palette'
import { GRID_RADIUS } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { useTerrainVolume } from '../hooks/useTerrainVolume'
import { useViewWindow } from '../hooks/useViewWindow'
import { Avatar } from './Avatar'
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
      {/*
        The LCA boundary grid is hidden. It drew a flat 2D lattice that streaked
        across the volume once the view became perspective, and the room boxes
        now carry the same information as containment: a box edge IS the
        expensive boundary. Kept in the tree for ticket 05, which owns how cost
        is shown, rather than deleted.
      */}
      <ShaderPointField volume={volume} win={win} />
      <Rooms axes={axes} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
      <Cursor axes={axes} />
      <Avatar axes={axes} />
    </group>
  )
}

/**
 * Orbit around the cursor, with the axis views as snap-backs.
 *
 * Free orbit and the 90° axis remapping are both worth having and they do
 * different jobs: orbit is for looking, `Shift+WASD` is for recovering a precise,
 * axis-aligned view once you have finished looking. So changing `view` does not
 * merely remap the axes, it also returns the camera to straight-on.
 */
function Rig(): JSX.Element {
  const cursor = useCyberspace((s) => s.cursor)
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const view = useCyberspace((s) => s.view)
  const controls = useRef<{ object: { position: { set: (x: number, y: number, z: number) => void } }; update: () => void } | null>(null)

  const target = useMemo(
    () => useCyberspace.getState().cursorOffset(),
    [cursor, position, scaleExp, view],
  )

  // Snap straight-on ONLY when the axis mapping changes. Moving the cursor
  // retargets the orbit but must not reset it: orbiting to an angle and then
  // driving the cursor from there is the point.
  const latestTarget = useRef(target)
  latestTarget.current = target
  useEffect(() => {
    const c = controls.current
    if (!c) return
    const [x, y, z] = latestTarget.current
    c.object.position.set(x, y, z + START_DISTANCE)
    c.update()
  }, [view])

  return (
    <OrbitControls
      ref={controls as never}
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
      {/*
        Bloom is what makes line geometry read as emitted light, and it is also
        by far the most expensive thing on screen: measured at 6fps with levels 9
        at full resolution against 49fps with the pass removed entirely. Halving
        its resolution and cutting the mip levels buys nearly all of that back,
        and is invisible because the effect is a blur to begin with.
      */}
      <EffectComposer resolutionScale={0.25}>
        <Bloom mipmapBlur levels={3} intensity={2.6} luminanceThreshold={0.001} luminanceSmoothing={0} />
      </EffectComposer>
    </Canvas>
  )
}

export { GRID_RADIUS }
