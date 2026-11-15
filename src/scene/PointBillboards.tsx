/**
 * PointBillboards.tsx - a POINTS object's points at its POINT SIZE, and the
 * glow round them (DECK-0003 §1.15, §1.16), as ShardMesh draws them. The
 * shaders and the geometry are glowHalos.ts; the budget is glowBudget.ts.
 *
 * Where halos draw: everywhere ShardMesh draws, except that the Settings
 * switch GLOW (store/useLayers `glow`) turns them off in the world (and TV,
 * which is the same scene) and in games (GlowFollowsSetting). The workshop's
 * bench, an item's preview and the shard pictures always draw them: the
 * author must see what they are making, and a picture is drawn once, not
 * every frame.
 */

import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Points, Vector3, type BufferGeometry, type InstancedBufferGeometry, type Intersection, type Mesh, type Plane, type Raycaster } from 'three'
import type { Glow } from 'sno-core/glow'
import { easeOutCubic, SHARD_DECODE_MS } from '../lib/decode'
import { dissolveShare } from '../lib/ceremony'
import type { Box } from '../lib/clip'
import { useLayers } from '../store/useLayers'
import { clipWalls, reducedMotionNow } from './animMotion'
import { DOTS_ORDER, OVERLAY_ORDER } from './shardFaces'
import { billboardsOf, createCoreMaterial, createHaloMaterial, flowHalos, keepHaloBlend, noRaycast, syncBillboards } from './glowHalos'
import { glowLimits, haloKey, joinGlow, spendGlow, type HaloEntry } from './glowBudget'

/**
 * Whether the halos in this part of the tree follow the Settings switch.
 * Off by default (the bench, previews, pictures: always drawn); a world
 * shard follows it by its `world` prop, and a game's canvas says so here.
 */
const GlowGate = createContext(false)

/** Halos below this follow the Settings switch GLOW. */
export function GlowFollowsSetting({ children }: { children: ReactNode }): JSX.Element {
  return <GlowGate.Provider value={true}>{children}</GlowGate.Provider>
}

/** Whose objects these are, for the budget: a world shard's trust (lib/trust.ts) reaches what it places. Trusted elsewhere. */
export const GlowTrust = createContext(true)

/** Whether halos draw here: always, unless this draw follows the switch and it is off. */
export function useGlowAllowed(world: boolean): boolean {
  const gated = useContext(GlowGate) || world
  const on = useLayers((s) => s.glow)
  return !gated || on
}

/** Whether a canvas's frame is past a decode or a dissolve: the halos' share of themselves, 0 to 1. */
export function settledShare(now: number, birth: number | undefined, dissolve: number | undefined): number {
  if (dissolve !== undefined) return 1 - dissolveShare(now - dissolve)
  if (birth !== undefined) return easeOutCubic(Math.min(1, Math.max(0, (now - birth) / SHARD_DECODE_MS)))
  return 1
}

/** The middle of a points geometry and how far its points reach from it, model units. */
function extentOf(plain: BufferGeometry): { centre: Vector3; reach: number } {
  plain.computeBoundingSphere()
  const s = plain.boundingSphere
  return { centre: s ? s.center.clone() : new Vector3(), reach: s ? s.radius : 0 }
}

interface CoreProps {
  plain: BufferGeometry
  /** Diameter in model units. */
  size: number
  /** The object's own opacity times the client's fade, as its GL points take it. */
  opacity: number
  /** How much brighter the core is, for the bloom (pointDisc SHARD_POINTS.glow). */
  glow: number
  headlamp: boolean
  clipPlanes?: Plane[]
}

/** The points at a POINT SIZE: billboards with the disc's look. */
export function PointCores({ plain, size, opacity, glow, headlamp, clipPlanes }: CoreProps): JSX.Element {
  const geometry = useMemo(() => billboardsOf(plain), [plain])
  const material = useMemo(() => createCoreMaterial(size, glow, opacity, headlamp), [size, glow, opacity, headlamp])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => { material.clippingPlanes = clipPlanes ?? null }, [material, clipPlanes])
  // Taps reach the points as they reached the GL points: a ray test on the points themselves.
  const proxy = useMemo(() => new Points(plain), [plain])
  const mesh = useRef<Mesh>(null)
  const raycast = useMemo(() => function (this: Mesh, rc: Raycaster, hits: Intersection[]): void {
    proxy.matrixWorld.copy(this.matrixWorld)
    const from = hits.length
    proxy.raycast(rc, hits)
    for (let i = from; i < hits.length; i++) hits[i].object = this
  }, [proxy])
  useFrame((state) => {
    syncBillboards(geometry)
    const limits = glowLimits()
    const u = material.uniforms
    u.uDpr.value = state.gl.getPixelRatio()
    u.uBufferHeight.value = state.size.height * state.gl.getPixelRatio()
    u.uMinPx.value = limits.pointMinPx
    u.uMaxPx.value = limits.pointMaxPx
  })
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={DOTS_ORDER} raycast={raycast} />
}

