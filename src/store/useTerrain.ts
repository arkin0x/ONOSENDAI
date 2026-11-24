/**
 * useTerrain.ts - TERRAIN mode: mine and place blocks, single player, on this device.
 *
 * TERRAIN is a tool inside BUILD (design §5.1): the TERRAIN button in the
 * build bar, or T while building. It opens a view of its own over cyberspace
 * (terrain/TerrainView.tsx), as a game does, and leaving it is back in BUILD
 * with the build cursor where it was: BUILD stays on underneath the whole time.
 *
 * What it does, by the rulings of 2026-11-24 (craft-design/decisions-ruled):
 * - The builder's body walks locally on the block grid; the chain does not
 *   move (D7) and nothing is signed. Mining and placing are refused outside
 *   reach of the chain's head (lib/terrain/world.ts REACH), in plain words.
 * - A chunk (aligned h5, 32 cubed, one block a gibson) is empty until SURVEY
 *   fills it with ground generated from public facts (lib/terrain/generate.ts),
 *   seeded from its h5 region root.
 * - Mining adds the block to what you carry, placing takes one away (D19, on
 *   the honor system). The inventory, the op log of your changes, your folded
 *   layers and the chunks you surveyed are kept per identity in IndexedDB
 *   (lib/terrain/terrainDb.ts; arkinox 2026-11-19: all local data per npub).
 * - The generated ground is drawn only here (D8). Nothing is published yet:
 *   the layers are written as "diff vs generated" (lib/terrain/layer.ts),
 *   ready for the block events of the Blocks DECK.
 *
 * The world's blocks and the body live outside the store (`terrainSession`),
 * since they change every frame; the store holds what the HUD shows.
 */

import { create } from 'zustand'
import { useCyberspace } from './useCyberspace'
import { useBuilder } from './useBuilder'
import { useShards } from './useShards'
import { BRIEF_TOAST_MS, useToast } from './useToast'
import { warmWalls, wallItemsAt, stepLimit } from './walkWalls'
import { chunkOf, chunkKey, type ChunkBase } from '../lib/terrain/coords'
import { TerrainWorld, REACH, terrainAxes, type Change } from '../lib/terrain/world'
import { applyLayer, encodeLayer, isLayer, type Layer } from '../lib/terrain/layer'
import { generateChunk, releaseBlocksWorker } from '../lib/terrain/blocksClient'
import { EMPTY, blockKind, blockName, kindId } from '../lib/terrain/blocks'
import { BODY_HEIGHT, HALF_WIDTH, newBody, liftFree, type Body, type BodyWorld } from '../lib/terrain/body'
import {
  FOLD_AT, HOTBAR_SLOTS, emptyInventory, foldChunk, openTerrainDb, opKey, readKept, writeHint, writeInventory, writeOps, writeSurveyed,
  type Inventory, type OpRow,
} from '../lib/terrain/terrainDb'
import type { AxisName, Position } from '../lib/space'
import type { RayHit } from '../lib/terrain/raycast'

/** The first-visit hint's steps: mine one, place one, open the inventory; then done. */
export const HINT_DONE = 3

/** How long a message stays on the status line, ms. */
export const MESSAGE_MS = 3200

/** What one visit holds outside the store. */
export interface TerrainSession {
  owner: string
  world: TerrainWorld
  body: Body
  /** The chain's head, absolute: reach is measured from its chunk, and shard walls are asked from here. */
  head: Position
  plane: number
  /** Changes per chunk not yet folded: seq and the change. */
  pending: Map<string, Array<{ seq: number; change: Change }>>
  /** Layers folded so far, by chunk. */
  layers: Map<string, Layer>
  nextSeq: number
  db: IDBDatabase | null
  /** Bumped by every change to the blocks, so the drawing knows to look for dirty chunks. */
  version: number
}

/** The visit under way, or null. */
export let terrainSession: TerrainSession | null = null

/** For tests: replace the session. */
export function setTerrainSession(s: TerrainSession | null): void {
  terrainSession = s
}

export interface TerrainState {
  active: boolean
  /** Reading what this device kept and generating the chunks surveyed before. */
  loading: boolean
  inventory: Inventory
  /** First-visit hint step, 0 to HINT_DONE. */
  hint: number
  /** The status line, or null. Its slot is always there, so nothing moves. */
  message: string | null
  /** The inventory sheet is open. */
  sheet: boolean
  /** Chunks being surveyed now, by key. */
  surveying: string[]
  /** Chunks surveyed in this visit's box, by key. */
  surveyed: string[]
  /** Changes waiting in the log (not yet folded into layers). */
  waiting: number

