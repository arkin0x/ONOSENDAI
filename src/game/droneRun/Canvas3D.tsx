/**
 * Canvas3D.tsx - DRONE RUN's first-person canvas: the run (runner.ts), the
 * world as the dungeon draws it, the zones, the drones, the effects and the
 * gun in hand.
 *
 * - The camera stands at the body's eye (spec.player.eye above the feet),
 *   drawn between the last two steps, turned by input.ts lookState every
 *   frame (frame.ts cameraYaw). ONOSENDAI's lens: FOV 55 degrees from top to
 *   bottom, on an upright screen 55 across (portraitFov). Near plane 0.05.
 *   No body is drawn. A gentle head bob while running on the ground
 *   (client.cameraBob), none with reduced motion.
 * - Fog at the variant's client distances (client.fog: near, far), which is
 *   also how far a drone sees: you see a drone about when it can see you.
 * - World shards: placeShard, ShardMesh and GlowFollowsSetting, as
 *   game/GameView.tsx draws the dungeon, so FOG and LIGHT shards show. One
 *   object placed at many points shares its event id, so each is keyed by
 *   its index too. The entry marker is not drawn (runLevel.ts drawnWorld).
 * - Two passes a frame (Renderer): the world, then, with the depth cleared,
 *   the gun from a camera at the eye with the same lens (Viewmodel.tsx).
 * - The touch aim assist (assist.ts) projects drones through this camera,
 *   so it is handed the camera and the canvas size each frame.
 * - The page hidden, the run pauses (runner.setPaused) and owes nothing for
 *   the time away.
 *
 * DroneRunScreen hands this the session's world and entry, and the level
 * (zones, entry, spawn points) once the level import supplies it; until
 * then a stand-in level is made from the variant's zones (standInLevel).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, createPortal, useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera, Scene, type Vector3Tuple } from 'three'
import type { LevelInfo, Vec3 } from '../../lib/games/droneRun/sim'
import { readLevel } from '../../lib/games/droneRun/sim'
import type { GameDef } from '../../lib/games/types'
import type { WorldShard } from '../../lib/games/play'
import type { Position, ViewAxes } from '../../lib/space'
import { BG } from '../../lib/palette'
import { portraitFov } from '../../lib/tv/broadcast'
import { placeShard } from '../../scene/WorldShards'
import { ShardMesh } from '../../scene/ShardMesh'
import { GlowFollowsSetting, useGlowAllowed } from '../../scene/PointBillboards'
import { ShardLights } from '../../scene/shardLight'
import { CAMERA_NEAR, FOV } from '../../scene/camera'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { DroneRunner, runnerSolids, setActiveRunner } from './runner'
import { drawnWorld, fogOf, localOf, standInLevel, variantFor } from './runLevel'
import { cameraYaw, toRender } from './frame'
import { lookState } from './input'
import { droneRunModels, type DroneRunModels } from './models'
import { disposeView, makeView, PRIORITY, type DroneRunView } from './view'
import { Drones } from './Drones'
import { Effects } from './Effects'
import { Viewmodel } from './Viewmodel'
import { Zones } from './Zones'
import { frameStats, installDevHandle } from './devHandle'
import { setAssistView } from './assist'

/** The game's frame, as the game view's: cyberspace X right, Y up, Z into the screen (render Z flipped). */
const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }

function Shards({ game, world, entry }: { game: GameDef; world: WorldShard[]; entry: Position | null }): JSX.Element {
  // One object placed at many points shares its event id (lib/hidden.ts unbag), so each placement is keyed by its index too.
  // The entry marker is left out (runLevel.ts drawnWorld): the safe zone marks the start.
  const placed = useMemo(() => drawnWorld(world, entry).map((w, i) => ({ id: `${w.key}:${i}`, ...placeShard({ key: w.key, at: w.at, height: w.height, plane: game.region.plane, shard: w.shard }, game.region.base, 0, AXES) })), [game, world, entry])
  return (
    <>
      {placed.map((p) => (
        <group key={p.id} position={p.centre}>
          <ShardMesh shard={p.shard} scale={p.scale} clip={p.clip} pose={p.pose} lit />
        </group>
      ))}
    </>
  )
}

