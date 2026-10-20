/**
 * drawTracker.ts: which parts of a 2D canvas a paint changed, so only those
 * are copied to the GPU (Cyberspace TV's furniture, scene/tvPainter.ts).
 *
 * TV paints its furniture onto a canvas the size of the screen about thirty
 * times a second, and the tube samples it as a texture; uploading all of it
 * each time copied some ten megabytes a paint on a laptop, when most of it
 * (the logo, the chiron, the words on NOW PLAYING) had not changed since the
 * last cut, and only the marquee, the minimap and the progress move
 * (arkinox, 2026-10-20: "the perf on /tv on my laptop is not satisfactory
 * ... catch places where we are bogging things down unnecessarily").
 *
 * The painter still paints the whole canvas every time, exactly as before,
 * so the canvas is always right. What this adds is a record of the paint:
 * the painter names its parts as it goes (part), and every call it makes on
 * the context is folded into a hash of that part, with a box, in canvas
 * pixels, that holds everything the call can have inked (blur, line width
 * and transform included). A part whose hash is the same as at the last
 * paint inked the same pixels; one that differs, came or went, or copied a
 * picture that moves by itself (a canvas or a video), changed within its
 * old box and its new one. Those boxes are all that needs uploading.
 *
 * It errs toward uploading everything: a call it does not know, a blend
 * other than source-over, a filter, a part that leaves a save or a clip
 * open, or a draw outside a paint all make the next upload the whole canvas.
 */

import type { Texture, WebGLRenderer } from 'three'

/** A rectangle on the canvas, whole canvas px: x, y its top left. */
export interface DirtyRect { x: number; y: number; w: number; h: number }

type Box = [number, number, number, number]

/** What one part of a paint drew: its hash, where, and whether it copied a moving picture. */
interface PartRecord { h1: number; h2: number; box: Box | null; volatile: boolean }

