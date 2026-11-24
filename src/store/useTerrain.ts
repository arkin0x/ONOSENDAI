/**
 * useTerrain.ts - TERRAIN: blocks in cyberspace, and the mode that walks them.
 *
 * Two things live here.
 *
 * THE FIELD (always, for the identity on screen). The chunks you surveyed
 * near your avatar, with your changes over their generated ground, are kept
 * loaded and drawn in every mode (scene/TerrainLayer.tsx), and WALK walks on
 * them (lib/terrain/walls.ts gives their faces to WALK's walls). A chunk
 * (aligned h5, 32 cubed, one block a gibson) is empty until SURVEY fills it
 * with DECK-0009's ground (lib/terrain/generate.ts). Everything is kept per
 * identity in IndexedDB (lib/terrain/terrainDb.ts; arkinox 2026-11-19: all
 * local data per npub): the op log of your changes, folded into layers as
 * DECK §5.5 planes (lib/terrain/layer.ts), the chunks surveyed, the
 * inventory and the first-visit hint. While LIVE, each chunk's changes are
 * shared as this device's block layer, and other builders' layers near you
 * are read and merged under yours (store/terrainShare.ts, DECK-0009 §5 to
 * §7); LOCAL shares nothing.
 *
 * TERRAIN THE MODE (owner, 2026-11-24: "I basically just want terrain mode
 * to be a normal WALK mode, but it has tools to survey and interact with
 * blocks ... The blocks should be a part of cyberspace just like any
 * shard"). It is a mode of the pad (store/modeOrder.ts, store/padMode.ts),
 * and the build bar's TERRAIN and T while building open it too. It IS WALK:
 * the same movement, camera, gravity, fluid walk and chain publishing, at a
 * gibson's zoom, with the block tools on top (terrain/TerrainView.tsx:
 * SURVEY, MINE, PLACE, the block cursor, the hotbar and the bag). The chain
 * follows you because it is WALK, which reverses the first version's "the
 * builder's body does not move your chain" (decision D7), at the owner's
 * word. Mining and placing still ask the reach rule (DECK-0009 §6.2), from
 * where the walk has taken you.
 */

import type { PadMode } from './padMode'
import { create } from 'zustand'
import { useCyberspace } from './useCyberspace'
import { useShards } from './useShards'
import { useWalk } from './useWalk'
import { walkLookDirection } from './walkFluid'
import { BRIEF_TOAST_MS, useToast } from './useToast'
import { setTerrainWalls } from './walkWalls'
import { takeSceneTaps, usePad } from './usePad'
import { chunkOf, chunkKey, type ChunkBase } from '../lib/terrain/coords'
import { RING, TerrainWorld, REACH, type Change, type ChunkSlot } from '../lib/terrain/world'
import { applyLayer, encodeLayer, isLayer, type Layer } from '../lib/terrain/layer'
import { generateChunk } from '../lib/terrain/blocksClient'
import { EMPTY, blockName, kindId, solid as isSolid } from '../lib/terrain/blocks'
import { terrainWallItems } from '../lib/terrain/walls'
import {
  FOLD_AT, HOTBAR_SLOTS, emptyInventory, foldChunk, openTerrainDb, opKey, readKept, readOwner, writeHint, writeInventory, writeOps, writeSurveyed,
  type Inventory, type OpRow,
} from '../lib/terrain/terrainDb'
import type { Position, ViewAxes } from '../lib/space'
import type { RayHit } from '../lib/terrain/raycast'
import {
  connectShareHost, fieldClosing, liveChanged, noteChange, noteMove, prepareChunk, sharedKeys, terrainClosed, terrainOpened, viewOf,
} from './terrainShare'
import { loadBuilder, releaseBuilderDb } from '../lib/terrain/builderKey'
import './terrainShareLive'

/** The first-visit hint's steps: mine one, place one, open the inventory; then done. */
export const HINT_DONE = 3

/** How long a message stays on screen, ms. */
export const MESSAGE_MS = 3200

/** How many chunks round you the surveyed ones are loaded, drawn and walkable, on each axis. */
export const DRAW_RING = 2

