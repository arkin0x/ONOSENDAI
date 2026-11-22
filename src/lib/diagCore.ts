/**
 * diagCore.ts: the parts of the capture (lib/diag.ts) that need no browser, so
 * a test can hold them: the WebGL ledger, the percentiles, the rings, and the
 * rule for what text may leave.
 *
 * The ledger is an estimate of what the page has asked WebGL to hold, from the
 * sizes in the calls. It cannot see the driver's own copies. Read beside the
 * browser's task manager, it tells our allocations from the driver's.
 */

/** Bytes per pixel by WebGL internal format. Anything else counts as 4. */
const BYTES_PER_PIXEL: Record<number, number> = {
  0x8229: 1, 0x822b: 2, 0x8051: 4, 0x8058: 4, 0x8c43: 4, 0x8059: 4, 0x8c3a: 4, 0x8c3d: 4,
  0x822d: 2, 0x822f: 4, 0x881a: 8, 0x822e: 4, 0x8230: 8, 0x8814: 16, 0x881b: 8,
  0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8d48: 1,
}

export function bytesPerPixel(format: number): number {
  return BYTES_PER_PIXEL[format] ?? 4
}

const TEXTURE_2D_ARRAY = 0x8c1a
const TEXTURE_3D = 0x806f
const FACE_MIN = 0x8515
const FACE_MAX = 0x851a

/** One allocation the ledger holds, by size. No object is kept: a context must stay free to be collected. */
export interface GlAlloc { w: number; h: number; samples: number; format: number; bytes: number }

/** What one context holds. Reached only through a WeakMap keyed on the context. */
class ContextHeld {
  unit = 0
  boundBuffer = new Map<number, object | null>()
  boundTexture = new Map<number, object | null>()
  boundRenderbuffer: object | null = null
  ids = new WeakMap<object, number>()
  next = 1
  buffers = new Map<number, number>()
  textures = new Map<number, Map<number, GlAlloc>>()
  renderbuffers = new Map<number, GlAlloc>()
  programs = 0
  vaos = 0
  framebuffers = 0
  idOf(o: object): number {
    let id = this.ids.get(o)
    if (id === undefined) { id = this.next++; this.ids.set(o, id) }
    return id
  }
}

/** The running counts, zeroed at each sample by `takeCounts`. */
export interface GlCounts {
  draws: number
  verts: number
  bufferData: number
  bufferDataBytes: number
  bufferSub: number
  bufferSubBytes: number
  texUploads: number
  texUploadBytes: number
  links: number
}

const zeroCounts = (): GlCounts => ({ draws: 0, verts: 0, bufferData: 0, bufferDataBytes: 0, bufferSub: 0, bufferSubBytes: 0, texUploads: 0, texUploadBytes: 0, links: 0 })

export interface GlTotals {
  buffers: number
  bufferBytes: number
  textures: number
  textureBytes: number
  renderbuffers: number
  renderbufferBytes: number
  programs: number
  vaos: number
  framebuffers: number
}

export class GlLedger {
  private held = new WeakMap<object, ContextHeld>()
  counts: GlCounts = zeroCounts()

  private of(gl: object): ContextHeld {
    let h = this.held.get(gl)
    if (!h) { h = new ContextHeld(); this.held.set(gl, h) }
    return h
  }

  takeCounts(): GlCounts {
    const c = this.counts
    this.counts = zeroCounts()
    return c
  }

  activeTexture(gl: object, unit: number): void { this.of(gl).unit = unit }
  bindBuffer(gl: object, target: number, buffer: object | null): void { this.of(gl).boundBuffer.set(target, buffer) }
  bindTexture(gl: object, target: number, texture: object | null): void { const h = this.of(gl); h.boundTexture.set(h.unit * 65536 + target, texture) }
  bindRenderbuffer(gl: object, renderbuffer: object | null): void { this.of(gl).boundRenderbuffer = renderbuffer }

  bufferData(gl: object, target: number, bytes: number): void {
    const h = this.of(gl)
    const b = h.boundBuffer.get(target)
    if (b) h.buffers.set(h.idOf(b), bytes)
    this.counts.bufferData++
    this.counts.bufferDataBytes += bytes
  }

  bufferSub(bytes: number): void {
    this.counts.bufferSub++
    this.counts.bufferSubBytes += bytes
  }

