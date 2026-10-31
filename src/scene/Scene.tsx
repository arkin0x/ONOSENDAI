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
import { BlendFunction, Effect, type BloomEffect, type EffectComposer as PostComposer } from 'postprocessing'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { applyLensShift, lensShift, stepShift, uncoveredBand, type Cover } from '../lib/coverBand'
import { readCovers, setCoverWatch } from '../hooks/useCover'
import { useBuilder } from '../store/useBuilder'
import { watchContext } from '../lib/glContext'
import { broadcastDpr, isBroadcast, isPortraitBroadcast, portraitFov, recoverLostContext } from '../lib/tv/broadcast'
import { keepPrograms } from '../lib/keepPrograms'
import { BG } from '../lib/palette'
import { GRID_RADIUS, cellDelta, claimScreenAxes, levelScreenAxes, originShift, renderDirection, viewAxes, type Position } from '../lib/space'
import { carryOrbit } from '../lib/zoomOrbit'
import { AVATAR_LERP_MS, lerpRemaining } from '../lib/avatarLerp'
import { walkEye, walkFall } from '../lib/walkEye'
import { carryLook, clearWalkLook, lookRadPerPx, takeKeepWalkLook, takeWalkLook, walkLookBy } from '../lib/walkLook'
import { tickFall, useWalk } from '../store/useWalk'
import { orbitOffset } from '../workshop/benchAxes'
import { WalkProbe } from './WalkProbe'
import { commitAnchor, commitScale, committedAnchor } from '../lib/renderFrame'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { cameraPose } from '../lib/cameraPose'
import { useTerrainVolume } from '../hooks/useTerrainVolume'
import { useHyperspace } from '../store/useHyperspace'
import { useWorkshop } from '../store/useWorkshop'
import { useLayers } from '../store/useLayers'
import { useViewWindow } from '../hooks/useViewWindow'
import { useTargets } from '../hooks/useTargets'
import { Avatar } from './Avatar'
import { BlackSun } from './BlackSun'
import { CoveringBox } from './CoveringBox'
import { CrossingFlash } from './CrossingFlash'
import { Earth } from './Earth'
import { EarthPatch } from './EarthPatch'
import { SphereOfInterest } from './SphereOfInterest'
import { EarthPin } from './EarthPin'
import { interestSphere, sphereFrameDistance } from '../lib/hyperspace/interest'
import { Cursor } from './Cursor'
import { HyperspaceCone } from './HyperspaceCone'
import { CyberspaceLattice } from './CyberspaceLattice'
import { StopField } from './StopField'
import { StopCubes } from './StopCubes'
import { StopBurst } from './StopBurst'
import { TourLine } from './TourLine'
import { useDemo } from '../store/useDemo'
import { TourCameraState } from '../demo/tourDistance'
import { TransitAvatar } from './TransitAvatar'
import { RidePath } from './RidePath'
import { PathTrail } from './PathTrail'
import { GameRegionBox } from './GameRegionBox'
import { PrefixRegionBox } from './PrefixRegionBox'
import { Rooms } from './Rooms'
import { SectorBox } from './SectorBox'
import { ShaderPointField } from './ShaderPointField'
import { SecretRegions } from './SecretRegions'
import { SpawnMarker } from './SpawnMarker'
import { TargetAvatars } from './TargetAvatars'
import { PresenceAvatars } from './PresenceAvatars'
import { WorldShards } from './WorldShards'
import { WorldMessages } from './WorldMessages'
import { ChestLooks } from './ChestLooks'
import { HiddenAudio } from './HiddenAudio'
import { StarredMarks } from './StarredMarks'
import { ShardGhost } from './ShardGhost'
import { DeployRegionBox } from './DeployRegionBox'
import { StepBox } from './StepBox'
import { ChatRoomBox } from './ChatRoomBox'
import { TargetProjector } from './TargetProjector'
import { Travel } from './Travel'
import { TvLayer } from './TvLayer'
import { TvScreenEffect } from './TvScreenEffect'
import { useTv } from '../store/useTv'
import { CAMERA_NEAR, FOV } from './camera'
import { headlampReach, headlampUniforms } from './headlamp'
import { canvasPixels, composerSamples } from './composerBudget'

/** Starting distance from the cursor, in cells. Orbit takes over from here. */
const START_DISTANCE = 26


/**
 * Where a reframe puts the camera: the usual 26 cells, or far enough out for
 * the whole sphere of interest to be in shot when there is one
 * (interest.sphereFrameDistance, about 69 cells). Without this the ring was
 * drawn 32 cells from the centre while the camera framed 13.5, so the
 * boundary of the lit region was always outside the picture and the cut
 * looked like missing data, which is the thing the ring exists to prevent.
 * Clamped to the orbit's own limit so the camera never starts somewhere it
 * cannot be dollied back to.
 */
function startDistance(hasSphere: boolean): number {
  if (!hasSphere) return START_DISTANCE
  return Math.min(GRID_RADIUS * 4, sphereFrameDistance(FOV))
}

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

/**
 * Records the anchor the scene is being drawn against, in the commit that
 * draws it (lib/renderFrame.ts). First in World, so its layout effect runs
 * in the same commit as every mesh placed against the anchor.
 */
function FrameCommit(): null {
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  useLayoutEffect(() => { commitAnchor(anchor) }, [anchor])
  useLayoutEffect(() => { commitScale(scaleExp) }, [scaleExp])
  return null
}