/** Past this many gibsons from the field's origin, the field starts again round you: numbers stay exact. */
const FAR = 2 ** 30

/**
 * The field's frame is cyberspace's own: a cell is named by its cs offset
 * from the field's origin, and the "view" axes are the identity, so a ray hit
 * (lib/terrain/raycast.ts) is in cs offsets too.
 */
const CS_AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } }

/** The blocks this device holds for the identity on screen. */
export interface TerrainSession {
  owner: string
  plane: number
  world: TerrainWorld
  /** Changes per chunk not yet folded: seq and the change. */
  pending: Map<string, Array<{ seq: number; change: Change }>>
  /** Layers folded so far, by chunk. */
  layers: Map<string, Layer>
  /** Every chunk this identity has surveyed, by key (the coordinate): the lookup that finds them wherever you are. */
  surveyedKeys: Set<string>
  /** Chunks whose stored layer this build cannot read: drawn as the bare ground and never folded, so the layer is never overwritten. */
  unreadable: Set<string>
  /** Chunks being read and generated. */
  building: Set<string>
  nextSeq: number
  db: IDBDatabase | null
  /** Bumped by every change to the blocks the field holds. */
  version: number
  /** What the identity kept is read (the inventory, the surveyed list). */
  ready: Promise<void>
}

/** The field, or null before one is made (by syncTerrain). */
export let terrainSession: TerrainSession | null = null

/** For tests: replace the field. */
export function setTerrainSession(s: TerrainSession | null): void {
  terrainSession = s
}

/** The zoom TERRAIN found, given back when it closes. */
let zoomBefore: number | null = null

export interface TerrainState {
  active: boolean
  /** Reading what this device kept and generating the chunks round you. */
  loading: boolean
  inventory: Inventory
  /** First-visit hint step, 0 to HINT_DONE. */
  hint: number
  /** A message under the cross, or null. Its slot is always there, so nothing moves. */
  message: string | null
  /** The inventory sheet is open. */
  sheet: boolean
  /** Chunks being surveyed now, by key. */
  surveying: string[]
  /** Changes waiting in the log (not yet folded into layers). */
  waiting: number

  /** TERRAIN on: WALK with the block tools (store/padMode.ts enterTerrainMode is the pad's way in). */
  enter: () => Promise<void>
  /** TERRAIN off: WALK off with it, everything waiting folded, the zoom as it was. */
  /** Leave TERRAIN; WALK ends with it unless `keepWalking` (TERRAIN entered from WALK goes back to WALK). */
  exit: (opts?: { keepWalking?: boolean }) => Promise<void>
  /** The mode TERRAIN was entered from: the way back, which the mode button names (store/padMode.ts). */
  from: PadMode
  /** SURVEY a chunk, by key. */
  survey: (key: string) => Promise<void>
  /** Mine the block a ray hit (cs offsets). True when it was mined. */
  mine: (hit: RayHit | null) => boolean
  /** Place the chosen block on the face a ray hit. True when it was placed. */
  place: (hit: RayHit | null) => boolean
  selectSlot: (slot: number) => void
  /** Put a block kind in a hotbar slot (the chosen one when absent). */
  assignSlot: (id: number, slot?: number) => void
  setSheet: (open: boolean) => void
  say: (message: string | null) => void
}

let messageTimer: ReturnType<typeof setTimeout> | undefined

/** Persist quietly: a failed write keeps the session going in memory. */
function keep(p: Promise<void> | undefined): void {
  void p?.catch(() => { /* kept in memory for this session */ })
}

/** Where you are, as the field loads round it and reach is measured from it: the walk's gibson (the cursor) while walking, your head otherwise. */
export function headNow(): Position {
  const cs = useCyberspace.getState()
  return cs.walking ? cs.cursor : cs.position
}

/** A position's cs offset from the field's origin. */
export function offsetOf(s: Pick<TerrainSession, 'world'>, p: Position): [number, number, number] {
  const o = s.world.origin
  return [Number(p.x - o.x), Number(p.y - o.y), Number(p.z - o.z)]
}