  deleteBuffer(gl: object, buffer: object | null): void {
    if (!buffer) return
    const h = this.of(gl)
    h.buffers.delete(h.idOf(buffer))
  }

  /** A level of a texture given its storage: texImage2D, or texStorage2D per level. */
  textureLevel(gl: object, target: number, level: number, format: number, w: number, h: number, depth = 1): void {
    const c = this.of(gl)
    // A cube's faces and a 2D texture come bound under different targets.
    const bindTarget = target >= FACE_MIN && target <= FACE_MAX ? 0x8513 : target
    const t = c.boundTexture.get(c.unit * 65536 + bindTarget)
    if (!t) return
    const id = c.idOf(t)
    let levels = c.textures.get(id)
    if (!levels) { levels = new Map(); c.textures.set(id, levels) }
    levels.set(target * 32 + level, { w, h, samples: 1, format, bytes: w * h * depth * bytesPerPixel(format) })
  }

  /** texStorage2D and texStorage3D: every level at once. */
  textureStorage(gl: object, target: number, levels: number, format: number, w: number, h: number, depth = 1): void {
    const faces = target === 0x8513 ? 6 : 1
    for (let f = 0; f < faces; f++) {
      const t = target === 0x8513 ? FACE_MIN + f : target
      const keep = target === TEXTURE_3D
      for (let l = 0; l < levels; l++) {
        this.textureLevel(gl, t, l, format, Math.max(1, w >> l), Math.max(1, h >> l), keep ? Math.max(1, depth >> l) : target === TEXTURE_2D_ARRAY ? depth : 1)
      }
    }
  }

  /** generateMipmap: the rest of the chain, about a third again. */
  mipmap(gl: object, target: number): void {
    const c = this.of(gl)
    const t = c.boundTexture.get(c.unit * 65536 + target)
    if (!t) return
    const levels = c.textures.get(c.idOf(t))
    const base = levels?.get(target * 32)
    if (!base) return
    let w = base.w, h = base.h, l = 1
    while (w > 1 || h > 1) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1)
      levels!.set(target * 32 + l, { ...base, w, h, bytes: w * h * bytesPerPixel(base.format) })
      l++
    }
  }

  deleteTexture(gl: object, texture: object | null): void {
    if (!texture) return
    const c = this.of(gl)
    c.textures.delete(c.idOf(texture))
  }

  renderbufferStorage(gl: object, samples: number, format: number, w: number, h: number): void {
    const c = this.of(gl)
    if (!c.boundRenderbuffer) return
    c.renderbuffers.set(c.idOf(c.boundRenderbuffer), { w, h, samples, format, bytes: w * h * Math.max(1, samples) * bytesPerPixel(format) })
  }

  deleteRenderbuffer(gl: object, rb: object | null): void {
    if (!rb) return
    const c = this.of(gl)
    c.renderbuffers.delete(c.idOf(rb))
  }

  added(gl: object, what: 'programs' | 'vaos' | 'framebuffers', by: number): void { this.of(gl)[what] += by }

  /** What the contexts given hold, in sum. A context that was lost holds nothing. */
  totals(contexts: Iterable<object>, lost: (gl: object) => boolean): GlTotals {
    const t: GlTotals = { buffers: 0, bufferBytes: 0, textures: 0, textureBytes: 0, renderbuffers: 0, renderbufferBytes: 0, programs: 0, vaos: 0, framebuffers: 0 }
    for (const gl of contexts) {
      if (lost(gl)) continue
      const c = this.held.get(gl)
      if (!c) continue
      t.buffers += c.buffers.size
      for (const b of c.buffers.values()) t.bufferBytes += b
      t.textures += c.textures.size
      for (const levels of c.textures.values()) for (const l of levels.values()) t.textureBytes += l.bytes
      t.renderbuffers += c.renderbuffers.size
      for (const r of c.renderbuffers.values()) t.renderbufferBytes += r.bytes
      t.programs += c.programs
      t.vaos += c.vaos
      t.framebuffers += c.framebuffers
    }
    return t
  }

  /** The biggest targets and textures of the contexts given, grouped by size, for the report. */
  largest(contexts: Iterable<object>, lost: (gl: object) => boolean, n = 12): Array<{ kind: 'rb' | 'tex'; size: string; samples: number; format: number; count: number; bytes: number }> {
    const groups = new Map<string, { kind: 'rb' | 'tex'; size: string; samples: number; format: number; count: number; bytes: number }>()
    const add = (kind: 'rb' | 'tex', a: GlAlloc, bytes: number): void => {
      const size = `${a.w}x${a.h}`
      const k = `${kind}${size}s${a.samples}f${a.format}`
      const g = groups.get(k) ?? { kind, size, samples: a.samples, format: a.format, count: 0, bytes: 0 }
      g.count++
      g.bytes += bytes
      groups.set(k, g)
    }
    for (const gl of contexts) {
      if (lost(gl)) continue
      const c = this.held.get(gl)
      if (!c) continue
      for (const r of c.renderbuffers.values()) add('rb', r, r.bytes)
      for (const levels of c.textures.values()) {
        const base = [...levels.values()].sort((x, y) => y.bytes - x.bytes)[0]
        if (base) add('tex', base, [...levels.values()].reduce((s, l) => s + l.bytes, 0))
      }
    }
    return [...groups.values()].sort((x, y) => y.bytes - x.bytes).slice(0, n)
  }
}

