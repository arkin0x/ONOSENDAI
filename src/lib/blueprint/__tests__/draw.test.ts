/**
 * draw.test.ts: the blueprint drawings (lib/blueprint/draw.ts), on a stand-in
 * 2D context that records its calls (jsdom has no canvas):
 *
 * - the isometric view paints back to front, and a cutaway drops the front quarter;
 * - each view along an axis shows the first block met, with its depth, in the
 *   sheet's layout (sun side at the bottom from above, on the left from +X);
 * - hasInterior: a sealed hollow or a buried block, never an open cup;
 * - a tap names the front-most block under it;
 * - the compass turned to look from the sun puts the black sun at its centre.
 */
import { describe, expect, it } from 'vitest'
import { axisGrid, buriedCells, drawCompass, drawIso, enclosedEmpty, hasInterior, isoHit, isoLayout, isoOrder, isoPoint, SUN_CORE, type TileImages } from '../draw'
import { cellAt, cellIndex, type FinderView } from '../format'

type Call = { fn: string; args: unknown[]; state: Record<string, unknown> }

/** A 2D context that records every call, with the style it was made under. */
function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = []
  const state: Record<string, unknown> = {}
  const gradient = { addColorStop: () => {} }
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key]
      return (...args: unknown[]) => {
        calls.push({ fn: key, args, state: { ...target } })
        return key === 'createRadialGradient' || key === 'createLinearGradient' ? gradient : undefined
      }
    },
    set(target, key: string, value) { target[key] = value; return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls }
}

/** A view of a box from cells: [x, y, z, id], id 0 for a hidden (smoke) block. */
function viewOf(size: [number, number, number], cells: Array<[number, number, number, number]>): FinderView {
  const occupied = new Array<boolean>(size[0] * size[1] * size[2]).fill(false)
  const revealed = new Map<number, number>()
  for (const [x, y, z, id] of cells) {
    const i = cellIndex(size, x, y, z)
    occupied[i] = true
    if (id) revealed.set(i, id)
  }
  return { size, occupied, revealed }
}

function solid(size: [number, number, number], id = 1, skip?: (x: number, y: number, z: number) => boolean): FinderView {
  const cells: Array<[number, number, number, number]> = []
  for (let y = 0; y < size[1]; y++) for (let z = 0; z < size[2]; z++) for (let x = 0; x < size[0]; x++) if (!skip?.(x, y, z)) cells.push([x, y, z, id])
  return viewOf(size, cells)
}

describe('isometric painter order', () => {
  it('draws back to front: every cell before the ones nearer the viewer', () => {
    const v = solid([3, 3, 3])
    const order = isoOrder(v)
    expect(order).toHaveLength(27)
    // Seen from the (+X, +Y, -Z) corner: (0, 0, 2) is furthest, (2, 2, 0) nearest.
    expect(order[0]).toBe(cellIndex(v.size, 0, 0, 2))
    expect(order[26]).toBe(cellIndex(v.size, 2, 2, 0))
    const pos = new Map(order.map((i, k) => [i, k]))
    for (const i of order) {
      const [x, y, z] = cellAt(v.size, i)
      for (const [dx, dy, dz] of [[1, 0, 0], [0, 1, 0], [0, 0, -1]]) {
        const nx = x + dx, ny = y + dy, nz = z + dz
        if (nx < 3 && ny < 3 && nz >= 0) expect(pos.get(i)!).toBeLessThan(pos.get(cellIndex(v.size, nx, ny, nz))!)
      }
    }
  })

  it('paints the tiles in that order', () => {
    const v = viewOf([2, 1, 2], [[1, 0, 1, 1], [0, 0, 0, 2], [1, 0, 0, 3], [0, 0, 1, 4]])
    const pics = new Map<number, object>([[1, { id: 1 }], [2, { id: 2 }], [3, { id: 3 }], [4, { id: 4 }]])
    const tiles: TileImages = { get: (id) => pics.get(id) as CanvasImageSource }
    const { ctx, calls } = fakeCtx()
    drawIso(ctx, v, { x: 0, y: 0, size: 200, tiles })
    const seen = calls.filter((c) => c.fn === 'drawImage').map((c) => (c.args[0] as { id: number }).id)
    const firstOf = (id: number): number => seen.indexOf(id)
    // (0,0,1) is furthest back from the (+X, +Y, -Z) corner; (1,0,0) nearest.
    expect(firstOf(4)).toBe(0)
    expect(firstOf(3)).toBeGreaterThan(firstOf(1))
    expect(firstOf(3)).toBeGreaterThan(firstOf(2))
  })

  it('a cutaway leaves out the front quarter', () => {
    const v = solid([4, 2, 4])
    const cut = isoOrder(v, true)
    expect(cut).toHaveLength(32 - 8)
    for (const i of cut) { const [x, , z] = cellAt(v.size, i); expect(x >= 2 && z < 2).toBe(false) }
  })

  it('hidden blocks are smoke: no tile is drawn for them', () => {
    const v = viewOf([1, 1, 1], [[0, 0, 0, 0]])
    const { ctx, calls } = fakeCtx()
    drawIso(ctx, v, { x: 0, y: 0, size: 80, tiles: { get: () => ({}) as CanvasImageSource } })
    expect(calls.some((c) => c.fn === 'drawImage')).toBe(false)
    expect(calls.filter((c) => c.fn === 'createRadialGradient').length).toBeGreaterThan(0)
  })

  it('keeps the same scale whether the layers are apart or together', () => {
    const a = isoLayout([3, 4, 3], { x: 0, y: 0, size: 300, exploded: 1 })
    const b = isoLayout([3, 4, 3], { x: 0, y: 0, size: 300, exploded: 0 })
    expect(a).toEqual(b)
  })
})

