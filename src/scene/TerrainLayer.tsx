/**
 * TerrainLayer.tsx - the field's blocks in the cyberspace scene, in every
 * mode (owner, 2026-11-24: "the blocks are visible even when you exit
 * TERRAIN mode"), and TERRAIN's body, eye and block cursor while it is on.
 *
 * The chunks. Each loaded chunk with blocks (store/useTerrain.ts: the
 * surveyed chunks near your avatar, and in TERRAIN the 3 by 3 by 3 round the
 * body) is one mesh, greedily meshed in the blocks worker and meshed again
 * only when it or a neighbour's border changed, at most two at a time. A
 * chunk's mesh is placed as the scene places everything, against the
 * anchor at the zoom (lib/space.ts cellOffset: the gibson at q spans q to
 * q + 1 and the anchor's cell is centred on 0), so it stands where its
 * gibsons are at any zoom; past MAX_SCALE it is too small to see and is not
 * drawn. Frustum culled by its own bounds. What is drawn is what is stored:
 * no skin over a chunk's edge.
 *
 * The light. With Block shading on (Settings, Effects), each chunk's light
 * (lib/terrain/light.ts) is worked out in the blocks worker from the chunk
 * and its 26 neighbours, again only when a change could reach it, nearest
 * the eye first, and handed to the chunk's material as a 3D texture
 * (terrain/terrainMaterial.ts). A chunk drawn for the first time waits for
 * its light, so it never shows lit and then darkens, and its light waits for
 * the neighbours still to come round it (up to LIGHT_WAIT_MS), which would
 * otherwise count as open space for a moment; one whose light is being
 * worked out again keeps the light it had. Off, no light is worked out or
 * kept at all, and every chunk draws fully lit.
 *
 * The glow. Ordinary rock writes the world's untagged colour (alpha 0, as a
 * shard face does), which the world bloom skips (scene/worldBloom.tsx); the
 * glowing texels of Glowcore, Gibsonite, the Relic shard, Prismite and the
 * embers in Cinderrock write alpha 1, so they feed the bloom for real, while
 * GLOW is on in Settings (store/useLayers.ts glow).
 *
 * TERRAIN is WALK with block tools (store/useTerrain.ts): the camera and
 * the walker are WALK's. Here are only its marks, in the field's frame: the
 * block cursor on what the cross (or the mouse, or a tap) points at within
 * CURSOR_REACH (a plain outline, no glow), what a smash there would take
 * (SmashPreview.tsx), the chunks in reach and the chunk SURVEY would fill
 * (lit while SURVEY is held: SurveyGlow.tsx);
 * and a press waiting from the HUD is done here, where the camera is.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, DoubleSide, EdgesGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, LineBasicMaterial, Matrix4, Mesh,
  MeshBasicMaterial, Raycaster, Vector2, Vector3, type Data3DTexture, type LineSegments, type Object3D, type Ray, type ShaderMaterial,
} from 'three'
import { airRefusal, cellInReach, slotInReach, surveyTarget, terrainSession, useTerrain, type AirAim, type TerrainSession } from '../store/useTerrain'
import { AIM_COLORS, aimAt, sceneDraws, sharedKeys } from '../store/terrainShare'
import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { raycast, type RayHit } from '../lib/terrain/raycast'
import { CURSOR_REACH, TerrainWorld, type ChunkSlot } from '../lib/terrain/world'
import { borderSlab, FLOATS_PER_VERTEX, type Borders } from '../lib/terrain/mesh'
import { lightChunkAsync, meshChunkAsync } from '../lib/terrain/blocksClient'
import { blockKind, solid as isSolid } from '../lib/terrain/blocks'
import { lightTables, shadedColumns } from '../lib/terrain/light'
import { terrainInput } from '../terrain/terrainInput'
import { lightTexture, makeTerrainMaterial } from '../terrain/terrainMaterial'
import { NO_BLOOM_BLEND } from './shardFaces'
import { alignedOrigin } from '../store/useCyberspace'
import type { Position, ViewAxes } from '../lib/space'
import { committedAnchor, committedScale } from '../lib/renderFrame'
import { TapOccluder } from './TapOccluder'
import { tapClaimNearer } from './TapTarget'
import { SmashFx } from './SmashFx'
import { SmashKick } from './SmashKick'
import { SmashPreview } from './SmashPreview'
import { pickToy } from './toySpots'
import { usePrizePick } from '../store/usePrizePick'
import { useAirPlace } from '../store/useAirPlace'
import { airPlacing } from '../store/airSwitch'
import { SurveyGlow } from './SurveyGlow'
import { airCellInto, type Cell } from '../lib/terrain/airPlace'
import { isCompiler } from '../lib/terrain/terrainDb'
import { useSurveyHold } from '../terrain/surveyHold'
import { edgeSegments, outlineLines, outlineMaterial as sharedOutline, sizeOutline } from './hiddenParts'

/** Chunks meshing at once. */
const MESH_IN_FLIGHT = 2
/** Chunks' light being worked out at once. */
const LIGHT_IN_FLIGHT = 2
/** The longest a chunk's light waits for neighbours still to come. */
const LIGHT_WAIT_MS = 1500

