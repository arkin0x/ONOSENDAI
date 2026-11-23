/**
 * markerClear.test.ts: a target's marker never draws over the menu's panels,
 * and still shows when there is room (owner, 2026-11-23: "can we make these
 * target markers not go over the menus?").
 */

import { describe, expect, it } from 'vitest'
import { boxesOverlap, edgePlace, hiddenByCover, keepOut, markerBox, type Reach } from '../markerClear'
import type { Box } from '../coverBand'

const CHEVRON: Reach = { left: -10, top: -10, right: 10, bottom: 10 }
/** A chevron with a 112px name and distance beside it, as Targets.tsx works it out. */
const MARKER: Reach = { left: -10, top: -12, right: 130, bottom: 12 }
const INSET = 26

/** Bearings all the way round, from the picture's middle, far off the screen. */
function farPoints(cx: number, cy: number, n = 360): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push([cx + Math.cos(a) * 5000, cy + Math.sin(a) * 5000])
  }
  return out
}

/** Inside the screen, the frame's inset kept. */
function onScreen(x: number, y: number, w: number, h: number): boolean {
  return x >= INSET - 1e-6 && x <= w - INSET + 1e-6 && y >= INSET - 1e-6 && y <= h - INSET + 1e-6
}

describe('edgePlace', () => {
  it('with nothing open, slides along the bearing to the inset edge as before', () => {
    const p = edgePlace(1280, 800, 640, 400, -5000, 400, INSET, [], MARKER, CHEVRON)
    expect(p).toEqual({ x: INSET, y: 400, angle: Math.PI })
    const q = edgePlace(1280, 800, 640, 400, 640, 9000, INSET, [], MARKER, CHEVRON)
    expect(q.x).toBeCloseTo(640)
    expect(q.y).toBeCloseTo(800 - INSET)
  })

  // A desktop with the menu open beside the scene: two columns, the left one
  // full height, the right one short, as in the owner's screenshot.
  const W = 1280
  const H = 800
  const left: Box = { left: 16, top: 16, right: 336, bottom: 784 }
  const right: Box = { left: 964, top: 16, right: 1264, bottom: 420 }
  const covers = [left, right]

  it('never puts any part of a marker over a panel, whichever way the target is', () => {
    for (const [x, y] of farPoints(W / 2, H / 2)) {
      const p = edgePlace(W, H, W / 2, H / 2, x, y, INSET, covers, MARKER, CHEVRON)
      const box = markerBox(p.x, p.y, MARKER)
      for (const c of covers) expect(boxesOverlap(box, c), `bearing to ${x.toFixed(0)},${y.toFixed(0)}`).toBe(false)
      expect(onScreen(p.x, p.y, W, H)).toBe(true)
    }
  })

  it('keeps the bearing: the marker stands on the line from the middle toward the target', () => {
    for (const [x, y] of farPoints(W / 2, H / 2, 72)) {
      const p = edgePlace(W, H, W / 2, H / 2, x, y, INSET, covers, MARKER, CHEVRON)
      const cross = (p.x - W / 2) * (y - H / 2) - (p.y - H / 2) * (x - W / 2)
      expect(Math.abs(cross) / Math.hypot(x - W / 2, y - H / 2)).toBeLessThan(1e-6)
      expect((p.x - W / 2) * (x - W / 2) + (p.y - H / 2) * (y - H / 2)).toBeGreaterThan(0)
    }
  })

  it('stops a marker heading left beside the column, with room to show it', () => {
    const p = edgePlace(W, H, W / 2, H / 2, -5000, H / 2, INSET, covers, MARKER, CHEVRON)
    // Just past the column's inner side, the chevron's reach clear of it.
    expect(p.x).toBeGreaterThanOrEqual(left.right - CHEVRON.left)
    expect(p.x).toBeLessThan(left.right - CHEVRON.left + 1)
    expect(p.y).toBeCloseTo(H / 2)
  })

  it('passes under a short column to the screen edge when the way is clear', () => {
    // Right and down, below the short right column.
    const p = edgePlace(W, H, W / 2, H / 2, 6000, H / 2 + 2500, INSET, covers, MARKER, CHEVRON)
    expect(p.x).toBeCloseTo(W - INSET, 0)
    expect(boxesOverlap(markerBox(p.x, p.y, MARKER), right)).toBe(false)
  })

  it('keeps the whole name clear of a column on the right, not just the chevron', () => {
    const p = edgePlace(W, H, W / 2, H / 2, 6000, 200, INSET, covers, MARKER, CHEVRON)
    expect(markerBox(p.x, p.y, MARKER).right).toBeLessThanOrEqual(right.left)
  })

  it('stands the chevron alone beside a panel when the name cannot be kept clear from the middle', () => {
    // A narrow window: the right column's box grown by a long name holds the middle.
    const w = 700
    const r: Box = { left: 420, top: 0, right: 700, bottom: 800 }
    const long: Reach = { left: -10, top: -12, right: 330, bottom: 12 }
    expect(keepOut(r, long).left).toBeLessThan(w / 2)
    const p = edgePlace(w, 800, w / 2, 400, 9000, 400, INSET, [r], long, CHEVRON)
    expect(markerBox(p.x, p.y, CHEVRON).right).toBeLessThanOrEqual(r.left)
    expect(p.x).toBeGreaterThan(w / 2)
  })

  it('leaves a cover out when even the chevron cannot stand clear of it (a sheet over the middle)', () => {
    const sheet: Box = { left: 0, top: 0, right: 1280, bottom: 800 }
    const p = edgePlace(W, H, W / 2, H / 2, -5000, H / 2, INSET, [sheet], MARKER, CHEVRON)
    expect(p.x).toBe(INSET)
  })

  it('a phone held upright with a sheet along the bottom: markers heading down stand above it', () => {
    const w = 375
    const h = 812
    const sheet: Box = { left: 0, top: 560, right: 375, bottom: 812 }
    for (const [x, y] of farPoints(w / 2, h / 2)) {
      const p = edgePlace(w, h, w / 2, h / 2, x, y, INSET, [sheet], MARKER, CHEVRON)
      expect(boxesOverlap(markerBox(p.x, p.y, MARKER), sheet)).toBe(false)
      expect(p.y).toBeLessThanOrEqual(sheet.top)
    }
  })

  it('points from the shifted middle in BUILD', () => {
    const p = edgePlace(W, H, 700, 300, 700, -9000, INSET, [], MARKER, CHEVRON)
    expect(p.x).toBeCloseTo(700)
    expect(p.y).toBeCloseTo(INSET)
  })
})

describe('hiddenByCover', () => {
  const left: Box = { left: 16, top: 16, right: 336, bottom: 784 }

  it('is true for a target on screen behind a panel, false in the open', () => {
    expect(hiddenByCover(200, 300, 640, 400, [left], CHEVRON)).toBe(true)
    expect(hiddenByCover(500, 300, 640, 400, [left], CHEVRON)).toBe(false)
  })

  it('is false when the panel covers the middle too: there is no edge to point from', () => {
    const sheet: Box = { left: 0, top: 0, right: 1280, bottom: 800 }
    expect(hiddenByCover(200, 300, 640, 400, [sheet], CHEVRON)).toBe(false)
  })

  it('a hidden target is pointed at from just outside the panel', () => {
    const p = edgePlace(1280, 800, 640, 400, 200, 300, INSET, [left], MARKER, CHEVRON)
    expect(p.x).toBeGreaterThan(left.right)
    expect(boxesOverlap(markerBox(p.x, p.y, MARKER), left)).toBe(false)
  })
})