  enter: () => Promise<void>
  exit: () => Promise<void>
  /** SURVEY a chunk of the visit, by key. */
  survey: (key: string) => Promise<void>
  /** Mine the block a ray hit. True when it was mined. */
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

/** The view cell where a chain head stands, in a world built round it. */
function headCell(world: TerrainWorld, head: Position): [number, number, number] {
  return world.toView(Number(head.x - world.origin.x), Number(head.y - world.origin.y), Number(head.z - world.origin.z))
}

/** The chain head's cs offset from the visit's origin (its own chunk's corner), 0..31 on each axis. */
export function headOffset(s: Pick<TerrainSession, 'head' | 'world'>): [number, number, number] {
  const o = s.world.origin
  return [Number(s.head.x - o.x), Number(s.head.y - o.y), Number(s.head.z - o.z)]
}

/** Whether the chunk holding a view cell is within reach of the chain (world.ts inReach, DECK-0009 §6.2). */
export function viewInReach(s: Pick<TerrainSession, 'head' | 'world'>, cell: readonly [number, number, number]): boolean {
  const [dx, dy, dz] = s.world.toCs(cell[0], cell[1], cell[2])
  return TerrainWorld.inReach(dx, dy, dz, headOffset(s))
}

/** Whether a chunk of the visit, by key, is within reach of the chain. */
export function slotInReach(s: Pick<TerrainSession, 'head' | 'world'>, key: string): boolean {
  const i = s.world.slots.findIndex((sl) => sl.key === key)
  if (i < 0) return false
  const [cx, cy, cz] = TerrainWorld.chunkOffset(i)
  return TerrainWorld.inReach(32 * cx, 32 * cy, 32 * cz, headOffset(s))
}

/** The plain words for a block out of reach. */
export const OUT_OF_REACH = `Too far from your avatar: you build within ${REACH} blocks of it. Hop closer to build here.`

/** Persist quietly: a failed write keeps the session going in memory. */
function keep(p: Promise<void> | undefined): void {
  void p?.catch(() => { /* kept in memory for this session */ })
}

const AXES_CS: AxisName[] = ['x', 'y', 'z']

/**
 * WALK's shard walls, asked from the view cell `cell` for a step of one cell
 * along view axis `axis` in direction `dir` (store/walkWalls.ts stepLimit).
 */
export function shardWallBlocks(s: TerrainSession, cell: [number, number, number], axis: 0 | 1 | 2, dir: 1 | -1): boolean {
  const [dx, dy, dz] = s.world.toCs(cell[0], cell[1], cell[2])
  const o = s.world.origin
  const from: Position = { x: o.x + BigInt(dx), y: o.y + BigInt(dy), z: o.z + BigInt(dz) }
  if (from.x < 0n || from.y < 0n || from.z < 0n) return true
  const { cs, dir: sign } = s.world.csAxisOf(axis)
  const items = wallItemsAt(s.plane, from)
  if (items.length === 0) return false
  return stepLimit(from, AXES_CS[cs], (dir * sign) as 1 | -1, 1n, items).reach === 0n
}

/**
 * Chunks whose stored layer this build cannot read (a newer ground revision):
 * drawn as the bare ground, and never folded, so the stored layer is never
 * overwritten by one that lost its changes.
 */
const unreadable = new WeakMap<TerrainSession, Set<string>>()

/** Apply a chunk's folded layer and its waiting log over its generated ground. */
function builtBlocks(s: TerrainSession, key: string, generated: Uint8Array): Uint8Array {
  const layer = s.layers.get(key)
  const applied = layer ? applyLayer(generated, layer) : null
  if (layer && !applied) {
    const set = unreadable.get(s) ?? new Set<string>()
    set.add(key)
    unreadable.set(s, set)
  }
  const blocks = applied ?? generated.slice()
  for (const { change } of s.pending.get(key) ?? []) blocks[change.cell] = change.id
  return blocks
}

export const useTerrain = create<TerrainState>((set, get) => {
  /** Fold one chunk's waiting log into its layer, on the device. */
  const fold = async (s: TerrainSession, key: string): Promise<void> => {
    const slot = s.world.slotByKey(key)
    const list = s.pending.get(key)
    if (!slot?.generated || !slot.blocks || !list || list.length === 0) return
    if (unreadable.get(s)?.has(key)) return
    const layer = encodeLayer(slot.generated, slot.blocks, s.plane === 1 ? 1 : 0)
    s.layers.set(key, layer)
    const seqs = list.map((p) => p.seq)
    s.pending.delete(key)
    set({ waiting: countWaiting(s) })
    if (s.db) keep(foldChunk(s.db, s.owner, key, layer, seqs, Date.now()))
  }

  const countWaiting = (s: TerrainSession): number => {
    let n = 0
    for (const l of s.pending.values()) n += l.length
    return n
  }

  /** Record a change: the log in memory and on the device, the layer folded when the log is long. */
  const record = (s: TerrainSession, change: Change): void => {
    const seq = s.nextSeq++
    const list = s.pending.get(change.chunk) ?? []
    list.push({ seq, change })
    s.pending.set(change.chunk, list)
    s.version++
    const row: OpRow = { rowKey: opKey(s.owner, seq), owner: s.owner, chunk: change.chunk, seq, cell: change.cell, id: change.id, t: Date.now() }
    if (s.db) keep(writeOps(s.db, [row]))
    set({ waiting: countWaiting(s) })
    if (list.length >= FOLD_AT) void fold(s, change.chunk)
  }

  const saveInventory = (inv: Inventory): void => {
    set({ inventory: inv })
    const s = terrainSession
    if (s?.db) keep(writeInventory(s.db, s.owner, inv))
  }

  const advanceHint = (from: number): void => {
    if (get().hint !== from) return
    const step = from + 1
    set({ hint: step })
    const s = terrainSession
    if (s?.db) keep(writeHint(s.db, s.owner, step))
  }

  /** Generate a surveyed chunk and put its blocks in the world. */
  const build = async (s: TerrainSession, key: string): Promise<void> => {
    const slot = s.world.slotByKey(key)
    if (!slot || !slot.inSpace) return
    const g = await generateChunk(slot.base)
    if (terrainSession !== s) return
    const skin = { top: blockKind(g.top)?.index ?? 0, rind: blockKind(g.rind)?.index ?? 0 }
    s.world.setBlocks(key, g.blocks, builtBlocks(s, key, g.blocks), skin)
    s.version++
  }

  return {
    active: false,
    loading: false,
    inventory: emptyInventory(),
    hint: HINT_DONE,
    message: null,
    sheet: false,
    surveying: [],
    surveyed: [],
    waiting: 0,

    enter: async () => {
      if (get().active) return
      const cs = useCyberspace.getState()
      const owner = cs.identity.pubkey || 'local'
      const head = { ...cs.position }
      const plane = cs.plane
      const base: ChunkBase = chunkOf(head.x, head.y, head.z, plane)
      // Up is cyberspace +Y in TERRAIN whatever way the view was turned (terrainAxes, ruled 2026-11-24).
      const world = new TerrainWorld(base, terrainAxes(cs.axes()))
      const hc = headCell(world, head)
      // Stood on the chain's head, feet at the bottom of its gibson.
      const body = newBody(hc[0], hc[1] - 0.5, hc[2])
      const s: TerrainSession = { owner, world, body, head, plane, pending: new Map(), layers: new Map(), nextSeq: 1, db: null, version: 0 }
      terrainSession = s
      set({ active: true, loading: true, sheet: false, message: null, surveying: [], surveyed: [], waiting: 0, inventory: emptyInventory(), hint: HINT_DONE })
      // The shards round you, built as walls before the first step (WALK's own).
      try { warmWalls(plane, head) } catch { /* walls are asked again on every crossing */ }
      let kept: Awaited<ReturnType<typeof readKept>> | null = null
      // The database joins the visit only once what it kept is read and applied: a leave in between
      // must never write the still-empty inventory over the saved one.
      let db: IDBDatabase | null = null
      try {
        db = await openTerrainDb()
        kept = await readKept(db, owner, world.slots.map((sl) => sl.key))
      } catch {
        kept = null
      }
      if (terrainSession !== s) { db?.close(); return }
      if (db && !kept) { db.close(); db = null }
      const inBox = new Set(world.slots.map((sl) => sl.key))
      if (kept) {
        s.nextSeq = Math.max(s.nextSeq, kept.nextSeq)
        for (const l of kept.layers) if (inBox.has(l.chunk) && isLayer(l.layer)) s.layers.set(l.chunk, l.layer)
        for (const op of kept.ops) {
          s.nextSeq = Math.max(s.nextSeq, op.seq + 1)
          if (!inBox.has(op.chunk)) continue
          const list = s.pending.get(op.chunk) ?? []
          list.push({ seq: op.seq, change: { chunk: op.chunk, cell: op.cell, id: op.id, was: EMPTY } })
          s.pending.set(op.chunk, list)
        }
      }
      const surveyed = (kept?.surveyed ?? []).map((r) => r.chunk).filter((k) => inBox.has(k))
      s.db = db
      set({ inventory: kept?.inventory ?? emptyInventory(), hint: kept?.hint ?? 0, surveyed, waiting: countWaiting(s) })
      // The chunk you stand in first, then the rest, so the ground under you comes first.
      const headKey = chunkKey(base)
      const order = surveyed.includes(headKey) ? [headKey, ...surveyed.filter((k) => k !== headKey)] : surveyed
      for (const key of order) {
        await build(s, key).catch(() => { /* drawn empty; SURVEY again rebuilds it */ })
        if (terrainSession !== s) return
      }
      liftFree(s.body, bodyWorld(s))
      set({ loading: false })
    },

    exit: async () => {
      const s = terrainSession
      if (!get().active) return
      // Everything waiting is folded into its layer before the visit ends.
      if (s) for (const key of [...s.pending.keys()]) await fold(s, key)
      if (s?.db) { keep(writeInventory(s.db, s.owner, get().inventory)); s.db.close() }
      terrainSession = null
      releaseBlocksWorker()
      clearTimeout(messageTimer)
      set({ active: false, loading: false, sheet: false, message: null, surveying: [], waiting: 0 })
    },

    survey: async (key) => {
      const s = terrainSession
      // While loading, the chunks surveyed before are being built: G must not build one twice.
      if (!s || get().loading || get().surveying.includes(key)) return
      const slot = s.world.slotByKey(key)
      if (!slot) return
      if (!slot.inSpace) { get().say('That chunk is past the edge of cyberspace.'); return }
      if (slot.surveyed) return
      if (!slotInReach(s, key)) { get().say(OUT_OF_REACH); return }
      set({ surveying: [...get().surveying, key] })
      try {
        await build(s, key)
        if (terrainSession !== s) return
        set({ surveyed: [...new Set([...get().surveyed, key])] })
        if (s.db) keep(writeSurveyed(s.db, s.owner, key, Date.now()))
        // The ground may have filled the space round you.
        liftFree(s.body, bodyWorld(s))
        get().say('Surveyed: the ground is here.')
      } catch {
        get().say('That chunk could not be surveyed. Try again.')
      } finally {
        set({ surveying: get().surveying.filter((k) => k !== key) })
      }
    },

    mine: (hit) => {
      const s = terrainSession
      if (!s || !hit || get().loading) return false
      if (!viewInReach(s, hit.cell)) { get().say(OUT_OF_REACH); return false }
      const [dx, dy, dz] = s.world.toCs(hit.cell[0], hit.cell[1], hit.cell[2])
      const id = s.world.blockCs(dx, dy, dz)
      if (id <= EMPTY) return false
      const change = s.world.setCs(dx, dy, dz, EMPTY)
      if (!change) return false
      record(s, change)
      advanceHint(0)
      // What it carries as: its kind's own id. A block this client has no kind for is mined, and carried as nothing.
      const was = kindId(id)
      if (blockKind(id)?.index === undefined || was === 255) return true
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
      if (!s || !hit || get().loading) return false
      if (hit.normal[0] === 0 && hit.normal[1] === 0 && hit.normal[2] === 0) return false
      const inv = get().inventory
      const id = inv.hotbar[inv.slot]
      if (!id || !(inv.counts[id] > 0)) { get().say(id ? `No ${blockName(id)} left: mine some first.` : 'Nothing to place: mine a block first.'); return false }
      const cell: [number, number, number] = [hit.cell[0] + hit.normal[0], hit.cell[1] + hit.normal[1], hit.cell[2] + hit.normal[2]]
      if (!viewInReach(s, cell)) { get().say(OUT_OF_REACH); return false }
      const [dx, dy, dz] = s.world.toCs(cell[0], cell[1], cell[2])
      if (s.world.blockCs(dx, dy, dz) !== EMPTY) return false
      const slot = s.world.slotAtCs(dx, dy, dz)
      if (!slot?.blocks) { get().say('Survey this chunk before building in it.'); return false }
      // Never inside your own body.
      if (bodyHolds(s.body, cell)) { get().say('You are standing there: step back to place it.'); return false }
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
      set({ sheet: open })
      if (open) advanceHint(2)
    },

    say: (message) => {
      clearTimeout(messageTimer)
      set({ message })
      if (message) messageTimer = setTimeout(() => set({ message: null }), MESSAGE_MS)
    },
  }
})

/** Whether the body stands in a view cell (a block placed there would trap it). */
export function bodyHolds(b: Body, cell: readonly [number, number, number]): boolean {
  const inX = Math.abs(cell[0] - b.x) < 0.5 + HALF_WIDTH - 1e-6
  const inZ = Math.abs(cell[2] - b.z) < 0.5 + HALF_WIDTH - 1e-6
  const inY = cell[1] + 0.5 > b.y + 1e-6 && cell[1] - 0.5 < b.y + BODY_HEIGHT - 1e-6
  return inX && inZ && inY
}

const bodyWorlds = new WeakMap<TerrainSession, BodyWorld>()

/** What the body asks of a visit's world (lib/terrain/body.ts BodyWorld), made once a visit. */
export function bodyWorld(s: TerrainSession): BodyWorld {
  const made = bodyWorlds.get(s)
  if (made) return made
  const w = s.world
  const out: BodyWorld = {
    solid: (i, j, k) => w.blockView(i, j, k) !== EMPTY,
    gravity: (i, j, k) => {
      const [dx, dy, dz] = w.toCs(i, j, k)
      return w.slotAtCs(dx, dy, dz)?.blocks != null
    },
    wall: (i, j, k, axis, dir) => {
      try { return shardWallBlocks(s, [i, j, k], axis, dir) } catch { return false }
    },
  }
  bodyWorlds.set(s, out)
  return out
}

/**
 * The chunk SURVEY would fill: the one the body stands in, else the first
 * not yet surveyed along the look (yaw and pitch, radians, as the camera's)
 * within the visit; null when there is none.
 */
export function surveyTargetOf(s: TerrainSession, yaw: number, pitch: number): string | null {
  const b = s.body
  const here = chunkAtView(s, [b.x, b.y + 1, b.z])
  const slot = here ? s.world.slotByKey(here) : null
  if (here && slot && slot.inSpace && !slot.surveyed && slotInReach(s, here)) return here
  const d = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)]
  for (let t = 2; t < 48; t += 2) {
    const key = chunkAtView(s, [b.x + d[0] * t, b.y + 1.4 + d[1] * t, b.z + d[2] * t])
    if (!key) return null
    const sl = s.world.slotByKey(key)
    if (sl && sl.inSpace && !sl.surveyed && slotInReach(s, key)) return key
  }
  return null
}