interface HaloProps {
  plain: BufferGeometry
  glow: Glow
  /** Radius in model units. */
  radius: number
  /** GLOW STRENGTH, 0..1. */
  strength: number
  /** The diameter its points are drawn at as billboards (model units), or 0: the halo leaves that disc clear. */
  core?: number
  /** The client's own fade of the whole object (a ghost's share, `dim`); never the object's opacity. */
  fade: number
  /** In the world's scene: keep the bloom's tag (glowHalos haloBlend). */
  world: boolean
  /** Whose object, for the budget. */
  trusted: boolean
  /** Planes the object is cut at on the GPU (a moving object's region, an item's walls). */
  clipPlanes?: Plane[]
  /** A still object's region box, in its own frame: its halos are cut at those walls too, on the GPU. */
  walls?: Box
  birth?: number
  dissolve?: number
}

/** The glow round each point. */
export function GlowHalos({ plain, glow, radius, strength, core = 0, fade, world, trusted, clipPlanes, walls, birth, dissolve }: HaloProps): JSX.Element {
  const gl = useThree((s) => s.gl)
  const geometry = useMemo(() => billboardsOf(plain), [plain]) as InstancedBufferGeometry
  const material = useMemo(() => createHaloMaterial(glow.style, world), [glow.style, world])
  useEffect(() => () => material.dispose(), [material])
  const mesh = useRef<Mesh>(null)

  // A still object's region walls as planes, kept in world space from where it stands.
  const own = useMemo(() => (walls ? clipWalls(walls) : null), [walls])
  const planes = useMemo(() => (own ? [...own.world, ...(clipPlanes ?? [])] : clipPlanes ?? null), [own, clipPlanes])
  useEffect(() => {
    material.clippingPlanes = planes
    if (planes?.length) gl.localClippingEnabled = true
  }, [material, planes, gl])

  // One entry in this canvas's budget.
  const entry = useMemo<HaloEntry>(() => ({ key: haloKey(), trusted, count: 0, radius, centre: new Vector3(), reach: 0, object: null as never, kept: 0 }), [])
  const extent = useMemo(() => extentOf(plain), [plain])
  entry.trusted = trusted
  entry.radius = radius
  entry.count = geometry.instanceCount
  entry.centre.copy(extent.centre)
  entry.reach = extent.reach
  useEffect(() => {
    if (!mesh.current) return
    entry.object = mesh.current
    return joinGlow(gl, entry)
  }, [gl, entry])
  const keep = useRef(1)
  const wrote = useRef(-1)
  useEffect(() => { wrote.current = -1 }, [material])

  useFrame((state, dt) => {
    syncBillboards(geometry)
    if (!reducedMotionNow()) flowHalos(state.clock.elapsedTime)
    const limits = glowLimits()
    const dpr = state.gl.getPixelRatio()
    spendGlow(gl, state.gl.info.render.frame, state.camera, state.size.width, state.size.height, limits)
    const want = entry.count > 0 ? Math.min(1, entry.kept / entry.count) : 1
    // Eased, about a quarter second: a share that moves fades halos in and out rather than popping them.
    keep.current += (want - keep.current) * Math.min(1, dt / 0.25)
    if (Math.abs(want - keep.current) < 0.002) keep.current = want
    if (own && mesh.current) {
      for (let i = 0; i < own.local.length; i++) own.world[i].copy(own.local[i]).applyMatrix4(mesh.current.matrixWorld)
    }
    const u = material.uniforms
    u.uRadius.value = radius
    u.uStrength.value = strength
    u.uCore.value = core
    u.uCoreMinPx.value = limits.pointMinPx
    u.uCoreMaxPx.value = limits.pointMaxPx
    // Written only when it changes: EDIT's breath, the build dim and TV's look write it too, after this.
    const shown = fade * settledShare(performance.now(), birth, dissolve)
    if (shown !== wrote.current) { u.uOpacity.value = shown; wrote.current = shown }
    u.uKeep.value = keep.current
    u.uMinPx.value = limits.smallestHaloPx
    u.uMaxPx.value = limits.largestHalo * state.size.height * dpr
    u.uDpr.value = dpr
    u.uBufferHeight.value = state.size.height * dpr
  })
  const before = useMemo(() => () => keepHaloBlend(material), [material])
  return <mesh ref={mesh} name="glow-halos" geometry={geometry} material={material} frustumCulled={false} renderOrder={OVERLAY_ORDER} raycast={noRaycast} onBeforeRender={before} />
}
