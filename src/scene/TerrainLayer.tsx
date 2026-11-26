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
 * the neighbours still being generated round it (up to LIGHT_WAIT_MS), which
 * would otherwise count as open space for a moment; one whose light is being
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
 * CURSOR_REACH (a plain outline, no glow), the chunks in reach and the chunk
 * SURVEY would fill; and a press waiting from the HUD is done here, where
 * the camera is.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, LineBasicMaterial, Matrix4, Mesh,
  Raycaster, Vector2, Vector3, type Data3DTexture, type LineSegments, type ShaderMaterial,
} from 'three'
import { cellInReach, slotInReach, surveyTarget, terrainSession, useTerrain, type TerrainSession } from '../store/useTerrain'
import { AIM_COLORS, aimAt, sceneDraws } from '../store/terrainShare'
import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { raycast, type RayHit } from '../lib/terrain/raycast'
import { CURSOR_REACH, TerrainWorld, type ChunkSlot } from '../lib/terrain/world'
import { borderSlab, FLOATS_PER_VERTEX, type Borders } from '../lib/terrain/mesh'
import { lightChunkAsync, meshChunkAsync } from '../lib/terrain/blocksClient'
import { solid as isSolid } from '../lib/terrain/blocks'
import { lightTables, shadedColumns } from '../lib/terrain/light'
import { terrainInput } from '../terrain/terrainInput'
import { lightTexture, makeTerrainMaterial } from '../terrain/terrainMaterial'
import { NO_BLOOM_BLEND } from './shardFaces'
import { alignedOrigin } from '../store/useCyberspace'
import type { Position, ViewAxes } from '../lib/space'
import { committedAnchor, committedScale } from '../lib/renderFrame'

/** Chunks meshing at once. */
const MESH_IN_FLIGHT = 2
/** Chunks' light being worked out at once. */
const LIGHT_IN_FLIGHT = 2
/** The longest a chunk's light waits for neighbours still being generated. */
const LIGHT_WAIT_MS = 1500

/** Which ids let light through, for a chunk's shaded columns (lib/terrain/light.ts). */
let passTable: Uint8Array | null = null

/** Whether any of a chunk's 26 neighbours is still being generated (store/useTerrain.ts building). */
function neighbourBuilding(s: TerrainSession, slot: ChunkSlot): boolean {
  if (s.building.size === 0) return false
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy && !dz) continue
    const n = s.world.slotAt(slot.off[0] + dx, slot.off[1] + dy, slot.off[2] + dz)
    if (n && !n.blocks && s.building.has(n.key)) return true
  }
  return false
}

/** The eye in the field's frame, for the light's order. */
const eyeField = new Matrix4()

/** A chunk's light on the GPU, and its two materials reading it. */
interface ChunkLight { tex: Data3DTexture; material: ShaderMaterial; clearMaterial: ShaderMaterial }

/** Past this zoom a chunk (32 gibsons) is a few pixels at most: not drawn. */
export const MAX_SCALE = 6

/** What the cursor points at now, for the HUD and the buttons (MINE and PLACE act on it). */
export const terrainCursor: { hit: RayHit | null } = { hit: null }

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
  /** When a chunk's light was first held back for neighbours still being generated. */
  const heldSince = useRef(new WeakMap<ChunkSlot, number>())
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
    made.setView(2 ** -zoom, layers.glow, shading)
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
    if (s.version === seen.current && inFlight.current.size === 0 && lightFlight.current.size === 0) return
    seen.current = s.version
    // A light held back for a neighbour being generated looks again next frame, so its wait can run out.
    if (shading && scheduleLight(s, state.camera.position)) seen.current = -1
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

  /** Work out the light of the chunks that need it, nearest the eye first; each answer goes to its chunk's materials. True when one is held back. */
  const scheduleLight = (s: TerrainSession, eye: Vector3): boolean => {
    const want = s.world.lightDirtySlots().filter((sl) => !lightFlight.current.has(sl))
    if (want.length === 0 || lightFlight.current.size >= LIGHT_IN_FLIGHT) return false
    let held = false
    // The eye in the field's frame, in chunks.
    const at = eye.clone().applyMatrix4(fieldMatrix(s, axes, drawnScale(), eyeField).invert()).divideScalar(32)
    const far = (sl: ChunkSlot): number => Math.max(Math.abs(sl.off[0] + 0.5 - at.x), Math.abs(sl.off[1] + 0.5 - at.y), Math.abs(sl.off[2] + 0.5 - at.z))
    want.sort((a, b) => far(a) - far(b))
    const now = performance.now()
    for (const slot of want) {
      if (lightFlight.current.size >= LIGHT_IN_FLIGHT) break
      // A neighbour still being generated would read as open space: wait for it, a while at most.
      if (neighbourBuilding(s, slot)) {
        const since = heldSince.current.get(slot) ?? now
        heldSince.current.set(slot, since)
        if (now - since < LIGHT_WAIT_MS) { held = true; continue }
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
          return
        }
        const tex = lightTexture(bytes)
        const mats = made.forChunk(tex)
        lights.current.set(slot, { tex, ...mats })
        for (const m of meshes.current.get(slot) ?? []) m.material = m.renderOrder ? mats.clearMaterial : mats.material
        reveal(slot)
      }, () => { lightFlight.current.delete(slot); slot.lightDirty = true; seen.current = -1 })
    }
    return held
  }
  return <group ref={group} name="terrain-chunks" />
}