function World(): JSX.Element {
  const view = useCyberspace((s) => s.view)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const pubkey = useCyberspace((s) => s.focusPubkey())
  const axes = useMemo(() => useCyberspace.getState().axes(), [view])

  const win = useViewWindow()
  // The gibson K field is meaningless wallpaper while an Earth or hyperspace
  // view holds the camera, and its scans are real CPU: suspend both together.
  const hyperView = useHyperspace((s) => s.viewOwned || s.scrubHeight !== null)
  // The two layers the View panel can turn off (store/useLayers).
  // The dots switched off suspend exactly as a hyperspace view does: no scans,
  // no terrain runs queued, no per-frame uniforms. Only drawing changes.
  const dotsOn = useLayers((s) => s.dots)
  const boxesOn = useLayers((s) => s.boxes)
  const dotsIdle = hyperView || !dotsOn
  const volume = useTerrainVolume(win, axes, dotsIdle)
  const targets = useTargets()
  // Cyberspace TV draws the tape, not today: the space itself stays, and
  // everything that is about now (you, your cursor, the people here, what
  // you have found) steps aside for the avatars on tape (TvLayer).
  const tv = useTv((s) => s.on)

  if (tv) {
    return (
      <group>
        <FrameCommit />
        <BlackSun axes={axes} />
        {!dotsIdle && <ShaderPointField volume={volume} win={win} />}
        {boxesOn && <Rooms axes={axes} />}
        <SectorBox axes={axes} />
        <Earth axes={axes} />
        <CyberspaceLattice axes={axes} />
        <TvLayer axes={axes} />
      </group>
    )
  }

  return (
    <group>
      <FrameCommit />
      {/* Runs before anything that reads travelOffset. */}
      <Travel axes={axes} />
      <TargetProjector axes={axes} targets={targets} />
      {/* Hidden audio sounding where it is hidden, heard at the camera (DECK-0007). */}
      <HiddenAudio axes={axes} />
      {/* At infinity, so it draws behind everything regardless of tree order. */}
      <BlackSun axes={axes} />
      {!dotsIdle && <ShaderPointField volume={volume} win={win} />}
      {boxesOn && <Rooms axes={axes} />}
      <SectorBox axes={axes} />
      <Earth axes={axes} />
      <CyberspaceLattice axes={axes} />
      <EarthPatch axes={axes} />
      <SphereOfInterest axes={axes} />
      <EarthPin axes={axes} />
      {/* The hyperspace line's stops, placed true-size like the cage and the
          planet: ports in ideaspace, landfalls on Earth's surface. */}
      <StopField axes={axes} />
      <StopCubes axes={axes} />
      <StopBurst axes={axes} />
      <TourLine axes={axes} />
      <TransitAvatar axes={axes} />
      <RidePath axes={axes} />
      <CoveringBox axes={axes} />
      <CrossingFlash axes={axes} />
      <PathTrail axes={axes} scaleExp={scaleExp} />
      <GameRegionBox axes={axes} />
      <PrefixRegionBox axes={axes} />
      <SpawnMarker pubkey={pubkey} axes={axes} />
      <TargetAvatars axes={axes} />
      <PresenceAvatars axes={axes} />
      <WorldShards axes={axes} />
      <WorldMessages axes={axes} />
      <ChestLooks axes={axes} />
      <StarredMarks axes={axes} />
      <ShardGhost axes={axes} />
      <DeployRegionBox axes={axes} />
      <StepBox axes={axes} />
      <ChatRoomBox axes={axes} />
      <SecretRegions axes={axes} />
      <Cursor axes={axes} />
      <Avatar />
      {import.meta.env.DEV && <WalkProbe axes={axes} />}
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
    // asserted without a camera. Under GRAVITY in WALK the keys are level
    // (levelScreenAxes): looking down a stair never turns W into down.
    const screen = useCyberspace.getState().walking && useWalk.getState().gravity
      ? levelScreenAxes(right.current, up.current, out.current, axes)
      : claimScreenAxes(right.current, up.current, out.current, axes)
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
      const w = window as unknown as { __scene?: unknown; __camera?: unknown; __gl?: unknown }
      w.__scene = state.scene
      // The renderer, for renderer.info: what a memory soak counts.
      w.__gl = state.gl
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
 * When HeadlampRig reads the camera: after everything that moves it (the Rig
 * at 0, Cyberspace TV's camera at 0.5, TvLayer) and before the composer draws
 * the frame at 1. At 0 it read TV's camera a frame late, so the first frame
 * after every cut was shaded for the shot before it (review of #456).
 */
const HEADLAMP_PRIORITY = 0.75

/**
 * Keeps the world's headlamp (scene/headlamp.ts) in step: on or off with the
 * View panel's switch, and its reach the camera's distance from what it looks
 * at (the orbit's target, which Cyberspace TV's camera drives too). Two
 * numbers written into the uniforms every headlamp material shares; nothing
 * is allocated and no material is touched.
 */
function HeadlampRig(): null {
  const on = useLayers((s) => s.headlamp)
  // In the commit, before any frame is drawn: a switch saved off never shows one frame on.
  useLayoutEffect(() => { headlampUniforms.uHeadlamp.value = on ? 1 : 0 }, [on])
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3 } | null
  useFrame((state) => {
    if (!controls) return
    headlampUniforms.uHeadlampReach.value = headlampReach(state.camera.position.distanceTo(controls.target))
  }, HEADLAMP_PRIORITY)
  return null
}

/**
 * When LensShift sets the projection: before anything else in the frame. It
 * reads only the covers and the canvas, never the camera's pose, and running
 * first means everything that projects this frame (the target markers, the
 * labels, a tap) sees the projection the frame is drawn with.
 */
const LENS_PRIORITY = -1
/**
 * Time constant of the framing's glide, in seconds: a panel opening, closing
 * or growing slides the picture to its new middle rather than jumping it.
 */
const LENS_TAU = 0.14
const NO_SHIFT = { x: 0, y: 0 }

/**
 * The upright stream's camera (lib/tv/broadcast isPortraitBroadcast): as wide
 * across as the 16:9 stream's camera is from top to bottom (portraitFov), so
 * a shot frames its subject across the narrow frame as it does on the wide
 * one and the tall frame fills with the world above and below. Mounted on
 * that stream alone; everywhere else the camera keeps FOV.
 */
function PortraitLens(): null {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  useLayoutEffect(() => {
    if (!camera.isPerspectiveCamera || !(height > 0)) return
    camera.fov = portraitFov(FOV, width / height)
    camera.updateProjectionMatrix()
  }, [camera, width, height])
  return null
}

/**
 * Frames the orbit's focus in the middle of what the HUD leaves uncovered,
 * in BUILD (arkinox, 2026-10-25: the build cursor sat on the deploy bar's top
 * edge on a phone, with the shard being placed hidden under it).
 *
 * A lens shift, not a camera move (lib/coverBand.ts): the picture slides, the
 * camera and the orbit stay exactly as they are, so a drag turns about the
 * same point and nothing in the world moves. The covers are the overlays that
 * opted in (hooks/useCover.ts), measured outside the frame loop; this only
 * reads them, and they are measured only while the shift is in use
 * (setCoverWatch). Off outside BUILD, in WALK (the eye looks where you face)
 * and on Cyberspace TV, whose picture and stream are composed centred: TV
 * drops the shift at once rather than gliding.
 *
 * It holds still while a finger or the mouse drags the scene (an orbit or a
 * pinch) and glides to wherever the framing should be once the drag lets go:
 * a cover that moves mid-drag (the pad lifting, caught by the next measure up
 * to half a second late) never slides the picture under the finger (review of
 * #505).
 */
function LensShift(): null {
  const shift = useRef({ x: 0, y: 0 })
  // The target, worked out again only when the covers or the canvas change.
  const aim = useRef<{ covers: readonly Cover[]; size: unknown; target: { x: number; y: number } } | null>(null)
  const watched = useRef(false)
  useEffect(() => () => { setCoverWatch(false) }, [])
  // The workshop stops this canvas's frames (frameloop "never"), so the frame
  // below never sees BUILD end under it: stop measuring here while the bench
  // is open, and the next frame after it closes starts again (review of #508).
  const benchOpen = useWorkshop((s) => s.open)
  useEffect(() => { if (benchOpen && watched.current) { watched.current = false; setCoverWatch(false) } }, [benchOpen])
  // The pointers dragging the scene now: down on the canvas, until they lift.
  // On the document in the capture phase, as the walk look listens, so a
  // release over the HUD or one a HUD handler stops still ends the hold.
  const dragging = useRef(new Set<number>())
  const surface = useThree((s) => (s.events.connected as HTMLElement | null | undefined | false) || s.gl.domElement)
  useEffect(() => {
    const held = dragging.current
    const down = (e: PointerEvent): void => { held.add(e.pointerId) }
    const up = (e: PointerEvent): void => { held.delete(e.pointerId) }
    // A mouse release this never heard (let go off the page) must not hold the framing.
    const move = (e: PointerEvent): void => { if (e.pointerType === 'mouse' && e.buttons === 0) held.delete(e.pointerId) }
    const clear = (): void => { held.clear() }
    const doc = surface.ownerDocument
    surface.addEventListener('pointerdown', down)
    doc.addEventListener('pointerup', up, true)
    doc.addEventListener('pointercancel', up, true)
    doc.addEventListener('pointermove', move, true)
    window.addEventListener('blur', clear)
    return () => {
      surface.removeEventListener('pointerdown', down)
      doc.removeEventListener('pointerup', up, true)
      doc.removeEventListener('pointercancel', up, true)
      doc.removeEventListener('pointermove', move, true)
      window.removeEventListener('blur', clear)
      held.clear()
    }
  }, [surface])
  useFrame((state, dt) => {
    const cam = state.camera as PerspectiveCamera
    if (!cam.isPerspectiveCamera) return
    const { width, height, left, top } = state.size
    const tv = useTv.getState().on || isBroadcast()
    const on = !tv && useBuilder.getState().active && !useCyberspace.getState().walking
    if (on !== watched.current) { watched.current = on; setCoverWatch(on) }
    let target = NO_SHIFT
    if (on) {
      const covers = readCovers()
      const a = aim.current
      if (a && a.covers === covers && a.size === state.size) target = a.target
      else {
        // The covers are in viewport pixels; the band is in the canvas's.
        const local = left === 0 && top === 0 ? covers : covers.map((c) => ({ edge: c.edge, box: { left: c.box.left - left, top: c.box.top - top, right: c.box.right - left, bottom: c.box.bottom - top } }))
        target = lensShift(width, height, uncoveredBand(width, height, local))
        aim.current = { covers, size: state.size, target }
      }
    }
    const s = shift.current
    if (tv) { s.x = 0; s.y = 0 } else stepShift(s, target, dt, LENS_TAU, dragging.current.size > 0)
    applyLensShift(cam, width, height, s)
  }, LENS_PRIORITY)
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
/** The orbit's closest approach outside WALK, in render cells. */
const ORBIT_MIN_DISTANCE = 2
/**
 * The WALK eye's distance from the avatar's centre, in render cells: as good
 * as at it, and far enough off it that the orbit still has a direction to
 * turn about.
 */
const WALK_EYE = 0.001
/** Scratch for the eye's line of sight, so the frame loop allocates nothing. */
const walkDir = new Vector3()
/** Where cyberspace +Y points in the render frame of a view: worked out once per view, for a fall. */
let upFor: { view: Quaternion | null; dir: [number, number, number] } = { view: null, dir: [0, 1, 0] }
function renderUp(view: Quaternion): [number, number, number] {
  if (upFor.view !== view) upFor = { view, dir: renderDirection(viewAxes(view), 'y') }
  return upFor.dir
}

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
  // Whether the last change of focus also moved the anchor, read off the
  // store change itself (the subscription below), which is the one place
  // that can tell "VIEW began where you stand" from "VIEW began somewhere
  // else and a frame has already rendered it".
  const focusMovedAnchor = useRef(true)
  useEffect(() => useCyberspace.subscribe((st, prev) => {
    if (st.focus === prev.focus) return
    focusMovedAnchor.current = !(st.anchor.x === prev.anchor.x && st.anchor.y === prev.anchor.y && st.anchor.z === prev.anchor.z && st.anchorPlane === prev.anchorPlane)
  }), [])
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
    minDistance: number
    enableZoom: boolean
    enableRotate: boolean
  } | null>(null)
  // WALK's first person (store/useWalk.ts): whether the last frame was
  // walking, and the eye's glide into the avatar or back out of it, as
  // distances from the target. `outTo` is the orbit distance WALK was
  // entered from, which is where leaving it puts the camera back.
  const walkWas = useRef(false)
  // WALK's look direction, from the eye outward to the camera: kept between
  // frames so only the walker's own turning changes it.
  const walkLook = useRef<Vector3 | null>(null)
  const eye = useRef<{ from: number; to: number; t0: number } | null>(null)
  const outTo = useRef(START_DISTANCE)
  // The view the last frame was drawn in, for a look kept through a change of view (GRAVITY's level).
  const drawnView = useRef<Quaternion | null>(null)

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
  // The orbit to land a cut with: the one the camera had, unless it has
  // collapsed, in which case the standard framing distance straight on.
  const keptOffset = (): Vector3 => (lastOffset.current.lengthSq() >= 1 ? lastOffset.current.clone() : new Vector3(0, 0, START_DISTANCE))

  // A /demo step's own camera (DemoScene.distance and faceFrom; useDemo
  // tourCamera): the step's camera, the distance owed back when the tour
  // moves on, and the move still to make (demo/tourDistance.ts).
  const tourCam = useMemo(() => new TourCameraState(), [])
  useEffect(() => {
    const check = (d: ReturnType<typeof useDemo.getState>): void => { tourCam.step(d.active ? d.camera : null, lastOffset.current.length()) }
    check(useDemo.getState())
    return useDemo.subscribe(check)
  }, [tourCam])
  // The rig re-framed on its own (a cut or a straight-on reframe): the step's
  // camera comes back only when the view has just arrived at the step's own
  // place. A block landing late reframed straight on, which put the camera on
  // the far side of Earth from it (arkinox, 2026-10-27); but a stop tapped
  // elsewhere, or a reframe while the view was already there, keeps the
  // visitor's own pinch and angle (review of #523).
  const reposeTour = (arrived: boolean): void => { tourCam.reframed(arrived, useCyberspace.getState().focus?.position ?? null) }

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
    // The view arrived somewhere new in this change (for the tour's camera).
    const arrived = before === null || before.focusPubkey !== focusPubkey || before.focusPoint !== focusPoint
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
      reposeTour(arrived)
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
    // A focus that begins or ends where the scene already stands: VIEW
    // turned on or off at your head, which anchors the view exactly where you
    // are. Nothing moved, so the camera stays exactly as it was, orbit and
    // all; a zoom VIEW's end restores is carried by the frame loop below
    // like any other zoom. It used to fall through to the re-frame whenever
    // no move had been seen yet, snapping the camera straight on (arkinox,
    // 2026-10-13: "when I activate the View button, it switches my camera").
    if (focusOnly && !focusMovedAnchor.current) {
      trace('focus-in-place')
      return
    }
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
      reposeTour(arrived)
      return
    }
    trace('reframe')
    glideLeft.current = 0
    const [x, y, z] = s.cursorOffset()
    smooth.current.set(x, y, z)
    c.target.copy(smooth.current)
    c.object.position.set(x, y, z + startDistance(interestSphere(s.focus, s.scaleExp) !== null))
    locked.current = true
    prevOrigin.current = null
    c.update()
    reposeTour(arrived)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, genesisId, focusPubkey, focusPoint, exploreIndex])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as { __rig?: unknown }).__rig = () => {
      const c = controls.current
      return c ? { position: c.object.position.toArray(), target: c.target.toArray() } : null
    }
  }, [])

  // WALK's look is the rig's own (lib/walkLook.ts): a drag on the scene, by
  // mouse, finger or pen, is spent on the line of sight below, at a gain set
  // per screen width. OrbitControls turns nothing in WALK; it scaled a drag
  // by the screen's height and lost most of it (arkinox, 2026-10-23: "it
  // takes wayyyy to much dragging to look around while in WALK mode").
  // One pointer on the scene at a time, as OrbitControls had it: a second
  // finger on the scene ends the turn rather than jumping it. A finger
  // holding a pad key is not on the scene, so a thumb can walk while the
  // other looks; that is why this does not ask for the primary pointer.
  const surface = useThree((s) => (s.events.connected as HTMLElement | null | undefined | false) || s.gl.domElement)
  useEffect(() => {
    let held: { id: number; x: number; y: number } | null = null
    const down = (e: PointerEvent): void => {
      // The same pointer down again means its release was missed: a new drag.
      if (held && e.pointerId !== held.id) { held = null; return }
      if (!useCyberspace.getState().walking || (e.pointerType === 'mouse' && e.button !== 0)) return
      held = { id: e.pointerId, x: e.clientX, y: e.clientY }
    }
    const move = (e: PointerEvent): void => {
      if (!held || e.pointerId !== held.id) return
      // A release this listener never heard (the button let go off the page)
      // must not leave a bare mouse turning the view.
      if (!useCyberspace.getState().walking || (e.pointerType === 'mouse' && (e.buttons & 1) === 0)) { held = null; return }
      walkLookBy(e.clientX - held.x, e.clientY - held.y)
      held.x = e.clientX
      held.y = e.clientY
    }
    const up = (e: PointerEvent): void => { if (held && e.pointerId === held.id) held = null }
    surface.addEventListener('pointerdown', down)
    // On the document, as OrbitControls listens: the drag keeps turning when
    // it passes over the HUD, until the pointer lifts. In the capture phase,
    // so no HUD handler that stops a release can strand the drag.
    const doc = surface.ownerDocument
    doc.addEventListener('pointermove', move, true)
    doc.addEventListener('pointerup', up, true)
    doc.addEventListener('pointercancel', up, true)
    return () => {
      surface.removeEventListener('pointerdown', down)
      doc.removeEventListener('pointermove', move, true)
      doc.removeEventListener('pointerup', up, true)
      doc.removeEventListener('pointercancel', up, true)
    }
  }, [surface])

  useFrame((state, dt) => {
    const c = controls.current
    if (!c) return
    // GRAVITY's fall (store/useWalk.ts) takes its frame first: it can land,
    // which moves the cursor read below.
    tickFall()
    const s = useCyberspace.getState()
    lastOffset.current.copy(c.object.position).sub(c.target)
    // The anchor, not the position: in history the scene is drawn from the
    // action being looked at, and the camera has to ride that the same way it
    // rides a commit.
    // The anchor the meshes on screen were placed against, which a landing
    // moves a commit after the store (lib/renderFrame.ts). The frame change
    // is absorbed when the scene makes it, not before.
    const drawnAnchor = committedAnchor() ?? s.anchor
    const origin = alignedOrigin(drawnAnchor, s.scaleExp)
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
    // The target in the drawn frame: cursorOffset works against the store's
    // anchor, so it is carried back by however far that is ahead.
    const live = s.cursorOffset()
    const lag = drawnAnchor === s.anchor ? null : originShift(alignedOrigin(s.anchor, s.scaleExp), origin, s.scaleExp, s.axes())
    let tx = live[0] + (lag ? lag[0] : 0)
    let ty = live[1] + (lag ? lag[1] : 0)
    let tz = live[2] + (lag ? lag[2] : 0)
    // In a fall the eye is above or below the cursor (the point the fall
    // left off from), along cyberspace Y, and follows that height exactly.
    const falling = s.walking && walkFall.active
    const up = falling ? renderUp(s.view) : null
    if (up) {
      const k = walkFall.offset / 2 ** s.scaleExp
      tx += up[0] * k
      ty += up[1] * k
      tz += up[2] * k
    }
    if (prevOrigin.current && prevScale.current === s.scaleExp) {
      const shift = originShift(prevOrigin.current, origin, s.scaleExp, s.axes())
      if (Math.max(Math.abs(shift[0]), Math.abs(shift[1]), Math.abs(shift[2])) >= GLIDE_MAX_CELLS) {
        // Too far to fly: a cut, the same one the effect above makes for a
        // chain step that far. This path is for the anchor changes that do
        // not pass through the effect, whose dependencies are the framing
        // and the explored link, not the anchor: a spectated chain arriving
        // with its head a universe from the spawn the rig framed first (a
        // traveller's hops and hyperjumps add up to 1e22 cells), or a friend
        // watched live making a hop. Shifting the camera that far and easing
        // it back was not a fly. At 1e22 a double cannot hold the 26-unit
        // orbit: the offset rounded to zero, OrbitControls clamped it to its
        // 2-unit minimum straight overhead, and the target then sailed home
        // over five seconds with the camera stuck there. That was the
        // close-up from above that greeted every spectation of a
        // well-travelled avatar.
        glideLeft.current = 0
        smooth.current.set(tx, ty, tz)
        c.object.position.copy(smooth.current).add(keptOffset())
        locked.current = true
      } else if (shift[0] !== 0 || shift[1] !== 0 || shift[2] !== 0) {
        c.object.position.x += shift[0]
        c.object.position.y += shift[1]
        c.object.position.z += shift[2]
        smooth.current.x += shift[0]
        smooth.current.y += shift[1]
        smooth.current.z += shift[2]
      }
    }

    // A zoom rescales every render coordinate, so there is no continuous path
    // between the old framing and the new one to ease along.
    if (prevScale.current !== s.scaleExp) {
      // The target can land somewhere new in the rescaled frame: your true
      // position from CONTINUOUS_SCALE_MIN up, the cursor's rescaled offset
      // when it is away from you. The camera carries by exactly that jump,
      // locked or not, so the orbit's distance and angle survive every zoom
      // (lib/zoomOrbit.ts; arkinox, 2026-10-01). On the first frame there is
      // no previous framing to keep.
      if (prevScale.current >= 0) {
        const [x, y, z] = carryOrbit(
          [c.object.position.x, c.object.position.y, c.object.position.z],
          [smooth.current.x, smooth.current.y, smooth.current.z],
          [tx, ty, tz],
        )
        c.object.position.set(x, y, z)
      }
      smooth.current.set(tx, ty, tz)
    }

    prevOrigin.current = origin
    prevScale.current = s.scaleExp

    // Cursor movement, by contrast, IS motion, and eases. Exponential rather
    // than a fixed fraction so the rate does not change with frame rate. A
    // hyperspace fly-to stretches the time constant so the camera sails to
    // the selected stop instead of flicking.
    if (glideLeft.current > 0) glideLeft.current = Math.max(0, glideLeft.current - dt)
    const k = 1 - Math.exp(-dt / (glideLeft.current > 0 ? GLIDE_TAU : FOLLOW_TAU))
    let dx = (tx - smooth.current.x) * k
    let dy = (ty - smooth.current.y) * k
    let dz = (tz - smooth.current.z) * k
    // Falling, the height is not eased: the eye is where the fall is.
    if (up) {
      if (up[0] !== 0) dx = tx - smooth.current.x
      if (up[1] !== 0) dy = ty - smooth.current.y
      if (up[2] !== 0) dz = tz - smooth.current.z
    }

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

    // WALK: the eye glides into the avatar on the way in and back out to the
    // orbit it came from on the way out, along the line it is looking down,
    // so the view never turns. While walking it is held there every frame: a
    // drag turns the camera about its own eye (an orbit this small IS turning
    // your head), and a re-frame above is undone on the next frame.
    if (s.walking !== walkWas.current) {
      walkWas.current = s.walking
      const from = c.object.position.distanceTo(smooth.current)
      if (s.walking) outTo.current = from >= 2 ? from : START_DISTANCE
      eye.current = { from, to: s.walking ? WALK_EYE : outTo.current, t0: performance.now() }
      c.enableZoom = !s.walking
      c.enableRotate = !s.walking
      clearWalkLook()
      walkLook.current = null
    }
    // GRAVITY levelled the view: the look turns with it, so you face the
    // same way in cyberspace (lib/walkLook.ts keepWalkLook).
    if (drawnView.current !== s.view) {
      if (takeKeepWalkLook() && drawnView.current && s.walking && walkLook.current) carryLook(walkLook.current, viewAxes(drawnView.current), viewAxes(s.view))
      drawnView.current = s.view
    }
    if (eye.current) {
      const t = (performance.now() - eye.current.t0) / AVATAR_LERP_MS
      const d = eye.current.to + (eye.current.from - eye.current.to) * lerpRemaining(t)
      // In WALK the direction you look is yours alone: the one the last frame
      // ended on, which only your own turning (the controls' update below)
      // changes. Read off the camera instead, anything that moved the camera
      // between frames turned your head with it: a reframe or a cut puts the
      // camera straight on at an orbit distance, and from inside the avatar
      // that read as the view snapping to the chain's frame as a step landed
      // (arkinox, 2026-10-13).
      const along = s.walking && walkLook.current ? walkDir.copy(walkLook.current) : walkDir.copy(c.object.position).sub(smooth.current)
      if (along.lengthSq() === 0) along.set(0, 0, 1)
      if (s.walking && walkLook.current) {
        const [lx, ly] = takeWalkLook(dt)
        if (lx !== 0 || ly !== 0) along.copy(orbitOffset(along, lx, ly, lookRadPerPx(state.size.width)))
      }
      c.object.position.copy(smooth.current).addScaledVector(along.normalize(), d)
      c.minDistance = Math.min(ORBIT_MIN_DISTANCE, d * 0.5)
      locked.current = true
      if (t >= 1 && !s.walking) { eye.current = null; c.minDistance = ORBIT_MIN_DISTANCE }
    }
    walkEye.copy(smooth.current)

    c.target.copy(smooth.current)
    // The tour's camera for this step, once, as a pinch would leave it: at
    // its distance, from its side when it has one (cyberspace x, y, z put
    // into the view's render axes, as Earth is placed), else along the line
    // the camera already looks down. Not in WALK or while the eye glides out
    // of it, whose eye owns the distance: the move waits for it (review of
    // #523). The next frame's offset is this one, so a cut keeps it too.
    const want = tourCam.take(!s.walking && !eye.current)
    if (want !== null) {
      const along = walkDir.copy(c.object.position).sub(c.target)
      if (want.dir) {
        const axes = s.axes()
        const comp = { x: want.dir[0], y: want.dir[1], z: want.dir[2] }
        along.set(comp[axes.right.axis] * axes.right.dir, comp[axes.up.axis] * axes.up.dir, comp[axes.out.axis] * axes.out.dir)
      }
      if (along.lengthSq() === 0) along.set(0, 0, 1)
      c.object.position.copy(c.target).addScaledVector(along.normalize(), Math.min(GRID_RADIUS * 4, Math.max(ORBIT_MIN_DISTANCE, want.distance)))
      lastOffset.current.copy(c.object.position).sub(c.target)
    }
    c.update()
    if (s.walking) (walkLook.current ??= new Vector3()).copy(c.object.position).sub(c.target).normalize()
  })

  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enablePan={false}
      minDistance={ORBIT_MIN_DISTANCE}
      maxDistance={GRID_RADIUS * 4}
      dampingFactor={0.12}
      onStart={() => { locked.current = false }}
    />
  )
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