/** Whether the chunk holding a cell (cs offsets) is within reach of the chain (world.ts inReach, DECK-0009 §6.2). */
export function cellInReach(s: Pick<TerrainSession, 'world'>, cell: readonly [number, number, number], head: Position = headNow()): boolean {
  return TerrainWorld.inReach(cell[0], cell[1], cell[2], offsetOf(s, head))
}

/** Whether a chunk, by key, is within reach of the chain. */
export function slotInReach(s: Pick<TerrainSession, 'world'>, key: string, head: Position = headNow()): boolean {
  const sl = s.world.slotByKey(key)
  if (!sl) return false
  return TerrainWorld.inReach(32 * sl.off[0], 32 * sl.off[1], 32 * sl.off[2], offsetOf(s, head))
}

/** The plain words for a block out of reach. */
export const OUT_OF_REACH = `Too far from your avatar: you build within ${REACH} blocks of it. Hop closer to build here.`

/** Apply a chunk's folded layer and its waiting log over its generated ground. */
function builtBlocks(s: TerrainSession, key: string, generated: Uint8Array): Uint8Array {
  const layer = s.layers.get(key)
  const applied = layer ? applyLayer(generated, layer) : null
  if (layer && !applied) s.unreadable.add(key)
  const blocks = applied ?? generated.slice()
  for (const { change } of s.pending.get(key) ?? []) blocks[change.cell] = change.id
  return blocks
}