/** State a part inherits from the parts before it, folded into its hash at its start. */
const STATE_KEYS = ['fillStyle', 'strokeStyle', 'font', 'globalAlpha', 'textAlign', 'textBaseline', 'direction', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'globalCompositeOperation', 'filter', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering'] as const

/** Properties a paint may set: folded into the hash as they are set. */
const KNOWN_PROPS = new Set<string>(STATE_KEYS)

/** Methods that build the current path. */
const PATH_OPS = new Set(['beginPath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'rect', 'roundRect', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'closePath'])
/** Methods that change state only. */
const STATE_OPS = new Set(['save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'resetTransform', 'transform', 'setLineDash', 'clip'])
/** Methods that ink pixels. */
const DRAW_OPS = new Set(['fillRect', 'strokeRect', 'clearRect', 'fillText', 'strokeText', 'drawImage', 'fill', 'stroke'])
/** Methods that read only, or make an object the hash follows (gradients). */
const READ_OPS = new Set(['measureText', 'getTransform', 'getLineDash', 'isPointInPath', 'isPointInStroke', 'createLinearGradient', 'createRadialGradient', 'createConicGradient'])

// FNV-1a, two lanes with different seeds: a collision in both is not a concern.
const F64 = new Float64Array(1)
const U32 = new Uint32Array(F64.buffer)

/** Identities for pictures, so a hash can name which one was copied. */
const pictureIds = new WeakMap<object, number>()
let nextPictureId = 1
function pictureId(o: object): number {
  let id = pictureIds.get(o)
  if (id === undefined) { id = nextPictureId++; pictureIds.set(o, id) }
  return id
}

/** Gradients made through a tracker, and the hash of what made them. */
const gradientSigs = new WeakMap<object, [number, number]>()

function isMoving(src: unknown): boolean {
  // A canvas or a video changes under the same object; an image, once
  // decoded, does not.
  if (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement) return true
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) return true
  if (typeof OffscreenCanvas !== 'undefined' && src instanceof OffscreenCanvas) return true
  if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) return true
  return false
}

export interface DrawTracker {
  /** The context to paint through: every call reaches the canvas as before. */
  readonly ctx: CanvasRenderingContext2D
  /** A paint starts. */
  begin(): void
  /** What follows, until the next part or the paint's end, is the part `name`. */
  part(name: string): void
  /**
   * The paint is over: the rectangles it changed since the last paint,
   * clamped to the canvas, or null for all of it.
   */
  end(width: number, height: number): DirtyRect[] | null
  /** The next paint's changes are all of it (the canvas was resized, or the texture made again). */
  reset(): void
  /** The last paint's parts, their boxes and whether each changed, and why it was all of it if it was: for tests and probes. */
  report(): { parts: Array<{ name: string; box: [number, number, number, number] | null; changed: boolean; volatile: boolean }>; full: string | null }
}

/**
 * Every box grows by this, canvas px, before it is uploaded: a hair of
 * antialiasing past what the arithmetic says (a lockstep check against
 * whole uploads found single pixels at the edges of parts otherwise).
 */
const EDGE = 2
/**
 * Two rectangles are uploaded as one when the one round both has at most
 * this much more in it than the two, canvas px: a call each costs more than
 * a few pixels, not more than a screenful (two far corners joined were most
 * of the canvas).
 */
const MERGE_WASTE = 16_384
/** Above this share of the canvas, one upload of all of it. */
const FULL_SHARE = 0.6

export function trackDrawing(real: CanvasRenderingContext2D): DrawTracker {
  let painting = false
  let fullNext = true
  let parts = new Map<string, PartRecord>()
  let last = new Map<string, PartRecord>()
  let cur: PartRecord | null = null
  let curName = ''
  let curDepth = 0
  let depth = 0
  // Whether the transform is the identity, kept through save and restore so
  // most calls need not ask the context for it.
  let identity = true
  const identityStack: boolean[] = []
  // The current path's box, canvas px, from where it was built.
  let path: Box | null = null
  let lastX = 0
  let lastY = 0

  const mixNum = (n: number): void => {
    if (!cur) return
    F64[0] = n
    cur.h1 = Math.imul(cur.h1 ^ U32[0], 16777619) >>> 0
    cur.h1 = Math.imul(cur.h1 ^ U32[1], 16777619) >>> 0
    cur.h2 = Math.imul(cur.h2 ^ U32[1], 2246822519) >>> 0
    cur.h2 = Math.imul(cur.h2 ^ U32[0], 2246822519) >>> 0
  }
  const mixStr = (s: string): void => {
    if (!cur) return
    mixNum(s.length)
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i)
      cur.h1 = Math.imul(cur.h1 ^ c, 16777619) >>> 0
      cur.h2 = Math.imul(cur.h2 ^ c, 2246822519) >>> 0
    }
  }
  const mixValue = (v: unknown): void => {
    if (typeof v === 'number') mixNum(v)
    else if (typeof v === 'string') mixStr(v)
    else if (typeof v === 'boolean') mixNum(v ? 1 : 0)
    else if (v === null || v === undefined) mixNum(-7)
    else if (Array.isArray(v)) { mixNum(v.length); for (const x of v) mixValue(x) }
    else if (typeof v === 'object') {
      const sig = gradientSigs.get(v)
      if (sig) { mixNum(sig[0]); mixNum(sig[1]); return }
      // A pattern, a gradient made elsewhere: nothing to tell one paint's from the next's.
      if (cur) cur.volatile = true
    }
  }
  let fullWhy: string | null = 'first paint'
  let lastWhy: string | null = null
  let changedNames = new Set<string>()
  const unknown = (why = 'unknown call'): void => { if (!fullNext) fullWhy = why; fullNext = true }

  /** Grow the current part's box by `b`. */
  const ink = (b: Box | null): void => {
    if (!painting) { unknown('a draw outside a paint'); return }
    if (!cur || !b) return
    if (!cur.box) cur.box = [b[0], b[1], b[2], b[3]]
    else {
      if (b[0] < cur.box[0]) cur.box[0] = b[0]
      if (b[1] < cur.box[1]) cur.box[1] = b[1]
      if (b[2] > cur.box[2]) cur.box[2] = b[2]
      if (b[3] > cur.box[3]) cur.box[3] = b[3]
    }
  }

  /** The context's transform; null, and everything changed, where it cannot say (a stand-in context in a test). */
  const matrix = (): DOMMatrix | null => {
    const m = real.getTransform?.() as DOMMatrix | undefined
    if (m && typeof m.a === 'number') return m
    unknown('no transform to read')
    return null
  }

  /** A box in the current user space, in canvas px, with `pad` user px and `devPad` canvas px round it. */
  const toCanvas = (x0: number, y0: number, x1: number, y1: number, pad = 0, devPad = 0): Box => {
    const ax = Math.min(x0, x1) - pad, ay = Math.min(y0, y1) - pad, bx = Math.max(x0, x1) + pad, by = Math.max(y0, y1) + pad
    if (identity) return [ax - devPad, ay - devPad, bx + devPad, by + devPad]
    const m = matrix()
    if (!m) return [ax - devPad, ay - devPad, bx + devPad, by + devPad]
    const xs = [m.a * ax + m.c * ay + m.e, m.a * bx + m.c * ay + m.e, m.a * ax + m.c * by + m.e, m.a * bx + m.c * by + m.e]
    const ys = [m.b * ax + m.d * ay + m.f, m.b * bx + m.d * ay + m.f, m.b * ax + m.d * by + m.f, m.b * bx + m.d * by + m.f]
    return [Math.min(...xs) - devPad, Math.min(...ys) - devPad, Math.max(...xs) + devPad, Math.max(...ys) + devPad]
  }
  /** How far a shadow reaches past what casts it, canvas px (shadows are not transformed). */
  const shadowPad = (): number => {
    const blur = real.shadowBlur || 0
    const ox = Math.abs(real.shadowOffsetX || 0), oy = Math.abs(real.shadowOffsetY || 0)
    if (blur <= 0 && ox === 0 && oy === 0) return 1
    // A blur's sigma is half the shadowBlur; three sigmas is all of it that shows.
    return 2 * blur + Math.max(ox, oy) + 2
  }
  const pathPoint = (x: number, y: number, r = 0): void => {
    const b = toCanvas(x, y, x, y, r)
    if (!path) path = b
    else {
      if (b[0] < path[0]) path[0] = b[0]
      if (b[1] < path[1]) path[1] = b[1]
      if (b[2] > path[2]) path[2] = b[2]
      if (b[3] > path[3]) path[3] = b[3]
    }
  }
  const strokeHalf = (): number => {
    const lw = real.lineWidth || 1
    // A mitred corner can reach miterLimit half widths out.
    return (real.lineJoin === 'miter' ? Math.max(1, real.miterLimit || 10) : 1) * lw / 2 + 1
  }

  const textBox = (text: string, x: number, y: number): Box => {
    const m = real.measureText(text)
    const w = m.width
    const align = real.textAlign
    const dir = real.direction === 'rtl'
    let left = x, right = x + w
    if (align === 'center') { left = x - w / 2; right = x + w / 2 }
    else if (align === 'right' || (align === 'end' && !dir) || (align === 'start' && dir)) { left = x - w; right = x }
    left = Math.min(left, x - (m.actualBoundingBoxLeft || 0))
    right = Math.max(right, x + (m.actualBoundingBoxRight || 0))
    const up = Math.max(m.actualBoundingBoxAscent || 0, m.fontBoundingBoxAscent || 0)
    const down = Math.max(m.actualBoundingBoxDescent || 0, m.fontBoundingBoxDescent || 0)
    return toCanvas(left, y - up, right, y + down, 2, shadowPad())
  }

  const handlers: Record<string, (args: unknown[]) => void> = {
    beginPath: () => { path = null },
    moveTo: (a) => { lastX = a[0] as number; lastY = a[1] as number; pathPoint(lastX, lastY) },
    lineTo: (a) => { lastX = a[0] as number; lastY = a[1] as number; pathPoint(lastX, lastY) },
    arc: (a) => { pathPoint(a[0] as number, a[1] as number, Math.abs(a[2] as number)) },
    ellipse: (a) => { pathPoint(a[0] as number, a[1] as number, Math.max(Math.abs(a[2] as number), Math.abs(a[3] as number))) },
    // Within the corner the two points make with where the path was.
    arcTo: (a) => { pathPoint(a[0] as number, a[1] as number); pathPoint(a[2] as number, a[3] as number); lastX = a[2] as number; lastY = a[3] as number },
    quadraticCurveTo: (a) => { pathPoint(a[0] as number, a[1] as number); pathPoint(a[2] as number, a[3] as number) },
    bezierCurveTo: (a) => { pathPoint(a[0] as number, a[1] as number); pathPoint(a[2] as number, a[3] as number); pathPoint(a[4] as number, a[5] as number) },
    rect: (a) => { const [x, y, w, h] = a as number[]; pathPoint(x, y); pathPoint(x + w, y + h) },
    roundRect: (a) => { const [x, y, w, h] = a as number[]; pathPoint(x, y); pathPoint(x + w, y + h) },
    closePath: () => {},
    fill: () => { if (path) { const p = 1 + shadowPad(); ink([path[0] - p, path[1] - p, path[2] + p, path[3] + p]) } },
    stroke: () => { if (path) { const p = strokeHalf() * scaleOf() + shadowPad(); ink([path[0] - p, path[1] - p, path[2] + p, path[3] + p]) } },
    fillRect: (a) => { const [x, y, w, h] = a as number[]; ink(toCanvas(x, y, x + w, y + h, 1, shadowPad())) },
    strokeRect: (a) => { const [x, y, w, h] = a as number[]; ink(toCanvas(x, y, x + w, y + h, strokeHalf(), shadowPad())) },
    clearRect: (a) => { const [x, y, w, h] = a as number[]; ink(toCanvas(x, y, x + w, y + h, 1)) },
    fillText: (a) => { ink(textBox(String(a[0]), a[1] as number, a[2] as number)) },
    strokeText: (a) => { const b = textBox(String(a[0]), a[1] as number, a[2] as number); const p = strokeHalf() * scaleOf(); ink([b[0] - p, b[1] - p, b[2] + p, b[3] + p]) },
    drawImage: (a) => {
      const src = a[0] as object
      if (cur) {
        if (isMoving(src)) cur.volatile = true
        mixNum(pictureId(src))
        const img = src as { complete?: boolean; naturalWidth?: number }
        mixNum(img.complete === false ? 0 : 1)
        mixNum(img.naturalWidth ?? -1)
      }
      const n = a.length
      const own = src as { naturalWidth?: number; naturalHeight?: number; videoWidth?: number; videoHeight?: number; width?: number; height?: number }
      const [x, y, w, h] = n >= 9 ? (a.slice(5, 9) as number[]) : n >= 5 ? (a.slice(1, 5) as number[]) : [a[1] as number, a[2] as number, own.naturalWidth || own.videoWidth || own.width || 0, own.naturalHeight || own.videoHeight || own.height || 0]
      ink(toCanvas(x, y, x + w, y + h, 1, shadowPad()))
    },
    save: () => { depth++; identityStack.push(identity) },
    // One more restore than saves would undo the paint's own save (begin).
    restore: () => { if (depth > 0) depth--; else unknown('a restore with no save'); identity = identityStack.pop() ?? true },
    translate: () => { identity = false },
    rotate: () => { identity = false },
    scale: () => { identity = false },
    transform: () => { identity = false },
    setTransform: () => { identity = false },
    resetTransform: () => { identity = true },
    setLineDash: () => {},
    clip: () => {},
  }

  /** The transform's largest stretch, for a line's width in canvas px. */
  const scaleOf = (): number => {
    if (identity) return 1
    const m = matrix()
    if (!m) return 1
    return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d))
  }

  const fns = new Map<string | symbol, unknown>()
  const proxy = new Proxy(real, {
    get(target, key) {
      const have = fns.get(key)
      if (have !== undefined) return have
      const v = Reflect.get(target, key, target)
      if (typeof v !== 'function') return v
      const name = String(key)
      let f: unknown
      if (READ_OPS.has(name)) {
        if (name === 'createLinearGradient' || name === 'createRadialGradient' || name === 'createConicGradient') {
          f = (...args: number[]) => {
            const g = (v as (...a: number[]) => CanvasGradient).apply(target, args)
            const sig: [number, number] = [2166136261, 3735928559]
            const fold = (n: number): void => { F64[0] = n; sig[0] = Math.imul(sig[0] ^ U32[0] ^ U32[1], 16777619) >>> 0; sig[1] = Math.imul(sig[1] ^ U32[1] ^ (U32[0] >>> 1), 2246822519) >>> 0 }
            fold(name.length)
            for (const n of args) fold(n)
            const add = (g as { addColorStop: (o: number, c: string) => void }).addColorStop
            ;(g as { addColorStop: (o: number, c: string) => void }).addColorStop = (o: number, c: string) => {
              fold(o)
              for (let i = 0; i < c.length; i++) fold(c.charCodeAt(i))
              add.call(g, o, c)
            }
            gradientSigs.set(g, sig)
            return g
          }
        } else f = (v as (...a: unknown[]) => unknown).bind(target)
      } else if (PATH_OPS.has(name) || STATE_OPS.has(name) || DRAW_OPS.has(name)) {
        const h = handlers[name]
        f = (...args: unknown[]) => {
          // A picture is followed by who it is (drawImage's handler), not as a value.
          if (cur) { mixStr(name); for (let i = name === 'drawImage' ? 1 : 0; i < args.length; i++) mixValue(args[i]) }
          // A Path2D of its own is not the path this has followed.
          if ((name === 'fill' || name === 'stroke' || name === 'clip') && typeof args[0] === 'object') unknown(`${name} of a Path2D`)
          if (DRAW_OPS.has(name) && real.globalCompositeOperation !== 'source-over') unknown(`blend ${real.globalCompositeOperation}`)
          if (DRAW_OPS.has(name) && real.filter && real.filter !== 'none') unknown(`filter ${real.filter}`)
          h?.(args)
          return (v as (...a: unknown[]) => unknown).apply(target, args)
        }
      } else {
        f = (...args: unknown[]) => { unknown(`call ${name}`); return (v as (...a: unknown[]) => unknown).apply(target, args) }
      }
      fns.set(key, f)
      return f
    },
    set(target, key, value) {
      const name = String(key)
      if (!KNOWN_PROPS.has(name)) unknown(`set ${name}`)
      else if (cur) { mixStr(name); mixValue(value) }
      return Reflect.set(target, key, value, target)
    },
  })

  const closePart = (): void => {
    if (!cur) return
    // A part that leaves a save open hands its state (a clip, a transform)
    // to the next part, which its hash would not show.
    if (depth !== curDepth) unknown(`part ${curName} left a save open`)
    parts.set(curName, cur)
    cur = null
  }

  const openPart = (name: string): void => {
    closePart()
    let n = name
    for (let i = 2; parts.has(n); i++) n = `${name}#${i}`
    curName = n
    cur = { h1: 2166136261, h2: 3735928559, box: null, volatile: false }
    curDepth = depth
    // What it inherits.
    for (const k of STATE_KEYS) { mixStr(k); mixValue((real as unknown as Record<string, unknown>)[k]) }
    const dash = real.getLineDash?.()
    if (Array.isArray(dash)) for (const d of dash) mixNum(d)
    const m = identity ? null : matrix()
    if (m) { mixNum(m.a); mixNum(m.b); mixNum(m.c); mixNum(m.d); mixNum(m.e); mixNum(m.f) } else mixNum(identity ? 1 : 0)
    mixNum(depth)
  }

  return {
    ctx: proxy as CanvasRenderingContext2D,
    begin() {
      // Every paint starts from the same state, whatever the last one ended
      // on: else a part's hash would follow how the paint before ended, and
      // the clear at the top, which covers the whole canvas, would change
      // with it. Undone at the end.
      real.save()
      painting = true
      parts = new Map()
      depth = 0
      identity = true
      identityStack.length = 0
      path = null
      openPart('')
    },
    part(name: string) {
      if (painting) openPart(name)
    },
    end(width: number, height: number) {
      closePart()
      painting = false
      real.restore()
      const was = last
      last = parts
      changedNames = new Set()
      const boxes: Box[] = []
      const add = (b: Box | null): void => { if (b) boxes.push(b) }
      for (const [name, p] of parts) {
        const q = was.get(name)
        if (!q) { changedNames.add(name); add(p.box); continue }
        if (p.volatile || q.volatile || p.h1 !== q.h1 || p.h2 !== q.h2) { changedNames.add(name); add(p.box); add(q.box) }
      }
      for (const [name, q] of was) if (!parts.has(name)) add(q.box)
      if (fullNext) { lastWhy = fullWhy; fullNext = false; return null }
      lastWhy = null
      const rects = dirtyRects(boxes, width, height)
      if (!rects) lastWhy = 'most of the canvas changed'
      return rects
    },
    reset() { unknown('reset') },
    report() {
      return {
        parts: [...last].map(([name, p]) => ({ name, box: p.box ? [p.box[0], p.box[1], p.box[2], p.box[3]] : null, changed: changedNames.has(name), volatile: p.volatile })),
        full: lastWhy,
      }
    },
  }
}

