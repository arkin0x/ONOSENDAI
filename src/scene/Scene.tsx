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

import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { EffectComposer, Bloom } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Vector3 } from 'three'
import { BG } from '../lib/palette'
import { GRID_RADIUS, cellDelta, claimScreenAxes, originShift, type Position } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { cameraPose } from '../lib/cameraPose'
import { useTerrainVolume } from '../hooks/useTerrainVolume'
import { useHyperspace } from '../store/useHyperspace'
import { useWorkshop } from '../store/useWorkshop'
import { useViewWindow } from '../hooks/useViewWindow'
import { useTargets } from '../hooks/useTargets'
import { Avatar } from './Avatar'
import { BlackSun } from './BlackSun'
import { CoveringBox } from './CoveringBox'
import { CrossingFlash } from './CrossingFlash'
import { Earth } from './Earth'
import { EarthPatch } from './EarthPatch'
import { Cursor } from './Cursor'
import { HyperspaceCone } from './HyperspaceCone'
import { CyberspaceLattice } from './CyberspaceLattice'
import { StopField } from './StopField'
import { StopCubes } from './StopCubes'
import { StopBurst } from './StopBurst'
import { TransitAvatar } from './TransitAvatar'
import { RidePath } from './RidePath'
import { PathTrail } from './PathTrail'
import { Rooms } from './Rooms'
import { SectorBox } from './SectorBox'
import { ShaderPointField } from './ShaderPointField'
import { SpawnMarker } from './SpawnMarker'
import { TargetAvatars } from './TargetAvatars'
import { WorldShards } from './WorldShards'
import { WorldMessages } from './WorldMessages'
import { ShardGhost } from './ShardGhost'
import { DeployRegionBox } from './DeployRegionBox'
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

/**
 * A click or scrub inside an owned hyperspace view is a move within one view
 * of the world, not a change of subject, so the camera flies instead of
 * cutting. The stretched time constant does the flying; the cell bound keeps
 * a cross-space jump, whose start would be off in the dark anyway, an honest
 * cut.
 */
const GLIDE_TAU = 0.45
const GLIDE_SECONDS = 1.6
const GLIDE_MAX_CELLS = 300

