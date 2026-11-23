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
  type ShardVertex, type Part, type Ref, addressesIn, cloneVertex, hexToRgb, rgbToHex } from 'sno-core/shards'
import { withOpacity } from '../lib/opacityStep'
import { readGlow, withGlow, withPointSize, type Glow } from 'sno-core/glow'
import { drawnFace, withFace, type FaceMode } from 'sno-core/face'
import { GLOW_START, suggestedGlowStyle } from '../lib/pointGlow'
import { markCameSealed, noTable, rekeyCarried, signedTableOnly, takeIntoKeeping, you } from '../lib/carried'
import { planPieces } from '../lib/piecePlan'
import { useToast } from './useToast'
import { pieceKeysFor, pieceWasOpened } from '../lib/pieceKeys'
import { fingerprint, loadLedger } from '../lib/published'
import { authoredConstrainOf, chosenConstrainOf, withConstrain, type Constrain } from '../lib/walkConstrain'
import { bounceOf, springboardOf, withBounce, type Bounce } from '../lib/walkBounce'
import { withAnim } from '../lib/anim'
import { EYE_FIELD, eyeReachTicks, flipEyeZ, usedBenchEye, withEye, type Eye } from '../lib/avatarEye'
import { Fetched, addPart, parseAddress, quarterTurnPart, removeParts } from 'sno-core/parts'
import { FLOOR, MAX_SIZE, MIN_SIZE, stamp, type Facing, type StampKind, type WorkPlane } from 'sno-core/stamps'
import { BUILT_IN, hexAt, remap, samePalette, snapHex, type Palette } from 'sno-core/snoPalette'
import { newell, triangulate } from 'sno-core/triangulate'
import { flipFace, flipSurface, surfaceOf, windAdded, windOutward } from 'sno-core/winding'
import { Vector3 } from 'three'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'
import { cornerAverage, weld } from '../lib/weld'
import type { CopySource, StampForm, StampedRange } from '../lib/stampCopy'
import { subdivide, subdivideNotice } from '../lib/subdivide'
import { withCredit, type Credit } from 'sno-core/feed'
import { newestFirst } from '../lib/shardFolders'
import { attach, initialShards, persist, saveNow as saveStored, workshopReading } from './workshopStorage'

/**
 * OPEN WORKSHOP asked while the library was still reading: opened once it has
 * read, as asked last, and only when that is soon after the tap, so a read
 * that took long never opens it over whatever came next (see openWorkshop).
 */
let openAsked: { id?: string; panel?: 'menu'; at: number } | null = null
/** How long a tap made while the library reads still opens it once read. */
const OPEN_ASKED_MS = 8_000

export { hydrateWorkshop, storageMode } from './workshopStorage'

/** VIEW builds nothing: it is the tool you hold to look around. */
export type Tool = 'view' | 'stamp' | 'add' | 'select' | 'face' | 'paint'

/** What a tap or a box takes in SELECT (workshop redesign, phase 3). */
export type SelectKind = 'points' | 'faces' | 'objects'

/** What a tap paints in PAINT (workshop redesign, phase 3): one point, one face, the piece it is part of, or all of it. */
export type PaintMode = 'point' | 'face' | 'piece' | 'all'

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

/**
 * A color poured over faces that have seams (DECK-0003 §1.4a): a face color
 * fills the whole triangle and its corners contribute nothing, so a FILL that
 * wrote the corners alone changed nothing you could see. 321 of the 337 Maze
 * Kit pieces carry seams, and one SEAM gives every face of a shard one (review
 * of #550). The faces `on` picks take the color too; a shard with no seams, or
 * a list out of step that every reader ignores, stays as it is.
 */
