/**
 * smashPreview.ts - what a smash would take, shown before it happens (owner,
 * 2026-11-27: "while you hold the compiler, the blocks that will be
 * destroyed/included should pulse a highlight of some color to show whats
 * being included in the smash").
 *
 * The set is exactly what the smash deletes (smash.ts smashGroup: a
 * construction whole, anything else the connected blocks in the reach's box
 * round the hit), worked out by the same function, so the preview never
 * shows one thing and the smash takes another. Its colour tells the outcome:
 * mint when the set is a construction the smash compiles, the Compiler's
 * orange when it only breaks. A bare hand compiles any construction that fits
 * its reach of 3 (owner, 2026-11-28; smash.ts compiles); a longer isolated
 * build says TOO BIG FOR A BARE HAND.
 *
 * A set that is one of the game's own recipes built wrong (nearMiss.ts:
 * touching the ground or a block, or turned the wrong way) says why in the
 * warning red: "BREAKS 5 · TOUCHING THE
 * GROUND" (owner's lost Glowcore, 2026-11-28). An isolated turned recipe
 * still compiles, in either hand, as the shape it is, so it says "COMPILES ·
 * TURNED THE WRONG WAY": it will be compiled, but it is not the recipe
 * (review of #969).
 *
 * COMPILES means the set is a construction the smash will compile: its key is
 * made and its lookup checked. It never says whether a blueprint matches:
 * that takes the key (PBKDF2, 500,000 rounds) and the relay, and the Compiler
 * tells you nothing about prizes before a smash (smash.ts).
 *
 * The scene draws it (scene/SmashPreview.tsx) and the HUD prints its line
 * (terrain/TerrainView.tsx SmashPreviewLabel). Here are the rules, without
 * three or React: the set and its state, the colours, the pulse, the outer
 * faces of the set as one mesh, and the tracker that works the set out
 * again only when the aimed cell, the hand or the blocks change, after the
 * aim has rested PREVIEW_DEBOUNCE_MS.
 */

import { create } from 'zustand'
import type { Cell } from './arrangement'
import { compiles, smashGroup } from './smash'
import { CAUSE_WORDS, PRIZE_LABEL, missCause, missLabel, nearMiss, recipeOf, tooBigBare, type MissCause, type NearMiss, type RecipeId } from './nearMiss'

/** What the smash would do with the set: compile it (a construction), or only break it. */
export type PreviewState = 'compiles' | 'breaks'

/** TERRAIN's mint: the set is a construction, and the smash compiles it. */
export const PREVIEW_COMPILES = '#7cffc4'
/** The Compiler's orange: the set only breaks. */
export const PREVIEW_BREAKS = '#f47000'
/** The warning red (styles.css --danger): a game recipe built wrong, which only breaks. */
export const PREVIEW_NEAR_MISS = '#ff3b6b'

/** How long the aim rests on a new cell before the set is worked out again (a 31 by 31 by 31 gather with the Compiler). */
export const PREVIEW_DEBOUNCE_MS = 80
/** One pulse at rest, in milliseconds. */
export const PULSE_MS = 1200
/** The pulse at the end of a SMASH hold, in milliseconds: it quickens with the charge. */
export const PULSE_FULL_MS = 300

/** The overlay's opacity: the low and high of the pulse, and the steady level with reduced motion. */
export const PULSE_LOW = 0.16
export const PULSE_HIGH = 0.5
export const PULSE_STEADY = 0.34

/** One preview: the cells a smash at `hit` would delete, what it would do with them, and a fast lookup of the cells. */
export interface Preview {
  hit: Cell
  bare: boolean
  cells: Array<[number, number, number]>
  state: PreviewState
  /** The game recipe the set is, exactly, when it will yield (nearMiss.ts recipeOf): its prize is named. */
  prize: RecipeId | null
  /** A game recipe built wrong (nearMiss.ts); null otherwise. */
  miss: NearMiss | null
  /** Bare-handed, an isolated build longer than the bare reach of 3 (nearMiss.ts tooBigBare). */
  tooBig: boolean
  /** The cells packed relative to `hit` (packCell), to ask whether a cell is in the set without making strings (inSet). */
  keys: Set<number>
}

