/**
 * PointBillboards.tsx - a POINTS object's points at its POINT SIZE, and the
 * glow round them (DECK-0003 §1.15, §1.16), as ShardMesh draws them. The
 * shaders and the geometry are glowHalos.ts; the budget is glowBudget.ts.
 *
 * Where halos draw: everywhere ShardMesh draws, except that the Settings
 * switch GLOW (store/useLayers `glow`) turns them off in the world's canvas
 * (and TV, which is the same scene: GlowWorldCanvas), in games and on the
 * spinning cards (GlowFollowsSetting). The workshop's bench, an item's
 * preview and the shard pictures always draw them: the author must see what
 * they are making, and a picture is drawn once, not every frame.
 *
 * The canvas, not a ShardMesh prop, says whether halos keep the world
 * bloom's tag (glowHalos haloBlend): the placing ghost and an item's model
 * are drawn without `world` and still sit under the world's bloom.
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
import { DOTS_ORDER, NO_BLOOM_BLEND, OVERLAY_ORDER } from './shardFaces'
import { billboardsOf, createCoreMaterial, createHaloMaterial, flowHalos, keepHaloBlend, noRaycast, syncBillboards } from './glowHalos'
import { glowLimits, haloKey, joinGlow, spendGlow, type HaloEntry } from './glowBudget'

/**
 * Whether the halos in this part of the tree follow the Settings switch.
 * Off by default (the bench, previews, pictures: always drawn); the world's
 * canvas, a game's canvas and the spinning cards say so.
 */
const GlowGate = createContext(false)

/** Halos below this follow the Settings switch GLOW. */
export function GlowFollowsSetting({ children }: { children: ReactNode }): JSX.Element {
  return <GlowGate.Provider value={true}>{children}</GlowGate.Provider>
}

/** Whether this is the world's canvas, under its bloom (Scene.tsx). */
const GlowWorld = createContext(false)

/**
 * Whose objects these are, for the budget: a world shard's trust (lib/trust.ts)
 * reaches what it places (ShardMesh). Trusted off the world (the bench, a
 * game, a picture); in the world's canvas, untrusted unless a shard's own
 * budget says otherwise, so a chest's look or an item's model meets the
 * stranger caps.
 */
export const GlowTrust = createContext(true)

/** Everything drawn in the world's canvas: its halos keep the bloom's tag, follow the switch, and are strangers' unless trusted. */
export function GlowWorldCanvas({ children }: { children: ReactNode }): JSX.Element {
  return (
    <GlowWorld.Provider value={true}>
      <GlowGate.Provider value={true}>
        <GlowTrust.Provider value={false}>{children}</GlowTrust.Provider>
      </GlowGate.Provider>
    </GlowWorld.Provider>
  )
}

/**
 * The halos of a shard being placed (ShardGhost) or moved (EDIT): with
 * `always`, for one that is only points, fog or glow, drawn whatever the
 * Settings switch says, and yours, so trusted for the budget; otherwise as
 * they were. A shard that is
 * only fog or glow is nothing but its halos, so with the switch off its ghost
 * would show nothing of itself (arkinox, 2026-11-22: "the fog shard is
 * invisible while I'm trying to place it in BUILD").
 */
export function GhostGlow({ always, children }: { always: boolean; children?: ReactNode }): JSX.Element {
  const gated = useContext(GlowGate)
  const trusted = useContext(GlowTrust)
  // The same two providers either way, so a change of `always` never remounts what is under them.
  return (
    <GlowGate.Provider value={gated && !always}>
      <GlowTrust.Provider value={trusted || always}>{children}</GlowTrust.Provider>
    </GlowGate.Provider>
  )
}

/**
 * Whether halos keep the world bloom's face tag (glowHalos haloBlend): in the
 * world's canvas, whatever the shard (the placing ghost, an item's model), and
 * wherever a shard is drawn as the world draws it under a world bloom (the
 * workshop's LOOK, workshop/benchBloom.tsx). Elsewhere (the editing tools,
 * games, pictures) there is no bloom and the alpha accumulates.
 */
export function haloKeepsTag(canvasWorld: boolean, drawnWorld: boolean): boolean {
  return canvasWorld || drawnWorld
}

/** Whether halos draw here: always, unless this draw follows the switch and it is off. */
export function useGlowAllowed(): boolean {
  const gated = useContext(GlowGate)
  const on = useLayers((s) => s.glow)
  return !gated || on
}

/**
 * A still object's region walls as planes in world space, kept current from
 * `mesh` each frame, joined with the planes it is given; `update` runs in a
 * frame callback. Null with neither.
 */