/** Which ids let light through, for a chunk's shaded columns (lib/terrain/light.ts). */
let passTable: Uint8Array | null = null

/**
 * Whether any of a chunk's 26 neighbours is still to come: held but not yet
 * generated, and being generated now or due to be (yours, or someone's
 * shared, store/useTerrain.ts sync), so it would read as open space.
 */
function neighbourPending(s: TerrainSession, slot: ChunkSlot, shared: ReadonlySet<string>): boolean {
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy && !dz) continue
    const n = s.world.slotAt(slot.off[0] + dx, slot.off[1] + dy, slot.off[2] + dz)
    if (n && !n.blocks && n.inSpace && (s.building.has(n.key) || s.surveyedKeys.has(n.key) || shared.has(n.key))) return true
  }
  return false
}

/** The eye in the field's frame, for the light's order. */
const eyeField = new Matrix4()

/** A chunk's light on the GPU, and its two materials reading it. */
interface ChunkLight { tex: Data3DTexture; material: ShaderMaterial; clearMaterial: ShaderMaterial }

/** Past this zoom a chunk (32 gibsons) is a few pixels at most: not drawn. */
export const MAX_SCALE = 6

/**
 * What the cursor points at now, for the HUD and the buttons (MINE and PLACE
 * act on it); with no block in reach, the ghost at arm's length PLACE would
 * fill (`air`, lib/terrain/airPlace.ts), while a block is in hand.
 */
export const terrainCursor: { hit: RayHit | null; air: AirAim | null } = { hit: null, air: null }

/**
 * The field's frame in the scene: a cs offset from the field's origin
 * (continuous, the cell d spanning d to d + 1) to render space, at the zoom,
 * against the anchor's aligned origin (lib/space.ts cellOffset), through the
 * view's axes. `shift` moves the frame's origin by whole gibsons first (a
 * chunk's corner).
 *
 * Against the anchor the scene was last committed with (lib/renderFrame.ts),
 * as the camera and every shard are: the store's anchor moves when a step
 * settles, a commit before the scene does, and blocks placed against it
 * jumped for a frame at every settle while the rest of the world stayed
 * (owner, 2026-11-24: "the whole world of blocks just shifted for a frame or two").
 */
export function fieldMatrix(s: Pick<TerrainSession, 'world'>, axes: ViewAxes, scaleExp: number, out: Matrix4, shift: readonly [number, number, number] = [0, 0, 0]): Matrix4 {
  const origin = alignedOrigin(drawnAnchor(), scaleExp)
  const k = 1 / 2 ** scaleExp
  const cols = [new Vector3(), new Vector3(), new Vector3()]
  const t = [0, 0, 0]
  const o = s.world.origin
  ;[axes.right, axes.up, axes.out].forEach((a, i) => {
    const csi = a.axis === 'x' ? 0 : a.axis === 'y' ? 1 : 2
    cols[csi].setComponent(i, a.dir * k)
    const b = o[a.axis] + BigInt(shift[csi]) - origin[a.axis]
    t[i] = a.dir * (Number(b) * k - 0.5)
  })
  out.makeBasis(cols[0], cols[1], cols[2])
  out.setPosition(t[0], t[1], t[2])
  return out
}

/** The anchor the scene on screen is drawn against: the committed one, the store's before the first commit. */
export function drawnAnchor(): Position {
  return committedAnchor() ?? useCyberspace.getState().anchor
}

/** The zoom the scene on screen is drawn at, likewise. */
export function drawnScale(): number {
  return committedScale() ?? useCyberspace.getState().scaleExp
}

/** The borders a chunk's mesh reads from its neighbours (mesh.ts Borders). */
function bordersOf(world: TerrainWorld, slot: ChunkSlot): Borders {
  const out: Array<Uint8Array | null> = []
  const steps: Array<[number, number, number]> = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]]
  steps.forEach(([ax, ay, az], face) => {
    const n = world.slotAt(slot.off[0] + ax, slot.off[1] + ay, slot.off[2] + az)
    out.push(n?.blocks ? borderSlab(n.blocks, face ^ 1) : null)
  })
  return out as Borders
}