function World(): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const pubkey = useCyberspace((s) => s.focusPubkey())
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  const win = useViewWindow()
  // The gibson K field is meaningless wallpaper while an Earth or hyperspace
  // view holds the camera, and its scans are real CPU: suspend both together.
  const hyperView = useHyperspace((s) => s.viewOwned || s.scrubHeight !== null)
  const volume = useTerrainVolume(win, axes, hyperView)
  const targets = useTargets()

  return (
    <group>
      {/* Runs before anything that reads travelOffset. */}
      <Travel axes={axes} />
      <TargetProjector axes={axes} targets={targets} />
      {/* At infinity, so it draws behind everything regardless of tree order. */}
      <BlackSun axes={axes} />
      {!hyperView && <ShaderPointField volume={volume} win={win} />}
      <Rooms axes={axes} />
      <SectorBox axes={axes} />
      <Earth axes={axes} />
      <CyberspaceLattice axes={axes} />
      <EarthPatch axes={axes} />
      {/* The hyperspace line's stops, placed true-size like the cage and the
          planet: ports in ideaspace, landfalls on Earth's surface. */}
      <StopField axes={axes} />
      <StopCubes axes={axes} />
      <StopBurst axes={axes} />
      <TransitAvatar axes={axes} />
      <RidePath axes={axes} />
      <CoveringBox axes={axes} />
      <CrossingFlash axes={axes} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
      <SpawnMarker pubkey={pubkey} axes={axes} />
      <TargetAvatars axes={axes} />
      <WorldShards axes={axes} />
      <WorldMessages axes={axes} />
      <ShardGhost axes={axes} />
      <DeployRegionBox axes={axes} />
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
  const lastCellPx = useRef<string | null>(null)
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
    // Writing the same value re-dirties style on the root element; with the
    // camera at rest that was a per-frame style pass for nothing.
    const next = `${(projScale / dist).toFixed(2)}px`
    if (next !== lastCellPx.current) {
      lastCellPx.current = next
      document.documentElement.style.setProperty('--cell-px', next)
    }
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
  const focusPoint = useCyberspace((s) => (s.focus ? s.focus.position.x.toString() : ''))
  // Scrubbing the chain moves the anchor along history. A step within the fly
  // bound glides there the way a hyperspace click does, and a step too far to
  // fly cuts, but neither touches the orbit you have chosen: re-framing
  // straight-on at START_DISTANCE on every step threw away the angle the user
  // was looking from, which is what made scrubbing a spectated chain snap.
  const exploreIndex = useCyberspace((s) => s.exploreIndex)
  const prevDeps = useRef<{ view: unknown; genesisId: unknown; focusPubkey: unknown; focusPoint: string; exploreIndex: number | null } | null>(null)
  // What the last rendered frame was anchored on. A chain step is judged
  // against this, not against the last effect run: a spectated chain arriving
  // moves the anchor (and can change plane) without any effect firing.
  const lastSeen = useRef<{ anchor: Position; plane: number; scaleExp: number } | null>(null)
  // The frame before the anchor last changed, and the frame after. A frame can
  // render between the store update and this effect, in which case lastSeen
  // already shows the new anchor and the old one is here.
  const lastChange = useRef<{ from: { anchor: Position; plane: number; scaleExp: number }; to: { anchor: Position; plane: number; scaleExp: number } } | null>(null)
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
  // Seconds of stretched follow left in a hyperspace fly-to, and the frame
  // the previous focus effect saw, so the next one can tell a move within
  // the same view from a change of subject.
  const glideLeft = useRef(0)
  // The camera's offset from its target as last drawn. A cut that keeps the
  // orbit reads it from here rather than from the controls at effect time: by
  // then the frame loop's origin shift has moved camera and target by the
  // whole change of anchor, and for a far change (another avatar, a universe
  // away at 2^0) both sit at the same astronomical coordinate with their
  // 26-unit difference gone to double precision. OrbitControls clamped that
  // zero offset to its minimum distance straight overhead: the avatar seen
  // from two units above, looking down.
  const lastOffset = useRef(new Vector3(0, 0, START_DISTANCE))

  // Re-framed on an axis snap and on a respawn. A respawn moves the render
  // origin home in one step, and the per-frame shift below would faithfully
  // carry the camera the same distance, which is the whole width of the axis:
  // the avatar would be at the origin and the camera 10^20 cells away. Treating
  // it as a fresh frame, like a zoom, is what puts you back at your spawn.
  useEffect(() => {
    const c = controls.current
    if (!c) return
    const s = useCyberspace.getState()
    const before = prevDeps.current
    prevDeps.current = { view, genesisId, focusPubkey, focusPoint, exploreIndex }
    // A chain step: only the explored index changed. Keep the orbit. Near
    // enough, the per-frame origin shift below carries the camera into the
    // new frame still looking at the old action and the stretched follow
    // eases it onto the new one; too far, cut to the new action with the
    // same offset from it that the camera had from the old.
    const stepOnly = before !== null && before.view === view && before.genesisId === genesisId &&
      before.focusPubkey === focusPubkey && before.focusPoint === focusPoint && before.exploreIndex !== exploreIndex
    const trace = (branch: string, extra: Record<string, unknown> = {}): void => {
      if (import.meta.env.DEV) (window as unknown as { __rigLast?: unknown }).__rigLast = { branch, stepOnly, before, exploreIndex, seenPlane: seen?.plane, plane: s.anchorPlane, seenScale: seen?.scaleExp, scale: s.scaleExp, ...extra }
    }
    const same = (a: { anchor: Position; plane: number; scaleExp: number }): boolean =>
      a.anchor.x === s.anchor.x && a.anchor.y === s.anchor.y && a.anchor.z === s.anchor.z && a.plane === s.anchorPlane && a.scaleExp === s.scaleExp
    // Where the camera was looking before this step: the last frame if it has
    // not rendered the new anchor yet, else the frame before the change.
    const last = lastSeen.current
    const seen = last === null ? null : !same(last) ? last : (lastChange.current !== null && same(lastChange.current.to) ? lastChange.current.from : null)
    const keptOffset = (): Vector3 => (lastOffset.current.lengthSq() >= 1 ? lastOffset.current.clone() : new Vector3(0, 0, START_DISTANCE))
    if (stepOnly && seen !== null) {
      // The plane is not part of the frame: the axes come from the camera and
      // the origin from the anchor, so a hop that lands in the other plane
      // has the same continuous path as any other and glides. Only its
      // content swaps under the camera.
      const sameFrame = seen.scaleExp === s.scaleExp
      const cells = sameFrame ? Math.max(
        Math.abs(cellDelta(s.anchor.x, seen.anchor.x, s.scaleExp)),
        Math.abs(cellDelta(s.anchor.y, seen.anchor.y, s.scaleExp)),
        Math.abs(cellDelta(s.anchor.z, seen.anchor.z, s.scaleExp)),
      ) : Infinity
      trace(cells === 0 ? 'step-none' : cells < GLIDE_MAX_CELLS ? 'step-glide' : 'step-cut', { cells, sameFrame })
      if (cells === 0) return
      if (cells < GLIDE_MAX_CELLS) {
        glideLeft.current = GLIDE_SECONDS
        locked.current = true
        return
      }
      const offset = keptOffset()
      const [x, y, z] = s.cursorOffset()
      glideLeft.current = 0
      smooth.current.set(x, y, z)
      c.target.copy(smooth.current)
      c.object.position.copy(smooth.current).add(offset)
      locked.current = true
      prevOrigin.current = null
      c.update()
      return
    }
    // A change of focus at the same zoom: a stop clicked from another, RETURN
    // to the avatar, a shard picked from the panel. Keep the orbit, exactly as
    // a chain step does: near enough, the per-frame origin shift below
    // carries the camera into the new frame still looking at the old point
    // and the stretched follow eases it onto the new one, which is the fly;
    // too far, cut to the new point with the same offset the camera had from
    // the old. This used to demand that hyperspace owned the view on both
    // sides of the change and that the zoom had not moved since the LAST
    // focus, so a stop clicked after any wheel zoom re-framed straight on
    // at the default distance instead: the scene jumped and the click read
    // as having gone nowhere. `seen` is frame-accurate, so a zoom in between
    // no longer disqualifies the fly; only a zoom in the same change does.
    // A change of spectated identity is not a change of focus: the two
    // avatars are a universe apart and there is no orbit worth keeping, so
    // SPECTATE and RETURN re-frame straight on, as boot does.
    const focusOnly = before !== null && before.view === view && before.genesisId === genesisId &&
      before.exploreIndex === exploreIndex && before.focusPubkey === focusPubkey && before.focusPoint !== focusPoint
    if (focusOnly && seen !== null && seen.scaleExp === s.scaleExp) {
      const cells = Math.max(
        Math.abs(cellDelta(s.anchor.x, seen.anchor.x, s.scaleExp)),
        Math.abs(cellDelta(s.anchor.y, seen.anchor.y, s.scaleExp)),
        Math.abs(cellDelta(s.anchor.z, seen.anchor.z, s.scaleExp)),
      )
      trace(cells === 0 ? 'focus-none' : cells < GLIDE_MAX_CELLS ? 'focus-glide' : 'focus-cut', { cells })
      if (cells === 0) return
      if (cells < GLIDE_MAX_CELLS) {
        glideLeft.current = GLIDE_SECONDS
        locked.current = true
        return
      }
      const offset = keptOffset()
      const [x, y, z] = s.cursorOffset()
      glideLeft.current = 0
      smooth.current.set(x, y, z)
      c.target.copy(smooth.current)
      c.object.position.copy(smooth.current).add(offset)
      locked.current = true
      prevOrigin.current = null
      c.update()
      return
    }
    trace('reframe')
    glideLeft.current = 0
    const [x, y, z] = s.cursorOffset()
    smooth.current.set(x, y, z)
    c.target.copy(smooth.current)
    c.object.position.set(x, y, z + START_DISTANCE)
    locked.current = true
    prevOrigin.current = null
    c.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, genesisId, focusPubkey, focusPoint, exploreIndex])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __rig?: unknown }).__rig = () => {
      const c = controls.current
      return c ? { position: c.object.position.toArray(), target: c.target.toArray() } : null
    }
  }, [])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    const s = useCyberspace.getState()
    lastOffset.current.copy(c.object.position).sub(c.target)
    // The anchor, not the position: in history the scene is drawn from the
    // action being looked at, and the camera has to ride that the same way it
    // rides a commit.
    const origin = alignedOrigin(s.anchor, s.scaleExp)
    const cur = { anchor: s.anchor, plane: s.anchorPlane, scaleExp: s.scaleExp }
    const was = lastSeen.current
    if (was !== null && (was.anchor.x !== cur.anchor.x || was.anchor.y !== cur.anchor.y || was.anchor.z !== cur.anchor.z || was.plane !== cur.plane || was.scaleExp !== cur.scaleExp)) {
      lastChange.current = { from: was, to: cur }
    }
    lastSeen.current = cur

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
    // than a fixed fraction so the rate does not change with frame rate. A
    // hyperspace fly-to stretches the time constant so the camera sails to
    // the selected stop instead of flicking.
    if (glideLeft.current > 0) glideLeft.current = Math.max(0, glideLeft.current - dt)
    const k = 1 - Math.exp(-dt / (glideLeft.current > 0 ? GLIDE_TAU : FOLLOW_TAU))
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

