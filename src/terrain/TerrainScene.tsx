/**
 * TerrainScene.tsx - what TERRAIN's canvas draws, and the body moved each frame.
 *
 * - The chunks: one mesh per surveyed chunk of the visit's 27, greedily
 *   meshed in the blocks worker (lib/terrain/mesh.ts) and meshed again only
 *   when that chunk, or the border of a neighbour, changed. At most two
 *   chunks are meshing at once, so a survey never stalls a frame.
 * - The block cursor: an outline on the block the look (or the mouse) points
 *   at within CURSOR_REACH, a lit face where a block would be placed, and a
 *   ghost of the chosen block there.
 * - The shards that stand round you, as cyberspace draws them, so the walls
 *   the body meets are seen (scene/WorldShards.tsx placeShard).
 *
 * The camera is the builder's eye: first person, the look's yaw and pitch,
 * at EYE_HEIGHT over the feet.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import {
  BoxGeometry, BufferAttribute, BufferGeometry, EdgesGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, Matrix4, Mesh, MeshBasicMaterial,
  Raycaster, Vector2, Vector3, type LineSegments,
} from 'three'
import { terrainSession, useTerrain, bodyWorld, slotInReach, surveyTargetOf, viewInReach } from '../store/useTerrain'
import { stepBody, EYE_HEIGHT } from '../lib/terrain/body'
import { raycast, type RayHit } from '../lib/terrain/raycast'
import { CURSOR_REACH, TerrainWorld } from '../lib/terrain/world'
import { borderSlab, FLOATS_PER_VERTEX, type Borders } from '../lib/terrain/mesh'
import { meshChunkAsync } from '../lib/terrain/blocksClient'
import { EMPTY, blockKind } from '../lib/terrain/blocks'
import { heldMove, terrainInput } from './terrainInput'
import { makeTerrainMaterial } from './terrainMaterial'
import { useShards } from '../store/useShards'
import { drawableShards } from '../scene/WorldShards'
import { ShardMesh } from '../scene/ShardMesh'
import { GlowFollowsSetting } from '../scene/PointBillboards'
import { BUILD, DANGER } from '../lib/palette'

/** Chunks meshing at once. */
const MESH_IN_FLIGHT = 2

/** What the cursor points at now, for the HUD and the buttons (MINE and PLACE act on it). */
export const terrainCursor: { hit: RayHit | null } = { hit: null }

/** The matrix that turns a chunk's own frame (cyberspace axes, cells [x, x + 1]) into the view's, for the slot at index s. */
function slotMatrix(world: TerrainWorld, s: number): Matrix4 {
  const [cx, cy, cz] = TerrainWorld.chunkOffset(s)
  const col = (cs: 0 | 1 | 2): Vector3 => {
    const v = world.viewAxisOf(cs)
    const out = new Vector3()
    out.setComponent(v.axis, v.dir)
    return out
  }
  const m = new Matrix4().makeBasis(col(0), col(1), col(2))
  // A cell's centre is its integer offset: the chunk's corner is half a block before its first cell.
  const t = world.toView(32 * cx - 0.5, 32 * cy - 0.5, 32 * cz - 0.5)
  m.setPosition(t[0], t[1], t[2])
  return m
}

/** The borders a slot's mesh reads from its neighbours (mesh.ts Borders). */
function bordersOf(world: TerrainWorld, s: number): Borders {
  const [cx, cy, cz] = TerrainWorld.chunkOffset(s)
  const out: Array<Uint8Array | null> = []
  const steps: Array<[number, number, number]> = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]]
  steps.forEach(([ax, ay, az], face) => {
    const nx = cx + ax, ny = cy + ay, nz = cz + az
    if (Math.abs(nx) > 1 || Math.abs(ny) > 1 || Math.abs(nz) > 1) { out.push(null); return }
    const n = world.slots[TerrainWorld.slotIndex(nx, ny, nz)]
    out.push(n.blocks ? borderSlab(n.blocks, face ^ 1) : null)
  })
  return out as Borders
}

/** The drawn skin's blob seed for a chunk (the previews' rind seed). */
function slotSeed(b: { x: bigint; y: bigint; z: bigint }): number {
  return (Number(b.x & 0xffffn) * 31 + Number(b.y & 0xffffn) * 17 + Number(b.z & 0xffffn)) | 0
}