export const useTerrain = create<TerrainState>((set, get) => ({
  from: 'hop',
  active: false,
  loading: false,
  inventory: emptyInventory(),
  hint: HINT_DONE,
  message: null,
  sheet: false,
  surveying: [],
  waiting: 0,

  enter: async () => {
    if (get().active) return
    const cs = useCyberspace.getState()
    if (cs.spectate !== null || cs.exploreIndex !== null || cs.transit !== null) return
    // Blocks are gibsons: TERRAIN walks at a gibson's zoom, given back when it closes.
    zoomBefore = cs.scaleExp
    if (cs.scaleExp !== 0) useCyberspace.setState({ scaleExp: 0 })
    if (!cs.walking) useWalk.getState().enter()
    if (!useCyberspace.getState().walking) { restoreZoom(); return }
    set({ active: true, loading: true, sheet: false, message: null, surveying: [] })
    // WALK's pad stays out in TERRAIN: a tap mines there, and never folds it (takeSceneTaps below).
    usePad.getState().setOpen(true)
    await syncTerrain()
    if (get().active) set({ loading: false })
    // This device's builder key is made on TERRAIN's first use; the layers in reach are read (store/terrainShare.ts).
    if (get().active) void terrainOpened()
  },

  exit: async (opts) => {
    if (!get().active) return
    const s = terrainSession
    // All at once, before anything waits: the pad is out of TERRAIN and WALK the moment this is called (store/padMode.ts toHop).
    set({ active: false, loading: false, sheet: false, message: null, surveying: [] })
    clearTimeout(messageTimer)
    if (opts?.keepWalking) zoomBefore = null
    else {
      if (useCyberspace.getState().walking) useWalk.getState().exit()
      restoreZoom()
    }
    if (s) {
      // What waits is folded into its layers (the log keeps it either way).
      for (const key of [...s.pending.keys()]) await foldKey(s, key)
      if (s.db) keep(writeInventory(s.db, s.owner, get().inventory))
      // Closing TERRAIN shares what waits (while LIVE).
      if (terrainSession === s) void terrainClosed()
    }
    void syncTerrain()
  },

  survey: async (key) => {
    const s = terrainSession
    if (!s || get().surveying.includes(key)) return
    const slot = s.world.slotByKey(key)
    if (!slot) return
    if (!slot.inSpace) { get().say('That chunk is past the edge of cyberspace.'); return }
    if (slot.own || s.building.has(key)) return
    if (!slotInReach(s, key)) { get().say(OUT_OF_REACH); return }
    set({ surveying: [...get().surveying, key] })
    try {
      s.surveyedKeys.add(key)
      await build(s, slot)
      if (terrainSession !== s) return
      if (s.db) keep(writeSurveyed(s.db, s.owner, key, Date.now()))
      // A survey is shared like any change (DECK-0009 §3.1).
      noteChange(key)
      clearWalker(s, key)
      get().say('Terrain revealed from cyberspace\'s structure.')
    } catch {
      s.surveyedKeys.delete(key)
      get().say('That chunk could not be surveyed. Try again.')
    } finally {
      set({ surveying: get().surveying.filter((k) => k !== key) })
    }
  },

  mine: (hit) => {
    const s = terrainSession
    if (!s || !hit) return false
    if (!cellInReach(s, hit.cell)) { get().say(OUT_OF_REACH); return false }
    const [dx, dy, dz] = hit.cell
    const id = s.world.blockCs(dx, dy, dz)
    if (id <= EMPTY) return false
    // A chunk others built in, shown but not surveyed by you: survey it before changing it.
    const at = s.world.locate(dx, dy, dz)
    if (!at.slot?.own) { get().say('Survey this chunk before building in it.'); return false }
    // What is yours in that cell: someone else's block mined is gone for you, and never carried.
    const yours = at.slot.own[at.cell]
    const change = s.world.setCs(dx, dy, dz, EMPTY)
    if (!change) return false
    record(s, change)
    advanceHint(0)
    // What it carries as: its kind's own id. A block this client has no kind for is mined, and carried as nothing.
    if (yours <= EMPTY) return true
    const was = kindId(yours)
    if (was === 255) return true
    const inv = get().inventory
    const counts = { ...inv.counts, [was]: (inv.counts[was] ?? 0) + 1 }
    let hotbar = inv.hotbar
    // A kind newly carried takes the first empty slot, so it is ready to place.
    if (!hotbar.includes(was)) {
      const free = hotbar.indexOf(0)
      if (free >= 0) { hotbar = [...hotbar]; hotbar[free] = was }
    }
    // With an empty slot chosen, the kind just mined is chosen instead.
    const slot = hotbar[inv.slot] === 0 && hotbar.includes(was) ? hotbar.indexOf(was) : inv.slot
    saveInventory({ counts, hotbar, slot })
    return true
  },

  place: (hit) => {
    const s = terrainSession
    if (!s || !hit) return false
    if (hit.normal[0] === 0 && hit.normal[1] === 0 && hit.normal[2] === 0) return false
    const inv = get().inventory
    const id = inv.hotbar[inv.slot]
    if (!id || !(inv.counts[id] > 0)) { get().say(id ? `No ${blockName(id)} left: mine some first.` : 'Nothing to place: mine a block first.'); return false }
    const cell: [number, number, number] = [hit.cell[0] + hit.normal[0], hit.cell[1] + hit.normal[1], hit.cell[2] + hit.normal[2]]
    if (!cellInReach(s, cell)) { get().say(OUT_OF_REACH); return false }
    const [dx, dy, dz] = cell
    // Open space, or a liquid, which a placed block takes the place of.
    if (isSolid(s.world.blockCs(dx, dy, dz))) return false
    const slot = s.world.slotAtCs(dx, dy, dz)
    if (!slot?.own) { get().say('Survey this chunk before building in it.'); return false }
    // Never where you stand: the walk's own gibson.
    if (walkerAt(s, cell)) { get().say('You are standing there: step back to place it.'); return false }
    const change = s.world.setCs(dx, dy, dz, id)
    if (!change) return false
    record(s, change)
    const left = inv.counts[id] - 1
    const counts = { ...inv.counts }
    if (left > 0) counts[id] = left
    else delete counts[id]
    saveInventory({ ...inv, counts })
    advanceHint(1)
    return true
  },

  selectSlot: (slot) => {
    if (slot < 0 || slot >= HOTBAR_SLOTS) return
    saveInventory({ ...get().inventory, slot })
  },

  assignSlot: (id, slot) => {
    const inv = get().inventory
    const at = slot ?? inv.slot
    if (at < 0 || at >= HOTBAR_SLOTS) return
    const hotbar = inv.hotbar.map((h) => (h === id ? 0 : h))
    hotbar[at] = id
    saveInventory({ ...inv, hotbar, slot: at })
  },

  setSheet: (open) => {
    useTerrain.setState({ sheet: open })
    if (open) advanceHint(2)
  },

  say: (message) => {
    clearTimeout(messageTimer)
    useTerrain.setState({ message })
    if (message) messageTimer = setTimeout(() => useTerrain.setState({ message: null }), MESSAGE_MS)
  },
}))