/**
 * A cell's offset from the struck block as one number, for a Set without strings. A smash set lies within 15 of the
 * block struck on every axis (smash.ts), so each offset is far inside PACK_REACH; packed from the field's origin it
 * collided far out in a field (review of #948).
 */
const SPAN = 1024
const HALF = 512
/** The farthest offset packCell keeps apart, on any axis. */
export const PACK_REACH = HALF - 2
export function packCell(dx: number, dy: number, dz: number): number {
  return ((dx + HALF) * SPAN + (dy + HALF)) * SPAN + (dz + HALF)
}

/** Whether a cell (field offsets) is in a preview's set. */
export function inSet(p: Pick<Preview, 'hit' | 'keys'>, x: number, y: number, z: number): boolean {
  const dx = x - p.hit[0], dy = y - p.hit[1], dz = z - p.hit[2]
  if (Math.abs(dx) > PACK_REACH || Math.abs(dy) > PACK_REACH || Math.abs(dz) > PACK_REACH) return false
  return p.keys.has(packCell(dx, dy, dz))
}

/**
 * What a smash at `hit` would do, by the smash's own function (smash.ts smashGroup); null when nothing is there.
 * `natural` tells natural ground (nearMiss.ts), for TOUCHING THE GROUND beside a build as well as under it.
 */
export function smashPreview(read: (x: number, y: number, z: number) => number, hit: Cell, bare: boolean, natural?: (x: number, y: number, z: number) => boolean): Preview | null {
  const g = smashGroup(read, hit, bare)
  if (!g.smash.length) return null
  // A construction compiles in either hand; the reach decided what was gathered (smash.ts compiles).
  const compiled = compiles(g.arrangement)
  const keys = new Set<number>()
  for (const c of g.smash) keys.add(packCell(c[0] - hit[0], c[1] - hit[1], c[2] - hit[2]))
  // Built wrong: touching or in the wrong hand only breaks; turned may compile, as another shape (nearMiss.ts).
  const miss = nearMiss(read, hit, natural)
  const tooBig = !compiled && !miss && tooBigBare(read, hit, bare, g)
  return { hit: [hit[0], hit[1], hit[2]], bare, cells: g.smash, state: compiled ? 'compiles' : 'breaks', prize: recipeOf(g.arrangement), miss, tooBig, keys }
}

/**
 * The words by the cross (coordinator's ruling, 2026-11-28, in the owner's style: short, never a contradiction):
 * an exact game recipe that will yield names its prize ("QUARRY CHARGE", "COMPILER"); a near miss never says
 * COMPILES, only what is wrong ("WRONG BLOCK", "2 WRONG BLOCKS", "MISSING A BLOCK", "TURNED", "NOT AIR GAPPED"); any
 * other isolated build says COMPILES (a player's blueprint may match it); anything else BREAKS and the count, with
 * TOO BIG FOR A BARE HAND when that is why.
 */
export function previewLabel(p: Pick<Preview, 'state' | 'cells' | 'prize' | 'miss' | 'tooBig'>): string {
  if (p.prize) return PRIZE_LABEL[p.prize]
  if (p.miss) return missLabel(p.miss)
  return previewLine(p.state, p.cells.length, p.tooBig ? 'big' : null)
}

/** Why the preview warns: a recipe built wrong, or a build too big for a bare hand; null when it does not. */
export function previewCause(p: Pick<Preview, 'miss' | 'tooBig'> | null): MissCause | null {
  return p?.miss ? missCause(p.miss) : p?.tooBig ? 'big' : null
}

/** The colour of a state: the warning red when the set is a recipe built wrong or too big for a bare hand. */
export function previewColor(state: PreviewState, cause: MissCause | null = null): string {
  // A prize named is the mint of COMPILES (previewLabel).
  return cause ? PREVIEW_NEAR_MISS : state === 'compiles' ? PREVIEW_COMPILES : PREVIEW_BREAKS
}

