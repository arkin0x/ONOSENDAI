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
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { BG } from '../lib/palette'
import { GRID_RADIUS, claimScreenAxes, originShift, type Position } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { cameraPose } from '../lib/cameraPose'
import { useTerrainVolume } from '../hooks/useTerrainVolume'
import { useViewWindow } from '../hooks/useViewWindow'
import { useTargets } from '../hooks/useTargets'
import { Avatar } from './Avatar'
import { BlackSun } from './BlackSun'
import { CoveringBox } from './CoveringBox'
import { CrossingFlash } from './CrossingFlash'
import { Earth } from './Earth'
import { Cursor } from './Cursor'
import { PathTrail } from './PathTrail'
import { Rooms } from './Rooms'
import { SectorBox } from './SectorBox'
import { ShaderPointField } from './ShaderPointField'
import { SpawnMarker } from './SpawnMarker'
import { TargetProjector } from './TargetProjector'
import { Travel } from './Travel'

/** Starting distance from the cursor, in cells. Orbit takes over from here. */
const START_DISTANCE = 26

/**
 * Time constant for the camera's follow, in seconds.
 *
 * Small enough that driving still feels direct, large enough that a keypress
 * glides rather than steps. Only real motion is eased; a change of render frame
 * is applied whole, see the rig.
 */
const FOLLOW_TAU = 0.09

function World(): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const pubkey = useCyberspace((s) => s.focusPubkey())
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  const win = useViewWindow()
  const volume = useTerrainVolume(win, axes)
  const targets = useTargets()

  return (
    <group>
      {/* Runs before anything that reads travelOffset. */}
      <Travel axes={axes} />
      <TargetProjector axes={axes} targets={targets} />
      {/* At infinity, so it draws behind everything regardless of tree order. */}
      <BlackSun axes={axes} />
      <ShaderPointField volume={volume} win={win} />
      <Rooms axes={axes} />
      <SectorBox axes={axes} />
      <Earth axes={axes} />
      <CoveringBox axes={axes} />
      <CrossingFlash axes={axes} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
      <SpawnMarker pubkey={pubkey} axes={axes} />
      <Cursor axes={axes} />
      <Avatar />
    </group>
  )
}

/**
 * Keeps the cursor's controls aligned with what you can actually see.
 *
 * WASD moves along the axes of the snapped `view` frame. That was fine when the
 * only way to change viewpoint was Shift+WASD, which changes that frame. With
 * free orbit the camera can end up anywhere, and orbiting 180 degrees leaves the
 * controls inverted: you press right and the cursor goes left.
 *
 * So take the camera's actual right and up vectors, snap each to whichever of
 * the three local axes it most closely aligns with, and map that back to a
 * cyberspace axis and sign. The scene's world group carries no rotation, so
 * local x/y/z are exactly `axes.right`, `axes.up` and `axes.out`.
 *
 * Snapping to the nearest axis means the controls change only when you pass 45
 * degrees, so they stay predictable rather than drifting continuously.
 */
function ScreenAxes(): null {
  const view = useCyberspace((s) => s.view)
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])
  const right = useRef(new Vector3())
  const up = useRef(new Vector3())
  const out = useRef(new Vector3())

  useFrame((state) => {
    // The third basis vector is the camera's +Z, which points out of the screen
    // toward the viewer, exactly what `out` means here. Deriving out as "the
    // axis the other two did not claim" kept its original sign, so R and F
    // pushed the wrong way once an orbit flipped that axis.
    state.camera.matrixWorld.extractBasis(right.current, up.current, out.current)
    // The permutation itself is claimScreenAxes, in space.ts, so the property
    // that makes it correct (three different axes for any camera angle) can be
    // asserted without a camera.
    const screen = claimScreenAxes(right.current, up.current, out.current, axes)
    useCyberspace.getState().setScreenAxes(screen)
    if (import.meta.env.DEV) {
      ;(window as unknown as { __screenAxes?: unknown }).__screenAxes = screen
    }
  })

  return null
}

/**
 * Publishes the on-screen size of one cell, in pixels, as `--cell-px`.
 *
 * The HUD's scale instrument has to be the same size as the cursor cube, and
 * under a perspective camera that is not a constant: it is the projection scale
 * over the distance to what the camera orbits, so it changes as you dolly. A CSS
 * variable rather than store state, because this updates every frame and driving
 * a React render per frame to move one HUD element is not worth it.
 */