/** The zoom back as it was before TERRAIN. */
function restoreZoom(): void {
  const z = zoomBefore
  zoomBefore = null
  if (z !== null && useCyberspace.getState().scaleExp !== z) useCyberspace.setState({ scaleExp: z })
}

/** Whether a cell (cs offsets) is the walk's own gibson: where you stand. */
export function walkerAt(s: TerrainSession, cell: readonly [number, number, number]): boolean {
  const w = offsetOf(s, headNow())
  return w[0] === cell[0] && w[1] === cell[1] && w[2] === cell[2]
}

/**
 * After a survey: never left inside rock. The walk's gibson, if the new
 * ground filled it, is opened (a change of yours, carried as nothing), so
 * WALK stands where it stood and can walk out; its gravity puts you on the
 * ground from there, as it always does.
 */
function clearWalker(s: TerrainSession, surveyed: string): void {
  const w = offsetOf(s, headNow())
  // Only in the chunk just surveyed: a survey never touches another chunk's blocks.
  if (s.world.slotAtCs(w[0], w[1], w[2])?.key !== surveyed) return
  if (!isSolid(s.world.blockCs(w[0], w[1], w[2]))) return
  const change = s.world.setCs(w[0], w[1], w[2], EMPTY)
  if (change) record(s, change)
}

const countWaiting = (s: TerrainSession): number => {
  let n = 0
  for (const l of s.pending.values()) n += l.length
  return n
}

/** Fold one chunk's waiting log into its layer, on the device. */
async function foldKey(s: TerrainSession, key: string): Promise<void> {
  const slot = s.world.slotByKey(key)
  const list = s.pending.get(key)
  const own = slot?.own
  if (!slot?.generated || !own || !list || list.length === 0) return
  if (s.unreadable.has(key)) return
  // Your own blocks alone, never what others shared: your layer says only what you changed.
  const layer = encodeLayer(slot.generated, own, s.plane === 1 ? 1 : 0)
  s.layers.set(key, layer)
  const seqs = list.map((p) => p.seq)
  s.pending.delete(key)
  useTerrain.setState({ waiting: countWaiting(s) })
  if (s.db) await foldChunk(s.db, s.owner, key, layer, seqs, Date.now()).catch(() => { /* the ops stay in the log */ })
}

/** Record a change: the log in memory and on the device, the layer folded when the log is long. */
function record(s: TerrainSession, change: Change): void {
  const slot = s.world.slotByKey(change.chunk)
  if (slot?.own) slot.own[change.cell] = change.id
  noteChange(change.chunk, { cell: change.cell, backToGround: !!slot?.generated && slot.generated[change.cell] === change.id })
  const seq = s.nextSeq++
  const list = s.pending.get(change.chunk) ?? []
  list.push({ seq, change })
  s.pending.set(change.chunk, list)
  s.version++
  const row: OpRow = { rowKey: opKey(s.owner, seq), owner: s.owner, chunk: change.chunk, seq, cell: change.cell, id: change.id, t: Date.now() }
  if (s.db) keep(writeOps(s.db, [row]))
  useTerrain.setState({ waiting: countWaiting(s) })
  if (list.length >= FOLD_AT) void foldKey(s, change.chunk)
}

function saveInventory(inv: Inventory): void {
  useTerrain.setState({ inventory: inv })
  const s = terrainSession
  if (s?.db) keep(writeInventory(s.db, s.owner, inv))
}

function advanceHint(from: number): void {
  if (useTerrain.getState().hint !== from) return
  const step = from + 1
  useTerrain.setState({ hint: step })
  const s = terrainSession
  if (s?.db) keep(writeHint(s.db, s.owner, step))
}