/** The line by the cross: COMPILES, or BREAKS and how many blocks, and why a recipe built wrong will not make its prize. */
export function previewLine(state: PreviewState, count: number, cause: MissCause | null = null): string {
  const head = state === 'compiles' ? 'COMPILES' : `BREAKS ${count}`
  return cause ? `${head} · ${CAUSE_WORDS[cause]}` : head
}

/** How long one pulse lasts for a hold `charge` of 0 (none, or not holding) to 1 (about to swing). */
export function pulsePeriod(charge: number): number {
  const c = Math.min(1, Math.max(0, charge))
  return PULSE_MS + (PULSE_FULL_MS - PULSE_MS) * c
}

/** The overlay's opacity at pulse phase `phase` (turns; 0 and every whole turn is the low); steady with reduced motion. */
export function pulseOpacity(phase: number, reduced: boolean): number {
  if (reduced) return PULSE_STEADY
  return PULSE_LOW + (PULSE_HIGH - PULSE_LOW) * (0.5 - 0.5 * Math.cos(2 * Math.PI * phase))
}

/** The phase after `dt` milliseconds at hold `charge`: advanced by turns, so a quickening pulse never jumps. */
export function advancePhase(phase: number, dt: number, charge: number): number {
  const p = phase + Math.max(0, dt) / pulsePeriod(charge)
  return p - Math.floor(p)
}

/** How far the outer faces stand off the blocks' faces, in blocks, so it never fights them. */
export const FACE_LIFT = 0.006

/** The six faces of a cell: the axis, the side, and the two axes across it in counter-clockwise order seen from outside. */
const FACES: ReadonlyArray<readonly [number, 1 | -1, number, number]> = [
  [0, 1, 1, 2], [0, -1, 2, 1],
  [1, 1, 2, 0], [1, -1, 0, 2],
  [2, 1, 0, 1], [2, -1, 1, 0],
]

/**
 * The set's outer faces as triangles (cells in the field's frame, a cell d spanning d to d + 1): every face of a cell
 * whose neighbour across it is not in the set, lifted FACE_LIFT off it. One array for the whole set, so it is one
 * mesh and one draw, never one per cell.
 */
export function outerFaces(cells: ReadonlyArray<Cell>, keys: ReadonlySet<number>, origin: Cell = [0, 0, 0]): Float32Array {
  // Whether the neighbour across a face is in the set, with no array made per face.
  const open = (c: Cell, a: number, s: number): boolean => !keys.has(packCell(c[0] - origin[0] + (a === 0 ? s : 0), c[1] - origin[1] + (a === 1 ? s : 0), c[2] - origin[2] + (a === 2 ? s : 0)))
  let faces = 0
  for (const c of cells) for (const [a, s] of FACES) if (open(c, a, s)) faces++
  const out = new Float32Array(faces * 18)
  let i = 0
  const v = [0, 0, 0]
  const put = (base: readonly number[], a: number, s: number, u: number, w: number, du: number, dw: number): void => {
    v[0] = base[0]; v[1] = base[1]; v[2] = base[2]
    v[a] += s > 0 ? 1 + FACE_LIFT : -FACE_LIFT
    v[u] += du; v[w] += dw
    out[i++] = v[0]; out[i++] = v[1]; out[i++] = v[2]
  }
  for (const c of cells) for (const [a, s, u, w] of FACES) {
    if (!open(c, a, s)) continue
    // Two triangles across the face: (0,0) (1,0) (1,1) and (0,0) (1,1) (0,1) in its own (u, w).
    put(c, a, s, u, w, 0, 0); put(c, a, s, u, w, 1, 0); put(c, a, s, u, w, 1, 1)
    put(c, a, s, u, w, 0, 0); put(c, a, s, u, w, 1, 1); put(c, a, s, u, w, 0, 1)
  }
  return out
}

