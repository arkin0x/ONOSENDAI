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
 * inventory and the first-visit hint. Each chunk you surveyed keeps the
 * ground revision it was first surveyed at (DECK-0009 §3.10, §7.5;
 * lib/terrain/groundRevision.ts), so its ground never shifts under a
 * build: groundFor gives any chunk's ground at the revision you see it at.
 * While LIVE, each chunk's changes are
 * shared as this device's block layer, and other builders' layers near you
 * are read and stacked with yours (store/terrainShare.ts, DECK-0009 §5 to
 * §7, the Stack); LOCAL shares nothing.
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
import { airPlacing, hintAirOff } from './airSwitch'
import { useShards } from './useShards'
import { useWalk } from './useWalk'
import { walkLookDirection } from './walkFluid'
import { BRIEF_TOAST_MS, useToast } from './useToast'
import { setTerrainWalls } from './walkWalls'
import { takeSceneTaps, usePad } from './usePad'
import { CELLS, chunkOf, chunkKey, parseChunkKey, type ChunkBase } from '../lib/terrain/coords'
import { RING, TerrainWorld, REACH, type Change, type ChunkSlot } from '../lib/terrain/world'
import { applyLayer, encodeLayer, isLayer, layerRevision, rebaseBlocks, type Layer } from '../lib/terrain/layer'
import type { GroundFacts } from '../lib/terrain/assay'
import { generateChunk } from '../lib/terrain/blocksClient'
import { groundWriteRevision, type GroundRevision } from '../lib/terrain/groundRevision'
import { EMPTY, blockName, kindId, solid as isSolid } from '../lib/terrain/blocks'
import { terrainWallItems } from '../lib/terrain/walls'
import {
  FOLD_AT, HOTBAR_SLOTS, emptyInventory, foldChunk, isCompiler, isQuarry, openTerrainDb, opKey, placeable, readKept, readOwner, withCharges, withCompiler, withoutCompiler, writeHint, writeInventory, writeOps, writeSurveyed,
  type ChunkSurvey, type Inventory, type OpRow,
} from '../lib/terrain/terrainDb'
import { compilerGranted } from '../lib/blueprint/devGrant'
import type { Position, ViewAxes } from '../lib/space'
import type { RayHit } from '../lib/terrain/raycast'
import { airProblem, bodyCells, placeTarget, type Cell } from '../lib/terrain/airPlace'
import {
  addExplicit, applyCarried, connectShareHost, explicitCells, fieldClosing, liveChanged, noteChange, noteChanges, noteMove, othersRevision, prepareChunk, publishedPlane, READ_RING, identityLeaving,
  readNear, sharedKeys, shownFromBase, shownRevision, surveyedForYou, terrainClosed, terrainOpened, viewOf,
} from './terrainShare'
import { loadBuilder, releaseBuilderDb } from '../lib/terrain/builderKey'
import { quarryHooks } from './quarryHooks'
import './terrainShareLive'
import { noteMining } from './miningStats'

/** The first-visit hint's steps: mine one, place one, open the inventory; then done. */
export const HINT_DONE = 3

/** How long a message stays on screen, ms. */
export const MESSAGE_MS = 3200

/** How many chunks round you the surveyed ones (yours, and others' read from the relay) are loaded, drawn and walkable, on each axis. */
export const DRAW_RING = READ_RING

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
  /** Each surveyed chunk's ground revision and first survey's date (DECK-0009 §7.5): kept from its first survey on. */
  revisions: Map<string, ChunkSurvey>
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
  /**
   * How many times this page has seen each of these done (the tutorial's
   * TERRAIN route waits on them: tutorial/terrainRoute.ts): a chunk
   * surveyed, a block mined, one placed, a hotbar slot picked.
   */
  tally: { surveyed: number; mined: number; placed: number; picked: number }

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
  /**
   * Place the chosen block on the face a ray hit, or, when the ray hit
   * nothing, in the open-air cell of the ghost at arm's length (`air`,
   * lib/terrain/airPlace.ts). True when it was placed.
   */
  place: (hit: RayHit | null, air?: AirAim | null) => boolean
  selectSlot: (slot: number) => void
  /** Put a block kind in a hotbar slot (the chosen one when absent). */
  assignSlot: (id: number, slot?: number) => void
  /** The Compiler joins the bar in slot 1, kept for good (made from its recipe: lib/blueprint/smash.ts). */
  gainCompiler: () => void
  /** `n` more Quarry Charges (a compile of its recipe gives 7: lib/blueprint/smash.ts); they join the bar after the Compiler, kept for good. */
  gainCharges: (n: number) => void
  /** `n` more blocks of kind `id` carried (a drop picked up: store/useQuarry.ts), as mining carries them. */
  carry: (id: number, n?: number) => void
  /**
   * A Quarry Charge's blast (lib/terrain/quarry.ts): every cell given that
   * mining could take (in reach, in a chunk you can build in, holding a
   * block), cleared as edits in your own layer in one batch, as mining
   * would; the rest left as they are. Carries nothing: what mining would have
   * carried comes back as the `carry` of each cell taken (0 for nothing),
   * for the drops. `id` is the block as it was drawn, for the shatter.
   */
  blast: (cells: ReadonlyArray<readonly [number, number, number]>) => Array<{ at: [number, number, number]; id: number; carry: number }>
  /**
   * Clear cells (cs offsets) to open space as edits in your own layer, as
   * mining would but carrying nothing: a smash spends its blocks (lib/blueprint/smash.ts).
   * All or nothing: a refusal in plain words when any cell is out of reach or in a chunk you cannot build in.
   */
  clear: (cells: ReadonlyArray<readonly [number, number, number]>) => string | null
  setSheet: (open: boolean) => void
  say: (message: string | null) => void
}