function Chunks(): JSX.Element {
  const group = useRef<Group>(null)
  const made = useMemo(() => makeTerrainMaterial(), [])
  const material = made.material
  const meshes = useRef(new Map<number, Mesh>())
  const inFlight = useRef(new Set<number>())
  const seen = useRef(-1)
  useEffect(() => () => {
    for (const m of meshes.current.values()) m.geometry.dispose()
    meshes.current.clear()
    made.dispose()
  }, [made])
  useFrame(() => {
    const s = terrainSession
    const g = group.current
    if (!s || !g) return
    if (s.version === seen.current && inFlight.current.size === 0) return
    seen.current = s.version
    const world = s.world
    for (let i = 0; i < world.slots.length; i++) {
      if (inFlight.current.size >= MESH_IN_FLIGHT) break
      const slot = world.slots[i]
      if (!slot.dirty || !slot.blocks || inFlight.current.has(i)) continue
      slot.dirty = false
      inFlight.current.add(i)
      const skin = slot.skin ? { ...slot.skin, seed: slotSeed(slot.base) } : null
      void meshChunkAsync(slot.blocks, bordersOf(world, i), skin).then((m) => {
        inFlight.current.delete(i)
        // Looked at again next frame: anything changed meanwhile is dirty still.
        seen.current = -1
        if (terrainSession !== s) return
        const old = meshes.current.get(i)
        if (old) { g.remove(old); old.geometry.dispose(); meshes.current.delete(i) }
        if (m.quads === 0) return
        const geo = new BufferGeometry()
        const ib = new InterleavedBuffer(m.vertices, FLOATS_PER_VERTEX)
        geo.setAttribute('position', new InterleavedBufferAttribute(ib, 3, 0))
        geo.setAttribute('tile', new InterleavedBufferAttribute(ib, 1, 3))
        geo.setAttribute('shade', new InterleavedBufferAttribute(ib, 1, 4))
        geo.setIndex(new BufferAttribute(m.indices, 1))
        geo.computeBoundingSphere()
        const mesh = new Mesh(geo, material)
        mesh.matrixAutoUpdate = false
        mesh.matrix.copy(slotMatrix(world, i))
        mesh.updateMatrixWorld(true)
        mesh.name = `terrain-chunk-${i}`
        g.add(mesh)
        meshes.current.set(i, mesh)
      }, () => { inFlight.current.delete(i); slot.dirty = true; seen.current = -1 })
    }
  })
  return <group ref={group} name="terrain-chunks" />
}

const CURSOR_EDGES = new EdgesGeometry(new BoxGeometry(1.02, 1.02, 1.02))
const GHOST_BOX = new BoxGeometry(0.98, 0.98, 0.98)

/** The outline on the block pointed at, and the chosen block's ghost where it would go. */
function Cursor(): JSX.Element {
  const outline = useRef<LineSegments>(null)
  const ghost = useRef<Mesh>(null)
  const ghostMat = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, depthWrite: false }), [])
  useEffect(() => () => ghostMat.dispose(), [ghostMat])
  useFrame(() => {
    const s = terrainSession
    const hit = terrainCursor.hit
    const o = outline.current, g = ghost.current
    if (!o || !g) return
    if (!s || !hit) { o.visible = false; g.visible = false; return }
    o.visible = true
    o.position.set(hit.cell[0], hit.cell[1], hit.cell[2])
    const reach = viewInReach(s, hit.cell)
    const mat = o.material as MeshBasicMaterial
    mat.color.set(reach ? BUILD : DANGER)
    const inv = useTerrain.getState().inventory
    const id = inv.hotbar[inv.slot]
    const kind = id && inv.counts[id] > 0 ? blockKind(id) : null
    const to: [number, number, number] = [hit.cell[0] + hit.normal[0], hit.cell[1] + hit.normal[1], hit.cell[2] + hit.normal[2]]
    const face = hit.normal[0] !== 0 || hit.normal[1] !== 0 || hit.normal[2] !== 0
    g.visible = !!kind && face && viewInReach(s, to)
    if (g.visible && kind) {
      g.position.set(to[0], to[1], to[2])
      ghostMat.color.set(kind.edge)
    }
  })
  return (
    <>
      <lineSegments ref={outline} geometry={CURSOR_EDGES} renderOrder={5}>
        <lineBasicMaterial color={BUILD} transparent opacity={0.95} depthTest={false} toneMapped={false} />
      </lineSegments>
      <mesh ref={ghost} geometry={GHOST_BOX} material={ghostMat} renderOrder={4} />
    </>
  )
}

const UNIT_EDGES = new EdgesGeometry(new BoxGeometry(1, 1, 1))