/** What the tracker is aimed at this frame: the field, the cell, the hand and the blocks' version. */
export interface PreviewAim {
  field: object
  x: number
  y: number
  z: number
  bare: boolean
  version: number
}

/**
 * Works the preview out again only when what it depends on changes (the field, the aimed cell, the hand, the blocks'
 * version), and only once that has held for PREVIEW_DEBOUNCE_MS: never per frame. While a new aim waits, the old set
 * stays on screen if the new cell is in it with the same hand and the same blocks (sweeping across one build does not
 * blink), else nothing is shown, so a stale set never sits on a block it does not hold.
 */
export class PreviewTracker {
  /** The preview worked out last, for `done`; null when there was nothing there. */
  current: Preview | null = null
  /** How many times the set was worked out (tests). */
  computed = 0
  private doneField: object | null = null
  private doneX = 0; private doneY = 0; private doneZ = 0
  private doneBare = false
  private doneVersion = -1
  private has = false
  private seenField: object | null = null
  private seenX = 0; private seenY = 0; private seenZ = 0
  private seenBare = false
  private seenVersion = -1
  private seenAt = 0

  constructor(private readonly compute: (aim: PreviewAim) => Preview | null, private readonly debounceMs = PREVIEW_DEBOUNCE_MS) {}

  /** Nothing aimed: the preview goes at once. */
  clear(): void {
    this.has = false
    this.current = null
    this.seenField = null
  }

  /** One frame's aim; returns what to show now (the preview, the old one while a new aim waits, or null). */
  step(aim: PreviewAim | null, now: number): Preview | null {
    if (!aim) { this.clear(); return null }
    if (this.has && aim.field === this.doneField && aim.x === this.doneX && aim.y === this.doneY && aim.z === this.doneZ && aim.bare === this.doneBare && aim.version === this.doneVersion) {
      this.seenField = null
      return this.current
    }
    if (aim.field !== this.seenField || aim.x !== this.seenX || aim.y !== this.seenY || aim.z !== this.seenZ || aim.bare !== this.seenBare || aim.version !== this.seenVersion) {
      this.seenField = aim.field; this.seenX = aim.x; this.seenY = aim.y; this.seenZ = aim.z; this.seenBare = aim.bare; this.seenVersion = aim.version
      this.seenAt = now
    }
    if (now - this.seenAt >= this.debounceMs) {
      this.computed++
      this.current = this.compute(aim)
      this.has = true
      this.doneField = aim.field; this.doneX = aim.x; this.doneY = aim.y; this.doneZ = aim.z; this.doneBare = aim.bare; this.doneVersion = aim.version
      this.seenField = null
      return this.current
    }
    // Waiting: the old set only while the new cell is one of its own, with the same hand, in the same field.
    const old = this.has ? this.current : null
    if (old && aim.field === this.doneField && aim.bare === old.bare && aim.version === this.doneVersion && inSet(old, aim.x, aim.y, aim.z)) return old
    return null
  }
}

/** What the HUD prints by the cross: the state and the count of the preview on screen, or nothing. */
export interface SmashPreviewShown {
  state: PreviewState | null
  count: number
  /** Why a game recipe built wrong will not compile (nearMiss.ts), or null. */
  cause: MissCause | null
  /** The words by the cross (previewLabel), or empty with nothing shown. */
  label: string
}

/** The preview on screen, for the HUD's line: set by the scene only when it changes, never per frame. */
export const useSmashPreview = create<SmashPreviewShown>(() => ({ state: null, count: 0, cause: null, label: '' }))

/** Tell the HUD what is shown, only when that changed. */
export function showPreview(p: Preview | null): void {
  const state = p?.state ?? null
  const count = p?.cells.length ?? 0
  const cause = previewCause(p)
  const label = p ? previewLabel(p) : ''
  const now = useSmashPreview.getState()
  if (now.state !== state || now.count !== count || now.cause !== cause || now.label !== label) useSmashPreview.setState({ state, count, cause, label })
}