/** Runs the steps a frame owes. */
function Tick({ view }: { view: DroneRunView }): null {
  useFrame((_, dt) => {
    frameStats.start()
    view.time += Math.min(dt, 0.25) * view.runner.timeScale
    view.runner.frame(dt * view.runner.timeScale)
  }, PRIORITY.runner)
  return null
}

/** The camera at the eye, between steps, turned by the look; ONOSENDAI's lens. */
function EyeCamera({ view, bobSize }: { view: DroneRunView; bobSize: number }): null {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const width = useThree((s) => s.size.width)
  const height = useThree((s) => s.size.height)
  useEffect(() => {
    if (!(height > 0)) return
    camera.fov = portraitFov(FOV, width / height)
    camera.near = CAMERA_NEAR
    camera.updateProjectionMatrix()
  }, [camera, width, height])
  const eye = useMemo<Vec3>(() => [0, 0, 0], [])
  const ease = useMemo(() => ({ amount: 0 }), [])
  useFrame((_, frameDt) => {
    const dt = frameDt * view.runner.timeScale
    const { runner } = view
    runner.eye(eye)
    toRender(eye, camera.position)
    const b = runner.state.body
    const speed = Math.hypot(b.vel[0], b.vel[2])
    const want = view.reducedMotion || !b.grounded ? 0 : Math.min(1, speed / 9)
    ease.amount += (want - ease.amount) * Math.min(1, dt * 8)
    view.bob.phase += dt * speed * 1.15
    view.bob.amount = ease.amount * bobSize
    camera.position.y += Math.sin(view.bob.phase * 2) * view.bob.amount
    camera.rotation.set(lookState.pitch, cameraYaw(lookState.yaw), 0, 'YXZ')
    camera.updateMatrixWorld()
    setAssistView(camera, width, height)
  }, PRIORITY.camera)
  useEffect(() => () => setAssistView(null), [])
  return null
}

/** Opens the pools for the frame, and reads the GLOW switch. */
function OpenPools({ view }: { view: DroneRunView }): null {
  const glowOn = useGlowAllowed()
  useFrame(() => {
    view.glowOn = glowOn
    view.glow.begin()
    view.ribbons.begin()
    view.beacons.begin()
    view.vmGlow.begin()
  }, PRIORITY.open)
  return null
}

/** The frame's two passes: the world, then the gun over it with the depth cleared. */
function Renderer({ view, vmScene, vmCamera }: { view: DroneRunView; vmScene: Scene; vmCamera: PerspectiveCamera }): null {
  const lastDt = useRef(0)
  useFrame((state, dt) => {
    lastDt.current = dt
    const t0 = performance.now()
    const { gl, scene, size } = state
    const camera = state.camera as PerspectiveCamera
    const dpr = gl.getPixelRatio()
    const facts = { dpr, bufferHeight: size.height * dpr, glow: view.glowOn }
    view.glow.end(facts)
    view.ribbons.end(facts)
    view.beacons.end(facts)
    view.vmGlow.end(facts)
    if (vmCamera.fov !== camera.fov || vmCamera.aspect !== camera.aspect) {
      vmCamera.fov = camera.fov
      vmCamera.aspect = camera.aspect
      vmCamera.updateProjectionMatrix()
    }
    gl.autoClear = true
    gl.render(scene, camera)
    const calls = gl.info.render.calls
    gl.autoClear = false
    gl.clearDepth()
    gl.render(vmScene, vmCamera)
    gl.autoClear = true
    frameStats.note(lastDt.current * 1000, performance.now() - t0, calls + gl.info.render.calls, t0 - frameStats.began)
  }, PRIORITY.render)
  return null
}