/** Read a surveyed chunk's layer and log, generate its ground, and put its blocks in the world. */
async function build(s: TerrainSession, slot: ChunkSlot): Promise<void> {
  if (!slot.inSpace || s.building.has(slot.key)) return
  s.building.add(slot.key)
  try {
    if (s.db && !s.layers.has(slot.key) && !s.pending.has(slot.key)) {
      const kept = await readKept(s.db, s.owner, [slot.key]).catch(() => null)
      if (terrainSession !== s) return
      if (kept) {
        s.nextSeq = Math.max(s.nextSeq, kept.nextSeq)
        for (const l of kept.layers) if (isLayer(l.layer)) s.layers.set(l.chunk, l.layer)
        const ops = kept.ops.filter((op) => op.chunk === slot.key)
        if (ops.length) s.pending.set(slot.key, ops.map((op) => ({ seq: op.seq, change: { chunk: op.chunk, cell: op.cell, id: op.id, was: EMPTY } })))
      }
    }
    const g = await generateChunk(slot.base)
    await prepareChunk(slot.key)
    if (terrainSession !== s || s.world.slotByKey(slot.key) !== slot) return
    // Your own blocks where you surveyed, and everyone else's shared layers under them (store/terrainShare.ts).
    const own = s.surveyedKeys.has(slot.key) ? builtBlocks(s, slot.key, g.blocks) : null
    slot.own = own
    s.world.setBlocks(slot.key, g.blocks, viewOf(slot.key, g.blocks, own))
    s.version++
    useTerrain.setState({ waiting: countWaiting(s) })
  } finally {
    s.building.delete(slot.key)
  }
}

/** Make a field for the identity and plane on screen, round `at`; what it kept is read in the background (`ready`). */
function makeField(owner: string, plane: number, at: Position): TerrainSession {
  const world = new TerrainWorld(chunkOf(at.x, at.y, at.z, plane), CS_AXES)
  const s: TerrainSession = {
    owner, plane, world, pending: new Map(), layers: new Map(), surveyedKeys: new Set(), unreadable: new Set(), building: new Set(),
    nextSeq: 1, db: null, version: 0, ready: Promise.resolve(),
  }
  s.ready = (async () => {
    let db: IDBDatabase | null = null
    try {
      db = await openTerrainDb()
      const kept = await readOwner(db, owner)
      // The database joins the field only once what it kept is read: a change in between never overwrites the saved inventory.
      if (terrainSession !== s) { db.close(); return }
      for (const k of kept.surveyed) s.surveyedKeys.add(k)
      s.nextSeq = Math.max(s.nextSeq, kept.nextSeq)
      s.db = db
      await loadBuilder(db, owner).catch(() => undefined)
      useTerrain.setState({ inventory: kept.inventory, hint: kept.hint })
    } catch {
      db?.close()
    }
  })()
  return s
}

/** Close a field: everything waiting folded, the database let go. */
async function closeField(s: TerrainSession): Promise<void> {
  for (const key of [...s.pending.keys()]) await foldKey(s, key)
  if (s.db) releaseBuilderDb(s.owner, s.db)
  s.db?.close()
  s.db = null
}

let syncing: Promise<TerrainSession | null> | null = null
let again = false

/**
 * Bring the field up to date with where you are: made (or made again) for
 * the identity and plane on screen; the surveyed chunks within DRAW_RING of
 * you loaded (found by their coordinate in the surveyed list, wherever you
 * first surveyed), and in TERRAIN the 3 by 3 by 3 round you held even where
 * nothing is surveyed, so SURVEY can name them; chunks far away folded and
 * let go. Follows you as you walk, in any direction, for good. Runs one at a
 * time; a call while one runs runs again after it.
 */
export function syncTerrain(): Promise<TerrainSession | null> {
  if (syncing) { again = true; return syncing }
  syncing = (async () => {
    let out: TerrainSession | null = null
    do {
      again = false
      out = await syncOnce()
    } while (again)
    return out
  })().finally(() => { syncing = null })
  return syncing
}