let messageTimer: ReturnType<typeof setTimeout> | undefined

/** Persist quietly: a failed write keeps the session going in memory. */
function keep(p: Promise<void> | undefined): void {
  void p?.catch(() => { /* kept in memory for this session */ })
}

/** Whether the Compiler is the chosen slot (otherwise the hand is bare: lib/blueprint/smash.ts). */
export function compilerInHand(): boolean {
  const inv = useTerrain.getState().inventory
  return isCompiler(inv.hotbar[inv.slot])
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

/** The plain words for PLACE with the charges chosen and none left. */
export const NO_CHARGES = 'No Quarry Charges left: compile more from the Quarry Charge blueprint.'

// Where a Quarry Charge is armed (store/quarryHooks.ts; store/useQuarry.ts sets it).
export { quarryHooks } from './quarryHooks'

/** The plain words for a block out of reach. */
export const OUT_OF_REACH = `Too far from your avatar: you build within ${REACH} blocks of it. Hop closer to build here.`

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/**
 * Apply a chunk's folded layer and its waiting log over its generated ground
 * (`generated`, at `revision`). A layer kept against another revision's
 * ground (`layerGround`, at the layer's own revision) is read over that one,
 * and the cells it never changed take this one's (layer.ts rebaseBlocks).
 */
function builtBlocks(s: TerrainSession, key: string, generated: Uint8Array, revision: GroundRevision, layerGround: Uint8Array | null = null): Uint8Array {
  const layer = s.layers.get(key)
  const lr = layer ? layerRevision(layer) : null
  let applied: Uint8Array | null = null
  if (layer && (lr === revision || (lr === null && layer.form === 'whole'))) applied = applyLayer(generated, layer, revision)
  else if (layer && lr !== null && layerGround) {
    const at = applyLayer(layerGround, layer, lr)
    applied = at && rebaseBlocks(at, layerGround, generated)
    // A cell you changed to what is now this revision's ground stays a change (§5.4), as after a merge (host.rebase).
    if (at) {
      const kept: number[] = []
      for (let c = 0; c < CELLS; c++) if (at[c] !== layerGround[c] && at[c] === generated[c]) kept.push(c)
      if (kept.length) addExplicit(key, kept)
    }
  }
  if (layer && !applied) s.unreadable.add(key)
  const blocks = applied ?? generated.slice()
  for (const { change } of s.pending.get(key) ?? []) blocks[change.cell] = change.id
  return blocks
}

/**
 * What mining a cell carries: your own block there, or, where you never
 * changed it and it shows the base (no layer changed it), the base you were
 * shown: the ground at the base revision, which is not your own revision's
 * where someone who ranks above you surveyed at another (a home owner, or
 * another device of yours that surveyed first). So what you carry is what
 * you saw, as the mining stats record it. `shown` is the cell as drawn.
 */
function yieldOf(slot: ChunkSlot & { own: Uint8Array }, cell: number, shown: number): number {
  const yours = slot.own[cell]
  // The common case first: a cell you changed, or a base at your own revision, gives your own block.
  if (!slot.generated || yours !== slot.generated[cell] || shownRevision(slot.key) === (slot.revision ?? 2)) return yours
  return shownFromBase(slot.key, cell) && !explicitCells(slot.key).has(cell) ? shown : yours
}

/**
 * A chunk someone else surveyed (drawn for you, DECK-0009 §7.5) becomes
 * yours to build in at once, with no SURVEY: your blocks start from the
 * ground, and your layer surveys it too (survey true, every change against
 * the ground), so your changes stand on ground even if you mute whoever
 * surveyed it first. Inside someone else's home only the owner's surveys
 * count, so yours is ignored there, and your changes still read against the
 * ground the owner revealed. True when the chunk is (now) yours to build in.
 */
function surveyShown(s: TerrainSession, slot: ChunkSlot | null): slot is ChunkSlot & { own: Uint8Array } {
  if (!slot) return false
  if (slot.own) return true
  if (!slot.generated || !slot.inSpace || s.building.has(slot.key) || !surveyedForYou(slot.key)) return false
  s.surveyedKeys.add(slot.key)
  // Your survey takes the revision it is surveyed at for you: the ground you are shown (§3.10), kept from now on.
  const revision = slot.revision ?? 2
  const at: ChunkSurvey = s.revisions.get(slot.key) ?? { revision, surveyed: nowSeconds() }
  s.revisions.set(slot.key, at)
  const own = builtBlocks(s, slot.key, slot.generated, revision)
  applyCarried(slot.key, own, slot.generated, revision)
  slot.own = own
  if (s.db) keep(writeSurveyed(s.db, s.owner, slot.key, Date.now(), at))
  // The survey is shared like any change (DECK-0009 §3.1), with the change about to be made.
  noteChange(slot.key)
  s.world.setBlocks(slot.key, slot.generated, viewOf(slot.key, slot.generated, own, revision, at.surveyed))
  s.version++
  return true
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
  tally: { surveyed: 0, mined: 0, placed: 0, picked: 0 },

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
    // This device's builder key is made on TERRAIN's first use; the layers round you are read again (store/terrainShare.ts).
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
    // A first survey takes the base revision others' surveys give you, else the revision this release writes (§3.10).
    const had = s.revisions.get(key)
    const at: ChunkSurvey = had ?? { revision: othersRevision(key) ?? groundWriteRevision(), surveyed: nowSeconds() }
    try {
      s.surveyedKeys.add(key)
      s.revisions.set(key, at)
      await build(s, slot)
      if (terrainSession !== s) return
      if (s.db) keep(writeSurveyed(s.db, s.owner, key, Date.now(), s.revisions.get(key) ?? at))
      // A survey is shared like any change (DECK-0009 §3.1).
      noteChange(key)
      clearWalker(s, key)
      count('surveyed')
      noteMining({ type: 'survey', chunk: key }, s.owner)
      get().say('Terrain revealed from cyberspace\'s structure.')
    } catch {
      s.surveyedKeys.delete(key)
      if (!had) s.revisions.delete(key)
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
    // A chunk someone else surveyed is yours to build in at once (surveyShown); one nobody surveyed is never drawn.
    const at = s.world.locate(dx, dy, dz)
    if (!surveyShown(s, at.slot)) { get().say('Survey this chunk before building in it.'); return false }
    // What is yours in that cell: someone else's block mined is gone for you (and for whoever ranks you first), never carried; the base you were shown is.
    const yours = yieldOf(at.slot, at.cell, id)
    const change = s.world.setCs(dx, dy, dz, EMPTY)
    if (!change) return false
    record(s, change)
    advanceHint(0)
    count('mined')
    noteMining({ type: 'mine', kind: kindId(id) }, s.owner)
    // What it carries as: its kind's own id. A block this client has no kind for is mined, and carried as nothing.
    if (yours <= EMPTY) return true
    const was = kindId(yours)
    if (was === 255) return true
    get().carry(was)
    return true
  },

  carry: (id, n = 1) => {
    if (!(id > EMPTY && id < 255) || !(n > 0)) return
    const inv = get().inventory
    const counts = { ...inv.counts, [id]: (inv.counts[id] ?? 0) + n }
    let hotbar = inv.hotbar
    // A kind newly carried takes the first empty slot, so it is ready to place.
    if (!hotbar.includes(id)) {
      const free = hotbar.indexOf(0)
      if (free >= 0) { hotbar = [...hotbar]; hotbar[free] = id }
    }
    // With an empty slot chosen, the kind just carried is chosen instead.
    const slot = hotbar[inv.slot] === 0 && hotbar.includes(id) ? hotbar.indexOf(id) : inv.slot
    // Everything else the inventory holds (the Compiler and how it came, the charges) stays: dropping it here hid the held
    // Compiler until a reload (owner, 2026-11-27), and a reload then lost a made one.
    saveInventory({ ...inv, counts, hotbar, slot })
  },

  place: (hit, air) => {
    const s = terrainSession
    if (!s) return false
    // A hit always comes first; with none, the ghost's cell in open air.
    const target = placeTarget(hit, hit ? null : air?.cell ?? null)
    const inv = get().inventory
    const id = inv.hotbar[inv.slot]
    if (!target) {
      // Nothing at the cross with air placing switched off (store/airSwitch.ts): nothing happens, and the first time a
      // page, one quiet word on turning it back on, never a message at every press.
      if (!hit && !airPlacing() && placeable(inv) !== null) hintAirOff(get().say)
      return false
    }
    if (isCompiler(id)) { get().say('The Compiler is in your hand: choose a block to place.'); return false }
    if (isQuarry(id) && !((inv.charges ?? 0) > 0)) { get().say(NO_CHARGES); return false }
    if (!isQuarry(id) && (!id || !(inv.counts[id] > 0))) { get().say(id ? `No ${blockName(id)} left: mine some first.` : 'Nothing to place: mine a block first.'); return false }
    const cell = target.cell
    const [dx, dy, dz] = cell
    if (target.kind === 'air') {
      // In open air: never into a block, never inside your own body (lib/terrain/airPlace.ts).
      const problem = airProblem(cell, (c) => isSolid(s.world.blockCs(c[0], c[1], c[2])), bodyCells(offsetOf(s, headNow()), air?.eye ?? null))
      if (problem) { get().say(problem); return false }
    }
    if (!cellInReach(s, cell)) { get().say(OUT_OF_REACH); return false }
    // Open space, or a liquid, which a placed block takes the place of.
    if (isSolid(s.world.blockCs(dx, dy, dz))) return false
    const slot = s.world.slotAtCs(dx, dy, dz)
    // Never where you stand: the walk's own gibson. Asked first, so a refused place never surveys the chunk for you.
    if (walkerAt(s, cell)) { get().say('You are standing there: step back to place it.'); return false }
    if (!surveyShown(s, slot)) { get().say('Survey this chunk before building in it.'); return false }
    if (isQuarry(id)) {
      // A charge is placed like a block but is not one: it arms where it stands and writes nothing until its blast (store/useQuarry.ts).
      if (quarryHooks.chargeAt?.(cell)) { get().say('A charge is already there.'); return false }
      if (!quarryHooks.arm?.(cell)) return false
      saveInventory(withCharges(inv, (inv.charges ?? 0) - 1))
      return true
    }
    // Stored and shared as every placed block is: one change in your layer, whether or not it touches another block.
    const change = s.world.setCs(dx, dy, dz, id)
    if (!change) return false
    record(s, change)
    const left = inv.counts[id] - 1
    const counts = { ...inv.counts }
    if (left > 0) counts[id] = left
    else delete counts[id]
    saveInventory({ ...inv, counts })
    advanceHint(1)
    count('placed')
    noteMining({ type: 'place', air: target.kind === 'air' }, s.owner)
    return true
  },

  selectSlot: (slot) => {
    if (slot < 0 || slot >= HOTBAR_SLOTS) return
    saveInventory({ ...get().inventory, slot })
    count('picked')
  },

  assignSlot: (id, slot) => {
    const inv = get().inventory
    const at = slot ?? inv.slot
    if (at < 0 || at >= HOTBAR_SLOTS) return
    // Slot 1 holds the Compiler for good once it is made (owner, 2026-11-27), and the charges keep theirs.
    if (isCompiler(inv.hotbar[at])) { get().say('Slot 1 holds the Compiler: choose another slot.'); return }
    if (isQuarry(inv.hotbar[at])) { get().say(`Slot ${at + 1} holds the Quarry Charges: choose another slot.`); return }
    const hotbar = inv.hotbar.map((h) => (h === id ? 0 : h))
    hotbar[at] = id
    saveInventory({ ...inv, hotbar, slot: at })
    count('picked')
  },

  gainCompiler: () => {
    saveInventory(withCompiler(get().inventory, 'made'))
  },

  gainCharges: (n) => {
    const inv = get().inventory
    saveInventory(withCharges(inv, (inv.charges ?? 0) + Math.max(0, Math.floor(n))))
  },

  blast: (cells) => {
    const s = terrainSession
    const out: Array<{ at: [number, number, number]; id: number; carry: number }> = []
    if (!s) return out
    const changes: Change[] = []
    for (const c of cells) {
      // What mining asks of each cell (mine above): in reach, a block there, a chunk you can build in.
      if (!cellInReach(s, c)) continue
      const id = s.world.blockCs(c[0], c[1], c[2])
      if (id <= EMPTY) continue
      const at = s.world.locate(c[0], c[1], c[2])
      if (!surveyShown(s, at.slot)) continue
      // What is yours in that cell: someone else's block taken is gone for you, never carried; the base you were shown is.
      const yours = yieldOf(at.slot, at.cell, id)
      const change = s.world.setCs(c[0], c[1], c[2], EMPTY)
      if (!change) continue
      changes.push(change)
      const carry = yours > EMPTY ? kindId(yours) : 0
      out.push({ at: [c[0], c[1], c[2]], id, carry: carry === 255 ? 0 : carry })
    }
    recordMany(s, changes)
    return out
  },

  clear: (cells) => {
    const s = terrainSession
    if (!s) return 'Nothing to clear here.'
    if (cells.some((c) => !cellInReach(s, c))) return OUT_OF_REACH
    const slots = new Set<ChunkSlot | null>(cells.map((c) => s.world.slotAtCs(c[0], c[1], c[2])))
    for (const sl of slots) if (!surveyShown(s, sl)) return 'Survey this chunk before building in it.'
    const changes: Change[] = []
    for (const [dx, dy, dz] of cells) {
      const change = s.world.setCs(dx, dy, dz, EMPTY)
      if (change) changes.push(change)
    }
    recordMany(s, changes)
    return null
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

/** The ghost at arm's length, for PLACE (lib/terrain/airPlace.ts): its cell, and where the eye is (the raycast's frame), so your body's cells are kept clear. */
export interface AirAim { cell: Cell; eye: readonly [number, number, number] | null }

/**
 * Why a block will not go in the ghost's cell now, in plain words, or null:
 * a block already there, your own body, out of reach, a chunk you cannot
 * build in yet. The scene draws the ghost dim red for any of them. Asks only:
 * nothing is surveyed or changed.
 */
export function airRefusal(s: TerrainSession, air: AirAim): string | null {
  const problem = airProblem(air.cell, (c) => isSolid(s.world.blockCs(c[0], c[1], c[2])), bodyCells(offsetOf(s, headNow()), air.eye))
  if (problem) return problem
  if (!cellInReach(s, air.cell)) return OUT_OF_REACH
  const slot = s.world.slotAtCs(air.cell[0], air.cell[1], air.cell[2])
  if (!slot) return 'Survey this chunk before building in it.'
  if (slot.own) return null
  if (!slot.generated || !slot.inSpace || s.building.has(slot.key) || !surveyedForYou(slot.key)) return 'Survey this chunk before building in it.'
  return null
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
  // Your own blocks alone, never what others shared: your layer says only what you changed, against the chunk's own revision.
  const layer = encodeLayer(slot.generated, own, s.plane === 1 ? 1 : 0, slot.revision ?? 2)
  s.layers.set(key, layer)
  const seqs = list.map((p) => p.seq)
  s.pending.delete(key)
  useTerrain.setState({ waiting: countWaiting(s) })
  if (s.db) await foldChunk(s.db, s.owner, key, layer, seqs, Date.now()).catch(() => { /* the ops stay in the log */ })
}

/** Record a change: the log in memory and on the device, the layer folded when the log is long. */
function record(s: TerrainSession, change: Change): void {
  recordMany(s, [change])
}

/**
 * Changes kept as one batch: one database write and one state update for
 * all of them, however many (a smash can clear thousands of cells: review of
 * #943), and each chunk past FOLD_AT folded once.
 */
function recordMany(s: TerrainSession, changes: readonly Change[]): void {
  if (!changes.length) return
  const rows: OpRow[] = []
  const full = new Set<string>()
  const noted = new Map<string, Array<Parameters<typeof noteChange>[1]>>()
  const t = Date.now()
  for (const change of changes) {
    const slot = s.world.slotByKey(change.chunk)
    const ownBefore = slot?.own ? slot.own[change.cell] : change.was
    if (slot?.own) slot.own[change.cell] = change.id
    // What it was, for the layer: setting a cell to its ground over someone else's block is written as a change (DECK-0009 §5.4).
    const notes = noted.get(change.chunk) ?? []
    notes.push(slot?.generated ? { cell: change.cell, ownBefore, ownAfter: change.id, shownBefore: change.was, ground: slot.generated[change.cell] } : undefined)
    noted.set(change.chunk, notes)
    const seq = s.nextSeq++
    const list = s.pending.get(change.chunk) ?? []
    list.push({ seq, change })
    s.pending.set(change.chunk, list)
    s.version++
    rows.push({ rowKey: opKey(s.owner, seq), owner: s.owner, chunk: change.chunk, seq, cell: change.cell, id: change.id, t })
    if (list.length >= FOLD_AT) full.add(change.chunk)
  }
  for (const [chunk, notes] of noted) noteChanges(chunk, notes)
  if (s.db) keep(writeOps(s.db, rows))
  useTerrain.setState({ waiting: countWaiting(s) })
  for (const chunk of full) void foldKey(s, chunk)
}

/** One more of something done, for the tutorial's TERRAIN route (TerrainState `tally`). */
function count(what: keyof TerrainState['tally']): void {
  const t = useTerrain.getState().tally
  useTerrain.setState({ tally: { ...t, [what]: t[what] + 1 } })
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

/**
 * The ground revision a chunk is built at here (DECK-0009 §3.10, §7.5).
 * Where you surveyed it: what your published layer names (carried forward),
 * else what this device kept from your first survey, else your layer's, else
 * 2 (every chunk surveyed before revision 3). Where you did not: the base
 * others' surveys give you, else the revision a fresh survey writes.
 */
function chunkRevision(s: TerrainSession, key: string): GroundRevision {
  if (!s.surveyedKeys.has(key)) return othersRevision(key) ?? groundWriteRevision()
  const kept = s.revisions.get(key)
  const layer = s.layers.get(key)
  const pub = publishedPlane(key)
  const revision = pub?.revision ?? kept?.revision ?? (layer ? layerRevision(layer) : null) ?? 2
  if (!kept || kept.revision !== revision) {
    const at: ChunkSurvey = { revision, surveyed: pub?.surveyed ?? kept?.surveyed ?? nowSeconds() }
    s.revisions.set(key, at)
    if (kept && s.db) keep(writeSurveyed(s.db, s.owner, key, Date.now(), at))
  }
  return revision
}

/** Read a surveyed chunk's layer and log, generate its ground at its revision, and put its blocks in the world. */
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
    // What your published layer names here is read first: the revision it names is the chunk's (§3.10).
    await prepareChunk(slot.key)
    if (terrainSession !== s) return
    const revision = chunkRevision(s, slot.key)
    const g = await generateChunk(slot.base, revision)
    // A layer kept against the other revision's ground is read over that one.
    const layer = s.surveyedKeys.has(slot.key) ? s.layers.get(slot.key) : undefined
    const lr = layer ? layerRevision(layer) : null
    const lg = lr !== null && lr !== revision ? (await generateChunk(slot.base, lr)).blocks : null
    if (terrainSession !== s || s.world.slotByKey(slot.key) !== slot) return
    // Your own blocks where you surveyed, and everyone else's shared layers under them (store/terrainShare.ts).
    const own = s.surveyedKeys.has(slot.key) ? builtBlocks(s, slot.key, g.blocks, revision, lg) : null
    // Blocks a new key carried in from your other keys' layers (store/terrainShare.ts, DECK-0009 §5.6) are yours here.
    if (own) applyCarried(slot.key, own, g.blocks, revision)
    slot.own = own
    // What the generator said of this ground at this revision (its type and hardness), for the survey card (lib/terrain/assay.ts).
    slot.ground = typeof g.family === 'string' ? { family: g.family, maxK: g.maxK, meanK: g.meanK, top: g.top } : null
    s.world.setBlocks(slot.key, g.blocks, viewOf(slot.key, g.blocks, own, revision, s.revisions.get(slot.key)?.surveyed))
    slot.revision = revision
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
    owner, plane, world, pending: new Map(), layers: new Map(), surveyedKeys: new Set(), revisions: new Map(), unreadable: new Set(), building: new Set(),
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
      for (const [k, at] of kept.revisions) s.revisions.set(k, at)
      s.nextSeq = Math.max(s.nextSeq, kept.nextSeq)
      s.db = db
      await loadBuilder(db, owner).catch(() => undefined)
      // A preview build's Compiler to test with (lib/blueprint/devGrant.ts): on when the preview grants it, off again when not. Production never grants.
      let inventory = kept.inventory
      if (compilerGranted() && !inventory.compiler) inventory = withCompiler(inventory, 'granted')
      else if (!compilerGranted() && inventory.compiler === 'granted') inventory = withoutCompiler(inventory)
      useTerrain.setState({ inventory, hint: kept.hint })
      for (const f of quarryHooks.fieldReady) { try { f(s) } catch { /* one listener failing never stops the field */ } }
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
  let made = false
  const far = s ? offsetOf(s, at).some((v) => Math.abs(v) > FAR) : false
  if (!s || s.owner !== owner || s.plane !== plane || far) {
    const old = s
    // Another identity: what the one left changed goes out first while its field is still here, if it is LIVE (its own setting; DECK-0009 §5.7).
    // LIVE as it was in memory while that identity was on screen, never read back from storage (a save that failed would read LIVE); unknown is LOCAL.
    if (old && old.owner !== owner && old.owner !== 'local') await identityLeaving(old.owner, liveSeen.get(old.owner) ?? false).catch(() => undefined)
    if (old) fieldClosing()
    s = makeField(owner, plane, at)
    terrainSession = s
    if (old) await closeField(old)
    publishWalls()
    made = true
  }
  await s.ready
  if (terrainSession !== s) return null
  // A new field (load, another identity or plane, far away): others' layers round you are read at once, in any mode (store/terrainShare.ts).
  if (made) void readNear(true)
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
  // Only chunks nobody has surveyed for you: one someone else surveyed is built in at once (surveyShown).
  const open = (sl: ChunkSlot): boolean => sl.inSpace && !sl.own && !surveyedForYou(sl.key) && slotInReach(s, sl.key)
  if (here && open(here)) return here.key
  const look = walkLookDirection()
  if (!look.valid) return null
  const d = look.forward
  for (let t = 2; t < 48; t += 2) {
    const sl = s.world.slotAtCs(Math.round(w[0] + d.x * t), Math.round(w[1] + d.y * t), Math.round(w[2] + d.z * t))
    if (sl && open(sl)) return sl.key
  }
  return null
}

/**
 * Who surveyed the chunk you stand in, if anyone: 'you' (kept on this
 * device), 'someone' (drawn for you from another player's layer, so yours to
 * build in at once: surveyShown), or null while it is unsurveyed, or there is
 * no field or no chunk here.
 */
export function hereSurveyedBy(s: TerrainSession | null = terrainSession): 'you' | 'someone' | null {
  if (!s) return null
  const w = offsetOf(s, headNow())
  const here = s.world.slotAtCs(w[0], w[1], w[2])
  if (!here || !here.inSpace) return null
  if (s.surveyedKeys.has(here.key)) return 'you'
  return surveyedForYou(here.key) ? 'someone' : null
}

/**
 * The chunk you stand in when it is surveyed for you (by you, or counted as
 * surveyed from someone else's layer) and its blocks are in: the one SURVEY's
 * button offers the survey card for (terrain/SurveyCard.tsx). Null otherwise.
 */
export function cardChunkHere(s: TerrainSession | null = terrainSession): string | null {
  if (!s) return null
  const w = offsetOf(s, headNow())
  const here = s.world.slotAtCs(w[0], w[1], w[2])
  // Its blocks stay drawn while it is built again (a reground at another revision): CARD stays with them (review of #956).
  if (!here || !here.inSpace || !here.blocks) return null
  return s.surveyedKeys.has(here.key) || surveyedForYou(here.key) ? here.key : null
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

/** Each identity's LIVE or LOCAL as last seen on screen (in memory): what decides whether its waiting changes go out when it is switched away from. */
const liveSeen = new Map<string, boolean>()
{
  const c0 = useCyberspace.getState()
  if (c0.identity.pubkey) liveSeen.set(c0.identity.pubkey, c0.live)
}

useCyberspace.subscribe((c, prev) => {
  // The identity on screen's own setting (a switch sets identity and LIVE together).
  if (c.identity.pubkey) liveSeen.set(c.identity.pubkey, c.live)
  if (c.identity.pubkey !== prev.identity.pubkey && useTerrain.getState().active) void useTerrain.getState().exit()
  // LOCAL shares nothing; back to LIVE, what waited goes out (store/terrainShare.ts).
  if (c.live !== prev.live && c.identity.pubkey === prev.identity.pubkey) liveChanged(c.live)
  // Every step, in any mode: a chunk left by more than 4 blocks shares what waits, and the layers round you are read (store/terrainShare.ts).
  if (c.cursor !== prev.cursor || c.position !== prev.position || c.walking !== prev.walking) noteMove()
  // WALK ending under TERRAIN (its button, X, a respawn) ends TERRAIN: TERRAIN is WALK.
  if (prev.walking && !c.walking && useTerrain.getState().active) void useTerrain.getState().exit()
  follow()
})
useTerrain.subscribe((t, prev) => { if (t.active !== prev.active) follow() })
publishWalls()

/**
 * Draw a chunk again with what is shared there now (store/terrainShare.ts),
 * or load it when it is not held. A chunk you never surveyed is drawn over
 * the base others' surveys give you, so when that base moves to another
 * revision (a survey that ranks higher for you came in), its ground is made
 * again at it.
 */
function redisplay(key: string): void {
  const s = terrainSession
  if (!s) return
  const slot = s.world.slotByKey(key)
  if (!slot?.generated) { void syncTerrain(); return }
  if (!slot.own && !s.building.has(key)) {
    const want = othersRevision(key)
    if (want !== null && want !== (slot.revision ?? 2)) { void reground(s, slot, want); return }
  }
  s.world.setBlocks(key, slot.generated, viewOf(key, slot.generated, slot.own ?? null, slot.revision ?? 2, s.revisions.get(key)?.surveyed))
  s.version++
}

/** A chunk you never surveyed, drawn again over its ground at another revision (redisplay). */
async function reground(s: TerrainSession, slot: ChunkSlot, revision: GroundRevision): Promise<void> {
  if (s.building.has(slot.key)) return
  s.building.add(slot.key)
  try {
    const g = await generateChunk(slot.base, revision)
    if (terrainSession !== s || s.world.slotByKey(slot.key) !== slot || slot.own) return
    s.world.setBlocks(slot.key, g.blocks, viewOf(slot.key, g.blocks, null, revision))
    slot.revision = revision
    s.version++
  } catch { /* drawn as it was; the next read tries again */ } finally {
    s.building.delete(slot.key)
  }
}

/** A chunk key, from a key or a chunk base. */
const keyOf = (chunk: string | ChunkBase): string => (typeof chunk === 'string' ? chunk : chunkKey(chunk))

/**
 * The ground revision you see a chunk at (DECK-0009 §3.10, §7.5): the base
 * it is drawn over; where you surveyed it, the revision it keeps; where
 * someone else did, the base their surveys give you; and where nobody did,
 * the revision a survey of yours would reveal now.
 */
export function groundRevisionFor(chunk: string | ChunkBase, s: TerrainSession | null = terrainSession): GroundRevision {
  const key = keyOf(chunk)
  const shown = shownRevision(key)
  if (shown !== null) return shown
  if (s?.surveyedKeys.has(key)) return s.revisions.get(key)?.revision ?? 2
  return othersRevision(key) ?? groundWriteRevision()
}

/**
 * A chunk's generated ground, block id per cell (coords.ts idx order), at the
 * revision you see it at (groundRevisionFor): the one API for the ground of
 * a chunk, so nothing counts or draws a revision the chunk is not. A copy:
 * the caller may keep or change it. With it, what the generator said of that
 * ground (its type and terrain K, lib/terrain/assay.ts GroundFacts), for the
 * survey card.
 */
export async function groundFor(chunk: string | ChunkBase): Promise<{ revision: GroundRevision; blocks: Uint8Array; base: ChunkBase; facts: GroundFacts | null }> {
  const key = keyOf(chunk)
  const base = typeof chunk === 'string' ? parseChunkKey(chunk) : chunk
  if (!base) throw new Error(`not a chunk: ${key}`)
  const s = terrainSession
  const revision = groundRevisionFor(key, s)
  const slot = s?.world.slotByKey(key)
  if (slot?.generated && (slot.revision ?? 2) === revision && slot.ground !== undefined) return { revision, blocks: slot.generated.slice(), base, facts: slot.ground }
  const g = await generateChunk(base, revision)
  return { revision, blocks: g.blocks, base, facts: typeof g.family === 'string' ? { family: g.family, maxK: g.maxK, meanK: g.meanK, top: g.top } : null }
}

connectShareHost({
  field: () => {
    const s = terrainSession
    return s ? {
      owner: s.owner, plane: s.plane, db: s.db, slot: (key) => s.world.slotByKey(key), surveyed: (key) => s.surveyedKeys.has(key),
      surveyedAt: (key) => (s.surveyedKeys.has(key) ? s.revisions.get(key)?.surveyed : undefined),
    } : null
  },
  head: headNow,
  active: () => useTerrain.getState().active,
  fold: async (key) => { const s = terrainSession; if (s) await foldKey(s, key) },
  redisplay,
  adopt: async (key, cells) => {
    const s = terrainSession
    const slot = s?.world.slotByKey(key)
    if (!s || !slot?.generated || !slot.own) return
    // Another key's blocks a new key started from (store/terrainShare.ts, DECK-0009 §5.6): yours on this device now.
    for (const [c, v] of cells) slot.own[c] = Math.min(v, 255)
    for (const { change } of s.pending.get(key) ?? []) slot.own[change.cell] = change.id
    const layer = encodeLayer(slot.generated, slot.own, s.plane === 1 ? 1 : 0, slot.revision ?? 2)
    s.layers.set(key, layer)
    if (s.db) await foldChunk(s.db, s.owner, key, layer, [], Date.now()).catch(() => { /* kept in memory */ })
    redisplay(key)
  },
  rebase: async (key, revision, surveyed, changed) => {
    const s = terrainSession
    const slot = s?.world.slotByKey(key)
    if (!s || !slot?.generated || !slot.own || (slot.revision ?? 2) === revision) return
    const g = (await generateChunk(slot.base, revision)).blocks
    if (terrainSession !== s || s.world.slotByKey(key) !== slot || !slot.own || !slot.generated) return
    // Every cell you changed keeps its value (the ones named, and any other your blocks hold); the rest take the new ground.
    const was = slot.generated
    const explicit = explicitCells(key)
    const kept = new Set(changed)
    for (let c = 0; c < CELLS; c++) if (slot.own[c] !== was[c] || explicit.has(c)) kept.add(c)
    const own = new Uint8Array(CELLS)
    for (let c = 0; c < CELLS; c++) own[c] = kept.has(c) ? slot.own[c] : g[c]
    // A change of yours that is now the ground's value stays a change (§5.4).
    addExplicit(key, [...kept].filter((c) => own[c] === g[c]))
    slot.own = own
    slot.generated = g
    slot.revision = revision
    const at: ChunkSurvey = { revision, surveyed }
    s.revisions.set(key, at)
    if (s.db) keep(writeSurveyed(s.db, s.owner, key, Date.now(), at))
    const layer = encodeLayer(g, own, s.plane === 1 ? 1 : 0, revision)
    s.layers.set(key, layer)
    s.unreadable.delete(key)
    if (s.db) await foldChunk(s.db, s.owner, key, layer, [], Date.now()).catch(() => { /* kept in memory */ })
    redisplay(key)
  },
})

// Development only: the field, for browser probes (never in a production build).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __terrainBlocks?: unknown }).__terrainBlocks = { session: () => terrainSession, state: () => useTerrain.getState() }
}