function seamsPoured(s: ShardModel, on: (face: number) => boolean, c: [number, number, number]): Pick<ShardModel, 'facecolors'> | Record<string, never> {
  const own = s.facecolors
  if (!own || own.length !== s.faces.length) return {}
  return { facecolors: own.map((fc, k) => (on(k) ? [...c] as [number, number, number] : fc)) }
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
 * Chosen in STAMP's library (workshop/StampLibrary.tsx), it also carries what
 * COPY puts down and its size for SNAP TO ITS SIZE (workshop/stampPrepare.ts).
 */
export interface StampObject {
  ref: Ref
  name: string
  shard: ShardModel
  /** The shard and everything it places, flattened (lib/stampCopy.ts bakeSource): what COPY puts down. Null or absent when it cannot be copied. */
  copy?: CopySource | null
  /** Its bounds in its own ticks and unit, everything it places included: what SNAP TO ITS SIZE steps by. */
  size?: { min: [number, number, number]; max: [number, number, number]; unit: number } | null
  /** A shard of your workshop library, chosen there (not one read from the relays). */
  local?: boolean
  /** The addresses of every object it places, at any depth, read or not: LINK never places a shard that places the one it goes into. */
  places?: string[]
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
  /**
   * The faces tapped in FACE mode, as indices into the shard's faces, in the
   * order they were tapped. Every one stays lit and in hand until it is tapped
   * again or let go (arkinox, 2026-10-31), and DELETE, FLIP, FILL and SEAM take
   * them all.
   */
  selectedFaces: number[]
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
  /**
   * BOX (workshop redesign, phase 2, decision 1): one finger orbits in every
   * tool, and in SELECT this switch makes a one-finger drag draw a box
   * instead. Off when the workshop opens; kept across tools, read only in
   * SELECT.
   */
  boxSelect: boolean
  setBoxSelect: (on: boolean) => void
  /**
   * SELECT's POINTS, FACES or OBJECTS (workshop redesign, phase 3, decision
   * 3): what a tap or a box takes. Selecting faces moved here from FACE,
   * which only makes faces now. Changing it lets go of what is held.
   */
  selectKind: SelectKind
  setSelectKind: (kind: SelectKind) => void
  /** PAINT's POINT, FACE, PIECE or ALL, and for a face BLEND (its corners) or EDGE (a hard seam). */
  paintMode: PaintMode
  paintEdge: boolean
  setPaintMode: (mode: PaintMode) => void
  setPaintEdge: (edge: boolean) => void
  /**
   * PAINT: the color in hand onto what a tap met, by paintMode: the point
   * (every vertex on it), the face (BLEND or EDGE), the piece joined to it,
   * or everything. One UNDO each. What is held stays held.
   */
  paintTap: (hit: { vertex?: number; face?: number }) => void
  /** The dropper on a tap: the color of the point or face it met, into hand. What is held stays held. */
  takeColorAt: (hit: { vertex?: number; face?: number }) => void
  /** PAINT's dropper, armed: the next tap takes a color instead of painting, then it is off again. */
  paintTake: boolean
  setPaintTake: (on: boolean) => void
  /** Hold these faces, each with every vertex on its corners' points, as a tapped face is held. */
  holdFaces: (faces: readonly number[]) => void
  /** ALL in SELECT: every point, every face, or every placed object, as its switch says. */
  selectAll: () => void
  /** STAMP places a built-in shape, or a published object by reference (DECK-0003 §1.10). */
  stampMode: 'shape' | 'object'
  /** The object OBJECT stamps, chosen in the picker. */
  stampObject: StampObject | null
  setStampMode: (mode: 'shape' | 'object') => void
  setStampObject: (object: StampObject | null) => void
  /**
   * How OBJECT stamps it (owner, 2026-11-23): COPY puts its points and faces
   * in as your own (lib/stampCopy.ts), LINK places it as one object by
   * reference. COPY is the default.
   */
  stampForm: StampForm
  setStampForm: (form: StampForm) => void
  /** SNAP TO ITS SIZE: OBJECT's taps step by the object's own size along the working plane, so pieces of one size line up. On by default. */
  stampSnap: boolean
  setStampSnap: (on: boolean) => void
  /**
   * The points and faces the last COPY stamp made, in the shard it made them
   * in (lib/stampCopy.ts stampedIndices reads every index): for whatever
   * acts on just what one stamp made, such as making it a group. Null once
   * anything else changes the shard's points or faces, or another shard is
   * opened, so it never names indices that moved.
   */
  lastCopy: StampedRange | null
  /**
   * One stamp, already worked out and checked by the tap (workshop/stampTap.ts):
   * the shard as it will be, as one undoable edit, with its line. A COPY
   * names what it added (`added`), which becomes `lastCopy`; a LINK passes
   * null. The selection is let go, as every stamp lets it go.
   */
  commitStamp: (shard: ShardModel, added: Omit<StampedRange, 'shardId'> | null, notice: string) => StampedRange | null
  /**
   * Place the chosen object at `at`, turned by the stamp's facing. `self` is
   * this object's own address if this key published it, so an object is never
   * made to place itself (every reader would draw a loop placeholder).
   */
  placeObject: (at: P3, self?: string) => void

  /**
   * Open the workshop on `id` (else the shard last open, else the newest),
   * with `panel` up: the first-arrival tutorial opens it with its MENU
   * showing (tutorial feedback 2026-11-12, item 10).
   */
  openWorkshop: (id?: string, panel?: 'menu') => void
  /** A panel the workshop shows as it next draws open (openWorkshop `panel`), then null again (workshop/Workshop.tsx). */
  openPanel: 'menu' | null
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
   * anything else is kept between 0 and 99 (no floor: at 0 the object draws
   * nothing of its own, and its glow still shows). Undoable like MODE.
   */
  setOpacity: (percent: number) => void
  /**
   * POINT SIZE (DECK-0003 §1.15): the width of every point in ticks of the
   * shard's own grid, 0 (no dots) to 7,680, or undefined for the reader's own
   * size, which removes the field. Written through sno-core withPointSize, so
   * a value out of range removes the field too. Kept in every mode, drawn in
   * POINTS. Undoable like MODE.
   */
  setPointSize: (ticks: number | undefined) => void
  /**
   * GLOW (DECK-0003 §1.16): null turns it OFF and removes the field; anything
   * else is merged over the shard's glow. Turning it on from OFF starts from
   * the radius and strength last used this session (glowLast), and from the
   * suggested style (lib/pointGlow suggestedGlowStyle) when no style is given.
   * Written through sno-core withGlow, so nothing malformed is stored. Kept in
   * every mode, drawn in POINTS. Undoable like MODE.
   */
  setGlow: (patch: Partial<Glow> | null) => void
  /** The radius (ticks) and GLOW STRENGTH the last glow written had, so OFF then LIGHT puts them back. This session only. */
  glowLast: { radius: number; strength: number }
  /**
   * Whether a walker can cross the shard in WALK (DECK-0003 §1.12,
   * lib/walkConstrain.ts): off, all of its faces, or only while it draws
   * solid and opaque. Written as the word, OFF as `"off"`; a shard that never
   * chose already shows and publishes OPAQUE, so pressing OPAQUE there is no
   * edit. Undoable like MODE.
   */
  setConstrain: (c: Constrain) => void
  /**
   * Whether walkers with GRAVITY on bounce off the shard (lib/walkBounce.ts):
   * 0 for none, a whole number of gibsons from 1 to 24, or "reflect"; with a
   * fixed height, `springboard` launches on walk-on too. Written only as the
   * walker reads it (withBounce): OFF removes both fields, and nothing invalid
   * is ever stored. Undoable like MODE.
   */
  setBounce: (b: Bounce, springboard?: boolean) => void
  /**
   * The shard's `anim` (lib/anim.ts): `raw` read as a reader reads it and
   * written back canonically, so a malformed entry or an unknown word is
   * dropped rather than stored; an empty list removes the field. Undoable.
   */
  setAnim: (raw: unknown) => void
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
  /** Every selected face gone, in one undoable step; their points stay. */
  deleteSelectedFace: () => void
  /** FLIP FACE: every selected face turned round, its front to its back (DECK-0003 §1.4). */
  flipSelectedFace: () => void
  /** FLIP SURFACE: every selected face turned, and every face joined to them by clean edges turned to agree. */
  flipSelectedSurface: () => void
  /** AUTO: every face of the shard wound outward by the guess (sno-core orient). */
  autoWind: () => void
  /** The colour onto one face as a hard seam, not onto its corners. */
  colorFace: (index: number, c: [number, number, number]) => void
  /** The colour onto several faces as hard seams, in one undoable step: SEAM with faces in hand. */
  colorFaces: (indices: readonly number[], c: [number, number, number], quiet?: boolean) => void
  /** Give every face back to its corners: the object interpolates again. */
  clearFaceColors: () => void
  /** Put a color at the front of the palette (moving it there if it is already in). */
  rememberColor: (hex: string) => void
  forgetColor: (hex: string) => void
  moveSelected: (axis: 0 | 1 | 2, delta: number) => void
  /**
   * SET EYE (avatar eye, UI A "the eye on the bench"; arkinox, 2026-11-16):
   * the eye in your hand. While on, nothing else is held: the move handles,
   * the move keys and the strip act on the eye (shell/MoveHandles,
   * shell/EyeBar). Off with DONE, Esc, E, a tool or a sheet, or anything held.
   */
  eyeEdit: boolean
  setEyeEdit: (on: boolean) => void
  /**
   * The eye one move along a model axis (the bench's frame, as moveSelected
   * moves points), `delta` ticks, landing on the snap's grid (an eye off it,
   * AUTO's or CENTER's, goes to the next grid line that way first). An
   * automatic eye starts from where it is and becomes CHOSEN. Refused, and
   * false, past the reach WALK honours: the avatar size limit at the avatar's
   * true scale (avatarEye eyeReachTicks). One UNDO each, as any edit.
   */
  moveEye: (axis: 0 | 1 | 2, delta: number) => boolean
  /**
   * The eye set outright, in ticks in the payload's frame (avatarEye withEye):
   * undefined for AUTO, which removes the field; anything malformed removes it
   * too. No edit, and false, when nothing changes. One UNDO.
   */
  setEye: (eye: Eye | undefined) => boolean
  /**
   * FACING (DECK-0003 §1.18): how the shard turns as it moves when worn, PATH
   * or UPRIGHT. Written through sno-core withFace, so PATH removes the field
   * and nothing malformed is stored. No edit, and false, when it is already
   * so. One UNDO.
   */
  setFace: (face: FaceMode) => boolean
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
  /** FACE's BACK: the last corner picked, let go. */
  unpickLast: () => void
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
  current: () => ShardModel | null
  /**
   * The shards a double-tap went into (enterPart), outermost first: each the
   * shard that placed the next, with its own UNDO and REDO kept for its return.
   * Empty at the top. BACK (and Esc) goes up one; the workshop's close shows
   * only at the top (owner, 2026-11-22).
   */
  backStack: PartFrame[]
  /**
   * Open the object placed at `index` of the shard on the bench, to edit it in
   * place. A shard of yours in the workshop opens as itself: every shard that
   * places it follows, and an edit of a published one makes it a COPY from
   * then on (lib/partForm.ts). Anything else (a LINK to a public object, or an
   * entry of the shard's own table) opens as your copy, made now; the parent
   * is pointed at the copy only on its first edit, so a look changes nothing.
   * `fetch` reaches the relays for a link (lib/parts.ts fetchRef, passed in:
   * this store is imported by what lib/parts.ts imports).
   */
  enterPart: (index: number, fetch?: (ref: Ref) => Promise<unknown>) => Promise<void>
  /** Up one level, to the shard that placed this one. A copy nobody edited goes. */
  back: () => void
  /**
   * A shard about to be used somewhere outside the workshop's own refs (put in
   * a chest draft): a look copy among them is stored now, so what holds its id
   * never names a shard that is in no stored list. Anything else: nothing.
   */
  keepCopy: (id: string) => void
  /**
   * TAKE (MOVE INTO WORKSHOP, COPY) of a shard read from a bag or a chest: the
   * shard into your workshop with what it carries keyed under you
   * (lib/carried.ts takeIntoKeeping), and each SEALED PIECE of a split build
   * it places (lib/pieces.ts) as a shard of your own beside it, its refs
   * pointed at them, so the copy draws whole and a hide of it seals each piece
   * again. A piece is opened with the key of the bag it was read from, through
   * `fetch` (lib/parts.ts fetchRef, passed in: this store is imported by what
   * lib/parts.ts imports). Its id, and how many pieces came and how many could
   * not be opened (those stay placeholders).
   */
  takeShard: (model: ShardModel, fetch: (ref: Ref) => Promise<unknown>) => Promise<{ id: string; pieces: number; missing: number }>
}

/**
 * One level of the way in (backStack): the shard that placed the one opened,
 * its UNDO and REDO, and, for a copy opened in place of a link or a table
 * entry, what its first edit points at the copy.
 */
export interface PartFrame {
  /** The shard that placed the one opened. */
  id: string
  /** The shard opened from it: BACK means this level only while it is still on the bench. */
  child: string
  past: ShardModel[]
  future: ShardModel[]
  /**
   * A copy opened in place of a link or a table entry: the ref it takes the
   * place of, the address that ref named, and the copy as it was made
   * (`born`, its fingerprint), so any change to it, however made, is seen.
   */
  pending?: { ref: number; address: string; copyId: string; fromTable: boolean; born: string; done?: true }
}

/** A shard from wire form (DECK-0003 §1), as PASTE and bulk import read it; null if it is not one. */
export function shardFromText(text: string, id: string): ShardModel | null {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return null }
  // sno-core's fromPayload (0.1.31 on) turns a version 1 payload's eye into the version 2 frame itself.
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
 * A duplicate goes into the folder its source is in (arkinox, 2026-11-16:
 * "when i duplicate a shard ... it gets copied to the root instead of the
 * current folder"). The folder store hands this over too, for the same
 * import-cycle reason as readLastUsedFrom; until it does, a copy is filed
 * nowhere, which is the top. Called before the copy joins the list, so the
 * list never draws it at the top for a moment first.
 */
let fileCopy: (copy: string, source: string) => void = () => undefined
export function fileCopiesWith(file: (copy: string, source: string) => void): void {
  fileCopy = file
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
  persist(kept(shards))
}

/** A copy's fingerprint: its whole payload, name included, so any change to it shows. */
export function bornOf(s: ShardModel): string {
  return fingerprint(JSON.stringify(toPayload(s)))
}

/**
 * A copy opened in place of a link or a table entry (enterPart) that nobody has
 * changed: it is kept out of storage, so a reload or a crash while you only
 * looked leaves no stray copy in the list. Its first change (any change: its
 * fingerprint no longer what it was made with) lets it in.
 */
export function untouchedLookCopy(s: ShardModel): boolean {
  const mark = (s as ShardModel & { lookCopy?: string }).lookCopy
  // Published meanwhile, it went public: stored like any shard (as settle counts it).
  return typeof mark === 'string' && mark === bornOf(s) && !loadLedger()[s.id]
}

type Marked = ShardModel & { lookCopy?: string }

/** The shard without its look-copy mark: stored like any shard of yours from now on. */
function unmarked(s: ShardModel): ShardModel {
  if ((s as Marked).lookCopy === undefined) return s
  const { lookCopy: _mark, ...plain } = s as Marked
  void _mark
  return plain
}

/**
 * The list with every look copy that `used` places un-marked: a copy only
 * looked at that is placed inside another shard (a stamp, a paste, any edit
 * that writes a ref to it) is stored at that moment, so the ref never names
 * a shard that is in no stored list. `me` is the pubkey the refs name it under.
 */
export function keepPlacedCopies(list: ShardModel[], used: ShardModel, me: string | null): ShardModel[] {
  if (!me || !used.refs?.length || !list.some((s) => (s as Marked).lookCopy !== undefined)) return list
  const named = new Set(used.refs.flatMap((r) => (r[0] === 'a' && r[1].startsWith(`33331:${me}:`) ? [r[1].slice(`33331:${me}:`.length)] : [])))
  return list.some((s) => named.has(s.id) && (s as Marked).lookCopy !== undefined) ? list.map((s) => (named.has(s.id) ? unmarked(s) : s)) : list
}

/** The list as it is stored: without copies only looked at. */
export function kept(list: ShardModel[]): ShardModel[] {
  return list.some(untouchedLookCopy) ? list.filter((s) => !untouchedLookCopy(s)) : list
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

/**
 * Each point's vertices, once per list of vertices. A list is never changed
 * in place (every edit makes a new one), so this holds for as long as the list
 * does. A tap on a face asks three times, and with many faces held a release
 * asks for all of theirs: a pass over a nave's 1,896 vertices each time was a
 * good part of a tap.
 */
const byPoint = new WeakMap<readonly ShardVertex[], Map<string, number[]>>()
function pointsOf(vertices: readonly ShardVertex[]): Map<string, number[]> {
  let m = byPoint.get(vertices)
  if (!m) {
    m = new Map()
    for (let i = 0; i < vertices.length; i++) {
      const k = pointKey(ticksOf(vertices[i]))
      const g = m.get(k)
      if (g) g.push(i); else m.set(k, [i])
    }
    byPoint.set(vertices, m)
  }
  return m
}

/** Every vertex on the same point as vertex `index`, itself included. */
function group(s: Pick<ShardModel, 'vertices'>, index: number): number[] {
  const v = s.vertices[index]
  if (!v) return []
  return [...(pointsOf(s.vertices).get(pointKey(ticksOf(v))) ?? [])]
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

/** The shard object the last COPY stamp left on the bench (useWorkshop lastCopy): once the bench holds anything else, lastCopy names nothing. */
let copiedInto: ShardModel | null = null

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
    const next = fn(shards[i])
    if (!next) return false
    let list = shards.slice()
    list[i] = { ...next, updatedAt: Date.now() }
    // A look copy this edit places is stored now (keepPlacedCopies).
    list = keepPlacedCopies(list, list[i], you())
    const partSel = get().partSel.filter((k) => k < (next.parts?.length ?? 0))
    // A copy opened in place of a link or a table entry: its first edit points
    // its parent at it, one edit of the parent that the parent's UNDO takes back.
    const stack = get().backStack
    const top = stack[stack.length - 1]
    const pointed = top?.pending && !top.pending.done && top.pending.copyId === shards[i].id ? pointParent(list, top) : null
    const backStack = pointed ? [...stack.slice(0, -1), pointed] : null
    set({ shards: list, past: [...past.slice(-(HISTORY - 1)), shards[i]], future: [], notice, turnPivot: null, partSel, ...(backStack ? { backStack } : {}) })
    save(list)
    return true
  }

  /**
   * Point a level's parent at its copy, in `list` (changed in place): its ref
   * names the copy, a table entry nothing places any more goes, and the parent
   * as it was joins the level's UNDO. The level as it now stands, or null when
   * the parent is gone or nobody is signed in (the copy then stays as it is).
   */
  const pointParent = (list: ShardModel[], frame: PartFrame): PartFrame | null => {
    const p = frame.pending
    const me = you()
    const j = list.findIndex((s) => s.id === frame.id)
    if (!p || p.done || j < 0 || !me) return null
    const parent = list[j]
    const refs = (parent.refs ?? []).map((r, k) => (k === p.ref ? (['a', `33331:${me}:${p.copyId}`] as Ref) : r))
    let next: ShardModel = { ...parent, refs, updatedAt: Date.now() }
    // A table entry nothing places any more goes (DECK-0003 §1.10: a key no
    // placement names is not written); one another entry places stays.
    const table = next.objects as Record<string, unknown> | undefined
    if (p.fromTable && table && !refs.some((r) => r[0] === 'a' && r[1] === p.address)) {
      const placedByEntry = Object.entries(table).some(([k, v]) => k !== p.address && addressesIn(v).includes(p.address))
      if (!placedByEntry) {
        // With it go the entries only it placed: what nothing left reaches is carried to every finder and drawn by none.
        const reach = new Set<string>()
        const queue = refs.filter((r) => r[0] === 'a').map((r) => r[1])
        while (queue.length) {
          const k = queue.shift()!
          if (reach.has(k) || k === p.address || !Object.prototype.hasOwnProperty.call(table, k)) continue
          reach.add(k)
          queue.push(...addressesIn(table[k]))
        }
        const kept = Object.fromEntries(Object.entries(table).filter(([k]) => reach.has(k)))
        const { objects: _all, ...rest } = next
        void _all
        next = Object.keys(kept).length ? { ...rest, objects: kept as ShardModel['objects'] } : rest
      }
    }
    list[j] = next
    // The copy is the parent's now: stored like any shard of yours.
    const c = list.findIndex((s) => s.id === p.copyId)
    if (c >= 0) list[c] = unmarked(list[c])
    return { ...frame, past: [...frame.past.slice(-(HISTORY - 1)), parent], future: [], pending: { ...p, done: true } }
  }


  /**
   * Leave one level of the way in, in `list` (changed in place). A copy that
   * changed in any way (an edit, a rename, an import, a copy inside it pointed
   * at), or that went public, points its parent at it now; one nobody touched
   * goes, unless it is `keep` (the shard about to be shown), and a look leaves
   * nothing behind. Never drops a copy whose parent cannot be pointed at it.
   * The level as it now stands.
   */
  const settle = (list: ShardModel[], frame: PartFrame, keep?: string | null): PartFrame => {
    const p = frame.pending
    if (!p || p.done) return frame
    const k = list.findIndex((s) => s.id === p.copyId)
    if (k < 0) return frame
    const touched = bornOf(list[k]) !== p.born || !!loadLedger()[p.copyId]
    if (touched) return pointParent(list, frame) ?? frame
    // Unchanged but in use elsewhere (placed, or put in a chest): it stays, stored, and the parent keeps its link.
    if ((list[k] as Marked).lookCopy === undefined) return frame
    if (p.copyId !== keep && list.some((s) => s.id === frame.id)) list.splice(k, 1)
    return frame
  }

  /**
   * Leave every level of the way in at once (another shard picked, a new one,
   * the workshop opened afresh), innermost first, so a copy inside a copy
   * counts as a change to the outer one. The list as it now stands, or null
   * when there was no way in.
   */
  const leaveAll = (keep?: string | null): ShardModel[] | null => {
    const stack = get().backStack
    if (stack.length === 0) return null
    const list = get().shards.slice()
    for (let i = stack.length - 1; i >= 0; i--) settle(list, stack[i], keep)
    return list
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
    if (added) set({ selection: placed.map((_, k) => base + k), partSel: objects.map((_, k) => firstPart + k), selectedFaces: [], facePick: [] })
    return added
  }

  return {
    shards: initialShards(),
    storageError: null,
    currentId: null,
    open: false,
    openPanel: null,
    tool: 'view',
    selection: [], partSel: [],
    eyeEdit: false,
    invert: false,
    boxSelect: false,
    selectKind: 'points',
    paintMode: 'face',
    paintEdge: false,
    paintTake: false,
    facePick: [],
    selectedFaces: [],
    clip: null,
    palette: loadPalette(),
    palettes: loadPalettes(),
    level: 0,
    plane: FLOOR,
    division: 1,
    turnPivot: null,
    stampMode: 'shape',
    stampObject: null,
    stampForm: 'copy',
    stampSnap: true,
    lastCopy: null,
    showAvatar: loadShowAvatar(),
    color: [0, 0.9, 1],
    glowLast: { ...GLOW_START },
    stampKind: 'block',
    stampSize: 2,
    stampFacing: 0,
    aim: null,
    past: [],
    future: [],
    notice: null,
    backStack: [],

    openWorkshop: (id, panel) => {
      // The library still reading (it starts after the first frame, boot.tsx): open once it has, never on an empty list.
      // One open waits, the last asked; it opens only soon after the tap.
      const reading = workshopReading()
      if (reading) {
        const waiting = openAsked !== null
        openAsked = { id, panel, at: Date.now() }
        if (!waiting) {
          useToast.getState().show({ label: 'OPENING WORKSHOP', meta: 'Your shards are still loading.', mark: 'build' })
          void reading.then(() => {
            const asked = openAsked
            openAsked = null
            if (!asked || workshopReading() || get().open || Date.now() - asked.at > OPEN_ASKED_MS) return
            get().openWorkshop(asked.id, asked.panel)
          })
        }
        return
      }
      openAsked = null
      const left = leaveAll(id ?? get().currentId)
      if (left) { set({ shards: left }); save(left) }
      if (get().backStack.length) set({ backStack: [] })
      const { shards } = get()
      const currentId = id ?? get().currentId ?? newestId(shards) ?? get().create()
      set({ open: true, currentId, openPanel: panel ?? null, eyeEdit: false, selection: [], partSel: [], selectedFaces: [], facePick: [], tool: 'view', plane: FLOOR, aim: null, past: [], future: [], notice: null, boxSelect: false, selectKind: 'points' })
    },

    closeWorkshop: () => set({ open: false, eyeEdit: false, selection: [], partSel: [], selectedFaces: [], facePick: [], aim: null }),

    create: (name) => {
      const s = newShard(name ?? `Object ${get().shards.length + 1}`)
      const list = [...(leaveAll() ?? get().shards), s]
      set({ shards: list, backStack: [], currentId: s.id, selection: [], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], notice: null })
      save(list)
      return s.id
    },

    select: (id) => {
      // Picked from the list: the way in is left, its untouched copies with it (never the one picked).
      const left = leaveAll(id)
      if (left) save(left)
      set({ ...(left ? { shards: left } : {}), backStack: [], currentId: id, selection: [], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], notice: null })
    },

    rename: (id, name) => {
      const list = get().shards.map((s) => (s.id === id ? { ...s, name: name.slice(0, 64), updatedAt: Date.now() } : s))
      set({ shards: list }); save(list)
    },

    duplicate: (id) => {
      const src = get().shards.find((s) => s.id === id)
      if (!src) return id
      // A duplicate is a shard of its own, stored: never a look copy (untouchedLookCopy).
      const copy: ShardModel = { ...unmarked(src), id: uuid(), name: `${src.name} copy`, vertices: src.vertices.map(cloneVertex), faces: src.faces.map((f) => [...f] as [number, number, number]), updatedAt: Date.now() }
      // Beside its source, in the same folder; a source at the top keeps the copy there.
      // Filing is a nicety: a fault in it never costs the copy itself.
      try { fileCopy(copy.id, src.id) } catch (err) { console.warn('[workshop] could not file the copy in its folder', err) }
      const list = [...get().shards, copy]
      set({ shards: list, currentId: copy.id, selection: [], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], notice: null }); save(list)
      return copy.id
    },

    remove: (id) => {
      const list = get().shards.filter((s) => s.id !== id)
      const currentId = get().currentId === id ? newestId(list) : get().currentId
      set({ shards: list, currentId, selection: [], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], notice: null }); save(list)
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
      set({ shards: list, currentId: next, selection: [], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], notice: null, ...stampState }); save(list)
      return saveStored()
    },

    setMode: (mode) => edit((s) => ({ ...s, mode })),
    setOpacity: (percent) => edit((s) => withOpacity(s, percent)),
    // Already so: the same object back, so no edit and no empty undo step.
    setPointSize: (ticks) => edit((s) => { const n = withPointSize(s, ticks === undefined ? undefined : Math.round(ticks)); return n.extra?.pointsize === s.extra?.pointsize ? null : n }),
    setGlow: (patch) => {
      const { glowLast, color } = get()
      let wrote: Glow | undefined
      const changed = edit((s) => {
        const had = readGlow(s.extra?.glow)
        if (patch === null) {
          // OFF remembers the glow it clears, a glow the shard arrived with included, so LIGHT or FOG puts it back.
          wrote = had
          return s.extra?.glow === undefined ? null : withGlow(s, undefined)
        }
        const g: Glow = { ...(had ?? { style: suggestedGlowStyle(s, color), ...glowLast }), ...patch }
        // sno-core clears the field on a fractional value: whole ticks and whole percent only.
        g.radius = Math.round(g.radius)
        g.strength = Math.round(g.strength)
        const n = withGlow(s, g)
        wrote = readGlow(n.extra?.glow)
        return had && wrote && had.style === wrote.style && had.radius === wrote.radius && had.strength === wrote.strength ? null : n
      })
      if (changed && wrote) set({ glowLast: { radius: wrote.radius, strength: wrote.strength } })
    },
    // Already so: no edit, so no undo step that changes nothing.
    setConstrain: (c) => edit((s) => (authoredConstrainOf(s) === c ? null : withConstrain(s, c))),
    // Already so: the same object back, so no edit and no empty undo step.
    setBounce: (b, springboard = false) => edit((s) => { const n = withBounce(s, b, springboard); return n === s ? null : n }),
    setAnim: (raw) => edit((s) => { const n = withAnim(s, raw).shard; return n === s ? null : n }),
    setUnit: (unit) => edit((s) => ({ ...s, unit: clampUnit(unit) })),
    // FACE works on corners it picks itself, and its panel only appears with
    // nothing else selected, so a point still held from SELECT hid FILL behind
    // it and the tool looked broken. Taking the tool clears the selection.
    // INVERT goes off with the tool too: it is a mode of SELECT and FACE, and
    // the key that shows it is only drawn there.
    // The tool already in hand, tapped again, changes nothing: a face held in
    // SELECT FACES stays a face. A held face's corners go with the face, so
    // another tool never inherits them as bare points.
    setTool: (tool) => {
      const st = get()
      if (tool === st.tool) return
      const letGo = tool === 'face' || tool === 'paint' || st.selectedFaces.length > 0
      set({ tool, eyeEdit: false, facePick: [], selectedFaces: [], aim: null, invert: false, paintTake: false, ...(letGo ? { selection: [], partSel: [] } : {}) })
    },
    setInvert: (on) => set({ invert: on }),
    setBoxSelect: (on) => set({ boxSelect: on }),
    setSelectKind: (kind) => { if (kind !== get().selectKind) set({ selectKind: kind, selection: [], partSel: [], selectedFaces: [], facePick: [] }) },
    setPaintMode: (mode) => set({ paintMode: mode }),
    setPaintEdge: (edge) => set({ paintEdge: edge }),
    setPaintTake: (on) => set({ paintTake: on }),
    holdFaces: (faces) => {
      const s = get().current()
      if (!s) return
      const on = faces.filter((k) => s.faces[k])
      set({ selectedFaces: on, selection: [...new Set(on.flatMap((k) => s.faces[k].flatMap((v) => group(s, v))))] })
    },
    selectAll: () => {
      const st = get()
      const s = st.current()
      if (!s) return
      if (st.tool === 'select' && st.selectKind === 'objects') { set({ partSel: [...Array(s.parts?.length ?? 0).keys()] }); return }
      if (st.tool === 'select' && st.selectKind === 'faces') { st.holdFaces([...Array(s.faces.length).keys()]); return }
      // Points, and outside SELECT every placed object with them, as ALL always took.
      set({ selection: [...Array(s.vertices.length).keys()], selectedFaces: [], partSel: st.tool === 'select' ? [] : [...Array(s.parts?.length ?? 0).keys()] })
    },
    paintTap: (hit) => {
      const st = get()
      const s = st.current()
      if (!s) return
      const c = st.color
      const keep = { selection: st.selection, selectedFaces: st.selectedFaces, partSel: st.partSel }
      const face = hit.face !== undefined ? s.faces[hit.face] : undefined
      const corners = hit.vertex !== undefined && s.vertices[hit.vertex] ? group(s, hit.vertex) : face ? [...new Set(face.flatMap((v) => group(s, v)))] : []
      if (st.paintMode === 'all') { if (corners.length) st.colorAll(c); return }
      if (st.paintMode === 'face') {
        if (hit.face === undefined || !face) return
        // EDGE: a hard seam, quietly: a tap that paints needs no line saying so.
        if (st.paintEdge) { st.colorFaces([hit.face], c, true); return }
        // BLEND: every vertex on the face's corners takes the color, as COLOR
        // does for a face held, so a point stacked on a corner goes with it.
        set({ selection: corners, selectedFaces: [hit.face] })
        get().colorSelected(c)
        set(keep)
        return
      }
      if (corners.length === 0) return
      // POINT takes a point only: a tap on a face's middle paints nothing, since which corner was meant is a guess.
      if (st.paintMode === 'point' && hit.vertex === undefined) return
      set({ selection: corners, selectedFaces: [] })
      if (st.paintMode === 'piece') get().colorConnected(c)
      else get().colorSelected(c)
      set(keep)
    },
    takeColorAt: (hit) => {
      const st = get()
      const s = st.current()
      if (!s) return
      const keep = { selection: st.selection, selectedFaces: st.selectedFaces, partSel: st.partSel }
      if (hit.vertex !== undefined && s.vertices[hit.vertex]) set({ selection: [hit.vertex], selectedFaces: [] })
      else if (hit.face !== undefined && s.faces[hit.face]) set({ selection: [], selectedFaces: [hit.face] })
      else return
      get().sampleColor()
      set(keep)
    },
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
    setStampForm: (stampForm) => set({ stampForm }),
    setStampSnap: (stampSnap) => set({ stampSnap }),

    commitStamp: (shard, added, notice) => {
      const id = get().currentId
      if (!id || !get().current()) return null
      const done = edit(() => shard, notice)
      if (!done) return null
      const range: StampedRange | null = added ? { shardId: id, vertices: [...added.vertices] as [number, number], faces: [...added.faces] as [number, number] } : null
      // The shard exactly as this stamp left it: any later change (an edit, UNDO, another shard) lets lastCopy go (below the store).
      copiedInto = range ? get().current() : null
      set({ selection: [], partSel: [], selectedFaces: [], facePick: [], lastCopy: range })
      return range
    },
    setStampObject: (stampObject) => {
      // A look copy picked to stamp is stored now: whatever it is stamped into names a shard that stays.
      const me = you()
      const ref = stampObject?.ref
      if (me && ref && ref[0] === 'a' && ref[1].startsWith(`33331:${me}:`)) get().keepCopy(ref[1].slice(`33331:${me}:`.length))
      set({ stampObject, stampMode: 'object' })
    },

    placeObject: (at, self) => {
      const { stampObject, stampFacing } = get()
      const s = get().current()
      if (!s || !validPoint(at, s.extent)) return
      if (!stampObject) { set({ notice: 'Choose an object to stamp first: tap the slot under OBJECT.' }); return }
      if (self && stampObject.ref[1] === self) { set({ notice: 'An object cannot place itself.' }); return }
      const { shard } = addPart(s, stampObject.ref, { at: [...at] as P3, turn: [0, (90 * stampFacing) % 360, 0], step: 0 })
      edit(() => shard, `"${stampObject.name}" placed. It is one object: SELECT it to move, turn or copy it.`)
      set({ selection: [], partSel: [], selectedFaces: [], facePick: [] })
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
      set({ selection: [], partSel: [], selectedFaces: [], facePick: [] })
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
      if (added >= 0) set({ selection: group(get().current()!, added), selectedFaces: [] })
    },

    selectVertex: (index) => {
      const s = get().current()
      set({ selection: index === null || !s ? [] : group(s, index), partSel: [], selectedFaces: [] })
    },

    selectPart: (index) => {
      const s = get().current()
      set({ partSel: index === null || !s?.parts?.[index] ? [] : [index], selection: [], selectedFaces: [] })
    },

    togglePart: (index) => {
      const s = get().current()
      if (!s?.parts?.[index]) return
      const { partSel, invert } = get()
      // Under INVERT a tap only takes an object out; one not in hand is left alone.
      set({ partSel: nextSelection(partSel, [index], invert || partSel.includes(index)), selectedFaces: [] })
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
      set({ selection: tapSelection(s, selection, index, invert), selectedFaces: [] })
    },

    setSelection: (indices) => {
      const s = get().current()
      if (!s) { set({ selection: [] }); return }
      // Only what is new to the selection is widened to whole points
      // (settleSelection): a box growing or a pan putting it back rewrites
      // the held vertices as they are.
      set({ selection: settleSelection(s, get().selection, indices), selectedFaces: [] })
    },

    selectConnected: () => {
      const s = get().current()
      const { selection } = get()
      if (!s || selection.length === 0) return
      const out = connectedTo(s, selection)
      const grew = out.length > selection.length
      set({ selection: out, selectedFaces: [], notice: grew ? `${new Set(out.map((i) => pointKey(ticksOf(s.vertices[i])))).size} points connected by faces.` : 'Nothing else is joined to the selection by faces.' })
    },

    selectFace: (index) => {
      if (index === null) { set({ selectedFaces: [] }); return }
      const s = get().current()
      const f = s?.faces[index]
      if (!s || !f) return
      // A face is its corners: picking it puts them in the selection (every
      // vertex on each corner's point, as a point tap does), so the pad moves
      // and turns the faces in hand as one thing. Every face tapped stays in
      // hand and lit, in the order tapped (arkinox, 2026-10-31: "Every face I
      // tap should remain highlighted"). A tap on one in hand lets it go, and
      // takes back the corners no other face in hand still stands on. Under
      // INVERT a tap on a face takes its corners out whatever was held and
      // selects no face: it is taking away, not picking, and a face that loses
      // a corner to it is no longer whole in hand, so it goes too.
      const corners = [...new Set(f.flatMap((v) => group(s, v)))]
      const { selection: sel, invert, selectedFaces: held } = get()
      if (invert) {
        const gone = new Set(corners)
        set({
          selectedFaces: held.filter((k) => !s.faces[k]?.some((v) => group(s, v).some((i) => gone.has(i)))),
          selection: nextSelection(sel, corners, true),
        })
        return
      }
      if (held.includes(index)) {
        const rest = held.filter((k) => k !== index)
        const kept = new Set(rest.flatMap((k) => (s.faces[k] ?? []).flatMap((v) => group(s, v))))
        set({ selectedFaces: rest, selection: nextSelection(sel, corners.filter((i) => !kept.has(i)), true) })
        return
      }
      set({ selectedFaces: [...held, index], selection: nextSelection(sel, corners, false) })
    },

    deleteSelectedFace: () => {
      const { selectedFaces } = get()
      if (selectedFaces.length === 0) return
      const gone = new Set(selectedFaces)
      edit((s) => {
        const kept = s.faces.map((_, i) => i).filter((i) => !gone.has(i))
        if (kept.length === s.faces.length) return null
        return seamsFollow(s, { ...s, faces: kept.map((i) => s.faces[i]) }, kept)
      })
      set({ selectedFaces: [] })
    },

    flipSelectedFace: () => {
      const { selectedFaces } = get()
      if (selectedFaces.length === 0) return
      edit((s) => {
        const held = selectedFaces.filter((k) => s.faces[k])
        return held.length ? held.reduce((m, k) => flipFace(m, k), s) : null
      }, selectedFaces.length === 1 ? 'Face turned round.' : `${selectedFaces.length} faces turned round.`)
    },

    flipSelectedSurface: () => {
      const { selectedFaces } = get()
      if (selectedFaces.length === 0) return
      edit((s) => {
        // Two faces in hand on one surface turn it once: a second turn would
        // put it back. The whole surface is marked, whether or not a face of
        // it changed: one wound the other way already agrees after the turn.
        const done = new Set<number>()
        let m = s
        for (const k of selectedFaces) {
          if (!m.faces[k] || done.has(k)) continue
          for (const i of surfaceOf(m.faces, k)) done.add(i)
          m = flipSurface(m, k)
        }
        return m === s ? null : m
      }, selectedFaces.length === 1 ? 'Surface turned round.' : 'Surfaces turned round.')
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
    colorFace: (index, c) => { get().colorFaces([index], c) },

    colorFaces: (indices, c, quiet = false) => {
      set({ color: clampColor(c) })
      get().rememberColor(rgbToHex(clampColor(c)))
      edit((s) => {
        const on = indices.filter((k) => s.faces[k])
        if (on.length === 0) return null
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
        for (const k of on) facecolors[k] = clampColor(c)
        return { ...s, facecolors }
      }, quiet ? null : indices.length === 1 ? 'That face keeps its own color now.' : `${indices.length} faces keep their own colors now.`)
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
      const { selection, selectedFaces, tool } = get()
      const s = get().current()
      if (!s) return
      // The face tapped last, of those in hand.
      const selectedFace = selectedFaces.length ? selectedFaces[selectedFaces.length - 1] : null
      // A selected face is sampled as a face whenever it is in hand: in FACE
      // its corners are selected with it, so the selection is never empty
      // there (arkinox, 2026-10-12: "the face tool has no sample dropper for
      // the selected face; if I have a face with a seam I will want to sample it").
      const asFace = selectedFace !== null && (selection.length === 0 || tool === 'face' || get().selectKind === 'faces')
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

    setEyeEdit: (on) => {
      if (get().eyeEdit === on) return
      // The eye in hand is the only thing held (UI A): what was held lets go.
      set(on ? { eyeEdit: true, selection: [], partSel: [], selectedFaces: [], facePick: [], aim: null } : { eyeEdit: false })
    },

    moveEye: (axis, delta) => {
      const s = get().current()
      if (!s || delta === 0) return false
      // From the eye WALK uses: one past the size limit is pulled in first, so a move back toward the middle is never refused.
      const at = usedBenchEye(s)
      // Onto the snap's grid on the way: an eye off it (AUTO, CENTER) lands on
      // the next grid line in the move's direction, then steps along the grid.
      const grid = get().step()
      const to = at[axis] + delta
      at[axis] = grid > 0 ? (delta > 0 ? Math.floor(to / grid) : Math.ceil(to / grid)) * grid + 0 : to
      // No farther than WALK carries it: the avatar size limit at true scale (avatarEye eyeReachTicks).
      const reach = eyeReachTicks(s)
      if (at.some((t) => Math.abs(t) > reach)) { set({ notice: 'The eye can go no further that way: the avatar size limit.' }); return false }
      return edit((m) => withEye(m, flipEyeZ(at)))
    },

    // No edit when the field would read and write the same; a malformed one is taken out.
    setEye: (eye) => edit((m) => {
      const next = withEye(m, eye)
      return JSON.stringify(m.extra?.[EYE_FIELD]) === JSON.stringify(next.extra?.[EYE_FIELD]) ? null : next
    }),
    // Already so: no edit, so no undo step that changes nothing.
    setFace: (face) => edit((m) => (drawnFace(m) === face ? null : withFace(m, face))),

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
      const { selection, selectedFaces } = get()
      set({ color: clampColor(c) })
      get().rememberColor(rgbToHex(clampColor(c)))
      // With no points selected, the selected faces take the color for their corners.
      const held = get().current()?.faces
      const corners = selection.length === 0 && held ? selectedFaces.flatMap((k) => held[k] ?? []) : []
      if (selection.length === 0 && corners.length === 0) return
      edit((s) => {
        const chosen = new Set((corners.length ? corners : selection).filter((i) => s.vertices[i]))
        if (chosen.size === 0) return null
        const vertices = s.vertices.slice()
        for (const i of chosen) vertices[i] = { ...vertices[i], c: clampColor(c) }
        // The faces in hand, or with none in hand, the faces standing wholly on the points.
        const heldFaces = new Set(selectedFaces)
        const on = heldFaces.size > 0 ? (k: number): boolean => heldFaces.has(k) : (k: number): boolean => s.faces[k].every((v) => chosen.has(v))
        return { ...s, vertices, ...seamsPoured(s, on, clampColor(c)) }
      })
    },

    colorAll: (c) => {
      set({ color: clampColor(c) })
      get().rememberColor(rgbToHex(clampColor(c)))
      // The globe sits beside the other buckets on a phone, and a mistap flattens a whole piece: say so, and say the way back.
      const seamed = (get().current()?.faces.length ?? 0) > 0 && get().current()?.facecolors?.length === get().current()?.faces.length
      edit((s) => ({ ...s, vertices: s.vertices.map((v) => ({ ...v, c: clampColor(c) })), ...seamsPoured(s, () => true, clampColor(c)) }), seamed ? 'Every face took the color. UNDO brings the seams back.' : null)
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
        return { ...s, vertices, ...seamsPoured(s, (k) => s.faces[k].every((v) => chosen.has(v)), clampColor(c)) }
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
      set({ selection: [], partSel: [], selectedFaces: [], facePick: [] })
    },

    weld: () => {
      const s = get().current()
      if (!s) return
      const { selection } = get()
      const res = weld(s, selection.length >= 2 ? new Set(selection) : undefined)
      if (!res) { set({ notice: 'Nothing to weld: no two points stand on the same spot.' }); return }
      const n = res.shard.vertices.length
      edit(() => res.shard, `${res.merged} point${res.merged === 1 ? '' : 's'} welded${res.colored ? ', and the faces keep their own colors now' : ''}. ${n} vert${n === 1 ? 'ex' : 'ices'}.`)
      set({ selection: [], partSel: [], selectedFaces: [], facePick: [] })
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
      if (at >= 0) { set({ facePick: facePick.filter((_, i) => i !== at), selectedFaces: [] }); return }
      set({ facePick: [...facePick, index], selectedFaces: [] })
    },

    clearFacePick: () => set({ facePick: [] }),
    unpickLast: () => set((s) => ({ facePick: s.facePick.slice(0, -1) })),

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
    clearShard: () => { edit((s) => { const { refs: _r, parts: _p, facecolors: _f, ...rest } = s; return { ...rest, vertices: [], faces: [] } }); set({ selection: [], partSel: [], selectedFaces: [], facePick: [] }) },

    undo: () => {
      const { past, shards, currentId } = get()
      const i = shards.findIndex((s) => s.id === currentId)
      if (i < 0 || !past.length) return
      const list = shards.slice()
      list[i] = past[past.length - 1]
      set({ shards: list, past: past.slice(0, -1), future: [...get().future, shards[i]], selection: [], partSel: [], selectedFaces: [], facePick: [], notice: null })
      save(list)
    },

    redo: () => {
      const { future, shards, currentId } = get()
      const i = shards.findIndex((s) => s.id === currentId)
      if (i < 0 || !future.length) return
      const list = shards.slice()
      list[i] = future[future.length - 1]
      set({ shards: list, future: future.slice(0, -1), past: [...get().past, shards[i]], selection: [], partSel: [], selectedFaces: [], facePick: [], notice: null })
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
      set({ shards: list, currentId: s.id, selection: [], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], notice: null })
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
      const walled = chose && !chosenConstrainOf(next) ? withConstrain(next, chose) : next
      // BOUNCE likewise (decided 2026-11-10 to match CONSTRAIN, review of #653; not an owner ruling): a file that
      // reads as no bounce (absent or malformed) keeps the bench's, bounce
      // and springboard as a pair. A valid bounce in the file wins, with the
      // file's own springboard: never the file's bounce with the bench's
      // springboard.
      const benchBounce = bounceOf(old)
      const walk = benchBounce !== 0 && bounceOf(walled) === 0 ? withBounce(walled, benchBounce, springboardOf(old)) : walled
      const list = shards.slice()
      list[i] = walk
      // On the bench it is an edit like any other: UNDO brings the old one back.
      if (id === currentId) set({ shards: list, past: [...past.slice(-(HISTORY - 1)), old], future: [], selection: [], partSel: [], selectedFaces: [], facePick: [] })
      else set({ shards: list })
      save(list)
      return saveStored().then((ok) => (ok ? 'saved' : 'unsaved'))
    },

    current: () => get().shards.find((s) => s.id === get().currentId) ?? null,

    enterPart: async (index, fetch) => {
      const parent = get().current()
      const part = parent?.parts?.[index]
      const ref = part ? parent?.refs?.[part.ref] : undefined
      if (!parent || !part || !ref || ref[0] !== 'a') return
      const me = you()
      const open = (id: string, notice: string | null, pending?: PartFrame['pending']): void => {
        const { past, future, backStack } = get()
        set({ backStack: [...backStack, { id: parent.id, child: id, past, future, ...(pending ? { pending } : {}) }], currentId: id, past: [], future: [], selection: [], partSel: [], selectedFaces: [], facePick: [], turnPivot: null, notice })
      }
      const table = parent.objects as Record<string, unknown> | undefined
      const inTable = !!table && Object.prototype.hasOwnProperty.call(table, ref[1])
      const a = parseAddress(ref[1])
      // A shard of yours in the workshop, no relay hint: edited as itself, in place.
      if (!inTable && !ref[2] && a && a.kind === 33331 && me && a.pubkey === me) {
        const own = get().shards.find((s) => s.id === a.d)
        if (own) { open(own.id, null); return }
      }
      // Otherwise your copy: of the table's entry, or of the public object.
      let model: ShardModel | null = null
      if (inTable) {
        // An entry places what the same table holds (DECK-0003 §1.10, one table at
        // the root): the copy carries those entries in a table of its own.
        const read = fromPayload(table![ref[1]], ref[1])
        if (read) {
          const carried: Record<string, unknown> = {}
          const queue = addressesIn(table![ref[1]])
          while (queue.length) {
            const k = queue.shift()!
            if (k === ref[1] || carried[k] !== undefined || !Object.prototype.hasOwnProperty.call(table, k)) continue
            carried[k] = table![k]
            queue.push(...addressesIn(table![k]))
          }
          const { objects: _none, ...bare } = read
          void _none
          model = { ...bare, ...(Object.keys(carried).length ? { objects: carried as ShardModel['objects'] } : {}), author: me ?? undefined }
        }
      } else {
        const answer = fetch ? await fetch(ref).catch(() => null) : null
        const payload = answer instanceof Fetched ? answer.payload : answer
        const read = payload == null ? null : fromPayload(payload, ref[1])
        // The bench moved on while the relays answered: nothing is opened.
        if (get().current() !== parent) return
        // What it carries comes along, keyed under you (as a copy taken from a chest is).
        const author = answer instanceof Fetched ? answer.pubkey : a?.pubkey ?? null
        model = read ? rekeyCarried({ ...read, author: author ?? undefined }, me) : null
      }
      if (!model) {
        set({ notice: inTable ? 'That part is carried here, but it is not one the format can read.' : 'That object did not come back from the relays, so there is nothing to open.' })
        return
      }
      const credit: Credit | undefined = !inTable && a && a.pubkey !== me ? { address: ref[1], ...(ref[2] ? { relay: ref[2] } : {}) } : undefined
      const made = get().importShard(model, credit)
      // Marked as only looked at, so it is not stored until it changes (untouchedLookCopy).
      const copy = { ...get().shards.find((s) => s.id === made)! }
      ;(copy as ShardModel & { lookCopy?: string }).lookCopy = bornOf(copy)
      const marked = get().shards.map((s) => (s.id === made ? copy : s))
      set({ shards: marked })
      save(marked)
      const copyId = made
      open(copyId, `Your copy of ${copy.name}. ${parent.name} uses it once you change it${inTable ? '' : '; the public object stays as it is'}.`, { ref: part.ref, address: ref[1], copyId, fromTable: inTable, born: bornOf(copy) })
    },

    takeShard: async (model, fetch) => {
      const me = you()
      const author = model.author ?? null
      let parent: ShardModel = model
      const pieces: ShardModel[] = []
      let missing = 0
      try {
        if (me && author) {
          const plan = await planPieces(model, author, async (address) => {
            const payload = await fetch(['a', address]).catch(() => null)
            // Only a sealed piece of this build (opened with its bag's key); a public object stays a link.
            if (!pieceWasOpened(address)) { if (payload == null && pieceKeysFor(address).length > 0) missing++; return undefined }
            return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : undefined
          }, () => uuid(), false)
          // Another identity signed in while the relays answered: the copy goes in without the pieces, never under the old key.
          if (you() !== me) throw new Error('switched')
          if (plan.pieces.length > 0) {
            // Each piece a shard of yours, under the id its address now names.
            const names = new Map(plan.pieces.map((p) => [p.address, `33331:${me}:${p.d}`]))
            const point = (refs: unknown): Ref[] | undefined => (Array.isArray(refs) ? (refs as Ref[]).map((r) => (r[0] === 'a' && names.has(r[1]) ? (['a', names.get(r[1])!] as Ref) : r)) : undefined)
            parent = { ...plan.parent, refs: point(plan.parent.refs) }
            for (const p of plan.pieces) {
              const read = fromPayload(JSON.parse(p.payload), p.d)
              if (!read) { missing++; continue }
              const refs = point(read.refs)
              // Marked as come sealed: PUBLISH asks before it goes out in the clear (lib/carried.ts cameSealed).
              pieces.push(markCameSealed(takeIntoKeeping({ ...read, ...(refs ? { refs } : {}), id: p.d, author }, me)))
            }
          }
        }
      } catch {
        // The copy alone, as TAKE always made it: nothing half done.
        parent = model
        pieces.length = 0
        missing = 0
      }
      // Taken by whoever tapped: one signed in since gets nothing in their workshop from it.
      if (you() !== me) return { id: '', pieces: 0, missing: 0 }
      for (const piece of pieces) get().importShard(piece, undefined, piece.id)
      const id = get().importShard(markCameSealed(takeIntoKeeping(parent, me)))
      if (missing > 0) useToast.getState().show({ label: 'PART OF IT STAYED BEHIND', meta: `${missing === 1 ? 'One part' : `${missing} parts`} of this shard could not be opened here, so your copy shows ${missing === 1 ? 'a placeholder' : 'placeholders'} there.`, mark: 'build' })
      return { id, pieces: pieces.length, missing }
    },

    keepCopy: (id) => {
      const list = get().shards
      const i = list.findIndex((s) => s.id === id)
      if (i < 0 || (list[i] as Marked).lookCopy === undefined) return
      const next = list.slice()
      next[i] = unmarked(list[i])
      set({ shards: next })
      save(next)
    },

    back: () => {
      const stack = get().backStack
      const top = stack[stack.length - 1]
      if (!top) return
      // Another shard came onto the bench some other way: there is no level to go
      // back up, and every level is left as picking a shard leaves it.
      if (get().currentId !== top.child) {
        const left = leaveAll(get().currentId)
        if (left) save(left)
        set({ ...(left ? { shards: left } : {}), backStack: [] })
        return
      }
      const list = get().shards.slice()
      const frame = settle(list, top, null)
      // The shard to go back to was deleted meanwhile: the way in ends here, on what is shown.
      if (!list.some((s) => s.id === top.id)) { save(list); set({ shards: list, backStack: [] }); return }
      if (list.length !== get().shards.length || list.some((s, i) => s !== get().shards[i])) save(list)
      set({ shards: list, backStack: stack.slice(0, -1), currentId: frame.id, past: frame.past, future: frame.future, selection: [], partSel: [], selectedFaces: [], facePick: [], turnPivot: null, notice: null })
    },
  }
})