const CURSOR_EDGES = new EdgesGeometry(new BoxGeometry(1.02, 1.02, 1.02))
/** The targeted block's outline: by whose block it is (AIM_COLORS), a dull red out of reach. */
const OUTLINE = '#ffffff'
const OUTLINE_FAR = '#c86464'
const UNIT_EDGES = new EdgesGeometry(new BoxGeometry(1, 1, 1))

const ray = new Raycaster()
const ndc = new Vector2()
const inverse = new Matrix4()
const from = new Vector3()
const toward = new Vector3()

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
  useFrame((state) => {
    const s = terrainSession
    const f = frame.current, o = outline.current, sv = survey.current, rg = reachGroup.current
    if (!f || !o || !sv || !rg) return
    const st = useTerrain.getState()
    const cs = useCyberspace.getState()
    const on = !!s && st.active && s.plane === cs.plane
    f.visible = on
    if (!s || !on) { terrainCursor.hit = null; return }
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
    terrainCursor.hit = aim(terrainInput.hover)
    const act = terrainInput.action
    if (act) {
      terrainInput.action = null
      const hit = act.at ? aim(act.at) : terrainCursor.hit
      if (act.kind === 'mine') st.mine(hit)
      else st.place(hit)
      if (act.at) terrainCursor.hit = hit
    }
    const hit = terrainCursor.hit
    o.visible = !!hit
    if (hit) {
      o.position.set(hit.cell[0] + 0.5, hit.cell[1] + 0.5, hit.cell[2] + 0.5)
      // Whose block it is (store/terrainShare.ts): mint yours or in your home, amber someone else's, white unbuilt ground.
      const at = s.world.locate(hit.cell[0], hit.cell[1], hit.cell[2])
      ;(o.material as LineBasicMaterial).color.set(cellInReach(s, hit.cell) ? AIM_COLORS[aimAt(at.slot?.key ?? null, at.cell)] : OUTLINE_FAR)
    }
    const now = performance.now()
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
    sv.visible = !!sl
    if (sl) sv.position.set(32 * sl.off[0] + 16, 32 * sl.off[1] + 16, 32 * sl.off[2] + 16)
  })
  return (
    <group ref={frame} name="terrain-marks" visible={false} matrixAutoUpdate={false}>
      {/* The targeted block: a thin plain outline that never blooms (owner, 2026-11-24: "get rid of the block preview glow"). */}
      <lineSegments ref={outline} geometry={CURSOR_EDGES} renderOrder={5}>
        <lineBasicMaterial color={OUTLINE} transparent opacity={0.6} depthTest={false} {...NO_BLOOM_BLEND} />
      </lineSegments>
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
    </group>
  )
}

export function TerrainLayer({ axes }: { axes: ViewAxes }): JSX.Element {
  // Others' blocks round you are read while the scene draws blocks, in every mode (store/terrainShare.ts), as shards are scanned while the app shows them.
  useEffect(() => { sceneDraws(true); return () => sceneDraws(false) }, [])
  return (
    <>
      <Chunks axes={axes} />
      <Marks axes={axes} />
    </>
  )
}