function useWallPlanes(walls: Box | undefined, clipPlanes: Plane[] | undefined): { planes: Plane[] | null; update: (mesh: Mesh | null) => void } {
  const own = useMemo(() => (walls ? clipWalls(walls) : null), [walls])
  const planes = useMemo(() => (own ? [...own.world, ...(clipPlanes ?? [])] : clipPlanes ?? null), [own, clipPlanes])
  const update = useMemo(() => (mesh: Mesh | null): void => {
    if (!own || !mesh) return
    // Its world matrix brought up to date first, as AnimGroups does: on the first frame it is still the identity.
    mesh.updateWorldMatrix(true, false)
    for (let i = 0; i < own.local.length; i++) own.world[i].copy(own.local[i]).applyMatrix4(mesh.matrixWorld)
  }, [own])
  return { planes, update }
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
  /** A still object's region box, in its own frame: cut at those walls on the GPU too. */
  walls?: Box
  /** Kept out of the bloom (the placing ghost in the world, shardFaces.ts NO_BLOOM_BLEND). */
  noBloom?: boolean
  /** A hit on them is soft (scene/softPick.tsx): the object has nothing solid of its own. */
  soft?: boolean
}

/** The points at a POINT SIZE: billboards with the disc's look. */
export function PointCores({ plain, size, opacity, glow, headlamp, clipPlanes, walls, noBloom = false, soft = false }: CoreProps): JSX.Element {
  const gl = useThree((s) => s.gl)
  const geometry = useMemo(() => billboardsOf(plain), [plain])
  const material = useMemo(() => {
    const m = createCoreMaterial(size, glow, opacity, headlamp)
    if (noBloom) Object.assign(m, NO_BLOOM_BLEND)
    return m
  }, [size, glow, opacity, headlamp, noBloom])
  useEffect(() => () => material.dispose(), [material])
  const wallPlanes = useWallPlanes(walls, clipPlanes)
  useEffect(() => {
    material.clippingPlanes = wallPlanes.planes
    if (wallPlanes.planes?.length) gl.localClippingEnabled = true
  }, [material, wallPlanes.planes, gl])
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
    wallPlanes.update(mesh.current)
    const limits = glowLimits()
    const u = material.uniforms
    u.uDpr.value = state.gl.getPixelRatio()
    u.uBufferHeight.value = state.size.height * state.gl.getPixelRatio()
    u.uMinPx.value = limits.pointMinPx
    u.uMaxPx.value = limits.pointMaxPx
  })
  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} renderOrder={DOTS_ORDER} raycast={raycast} userData-softPick={soft} />
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
  /**
   * Drawn as the world draws (ShardMesh `world`): with the canvas, whether
   * its halos keep the bloom's tag (haloKeepsTag). The workshop's LOOK draws
   * its shard so, under its own world bloom.
   */
  drawnWorld?: boolean
  /** The client's own fade of the whole object (a ghost's share, `dim`); never the object's opacity. */
  fade: number
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
export function GlowHalos({ plain, glow, radius, strength, core = 0, drawnWorld = false, fade, trusted, clipPlanes, walls, birth, dissolve }: HaloProps): JSX.Element {
  const world = haloKeepsTag(useContext(GlowWorld), drawnWorld)
  const gl = useThree((s) => s.gl)
  const geometry = useMemo(() => billboardsOf(plain), [plain]) as InstancedBufferGeometry
  const material = useMemo(() => createHaloMaterial(glow.style, world), [glow.style, world])
  useEffect(() => () => material.dispose(), [material])
  const mesh = useRef<Mesh>(null)

  // A still object's region walls as planes, kept in world space from where it stands.
  const wallPlanes = useWallPlanes(walls, clipPlanes)
  useEffect(() => {
    material.clippingPlanes = wallPlanes.planes
    if (wallPlanes.planes?.length) gl.localClippingEnabled = true
  }, [material, wallPlanes.planes, gl])

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
    // Its world matrix up to date before the budget first prices it: still the identity, it would be priced at the origin.
    mesh.current.updateWorldMatrix(true, false)
    entry.object = mesh.current
    return joinGlow(gl, entry)
  }, [gl, entry])
  // Its share of its halos, eased; null until the first allocation, which it takes at once (a new fog never overdraws first).
  const keep = useRef<number | null>(null)
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
    let k = keep.current ?? want
    k += (want - k) * Math.min(1, dt / 0.25)
    if (Math.abs(want - k) < 0.002) k = want
    keep.current = k
    wallPlanes.update(mesh.current)
    const u = material.uniforms
    u.uRadius.value = radius
    u.uStrength.value = strength
    u.uCore.value = core
    u.uCoreMinPx.value = limits.pointMinPx
    u.uCoreMaxPx.value = limits.pointMaxPx
    // Written only when it changes: EDIT's breath, the build dim and TV's look write it too, after this.
    const shown = fade * settledShare(performance.now(), birth, dissolve)
    if (shown !== wrote.current) { u.uOpacity.value = shown; wrote.current = shown }
    u.uKeep.value = k
    u.uMinPx.value = limits.smallestHaloPx
    u.uMaxPx.value = limits.largestHalo * state.size.height * dpr
    u.uDpr.value = dpr
    u.uBufferHeight.value = state.size.height * dpr
  })
  const before = useMemo(() => () => keepHaloBlend(material), [material])
  return <mesh ref={mesh} name="glow-halos" geometry={geometry} material={material} frustumCulled={false} renderOrder={OVERLAY_ORDER} raycast={noRaycast} onBeforeRender={before} />
}