/**
 * The last word on a tagged texel: alpha 1. The tag (colour with alpha 0)
 * is valid inside the composer's buffers but not on the canvas, which
 * composites premultiplied: a compositor is free to clamp colour to alpha,
 * and one did, drawing the faces black except where a halo lent them some.
 * Merged into the bloom's own pass by postprocessing, so it costs nothing.
 * Only the tag is touched; every other texel leaves exactly as it came.
 */
const OPAQUE_TAGGED_FRAGMENT = `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 o = texture(inputBuffer, uv);
  float tagged = step(o.a, 0.0) * step(0.0005, max(o.r, max(o.g, o.b)));
  outputColor = vec4(inputColor.rgb, max(inputColor.a, tagged));
}`
class OpaqueTaggedEffect extends Effect {
  constructor() {
    super('OpaqueTagged', OPAQUE_TAGGED_FRAGMENT, { blendFunction: BlendFunction.SET })
  }
}

/** The luminance line the bloom ships with, and the same line blind to tagged texels. */
const LUMINANCE_LINE = 'float l=luminance(texel.rgb);'
const LUMINANCE_TAG_AWARE = 'float l=luminance(texel.rgb)*step(0.0005,texel.a);'

/**
 * The bloom, blind to the world's shard faces.
 *
 * Those faces write their colour with alpha 0 (ShardMesh `world`), a tag
 * nothing else in the frame carries: everything visible writes alpha above
 * zero, and the untouched background is black. The bloom's luminance pass,
 * patched here, treats a tagged texel as dark, so the faces draw at their
 * own colours, as on the bench, while every line, ring, label and point
 * field blooms exactly as it always has: same numbers, same passes, no depth
 * texture, nothing drawn twice. The canvas composites premultiplied, which is
 * how the bloom's own halos already show over alpha-0 background, so a
 * tagged texel shows its colour too.
 */