describe('views along an axis', () => {
  // A column of two at (0, *, 0) and one block at (1, 0, 1), in a 2 by 2 by 2 box.
  const v = viewOf([2, 2, 2], [[0, 0, 0, 1], [0, 1, 0, 2], [1, 0, 1, 3]])

  it('from above: the top block of each column, X across and +Z up (the sun at the top edge)', () => {
    const g = axisGrid(v, 'y')
    expect([g.cols, g.rows]).toEqual([2, 2])
    // Row 0 is +Z (z = 1), row 1 is z = 0.
    expect(g.cells[2]).toMatchObject({ index: cellIndex(v.size, 0, 1, 0), depth: 0 })
    expect(g.cells[1]).toMatchObject({ index: cellIndex(v.size, 1, 0, 1), depth: 1 })
    expect(g.cells[0]).toBeNull()
    expect(g.cells[3]).toBeNull()
  })

  it('facing the sun: X across, Y up, the first block met from z = 0', () => {
    const g = axisGrid(v, 'z')
    expect(g.cells[0]).toMatchObject({ index: cellIndex(v.size, 0, 1, 0), depth: 0 })
    expect(g.cells[1]).toBeNull()
    expect(g.cells[2]).toMatchObject({ index: cellIndex(v.size, 0, 0, 0), depth: 0 })
    expect(g.cells[3]).toMatchObject({ index: cellIndex(v.size, 1, 0, 1), depth: 1 })
  })

  it('from +X: +Z on the right, the nearest block along -X', () => {
    const g = axisGrid(v, 'x')
    // Column 1 is +Z (z = 1), bottom row is Y0.
    expect(g.cells[3]).toMatchObject({ index: cellIndex(v.size, 1, 0, 1), depth: 0 })
    expect(g.cells[2]).toMatchObject({ index: cellIndex(v.size, 0, 0, 0), depth: 1 })
    expect(g.cells[0]).toMatchObject({ index: cellIndex(v.size, 0, 1, 0), depth: 1 })
    expect(g.cells[1]).toBeNull()
  })
})

describe('hasInterior', () => {
  it('a small solid has no inside', () => {
    expect(hasInterior(solid([2, 2, 2]))).toBe(false)
  })

  it('a solid 3 by 3 by 3 has a buried centre', () => {
    const v = solid([3, 3, 3])
    expect([...buriedCells(v)]).toEqual([cellIndex(v.size, 1, 1, 1)])
    expect(hasInterior(v)).toBe(true)
  })

  it('a sealed box has a hollow', () => {
    const v = solid([3, 3, 3], 1, (x, y, z) => x === 1 && y === 1 && z === 1)
    expect([...enclosedEmpty(v)]).toEqual([cellIndex(v.size, 1, 1, 1)])
    expect(hasInterior(v)).toBe(true)
  })

  it('an open cup has none', () => {
    const v = solid([3, 2, 3], 1, (x, y, z) => x === 1 && y === 1 && z === 1)
    expect(enclosedEmpty(v).size).toBe(0)
    expect(hasInterior(v)).toBe(false)
  })
})

describe('isoHit', () => {
  it('names the block under the point, or none', () => {
    const v = solid([1, 1, 1])
    const opts = { x: 0, y: 0, size: 100 }
    const L = isoLayout(v.size, opts)
    const c = isoPoint(L, 0.5, 0.5, 0.5)
    expect(isoHit(v, opts, c[0], c[1])).toBe(0)
    expect(isoHit(v, opts, 1, 1)).toBeNull()
  })

  it('the front-most block wins where two overlap', () => {
    const v = solid([2, 1, 1])
    const opts = { x: 0, y: 0, size: 100 }
    const L = isoLayout(v.size, opts)
    const shared = isoPoint(L, 1, 0.5, 0.5)
    expect(isoHit(v, opts, shared[0], shared[1])).toBe(cellIndex(v.size, 1, 0, 0))
    const back = isoPoint(L, 0, 0.5, 0.8)
    expect(isoHit(v, opts, back[0], back[1])).toBe(cellIndex(v.size, 0, 0, 0))
  })

  it('a stacked build: the top block from above, the lower one at its foot', () => {
    const v = solid([1, 2, 1])
    const opts = { x: 0, y: 0, size: 100 }
    const L = isoLayout(v.size, opts)
    const top = isoPoint(L, 0.5, 2, 0.5)
    expect(isoHit(v, opts, top[0], top[1])).toBe(cellIndex(v.size, 0, 1, 0))
    const foot = isoPoint(L, 1, 0.2, 0.9)
    expect(isoHit(v, opts, foot[0], foot[1])).toBe(cellIndex(v.size, 0, 0, 0))
  })
})

