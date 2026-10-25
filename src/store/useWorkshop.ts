/**
 * useWorkshop.ts — the shards you are building, and the one on the bench.
 *
 * Everything here is local: shards persist in this browser (IndexedDB, or
 * localStorage where that cannot be used: store/workshopStorage.ts) until deployed,
 * and a deployed shard stays here too, so it can be deployed again somewhere
 * else or edited into a new one. The editing model is small and exact: stamp
 * a shape, place a vertex, select a point and nudge it a unit along an axis,
 * color it, tap corners into a face. It fits a thumb.
 *
 * Two rules about points. A vertex you ADD lands on an empty point or selects
 * the one already there, so hand placing never stacks vertices by accident. A
 * stamp brings its own vertices even onto occupied points (stamps.ts says
 * why), so from then on "a point" can be several vertices, and SELECT, the
 * nudge pad, the color and DELETE act on every vertex at every selected point
 * together. What you see is one dot, and it behaves like one dot; a box
 * dragged on the bench, or CONNECTED, selects many at once.
 *
 * Every change to the current shard goes through `edit`, which is also where
 * undo lives: the shard as it was is pushed onto a stack, redo holds what
 * undo popped, and switching shards clears both. Renaming is not an edit.
 */

import { create } from 'zustand'
import {
  DIVISIONS,
  GRID_HALF,
  TICKS_PER_UNIT,
  ticksOf,
  vertexAt,
  type Division,
  MAX_EXTENT,
  MIN_EXTENT,
  neededExtent,
  clampColor,
  clampUnit,
  fromPayload,
  newShard,
  pointKey,
  toPayload,
  uuid,
  validFace,
  validPoint,
  type ShardMode,
  type ShardModel,
  type ShardVertex, type Part, type Ref, cloneVertex, hexToRgb, rgbToHex } from 'sno-core/shards'
import { withOpacity } from '../lib/opacityStep'
import { authoredConstrainOf, chosenConstrainOf, withConstrain, type Constrain } from '../lib/walkConstrain'
import { Fetched, addPart, parseAddress, quarterTurnPart, removeParts } from 'sno-core/parts'
import { carriedCopy, copyInto, detachInto, focusOf, keepOwnTable, noTable, signedTableOnly, writeCopy, you, type InsideStep } from '../lib/carried'
import { FLOOR, MAX_SIZE, MIN_SIZE, stamp, type Facing, type StampKind, type WorkPlane } from 'sno-core/stamps'
import { BUILT_IN, hexAt, remap, samePalette, snapHex, type Palette } from 'sno-core/snoPalette'
import { newell, triangulate } from 'sno-core/triangulate'
import { flipFace, flipSurface, windAdded, windOutward } from 'sno-core/winding'
import { Vector3 } from 'three'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'
import { cornerAverage, weld } from '../lib/weld'
import { subdivide, subdivideNotice } from '../lib/subdivide'
import { withCredit, type Credit } from 'sno-core/feed'
import { newestFirst } from '../lib/shardFolders'
import { attach, initialShards, persist, saveNow as saveStored } from './workshopStorage'

export { hydrateWorkshop, storageMode } from './workshopStorage'

/** VIEW builds nothing: it is the tool you hold to look around. */
export type Tool = 'view' | 'stamp' | 'add' | 'select' | 'face'

const PALETTE_STORAGE = 'onosendai:palette'
const PALETTES_STORAGE = 'onosendai:palettes'

/**
 * Where a palette this browser knows lives on nostr (DECK-0003 §1.3b).
 *
 * A palette event is a regular event, so it cannot be replaced: correcting one
 * publishes a second event that names the first. That is why this is kept at
 * all. `id` is the newest version, which is what a reference points at, and
 * `genesis` is the first, which is what lets an edit say where the chain
 * started without a reader walking the whole of it.
 */
export interface PublishedPalette {
  id: string
  genesis: string
  /** Where it was seen, for the relay hint in a chain tag and in an nevent. */
  relays: string[]
}

/** A palette with a name somebody gave it. The name is this browser's, not the wire's. */
export interface NamedPalette {
  id: string
  name: string
  colors: Palette
  /** Set once it has been published, or once it came from somebody's event. */
  event?: PublishedPalette
}

function loadPalettes(): NamedPalette[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PALETTES_STORAGE) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((p): p is NamedPalette => (
      !!p && typeof p.id === 'string' && typeof p.name === 'string'
      && Array.isArray(p.colors) && p.colors.length >= 2 && p.colors.length <= 256
      && p.colors.every((c: unknown) => Array.isArray(c) && c.length === 3 && c.every((n) => Number.isInteger(n) && n >= 0 && n <= 255))
    // A half-written `event` is dropped rather than carried: every use of it
    // writes an id into a tag, and a tag holding `undefined` would publish an
    // edit chain that points nowhere.
    )).map((p) => (validEvent(p.event) ? p : { id: p.id, name: p.name, colors: p.colors }))
  } catch { return [] }
}

function validEvent(e: PublishedPalette | undefined): boolean {
  return !e || (typeof e.id === 'string' && typeof e.genesis === 'string' && Array.isArray(e.relays))
}

function savePalettes(list: NamedPalette[]): void {
  try { localStorage.setItem(PALETTES_STORAGE, JSON.stringify(list)) } catch { /* quota or private mode */ }
}
const AVATAR_KEY = 'onosendai:workshop-avatar'
/** Undo depth per shard. */
const HISTORY = 64
/**
 * The swatches older builds seeded the recent row with, taken from the SNO palette by index
 * rather than written as hex, so every one of them is a colour a shard can
 * actually carry on the wire (lib/snoPalette).
 *
 * 226 is this client's own cyan, 238 pure red, 246 a spring green, 249 amber,
 * 243 violet, 228 the instrument orange, 225 white, 239 pure blue.
 */
export const DEFAULT_PALETTE = [226, 238, 246, 249, 243, 228, 225, 239].map((i) => hexAt(BUILT_IN, i))
/** Swatches the palette keeps before the oldest falls off the end. */
const PALETTE_MAX = 24
const HEX = /^#[0-9a-f]{6}$/

type P3 = [number, number, number]

/**
 * Where a quarter turn pivots. The middle of the points' extent serves when a
 * turn about it keeps every point on the snap grid: that is when the middle's
 * x and z are both on a grid line or both halfway between lines, which is
 * every square footprint, odd or even. Otherwise (a two by three, say) the
 * middle snapped to the grid, and the caller keeps that point for the next
 * turn so the shape cycles home in four instead of walking a step each time.
 */
/**
 * The two axes a turn moves, for a working plane.
 *
 * A quarter turn happens in the plane you are building on, about its normal,
 * which is what the plane number already names (stamps.ts WorkPlane: 1 the
 * floor, 0 facing +X, 2 facing +Z). Taking them in this order, a turn of +1
 * carries +a onto +b and +b onto -a, which is the right-handed quarter turn
 * about the normal and is exactly what the floor has always done: for the
 * floor the pair is (z, x), and +z goes to +x while +x goes to -z.
 */
export function turnAxes(plane: WorkPlane): [0 | 1 | 2, 0 | 1 | 2] {
  return [((plane + 1) % 3) as 0 | 1 | 2, ((plane + 2) % 3) as 0 | 1 | 2]
}

function turnPivotFor(pts: P3[], step: number, axes: [0 | 1 | 2, 0 | 1 | 2] = [2, 0]): [number, number] {
  const [a, b] = axes
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of pts) { minX = Math.min(minX, p[a]); maxX = Math.max(maxX, p[a]); minZ = Math.min(minZ, p[b]); maxZ = Math.max(maxZ, p[b]) }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2
  const rem = (v: number): number => ((v % step) + step) % step
  const half = step / 2
  if ((rem(cx) === 0 && rem(cz) === 0) || (rem(cx) === half && rem(cz) === half)) return [cx, cz]
  const snap = (v: number): number => Math.round(v / step) * step
  return [snap(cx), snap(cz)]
}

/**
 * Points lifted out of a shard, waiting to go back down.
 *
 * Held in absolute ticks, exactly where they were, so PASTE can put the shape
 * back with its own form intact and only slide it onto the working plane. The
 * faces come too, but only those whose three corners are all in hand: a face
 * with a corner left behind is not a face.
 */
/** Where PASTE puts the held points: back where they came from, or on the working plane. */
export type PastePlace = 'exact' | 'floor'

export interface ClipPoints {
  points: Array<{ at: P3; c: [number, number, number] }>
  faces: Array<[number, number, number]>
  /** Each face's hard color (SEAM), in the order of `faces`, when the shard it came from had them. */
  facecolors?: Array<[number, number, number]>
  /** Placed objects in hand, each with the reference it names rather than an index into refs, so it pastes into any object. */
  parts: Array<Omit<Part, 'ref'> & { ref: Ref }>
  /**
   * The unit of the shard it came from, set only when a whole shard was
   * copied (COPY in MENU). PASTE then keeps its true size in a shard on
   * another unit and grows the grid to hold it; a selection pastes tick for
   * tick, as it always has.
   */
  unit?: number
}

/** The selected points, exactly where they are, with the faces wholly among them, and the selected placed objects. */
function clipOf(s: ShardModel, selection: number[], partSel: number[] = []): ClipPoints | null {
  const taken = [...new Set(selection.filter((i) => s.vertices[i]))].sort((a, b) => a - b)
  const placed = [...new Set(partSel.filter((i) => s.parts?.[i]))].sort((a, b) => a - b)
  if (taken.length === 0 && placed.length === 0) return null
  const local = new Map(taken.map((i, k) => [i, k]))
  const kept = s.faces.map((_, i) => i).filter((i) => s.faces[i].every((v) => local.has(v)))
  // No whole face in hand, no seams: an empty list would count as a seamed
  // clip and flatten every face of a plain shard it was pasted into.
  const seams = kept.length > 0 && s.facecolors && s.facecolors.length === s.faces.length ? s.facecolors : null
  return {
    points: taken.map((i) => ({ at: ticksOf(s.vertices[i]), c: [...s.vertices[i].c] as [number, number, number] })),
    faces: kept.map((i) => s.faces[i].map((v) => local.get(v) as number) as [number, number, number]),
    ...(seams ? { facecolors: kept.map((i) => [...seams[i]] as [number, number, number]) } : {}),
    parts: placed.map((i) => { const q = s.parts![i]; return { ...q, at: [...q.at] as P3, turn: [...q.turn] as [number, number, number], ref: s.refs![q.ref] } }),
  }
}