/**
 * Boxes that say where things are allowed: the chunks within reach of your
 * chain, faint; and the chunk
 * SURVEY would fill now, brighter, so "chunk" is a thing you can see.
 */
function Bounds(): JSX.Element {
  const survey = useRef<LineSegments>(null)
  // The chunks within reach of your chain (DECK-0009 §6.2): whole chunks, the head's and the neighbours it is near.
  const reach = useMemo(() => {
    const s = terrainSession
    if (!s) return []
    return s.world.slots.flatMap((sl, i) => {
      if (!slotInReach(s, sl.key)) return []
      const [cx, cy, cz] = TerrainWorld.chunkOffset(i)
      return [{ key: sl.key, centre: s.world.toView(32 * cx + 15.5, 32 * cy + 15.5, 32 * cz + 15.5) }]
    })
  }, [])
  const last = useRef(0)
  useFrame(() => {
    const s = terrainSession, box = survey.current
    if (!s || !box) return
    const now = performance.now()
    if (now - last.current < 200) return
    last.current = now
    const key = surveyTargetOf(s, terrainInput.yaw, terrainInput.pitch)
    const i = key ? s.world.slots.findIndex((sl) => sl.key === key) : -1
    box.visible = i >= 0
    if (i < 0) return
    const [cx, cy, cz] = TerrainWorld.chunkOffset(i)
    const v = s.world.toView(32 * cx + 15.5, 32 * cy + 15.5, 32 * cz + 15.5)
    box.position.set(v[0], v[1], v[2])
  })
  return (
    <>
      {reach.map((r) => (
        <lineSegments key={r.key} geometry={UNIT_EDGES} position={r.centre} scale={32}>
          <lineBasicMaterial color="#7cffc4" transparent opacity={0.18} toneMapped={false} />
        </lineSegments>
      ))}
      <lineSegments ref={survey} geometry={UNIT_EDGES} scale={32} visible={false}>
        <lineBasicMaterial color="#7cffc4" transparent opacity={0.7} toneMapped={false} />
      </lineSegments>
    </>
  )
}

/** The shards standing round you, drawn as cyberspace draws them (their walls stop the body). */
function Shards(): JSX.Element | null {
  const items = useShards((s) => s.drawnItems())
  const s = terrainSession
  const placed = useMemo(() => {
    if (!s) return []
    const o = s.world.origin
    return drawableShards(items, { x: o.x, y: o.y, z: o.z }, s.plane, 0, s.world.axes, 80).slice(0, 40)
  }, [items, s])
  if (placed.length === 0) return null
  return (
    <GlowFollowsSetting>
      {placed.map((p) => (
        <group key={p.key} position={p.centre}>
          <ShardMesh shard={p.shard} scale={p.scale} clip={p.clip} pose={p.pose} lit />
        </group>
      ))}
    </GlowFollowsSetting>
  )
}

/** The body, the eye and the cursor, every frame. */
function Rig(): null {
  const { camera } = useThree()
  const ray = useMemo(() => new Raycaster(), [])
  const ndc = useMemo(() => new Vector2(), [])
  useEffect(() => {
    camera.rotation.order = 'YXZ'
  }, [camera])
  useFrame((_, dt) => {
    const s = terrainSession
    if (!s) return
    const st = useTerrain.getState()
    const move = heldMove()
    const busy = st.sheet || st.loading
    stepBody(s.body, { forward: busy ? 0 : move.forward, right: busy ? 0 : move.right, yaw: terrainInput.yaw, jump: !busy && move.jump, lift: busy ? 0 : move.lift }, bodyWorld(s), dt)
    camera.position.set(s.body.x, s.body.y + EYE_HEIGHT, s.body.z)
    camera.rotation.set(terrainInput.pitch, terrainInput.yaw, 0)
    camera.updateMatrixWorld()
    const solid = (i: number, j: number, k: number): boolean => s.world.blockView(i, j, k) > EMPTY
    const aim = (p: { x: number; y: number } | null): RayHit | null => {
      ndc.set(p?.x ?? 0, p?.y ?? 0)
      ray.setFromCamera(ndc, camera)
      const o = ray.ray.origin, d = ray.ray.direction
      return raycast([o.x, o.y, o.z], [d.x, d.y, d.z], CURSOR_REACH, solid)
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
  })
  return null
}

export function TerrainScene(): JSX.Element {
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[10, 18, 6]} intensity={1.1} />
      <Rig />
      <Chunks />
      <Cursor />
      <Bounds />
      <Shards />
    </>
  )
}
