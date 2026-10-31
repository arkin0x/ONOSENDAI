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
 * The only text that leaves: a browser's or the app's own label, cut down to
 * the characters such labels use. Spaces, quotes, colons with slashes and long
 * hex are gone, so a URL, a key or a sentence cannot survive it whole.
 */
export function safeLabel(s: unknown, max = 48): string {
  if (typeof s !== 'string') return ''
  return s.replace(/[0-9a-fA-F]{16,}/g, '#').replace(/\b(nsec|npub|ncryptsec)1[0-9a-z]+/g, '#').replace(/[^A-Za-z0-9_.:#$-]/g, '').slice(0, max)
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

/** The columns of one sample row. Counts over the window unless the name says otherwise. */
export const DIAG_COLUMNS = [
  't', 'hidden', 'focused', 'frames', 'ftP50', 'ftP95', 'ftP99', 'ftMax',
  'longN', 'longMs', 'longMax', 'heapUsed', 'heapTotal',
  'ctxHeld', 'ctxInDom', 'ctxLost', 'renderers', 'riGeoms', 'riTextures', 'riPrograms', 'riCalls', 'riTriangles',
  'glBuffers', 'glBufferB', 'glTextures', 'glTextureB', 'glRbs', 'glRbB', 'glCanvasB', 'glFbos', 'glVaos', 'glPrograms',
  'draws', 'verts', 'bufData', 'bufDataB', 'bufSub', 'bufSubB', 'texUp', 'texUpB', 'links',
  'objects', 'meshes', 'visibleMeshes', 'shardFaces', 'points', 'lines', 'instanced', 'geoms', 'sceneVerts',
  'wsOpen', 'relays', 'relaysUp', 'subs', 'txReq', 'txClose', 'txEvent', 'txAuth', 'rxN', 'rxB',
  'timeouts', 'intervals', 'resN', 'resB', 'dom', 'canvases', 'idbB', 'storeB', 'thumbs', 'thumbQueue', 'selfMs', 'ui',
] as const

export type DiagColumn = (typeof DIAG_COLUMNS)[number]
export type DiagRow = Partial<Record<DiagColumn, number | string>>

/** A sample as a flat array in column order: about a quarter the size of objects with names. */
export function toRow(s: DiagRow): Array<number | string> {
  return DIAG_COLUMNS.map((c) => s[c] ?? 0)
}
