/**
 * blockShapes.ts: the boxes a block that is not a cube is drawn as (design
 * 4.6), in ticks inside its one block (0 to 120 on each axis, 120 ticks to a
 * model unit, sno-core TICKS_PER_UNIT).
 *
 * Coordinates here are the file's own: x east, y up, z south. lib/blocks/
 * blockShard.ts turns them into SNO's frame.
 *
 * | Shape | Drawn as |
 * |---|---|
 * | slab | a half-height box, top or bottom |
 * | stairs | boxes in an L, turned by `facing`, upside down when `half` is top |
 * | fence | a post and two rails toward each neighbour it joins |
 * | gate | two rails across the block |
 * | wall | a thick post and a low wall toward each neighbour it joins |
 * | pane, bars | a thin post and a thin pane toward each neighbour it joins |
 * | door | a thin slab on the side it closes against |
 * | trapdoor | a thin slab at the top or bottom, or against a side when open |
 * | carpet, snow layer, bed | a thin or low layer |
 * | decoration | a small marker at the bottom of the block |
 *
 * Every box is whole ticks, so it lands on the lattice exactly. Pure.
 */

import type { Shape } from './colourTable'

/** One box: [x0, y0, z0, x1, y1, z1] in ticks, 0 to 120. */
export type Box = [number, number, number, number, number, number]

export const T = 120
const H = 60

const FULL: Box = [0, 0, 0, T, T, T]

/** Which way a neighbour lies, by the names states use. */
const DIRS = ['north', 'south', 'east', 'west'] as const
type Dir = typeof DIRS[number]

/** A box running from the centre strip toward one side: thickness `a..b` across, `y0..y1` high. */
function arm(dir: Dir, near: number, a: number, b: number, y0: number, y1: number): Box {
  switch (dir) {
    case 'north': return [a, y0, 0, b, y1, near]
    case 'south': return [a, y0, T - near, b, y1, T]
    case 'east': return [T - near, y0, a, T, y1, b]
    case 'west': return [0, y0, a, near, y1, b]
  }
}

/** A thin slab of `depth` ticks against the side a door or open trapdoor facing `facing` closes on. */
function against(facing: string, depth: number): Box {
  switch (facing) {
    case 'south': return [0, 0, 0, T, T, depth]
    case 'east': return [0, 0, 0, depth, T, T]
    case 'west': return [T - depth, 0, 0, T, T, T]
    default: return [0, 0, T - depth, T, T, T]
  }
}

/** Whether a state joins its neighbour that way: `true`, or a wall's `low` or `tall`. */
const joins = (v: string | undefined): boolean => v === 'true' || v === 'low' || v === 'tall'

/** The boxes a shape is drawn as, for a state's properties. A cube is one full box. */
export function boxesFor(shape: Shape, props: Readonly<Record<string, string>>): Box[] {
  switch (shape) {
    case 'cube': return [FULL]
    case 'slab-bottom': return [[0, 0, 0, T, H, T]]
    case 'slab-top': return [[0, H, 0, T, T, T]]
    case 'stairs': {
      // A half-height layer in two halves (low, or high when upside down) and the other half's quarter on the
      // `facing` side. Every box meets the next face to face over a whole face, so no face inside is drawn.
      const top = props.half === 'top'
      const [l0, l1] = top ? [H, T] : [0, H]
      const [u0, u1] = top ? [0, H] : [H, T]
      switch (props.facing) {
        case 'south': return [[0, l0, H, T, l1, T], [0, l0, 0, T, l1, H], [0, u0, H, T, u1, T]]
        case 'east': return [[H, l0, 0, T, l1, T], [0, l0, 0, H, l1, T], [H, u0, 0, T, u1, T]]
        case 'west': return [[0, l0, 0, H, l1, T], [H, l0, 0, T, l1, T], [0, u0, 0, H, u1, T]]
        default: return [[0, l0, 0, T, l1, H], [0, l0, H, T, l1, T], [0, u0, 0, T, u1, H]]
      }
    }
    case 'fence': {
      const out: Box[] = [[45, 0, 45, 75, T, 75]]
      for (const d of DIRS) if (joins(props[d])) out.push(arm(d, 45, 53, 68, 45, 68), arm(d, 45, 53, 68, 90, 113))
      return out
    }
    case 'gate': {
      const alongX = props.facing === 'north' || props.facing === 'south' || props.facing === undefined
      return alongX
        ? [[0, 45, 53, T, 68, 68], [0, 90, 53, T, 113, 68]]
        : [[53, 45, 0, 68, 68, T], [53, 90, 0, 68, 113, T]]
    }
    case 'wall': {
      const out: Box[] = [[30, 0, 30, 90, T, 90]]
      for (const d of DIRS) if (joins(props[d])) out.push(arm(d, 30, 45, 75, 0, props[d] === 'tall' ? T : 105))
      return out
    }
    case 'pane': {
      const out: Box[] = [[53, 0, 53, 68, T, 68]]
      for (const d of DIRS) if (joins(props[d])) out.push(arm(d, 53, 53, 68, 0, T))
      return out
    }
    case 'door': return [against(props.facing ?? 'north', 23)]
    case 'trapdoor':
      if (props.open === 'true') return [against(props.facing ?? 'north', 23)]
      return [props.half === 'top' ? [0, 97, 0, T, T, T] : [0, 0, 0, T, 23, T]]
    case 'carpet': return [[0, 0, 0, T, 8, T]]
    case 'layer': {
      const n = Math.max(1, Math.min(8, Number(props.layers) || 1))
      return [[0, 0, 0, T, n * 15, T]]
    }
    case 'bed': return [[0, 0, 0, T, 68, T]]
    case 'decor': return [[45, 0, 45, 75, H, 75]]
  }
}

/** Whether a set of boxes is the whole block. */
export function isFull(boxes: readonly Box[]): boolean {
  return boxes.length === 1 && boxes[0].every((n, i) => n === FULL[i])
}
