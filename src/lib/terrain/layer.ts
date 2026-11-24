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
 * Kept on the device only for now. Publishing (kind 33336, sealed to the
 * region key) adds the settles and the per-placement t0 and t1 of §5.3 and
 * §5.5; this plane is what goes inside.
 */

import { CELLS } from './coords'
import { GENERATOR_VERSION } from './generate'

/** The ground revision written (DECK §3.10: absent means 1). */
const GROUND: number = GENERATOR_VERSION

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

function plane(form: 'diff' | 'whole', p: 0 | 1, generated: Uint8Array, current: Uint8Array): Layer {
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
  return { plane: p, survey: true, ...(GROUND !== 1 ? { ground: GROUND } : {}), form, pal, cells: runs(cells) }
}

/** The diff of `current` from `generated`. */
export const diffLayer = (generated: Uint8Array, current: Uint8Array, p: 0 | 1 = 0): Layer => plane('diff', p, generated, current)

/** The whole of `current`. */
export const wholeLayer = (current: Uint8Array, p: 0 | 1 = 0): Layer => plane('whole', p, current, current)

/** The plane to write: the diff or the whole chunk, whichever is shorter as compact JSON (DECK §5.5). */
export function encodeLayer(generated: Uint8Array, current: Uint8Array, p: 0 | 1 = 0): Layer {
  const d = diffLayer(generated, current, p)
  const w = wholeLayer(current, p)
  return JSON.stringify(w).length < JSON.stringify(d).length ? w : d
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
 * The chunk a layer describes, over `generated`; null when it cannot be read
 * (malformed, or a diff against a ground revision this code does not make).
 */
export function applyLayer(generated: Uint8Array, layer: Layer): Uint8Array | null {
  if (!isLayer(layer)) return null
  if ((layer.ground ?? 1) !== GENERATOR_VERSION) return null
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