function WorldBloom(): JSX.Element {
  // The wrapper types its ref as the class; what it holds is the instance.
  const ref = useRef<typeof BloomEffect>(null)
  // After every render, not once: the wrapper rebuilds its effect when a prop changes.
  useEffect(() => {
    const m = (ref.current as unknown as BloomEffect | null)?.luminanceMaterial
    if (!m || m.userData.tagAware) return
    if (!m.fragmentShader.includes(LUMINANCE_LINE)) {
      console.warn('[bloom] the luminance shader is not the one expected; shard faces will bloom')
      m.userData.tagAware = true
      return
    }
    m.fragmentShader = m.fragmentShader.replace(LUMINANCE_LINE, LUMINANCE_TAG_AWARE)
    m.userData.tagAware = true
    m.needsUpdate = true
  })
  const opaque = useMemo(() => new OpaqueTaggedEffect(), [])
  return (
    <>
      <Bloom ref={ref} mipmapBlur levels={3} intensity={2.6} luminanceThreshold={0.001} luminanceSmoothing={0} />
      <primitive object={opaque} />
    </>
  )
}

/**
 * The composer's buffers hand on their colour only.
 *
 * The scene is drawn into a multisampled buffer, and before the bloom can
 * read it, three resolves it into a plain one: by default the depth and the
 * stencil too. Nothing after the scene's own draw reads either (the shard
 * faces' stencil tag does its work inside that draw, ShardMesh
 * FACE_TAG_STENCIL), so resolving them was pure cost, and on Windows a
 * heavy one: Direct3D 11 cannot resolve a multisampled stencil on the GPU,
 * so ANGLE draws it (and the depth with it) out, copies it to a staging
 * texture, waits for the GPU to read it back, repacks it pixel by pixel on
 * the CPU and uploads it again, every frame (three.js #27799; ANGLE
 * Blit11::resolveStencil). On an Android phone the same resolve is one blit
 * on the GPU, likely why the main view was smooth there and laboured on a
 * Windows laptop (arkinox, 2026-10-20: "on my laptop the perf has improved
 * but it still isn't great"). Both buffers, since TV's tube makes the bloom
 * draw into the second one.
 *
 * An effect that reads depth (depth of field, SSAO, a normal pass, anything
 * with EffectAttribute.DEPTH) would get the composer's depth from the plain
 * buffer, which this leaves unresolved: it would need resolveDepthBuffer
 * back on. A ref, so a composer made again is set again: the wrapper hands
 * its ref the composer itself (useImperativeHandle, @react-three/
 * postprocessing 2.16), which a wrapper upgrade should check.
 */
