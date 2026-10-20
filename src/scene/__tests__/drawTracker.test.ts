/**
 * drawTracker.test.ts: a paint that changes nothing uploads nothing, one that
 * changes a part uploads that part's old and new boxes and nothing else, and
 * anything the tracker cannot follow uploads all of it (arkinox, 2026-10-20:
 * "catch places where we are bogging things down unnecessarily").
 */
import { afterEach, describe, expect, it } from 'vitest'
import { dirtyRects, trackDrawing, type DirtyRect } from '../drawTracker'

/** A 2D context that keeps its state and transform, measures each character as 10 px, and draws nothing. */
function fakeContext(): CanvasRenderingContext2D {
  type M = { a: number; b: number; c: number; d: number; e: number; f: number }
  let m: M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  const stack: Array<{ m: M; props: Record<string, unknown> }> = []
  const props: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif', globalAlpha: 1, textAlign: 'start', textBaseline: 'alphabetic', direction: 'ltr', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0, shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0, globalCompositeOperation: 'source-over', filter: 'none' }
  const ctx = {
    ...props,
    measureText: (t: string) => ({ width: t.length * 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: t.length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, fontBoundingBoxAscent: 9, fontBoundingBoxDescent: 3 }),
    getTransform: () => ({ ...m }),
    getLineDash: () => [],
    save: () => { stack.push({ m: { ...m }, props: { ...ctx } as Record<string, unknown> }) },
    restore: () => { const s = stack.pop(); if (s) { m = s.m; for (const k of Object.keys(props)) (ctx as Record<string, unknown>)[k] = s.props[k] } },
    translate: (x: number, y: number) => { m = { ...m, e: m.e + m.a * x + m.c * y, f: m.f + m.b * x + m.d * y } },
    scale: (x: number, y: number) => { m = { ...m, a: m.a * x, b: m.b * x, c: m.c * y, d: m.d * y } },
    rotate: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, arc: () => {}, closePath: () => {}, rect: () => {},
    fill: () => {}, stroke: () => {}, fillRect: () => {}, strokeRect: () => {}, clearRect: () => {}, fillText: () => {}, drawImage: () => {}, clip: () => {}, setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    putImageData: () => {},
  }
  return ctx as unknown as CanvasRenderingContext2D
}

/** Paint `parts` (name, then what it does) through a tracker; the rectangles the paint changed. */
function painter(): { paint: (parts: Array<[string, (c: CanvasRenderingContext2D) => void]>) => DirtyRect[] | null } {
  const t = trackDrawing(fakeContext())
  return {
    paint(parts) {
      t.begin()
      t.ctx.clearRect(0, 0, 1000, 1000)
      for (const [name, draw] of parts) { t.part(name); draw(t.ctx) }
      return t.end(1000, 1000)
    },
  }
}

const words = (text: string, x = 100, y = 100) => (c: CanvasRenderingContext2D) => { c.font = '700 12px mono'; c.fillStyle = '#fff'; c.fillText(text, x, y) }
const box = (x: number, y: number, w: number, h: number) => (c: CanvasRenderingContext2D) => { c.fillStyle = 'red'; c.fillRect(x, y, w, h) }

/** Whether `r` holds the rectangle x0..x1, y0..y1. */
const holds = (r: DirtyRect, x0: number, y0: number, x1: number, y1: number): boolean => r.x <= x0 && r.y <= y0 && r.x + r.w >= x1 && r.y + r.h >= y1