async function syncOnce(): Promise<TerrainSession | null> {
  const cs = useCyberspace.getState()
  const owner = cs.identity.pubkey || 'local'
  const plane = cs.plane
  const at = headNow()
  let s = terrainSession
  const far = s ? offsetOf(s, at).some((v) => Math.abs(v) > FAR) : false
  if (!s || s.owner !== owner || s.plane !== plane || far) {
    const old = s
    if (old) fieldClosing()
    s = makeField(owner, plane, at)
    terrainSession = s
    if (old) await closeField(old)
    publishWalls()
  }
  await s.ready
  if (terrainSession !== s) return null
  const world = s.world
  const centre = TerrainWorld.chunkOf(...offsetOf(s, headNow()))
  const want = new Set<ChunkSlot>()
  const ring = useTerrain.getState().active ? RING : -1
  for (let cy = -ring; cy <= ring; cy++) for (let cz = -ring; cz <= ring; cz++) for (let cx = -ring; cx <= ring; cx++) {
    want.add(world.slotAt(centre[0] + cx, centre[1] + cy, centre[2] + cz, true)!)
  }
  const shared = sharedKeys()
  for (let cy = -DRAW_RING; cy <= DRAW_RING; cy++) for (let cz = -DRAW_RING; cz <= DRAW_RING; cz++) for (let cx = -DRAW_RING; cx <= DRAW_RING; cx++) {
    const o = world.origin
    const base: ChunkBase = { x: o.x + BigInt(32 * (centre[0] + cx)), y: o.y + BigInt(32 * (centre[1] + cy)), z: o.z + BigInt(32 * (centre[2] + cz)), plane }
    const k = chunkKey(base)
    if (!s.surveyedKeys.has(k) && !shared.has(k)) continue
    want.add(world.slotAt(centre[0] + cx, centre[1] + cy, centre[2] + cz, true)!)
  }
  // Far chunks folded and let go; a chunk being built stays until it lands.
  for (const slot of world.slots) {
    if (want.has(slot) || s.building.has(slot.key)) continue
    await foldKey(s, slot.key)
    world.drop(slot)
    s.version++
  }
  // The chunk you stand in first, then the rest, so the ground under you comes first.
  const order = [...want].filter((sl) => !sl.blocks && (s!.surveyedKeys.has(sl.key) || shared.has(sl.key)))
  order.sort((a, b) => dist(a.off, centre) - dist(b.off, centre))
  for (const slot of order) {
    await build(s, slot).catch(() => { /* drawn empty; the next sync tries again */ })
    if (terrainSession !== s) return null
  }
  return s
}

const dist = (a: readonly number[], b: readonly number[]): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))

let wallMemo: { world: TerrainWorld | null; stamp: string; items: ReturnType<typeof terrainWallItems> } = { world: null, stamp: '', items: [] }

/** WALK's walls hear of the field's chunks (lib/terrain/walls.ts), so WALK walks on blocks: the same list while nothing changed. */
function publishWalls(): void {
  setTerrainWalls((plane) => {
    const s = terrainSession
    if (!s || s.plane !== plane) return []
    let stamp = ''
    for (const sl of s.world.chunks.values()) if (sl.blocks) stamp += `${sl.key}:${sl.version};`
    // Keyed by the field too: another identity's field has its own blocks under the same keys and versions (review of #916).
    if (stamp !== wallMemo.stamp || wallMemo.world !== s.world) wallMemo = { world: s.world, stamp, items: terrainWallItems(s.world) }
    return wallMemo.items
  })
}

/**
 * The chunk SURVEY would fill: the one you stand in, else the first not yet
 * surveyed along the way you look (WALK's camera, store/walkFluid.ts
 * walkLookDirection) within reach; null when there is none.
 */
export function surveyTarget(s: TerrainSession | null = terrainSession): string | null {
  if (!s) return null
  const w = offsetOf(s, headNow())
  const here = s.world.slotAtCs(w[0], w[1], w[2])
  if (here && here.inSpace && !here.own && slotInReach(s, here.key)) return here.key
  const look = walkLookDirection()
  if (!look.valid) return null
  const d = look.forward
  for (let t = 2; t < 48; t += 2) {
    const sl = s.world.slotAtCs(Math.round(w[0] + d.x * t), Math.round(w[1] + d.y * t), Math.round(w[2] + d.z * t))
    if (sl && sl.inSpace && !sl.own && slotInReach(s, sl.key)) return sl.key
  }
  return null
}