/** Percentiles of a window of frame times. `scratch` is sorted in place; nothing is allocated. */
export function framePercentiles(scratch: Float32Array, n: number): { p50: number; p95: number; p99: number; max: number } {
  if (n <= 0) return { p50: 0, p95: 0, p99: 0, max: 0 }
  const s = scratch.subarray(0, n)
  s.sort()
  const at = (q: number): number => Math.round(s[Math.min(n - 1, Math.floor(n * q))] * 10) / 10
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: Math.round(s[n - 1] * 10) / 10 }
}

/** A ring of at most `cap` items, oldest dropped. */
export class Ring<T> {
  private items: T[] = []
  constructor(private cap: number) {}
  push(x: T): void {
    this.items.push(x)
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap)
  }
  all(): T[] { return this.items.slice() }
  get size(): number { return this.items.length }
}

/**
 * What a string is refused as, read before anything is stripped: '#url' for an
 * address, '#' for hex or a key broken up by punctuation, which a strip would
 * rejoin. The split-hex test wants three or more runs, so a driver's
 * `D3D11-27.20.100.8681` still reads.
 */
function refusal(s: string): '#url' | '#' | null {
  if (/:\s*\/\/|^\/\/|(https?|wss?|blob|data|file|ipfs|magnet):/i.test(s)) return '#url'
  if (/(?:[0-9a-f]{4,}[^0-9a-z]+){3,}/i.test(`${s} `)) return '#'
  if (/(nsec|npub|nprofile|nevent|naddr|ncryptsec)1[0-9a-z]{8,}/i.test(s.replace(/[^A-Za-z0-9]/g, ''))) return '#'
  return null
}

/**
 * The biggest localStorage keys, as [name, characters], largest first: names
 * through safeLabel, so a pubkey in a key reads `#`, and never a value. What
 * fills the origin's few megabytes is then known from a report (arkinox's of
 * 2026-11-18 said 47 keys and 5.1 million characters, and nothing more).
 */
export function largestKeys(entries: ReadonlyArray<readonly [string, number]>, n = 10): Array<[string, number]> {
  return [...entries].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => [safeLabel(k, 64), c])
}

/**
 * The only text that leaves: a browser's or the app's own label, cut down to the
 * characters such labels use. Anything naming a URL goes whole, tested first,
 * since the strip below takes the colon. Keys and long hex go after the strip,
 * so nothing rejoins past them, and the cut to length is last.
 */