/**
 * Boxes as whole-pixel rectangles on a `width` by `height` canvas, a hair
 * larger (EDGE), two that fit together made one; null when they cover most
 * of it.
 */
export function dirtyRects(boxes: Array<[number, number, number, number]>, width: number, height: number): DirtyRect[] | null {
  let rs = boxes
    .map(([x0, y0, x1, y1]): Box => [Math.max(0, Math.floor(x0 - EDGE)), Math.max(0, Math.floor(y0 - EDGE)), Math.min(width, Math.ceil(x1 + EDGE)), Math.min(height, Math.ceil(y1 + EDGE))])
    .filter(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0)
  const size = (r: Box): number => (r[2] - r[0]) * (r[3] - r[1])
  // Merge while two fit together with little waste.
  for (let merged = true; merged;) {
    merged = false
    outer: for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i], b = rs[j]
        const u: Box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]
        if (size(u) - size(a) - size(b) <= MERGE_WASTE) {
          rs[i] = u
          rs = rs.filter((_, k) => k !== j)
          merged = true
          break outer
        }
      }
    }
  }
  const area = rs.reduce((s, [x0, y0, x1, y1]) => s + (x1 - x0) * (y1 - y0), 0)
  if (area > FULL_SHARE * width * height) return null
  return rs.map(([x0, y0, x1, y1]) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }))
}

