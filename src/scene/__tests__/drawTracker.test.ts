/**
 * drawTracker.test.ts: a paint that changes nothing uploads nothing, one that
 * changes a part uploads that part's old and new boxes and nothing else, and
 * anything the tracker cannot follow uploads all of it (arkinox, 2026-10-20:
 * "catch places where we are bogging things down unnecessarily").
 */
import { afterEach, describe, expect, it } from 'vitest'
import { dirtyRects, trackDrawing, uploadRegions, type DirtyRect } from '../drawTracker'
import { TvPainter, type TvAssets, type TvPicture } from '../tvPainter'

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
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, arc: () => {}, arcTo: () => {}, closePath: () => {}, rect: () => {},
    fill: () => {}, stroke: () => {}, fillRect: () => {}, strokeRect: () => {}, clearRect: () => {}, fillText: () => {}, drawImage: () => {}, clip: () => {}, setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
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

describe('what the tracker cannot follow (review of #415)', () => {
  it('is all of it when a clip is left open for the parts after', () => {
    const p = painter()
    const later = box(0, 0, 500, 500)
    p.paint([['a', (c) => { c.beginPath(); c.rect(0, 0, 10, 10); c.clip() }], ['b', later]])
    p.paint([['a', (c) => { c.beginPath(); c.rect(0, 0, 10, 10); c.clip() }], ['b', later]])
    expect(p.paint([['a', (c) => { c.beginPath(); c.rect(0, 0, 400, 400); c.clip() }], ['b', later]])).toBeNull()
  })
  it('is all of it when a path is filled in a part that did not begin it', () => {
    const p = painter()
    p.paint([['a', (c) => { c.beginPath(); c.rect(100, 100, 10, 10) }], ['b', (c) => c.fill()]])
    expect(p.paint([['a', (c) => { c.beginPath(); c.rect(600, 600, 10, 10) }], ['b', (c) => c.fill()]])).toBeNull()
  })
  it('skips a call with a coordinate that is not a number, and still follows the rest', () => {
    const p = painter()
    p.paint([['a', (c) => { c.fillRect(NaN, 0, 10, 10); c.fillRect(100, 100, 10, 10) }]])
    p.paint([['a', (c) => { c.fillRect(NaN, 0, 10, 10); c.fillRect(100, 100, 10, 10) }]])
    const d = p.paint([['a', (c) => { c.fillRect(NaN, 0, 10, 10); c.fillRect(300, 300, 10, 10) }]])!
    expect(d.some((r) => holds(r, 100, 100, 110, 110))).toBe(true)
    expect(d.some((r) => holds(r, 300, 300, 310, 310))).toBe(true)
  })
  it('holds an arcTo whose tangent points lie past its second point', () => {
    const p = painter()
    const arc = (y: number) => (c: CanvasRenderingContext2D) => { c.beginPath(); c.moveTo(0, y); c.arcTo(100, y, 100, y + 10, 50); c.stroke() }
    p.paint([['a', arc(0)]])
    p.paint([['a', arc(0)]])
    const d = p.paint([['a', arc(400)]])!
    // The arc runs from (50, 0) round to (100, 50).
    expect(d.some((r) => holds(r, 50, 0, 100, 50))).toBe(true)
  })
  it('reaches a square cap\'s corners', () => {
    const p = painter()
    const line = (x: number) => (c: CanvasRenderingContext2D) => { c.lineWidth = 20; c.lineCap = 'square'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(x, 100); c.lineTo(x + 100, 100); c.stroke() }
    p.paint([['a', line(100)]])
    p.paint([['a', line(100)]])
    const d = p.paint([['a', line(500)]])!
    expect(d.some((r) => holds(r, 86, 86, 214, 114))).toBe(true)
  })
})

describe('TV\'s painter through the tracker', () => {
  it('follows every call it makes: a paint like the last uploads nothing', () => {
    const ctx = fakeContext()
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement
    const tv = new TvPainter(canvas)
    tv.size(1400, 800, 1)
    const assets: TvAssets = { name: (pk) => pk.toUpperCase(), picture: () => null, logo: null, spin: null, segmentShard: null, color: () => '#fff', music: { title: 'SATURN DAY', artist: 'SETHY BOWOY', art: null, progress: 0.4, blocked: false, volume: 0.8, muted: false }, watching: 3 }
    const p: TvPicture = { status: 'playing', shot: { id: 't', kind: 'trip', pubkey: 'ann', beats: [], start: 1, end: 2, offsets: [], length: 5 } as never, played: 0, tapeTime: 100, scaleExp: 2, cutAt: 0, skipped: 0, meanwhile: false, census: null, chains: {}, arrivals: [{ pubkey: 'bob', at: 1 }], reactions: [], avatars: {} }
    tv.paint(p, assets, 5000, 1, true)
    tv.paint(p, assets, 5000, 1, true)
    tv.paint(p, assets, 5000, 1, true)
    const report = (tv as unknown as { track: { report: () => { full: string | null } } }).track.report()
    expect(report.full).toBeNull()
    expect(tv.dirty).toEqual([])
  })
})

describe('uploadRegions', () => {
  function renderer(): { calls: string[]; r: never } {
    const calls: string[] = []
    const gl = new Proxy({} as Record<string, unknown>, {
      get: (_t, k) => (typeof k === 'string' && /^[A-Z][A-Z0-9_]*$/.test(k) ? k : (...a: unknown[]) => { calls.push(`${String(k)}(${a.map((x) => (typeof x === 'object' ? 'img' : String(x))).join(',')})`) }),
    })
    const r = { initTexture: () => { calls.push('init') }, properties: { get: () => ({ __webglTexture: {} }) }, getContext: () => gl, state: { bindTexture: () => { calls.push('bind') }, unbindTexture: () => { calls.push('unbind') } } }
    return { calls, r: r as never }
  }
  it('copies each rectangle at its own place and leaves no skip behind, asking the GPU for nothing', () => {
    const { calls, r } = renderer()
    const t = { flipY: false, premultiplyAlpha: false, unpackAlignment: 4, image: { width: 100, height: 50 }, needsUpdate: false }
    uploadRegions(r, t as never, [{ x: 10, y: 20, w: 30, h: 5 }])
    expect(calls).toContain('texSubImage2D(TEXTURE_2D,0,10,20,30,5,RGBA,UNSIGNED_BYTE,img)')
    expect(calls).toContain('pixelStorei(UNPACK_SKIP_PIXELS,10)')
    expect(calls.slice(-3)).toEqual(['pixelStorei(UNPACK_SKIP_PIXELS,0)', 'pixelStorei(UNPACK_SKIP_ROWS,0)', 'unbind'])
    expect(calls.some((c) => c.startsWith('getParameter'))).toBe(false)
  })
  it('uploads all of it instead when the texture is upside down', () => {
    const { calls, r } = renderer()
    const t = { flipY: true, image: { width: 100, height: 50 }, needsUpdate: false }
    uploadRegions(r, t as never, [{ x: 0, y: 0, w: 1, h: 1 }])
    expect(t.needsUpdate).toBe(true)
    expect(calls).toEqual([])
  })
})