export function safeLabel(s: unknown, max = 48): string {
  if (typeof s !== 'string') return ''
  const refused = refusal(s)
  if (refused) return refused
  return s
    .replace(/[^A-Za-z0-9_.:#$-]/g, '')
    .replace(/(nsec|npub|nprofile|nevent|naddr|note|ncryptsec)1[0-9a-z]+/gi, '#')
    .replace(/[0-9a-f]{16,}/gi, '#')
    .slice(0, max)
}

/**
 * A long frame's `invoker`, without what the element it names says about itself:
 * Chromium writes an image's src into it, so a broken avatar would put a viewed
 * profile's picture host and path in a report. `IMG[src=...].onerror` is IMG.onerror.
 * Everything from the first `#` or `[` to the last `.word` goes, since an address
 * may hold brackets and an id may hold dots.
 */
export function invokerLabel(invoker: unknown): string {
  return safeLabel(typeof invoker === 'string' ? invoker.replace(/^([A-Za-z]+)[#[].*(\.\w+)$/, '$1$2') : '')
}

/** A browser's description of itself, spaces as underscores so it still reads. */
export function safeDescription(s: unknown, max = 200): string {
  if (typeof s !== 'string') return ''
  return refusal(s) ?? safeLabel(s.replace(/[ ,;()/+]+/g, '_'), max)
}

/**
 * Bytes a texImage2D or texSubImage2D call hands over, or 0 when it only sizes
 * storage. By argument count: 9 for pixels in an array, 6 or 7 for an image or
 * canvas, whose size is in `w` and `h`.
 */
export function uploadedBytes(args: ArrayLike<unknown>, w: number, h: number): number {
  const n = args.length
  const pixels = n >= 9 ? args[8] : n === 6 ? args[5] : n === 7 ? args[6] : null
  if (pixels === null || pixels === undefined) return 0
  const length = (pixels as { byteLength?: number }).byteLength
  return typeof length === 'number' ? length : w * h * 4
}

/** How exact `performance.memory` is here: Chromium rounds it to buckets unless told otherwise. */
export type HeapReading = 'precise' | 'bucketed' | 'absent'
export function heapReading(readings: readonly number[]): HeapReading {
  if (readings.length === 0) return 'absent'
  return readings.some((r) => r % 1000 !== 0) ? 'precise' : 'bucketed'
}

/** The frame's verb, from its first bytes: nothing else of a frame is read, and nothing of it is kept. */
export function frameVerb(data: unknown): 'req' | 'close' | 'event' | 'auth' | 'other' {
  if (typeof data !== 'string') return 'other'
  if (data.startsWith('["REQ"')) return 'req'
  if (data.startsWith('["CLOSE"')) return 'close'
  if (data.startsWith('["EVENT"')) return 'event'
  if (data.startsWith('["AUTH"')) return 'auth'
  return 'other'
}

/** A frame a relay sent, by its verb, from its first bytes only, as frameVerb reads what is sent. */
export function rxVerb(data: unknown): 'event' | 'ok' | 'eose' | 'closed' | 'other' {
  if (typeof data !== 'string') return 'other'
  if (data.startsWith('["EVENT"')) return 'event'
  if (data.startsWith('["OK"')) return 'ok'
  if (data.startsWith('["EOSE"')) return 'eose'
  if (data.startsWith('["CLOSED"')) return 'closed'
  return 'other'
}

/** One row per window with relay events checked (lib/verifiedSigs countVerifies): totals, then the top kinds by time. */
export const VERIFY_COLUMNS = ['t', 'n', 'schnorr', 'hashed', 'compared', 'deferred', 'ms', 'top'] as const
/** One entry of a verify row's `top`. */
export const VERIFY_KIND_COLUMNS = ['kind', 'n', 'schnorr', 'hashed', 'compared', 'deferred', 'ms'] as const
/** Kinds kept per window. */
export const VERIFY_TOP = 8

/** A window's checks as a row (VERIFY_COLUMNS), or null when none were made. Numbers only: a kind is a number. */
export function verifyRow(t: number, byKind: ReadonlyMap<number, { n: number; schnorr: number; hashed: number; compared: number; deferred: number; ms: number }>): Array<number | number[][]> | null {
  if (byKind.size === 0) return null
  let n = 0, schnorr = 0, hashed = 0, compared = 0, deferred = 0, ms = 0
  for (const k of byKind.values()) { n += k.n; schnorr += k.schnorr; hashed += k.hashed; compared += k.compared; deferred += k.deferred; ms += k.ms }
  const top = [...byKind.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, VERIFY_TOP)
    .map(([kind, k]) => [kind, k.n, k.schnorr, k.hashed, k.compared, k.deferred, Math.round(k.ms * 10) / 10])
  return [t, n, schnorr, hashed, compared, deferred, Math.round(ms * 10) / 10, top]
}

/** The columns of one sample row. Counts over the window unless the name says otherwise. */
export const DIAG_COLUMNS = [
  't', 'hidden', 'focused', 'frames', 'ftP50', 'ftP95', 'ftP99', 'ftMax',
  'longN', 'longMs', 'longMax', 'heapUsed', 'heapTotal',
  'ctxHeld', 'ctxInDom', 'ctxLost', 'renderers', 'riGeoms', 'riTextures', 'riPrograms',
  'glBuffers', 'glBufferB', 'glTextures', 'glTextureB', 'glRbs', 'glRbB', 'glCanvasB', 'glFbos', 'glVaos', 'glPrograms',
  'draws', 'verts', 'bufData', 'bufDataB', 'bufSub', 'bufSubB', 'texUp', 'texUpB', 'links',
  'objects', 'meshes', 'visibleMeshes', 'shardFaces', 'points', 'lines', 'instanced', 'geoms', 'sceneVerts',
  'wsOpen', 'relays', 'relaysUp', 'subs', 'txReq', 'txClose', 'txEvent', 'txAuth', 'rxN', 'rxB',
  'workersMade', 'workersLive', 'timeouts', 'intervals', 'resN', 'resB', 'dom', 'canvases', 'idbB', 'storeB', 'thumbs', 'thumbQueue', 'selfMs', 'ui',
  // Added 2026-11-21, at the end so a reader by position still reads the columns before them.
  'rxEv', 'rxOk', 'rxEose',
] as const

export type DiagColumn = (typeof DIAG_COLUMNS)[number]
export type DiagRow = Partial<Record<DiagColumn, number | string>>

/** A sample as a flat array in column order: about a quarter the size of objects with names. Null where nothing was read, never a false 0. */
export function toRow(s: DiagRow): Array<number | string | null> {
  return DIAG_COLUMNS.map((c) => s[c] ?? null)
}

/** One script a long animation frame names (PerformanceScriptTiming): only these fields are read. */
export interface LoafScript {
  startTime?: number
  duration: number
  invokerType?: string
  invoker?: string
  sourceFunctionName?: string
  sourceURL?: string
  sourceCharPosition?: number
  forcedStyleAndLayoutDuration?: number
}

/** A long animation frame (PerformanceLongAnimationFrameTiming): only these fields are read. */
export interface LoafFrame {
  startTime: number
  duration: number
  blockingDuration?: number
  renderStart?: number
  styleAndLayoutStart?: number
  scripts?: readonly LoafScript[]
}

/** A frame this long counts. A 60 Hz frame is 16.7 ms, so 50 ms is three missed. */
export const LOAF_MIN_MS = 50
/** Scripts kept per window, and for the whole capture. */
export const LOAF_TOP = 8
export const LOAF_TOP_ALL = 24

/** Distinct scripts summed for the whole capture: past this, only those already seen are added to. */
const LOAF_KEYS_KEPT = 2_000

/**
 * One row per window with long frames. ms columns are summed over the window's
 * long frames: scriptMs every script named (animation frame callbacks among
 * them), rafMs the frame's animation frame callbacks (renderStart to
 * styleAndLayoutStart), layoutMs its style, layout and paint, otherMs what no
 * script and no rendering accounts for.
 */
export const LOAF_COLUMNS = ['t', 'frames', 'ms', 'maxMs', 'blockMs', 'scriptMs', 'rafMs', 'layoutMs', 'otherMs', 'top'] as const
/** One entry of a row's `top`, and of `loafTop`: who ran, and how long, in those frames. */
export const LOAF_SCRIPT_COLUMNS = ['invokerType', 'invoker', 'fn', 'pos', 'file', 'n', 'ms', 'maxMs', 'forcedMs'] as const

interface LoafAgg { type: string; invoker: string; fn: string; pos: number; file: string; n: number; ms: number; max: number; forced: number }

const r1 = (x: number): number => Math.round(x * 10) / 10

/**
 * A script's file: its name alone for a script file served over http (the
 * app's own chunks); `page` for the page's own address (an inline script, a
 * timer, eval), whose path could name a place; for a blob, data or extension
 * script, only its scheme.
 */
export function scriptFile(url: unknown): string {
  if (typeof url !== 'string' || !url) return ''
  if (!/^https?:\/\//i.test(url)) return safeLabel(url.split(':')[0], 16)
  const name = url.replace(/[?#].*$/, '').replace(/^https?:\/\/[^/]*/i, '').split('/').filter(Boolean).pop() ?? ''
  return /\.(m?js|cjs|wasm)$/i.test(name) ? safeLabel(name) : 'page'
}

/**
 * Long animation frames, aggregated by who ran in them (2026-11-21).
 *
 * arkinox's WALK on #840 had two or three long tasks a second, nearly all 80
 * to 90 ms, tracking relay traffic; the 200 ms `slow` log never saw them. Each
 * frame of LOAF_MIN_MS or more is summed here by the script that ran in it:
 * its invoker type, its invoker, its function's name and position, and its
 * file's name. All text passes safeLabel and invokerLabel, so no URL, key or
 * content is kept; a minified function's name is one letter, and its position
 * in its file finds it in that build.
 */
export class LoafLedger {
  private win = new Map<string, LoafAgg>()
  private all = new Map<string, LoafAgg>()
  private frames = 0
  private ms = 0
  private max = 0
  private block = 0
  private script = 0
  private raf = 0
  private layout = 0
  private rafScript = 0

  add(e: LoafFrame): void {
    if (!(e.duration >= LOAF_MIN_MS)) return
    this.frames++
    this.ms += e.duration
    this.max = Math.max(this.max, e.duration)
    this.block += e.blockingDuration || 0
    const end = e.startTime + e.duration
    const render = e.renderStart || 0
    const layout = e.styleAndLayoutStart || 0
    if (layout > 0) this.layout += Math.max(0, end - layout)
    if (render > 0) this.raf += Math.max(0, (layout > 0 ? layout : end) - render)
    for (const s of e.scripts ?? []) {
      const ms = s.duration || 0
      this.script += ms
      // A callback run in the frame's render phase (animation frames, resize observers) is inside rafMs too.
      if (render > 0 && s.invokerType === 'user-callback' && (s.startTime || 0) >= render) this.rafScript += ms
      const type = safeLabel(s.invokerType, 24)
      const invoker = invokerLabel(s.invoker)
      const fn = safeLabel(s.sourceFunctionName)
      const pos = typeof s.sourceCharPosition === 'number' ? s.sourceCharPosition : -1
      const file = scriptFile(s.sourceURL)
      const key = `${type}|${invoker}|${fn}|${pos}|${file}`
      for (const m of [this.win, this.all]) {
        let a = m.get(key)
        if (!a) {
          if (m === this.all && m.size >= LOAF_KEYS_KEPT) continue
          a = { type, invoker, fn, pos, file, n: 0, ms: 0, max: 0, forced: 0 }
          m.set(key, a)
        }
        a.n++
        a.ms += ms
        a.max = Math.max(a.max, ms)
        a.forced += s.forcedStyleAndLayoutDuration || 0
      }
    }
  }

  /** The window's row (LOAF_COLUMNS), or null when no long frame came; the window starts over either way. */
  take(t: number): Array<number | Array<Array<string | number>>> | null {
    // Animation frame callbacks are scripts too: counted once, in scriptMs.
    const other = this.ms - this.script - Math.max(0, this.raf - this.rafScript) - this.layout
    const out = this.frames === 0 ? null : [
      t, this.frames, Math.round(this.ms), Math.round(this.max), Math.round(this.block), Math.round(this.script), Math.round(this.raf),
      Math.round(this.layout), Math.round(Math.max(0, other)), LoafLedger.top(this.win, LOAF_TOP),
    ]
    this.win.clear()
    this.frames = 0; this.ms = 0; this.max = 0; this.block = 0; this.script = 0; this.raf = 0; this.layout = 0; this.rafScript = 0
    return out
  }

  /** The whole capture's biggest, by time. */
  top(): Array<Array<string | number>> { return LoafLedger.top(this.all, LOAF_TOP_ALL) }

  private static top(m: Map<string, LoafAgg>, n: number): Array<Array<string | number>> {
    return [...m.values()].sort((a, b) => b.ms - a.ms).slice(0, n).map((a) => [a.type, a.invoker, a.fn, a.pos, a.file, a.n, r1(a.ms), r1(a.max), r1(a.forced)])
  }
}

/** One row per window with head confirmations (lib/chains.ts countHeadChecks): how their questions ended, relays holding the chain that gave no answer (silent, or ended by their own timer, connect or AUTH), and time. */
export const HEAD_COLUMNS = ['t', 'n', 'answers', 'cap', 'backstop', 'stop', 'heldLate', 'ms', 'maxMs'] as const

export function headRow(t: number, h: { n: number; answers: number; cap: number; backstop: number; stop: number; heldLate: number; ms: number; maxMs: number }): number[] | null {
  if (h.n === 0) return null
  return [t, h.n, h.answers, h.cap, h.backstop, h.stop, h.heldLate, Math.round(h.ms), Math.round(h.maxMs)]
}