function resolveColourOnly(composer: PostComposer | null): void {
  if (!composer) return
  for (const buffer of [composer.inputBuffer, composer.outputBuffer]) {
    buffer.resolveDepthBuffer = false
    buffer.resolveStencilBuffer = false
  }
  // The second buffer only ever takes a full-screen pass (TV's bloom, ahead of
  // the tube): a quad's edges are off screen, so samples there smooth nothing,
  // and it was a second full copy of the scene's buffer while TV had been on.
  composer.outputBuffer.samples = 0
}

/** The composer's samples, fixed for the page: a new count would make a new composer (composerBudget.ts). */
const COMPOSER_SAMPLES = typeof window === 'undefined' ? 4 : composerSamples(canvasPixels(window))

/**
 * The canvas, rendered only when what it reads changes (memo): it takes no
 * props, so a render of App, which happens on every store change it reads,
 * has nothing to say to it.
 */
export const Scene = memo(function Scene(): JSX.Element {
  // The workshop is an opaque, full-screen bench with its own canvas. Drawing
  // the world under it is pure cost, and on a phone it was most of the frame:
  // the bench measured 3 fps with the world running behind it.
  const covered = useWorkshop((s) => s.open)
  if (import.meta.env.DEV) { const w = window as unknown as { __sceneRenders?: number }; w.__sceneRenders = (w.__sceneRenders ?? 0) + 1 }
  // The composer's children, made once. EffectComposer rebuilds its passes
  // whenever its `children` prop is a new element, and it only removes the
  // old ones, never disposes them: each EffectPass listens to its effects,
  // which live for the session, so every old pass stayed reachable, two per
  // render of this component, with their scenes, cameras and materials
  // (measured 2026-10-13: 406 EffectMaterials kept over 200 hops).
  // Cyberspace TV's tube rides last, its pass switched off while TV is off (TvScreenEffect).
  const bloom = useMemo(() => <><WorldBloom /><TvScreenEffect /></>, [])
  return (
    <Canvas
      camera={{ fov: FOV, position: [0, 0, START_DISTANCE], near: CAMERA_NEAR, far: 6000 }}
      // The stream draws at the capture's ratio, 1 to 1.5 (lib/tv/broadcast): a predictable picture and cost.
      dpr={isBroadcast() ? broadcastDpr() : [1, 2]}
      // high-performance: ask for the discrete GPU and against power-save
      // clocking, so a visually quiet frame still ships on time.
      // No antialias on the canvas itself: every frame is drawn by the
      // EffectComposer into its own multisampled target, and the canvas only
      // ever receives the final full-screen pass, so a multisampled default
      // framebuffer was GPU memory and resolve work spent on nothing
      // (2026-10-15; screenshots identical with and without).
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      style={{ background: BG }}
      frameloop={covered ? 'never' : 'always'}
      // A lost context is said in the console (lib/glContext). Shader
      // programs are compiled once, not again at every cut (lib/keepPrograms).
      // On the stream, a loss that does not come back reloads (lib/tv/broadcast).
      onCreated={({ gl, scene }) => { watchContext(gl.domElement, 'main view'); recoverLostContext(gl.domElement); keepPrograms(gl, scene) }}
    >
      <ClockKeeper />
      {/* Fog to pure black: the only distance cue in an otherwise empty field. */}
      <fog attach="fog" args={[0x000000, GRID_RADIUS * 0.9, GRID_RADIUS * 4]} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[10, 10, 10]} intensity={1.2} />
      <Rig />
      <HeadlampRig />
      <LensShift />
      {isPortraitBroadcast() && <PortraitLens />}
      <CellMetric />
      <ScreenAxes />
      <World />
      {/* Camera-pinned, so it lives outside the world group: hyperspace is a
          state, not a place. Mounts only while riding, or while Cyberspace
          TV shows a hyperjump's ride (its warp). */}
      <HyperspaceCone />
      {/*
        Bloom is what makes line geometry read as emitted light, and it is also
        by far the most expensive thing on screen: measured at 6fps with levels 9
        at full resolution against 49fps with the pass removed entirely. Halving
        its resolution and cutting the mip levels buys nearly all of that back,
        and is invisible because the effect is a blur to begin with.

        A stencil on the composer's buffers carries the shard faces' tag past
        translucent overlays (ShardMesh FACE_TAG_STENCIL) (arkinox, 2026-10-12).
        It is never resolved out of the multisampled buffer (resolveColourOnly).

        No resolutionScale: on the composer it only sizes the depth
        downsampling that a normal pass feeds, and there is no normal pass,
        so the 0.25 that stood here did nothing. The bloom's blur runs from
        half resolution down on its own (mipmapBlur).
      */}
      <EffectComposer ref={resolveColourOnly} stencilBuffer multisampling={COMPOSER_SAMPLES}>
        {bloom}
      </EffectComposer>
    </Canvas>
  )
})

export { GRID_RADIUS }
