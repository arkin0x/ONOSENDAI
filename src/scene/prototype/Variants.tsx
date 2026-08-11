/**
 * PROTOTYPE — throwaway. Ticket 03 of the spatial-perception map.
 *
 * Three variants of the spatial model, on the existing route via ?variant=.
 *
 * The variable under test is NOT projection. Ticket 01 found v1's first-person
 * view had effectively no parallax (nearest geometry ~5e8 units away) and still
 * felt embodied, from bloom over black on line geometry, fog, and the sector
 * drawn as a room you are inside. So:
 *
 *   A  light only     today's flat ortho slice + bloom + fog
 *   B  rooms          A + the aligned-subtree nest as containment (still ortho)
 *   C  perspective    B with a real perspective rig
 *   D  the room       one subtree is current: you are inside it, its parent is
 *                     faint beyond it, and the black sun is a proxy on its +Z
 *                     wall. Zoom moves you through the nest.
 *
 * A vs B isolates whether structure earns its keep. A vs C isolates whether
 * projection does. Precision is unchanged in all three: same cursor, same grid,
 * same commit path.
 */

import { Canvas } from '@react-three/fiber'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { useMemo } from 'react'
import { BG } from '../../lib/palette'
import { useCyberspace } from '../../store/useCyberspace'
import { useTerrainPlane } from '../../hooks/useTerrainPlane'
import { usePrefetchWalk } from '../../hooks/usePrefetchWalk'
import { useViewWindow } from '../../hooks/useViewWindow'
import { Avatar } from '../Avatar'
import { BoundaryGrid } from '../BoundaryGrid'
import { ClickPlane } from '../ClickPlane'
import { Cursor } from '../Cursor'
import { PathTrail } from '../PathTrail'
import { ShaderPointField } from '../ShaderPointField'
import { ViewRig } from '../ViewRig'
import { Rooms } from './Rooms'
import { Room } from './Room'
import { currentVariant, type VariantKey } from './PrototypeSwitcher'

/** The world content. Identical across variants; only the treatment differs. */
function WorldContent({ rooms, room }: { rooms: boolean; room: boolean }): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  const win = useViewWindow()
  const plane = useTerrainPlane(win, axes)
  usePrefetchWalk(axes)

  return (
    <group quaternion={view}>
      <ShaderPointField plane={plane} win={win} />
      {rooms && <Rooms axes={axes} />}
      {room && <Room axes={axes} />}
      <BoundaryGrid axes={axes} win={win} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
      <ClickPlane axes={axes} />
      <Cursor axes={axes} />
      <Avatar axes={axes} />
    </group>
  )
}

/**
 * v1's bloom, verbatim: threshold 0.001 so every non-black pixel blooms, levels
 * 9 for a glow spanning most of the screen. Ticket 01 names this as the single
 * thing that made line geometry read as emitted light.
 */
function Glow(): JSX.Element {
  return (
    <EffectComposer>
      <Bloom mipmapBlur levels={9} intensity={2.2} luminanceThreshold={0.001} luminanceSmoothing={0} />
    </EffectComposer>
  )
}

export function PrototypeScene(): JSX.Element {
  const variant: VariantKey = currentVariant()
  const perspective = variant === 'C'
  const rooms = variant === 'B' || variant === 'C'
  const room = variant === 'D'

  return (
    <Canvas
      key={variant}
      orthographic={!perspective}
      camera={
        perspective
          ? { fov: 60, position: [0, 0, 60], near: 0.1, far: 20000 }
          : { position: [0, 0, 200], near: 0.01, far: 4000, zoom: 8 }
      }
      dpr={[1, 2]}
      gl={{ antialias: true }}
      style={{ background: BG }}
      frameloop="always"
    >
      {/* Fog to pure black, as v1 had. The only distance cue in an empty field. */}
      <fog attach="fog" args={[0x000000, perspective ? 40 : 120, perspective ? 220 : 900]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 10, 10]} intensity={1.2} />
      <ViewRig perspective={perspective} />
      <WorldContent rooms={rooms} room={room} />
      <Glow />
    </Canvas>
  )
}