// lastCopy names indices in one shard object, the one the stamp left: an edit,
// UNDO, REDO, another shard opened or the library read again replaces it, and
// then the indices may have moved, so it goes.
useWorkshop.subscribe((st) => {
  if (st.lastCopy && (st.currentId !== st.lastCopy.shardId || st.current() !== copiedInto)) {
    copiedInto = null
    useWorkshop.setState({ lastCopy: null })
  }
})

attach({
  shards: () => kept(useWorkshop.getState().shards),
  replace: (given) => useWorkshop.setState((s) => {
    // A copy only looked at is in no stored list: it stays, as it was (untouchedLookCopy).
    const looks = s.shards.filter((x) => untouchedLookCopy(x) && !given.some((g) => g.id === x.id))
    const list = looks.length ? [...given, ...looks] : given
    return {
      shards: list,
      // A shard that is gone cannot stay the one on the bench.
      currentId: s.currentId !== null && !list.some((x) => x.id === s.currentId) ? null : s.currentId,
    }
  }),
  report: (message) => { if (useWorkshop.getState().storageError !== message) useWorkshop.setState({ storageError: message }) },
  protect: () => (useWorkshop.getState().open ? useWorkshop.getState().currentId : null),
  notice: (message) => useWorkshop.setState({ notice: message }),
})

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __workshop?: unknown }).__workshop = useWorkshop
}