function Chunks({ axes }: { axes: ViewAxes }): JSX.Element {
  const group = useRef<Group>(null)
  const made = useMemo(() => makeTerrainMaterial(), [])
  const meshes = useRef(new Map<ChunkSlot, Mesh[]>())
  const inFlight = useRef(new Set<ChunkSlot>())
  const lights = useRef(new Map<ChunkSlot, ChunkLight>())
  const lightFlight = useRef(new Set<ChunkSlot>())
  /** Chunks drawn for the first time while Block shading is on, hidden until their light comes. */
  const waiting = useRef(new Set<ChunkSlot>())
  const reveal = (slot: ChunkSlot): void => {
    if (!waiting.current.delete(slot)) return
    for (const m of meshes.current.get(slot) ?? []) m.visible = true
  }
  const shaded = useRef(new WeakMap<ChunkSlot, { version: number; cols: Uint8Array }>())
  /** When a chunk's light was first held back for neighbours still to come. */
  const heldSince = useRef(new WeakMap<ChunkSlot, number>())
  /** When the soonest held-back light stops waiting: the scheduling looks again then, not every frame. */
  const holdUntil = useRef<number | null>(null)
  const seen = useRef(-1)
  const shadingWas = useRef(false)
  const placedFor = useRef('')
  const field = useRef<TerrainSession | null>(null)
  const dropLight = (slot: ChunkSlot): void => {
    const l = lights.current.get(slot)
    if (!l) return
    l.tex.dispose(); l.material.dispose(); l.clearMaterial.dispose()
    lights.current.delete(slot)
  }
  useEffect(() => () => {
    for (const ms of meshes.current.values()) for (const m of ms) m.geometry.dispose()
    meshes.current.clear()
    for (const slot of [...lights.current.keys()]) dropLight(slot)
    made.dispose()
  }, [made])
  useFrame((state) => {
    const g = group.current
    if (!g) return
    const s = terrainSession
    const cs = useCyberspace.getState()
    // A new field (another identity, another plane): what the old one drew goes.
    if (field.current !== s) {
      for (const ms of meshes.current.values()) for (const m of ms) { g.remove(m); m.geometry.dispose() }
      meshes.current.clear()
      for (const slot of [...lights.current.keys()]) dropLight(slot)
      waiting.current.clear()
      field.current = s
      seen.current = -1
      placedFor.current = ''
    }
    const zoom = drawnScale()
    const show = !!s && s.plane === cs.plane && zoom <= MAX_SCALE
    g.visible = show
    if (!s || !show) return
    const layers = useLayers.getState()
    const shading = layers.blockShading
    made.setView(2 ** -zoom, layers.glow, shading, layers.headlamp)
    if (shading !== shadingWas.current) {
      shadingWas.current = shading
      seen.current = -1
      if (!shading) {
        // Off: nothing waits, and no light is kept; on again, every chunk's light is worked out afresh.
        for (const slot of [...waiting.current]) reveal(slot)
        for (const slot of [...lights.current.keys()]) dropLight(slot)
        for (const ms of meshes.current.values()) for (const m of ms) m.material = m.renderOrder ? made.clearMaterial : made.material
        for (const slot of s.world.slots) if (slot.blocks) slot.lightDirty = true
      }
    }
    // Placed again when the drawn anchor, the zoom or the axes change.
    const a = drawnAnchor()
    const place = `${a.x},${a.y},${a.z}|${zoom}|${axes.right.axis}${axes.right.dir}${axes.up.axis}${axes.up.dir}${axes.out.axis}${axes.out.dir}`
    const replace = place !== placedFor.current
    placedFor.current = place
    // Chunks let go: their meshes and light go.
    for (const [slot, ms] of meshes.current) {
      if (s.world.chunks.get(slot.off.join(',')) === slot && slot.blocks) continue
      for (const m of ms) { g.remove(m); m.geometry.dispose() }
      meshes.current.delete(slot)
      waiting.current.delete(slot)
    }
    for (const slot of [...lights.current.keys()]) if (s.world.chunks.get(slot.off.join(',')) !== slot || !slot.blocks) dropLight(slot)
    if (replace) for (const [slot, ms] of meshes.current) for (const m of ms) { fieldMatrix(s, axes, zoom, m.matrix, [32 * slot.off[0], 32 * slot.off[1], 32 * slot.off[2]]); m.matrixWorldNeedsUpdate = true }
    const holdOver = holdUntil.current !== null && performance.now() >= holdUntil.current
    if (s.version === seen.current && inFlight.current.size === 0 && lightFlight.current.size === 0 && !holdOver) return
    seen.current = s.version
    // A light held back for neighbours still to come is looked at again when its wait runs out (or sooner, when the field changes).
    holdUntil.current = shading ? scheduleLight(s, state.camera.position) : null
    for (const slot of s.world.slots) {
      if (inFlight.current.size >= MESH_IN_FLIGHT) break
      if (!slot.dirty || !slot.blocks || inFlight.current.has(slot)) continue
      slot.dirty = false
      inFlight.current.add(slot)
      void meshChunkAsync(slot.blocks, bordersOf(s.world, slot)).then((m) => {
        inFlight.current.delete(slot)
        seen.current = -1
        if (terrainSession !== s || s.world.chunks.get(slot.off.join(',')) !== slot) return
        const old = meshes.current.get(slot)
        if (old) { for (const o of old) { g.remove(o); o.geometry.dispose() } meshes.current.delete(slot) }
        if (m.quads === 0) return
        const made2: Mesh[] = []
        const lit = lights.current.get(slot)
        // First drawn with Block shading on: hidden until its light comes (a chunk meshed again while it waits keeps waiting).
        if (useLayers.getState().blockShading && !lit && (!old || waiting.current.has(slot))) waiting.current.add(slot)
        // The solid blocks, then the see-through ones (drawn after, blended over what is behind).
        for (const [vertices, indices, material, order] of [[m.vertices, m.indices, lit?.material ?? made.material, 0], [m.clearVertices, m.clearIndices, lit?.clearMaterial ?? made.clearMaterial, 1]] as const) {
          if (indices.length === 0) continue
          const geo = new BufferGeometry()
          const ib = new InterleavedBuffer(vertices, FLOATS_PER_VERTEX)
          geo.setAttribute('position', new InterleavedBufferAttribute(ib, 3, 0))
          geo.setAttribute('tile', new InterleavedBufferAttribute(ib, 1, 3))
          geo.setAttribute('face', new InterleavedBufferAttribute(ib, 1, 4))
          geo.setIndex(new BufferAttribute(indices, 1))
          geo.computeBoundingSphere()
          const mesh = new Mesh(geo, material)
          mesh.matrixAutoUpdate = false
          mesh.renderOrder = order
          fieldMatrix(s, axes, drawnScale(), mesh.matrix, [32 * slot.off[0], 32 * slot.off[1], 32 * slot.off[2]])
          mesh.name = `terrain-chunk-${slot.key}${order ? '-clear' : ''}`
          mesh.visible = !waiting.current.has(slot)
          g.add(mesh)
          made2.push(mesh)
        }
        meshes.current.set(slot, made2)
      }, () => { inFlight.current.delete(slot); slot.dirty = true; seen.current = -1 })
    }
  })

  /** A chunk's shaded columns, kept while its blocks stay the same. */
  const shadedOf = (slot: ChunkSlot): Uint8Array => {
    const had = shaded.current.get(slot)
    if (had && had.version === slot.version) return had.cols
    passTable ??= lightTables().pass
    const cols = shadedColumns(slot.blocks!, passTable)
    shaded.current.set(slot, { version: slot.version, cols })
    return cols
  }

  /** Work out the light of the chunks that need it, nearest the eye first; each answer goes to its chunk's materials. Returns when the soonest held-back one stops waiting, or null. */
  const scheduleLight = (s: TerrainSession, eye: Vector3): number | null => {
    const want = s.world.lightDirtySlots().filter((sl) => !lightFlight.current.has(sl))
    if (want.length === 0 || lightFlight.current.size >= LIGHT_IN_FLIGHT) return null
    let until: number | null = null
    const shared = sharedKeys()
    // The eye in the field's frame, in chunks.
    const at = eye.clone().applyMatrix4(fieldMatrix(s, axes, drawnScale(), eyeField).invert()).divideScalar(32)
    const far = (sl: ChunkSlot): number => Math.max(Math.abs(sl.off[0] + 0.5 - at.x), Math.abs(sl.off[1] + 0.5 - at.y), Math.abs(sl.off[2] + 0.5 - at.z))
    want.sort((a, b) => far(a) - far(b))
    const now = performance.now()
    for (const slot of want) {
      if (lightFlight.current.size >= LIGHT_IN_FLIGHT) break
      // A neighbour still being generated would read as open space: wait for it, a while at most.
      if (neighbourPending(s, slot, shared)) {
        const since = heldSince.current.get(slot) ?? now
        heldSince.current.set(slot, since)
        if (now - since < LIGHT_WAIT_MS) { until = Math.min(until ?? Infinity, since + LIGHT_WAIT_MS); continue }
      }
      heldSince.current.delete(slot)
      slot.lightDirty = false
      lightFlight.current.add(slot)
      const { around, skyTop } = s.world.lightInputs(slot, shadedOf)
      void lightChunkAsync(around, skyTop).then((bytes) => {
        lightFlight.current.delete(slot)
        seen.current = -1
        if (terrainSession !== s || s.world.chunks.get(slot.off.join(',')) !== slot) return
        if (!useLayers.getState().blockShading) return
        // Worked out again: the same texture takes the new bytes, and the materials stay.
        const had = lights.current.get(slot)
        if (had) {
          ;(had.tex.image.data as Uint8Array).set(bytes)
          had.tex.needsUpdate = true
          reveal(slot)
          return
        }
        const tex = lightTexture(bytes)
        const mats = made.forChunk(tex)
        lights.current.set(slot, { tex, ...mats })
        for (const m of meshes.current.get(slot) ?? []) m.material = m.renderOrder ? mats.clearMaterial : mats.material
        reveal(slot)
      }, () => { lightFlight.current.delete(slot); slot.lightDirty = true; seen.current = -1 })
    }
    return until
  }
  return <group ref={group} name="terrain-chunks" />
}

