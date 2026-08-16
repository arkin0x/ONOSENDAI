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
import { GRID_RADIUS, type AxisDirection } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { cameraPose } from '../lib/cameraPose'
import { useTerrainVolume } from '../hooks/useTerrainVolume'
import { useViewWindow } from '../hooks/useViewWindow'
import { useTargets } from '../hooks/useTargets'
import { Avatar } from './Avatar'
import { CoveringBox } from './CoveringBox'
import { CrossingFlash } from './CrossingFlash'
import { Earth } from './Earth'
import { Cursor } from './Cursor'
import { PathTrail } from './PathTrail'
import { Rooms } from './Rooms'
import { SectorBox } from './SectorBox'
import { ShaderPointField } from './ShaderPointField'
import { TargetProjector } from './TargetProjector'
import { Travel } from './Travel'

/** Starting distance from the cursor, in cells. Orbit takes over from here. */
const START_DISTANCE = 26

function World(): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  const win = useViewWindow()
  const volume = useTerrainVolume(win, axes)
  const targets = useTargets()

  return (
    <group>
      {/*
        The LCA boundary grid is hidden. It drew a flat 2D lattice that streaked
        across the volume once the view became perspective, and the room boxes
        now carry the same information as containment: a box edge IS the
        expensive boundary. Kept in the tree for ticket 05, which owns how cost
        is shown, rather than deleted.
      */}
      {/* Runs before anything that reads travelOffset. */}
      <Travel axes={axes} />
      <TargetProjector axes={axes} targets={targets} />
      <ShaderPointField volume={volume} win={win} />
      <Rooms axes={axes} />
      <SectorBox axes={axes} />
      <Earth axes={axes} />
      <CoveringBox axes={axes} />
      <CrossingFlash axes={axes} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
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
    const local = [axes.right, axes.up, axes.out]

    // Claimed one at a time, strongest first, because snapping the three basis
    // vectors independently does not have to yield three different axes. Around
    // 45 degrees two of them round to the same one, and then a whole cyberspace
    // axis has no key bound to it: R/F aliases onto W/S and you cannot leave the
    // plane at all. Claiming makes the result a permutation by construction.
    const taken = [false, false, false]
    const claim = (v: Vector3): AxisDirection => {
      const c = [v.x, v.y, v.z]
      let i = -1
      for (let k = 0; k < 3; k++) {
        if (taken[k]) continue
        if (i === -1 || Math.abs(c[k]) > Math.abs(c[i])) i = k
      }
      taken[i] = true
      const dir = (local[i].dir * (c[i] >= 0 ? 1 : -1)) as 1 | -1
      return { axis: local[i].axis, dir }
    }

    const r = claim(right.current)
    const u = claim(up.current)
    const o = claim(out.current)
    useCyberspace.getState().setScreenAxes({ right: r, up: u, out: o })
    if (import.meta.env.DEV) {
      ;(window as unknown as { __screenAxes?: unknown }).__screenAxes = { right: r, up: u, out: o }
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
      ;(window as unknown as { __scene?: unknown }).__scene = state.scene
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
  const cursor = useCyberspace((s) => s.cursor)
  const position = useCyberspace((s) => s.position)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const view = useCyberspace((s) => s.view)
  const controls = useRef<{ object: { position: Vector3 }; update: () => void } | null>(null)

  const target = useMemo(
    () => useCyberspace.getState().cursorOffset(),
    [cursor, position, scaleExp, view],
  )

  // Locked means the camera travels with the cursor, so an axis-aligned view
  // stays framed on it as you drive. Aligning with Shift+WASD re-locks; orbiting
  // breaks the lock, because once you have chosen an angle you are looking at
  // the space rather than following the cursor through it.
  const locked = useRef(true)
  const prevTarget = useRef(target)
  const latestTarget = useRef(target)
  latestTarget.current = target

  useEffect(() => {
    const c = controls.current
    if (!c) return
    const [x, y, z] = latestTarget.current
    c.object.position.set(x, y, z + START_DISTANCE)
    prevTarget.current = latestTarget.current
    locked.current = true
    c.update()
  }, [view])

  // While locked, translate the camera by however far the cursor moved, so the
  // framing is unchanged. Unlocked, the camera stays put and merely re-aims,
  // which lets the cursor move around within the angle you picked.
  useEffect(() => {
    const c = controls.current
    if (!c) return
    if (locked.current) {
      const p = prevTarget.current
      c.object.position.x += target[0] - p[0]
      c.object.position.y += target[1] - p[1]
      c.object.position.z += target[2] - p[2]
      c.update()
    }
    prevTarget.current = target
  }, [target])

  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      target={target}
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