/** Pauses the run while the page is hidden. */
function usePauseWhenHidden(runner: DroneRunner | null): void {
  useEffect(() => {
    if (!runner || typeof document === 'undefined') return
    const on = (): void => runner.setPaused(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', on)
    on()
    return () => document.removeEventListener('visibilitychange', on)
  }, [runner])
}

export interface Canvas3DProps {
  game: GameDef
  world: WorldShard[]
  entry: Position | null
  /** The level (zones, entry, spawn points), once the level import supplies it. */
  level?: LevelInfo | null
  /** The run's seed. Default 0. */
  seed?: number
}

export function Canvas3D({ game, world, entry, level, seed = 0 }: Canvas3DProps): JSX.Element {
  const variant = useMemo(() => variantFor(game.play?.kind === 'drone-run' ? game.play.variant : undefined), [game])
  const reducedMotion = useReducedMotion()
  const solids = useMemo(() => runnerSolids(world, game.region.base), [world, game])
  const made = useMemo(() => {
    try {
      const lv = level ?? standInLevel(variant, entry ? localOf(entry, game.region.base) : null)
      return { runner: new DroneRunner(variant, solids, { level: lv, seed }), error: null, zones: readLevel(lv) }
    } catch (e) {
      return { runner: null, error: e instanceof Error ? e.message : String(e), zones: null }
    }
  }, [variant, solids, level, entry, game, seed])
  const runner = made.runner
  const [models, setModels] = useState<DroneRunModels | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    droneRunModels().then((m) => { if (live) setModels(m) }, (e: unknown) => { if (live) setModelError(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [])
  const view = useMemo(() => (runner && models ? makeView(runner, models, reducedMotion) : null), [runner, models, reducedMotion])
  useEffect(() => () => { if (view) disposeView(view) }, [view])
  useEffect(() => {
    if (!runner) return
    setActiveRunner(runner)
    const remove = installDevHandle(runner)
    return () => { remove(); setActiveRunner(null) }
  }, [runner])
  usePauseWhenHidden(runner)
  const vmScene = useMemo(() => new Scene(), [])
  const vmCamera = useMemo(() => new PerspectiveCamera(FOV, 1, CAMERA_NEAR, 50), [])
  const fog = fogOf(variant)
  const bobSize = typeof variant.client?.cameraBob === 'number' ? variant.client.cameraBob : 0.04
  // Where the camera starts, before the first frame of the run: the eye at the entry.
  const start = useMemo<Vector3Tuple>(() => {
    if (!runner) return [0, 0, 0]
    const e: Vec3 = [0, 0, 0]
    runner.eye(e)
    return [e[0], e[1], -e[2]]
  }, [runner])

  const error = made.error ?? modelError
  if (error) return <p className="gameview__note" role="status">{error}</p>
  return (
    // The HUD's layer over the canvas takes every pointer (look, the stick, fire): the canvas takes none.
    <Canvas camera={{ fov: FOV, near: CAMERA_NEAR, far: 600, position: start }} dpr={[1, 2]} gl={{ antialias: true }} style={{ background: BG, pointerEvents: 'none' }}>
      <color attach="background" args={[BG]} />
      <fog attach="fog" args={[BG, fog.near, fog.far]} />
      <ShardLights />
      <GlowFollowsSetting>
        <Shards game={game} world={world} entry={entry} />
        {made.zones && <Zones start={made.zones.start} finish={made.zones.finish} solids={solids} />}
        {view && (
          <>
            <Tick view={view} />
            <EyeCamera view={view} bobSize={bobSize} />
            <OpenPools view={view} />
            <Drones view={view} />
            <Effects view={view} />
            {createPortal(<Viewmodel view={view} />, vmScene)}
            <Renderer view={view} vmScene={vmScene} vmCamera={vmCamera} />
          </>
        )}
      </GlowFollowsSetting>
    </Canvas>
  )
}