/**
 * The seams carried through an edit that takes faces away or adds them.
 *
 * Seams are all or none and one per face (sno-core shards, DECK-0003 §1.4a):
 * a list left a face short or long is dropped from the wire and from the
 * bench, so one deleted face used to cost every seam on the shard. `from[j]`
 * is the face of `before` that face j of `after` was, or -1 for a face the
 * edit made, which takes the flat average of its corners, as PASTE does.
 *
 * The list goes when no face is left: an empty list is in step with no faces,
 * and the next FILL would grow it into flat seams nobody chose. It goes too
 * when it was already out of step, which an older build's deletes left it:
 * nothing says which face each entry was, every reader already ignores it, so
 * dropping it changes nothing anyone sees, while passing it on let an edit
 * that brought the lengths level again put each face's neighbour's color on
 * it and on the wire.
 */
function seamsFollow(before: ShardModel, after: ShardModel, from: number[]): ShardModel {
  const { facecolors: _held, ...bare } = after
  const own = before.facecolors
  if (!own?.length || own.length !== before.faces.length || after.faces.length === 0) return bare
  return { ...bare, facecolors: from.map((i, j) => (i >= 0 && own[i] ? [...own[i]] as [number, number, number] : cornerAverage(after, after.faces[j]))) }
}

/** Faces 0..n-1 of `after` are `before`'s, in order, and the rest are new: FILL's and FACE's shape. */
const appended = (before: ShardModel, after: ShardModel): number[] => after.faces.map((_, j) => (j < before.faces.length ? j : -1))

/** This shard's address once this key deploys it, which Bench gives OBJECT and the clipboard gives PASTE: what it must never place. */
export function ownAddress(pubkey: string, id: string | null): string | undefined {
  return id ? `33331:${pubkey}:${id}` : undefined
}

/** A position in ticks scaled by 2^k about the origin, rounded half away from zero (so a mirror image stays one), never -0. */
function scaleTicks(p: P3, k: number): P3 {
  if (k === 0) return [...p] as P3
  return p.map((n) => { const r = Math.round(Math.abs(n) * 2 ** k); return n < 0 ? 0 - r : r }) as P3
}

/**
 * An object chosen to stamp with OBJECT: the reference each placement will
 * name, and the object as it was when chosen, which is what the ghost draws.
 */
export interface StampObject {
  ref: Ref
  name: string
  shard: ShardModel
  /**
   * From YOURS: a piece of your workshop, placed as a copy carried inside the
   * shard it is stamped into (DECK-0003 §1.10; lib/carried.ts copyInto), its
   * key under `pubkey`. Absent for the FEED and BY ADDRESS, which place by
   * reference, a live link that follows its author's edits.
   */
  copy?: { sourceId: string; pubkey: string }
}

/** "1 point" or "7 points", with its faces and placed objects when it has any. */
function countLabel(clip: ClipPoints): string {
  const bits: string[] = []
  if (clip.points.length) bits.push(`${clip.points.length} point${clip.points.length === 1 ? '' : 's'}`)
  if (clip.faces.length) bits.push(`${clip.faces.length} face${clip.faces.length === 1 ? '' : 's'}`)
  if (clip.parts.length) bits.push(`${clip.parts.length} object${clip.parts.length === 1 ? '' : 's'}`)
  return bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0] ?? 'nothing'
}

/**
 * Every vertex reachable from a selection, following the two things that join
 * one vertex to another: a face, which joins its three corners, and a shared
 * point, since two stamps that touch keep their own corners so an edge between
 * different colors stays crisp.
 *
 * Union-find rather than a graph walk because the joins arrive in no order and
 * both kinds are the same operation on a set. Returned sorted, so a selection
 * built from it is in the same order as one built by hand.
 */
