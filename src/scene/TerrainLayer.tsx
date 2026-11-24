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
 * The glow. Ordinary rock writes the world's untagged colour (alpha 0, as a
 * shard face does), which the world bloom skips (scene/worldBloom.tsx); the
 * glowing texels of Glowcore, Gibsonite, the Relic shard, Prismite and the
 * embers in Cinderrock write alpha 1, so they feed the bloom for real, while
 * GLOW is on in Settings (store/useLayers.ts glow).
 *
 * TERRAIN is WALK with block tools (store/useTerrain.ts): the camera and
 * the walker are WALK's. Here are only its marks, in the field's frame: the
 * block cursor on what the cross (or the mouse, or a tap) points at within
 * CURSOR_REACH, the chosen block's ghost, the chunks in reach and the chunk
 * SURVEY would fill; and a press waiting from the HUD is done here, where
 * the camera is.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Mesh, MeshBasicMaterial,
  Raycaster, Vector2, Vector3, type LineSegments,
} from 'three'
import { cellInReach, slotInReach, surveyTarget, terrainSession, useTerrain, type TerrainSession } from '../store/useTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { raycast, type RayHit } from '../lib/terrain/raycast'
import { CURSOR_REACH, TerrainWorld, type ChunkSlot } from '../lib/terrain/world'
import { borderSlab, FLOATS_PER_VERTEX, type Borders } from '../lib/terrain/mesh'
import { meshChunkAsync } from '../lib/terrain/blocksClient'
import { blockKind, solid as isSolid } from '../lib/terrain/blocks'
import { terrainInput } from '../terrain/terrainInput'
import { makeTerrainMaterial } from '../terrain/terrainMaterial'
import { BUILD, DANGER } from '../lib/palette'
import { alignedOrigin } from '../store/useCyberspace'
import type { ViewAxes } from '../lib/space'

/** Chunks meshing at once. */
const MESH_IN_FLIGHT = 2

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
 */
export function fieldMatrix(s: TerrainSession, axes: ViewAxes, scaleExp: number, out: Matrix4, shift: readonly [number, number, number] = [0, 0, 0]): Matrix4 {
  const cs = useCyberspace.getState()
  const origin = alignedOrigin(cs.anchor, scaleExp)
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
  const seen = useRef(-1)
  const placedFor = useRef('')
  const field = useRef<TerrainSession | null>(null)
  useEffect(() => () => {
    for (const ms of meshes.current.values()) for (const m of ms) m.geometry.dispose()
    meshes.current.clear()
    made.dispose()
  }, [made])
  useFrame(() => {
    const g = group.current
    if (!g) return
    const s = terrainSession
    const cs = useCyberspace.getState()
    // A new field (another identity, another plane): what the old one drew goes.
    if (field.current !== s) {
      for (const ms of meshes.current.values()) for (const m of ms) { g.remove(m); m.geometry.dispose() }
      meshes.current.clear()
      field.current = s
      seen.current = -1
      placedFor.current = ''
    }
    const show = !!s && s.plane === cs.plane && cs.scaleExp <= MAX_SCALE
    g.visible = show
    if (!s || !show) return
    made.setView(2 ** -cs.scaleExp, useLayers.getState().glow)
    // Placed again when the anchor, the zoom or the axes change.
    const a = cs.anchor
    const place = `${a.x},${a.y},${a.z}|${cs.scaleExp}|${axes.right.axis}${axes.right.dir}${axes.up.axis}${axes.up.dir}${axes.out.axis}${axes.out.dir}`
    const replace = place !== placedFor.current
    placedFor.current = place
    // Chunks let go: their meshes go.
    for (const [slot, ms] of meshes.current) {
      if (s.world.chunks.get(slot.off.join(',')) === slot && slot.blocks) continue
      for (const m of ms) { g.remove(m); m.geometry.dispose() }
      meshes.current.delete(slot)
    }
    if (replace) for (const [slot, ms] of meshes.current) for (const m of ms) { fieldMatrix(s, axes, cs.scaleExp, m.matrix, [32 * slot.off[0], 32 * slot.off[1], 32 * slot.off[2]]); m.matrixWorldNeedsUpdate = true }
    if (s.version === seen.current && inFlight.current.size === 0) return
    seen.current = s.version
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
        // The solid blocks, then the see-through ones (drawn after, blended over what is behind).
        for (const [vertices, indices, material, order] of [[m.vertices, m.indices, made.material, 0], [m.clearVertices, m.clearIndices, made.clearMaterial, 1]] as const) {
          if (indices.length === 0) continue
          const geo = new BufferGeometry()
          const ib = new InterleavedBuffer(vertices, FLOATS_PER_VERTEX)
          geo.setAttribute('position', new InterleavedBufferAttribute(ib, 3, 0))
          geo.setAttribute('tile', new InterleavedBufferAttribute(ib, 1, 3))
          geo.setAttribute('shade', new InterleavedBufferAttribute(ib, 1, 4))
          geo.setIndex(new BufferAttribute(indices, 1))
          geo.computeBoundingSphere()
          const mesh = new Mesh(geo, material)
          mesh.matrixAutoUpdate = false
          mesh.renderOrder = order
          fieldMatrix(s, axes, useCyberspace.getState().scaleExp, mesh.matrix, [32 * slot.off[0], 32 * slot.off[1], 32 * slot.off[2]])
          mesh.name = `terrain-chunk-${slot.key}${order ? '-clear' : ''}`
          g.add(mesh)
          made2.push(mesh)
        }
        meshes.current.set(slot, made2)
      }, () => { inFlight.current.delete(slot); slot.dirty = true; seen.current = -1 })
    }
  })
  return <group ref={group} name="terrain-chunks" />
}