/** How far a ray is walked through the blocks for what hides a shard, in blocks from where it enters them: well past the chunks round you (3 by 3 by 3 is 96 across). */
export const OCCLUSION_REACH = 1024

const occField = new Matrix4()
const occInverse = new Matrix4()
const occFrom = new Vector3()
const occDir = new Vector3()
const occPoint = new Vector3()

/**
 * How far along `ray` (render space, the scene's) the first block that hides
 * what is behind it lies, in render units, or null: the blocks as Chunks
 * draws them (same field, plane and zoom), walked cell by cell (raycast.ts),
 * only across the box of the chunks held. A ray that starts inside a mass of
 * blocks is not hidden by it (their faces are drawn on the outside only, so
 * from within nothing of it is seen): the first block after open space is.
 * What TapOccluder asks at a tap; nothing here runs a frame.
 */
export function blockOcclusion(s: TerrainSession | null, axes: ViewAxes, ray: Ray): number | null {
  if (!s || s.plane !== useCyberspace.getState().plane) return null
  const zoom = drawnScale()
  if (zoom > MAX_SCALE) return null
  // The box of the chunks with blocks, in the field's frame (a cell d spans d to d + 1).
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (const sl of s.world.chunks.values()) {
    if (!sl.blocks) continue
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], 32 * sl.off[a]); hi[a] = Math.max(hi[a], 32 * sl.off[a] + 32) }
  }
  if (!(lo[0] < hi[0])) return null
  // The scene's world group stands untransformed, so the field's frame is render space (as Marks has it).
  fieldMatrix(s, axes, zoom, occField)
  occInverse.copy(occField).invert()
  occFrom.copy(ray.origin).applyMatrix4(occInverse)
  occDir.copy(ray.origin).add(ray.direction).applyMatrix4(occInverse).sub(occFrom).normalize()
  // Clipped to the box: where the ray enters it and leaves it.
  let enter = 0, leave = Infinity
  const o = [occFrom.x, occFrom.y, occFrom.z], d = [occDir.x, occDir.y, occDir.z]
  for (let a = 0; a < 3; a++) {
    if (d[a] === 0) { if (o[a] < lo[a] || o[a] > hi[a]) return null; continue }
    let t0 = (lo[a] - o[a]) / d[a], t1 = (hi[a] - o[a]) / d[a]
    if (t0 > t1) [t0, t1] = [t1, t0]
    enter = Math.max(enter, t0)
    leave = Math.min(leave, t1)
  }
  // As far in as OCCLUSION_REACH blocks from where the ray enters (from the eye, zoomed out, the blocks can be thousands of blocks off).
  leave = Math.min(leave, enter + OCCLUSION_REACH)
  if (enter > leave) return null
  // From where the ray enters the box (a hair in, so the first cell is the box's own); from the eye when it starts inside.
  const start = enter > 0 ? enter + 1e-6 : 0
  const solid = (i: number, j: number, k: number): boolean => isSolid(s.world.blockCs(i, j, k))
  const at: [number, number, number] = [o[0] + d[0] * start - 0.5, o[1] + d[1] * start - 0.5, o[2] + d[2] * start - 0.5]
  const hit = raycast(at, d as [number, number, number], leave - start, solid, start > 0 ? 'hit' : 'skip')
  if (!hit) return null
  // Back to render space: the point where the ray meets the block, measured from the ray's origin.
  occPoint.copy(occDir).multiplyScalar(start + hit.distance).add(occFrom).applyMatrix4(occField)
  return occPoint.distanceTo(ray.origin)
}