describe('drawCompass', () => {
  it('from the sun, the black sun rings the centre', () => {
    const { ctx, calls } = fakeCtx()
    drawCompass(ctx, 50, 50, 40, 'z')
    const ring = calls.find((c) => c.fn === 'stroke' && c.state.strokeStyle === SUN_CORE)
    expect(ring).toBeTruthy()
    const arcs = calls.filter((c) => c.fn === 'arc' && c.args[0] === 50 && c.args[1] === 50)
    expect(arcs.length).toBeGreaterThan(1)
  })

  it('isometric: three arrows, the sun past +Z', () => {
    const { ctx, calls } = fakeCtx()
    drawCompass(ctx, 50, 50, 40, 'iso')
    expect(calls.filter((c) => c.fn === 'lineTo' && c.args[0] !== undefined).length).toBeGreaterThanOrEqual(3)
    // The sun sits up and to the right of centre (+Z in the isometric view, seen from the (+X, +Y, -Z) corner).
    const sun = calls.find((c) => c.fn === 'arc' && (c.args[0] as number) > 50 && (c.args[1] as number) < 50)
    expect(sun).toBeTruthy()
  })
})

describe('the black sun beside the isometric drawing', () => {
  // The box's outline on screen and a point's distance to it (outside), from the drawing's own projection.
  const outline = (L: ReturnType<typeof isoLayout>, s: readonly [number, number, number]): Array<[number, number]> => {
    const pts: Array<[number, number]> = []
    for (const X of [0, s[0]]) for (const Y of [0, s[1]]) for (const Z of [0, s[2]]) pts.push(isoPoint(L, X, Y, Z))
    return pts
  }
  const segDist = (p: [number, number], a: [number, number], b: [number, number]): number => {
    const ex = b[0] - a[0], ey = b[1] - a[1]
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey || 1)))
    return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t)
  }
  // Distance to the nearest edge between any two corners: never more than the true distance to the outline.
  const nearest = (p: [number, number], pts: Array<[number, number]>): number => {
    let best = Infinity
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) best = Math.min(best, segDist(p, pts[i], pts[j]))
    return best
  }

  for (const s of [[1, 1, 1], [3, 2, 3], [16, 16, 16], [16, 1, 1], [1, 16, 1], [1, 1, 16]] as const) {
    it(`a ${s.join(' by ')} box: the line reaches well past the box, the sun's glow stays clear of it, and everything fits`, () => {
      const L = isoLayout(s, { x: 0, y: 0, size: 320, floor: true, compass: 24 })
      expect(L.sun).toBeTruthy()
      const sun = L.sun!
      const at = (q: readonly number[]): [number, number] => [L.ox + q[0] * L.u, L.oy + q[1] * L.u]
      const pts = outline(L, s)
      const S = at(sun.s), B = at(sun.b), r = sun.r * L.u
      // The glow (about 1.9 radii) at least 16 px from the box.
      expect(nearest(S, pts) - r * 1.9).toBeGreaterThanOrEqual(15.5)
      // The line's end at least 48 px past the box along +Z (at the outline's 60 degree crossing, 48 x sin 60 straight out).
      expect(nearest(B, pts)).toBeGreaterThanOrEqual(48 * Math.sin(Math.PI / 3) - 1)
      // The sun and its glow inside the panel; the "+Z" label too.
      expect(S[0] + r * 1.9).toBeLessThanOrEqual(320)
      expect(S[1] - r * 1.9).toBeGreaterThanOrEqual(0)
      expect(S[0] + r * 1.8 + sun.font * L.u * 1.4).toBeLessThanOrEqual(320.5)
      // The sun runs up and to the right of the build's +Z face.
      const A = at(sun.a)
      expect(S[0]).toBeGreaterThan(A[0]); expect(S[1]).toBeLessThan(A[1])
      // The compass corner, top left, is clear of the box.
      const pad = 320 * 0.05
      expect(nearest([pad + 24, pad + 24], pts)).toBeGreaterThanOrEqual(24)
    })
  }

  it('the sun is the same size, against the drawing, for a tiny build and a big one', () => {
    const r = (s: readonly [number, number, number]): number => { const L = isoLayout(s, { x: 0, y: 0, size: 320, floor: true }); return L.sun!.r * L.u }
    expect(Math.abs(r([1, 1, 1]) - r([16, 16, 16]))).toBeLessThan(3)
  })
})