const CURSOR_EDGES = new EdgesGeometry(new BoxGeometry(1.02, 1.02, 1.02))
const GHOST_BOX = new BoxGeometry(0.98, 0.98, 0.98)
const UNIT_EDGES = new EdgesGeometry(new BoxGeometry(1, 1, 1))

const ray = new Raycaster()
const ndc = new Vector2()
const inverse = new Matrix4()
const from = new Vector3()
const toward = new Vector3()

/**
 * TERRAIN's marks, in the field's frame (fieldMatrix): the block cursor, the
 * chosen block's ghost, the chunks in reach, the chunk SURVEY would fill.
 * Each frame the cross (or the mouse) is cast into the blocks from WALK's
 * camera, and a press waiting from the HUD is done.
 */
function Marks({ axes }: { axes: ViewAxes }): JSX.Element {
  const frame = useRef<Group>(null)
  const outline = useRef<LineSegments>(null)
  const ghost = useRef<Mesh>(null)
  const survey = useRef<LineSegments>(null)
  const reachGroup = useRef<Group>(null)
  const ghostMat = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, depthWrite: false }), [])
  useEffect(() => () => ghostMat.dispose(), [ghostMat])
  const last = useRef(0)
  useFrame((state) => {
    const s = terrainSession
    const f = frame.current, o = outline.current, gh = ghost.current, sv = survey.current, rg = reachGroup.current
    if (!f || !o || !gh || !sv || !rg) return
    const st = useTerrain.getState()
    const cs = useCyberspace.getState()
    const on = !!s && st.active && s.plane === cs.plane
    f.visible = on
    if (!s || !on) { terrainCursor.hit = null; return }
    fieldMatrix(s, axes, cs.scaleExp, f.matrix)
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
    gh.visible = false
    if (hit) {
      o.position.set(hit.cell[0] + 0.5, hit.cell[1] + 0.5, hit.cell[2] + 0.5)
      ;(o.material as MeshBasicMaterial).color.set(cellInReach(s, hit.cell) ? BUILD : DANGER)
      const inv = st.inventory
      const id = inv.hotbar[inv.slot]
      const kind = id && inv.counts[id] > 0 ? blockKind(id) : null
      const to: [number, number, number] = [hit.cell[0] + hit.normal[0], hit.cell[1] + hit.normal[1], hit.cell[2] + hit.normal[2]]
      const face = hit.normal[0] !== 0 || hit.normal[1] !== 0 || hit.normal[2] !== 0
      gh.visible = !!kind && face && cellInReach(s, to)
      if (gh.visible && kind) { gh.position.set(to[0] + 0.5, to[1] + 0.5, to[2] + 0.5); ghostMat.color.set(kind.edge) }
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
      <lineSegments ref={outline} geometry={CURSOR_EDGES} renderOrder={5}>
        <lineBasicMaterial color={BUILD} transparent opacity={0.95} depthTest={false} toneMapped={false} />
      </lineSegments>
      <mesh ref={ghost} geometry={GHOST_BOX} material={ghostMat} renderOrder={4} />
      <group ref={reachGroup}>
        {Array.from({ length: 8 }, (_, i) => (
          <lineSegments key={i} geometry={UNIT_EDGES} scale={32} visible={false}>
            <lineBasicMaterial color="#7cffc4" transparent opacity={0.22} toneMapped={false} />
          </lineSegments>
        ))}
      </group>
      <lineSegments ref={survey} geometry={UNIT_EDGES} scale={32} visible={false}>
        <lineBasicMaterial color="#7cffc4" transparent opacity={0.75} toneMapped={false} />
      </lineSegments>
    </group>
  )
}

export function TerrainLayer({ axes }: { axes: ViewAxes }): JSX.Element {
  return (
    <>
      <Chunks axes={axes} />
      <Marks axes={axes} />
    </>
  )
}