/** The targeted block's outline: a hair bigger than the block (OUTLINE_PULL keeps it off the block's own faces). */
const CURSOR_EDGES = new EdgesGeometry(new BoxGeometry(1.004, 1.004, 1.004))
/** How far the outline is drawn toward the eye, in blocks, so its edges never fight the faces they lie on, while a block in front still hides them. */
export const OUTLINE_PULL = 0.03

/**
 * The outline's material (owner, 2026-11-26: "can we make that outline
 * occluded by the surrounding blocks? its not occluded and it ruins my
 * depth perception"): depth tested, so the blocks round it (and its own
 * block's far edges) hide what is behind them, each vertex drawn
 * OUTLINE_PULL blocks toward the eye (in blocks at any zoom: the field's
 * scale) as a polygon offset would (lines take none).
 * Never blooms.
 */
export function makeOutlineMaterial(color: string): LineBasicMaterial {
  const m = new LineBasicMaterial({ color, transparent: true, opacity: 0.6, depthTest: true, depthWrite: false, ...NO_BLOOM_BLEND })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  float pullBlocks = ${OUTLINE_PULL.toFixed(3)} * length(modelViewMatrix[0].xyz);
  mvPosition.xyz *= 1.0 - pullBlocks / max(length(mvPosition.xyz), 2.0 * pullBlocks);
  gl_Position = projectionMatrix * mvPosition;`)
  }
  m.customProgramCacheKey = () => 'terrain-outline-pull'
  return m
}
/** The targeted block's outline: by whose block it is (AIM_COLORS), a dull red out of reach. */
const OUTLINE = '#ffffff'
const OUTLINE_FAR = '#c86464'
const UNIT_EDGES = new EdgesGeometry(new BoxGeometry(1, 1, 1))

/**
 * The ghost at arm's length (lib/terrain/airPlace.ts): the block in hand, see
 * through, in its own colour, with the shared 1.5 px outline (lib/hiddenLook.ts
 * OUTLINE_PX); dim red where it cannot go. Neither blooms.
 */
const GHOST_BOX = new BoxGeometry(0.98, 0.98, 0.98)
const GHOST_EDGES = edgeSegments(new BoxGeometry(1.004, 1.004, 1.004))
const GHOST_LINE = '#ffffff'
const GHOST_FILL = 0.32
const GHOST_BAD_FILL = 0.12
const GHOST_LINE_COLOUR = new Color(GHOST_LINE)
const GHOST_BAD_COLOUR = new Color(OUTLINE_FAR)
/** How often a ghost that stays in one cell asks again whether a block can go there (a chunk surveyed meanwhile), in milliseconds. */
const GHOST_RECHECK_MS = 250
/** The block in hand that PLACE would put down, or null (an empty slot, none left, the Compiler). */
function heldPlaceable(): number | null {
  const inv = useTerrain.getState().inventory
  const id = inv.hotbar[inv.slot]
  return id && !isCompiler(id) && (inv.counts[id] ?? 0) > 0 ? id : null
}

/** A ghost's cell and eye, kept and written over, so a frame allocates nothing: one for the cursor, one for a press at a point. */
interface AirScratch { cell: Cell; eye: [number, number, number] }
const hoverAir: AirScratch = { cell: [0, 0, 0], eye: [0, 0, 0] }
const pressAir: AirScratch = { cell: [0, 0, 0], eye: [0, 0, 0] }

/**
 * The ghost along a ray in the field's frame (`from`, `toward`, as Marks
 * casts them), written into `out`: none when a block was hit, none is in
 * hand, or air placing is switched off (store/airSwitch.ts; lib/terrain/airPlace.ts).
 */
function airAimInto(out: AirScratch, hit: RayHit | null, origin: Vector3, dir: Vector3, distance: number): AirAim | null {
  if (hit || heldPlaceable() === null || !airPlacing()) return null
  out.eye[0] = origin.x - 0.5; out.eye[1] = origin.y - 0.5; out.eye[2] = origin.z - 0.5
  return airCellInto(out.cell, out.eye[0], out.eye[1], out.eye[2], dir.x, dir.y, dir.z, distance) ? out : null
}

const ray = new Raycaster()
const ndc = new Vector2()
const inverse = new Matrix4()
const from = new Vector3()
const toward = new Vector3()
const point = new Vector3()
/** How often the block outline asks whether a shard stands in front of it, in milliseconds. */
const SHARD_LOOK_MS = 150

/**
 * TERRAIN's marks, in the field's frame (fieldMatrix): the block cursor, the
 * chunks in reach, the chunk SURVEY would fill. None of them blooms.
 * Each frame the cross (or the mouse) is cast into the blocks from WALK's
 * camera, and a press waiting from the HUD is done.
 */
function Marks({ axes }: { axes: ViewAxes }): JSX.Element {
  const frame = useRef<Group>(null)
  const outline = useRef<LineSegments>(null)
  const survey = useRef<LineSegments>(null)
  const reachGroup = useRef<Group>(null)
  const last = useRef(0)
  /** When the outline last asked whether a shard stands in front of its block, and the answer. */
  const looked = useRef(-Infinity)
  const hidden = useRef(false)
  const outlineMaterial = useMemo(() => makeOutlineMaterial(OUTLINE), [])
  useEffect(() => () => outlineMaterial.dispose(), [outlineMaterial])
  const ghostGroup = useRef<Group>(null)
  /** The ghost's last answer (can a block go there?), asked again only when what it depends on changes, or every GHOST_RECHECK_MS; and the colours last set. */
  const ghostSeen = useRef({ cx: NaN, cy: NaN, cz: NaN, ex: NaN, ey: NaN, ez: NaN, head: null as unknown, version: -1, at: -Infinity, bad: false, drawnId: -1, drawnBad: false })
  const ghost = useMemo(() => {
    const fill = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: GHOST_FILL, depthWrite: false, ...NO_BLOOM_BLEND })
    fill.toneMapped = false
    // Both sides: the field's frame can be mirrored (an axis running -1), which turns a screen-space line's quads round.
    const line = Object.assign(sharedOutline({ color: GHOST_LINE, opacity: 0.9 }), NO_BLOOM_BLEND, { side: DoubleSide })
    return { fill, line, lines: outlineLines(GHOST_EDGES, line) }
  }, [])
  useEffect(() => () => { ghost.fill.dispose(); ghost.line.dispose(); ghost.lines.geometry.dispose() }, [ghost])
  useFrame((state) => {
    const s = terrainSession
    const f = frame.current, o = outline.current, sv = survey.current, rg = reachGroup.current, gg = ghostGroup.current
    if (!f || !o || !sv || !rg || !gg) return
    const st = useTerrain.getState()
    const cs = useCyberspace.getState()
    const on = !!s && st.active && s.plane === cs.plane
    f.visible = on
    if (!s || !on) { terrainCursor.hit = null; terrainCursor.air = null; useAirPlace.getState().setGhost('off'); return }
    fieldMatrix(s, axes, drawnScale(), f.matrix)
    f.matrixWorldNeedsUpdate = true
    // The cross, the mouse or a tap, cast into the blocks: in the field's frame, where a cell d is centred on d + 0.5.
    inverse.copy(f.matrix).invert()
    const aim = (p: { x: number; y: number } | null): RayHit | null => {
      ndc.set(p?.x ?? 0, p?.y ?? 0)
      ray.setFromCamera(ndc, state.camera)
      from.copy(ray.ray.origin).applyMatrix4(inverse)
      toward.copy(ray.ray.origin).add(ray.ray.direction).applyMatrix4(inverse).sub(from)
      const solid = (i: number, j: number, k: number): boolean => isSolid(s.world.blockCs(i, j, k))
      return raycast([from.x - 0.5, from.y - 0.5, from.z - 0.5], [toward.x, toward.y, toward.z], CURSOR_REACH, solid)
    }
    // Whether a shard (any tap target) stands nearer along the ray than `distance` blocks (a hit's face, the ghost): the nearest thing wins, so a tap there is the shard's, never the block's behind it (TapOccluder.tsx).
    const shardInFront = (distance: number): boolean => {
      // `aim` left the ray and the field's frame: the point, back in render space.
      point.copy(toward).normalize().multiplyScalar(distance).add(from).applyMatrix4(f.matrix)
      return tapClaimNearer(ray, state.internal.interaction as Object3D[], point.distanceTo(ray.ray.origin))
    }
    // With no block in reach along the ray `aim` just cast, the ghost at arm's length, while a block is in hand (lib/terrain/airPlace.ts).
    const airDistance = useAirPlace.getState().distance
    terrainCursor.hit = aim(terrainInput.hover)
    terrainCursor.air = airAimInto(hoverAir, terrainCursor.hit, from, toward, airDistance)
    const act = terrainInput.action
    const now = performance.now()
    if (act) {
      terrainInput.action = null
      let hit = act.at ? aim(act.at) : terrainCursor.hit
      let air = act.at ? airAimInto(pressAir, hit, from, toward, airDistance) : terrainCursor.air
      // One ray for the press: a shard in front takes the tap (R3F's click) and the block behind stays, or the ghost's cell stays open.
      if (hit && shardInFront(hit.distance)) hit = null
      if (air && shardInFront(airDistance)) air = null
      // A prize toy in front takes the tap: its card opens (scene/PrizeToys.tsx), and the block behind stays.
      if (act.at === null) aim(null)
      // As far as the block hit, or the ghost: the nearest thing takes the press.
      const toy = pickToy(from, toward, hit ? hit.distance + 0.5 : air ? airDistance + 0.5 : CURSOR_REACH + 1)
      if (toy) { usePrizePick.getState().select(toy); hidden.current = false; return }
      if (act.kind === 'mine') st.mine(hit)
      else st.place(hit, air)
      if (act.at) { terrainCursor.hit = hit; terrainCursor.air = air }
      hidden.current = false
    } else if (terrainCursor.hit && now - looked.current >= SHARD_LOOK_MS) {
      // The outline follows the same rule, looked at a few times a second, not every frame.
      looked.current = now
      hidden.current = shardInFront(terrainCursor.hit.distance)
    } else if (terrainCursor.air && now - looked.current >= SHARD_LOOK_MS) {
      looked.current = now
      hidden.current = shardInFront(airDistance)
    } else if (!terrainCursor.hit && !terrainCursor.air) hidden.current = false
    const hit = hidden.current ? null : terrainCursor.hit
    // The ghost: where PLACE would put the block in open air, dim red where it cannot go.
    const air = hidden.current ? null : terrainCursor.air
    gg.visible = !!air
    if (air) {
      gg.position.set(air.cell[0] + 0.5, air.cell[1] + 0.5, air.cell[2] + 0.5)
      // Asked again only when the cell, the eye's cell, where you stand or the blocks change (or every GHOST_RECHECK_MS).
      const g = ghostSeen.current
      const ex = Math.floor(air.eye![0] + 0.5), ey = Math.floor(air.eye![1] + 0.5), ez = Math.floor(air.eye![2] + 0.5)
      const head = cs.walking ? cs.cursor : cs.position
      if (air.cell[0] !== g.cx || air.cell[1] !== g.cy || air.cell[2] !== g.cz || ex !== g.ex || ey !== g.ey || ez !== g.ez || head !== g.head || s.version !== g.version || now - g.at >= GHOST_RECHECK_MS) {
        g.cx = air.cell[0]; g.cy = air.cell[1]; g.cz = air.cell[2]; g.ex = ex; g.ey = ey; g.ez = ez; g.head = head; g.version = s.version; g.at = now
        g.bad = airRefusal(s, air) !== null
      }
      const bad = g.bad
      // The colours change only with the block in hand or the answer.
      const id = heldPlaceable() ?? 0
      if (id !== g.drawnId || bad !== g.drawnBad) {
        g.drawnId = id; g.drawnBad = bad
        if (bad) ghost.fill.color.copy(GHOST_BAD_COLOUR)
        else ghost.fill.color.set(blockKind(id)?.color ?? GHOST_LINE)
        ghost.fill.opacity = bad ? GHOST_BAD_FILL : GHOST_FILL
        ghost.line.color.copy(bad ? GHOST_BAD_COLOUR : GHOST_LINE_COLOUR)
      }
      sizeOutline(ghost.line, state.size)
      useAirPlace.getState().setGhost(bad ? 'bad' : 'ok')
    } else {
      // Switched off where a ghost would stand (no block at the cross, one in hand): none drawn, and the stepper shows
      // its off state there, so a tap on it turns air placing back on (store/airSwitch.ts).
      useAirPlace.getState().setGhost(!terrainCursor.hit && !hidden.current && !airPlacing() && heldPlaceable() !== null ? 'hidden' : 'off')
    }
    o.visible = !!hit
    if (hit) {
      o.position.set(hit.cell[0] + 0.5, hit.cell[1] + 0.5, hit.cell[2] + 0.5)
      // Whose block it is (store/terrainShare.ts): mint yours or in your home, amber someone else's, white unbuilt ground.
      const at = s.world.locate(hit.cell[0], hit.cell[1], hit.cell[2])
      ;(o.material as LineBasicMaterial).color.set(cellInReach(s, hit.cell) ? AIM_COLORS[aimAt(at.slot?.key ?? null, at.cell)] : OUTLINE_FAR)
    }
    if (now - last.current < 200) return
    last.current = now
    // The chunks in reach of where the walk has taken you, and the one SURVEY would fill.
    let n = 0
    for (const sl of s.world.slots) {
      if (!slotInReach(s, sl.key)) continue
      const box = rg.children[n] as LineSegments | undefined
      if (!box) break
      box.position.set(32 * sl.off[0] + 16, 32 * sl.off[1] + 16, 32 * sl.off[2] + 16)
      box.visible = true
      n++
    }
    for (let i = n; i < rg.children.length; i++) rg.children[i].visible = false
    const key = surveyTarget(s)
    const sl = key ? s.world.slotByKey(key) : null
    // While SURVEY is held, its own chunk glows instead (SurveyGlow.tsx).
    sv.visible = !!sl && useSurveyHold.getState().since === null
    if (sl) sv.position.set(32 * sl.off[0] + 16, 32 * sl.off[1] + 16, 32 * sl.off[2] + 16)
  })
  return (
    <group ref={frame} name="terrain-marks" visible={false} matrixAutoUpdate={false}>
      {/* The targeted block: a thin plain outline that never blooms (owner, 2026-11-24: "get rid of the block preview glow"). */}
      <lineSegments ref={outline} geometry={CURSOR_EDGES} renderOrder={5} material={outlineMaterial} />
      {/* What a smash there would take, pulsing (SmashPreview.tsx): the Compiler in hand, or any hand while SMASH is held. */}
      <SmashPreview />
      {/* The ghost at arm's length: the block in hand, see through, where PLACE puts it in open air. */}
      <group ref={ghostGroup} visible={false}>
        <mesh geometry={GHOST_BOX} material={ghost.fill} renderOrder={4} raycast={() => {}} />
        <primitive object={ghost.lines} renderOrder={5} />
      </group>
      <group ref={reachGroup}>
        {Array.from({ length: 8 }, (_, i) => (
          <lineSegments key={i} geometry={UNIT_EDGES} scale={32} visible={false}>
            <lineBasicMaterial color="#7cffc4" transparent opacity={0.18} {...NO_BLOOM_BLEND} />
          </lineSegments>
        ))}
      </group>
      <lineSegments ref={survey} geometry={UNIT_EDGES} scale={32} visible={false}>
        <lineBasicMaterial color="#7cffc4" transparent opacity={0.5} {...NO_BLOOM_BLEND} />
      </lineSegments>
      {/* The chunk a SURVEY hold will fill, lit while it is held, flashing as it completes. */}
      <SurveyGlow />
    </group>
  )
}

/** A tap on the blocks means something while TERRAIN is on (it mines), or while a press is TERRAIN's alone. */
function terrainClaims(): boolean {
  return terrainInput.swallowTap || useTerrain.getState().active
}

export function TerrainLayer({ axes }: { axes: ViewAxes }): JSX.Element {
  // Others' blocks round you are read while the scene draws blocks, in every mode (store/terrainShare.ts), as shards are scanned while the app shows them.
  useEffect(() => { sceneDraws(true); return () => sceneDraws(false) }, [])
  return (
    <>
      <Chunks axes={axes} />
      <Marks axes={axes} />
      <SmashFx axes={axes} />
      <SmashKick />
      {/* What the blocks hide takes no tap, in every mode; in TERRAIN a tap on them mines (TapOccluder.tsx). */}
      <TapOccluder distance={(r) => (terrainInput.swallowTap ? 0 : blockOcclusion(terrainSession, axes, r))} claims={terrainClaims} />
    </>
  )
}