/**
 * One console line every 30 s: what the renderer holds and what the heap
 * weighs. A tab was seen at 10 GB after fifteen idle minutes and no probe here
 * reproduces it; this puts the numbers where the person who sees it can read
 * them. `localStorage.setItem('onosendai:memlog', '0')` silences it.
 */
function MemoryLog(): null {
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    try { if (localStorage.getItem('onosendai:memlog') === '0') return } catch { /* private mode: log anyway */ }
    const tick = (): void => {
      const m = gl.info.memory
      const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize
      console.info(`[mem] geometries=${m.geometries} textures=${m.textures} programs=${gl.info.programs?.length ?? 0}${heap ? ` heap=${Math.round(heap / 1048576)}MB` : ''}`)
    }
    const t = window.setInterval(tick, 30_000)
    return () => window.clearInterval(t)
  }, [gl])
  return null
}

/**
 * R3F zeroes the clock whenever the frameloop changes. Several things here
 * time themselves from clock.elapsedTime (fleet cube fades, the crossing
 * flash, a glide), so a pause would leave them waiting for a time that had
 * already passed. This keeps the last elapsed time seen and puts it back when
 * drawing resumes: to everything in the scene the pause never happened.
 */
function ClockKeeper(): null {
  const clock = useThree((s) => s.clock)
  const frameloop = useThree((s) => s.frameloop)
  const last = useRef(0)
  useFrame(() => { last.current = clock.elapsedTime })
  useEffect(() => { if (frameloop !== 'never' && last.current > 0) clock.elapsedTime = last.current }, [frameloop, clock])
  return null
}

export function Scene(): JSX.Element {
  // The workshop is an opaque, full-screen bench with its own canvas. Drawing
  // the world under it is pure cost, and on a phone it was most of the frame:
  // the bench measured 3 fps with the world running behind it.
  const covered = useWorkshop((s) => s.open)
  return (
    <Canvas
      camera={{ fov: 55, position: [0, 0, START_DISTANCE], near: 0.05, far: 6000 }}
      dpr={[1, 2]}
      // high-performance: ask for the discrete GPU and against power-save
      // clocking, so a visually quiet frame still ships on time.
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      style={{ background: BG }}
      frameloop={covered ? 'never' : 'always'}
    >
      <MemoryLog />
      <ClockKeeper />
      {/* Fog to pure black: the only distance cue in an otherwise empty field. */}
      <fog attach="fog" args={[0x000000, GRID_RADIUS * 0.9, GRID_RADIUS * 4]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 10, 10]} intensity={1.2} />
      <Rig />
      <CellMetric />
      <ScreenAxes />
      <World />
      {/* Camera-pinned, so it lives outside the world group: hyperspace is a
          state, not a place. Mounts only while riding or browsing the line. */}
      <HyperspaceCone />
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