function CellMetric(): null {
  useFrame((state) => {
    // Share the camera's orientation with the compass, which renders in its own
    // Canvas and cannot reach this one's camera.
    cameraPose.copy(state.camera.quaternion)

    if (import.meta.env.DEV) {
      // R3F 8 keeps no handle on the canvas node, so the browser harness has no
      // other way to inspect what is actually in the scene.
      const w = window as unknown as { __scene?: unknown; __camera?: unknown }
      w.__scene = state.scene
      // The camera is not a child of the scene in R3F, so traversal cannot find
      // it and the harness has no other route to the view basis.
      w.__camera = state.camera
    }

    const cam = state.camera as unknown as { fov?: number; position: { distanceTo: (v: never) => number } }
    if (cam.fov === undefined) return
    const [tx, ty, tz] = useCyberspace.getState().cursorOffset()
    const dist = Math.max(0.001, cam.position.distanceTo({ x: tx, y: ty, z: tz } as never))
    const projScale = state.size.height / (2 * Math.tan((cam.fov * Math.PI) / 360))
    document.documentElement.style.setProperty('--cell-px', `${(projScale / dist).toFixed(2)}px`)
  })
  return null
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
  const view = useCyberspace((s) => s.view)
  const genesisId = useCyberspace((s) => s.genesisId)
  const focusPubkey = useCyberspace((s) => s.focusPubkey())
  const controls = useRef<{
    object: { position: Vector3 }
    target: Vector3
    update: () => void
  } | null>(null)

  // Locked means the camera travels with the cursor, so an axis-aligned view
  // stays framed on it as you drive. Aligning with Shift+WASD re-locks; orbiting
  // breaks the lock, because once you have chosen an angle you are looking at
  // the space rather than following the cursor through it.
  const locked = useRef(true)
  const smooth = useRef(new Vector3())
  const prevOrigin = useRef<Position | null>(null)
  const prevScale = useRef(-1)

  // Re-framed on an axis snap and on a respawn. A respawn moves the render
  // origin home in one step, and the per-frame shift below would faithfully
  // carry the camera the same distance, which is the whole width of the axis:
  // the avatar would be at the origin and the camera 10^20 cells away. Treating
  // it as a fresh frame, like a zoom, is what puts you back at your spawn.
  useEffect(() => {
    const c = controls.current
    if (!c) return
    const [x, y, z] = useCyberspace.getState().cursorOffset()
    smooth.current.set(x, y, z)
    c.target.copy(smooth.current)
    c.object.position.set(x, y, z + START_DISTANCE)
    locked.current = true
    prevOrigin.current = null
    c.update()
  }, [view, genesisId, focusPubkey])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    const s = useCyberspace.getState()
    // The anchor, not the position: in history the scene is drawn from the
    // action being looked at, and the camera has to ride that the same way it
    // rides a commit.
    const origin = alignedOrigin(s.anchor, s.scaleExp)

    // A commit re-anchors render space to the new avatar cell, so every
    // coordinate in the scene shifts at once. That is a change of frame, not
    // motion, and the camera has to absorb it in the very same frame or the
    // whole world lurches. It used to be absorbed in an effect, which runs after
    // paint: for exactly one frame the world had moved and the camera had not,
    // which measured as the entire move distance appearing and vanishing.
    //
    // It also must not be eased. Easing a frame change would slide the world
    // under a camera that is looking at something stationary.
    if (prevOrigin.current && prevScale.current === s.scaleExp) {
      const shift = originShift(prevOrigin.current, origin, s.scaleExp, s.axes())
      if (shift[0] !== 0 || shift[1] !== 0 || shift[2] !== 0) {
        c.object.position.x += shift[0]
        c.object.position.y += shift[1]
        c.object.position.z += shift[2]
        smooth.current.x += shift[0]
        smooth.current.y += shift[1]
        smooth.current.z += shift[2]
      }
    }

    const [tx, ty, tz] = s.cursorOffset()

    // A zoom rescales every render coordinate, so there is no continuous path
    // between the old framing and the new one to ease along.
    if (prevScale.current !== s.scaleExp) smooth.current.set(tx, ty, tz)

    prevOrigin.current = origin
    prevScale.current = s.scaleExp

    // Cursor movement, by contrast, IS motion, and eases. Exponential rather
    // than a fixed fraction so the rate does not change with frame rate.
    const k = 1 - Math.exp(-dt / FOLLOW_TAU)
    const dx = (tx - smooth.current.x) * k
    const dy = (ty - smooth.current.y) * k
    const dz = (tz - smooth.current.z) * k

    // Locked, the camera moves with what it is framing, which preserves the
    // orbit offset exactly. Unlocked it stays put and only re-aims.
    if (locked.current) {
      c.object.position.x += dx
      c.object.position.y += dy
      c.object.position.z += dz
    }
    smooth.current.x += dx
    smooth.current.y += dy
    smooth.current.z += dz

    c.target.copy(smooth.current)
    c.update()
  })

  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enablePan={false}
      minDistance={2}
      maxDistance={GRID_RADIUS * 4}
      dampingFactor={0.12}
      onStart={() => { locked.current = false }}
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
      <CellMetric />
      <ScreenAxes />
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