/** The chunk key of the chunk a view cell is in, or null outside the visit. */
export function chunkAtView(s: TerrainSession, cell: readonly [number, number, number]): string | null {
  const [dx, dy, dz] = s.world.toCs(Math.round(cell[0]), Math.round(cell[1]), Math.round(cell[2]))
  return s.world.slotAtCs(dx, dy, dz)?.key ?? null
}

// TERRAIN lives inside BUILD: BUILD ending ends it, and so does a change of identity.
useBuilder.subscribe((b, prev) => { if (prev.active && !b.active && useTerrain.getState().active) void useTerrain.getState().exit() })
useCyberspace.subscribe((c, prev) => { if (c.identity.pubkey !== prev.identity.pubkey && useTerrain.getState().active) void useTerrain.getState().exit() })

/**
 * TERRAIN from BUILD: the build bar's TERRAIN, or T while building. Only in
 * BUILD, with nothing lined up to place, and at your own head: spectating, in
 * history or in hyperspace transit there is no chain of yours to build near.
 * Refused in a short toast that says why. True when it opened.
 */
export function enterTerrain(): boolean {
  if (useTerrain.getState().active) return true
  if (!useBuilder.getState().active) return false
  const cs = useCyberspace.getState()
  const why = cs.spectate !== null ? 'Stop watching first: TERRAIN builds near your own avatar.'
    : cs.exploreIndex !== null ? 'Back to your live head first: TERRAIN builds near your own avatar.'
      : cs.transit !== null ? 'Wait until the ride lands.'
        : useShards.getState().pending ? 'Place or cancel what is lined up first.'
          : null
  if (why) {
    useToast.getState().show({ label: 'TERRAIN', meta: why, mark: 'build', ms: BRIEF_TOAST_MS })
    return false
  }
  void useTerrain.getState().enter()
  return true
}

// Development only: the visit, for browser probes (never in a production build).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __terrainBlocks?: unknown }).__terrainBlocks = { session: () => terrainSession, state: () => useTerrain.getState() }
}