describe('what a paint changed', () => {
  it('is all of it the first time, and nothing when nothing changed', () => {
    const p = painter()
    const parts: Array<[string, (c: CanvasRenderingContext2D) => void]> = [['clock', words('12:00:01')], ['logo', box(800, 20, 150, 40)]]
    expect(p.paint(parts)).toBeNull()
    expect(p.paint(parts)).toEqual([])
  })

  it('is the part that changed, where it was and where it is, and nothing else', () => {
    const p = painter()
    p.paint([['clock', words('12:00:01')], ['logo', box(800, 20, 150, 40)]])
    const d = p.paint([['clock', words('12:00:02 LONGER', 100, 140)], ['logo', box(800, 20, 150, 40)]])!
    expect(d).toHaveLength(1)
    // The old words at y 100 and the new, longer ones at 140.
    expect(holds(d[0], 100, 92, 250, 142)).toBe(true)
    expect(d[0].x + d[0].w).toBeLessThan(800)
  })

  it('is a part that went, where it was', () => {
    const p = painter()
    // Last, so what comes after it inherits nothing different when it goes.
    p.paint([['logo', box(800, 20, 150, 40)], ['card', box(300, 300, 100, 50)]])
    const d = p.paint([['logo', box(800, 20, 150, 40)]])!
    expect(d).toHaveLength(1)
    expect(holds(d[0], 300, 300, 400, 350)).toBe(true)
  })

  it('follows the state a part inherits from the one before it', () => {
    const p = painter()
    const after = (c: CanvasRenderingContext2D) => c.fillText('LATER', 500, 500)
    p.paint([['first', (c) => { c.textAlign = 'left' }], ['second', after]])
    const d = p.paint([['first', (c) => { c.textAlign = 'right' }], ['second', after]])!
    // The second part's words moved left of 500 with the first part's alignment.
    expect(d.some((r) => holds(r, 450, 492, 550, 502))).toBe(true)
  })

  it('reaches as far as a shadow\'s blur and a translate put the ink', () => {
    const p = painter()
    p.paint([['map', box(0, 0, 1, 1)]])
    const d = p.paint([['map', (c) => { c.save(); c.translate(400, 400); c.shadowBlur = 10; c.fillStyle = 'red'; c.fillRect(0, 0, 50, 50); c.restore() }]])!
    expect(d.some((r) => holds(r, 380, 380, 470, 470))).toBe(true)
  })

  it('is all of it after a call it does not follow, a part that leaves a save open, or a blend other than over', () => {
    const p = painter()
    p.paint([['a', box(0, 0, 10, 10)]])
    expect(p.paint([['a', (c) => { c.putImageData({} as ImageData, 0, 0) }]])).toBeNull()
    p.paint([['a', box(0, 0, 10, 10)]])
    expect(p.paint([['a', (c) => { c.save(); c.fillRect(0, 0, 5, 5) }], ['b', (c) => { c.restore() }]])).toBeNull()
    p.paint([['a', box(0, 0, 10, 10)]])
    expect(p.paint([['a', (c) => { c.globalCompositeOperation = 'lighter'; c.fillRect(0, 0, 5, 5); c.globalCompositeOperation = 'source-over' }]])).toBeNull()
  })

  describe('a picture that moves by itself', () => {
    const was = (globalThis as { HTMLCanvasElement?: unknown }).HTMLCanvasElement
    afterEach(() => { (globalThis as { HTMLCanvasElement?: unknown }).HTMLCanvasElement = was })
    it('is changed at every paint, an image only when it is another one', () => {
      class FakeCanvas { width = 10; height = 10 }
      ;(globalThis as { HTMLCanvasElement?: unknown }).HTMLCanvasElement = FakeCanvas
      const spin = new FakeCanvas()
      const image = { complete: true, naturalWidth: 10, naturalHeight: 10 }
      const p = painter()
      const parts: Array<[string, (c: CanvasRenderingContext2D) => void]> = [['spin', (c) => c.drawImage(spin as never, 600, 600, 100, 100)], ['logo', (c) => c.drawImage(image as never, 10, 10, 50, 20)]]
      p.paint(parts)
      const d = p.paint(parts)!
      expect(d).toHaveLength(1)
      expect(holds(d[0], 600, 600, 700, 700)).toBe(true)
      const e = p.paint([parts[0], ['logo', (c) => c.drawImage({ complete: true, naturalWidth: 10, naturalHeight: 10 } as never, 10, 10, 50, 20)]])!
      expect(e.some((r) => holds(r, 10, 10, 60, 30))).toBe(true)
    })
  })
})

describe('dirtyRects', () => {
  it('makes boxes whole pixels on the canvas two pixels larger, joins the ones that fit together, and keeps far ones apart', () => {
    const r = dirtyRects([[10.5, 10.5, 20.2, 20.2], [30, 10, 40, 20], [500, 500, 510, 510], [-5, -5, 2, 2]], 1000, 1000)!
    expect(r).toContainEqual({ x: 498, y: 498, w: 14, h: 14 })
    // The first two, and the one clamped at the corner, with little between them: one.
    expect(r).toContainEqual({ x: 0, y: 0, w: 42, h: 23 })
    expect(r).toHaveLength(2)
  })
  it('keeps two far corners apart rather than uploading all between them', () => {
    expect(dirtyRects([[0, 0, 300, 300], [700, 700, 1000, 1000]], 1000, 1000)).toHaveLength(2)
  })
  it('is all of it when they cover most of the canvas', () => {
    expect(dirtyRects([[0, 0, 900, 900]], 1000, 1000)).toBeNull()
  })
})