function connectedTo(s: ShardModel, selection: number[]): number[] {
  const parent = s.vertices.map((_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  const join = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  const byPoint = new Map<string, number>()
  s.vertices.forEach((v, i) => { const k = pointKey(ticksOf(v)); const first = byPoint.get(k); if (first === undefined) byPoint.set(k, i); else join(first, i) })
  for (const f of s.faces) { join(f[0], f[1]); join(f[1], f[2]) }
  const roots = new Set(selection.filter((i) => s.vertices[i]).map(find))
  return s.vertices.map((_, i) => i).filter((i) => roots.has(find(i)))
}

export interface WorkshopState {
  shards: ShardModel[]
  /**
   * Why the latest changes are not saved, while they are not: storage is
   * full, or could not be opened. Null when everything is saved.
   */
  storageError: string | null
  currentId: string | null
  /** The workshop overlay is up. */
  open: boolean
  tool: Tool
  /**
   * Selected vertex indices. Picking a point (a tap, a box, a face) takes
   * every vertex standing on it then, and the nudge pad, the color and DELETE
   * act on all of them together. Built by tapping points, dragging a box on
   * the bench, or JOINED. Once held, a vertex set is never widened again by
   * what comes to stand on the same spot later: a stack made by a move stays
   * two points until the author picks the spot or WELDs it
   * (settleSelection, arkinox, 2026-10-12).
   */
  selection: number[]
  /** Corners picked so far for the next face, in order. */
  facePick: number[]
  /** The face tapped in FACE mode, an index into the shard's faces, so DELETE can take it. */
  selectedFace: number | null
  /** The swatch row: hexes the author has reached for, all of them palette colours. */
  palette: string[]
  /** Palettes this browser knows, beyond the built-in. Named for people, not for the wire. */
  palettes: NamedPalette[]
  /** The Y the add and stamp tools place on, in ticks: the grid plane moves up and down. */
  level: number
  /** The working grid's normal axis: 1 the floor, 0 facing +X, 2 facing +Z (stamps.ts WorkPlane). */
  plane: WorkPlane
  /** Snap: the grid the placing tools, the marquee and the nudges use is a unit over this. A tool setting, not the shard's. */
  division: Division
  /** The to-scale avatar at the grid's centre, on or off. Kept between visits. */
  showAvatar: boolean
  /** The color new vertices get, and the color input shows. */
  color: [number, number, number]
  stampKind: StampKind
  stampSize: number
  stampFacing: Facing
  /** The grid point under the pointer, where a tap would land; null off the grid. */
  aim: P3 | null
  /** The current shard as it was before each edit, oldest first. */
  past: ShardModel[]
  /** What undo took away, for redo. */
  future: ShardModel[]
  /** One line about the last action, shown on the bench until the next edit. */
  notice: string | null
  /** Points CUT, COPY or DUPLICATE took a copy of, or a whole shard MENU's COPY did, for PASTE. Outlives the shard they came from. */
  clip: ClipPoints | null
  /** Where the last turn pivoted, kept while the same selection turns again. */
  turnPivot: { key: string; at: [number, number] } | null
  /**
   * Placed objects selected, by index into `parts` (DECK-0003 §1.10). A placed
   * object is one thing: it moves, turns, cuts, copies and deletes whole, with
   * or without points selected beside it; its own vertices are not this
   * object's to edit.
   */
  partSel: number[]
  /** Select one placed object alone, or none. */
  selectPart: (index: number | null) => void
  /** Put one placed object in or out of the selection. */
  togglePart: (index: number) => void
  /** Replace the placed-object selection, as the box does. */
  setPartSelection: (indices: number[]) => void
  /**
   * INVERT (arkinox, 2026-10-10): while on, a tap on a point, a face or a
   * placed object, and a box, take out of the selection and never add. On a
   * phone it is far easier to gather too much with a few boxes and take the
   * extras away than to tap each point exactly. Off again when the tool
   * changes, so a mode nobody can see never follows you to the next tool.
   */
  invert: boolean
  setInvert: (on: boolean) => void
  /** STAMP places a built-in shape, or a published object by reference (DECK-0003 §1.10). */
  stampMode: 'shape' | 'object'
  /** The object OBJECT stamps, chosen in the picker. */
  stampObject: StampObject | null
  setStampMode: (mode: 'shape' | 'object') => void
  setStampObject: (object: StampObject | null) => void
  /**
   * Place the chosen object at `at`, turned by the stamp's facing. `self` is
   * this object's own address if this key published it, so an object is never
   * made to place itself (every reader would draw a loop placeholder).
   */
  placeObject: (at: P3, self?: string) => void

  openWorkshop: (id?: string) => void
  closeWorkshop: () => void
  create: (name?: string) => string
  select: (id: string | null) => void
  rename: (id: string, name: string) => void
  duplicate: (id: string) => string
  remove: (id: string) => void
  /**
   * Delete many shards in one step: one change to the list, one storage write
   * (a single transaction in IndexedDB), however many there are. Local only:
   * nothing is retracted or published, and a published one stays on the
   * relays. The shard on the bench, when it is one of them, gives way to the
   * newest left, and to a new empty one when none is left, so the bench never
   * holds a shard that is gone. When it is not one of them it stays open as it
   * was, its undo with it. STAMP's chosen object lets go when it was one of
   * them (your own object, by its `d`).
   *
   * Resolves true once the deletion has committed to storage (saveNow), false
   * when the write failed: the shards are then gone from this tab only, and
   * come back on a reload unless a later save lands. A folder's DELETE
   * CONTENTS waits for true before it takes the folders (hud/ShardFolders
   * deleteFolderNow), so a failed write never leaves them loose at the top.
   */
  removeMany: (ids: readonly string[]) => Promise<boolean>
  setMode: (mode: ShardMode) => void
  /**
   * How solid the shard draws, a whole percent (DECK-0003 §1.11): 100 is
   * solid and is stored as no opacity at all, the wire's canonical form;
   * anything else is kept between the floor (10) and 99. Undoable like MODE.
   */
  setOpacity: (percent: number) => void
  /**
   * Whether a walker can cross the shard in WALK (DECK-0003 §1.12,
   * lib/walkConstrain.ts): off, all of its faces, or only while it draws
   * solid and opaque. Written as the word, OFF as `"off"`; a shard that never
   * chose already shows and publishes OPAQUE, so pressing OPAQUE there is no
   * edit. Undoable like MODE.
   */
  setConstrain: (c: Constrain) => void
  setUnit: (unit: number) => void
  /** The build grid's half-width for the current shard, never below what its vertices need. */
  setExtent: (extent: number) => void
  setTool: (tool: Tool) => void
  setLevel: (level: number) => void
  setPlane: (plane: WorkPlane) => void
  setDivision: (division: Division) => void
  setShowAvatar: (on: boolean) => void
  /** One snap step, in ticks. */
  step: () => number
  setColor: (c: [number, number, number]) => void
  setStampKind: (kind: StampKind) => void
  setStampSize: (size: number) => void
  turnStamp: () => void
  setAim: (p: P3 | null) => void
  placeStamp: (at: P3) => void
  addVertex: (p: P3) => void
  /** Select one point only (null clears). Also drops any selected face: a point and a face are never selected together. */
  selectVertex: (index: number | null) => void
  /** Add the point to the selection, or take it out if it is in. */
  toggleVertex: (index: number) => void
  /** Replace the selection; whole points, whatever indices are given. */
  setSelection: (indices: number[]) => void
  /** Grow the selection to every vertex joined to it by faces (and by shared points). */
  selectConnected: () => void
  selectFace: (index: number | null) => void
  deleteSelectedFace: () => void
  /** FLIP FACE: the selected face turned round, its front to its back (DECK-0003 §1.4). */
  flipSelectedFace: () => void
  /** FLIP SURFACE: the selected face turned, and every face joined to it by clean edges turned to agree. */
  flipSelectedSurface: () => void
  /** AUTO: every face of the shard wound outward by the guess (sno-core orient). */
  autoWind: () => void
  /** The colour onto one face as a hard seam, not onto its corners. */
  colorFace: (index: number, c: [number, number, number]) => void
  /** Give every face back to its corners: the object interpolates again. */
  clearFaceColors: () => void
  /** Put a color at the front of the palette (moving it there if it is already in). */
  rememberColor: (hex: string) => void
  forgetColor: (hex: string) => void
  moveSelected: (axis: 0 | 1 | 2, delta: number) => void
  /**
   * Turn the selected points a quarter turn about the vertical, +1 one way
   * and -1 the other, around the middle of their extent snapped to the
   * current DIVISION's grid, so every point stays on that grid.
   */
  rotateSelected: (turns: 1 | -1) => void
  colorSelected: (c: [number, number, number]) => void
  colorAll: (c: [number, number, number]) => void
  /** Keep a palette under a name, and return its id. */
  savePalette: (name: string, colors: Palette, event?: PublishedPalette) => string
  /**
   * Remember where a palette went, so the next publish of it is an edit.
   *
   * Without this an edit would be a second unrelated palette on the network
   * rather than the next link in one chain, and nothing could walk back to
   * what the colours used to be.
   */
  notePalettePublished: (id: string, event: PublishedPalette) => void
  /** The colour onto the selection and everything joined to it by faces. */
  colorConnected: (c: [number, number, number]) => void
  /**
   * The dropper: the color of the one selected point, or of the selected
   * face (its hard color when it has one, else the average of its corners),
   * snapped onto the object's palette,
   * put in hand and at the front of the recent row.
   */
  sampleColor: () => void
  renamePalette: (id: string, name: string) => void
  forgetPalette: (id: string) => void
  /**
   * Put the current shard on another palette, keeping every index.
   * `id` is a saved palette, or null for the built-in.
   */
  usePalette: (id: string | null) => void
  deleteSelected: () => void
  /**
   * Fold points standing on one spot into one: the selection when two or more
   * are selected, else the whole shard. Faces that disagreed on colour keep
   * their own (lib/weld). Never automatic: a paste lands on its original on
   * purpose, to be moved.
   */
  weld: () => void
  /** Take the selected points out of the shard and hold them for PASTE. */
  cutSelection: () => void
  /** Hold a copy of the selected points for PASTE and leave them where they are. */
  copySelection: () => void
  /** Let the held points go; PASTE goes with them. */
  clearClip: () => void
  /** Hold a copy of the selected points and put one down at once: copy and paste in a step. */
  duplicateSelection: () => void
  /**
   * COPY on a shard in MENU: hold the whole of it for PASTE, every point,
   * face, seam and placed object, with its unit. False, holding nothing new,
   * when the shard is empty.
   */
  copyShard: (model: ShardModel) => boolean
  /**
   * Put the held points down, selected and ready to be moved: `exact` where
   * they were taken from, `floor` resting on the working plane. `self` is
   * this shard's own address (ownAddress), so a paste never makes it place
   * itself.
   */
  pasteClip: (where?: PastePlace, self?: string) => void
  /**
   * IMPORT: a shard made from a 3D file (sno-core importFile), put down the
   * way PASTE FLOOR puts a copied shard down: resting on the working plane,
   * selected, and undone in one step. The clipboard is left as it was. In an
   * empty shard it takes the file's name, and a point cloud draws as POINTS.
   * `notice` is the import's one line. False when nothing was put down.
   */
  insertImport: (model: ShardModel, notice: string, self?: string) => boolean
  pickForFace: (index: number) => void
  clearFacePick: () => void
  /** Make faces from the picked corners, in order. */
  fill: () => void
  /** Faces for the selected points at once: a flat set becomes one polygon, a solid set its convex hull. */
  fillSelection: () => void
  /**
   * SUBDIVIDE: every fully selected face cut into four, with the neighbors
   * split to match, or the one selected edge cut in two (lib/subdivide). The
   * corners and the new points stay selected, so a second press cuts again.
   */
  subdivideSelection: () => void
  removeFace: (index: number) => void
  clearShard: () => void
  undo: () => void
  redo: () => void
  /** The current shard in wire form, for the clipboard. */
  exportCurrent: () => string | null
  /** A shard from wire form (the clipboard); the new shard's id, or null if it is not one. */
  importText: (text: string) => string | null
  /**
   * Add a deep copy of a model from elsewhere (a found shard, a feed object)
   * to your Stash; returns its new id. With
   * `credit`, the copy remembers whose object it was made from (REMIX from
   * the Shard Feed), and every copy deployed from it carries the credit tag.
   * With `id`, the copy keeps that id and its name instead of taking new
   * ones: your own published object taken back from the Shard Feed under its
   * `d`, so PUBLISH edits it in place rather than publishing a second copy
   * beside it, as snocrash's adopt does (arkinox, 2026-10-10).
   */
  importShard: (model: ShardModel, credit?: Credit, id?: string) => string
  /**
   * Bulk import's add (store/useShardImport): a deep copy of the model as a
   * new shard of yours under exactly `name`, nothing selected or opened, with
   * `id` when given (a kit piece's stable id) or a fresh one. The caller has
   * already decided what a taken name means. Its id, and whether it reached
   * storage, which resolves once it has committed (false when storage is
   * full: the shard is in the workshop for now, and gone on a reload); null
   * when `id` is taken.
   */
  addShard: (model: ShardModel, name: string, id?: string) => { id: string; saved: Promise<boolean> } | null
  /** Write the shard list to storage again; resolves with whether every shard in it has committed. */
  saveNow: () => Promise<boolean>
  /**
   * Bulk import's UPDATE: the shard keeps its id, its name and its credit
   * and takes everything drawn from `model`, so PUBLISH AGAIN sends the new
   * version to the same address and every object placing it follows. On the
   * bench, one UNDO brings the old version back. 'missing' when there is no
   * such shard, 'unsaved' when storage refused it. The list changes at once;
   * the answer comes once the write has committed, or failed.
   */
  replaceShard: (id: string, model: ShardModel) => Promise<'saved' | 'unsaved' | 'missing'>
  /**
   * The shard being edited: the current shard, or, inside a placed part
   * (enterPart), that part. Every editing tool works on it; edits to a copy
   * are written into the current shard's own table, and history is the
   * current shard's, so UNDO and REDO reach inside.
   */
  current: () => ShardModel | null
  /** The current shard itself, whatever part is open: what PUBLISH, DEPLOY and the name act on. */
  rootShard: () => ShardModel | null
  /**
   * The parts open in the edit view, outermost first, for the current shard
   * (lib/carried.ts InsideStep). Empty on the shard itself.
   */
  inside: { rootId: string; path: InsideStep[] } | null
  /** The steps of `inside` that still stand for the current shard. */
  insidePath: () => InsideStep[]
  /**
   * Open the placement at `index` of what is being edited: a copy carried in
   * the shard is edited in place; a live link is shown read-only, as its
   * author's event has it, with DETACH. Resolves once it is open, or with a
   * notice when there is nothing to open. `fetch` reaches the relays for a
   * live link (lib/parts.ts fetchRef, passed in: this store is imported by
   * what lib/parts.ts imports).
   */
  enterPart: (index: number, fetch?: (ref: Ref) => Promise<unknown>) => Promise<void>
  /** Back out to `depth` parts deep (0, the shard itself). */
  exitTo: (depth: number) => void
  /** DETACH the open live link: a copy of it under `pubkey`, carried in what places it, and open to edit. */
  detachPart: (pubkey: string) => void
}

/** A shard from wire form (DECK-0003 §1), as PASTE and bulk import read it; null if it is not one. */
export function shardFromText(text: string, id: string): ShardModel | null {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  return fromPayload(raw, id)
}

/** Whose object a model was made from (REMIX): sno-core's, shared with snocrash. */
export { creditOf } from 'sno-core/feed'

/**
 * When each model was last deployed from here: the folder store hands it over
 * (store/useShardFolders.ts). Importing that store here would close a cycle,
 * useShardFolders, useCyberspace, lib/destinationKeys, useShards, useWorkshop,
 * so this store imports no other. Until it does, nothing has been deployed.
 */
let lastUsed: () => Readonly<Record<string, number>> | undefined = () => undefined
export function readLastUsedFrom(read: () => Readonly<Record<string, number>> | undefined): void {
  lastUsed = read
}

/**
 * The object first in the workshop list's order: edited or deployed most
 * recently, by the sort every list uses (lib/shardFolders.ts newestFirst)
 * (2026-10-23). That is the newest wherever it is filed, not the first row
 * drawn: the list draws its folders first, and this one may be in one.
 *
 * The stored list is in the order objects were made, so its first entry is the
 * oldest, and opening that on every fresh load kept bringing back the same old
 * object (arkinox, 2026-09-27).
 */
export function newestId(shards: ShardModel[], used: Readonly<Record<string, number>> | undefined = lastUsed()): string | null {
  return newestFirst(shards, (s) => s.id, (s) => s.updatedAt ?? 0, used)[0]?.id ?? null
}

/**
 * Keep the list: only the shards that changed are written, through
 * store/workshopStorage.ts, which says on the store (`storageError`) when a
 * write fails. Whoever needs to know it landed awaits saveNow().
 */
function save(shards: ShardModel[]): void {
  persist(shards)
}

/**
 * The recent row without the starter swatches nobody picked.
 *
 * The row is colors you have reached for, so it starts empty (arkinox,
 * 2026-09-27). Older builds seeded it with DEFAULT_PALETTE, and a remembered
 * color goes to the front, so the seeds never picked are still at the tail in
 * their seeded order: that run comes off, and anything picked stays.
 */
export function unseeded(list: string[]): string[] {
  let end = list.length
  let next = DEFAULT_PALETTE.length
  while (end > 0) {
    const k = DEFAULT_PALETTE.indexOf(list[end - 1])
    if (k < 0 || k >= next) break
    next = k
    end--
  }
  return list.slice(0, end)
}

function loadPalette(): string[] {
  try {
    const raw = localStorage.getItem(PALETTE_STORAGE)
    const list: unknown = raw ? JSON.parse(raw) : null
    return Array.isArray(list) && list.every((h) => typeof h === 'string' && HEX.test(h)) ? unseeded(list) : []
  } catch { return [] }
}

function loadShowAvatar(): boolean {
  try { return localStorage.getItem(AVATAR_KEY) !== '0' } catch { return true }
}

function savePalette(palette: string[]): void {
  try { localStorage.setItem(PALETTE_STORAGE, JSON.stringify(palette)) } catch { /* quota or private mode */ }
}

/**
 * The selection after a tap or a box: `inside` added to `base`, or taken out
 * of it under INVERT. Sorted and deduped, so a selection built by five little
 * boxes reads the same as one built by hand. Pure, and the same arithmetic for
 * points and for placed objects (arkinox, 2026-10-10, decision A: boxes add,
 * and INVERT makes taps and boxes take away).
 */
export function nextSelection(base: number[], inside: number[], invert: boolean): number[] {
  if (invert) {
    const gone = new Set(inside)
    return [...new Set(base.filter((i) => !gone.has(i)))].sort((a, b) => a - b)
  }
  return [...new Set([...base, ...inside])].sort((a, b) => a - b)
}

/**
 * The selection `indices` asks for, given what is `held` now. A vertex that
 * is new to the selection brings every vertex standing on its point, as a tap
 * does; a vertex already held is kept exactly as it is and never widened.
 *
 * Picking is the one moment a spot's stack is taken whole. Before
 * (arkinox, 2026-10-12) every write widened all of it again, so a rectangle
 * moved down onto a cube's corners took those corners the next time anything
 * rewrote the selection (a box growing, a two-finger pan putting the box
 * back), and the next nudge tore them off the cube. Points that came to share
 * a spot by a move stay apart until the author picks that spot or WELDs.
 * Pure: sorted, deduped, and only real vertices.
 */
export function settleSelection(s: Pick<ShardModel, 'vertices'>, held: readonly number[], indices: readonly number[]): number[] {
  const had = new Set(held)
  const out = new Set<number>()
  for (const i of indices) {
    if (!s.vertices[i]) continue
    if (had.has(i)) out.add(i)
    else for (const j of group(s, i)) out.add(j)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * The selection after a tap on the point vertex `index` stands on. Anything
 * of that point in hand: what is in hand there comes out. Nothing in hand:
 * the whole point goes in. Under INVERT a tap only takes out. A spot is lit
 * when any vertex on it is held, so a tap on a lit spot lets go; it used to
 * ask only about `index`, which the bench sends as the first vertex on the
 * spot, and a lit spot whose held vertex came later took the rest of the
 * stack instead (arkinox, 2026-10-12). Pure.
 */
export function tapSelection(s: Pick<ShardModel, 'vertices'>, held: readonly number[], index: number, invert: boolean): number[] {
  const g = group(s, index)
  const release = invert || g.some((i) => held.includes(i))
  return nextSelection([...held], g, release)
}

/** Every vertex on the same point as vertex `index`, itself included. */
function group(s: Pick<ShardModel, 'vertices'>, index: number): number[] {
  const v = s.vertices[index]
  if (!v) return []
  const key = pointKey(ticksOf(v))
  const out: number[] = []
  s.vertices.forEach((o, i) => { if (pointKey(ticksOf(o)) === key) out.push(i) })
  return out
}

/**
 * A face as the three points it spans, order-free. By points, not vertex
 * indices: two vertices can stand on one spot (a copy, a stamp's own
 * corners), and FILL takes any vertex on a picked point, so by index the
 * same face picked through a twin vertex looked new and landed on top of
 * the old one, where the two fight to be seen.
 */
const faceKey = (s: Pick<ShardModel, 'vertices'>, f: [number, number, number]): string =>
  f.map((i) => (s.vertices[i] ? pointKey(ticksOf(s.vertices[i])) : `#${i}`)).sort().join('|')

type Tri = [number, number, number]
type Tris = Tri[] & { hull?: boolean }

/**
 * Faces for a set of points with no order given. Flat (all on one plane): the
 * points are walked around their centre and the polygon triangulated. Not
 * flat: their convex hull, every triangle outward. Null when they lie on a
 * line. Indices are into `pts`.
 */
function facesFor(pts: P3[]): Tris | null {
  const c: P3 = [0, 0, 0]
  for (const p of pts) for (let a = 0; a < 3; a++) c[a] += p[a] / pts.length
  const n = newell(pts)
  const len = Math.hypot(n[0], n[1], n[2])
  // Distance of every point from the best plane through them.
  const flat = len > 1e-9 && pts.every((p) => Math.abs(((p[0] - c[0]) * n[0] + (p[1] - c[1]) * n[1] + (p[2] - c[2]) * n[2]) / len) < 1e-6)
  if (flat) {
    const u: P3 = Math.abs(n[0]) < 0.9 * len ? [0, n[2], -n[1]] : [n[2], 0, -n[0]]
    const ul = Math.hypot(u[0], u[1], u[2]); u[0] /= ul; u[1] /= ul; u[2] /= ul
    const v: P3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
    const vl = Math.hypot(v[0], v[1], v[2]); v[0] /= vl; v[1] /= vl; v[2] /= vl
    const angle = (p: P3): number => Math.atan2((p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1] + (p[2] - c[2]) * v[2], (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1] + (p[2] - c[2]) * u[2])
    const order = pts.map((p, i) => ({ i, a: angle(p) })).sort((x, y) => x.a - y.a).map((x) => x.i)
    const tris = triangulate(order.map((i) => pts[i]))
    if (!tris) return null
    return tris.map((t) => [order[t[0]], order[t[1]], order[t[2]]] as Tri)
  }
  const hull = new ConvexHull().setFromPoints(pts.map((p) => new Vector3(p[0], p[1], p[2])))
  const at = new Map(pts.map((p, i) => [pointKey(p), i]))
  const out: Tris = []
  for (const face of hull.faces) {
    const corners: number[] = []
    let e = face.edge
    do { corners.push(at.get(pointKey([e.head().point.x, e.head().point.y, e.head().point.z] as P3)) as number); e = e.next } while (e !== face.edge)
    if (corners.length === 3 && corners.every((i) => i !== undefined)) out.push([corners[0], corners[1], corners[2]])
  }
  if (out.length === 0) return null
  out.hull = true
  return out
}

/** Why an edit inside a live link does nothing. */
export const LIVE_LINK_NOTICE = 'A live link follows its author\'s object: DETACH to edit a copy of it here.'

export const useWorkshop = create<WorkshopState>((set, get) => {
  /**
   * Apply an edit to the current shard, remember what it was, stamp it, persist.
   *
   * No size check here or anywhere: the format sets no ceiling on vertices or
   * faces (DECK-0003 §1.8, 2026-09-24), and the event's size is the relay's
   * concern. For one day there was one, after a floor pasted to 516 vertices
   * was refused by every reader; the answer was to drop the limit, not to
   * enforce it earlier.
   */
  const edit = (fn: (s: ShardModel) => ShardModel | null, notice: string | null = null): boolean => {
    const { shards, currentId, past } = get()
    const i = shards.findIndex((s) => s.id === currentId)
    if (i < 0) return false
    // Inside a placed part, the edit is of that part: a copy is written back
    // into this shard's own table (lib/carried.ts writeCopy), a live link is
    // not yours to edit here.
    const path = get().insidePath()
    const top = path[path.length - 1]
    if (top?.live) { set({ notice: LIVE_LINK_NOTICE }); return false }
    const next = fn(top ? focusOf(shards[i], path).model : shards[i])
    if (!next) return false
    const list = shards.slice()
    list[i] = { ...(top ? writeCopy(shards[i], top.address, next) : next), updatedAt: Date.now() }
    const partSel = get().partSel.filter((k) => k < (next.parts?.length ?? 0))
    set({ shards: list, past: [...past.slice(-(HISTORY - 1)), shards[i]], future: [], notice, turnPivot: null, partSel })
    save(list)
    return true
  }

  /** Faces show only in SOLID: a shard's first faces switch it there. */
  const solidIfFirstFaces = (before: ShardModel, after: ShardModel): { mode: ShardMode; notice: string | null } =>
    before.faces.length === 0 && after.faces.length > 0 && before.mode !== 'solid'
      ? { mode: 'solid', notice: 'Switched to SOLID so the faces show. POINTS and LINES are one tap away.' }
      : { mode: after.mode, notice: null }

  /**
   * Points put down in the current shard, selected and ready to be moved, in
   * one undoable step: PASTE's path, and IMPORT's. `exact` puts them where
   * they were taken from, `floor` rests them on the working plane. `as` is
   * IMPORT's: its own line, and the name an empty shard takes.
   */
  const putDown = (clip: ClipPoints, where: PastePlace, self?: string, as?: { notice: string; name?: string }): boolean => {
    const { plane, level } = get()
    const s = get().current()
    if (!s || (clip.points.length === 0 && clip.parts.length === 0)) return false
    // A copy of a shard that places this one would make it place itself;
    // placeObject refuses the same thing in the same words.
    if (self && clip.parts.some((q) => q.ref[1] === self)) { set({ notice: 'An object cannot place itself.' }); return false }
    // A whole shard keeps its true size. Its ticks are its own unit's, so in
    // a shard on another unit they scale about the origin by the difference,
    // and an empty shard, whose unit measures nothing yet, takes the copied
    // one's instead. A placed object's own size is its unit plus its step
    // whatever places it (sno-core partMatrix), so only where it stands moves.
    const whole = clip.unit !== undefined
    const empty = s.vertices.length === 0 && !s.parts?.length
    const unit = whole && empty ? clip.unit! : s.unit
    const k = whole ? clip.unit! - unit : 0
    const points = clip.points.map((q) => ({ at: scaleTicks(q.at, k), c: q.c }))
    const parts = clip.parts.map((q) => ({ ...q, at: scaleTicks(q.at, k) }))
    // Where they came from, to the tick, which is what a copy is for: the
    // shape returns to the place you took it from and the nudges carry it
    // off from there. FLOOR is the other answer: the same shape, slid along
    // the working plane's normal until its lowest point rests on the level
    // the grid is at. Neither one flattens anything.
    let low = Infinity
    for (const q of [...points, ...parts]) low = Math.min(low, q.at[plane])
    const shift = where === 'floor' ? level - low : 0
    const slide = (p: P3): P3 => { const at = [...p] as P3; at[plane] = at[plane] + shift; return at }
    const placed = points.map((q) => ({ at: slide(q.at), c: q.c }))
    const objects = parts.map((q) => ({ ...q, at: slide(q.at) }))
    // A whole shard brings its own grid, so this one grows to hold it, as
    // far as a grid goes. A selection asks first, as it always has.
    let reach = 0
    for (const q of [...placed, ...objects]) for (const n of q.at) reach = Math.max(reach, Math.ceil(Math.abs(n) / TICKS_PER_UNIT))
    const extent = whole ? Math.min(MAX_EXTENT, Math.max(s.extent, reach)) : s.extent
    if (placed.some((q) => !validPoint(q.at, extent)) || objects.some((q) => !validPoint(q.at, extent))) {
      set({ notice: 'Those would land off the grid. Move the level, or grow the grid.' })
      return false
    }
    const base = s.vertices.length
    const firstPart = s.parts?.length ?? 0
    const many = clip.points.length + clip.parts.length > 1
    const added = edit((m) => {
      const pasted = clip.faces.map((f) => f.map((i) => base + i) as [number, number, number])
      const { facecolors: _held, ...bare } = m
      let next: ShardModel = {
        ...bare,
        unit,
        extent,
        vertices: [...m.vertices, ...placed.map((q) => vertexAt(q.at, q.c))],
        faces: [...m.faces, ...pasted],
      }
      // Seams are all or none (sno-core shards): when either side has them
      // every face carries one, and a face that had none keeps the look its
      // corners gave it. Left short, the wire would drop every seam. A side
      // with no faces has no seams, whatever empty list it holds.
      const own = m.faces.length > 0 && m.facecolors && m.facecolors.length === m.faces.length ? m.facecolors : null
      const theirs = clip.faces.length > 0 && clip.facecolors && clip.facecolors.length === clip.faces.length ? clip.facecolors : null
      if (own || theirs) {
        next = {
          ...next,
          facecolors: [
            ...(own ?? m.faces.map((f) => cornerAverage(m, f))),
            ...(theirs ? theirs.map((c) => [...c] as [number, number, number]) : pasted.map((f) => cornerAverage(next, f))),
          ],
        }
      }
      for (const { ref, ...place } of objects) next = addPart(next, ref, place).shard
      // An import into an empty shard is that shard: it takes the file's
      // name, and a point cloud draws as POINTS rather than as one line
      // through every point in file order.
      if (as?.name && empty) next = { ...next, name: as.name.slice(0, 64) }
      if (as && empty && clip.faces.length === 0) return { ...next, mode: 'points' }
      // The first faces switch the shard to SOLID, as a stamp's or FILL's do.
      return { ...next, mode: solidIfFirstFaces(m, next).mode }
    }, as?.notice ?? `${countLabel(clip)} pasted ${where === 'floor' ? 'on the working plane' : 'where they were taken from'}${k ? ', kept at true size' : ''}, selected: move ${many ? 'them' : 'it'} into place.`)
    // The selection is set here rather than through setSelection, which
    // widens to every vertex sharing a point: pasted exactly, the copy sits
    // on its original and widening would take both, so the nudges could
    // never carry the copy off alone.
    if (added) set({ selection: placed.map((_, k) => base + k), partSel: objects.map((_, k) => firstPart + k), selectedFace: null, facePick: [] })
    return added
  }

  return {
    shards: initialShards(),
    storageError: null,
    currentId: null,
    open: false,
    tool: 'view',
    selection: [], partSel: [],
    invert: false,
    facePick: [],
    selectedFace: null,
    clip: null,
    palette: loadPalette(),
    palettes: loadPalettes(),
    level: 0,
    plane: FLOOR,
    division: 1,
    turnPivot: null,
    stampMode: 'shape',
    stampObject: null,
    inside: null,
    showAvatar: loadShowAvatar(),
    color: [0, 0.9, 1],
    stampKind: 'block',
    stampSize: 2,
    stampFacing: 0,
    aim: null,
    past: [],
    future: [],
    notice: null,

    openWorkshop: (id) => {
      const { shards } = get()
      const currentId = id ?? get().currentId ?? newestId(shards) ?? get().create()
      set({ open: true, currentId, selection: [], partSel: [], selectedFace: null, facePick: [], tool: 'view', plane: FLOOR, aim: null, past: [], future: [], notice: null })
    },

    closeWorkshop: () => set({ open: false, selection: [], partSel: [], selectedFace: null, facePick: [], aim: null }),

    create: (name) => {
      const s = newShard(name ?? `Object ${get().shards.length + 1}`)
      const list = [...get().shards, s]
      set({ shards: list, currentId: s.id, selection: [], partSel: [], selectedFace: null, facePick: [], past: [], future: [], notice: null })
      save(list)
      return s.id
    },

    select: (id) => set({ currentId: id, selection: [], partSel: [], selectedFace: null, facePick: [], past: [], future: [], notice: null }),

    rename: (id, name) => {
      const list = get().shards.map((s) => (s.id === id ? { ...s, name: name.slice(0, 64), updatedAt: Date.now() } : s))
      set({ shards: list }); save(list)
    },

    duplicate: (id) => {
      const src = get().shards.find((s) => s.id === id)
      if (!src) return id
      const copy: ShardModel = { ...src, id: uuid(), name: `${src.name} copy`, vertices: src.vertices.map(cloneVertex), faces: src.faces.map((f) => [...f] as [number, number, number]), updatedAt: Date.now() }
      const list = [...get().shards, copy]
      set({ shards: list, currentId: copy.id, selection: [], partSel: [], selectedFace: null, facePick: [], past: [], future: [], notice: null }); save(list)
      return copy.id
    },

    remove: (id) => {
      const list = get().shards.filter((s) => s.id !== id)
      const currentId = get().currentId === id ? newestId(list) : get().currentId
      set({ shards: list, currentId, selection: [], partSel: [], selectedFace: null, facePick: [], past: [], future: [], notice: null }); save(list)
    },

    removeMany: (ids) => {
      const out = new Set(ids)
      const { shards, currentId } = get()
      let list = shards.filter((s) => !out.has(s.id))
      if (list.length === shards.length) return Promise.resolve(true)
      const stamp = get().stampObject
      const stampGone = !!stamp && (out.has(stamp.shard.id) || (stamp.ref[0] === 'a' && out.has(stamp.ref[1].split(':').slice(2).join(':'))))
      const stampState = stampGone ? { stampObject: null } : {}
      if (currentId === null || !out.has(currentId)) { set({ shards: list, ...stampState }); save(list); return saveStored() }
      let next = newestId(list)
      // Nothing left while the workshop is open: a new empty shard, as opening an empty workshop makes one.
      if (next === null && get().open) {
        const s = newShard(`Object ${list.length + 1}`)
        list = [...list, s]
        next = s.id
      }
      set({ shards: list, currentId: next, selection: [], partSel: [], selectedFace: null, facePick: [], past: [], future: [], notice: null, ...stampState }); save(list)
      return saveStored()
    },

    setMode: (mode) => edit((s) => ({ ...s, mode })),
    setOpacity: (percent) => edit((s) => withOpacity(s, percent)),
    // Already so: no edit, so no undo step that changes nothing.
    setConstrain: (c) => edit((s) => (authoredConstrainOf(s) === c ? null : withConstrain(s, c))),
    setUnit: (unit) => edit((s) => ({ ...s, unit: clampUnit(unit) })),
    // FACE works on corners it picks itself, and its panel only appears with
    // nothing else selected, so a point still held from SELECT hid FILL behind
    // it and the tool looked broken. Taking the tool clears the selection.
    // INVERT goes off with the tool too: it is a mode of SELECT and FACE, and
    // the key that shows it is only drawn there.
    setTool: (tool) => set({ tool, facePick: [], selectedFace: null, aim: null, invert: false, ...(tool === 'face' ? { selection: [], partSel: [] } : {}) }),
    setInvert: (on) => set({ invert: on }),
    setExtent: (extent) => {
      const s = get().current()
      if (!s) return
      const e = Math.max(Math.max(MIN_EXTENT, neededExtent(s)), Math.min(MAX_EXTENT, Math.round(extent)))
      if (e === s.extent) return
      edit((cur) => ({ ...cur, extent: e }))
      set({ level: Math.max(-e * TICKS_PER_UNIT, Math.min(e * TICKS_PER_UNIT, get().level)) })
    },
    setPlane: (plane) => set({ plane, aim: null }),
    setLevel: (level) => {
      const e = (get().current()?.extent ?? GRID_HALF) * TICKS_PER_UNIT
      set({ level: Math.max(-e, Math.min(e, Math.round(level))) })
    },
    setDivision: (division) => { if (DIVISIONS.includes(division)) set({ division }) },
    setShowAvatar: (on) => { set({ showAvatar: on }); try { localStorage.setItem(AVATAR_KEY, on ? '1' : '0') } catch { /* private mode */ } },
    step: () => TICKS_PER_UNIT / get().division,
    setColor: (c) => set({ color: clampColor(c) }),
    setStampKind: (stampKind) => set({ stampKind, stampMode: 'shape' }),
    setStampSize: (size) => set({ stampSize: Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size))) }),
    turnStamp: () => set({ stampFacing: ((get().stampFacing + 1) % 4) as Facing }),

    setAim: (p) => {
      const a = get().aim
      if (a === p || (a && p && a[0] === p[0] && a[1] === p[1] && a[2] === p[2])) return
      set({ aim: p })
    },

    setStampMode: (stampMode) => set({ stampMode }),
    setStampObject: (stampObject) => set({ stampObject, stampMode: 'object' }),

    placeObject: (at, self) => {
      const { stampObject, stampFacing } = get()
      const s = get().current()
      if (!s || !validPoint(at, s.extent)) return
      if (!stampObject) { set({ notice: 'Choose an object to stamp first: tap the slot under OBJECT.' }); return }
      if ((self && stampObject.ref[1] === self) || stampObject.copy?.sourceId === s.id) { set({ notice: 'An object cannot place itself.' }); return }
      // From YOURS, a copy goes inside this shard, of the piece as it is now.
      let base = s
      let ref = stampObject.ref
      if (stampObject.copy) {
        const source = get().shards.find((x) => x.id === stampObject.copy!.sourceId) ?? stampObject.shard
        ;({ shard: base, ref } = copyInto(s, source, stampObject.copy.pubkey))
      }
      const { shard } = addPart(base, ref, { at: [...at] as P3, turn: [0, (90 * stampFacing) % 360, 0], step: 0 })
      edit(() => shard, `"${stampObject.name}" placed. It is one object: SELECT it to move, turn or copy it.`)
      set({ selection: [], partSel: [], selectedFace: null, facePick: [] })
    },

    placeStamp: (at) => {
      const { stampKind, stampSize, stampFacing, color, plane } = get()
      const s = get().current()
      if (!s || !validPoint(at, s.extent)) return
      const res = stamp(s, stampKind, stampSize, stampFacing, at, color, plane)
      if (!res) { set({ notice: 'That stamp could not be placed here.' }); return }
      const { mode, notice } = solidIfFirstFaces(s, res.shard)
      // sno-core's stamp keeps the faces it does not cull, in order and on
      // their own corners, and puts its own after them on corners past the
      // old ones; it knows nothing of seams, so they are carried here.
      const base = s.vertices.length
      let k = 0
      const from = res.shard.faces.map((f) => {
        if (f.some((v) => v >= base)) return -1
        while (k < s.faces.length && !s.faces[k].every((v, n) => v === f[n])) k++
        // Not found is not expected, but it costs that face its seam, never the stamp.
        return k < s.faces.length ? k++ : -1
      })
      edit(() => ({ ...seamsFollow(s, res.shard, from), mode }), notice)
      set({ selection: [], partSel: [], selectedFace: null, facePick: [] })
    },

    addVertex: (p) => {
      if (!validPoint(p, get().current()?.extent ?? GRID_HALF)) return
      let added = -1
      edit((s) => {
        // One vertex per point by hand: adding where one already is selects it instead.
        const existing = s.vertices.findIndex((v) => pointKey(ticksOf(v)) === pointKey(p))
        if (existing >= 0) { added = existing; return null }
        added = s.vertices.length
        return { ...s, vertices: [...s.vertices, vertexAt(p, [...get().color] as ShardVertex['c'])] }
      })
      if (added >= 0) set({ selection: group(get().current()!, added), selectedFace: null })
    },

    selectVertex: (index) => {
      const s = get().current()
      set({ selection: index === null || !s ? [] : group(s, index), partSel: [], selectedFace: null })
    },

    selectPart: (index) => {
      const s = get().current()
      set({ partSel: index === null || !s?.parts?.[index] ? [] : [index], selection: [], selectedFace: null })
    },

    togglePart: (index) => {
      const s = get().current()
      if (!s?.parts?.[index]) return
      const { partSel, invert } = get()
      // Under INVERT a tap only takes an object out; one not in hand is left alone.
      set({ partSel: nextSelection(partSel, [index], invert || partSel.includes(index)), selectedFace: null })
    },

    setPartSelection: (indices) => {
      const s = get().current()
      set({ partSel: [...new Set(indices.filter((i) => s?.parts?.[i]))].sort((a, b) => a - b) })
    },

    toggleVertex: (index) => {
      const s = get().current()
      if (!s || !s.vertices[index]) return
      const { selection, invert } = get()
      // The whole point goes in, or what is held of it comes out. Under INVERT
      // a tap only takes a point out; one not in hand is left alone, never added.
      set({ selection: tapSelection(s, selection, index, invert), selectedFace: null })
    },

    setSelection: (indices) => {
      const s = get().current()
      if (!s) { set({ selection: [] }); return }
      // Only what is new to the selection is widened to whole points
      // (settleSelection): a box growing or a pan putting it back rewrites
      // the held vertices as they are.
      set({ selection: settleSelection(s, get().selection, indices), selectedFace: null })
    },

    selectConnected: () => {
      const s = get().current()
      const { selection } = get()
      if (!s || selection.length === 0) return
      const out = connectedTo(s, selection)
      const grew = out.length > selection.length
      set({ selection: out, selectedFace: null, notice: grew ? `${new Set(out.map((i) => pointKey(ticksOf(s.vertices[i])))).size} points connected by faces.` : 'Nothing else is joined to the selection by faces.' })
    },

    selectFace: (index) => {
      if (index === null) { set({ selectedFace: null }); return }
      const s = get().current()
      const f = s?.faces[index]
      if (!s || !f) return
      // A face is its corners: picking it puts them in the selection (every
      // vertex on each corner's point, as a point tap does), so the pad moves
      // and turns the face as one thing. Picking a face whose corners are all
      // in hand already takes them back out (arkinox, 2026-10-10: selecting a
      // face should let you move it; before, it emptied the selection). Under
      // INVERT a tap on a face takes its corners out whatever was held, and
      // selects no face: it is taking away, not picking.
      const corners = [...new Set(f.flatMap((v) => group(s, v)))]
      const { selection: sel, invert } = get()
      const release = invert || corners.every((i) => sel.includes(i))
      set({
        selectedFace: release ? null : index,
        selection: nextSelection(sel, corners, release),
      })
    },

    deleteSelectedFace: () => {
      const { selectedFace } = get()
      if (selectedFace === null) return
      get().removeFace(selectedFace)
      set({ selectedFace: null })
    },

    flipSelectedFace: () => {
      const { selectedFace } = get()
      if (selectedFace === null) return
      edit((s) => (s.faces[selectedFace] ? flipFace(s, selectedFace) : null), 'Face turned round.')
    },

    flipSelectedSurface: () => {
      const { selectedFace } = get()
      if (selectedFace === null) return
      edit((s) => (s.faces[selectedFace] ? flipSurface(s, selectedFace) : null), 'Surface turned round.')
    },

    autoWind: () => {
      edit((s) => (s.faces.length ? windOutward(s) : null), 'Every face turned to look outward.')
    },

    /**
     * A hard colour on one face.
     *
     * Colouring a face's three corners is not the same thing: a corner belongs
     * to every face that touches it, so the colour bleeds across every shared
     * edge. A face colour is carried per face (DECK-0003 §1.4a) and stops at
     * the edge, which is what makes a crisp seam possible at all.
     *
     * The first one fills the rest of the list from what each face already
     * looks like, the average of its corners, so turning one face hard leaves
     * every other face looking exactly as it did.
     */
    colorFace: (index, c) => {
      set({ color: clampColor(c) })
      edit((s) => {
        if (!s.faces[index]) return null
        const current = s.facecolors && s.facecolors.length === s.faces.length
          ? s.facecolors
          : s.faces.map((f) => {
            const sum = f.reduce((acc, i) => {
              const v = s.vertices[i]
              return v ? [acc[0] + v.c[0], acc[1] + v.c[1], acc[2] + v.c[2]] : acc
            }, [0, 0, 0])
            return sum.map((n) => n / 3) as [number, number, number]
          })
        const facecolors = current.slice()
        facecolors[index] = clampColor(c)
        return { ...s, facecolors }
      }, 'That face keeps its own color now.')
    },

    clearFaceColors: () => {
      edit((s) => (s.facecolors ? { ...s, facecolors: undefined } : null), 'Faces blend across their corners again.')
    },

    savePalette: (name, colors, event) => {
      const id = uuid()
      const list = [...get().palettes, { id, name: name.trim().slice(0, 48) || 'untitled', colors, ...(event ? { event } : {}) }]
      set({ palettes: list })
      savePalettes(list)
      return id
    },

    notePalettePublished: (id, event) => {
      const list = get().palettes.map((p) => (p.id === id ? { ...p, event } : p))
      set({ palettes: list })
      savePalettes(list)
    },

    renamePalette: (id, name) => {
      const list = get().palettes.map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, 48) || p.name } : p))
      set({ palettes: list })
      savePalettes(list)
    },

    forgetPalette: (id) => {
      const list = get().palettes.filter((p) => p.id !== id)
      set({ palettes: list })
      savePalettes(list)
      // A shard still on it keeps its colours: the palette is carried on the
      // model, so forgetting the name does not take the colours away.
    },

    /**
     * Move the current shard onto another palette, keeping every index.
     *
     * This is what an indexed format has always meant by switching palettes:
     * the indices stay and what they name changes, so the object looks
     * different afterwards. The face colours move with the vertices, and the
     * current colour moves too, so the swatch under the cursor still points at
     * the same slot it did before.
     */
    usePalette: (id) => {
      const next = id === null ? undefined : get().palettes.find((p) => p.id === id)?.colors
      const nextName = id === null ? undefined : get().palettes.find((p) => p.id === id)?.name
      if (id !== null && !next) return
      edit((s) => {
        const from = s.palette ?? BUILT_IN
        const to = next ?? BUILT_IN
        if (samePalette(s.palette, next)) return null
        const moved = remap(s.vertices.map((v) => v.c), from, to)
        return {
          ...s,
          vertices: s.vertices.map((v, i) => ({ ...v, c: moved[i] })),
          ...(s.facecolors ? { facecolors: remap(s.facecolors, from, to) } : {}),
          palette: next,
          paletteName: nextName,
        }
      }, next ? `Now on "${nextName}". Every color kept its index.` : 'Back on the built-in palette. Every color kept its index.')
      // The colour in hand follows the same rule as everything else.
      const s = get().current()
      if (s) {
        const hex = snapHex(s.palette ?? BUILT_IN, rgbToHex(get().color))
        if (hex) set({ color: hexToRgb(hex) })
      }
    },

    rememberColor: (hex) => {
      const snapped = snapHex(BUILT_IN, hex)
      if (!snapped) return
      const h = snapped.toLowerCase()
      if (!HEX.test(h)) return
      const palette = [h, ...get().palette.filter((x) => x !== h)].slice(0, PALETTE_MAX)
      set({ palette }); savePalette(palette)
    },

    sampleColor: () => {
      const { selection, selectedFace, tool } = get()
      const s = get().current()
      if (!s) return
      // A selected face is sampled as a face whenever it is in hand: in FACE
      // its corners are selected with it, so the selection is never empty
      // there (arkinox, 2026-10-12: "the face tool has no sample dropper for
      // the selected face; if I have a face with a seam I will want to sample it").
      const asFace = selectedFace !== null && (selection.length === 0 || tool === 'face')
      const corners = asFace ? s.faces[selectedFace!] ?? [] : selection.length === 1 ? selection : []
      // A face with a hard color (SEAM) shows that color, so that is what the
      // dropper takes. Face colors are all or none (sno-core shards): once one
      // face has a seam, every face carries its own.
      const seam = asFace && s.facecolors?.length === s.faces.length ? s.facecolors[selectedFace!] : undefined
      const cs = seam ? [seam] : corners.map((i) => s.vertices[i]?.c).filter((c): c is P3 => !!c)
      if (cs.length === 0) return
      const mean = [0, 1, 2].map((k) => cs.reduce((t, c) => t + c[k], 0) / cs.length) as P3
      const hex = snapHex(s.palette ?? BUILT_IN, rgbToHex(clampColor(mean)))
      if (!hex) return
      set({ color: hexToRgb(hex) })
      get().rememberColor(hex)
    },

    forgetColor: (hex) => {
      const palette = get().palette.filter((x) => x !== hex.toLowerCase())
      set({ palette }); savePalette(palette)
    },

    moveSelected: (axis, delta) => {
      const { selection, partSel } = get()
      if (selection.length === 0 && partSel.length === 0) return
      edit((s) => {
        // Every selected point and placed object moves the same unit; if any
        // would leave the grid the whole move is refused, so a shape never tears.
        const chosen = new Set(selection.filter((i) => s.vertices[i]))
        const placed = new Set(partSel.filter((i) => s.parts?.[i]))
        if (chosen.size === 0 && placed.size === 0) return null
        const vertices = s.vertices.slice()
        for (const i of chosen) {
          const p = ticksOf(vertices[i])
          p[axis] += delta
          if (!validPoint(p, s.extent)) return null
          vertices[i] = vertexAt(p, vertices[i].c)
        }
        const parts = (s.parts ?? []).slice()
        for (const i of placed) {
          const at = [...parts[i].at] as P3
          at[axis] += delta
          if (!validPoint(at, s.extent)) return null
          parts[i] = { ...parts[i], at }
        }
        return placed.size ? { ...s, vertices, parts } : { ...s, vertices }
      })
    },

    rotateSelected: (turns) => {
      const { selection, partSel, turnPivot, plane } = get()
      const s = get().current()
      if (!s || (selection.length === 0 && partSel.length === 0)) return
      const step = get().step()
      const chosen = [...new Set(selection.filter((i) => s.vertices[i]))]
      const placed = [...new Set(partSel.filter((i) => s.parts?.[i]))]
      if (chosen.length === 0 && placed.length === 0) return
      // A placed object turns about the same pivot as the points, from where it
      // stands: its origin counts toward the pivot like a point does.
      const pts = [...chosen.map((i) => ticksOf(s.vertices[i])), ...placed.map((i) => [...s.parts![i].at] as P3)]
      // The same selection turned again turns about the same point; any other
      // edit forgets it (edit() clears it), and so does a change of DIVISION.
      // The plane is part of the key: turning, tipping the grid on its side and
      // turning again are two different turns about two different axes.
      const axes = turnAxes(plane)
      const key = `${step}:${plane}:${[...chosen].sort((a, b) => a - b).join(',')}:${placed.join(',')}`
      const at = turnPivot?.key === key ? turnPivot.at : turnPivotFor(pts, step, axes)
      const [ca, cb] = at
      const [ax, bx] = axes
      let refused = false
      edit((m) => {
        const vertices = m.vertices.slice()
        chosen.forEach((i, k) => {
          // Only the two axes in the plane move; the one along its normal is
          // what the turn goes around, so a point never leaves the plane it
          // was built on.
          const p = [...pts[k]] as P3
          const da = pts[k][ax] - ca, db = pts[k][bx] - cb
          p[ax] = turns === 1 ? ca - db : ca + db
          p[bx] = turns === 1 ? cb + da : cb - da
          if (!validPoint(p, m.extent)) refused = true
          vertices[i] = vertexAt(p, vertices[i].c)
        })
        // Each placed object swings about the pivot and takes the same quarter
        // turn itself (sno-core quarterTurnPart), so it turns with the points.
        const parts = (m.parts ?? []).slice()
        for (const i of placed) {
          const q = turns === 1 ? quarterTurnPart(parts[i], ax, bx, [ca, cb]) : quarterTurnPart(parts[i], bx, ax, [cb, ca])
          if (!q || !validPoint(q.at, m.extent)) { refused = true; continue }
          parts[i] = q
        }
        return refused ? null : placed.length ? { ...m, vertices, parts } : { ...m, vertices }
      })
      if (refused) set({ notice: 'That turn would carry a point or an object off the grid.' })
      else set({ turnPivot: { key, at } })
    },

    colorSelected: (c) => {
      const { selection, selectedFace } = get()
      set({ color: clampColor(c) })
      get().rememberColor(rgbToHex(clampColor(c)))
      // With no points selected, a selected face takes the color for its corners.
      const face = selection.length === 0 && selectedFace !== null ? get().current()?.faces[selectedFace] : undefined
      if (selection.length === 0 && !face) return
      edit((s) => {
        const chosen = new Set((face ?? selection).filter((i) => s.vertices[i]))
        if (chosen.size === 0) return null
        const vertices = s.vertices.slice()
        for (const i of chosen) vertices[i] = { ...vertices[i], c: clampColor(c) }
        return { ...s, vertices }
      })
    },

    colorAll: (c) => {
      set({ color: clampColor(c) })
      get().rememberColor(rgbToHex(clampColor(c)))
      edit((s) => ({ ...s, vertices: s.vertices.map((v) => ({ ...v, c: clampColor(c) })) }))
    },

    // The whole piece you are pointing at, without having to select it first.
    // The selection is left alone on purpose: this paints a group, it does not
    // take one, and growing the selection underneath would move every later
    // nudge and delete onto vertices nobody asked for.
    colorConnected: (c) => {
      const { selection } = get()
      set({ color: clampColor(c) })
      get().rememberColor(rgbToHex(clampColor(c)))
      if (selection.length === 0) return
      edit((s) => {
        const reach = connectedTo(s, selection)
        if (reach.length === 0) return null
        const chosen = new Set(reach)
        const vertices = s.vertices.map((v, i) => (chosen.has(i) ? { ...v, c: clampColor(c) } : v))
        return { ...s, vertices }
      })
    },

    deleteSelected: () => {
      const { selection, partSel } = get()
      if (selection.length === 0 && partSel.length === 0) return
      edit((before) => {
        // Selected placed objects go first; references nothing places any more go with them.
        const s = partSel.length ? removeParts(before, partSel) : before
        // Every selected vertex goes; faces that used any of them go; the rest renumber.
        const gone = new Set(selection.filter((i) => s.vertices[i]))
        if (gone.size === 0) return s === before ? null : s
        const remap = new Map<number, number>()
        s.vertices.forEach((_, i) => { if (!gone.has(i)) remap.set(i, remap.size) })
        const kept = s.faces.map((_, i) => i).filter((i) => !s.faces[i].some((v) => gone.has(v)))
        const faces = kept.map((i) => s.faces[i].map((v) => remap.get(v) as number) as [number, number, number])
        return seamsFollow(s, { ...s, vertices: s.vertices.filter((_, i) => !gone.has(i)), faces }, kept)
      })
      set({ selection: [], partSel: [], selectedFace: null, facePick: [] })
    },

    weld: () => {
      const s = get().current()
      if (!s) return
      const { selection } = get()
      const res = weld(s, selection.length >= 2 ? new Set(selection) : undefined)
      if (!res) { set({ notice: 'Nothing to weld: no two points stand on the same spot.' }); return }
      const n = res.shard.vertices.length
      edit(() => res.shard, `${res.merged} point${res.merged === 1 ? '' : 's'} welded${res.colored ? ', and the faces keep their own colors now' : ''}. ${n} vert${n === 1 ? 'ex' : 'ices'}.`)
      set({ selection: [], partSel: [], selectedFace: null, facePick: [] })
    },

    cutSelection: () => {
      const s = get().current()
      const clip = s ? clipOf(s, get().selection, get().partSel) : null
      if (!clip) return
      set({ clip })
      get().deleteSelected()
      set({ notice: `${countLabel(clip)} cut. PASTE asks where to put ${clip.points.length === 1 ? 'it' : 'them'} back.` })
    },

    copySelection: () => {
      const s = get().current()
      const clip = s ? clipOf(s, get().selection, get().partSel) : null
      if (!clip) return
      set({ clip, notice: `${countLabel(clip)} copied. PASTE puts ${clip.points.length === 1 ? 'it' : 'them'} down, on any tool.` })
    },

    clearClip: () => set({ clip: null }),

    duplicateSelection: () => {
      const s = get().current()
      const clip = s ? clipOf(s, get().selection, get().partSel) : null
      if (!clip) return
      set({ clip })
      get().pasteClip('exact')
    },

    copyShard: (model) => {
      const clip = clipOf(model, model.vertices.map((_, i) => i), (model.parts ?? []).map((_, i) => i))
      if (!clip) return false
      set({ clip: { ...clip, unit: model.unit }, notice: `Copied "${model.name}". PASTE puts it in any shard.` })
      return true
    },

    pasteClip: (where = 'exact', self) => {
      const { clip } = get()
      if (clip) putDown(clip, where, self)
    },

    insertImport: (model, notice, self) => {
      const s = get().current()
      if (!s) return false
      const clip = clipOf(model, model.vertices.map((_, i) => i))
      if (!clip) { set({ notice: 'That file has nothing in it to put down.' }); return false }
      // A whole shard on this shard's own unit: the converter fitted it to
      // this grid already, so it pastes tick for tick and the grid grows
      // only if the level pushes it past the edge.
      return putDown({ ...clip, unit: s.unit }, 'floor', self, { notice, name: model.name })
    },

    pickForFace: (index) => {
      const s = get().current()
      const { facePick } = get()
      if (!s || !s.vertices[index]) return
      // Picks are points, not vertices: any vertex on a picked point counts as that pick.
      const key = pointKey(ticksOf(s.vertices[index]))
      const at = facePick.findIndex((i) => pointKey(ticksOf(s.vertices[i])) === key)
      // Tapping the first corner again closes the loop.
      if (at === 0 && facePick.length >= 3) { get().fill(); return }
      if (at >= 0) { set({ facePick: facePick.filter((_, i) => i !== at), selectedFace: null }); return }
      set({ facePick: [...facePick, index], selectedFace: null })
    },

    clearFacePick: () => set({ facePick: [] }),

    fill: () => {
      const s = get().current()
      const { facePick } = get()
      if (!s || facePick.length < 3) return
      const tris = triangulate(facePick.map((i) => ticksOf(s.vertices[i])))
      if (!tris) { set({ notice: 'Those corners do not make a face. Pick them in order around its edge.' }); return }
      // Corners that already make faces add nothing; said, so the tap is not lost in silence.
      const added = edit((cur) => {
        const have = new Set(cur.faces.map((f) => faceKey(cur, f)))
        const faces = tris
          .map((t) => [facePick[t[0]], facePick[t[1]], facePick[t[2]]] as [number, number, number])
          .filter((f) => validFace(f, cur.vertices.length) && !have.has(faceKey(cur, f)))
        if (!faces.length) return null
        // Wound outward, or to agree with a face it closes onto (sno-core winding).
        const next = windAdded({ ...cur, faces: [...cur.faces, ...faces] }, cur.faces.length)
        return { ...seamsFollow(cur, next, appended(cur, next)), mode: solidIfFirstFaces(cur, next).mode }
      }, solidIfFirstFaces(s, { ...s, faces: [[0, 0, 0]] }).notice)
      set(added ? { facePick: [] } : { facePick: [], notice: 'Those faces are already there.' })
    },

    fillSelection: () => {
      const s = get().current()
      const { selection } = get()
      if (!s) return
      // One vertex per point, so a shared point counts once.
      const firstAt = new Map<string, number>()
      for (const i of selection) { const v = s.vertices[i]; if (v && !firstAt.has(pointKey(ticksOf(v)))) firstAt.set(pointKey(ticksOf(v)), i) }
      const idx = [...firstAt.values()]
      if (idx.length < 3) { set({ notice: 'Select three or more points to fill.' }); return }
      const pts = idx.map((i) => ticksOf(s.vertices[i]))
      const faces = facesFor(pts)
      if (!faces) { set({ notice: 'Those points do not make a face: they lie on one line.' }); return }
      const before = s.faces.length
      edit((cur) => {
        const have = new Set(cur.faces.map((f) => faceKey(cur, f)))
        const fresh = faces
          .map((t) => [idx[t[0]], idx[t[1]], idx[t[2]]] as [number, number, number])
          .filter((f) => validFace(f, cur.vertices.length) && !have.has(faceKey(cur, f)))
        if (!fresh.length) return null
        // Wound outward, on the wire where the front is read (DECK-0003 §1.4),
        // or to agree with a face it closes onto. Measured in model ticks, as
        // this once was, outward came out inward: the model frame is a mirror.
        const next = windAdded({ ...cur, faces: [...cur.faces, ...fresh] }, cur.faces.length)
        return { ...seamsFollow(cur, next, appended(cur, next)), mode: solidIfFirstFaces(cur, next).mode }
      })
      const added = (get().current()?.faces.length ?? before) - before
      set({ notice: added ? `${added} face${added === 1 ? '' : 's'} ${faces.hull ? 'around' : 'across'} ${idx.length} points.` : 'Those faces are already there.' })
    },

    subdivideSelection: () => {
      const s = get().current()
      const { selection } = get()
      if (!s || selection.length === 0) return
      const res = subdivide(s, selection)
      if ('refused' in res) { set({ notice: res.refused }); return }
      edit(() => res.shard, subdivideNotice(res))
      // Whole points, as every selection is, so a midpoint that landed on an
      // occupied spot is in hand with what stands there.
      get().setSelection([...res.corners, ...res.added])
    },

    removeFace: (index) => edit((s) => {
      if (!s.faces[index]) return null
      const kept = s.faces.map((_, i) => i).filter((i) => i !== index)
      return seamsFollow(s, { ...s, faces: kept.map((i) => s.faces[i]) }, kept)
    }),

    // Everything drawn goes, placements included (their refs with them); undo brings it back.
    clearShard: () => { edit((s) => { const { refs: _r, parts: _p, facecolors: _f, ...rest } = s; return { ...rest, vertices: [], faces: [] } }); set({ selection: [], partSel: [], selectedFace: null, facePick: [] }) },

    undo: () => {
      const { past, shards, currentId } = get()
      const i = shards.findIndex((s) => s.id === currentId)
      if (i < 0 || !past.length) return
      const list = shards.slice()
      list[i] = past[past.length - 1]
      set({ shards: list, past: past.slice(0, -1), future: [...get().future, shards[i]], selection: [], partSel: [], selectedFace: null, facePick: [], notice: null })
      save(list)
    },

    redo: () => {
      const { future, shards, currentId } = get()
      const i = shards.findIndex((s) => s.id === currentId)
      if (i < 0 || !future.length) return
      const list = shards.slice()
      list[i] = future[future.length - 1]
      set({ shards: list, future: future.slice(0, -1), past: [...get().past, shards[i]], selection: [], partSel: [], selectedFace: null, facePick: [], notice: null })
      save(list)
    },

    exportCurrent: () => {
      const s = get().current()
      return s ? JSON.stringify(toPayload(s)) : null
    },

    importText: (text) => {
      const read = shardFromText(text, uuid())
      if (!read) return null
      // Text nobody signed: nothing it carries is trusted (lib/carried.ts noTable).
      const s = noTable(read)
      const list = [...get().shards, s]
      set({ shards: list, currentId: s.id, selection: [], partSel: [], selectedFace: null, facePick: [], past: [], future: [], notice: null })
      save(list)
      return s.id
    },

    importShard: (given, credit, id) => {
      // A copy from the feed, a bag, a chest or an avatar: what it carries comes
      // in only when you signed the event it was read from (lib/carried.ts
      // signedTableOnly), so a key someone else wrote under your name is never
      // published again as yours.
      const model = signedTableOnly(given, you())
      const taken = new Set(get().shards.map((s) => s.name))
      // Your own object comes back under its own name: there is no other to be a copy of.
      const name = !id && taken.has(model.name) ? `${model.name} copy` : model.name
      const base: ShardModel = { ...model, id: id ?? uuid(), name, vertices: model.vertices.map(cloneVertex), faces: model.faces.map((f) => [...f] as [number, number, number]), updatedAt: Date.now() }
      const copy: ShardModel = credit ? withCredit(base, credit) : base
      const list = [...get().shards, copy]
      set({ shards: list }); save(list)
      return copy.id
    },

    addShard: (given, name, id) => {
      if (id !== undefined && get().shards.some((s) => s.id === id)) return null
      // An import (a file, a zip): nobody signed it, so nothing it carries is trusted.
      const model = noTable(given)
      const copy: ShardModel = { ...model, id: id ?? uuid(), name: name.slice(0, 64), vertices: model.vertices.map(cloneVertex), faces: model.faces.map((f) => [...f] as [number, number, number]), updatedAt: Date.now() }
      const list = [...get().shards, copy]
      set({ shards: list })
      save(list)
      return { id: copy.id, saved: saveStored() }
    },

    saveNow: () => saveStored(),

    replaceShard: (id, given) => {
      // An import's UPDATE: nobody signed it, so nothing it carries is trusted.
      const model = noTable(given)
      const { shards, currentId, past } = get()
      const i = shards.findIndex((s) => s.id === id)
      if (i < 0) return Promise.resolve('missing')
      const old = shards[i]
      const { credit: _drop, ...drawn } = model as ShardModel & { credit?: unknown }
      const kept = (old as ShardModel & { credit?: unknown }).credit
      const next = {
        ...drawn,
        id: old.id,
        name: old.name,
        vertices: model.vertices.map(cloneVertex),
        faces: model.faces.map((f) => [...f] as [number, number, number]),
        updatedAt: Date.now(),
        ...(kept !== undefined ? { credit: kept } : {}),
      } as ShardModel
      // A file that says nothing about WALK (a kit exported again from a 3D
      // tool) keeps the word the bench's author chose: an OFF or ALL set here
      // survives the update (DECK-0003 §1.12). A word in the file wins.
      const chose = chosenConstrainOf(old)
      const walk = chose && !chosenConstrainOf(next) ? withConstrain(next, chose) : next
      const list = shards.slice()
      list[i] = walk
      // On the bench it is an edit like any other: UNDO brings the old one back.
      if (id === currentId) set({ shards: list, past: [...past.slice(-(HISTORY - 1)), old], future: [], selection: [], partSel: [], selectedFace: null, facePick: [] })
      else set({ shards: list })
      save(list)
      return saveStored().then((ok) => (ok ? 'saved' : 'unsaved'))
    },

    current: () => {
      const root = get().rootShard()
      const inside = get().inside
      if (!root || !inside || inside.rootId !== root.id || inside.path.length === 0) return root
      return focusOf(root, inside.path).model
    },

    rootShard: () => get().shards.find((s) => s.id === get().currentId) ?? null,

    insidePath: () => {
      const root = get().rootShard()
      const inside = get().inside
      if (!root || !inside || inside.rootId !== root.id) return []
      return focusOf(root, inside.path).path
    },

    enterPart: async (index, fetch) => {
      const root = get().rootShard()
      const at = get().current()
      const part = at?.parts?.[index]
      const ref = part ? at?.refs?.[part.ref] : undefined
      if (!root || !ref) return
      const path = get().insidePath()
      const open = (step: InsideStep): void => set({ inside: { rootId: root.id, path: [...path, step] }, selection: [], partSel: [], selectedFace: null, facePick: [], notice: null })
      if (ref[0] === 'a' && carriedCopy(root, ref[1])) { open({ address: ref[1] }); return }
      // A live link: what its author's event holds, read-only.
      const answer = fetch ? await fetch(ref) : null
      // By `e`, the fetch says whose event it is (sno-core Fetched); by `a`, the address does.
      const payload = answer instanceof Fetched ? answer.payload : answer
      const read = payload == null ? null : fromPayload(payload, ref[1])
      const live = read && keepOwnTable(read, answer instanceof Fetched ? answer.pubkey : parseAddress(ref[1])?.pubkey)
      if (!live) { set({ notice: 'That object did not come back from the relays, so there is nothing to open.' }); return }
      if (get().rootShard() !== root) return
      open({ address: ref[1], live: { ...live, id: ref[1].split(':').slice(2).join(':') || ref[1] } })
    },

    exitTo: (depth) => {
      const root = get().rootShard()
      if (!root) return
      const path = get().insidePath().slice(0, Math.max(0, depth))
      set({ inside: path.length ? { rootId: root.id, path } : null, selection: [], partSel: [], selectedFace: null, facePick: [], notice: null })
    },

    detachPart: (pubkey) => {
      const { shards, currentId, past } = get()
      const i = shards.findIndex((s) => s.id === currentId)
      if (i < 0 || !pubkey) return
      const done = detachInto(shards[i], get().insidePath(), pubkey)
      if (!done) return
      const list = shards.slice()
      list[i] = { ...done.root, updatedAt: Date.now() }
      // One edit of the shard: UNDO puts the link back.
      set({ shards: list, past: [...past.slice(-(HISTORY - 1)), shards[i]], future: [], inside: { rootId: shards[i].id, path: done.path }, selection: [], partSel: [], selectedFace: null, facePick: [], notice: 'Detached: this is your copy now, carried inside the shard. Edit it here.' })
      save(list)
    },
  }
})

attach({
  shards: () => useWorkshop.getState().shards,
  replace: (list) => useWorkshop.setState((s) => ({
    shards: list,
    // A shard that is gone cannot stay the one on the bench.
    currentId: s.currentId !== null && !list.some((x) => x.id === s.currentId) ? null : s.currentId,
  })),
  report: (message) => { if (useWorkshop.getState().storageError !== message) useWorkshop.setState({ storageError: message }) },
  protect: () => (useWorkshop.getState().open ? useWorkshop.getState().currentId : null),
  notice: (message) => useWorkshop.setState({ notice: message }),
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __workshop?: unknown }).__workshop = useWorkshop
}
