/**
 * layer.ts - one builder's changes to one chunk, written down as DECK-0009
 * §5.5 writes a plane of a block layer: the difference from the generated
 * ground, or the whole chunk when that is smaller (decision D11; benchmark
 * part 3), as plain JSON integers with no compression (arkinox, 2026-11-21):
 *
 *   { plane, survey: true, form: 'diff' | 'whole', pal, cells }
 *
 * `pal` is the palette of global ids; in a diff its entry 0 is null, "the
 * ground's value of this cell". `cells` walks the 32,768 cells in index order
 * (coords.ts idx) as runs: a palette index, then, when it repeats, a negative
 * number for how many more cells repeat it.
 *
 * Kept on the device; while LIVE store/terrainShare.ts publishes it (kind
 * 33339, sealed to the region key, DECK-0009 §5), and this plane is what
 * goes inside.
 *
 * Each layer names the ground revision it was written against (`ground`):
 * the chunk's own revision (lib/terrain/groundRevision.ts), 2 for every
 * layer made before revision 3. A diff is read against that revision's
 * ground, whatever the chunk's revision is now (rebaseBlocks moves it).
 */

import { CELLS } from './coords'
import { isGroundRevision, type GroundRevision } from './generate'

export interface Layer {
  plane: 0 | 1
  /** Surveyed: the base is the generated ground (DECK §3.1). Always true here: a chunk is changed only once surveyed. */
  survey: true
  /** The ground revision the base is (DECK §3.10); absent means 1. */
  ground?: number
  form: 'diff' | 'whole'
  pal: Array<number | null>
  cells: number[]
}

/** Runs of palette indexes (DECK §5.4). */
function runs(values: ArrayLike<number>): number[] {
  const out: number[] = []
  let i = 0
  while (i < values.length) {
    const v = values[i]
    let j = i + 1
    while (j < values.length && values[j] === v) j++
    out.push(v)
    if (j - i > 1) out.push(-(j - i - 1))
    i = j
  }
  return out
}

/** Expand runs into `into`; false when they are not exactly its length or name an index past `limit`. */
function unrun(r: unknown, into: Uint16Array, limit: number): boolean {
  if (!Array.isArray(r)) return false
  let o = 0
  let last = -1
  for (const n of r) {
    if (!Number.isInteger(n) || Object.is(n, -0)) return false
    if (n < 0) {
      if (last < 0 || o - n > into.length) return false
      into.fill(last, o, o - n)
      o -= n
    } else {
      if (n >= limit || o >= into.length) return false
      into[o++] = n
      last = n
    }
  }
  return o === into.length
}

function plane(form: 'diff' | 'whole', p: 0 | 1, generated: Uint8Array, current: Uint8Array, revision: GroundRevision): Layer {
  const pal: Array<number | null> = form === 'diff' ? [null] : []
  const at = new Map<number, number>()
  const cells = new Uint16Array(CELLS)
  for (let o = 0; o < CELLS; o++) {
    const c = current[o]
    if (form === 'diff' && c === generated[o]) continue
    let i = at.get(c)
    if (i === undefined) { i = pal.length; at.set(c, i); pal.push(c) }
    cells[o] = i
  }
  return { plane: p, survey: true, ground: revision, form, pal, cells: runs(cells) }
}

/** The diff of `current` from `generated`, the ground at `revision`. */
export const diffLayer = (generated: Uint8Array, current: Uint8Array, p: 0 | 1, revision: GroundRevision): Layer => plane('diff', p, generated, current, revision)

/** The whole of `current`, over the ground at `revision`. */
export const wholeLayer = (current: Uint8Array, p: 0 | 1, revision: GroundRevision): Layer => plane('whole', p, current, current, revision)

/** The plane to write: the diff or the whole chunk, whichever is shorter as compact JSON (DECK §5.5), against the ground at `revision`. */
export function encodeLayer(generated: Uint8Array, current: Uint8Array, p: 0 | 1, revision: GroundRevision): Layer {
  const d = diffLayer(generated, current, p, revision)
  const w = wholeLayer(current, p, revision)
  return JSON.stringify(w).length < JSON.stringify(d).length ? w : d
}

/** The ground revision a layer was written against, or null when it names none this client makes (absent is revision 1). */
export function layerRevision(l: Pick<Layer, 'ground'>): GroundRevision | null {
  return isGroundRevision(l.ground) ? l.ground : null
}

/**
 * Your blocks moved from one revision's ground to another's: a cell you never
 * changed (it holds `from`'s ground, and is not in `explicit`) takes `to`'s
 * ground; every cell you changed keeps its value. The rock and caves of
 * revisions 2 and 3 are the same, so only vein and rare cells can move.
 */
export function rebaseBlocks(values: Uint8Array, from: Uint8Array, to: Uint8Array, explicit: ReadonlySet<number> = new Set()): Uint8Array {
  const out = new Uint8Array(CELLS)
  for (let o = 0; o < CELLS; o++) out[o] = values[o] === from[o] && !explicit.has(o) ? to[o] : values[o]
  return out
}

/** Whether a layer changes nothing. */
export function emptyLayer(l: Layer): boolean {
  return l.form === 'diff' && l.pal.length === 1
}

/** Whether a stored value is a layer this code can read. */
export function isLayer(v: unknown): v is Layer {
  const l = v as Layer | null
  return !!l && (l.plane === 0 || l.plane === 1) && l.survey === true && (l.form === 'diff' || l.form === 'whole') && Array.isArray(l.pal) && Array.isArray(l.cells)
}

/**
 * The chunk a layer describes, over `generated`, the ground at `revision`;
 * null when it cannot be read (malformed, or a diff against another
 * revision's ground: read it over that one, layerRevision).
 */
export function applyLayer(generated: Uint8Array, layer: Layer, revision: GroundRevision): Uint8Array | null {
  if (!isLayer(layer)) return null
  // A whole chunk stands by itself; only a diff depends on the ground it was taken against.
  if (layer.form === 'diff' && layer.ground !== revision) return null
  const pal = layer.pal
  if (pal.length < 1 || pal.length > 256) return null
  for (let i = 0; i < pal.length; i++) {
    const g = pal[i]
    if (layer.form === 'diff' && i === 0) { if (g !== null) return null; continue }
    // Ids above 255 are the DECK's extension space: this client's cells hold one byte, so it cannot keep them.
    if (!Number.isInteger(g) || (g as number) < 0 || (g as number) > 255) return null
  }
  const cells = new Uint16Array(CELLS)
  if (!unrun(layer.cells, cells, pal.length)) return null
  const out = new Uint8Array(CELLS)
  for (let o = 0; o < CELLS; o++) {
    const g = pal[cells[o]]
    out[o] = g === null ? generated[o] : g
  }
  return out
}