/**
 * Copy `rects` of a canvas texture's canvas into its texture on the GPU,
 * the rest left as it was. three's own copyTextureToTexture reads five
 * pixel-store settings back first (getParameter), and in Chrome each read
 * waits for the GPU to finish everything before it: measured offline, the
 * main thread spent most of every second waiting there. This sets what it
 * needs and puts back three's defaults (no skip, no row length) without
 * asking. The texture is uploaded whole first if it never was, or was made
 * again since.
 */
export function uploadRegions(renderer: WebGLRenderer, texture: Texture, rects: DirtyRect[]): void {
  renderer.initTexture(texture)
  const webgl = (renderer.properties.get(texture) as { __webglTexture?: WebGLTexture }).__webglTexture
  const image = texture.image as TexImageSource & { width: number }
  if (!webgl || !image || rects.length === 0) return
  const gl = renderer.getContext() as WebGL2RenderingContext
  renderer.state.bindTexture(gl.TEXTURE_2D, webgl)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, texture.premultiplyAlpha)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, texture.unpackAlignment)
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, image.width)
  for (const r of rects) {
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r.x)
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, r.y)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, r.y, r.w, r.h, gl.RGBA, gl.UNSIGNED_BYTE, image)
  }
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0)
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0)
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0)
  renderer.state.unbindTexture()
}