/**
 * Whether TERRAIN can open now, and if not, why in plain words: at your own
 * head, nothing lined up to place.
 */
export function terrainRefusal(): string | null {
  const cs = useCyberspace.getState()
  return cs.spectate !== null ? 'Stop watching first: TERRAIN builds near your own avatar.'
    : cs.exploreIndex !== null ? 'Back to your live head first: TERRAIN builds near your own avatar.'
      : cs.transit !== null ? 'Wait until the ride lands.'
        : useShards.getState().pending ? 'Place or cancel what is lined up first.'
          : null
}

/** Say why TERRAIN will not open, in a short toast. */
export function refuseTerrain(why: string): void {
  useToast.getState().show({ label: 'TERRAIN', meta: why, mark: 'build', ms: BRIEF_TOAST_MS })
}

// The field follows you, in every mode: your place (the walk's gibson while walking), plane and identity.
let lastKey = ''
function follow(): void {
  const c = useCyberspace.getState()
  const at = headNow()
  const k = `${c.identity.pubkey}|${c.plane}|${at.x >> 5n}|${at.y >> 5n}|${at.z >> 5n}|${useTerrain.getState().active}`
  if (k === lastKey) return
  lastKey = k
  void syncTerrain()
}
// A tap on the scene mines in TERRAIN: it never folds the controls or the chat (owner, 2026-11-24).
takeSceneTaps(() => useTerrain.getState().active)

useCyberspace.subscribe((c, prev) => {
  if (c.identity.pubkey !== prev.identity.pubkey && useTerrain.getState().active) void useTerrain.getState().exit()
  // LOCAL shares nothing; back to LIVE, what waited goes out (store/terrainShare.ts).
  if (c.live !== prev.live && c.identity.pubkey === prev.identity.pubkey) liveChanged(c.live)
  // Every step: a chunk left by more than 4 blocks shares what waits, and the layers in reach are read (store/terrainShare.ts).
  if (c.cursor !== prev.cursor || c.position !== prev.position || c.walking !== prev.walking) noteMove()
  // WALK ending under TERRAIN (its button, X, a respawn) ends TERRAIN: TERRAIN is WALK.
  if (prev.walking && !c.walking && useTerrain.getState().active) void useTerrain.getState().exit()
  follow()
})
useTerrain.subscribe((t, prev) => { if (t.active !== prev.active) follow() })
publishWalls()

/** Draw a chunk again with what is shared there now (store/terrainShare.ts), or load it when it is not held. */
function redisplay(key: string): void {
  const s = terrainSession
  if (!s) return
  const slot = s.world.slotByKey(key)
  if (!slot?.generated) { void syncTerrain(); return }
  s.world.setBlocks(key, slot.generated, viewOf(key, slot.generated, slot.own ?? null))
  s.version++
}

connectShareHost({
  field: () => {
    const s = terrainSession
    return s ? { owner: s.owner, plane: s.plane, db: s.db, slot: (key) => s.world.slotByKey(key), surveyed: (key) => s.surveyedKeys.has(key) } : null
  },
  head: headNow,
  active: () => useTerrain.getState().active,
  fold: async (key) => { const s = terrainSession; if (s) await foldKey(s, key) },
  redisplay,
  adopt: async (key, own) => {
    const s = terrainSession
    const slot = s?.world.slotByKey(key)
    if (!s || !slot?.generated || !slot.own) return
    // Your other keys' cells become your own here, with every change you made since kept over them (store/terrainShare.ts, §5.7).
    const next = own.slice()
    for (const { change } of s.pending.get(key) ?? []) next[change.cell] = change.id
    slot.own = next
    const layer = encodeLayer(slot.generated, next, s.plane === 1 ? 1 : 0)
    s.layers.set(key, layer)
    if (s.db) await foldChunk(s.db, s.owner, key, layer, [], Date.now()).catch(() => { /* kept in memory */ })
    redisplay(key)
  },
})

// Development only: the field, for browser probes (never in a production build).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __terrainBlocks?: unknown }).__terrainBlocks = { session: () => terrainSession, state: () => useTerrain.getState() }
}
