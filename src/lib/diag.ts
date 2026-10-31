/**
 * diag.ts: a capture for the machine this project cannot reach (2026-10-31).
 *
 * arkinox's Windows and Brave tab spikes to 11 GB+, and nothing here reproduces
 * it under SwiftShader. ?diag=1 (lib/diagGate) loads this chunk before the app
 * draws. It keeps a rolling log in memory and a small chip copies it as JSON.
 *
 * Off, none of this is fetched. On, it holds numbers and labels and never a
 * payload: a socket's frames are read for their verb and their length, storage
 * for its size, and all text passes safeLabel. No key, no plaintext, no relay
 * address and no coordinate is ever kept.
 *
 * A tab that crashes at a spike takes a log in memory with it, so the last report
 * is kept in this tab's sessionStorage once a minute, and the next load offers it.
 *
 * Installed before the first render, because it has to see the contexts made.
 */

import { getPool } from './relay'
import { modalUp } from '../hooks/useEscape'
import { useCyberspace } from '../store/useCyberspace'
import { useHyperspace } from '../store/useHyperspace'
import { useThumbs } from '../store/useThumbs'
import { useTv } from '../store/useTv'
import { useWorkshop } from '../store/useWorkshop'
import { DIAG_FOUND_KEY, DIAG_LAST_KEY, diagForget } from './diagGate'
import { DIAG_COLUMNS, GlLedger, Ring, frameVerb, framePercentiles, heapReading, invokerLabel, safeDescription, safeLabel, toRow, uploadedBytes, type DiagRow } from './diagCore'

/** Seconds between samples, and how long each ring reaches back. */
const SAMPLE_MS = 5_000
const COARSE_MS = 60_000
const FINE_ROWS = 360
const COARSE_ROWS = 720
/** Long frames kept with what ran in them. */
const SLOW_ROWS = 200
/** The moments things changed: kept apart, so a burst of long frames cannot push them out. */
const EVENT_ROWS = 200
/** A frame this long is logged with its scripts. */
const SLOW_FRAME_MS = 200
const STORAGE_EVERY_MS = 60_000
/** How often the report is kept for a tab that crashes. */
const KEEP_EVERY_MS = 60_000
/** How long the clipboard gets before the log is saved as a file instead. */
const COPY_WAIT_MS = 2_000

interface ThreeLike {
  isWebGLRenderer?: boolean
  isScene?: boolean
  domElement?: HTMLCanvasElement
  getPixelRatio?: () => number
  info?: { memory: { geometries: number; textures: number }; programs: unknown[] | null }
  traverse?: (f: (o: Record<string, unknown>) => void) => void
}

type Proto = Record<string, unknown>

/** Run `after` before each call of a method of `proto`. Rest arguments are fine here: only rare calls come this way. */
function around(proto: Proto, name: string, before: (gl: object, a: IArguments) => void): void {
  const o = proto[name] as ((...a: unknown[]) => unknown) | undefined
  if (typeof o !== 'function') return
  proto[name] = function (this: object) {
    // eslint-disable-next-line prefer-rest-params
    before(this, arguments)
    // eslint-disable-next-line prefer-rest-params
    return o.apply(this, arguments as unknown as unknown[])
  }
}

let started = false

/** Start the capture. Once per page; what it wraps stays wrapped until the page goes. */
export function startDiag(): void {
  if (started) return
  started = true
  // Past the wait in main.tsx, the app drew first, and contexts made before now go uncounted.
  const lateStart = !!document.querySelector('canvas')
  const ledger = new GlLedger()

  // ---- Contexts. Weak, so the capture never holds a context or a canvas alive.
  const contexts: Array<WeakRef<WebGL2RenderingContext>> = []
  let contextsMade = 0
  let contextsLostEver = 0
  const events = new Ring<unknown[]>(EVENT_ROWS)
  const slow = new Ring<unknown[]>(SLOW_ROWS)
  const note = (...e: unknown[]): void => events.push([Math.round(performance.now() / 1000), ...e])
  const getContext = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, type: string, ...r: unknown[]) => unknown
  ;(HTMLCanvasElement.prototype as unknown as Proto).getContext = function (this: HTMLCanvasElement, type: string, ...r: unknown[]) {
    const had = (this as unknown as { __diagGl?: boolean }).__diagGl
    const c = getContext.call(this, type, ...r)
    if (c && /webgl/i.test(type) && !had) {
      ;(this as unknown as { __diagGl?: boolean }).__diagGl = true
      contextsMade++
      contexts.push(new WeakRef(c as WebGL2RenderingContext))
      this.addEventListener('webglcontextlost', () => { contextsLostEver++; note('ctx-lost', this.width, this.height) })
      note('ctx-new', this.width, this.height)
    }
    return c
  }
  const liveContexts = (): WebGL2RenderingContext[] => {
    const out: WebGL2RenderingContext[] = []
    for (let i = contexts.length - 1; i >= 0; i--) {
      const c = contexts[i].deref()
      if (c) out.push(c)
      else contexts.splice(i, 1)
    }
    return out
  }
  const isLost = (gl: object): boolean => (gl as WebGL2RenderingContext).isContextLost()

  // ---- What the page asks WebGL to hold, and what it does per frame.
  const P = window.WebGL2RenderingContext?.prototype as unknown as Proto | undefined
  if (P) {
    const counts = (): typeof ledger.counts => ledger.counts
    // Draws and binds come many times a frame, so these take no rest arguments.
    const drawElements = P.drawElements as (this: unknown, m: number, c: number, t: number, o: number) => void
    P.drawElements = function (this: unknown, m: number, c: number, t: number, o: number) { const k = counts(); k.draws++; k.verts += c; drawElements.call(this, m, c, t, o) }
    const drawArrays = P.drawArrays as (this: unknown, m: number, f: number, c: number) => void
    P.drawArrays = function (this: unknown, m: number, f: number, c: number) { const k = counts(); k.draws++; k.verts += c; drawArrays.call(this, m, f, c) }
    const drawElementsInstanced = P.drawElementsInstanced as (this: unknown, m: number, c: number, t: number, o: number, n: number) => void
    P.drawElementsInstanced = function (this: unknown, m: number, c: number, t: number, o: number, n: number) { const k = counts(); k.draws++; k.verts += c * n; drawElementsInstanced.call(this, m, c, t, o, n) }
    const drawArraysInstanced = P.drawArraysInstanced as (this: unknown, m: number, f: number, c: number, n: number) => void
    P.drawArraysInstanced = function (this: unknown, m: number, f: number, c: number, n: number) { const k = counts(); k.draws++; k.verts += c * n; drawArraysInstanced.call(this, m, f, c, n) }
    const bindBuffer = P.bindBuffer as (this: object, t: number, b: object | null) => void
    P.bindBuffer = function (this: object, t: number, b: object | null) { ledger.bindBuffer(this, t, b); bindBuffer.call(this, t, b) }
    const bindTexture = P.bindTexture as (this: object, t: number, b: object | null) => void
    P.bindTexture = function (this: object, t: number, b: object | null) { ledger.bindTexture(this, t, b); bindTexture.call(this, t, b) }
    const activeTexture = P.activeTexture as (this: object, u: number) => void
    P.activeTexture = function (this: object, u: number) { ledger.activeTexture(this, u - 0x84c0); activeTexture.call(this, u) }
    const bindRenderbuffer = P.bindRenderbuffer as (this: object, t: number, b: object | null) => void
    P.bindRenderbuffer = function (this: object, t: number, b: object | null) { ledger.bindRenderbuffer(this, b); bindRenderbuffer.call(this, t, b) }

    around(P, 'bufferData', (gl, a) => ledger.bufferData(gl, a[0], typeof a[1] === 'number' ? a[1] : ((a[1] as ArrayBufferView | null)?.byteLength ?? 0)))
    around(P, 'bufferSubData', (_, a) => ledger.bufferSub((a[2] as ArrayBufferView | null)?.byteLength ?? 0))
    around(P, 'deleteBuffer', (gl, a) => ledger.deleteBuffer(gl, a[0]))
    around(P, 'deleteTexture', (gl, a) => ledger.deleteTexture(gl, a[0]))
    around(P, 'deleteRenderbuffer', (gl, a) => ledger.deleteRenderbuffer(gl, a[0]))
    around(P, 'generateMipmap', (gl, a) => ledger.mipmap(gl, a[0]))
    around(P, 'renderbufferStorage', (gl, a) => ledger.renderbufferStorage(gl, 1, a[1], a[2], a[3]))
    around(P, 'renderbufferStorageMultisample', (gl, a) => ledger.renderbufferStorage(gl, a[1], a[2], a[3], a[4]))
    // Sizing storage hands over no pixels: not an upload.
    around(P, 'texStorage2D', (gl, a) => ledger.textureStorage(gl, a[0], a[1], a[2], a[3], a[4]))
    around(P, 'texStorage3D', (gl, a) => ledger.textureStorage(gl, a[0], a[1], a[2], a[3], a[4], a[5]))
    around(P, 'texImage2D', (gl, a) => {
      // (target, level, format, width, height, border, srcFormat, type, pixels) or (target, level, format, srcFormat, type, source).
      const source = a.length === 6 ? (a[5] as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number } | null) : null
      const w = source ? (source.videoWidth || source.naturalWidth || source.width || 0) : a[3]
      const h = source ? (source.videoHeight || source.naturalHeight || source.height || 0) : a[4]
      ledger.textureLevel(gl, a[0], a[1], a[2], w, h)
      const bytes = uploadedBytes(a, w, h)
      if (bytes > 0) { ledger.counts.texUploads++; ledger.counts.texUploadBytes += bytes }
    })
    around(P, 'texSubImage2D', (_, a) => {
      // (target, level, x, y, width, height, srcFormat, type, pixels) or (target, level, x, y, srcFormat, type, source).
      const source = a.length === 7 ? (a[6] as { width?: number; height?: number; videoWidth?: number; videoHeight?: number; naturalWidth?: number; naturalHeight?: number } | null) : null
      const w = source ? (source.videoWidth || source.naturalWidth || source.width || 0) : a[4]
      const h = source ? (source.videoHeight || source.naturalHeight || source.height || 0) : a[5]
      ledger.counts.texUploads++
      ledger.counts.texUploadBytes += uploadedBytes(a, w, h)
    })
    around(P, 'linkProgram', () => { ledger.counts.links++ })
    around(P, 'createProgram', (gl) => ledger.added(gl, 'programs', 1))
    around(P, 'deleteProgram', (gl, a) => { if (a[0]) ledger.added(gl, 'programs', -1) })
    around(P, 'createVertexArray', (gl) => ledger.added(gl, 'vaos', 1))
    around(P, 'deleteVertexArray', (gl, a) => { if (a[0]) ledger.added(gl, 'vaos', -1) })
    around(P, 'createFramebuffer', (gl) => ledger.added(gl, 'framebuffers', 1))
    around(P, 'deleteFramebuffer', (gl, a) => { if (a[0]) ledger.added(gl, 'framebuffers', -1) })
  }

  // ---- three.js announces each renderer and scene to its devtools hook.
  const renderers: Array<WeakRef<ThreeLike>> = []
  const scenes: Array<WeakRef<ThreeLike>> = []
  const w = window as unknown as { __THREE_DEVTOOLS__?: EventTarget; __diag?: unknown }
  w.__THREE_DEVTOOLS__ ??= new EventTarget()
  w.__THREE_DEVTOOLS__.addEventListener('observe', (e) => {
    const o = (e as CustomEvent<ThreeLike>).detail
    if (o?.isWebGLRenderer) renderers.push(new WeakRef(o))
    else if (o?.isScene) scenes.push(new WeakRef(o))
  })
  const alive = <T extends object>(list: Array<WeakRef<T>>): T[] => {
    const out: T[] = []
    for (let i = list.length - 1; i >= 0; i--) {
      const x = list[i].deref()
      if (x) out.push(x)
      else list.splice(i, 1)
    }
    return out
  }
  const sceneOf = (): { renderer: ThreeLike | null; scene: ThreeLike | null } => {
    let renderer: ThreeLike | null = null
    let area = -1
    for (const r of alive(renderers)) {
      const c = r.domElement
      const a = c ? c.width * c.height : 0
      if (a > area) { area = a; renderer = r }
    }
    let scene: ThreeLike | null = null
    let most = -1
    for (const s of alive(scenes)) {
      let n = 0
      s.traverse?.(() => n++)
      if (n > most) { most = n; scene = s }
    }
    return { renderer, scene }
  }

  // ---- Sockets: verbs and lengths only.
  const wire = { txReq: 0, txClose: 0, txEvent: 0, txAuth: 0, rxN: 0, rxB: 0 }
  const sockets: Array<WeakRef<WebSocket>> = []
  const seenSocket = new WeakSet<WebSocket>()
  const send = WebSocket.prototype.send
  WebSocket.prototype.send = function (this: WebSocket, d: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (!seenSocket.has(this)) {
      seenSocket.add(this)
      sockets.push(new WeakRef(this))
      this.addEventListener('message', (e: MessageEvent) => { wire.rxN++; wire.rxB += typeof e.data === 'string' ? e.data.length : 0 })
    }
    const v = frameVerb(d)
    if (v === 'req') wire.txReq++
    else if (v === 'close') wire.txClose++
    else if (v === 'event') wire.txEvent++
    else if (v === 'auth') wire.txAuth++
    send.call(this, d)
  }

  // ---- Timers: how many are set, which says what keeps running while hidden.
  const timers = { timeouts: 0, intervals: 0 }
  const setT = window.setTimeout
  window.setTimeout = function (this: unknown, ...a: unknown[]) { timers.timeouts++; return (setT as unknown as (...x: unknown[]) => number).apply(window, a) } as typeof window.setTimeout
  const setI = window.setInterval
  window.setInterval = function (this: unknown, ...a: unknown[]) { timers.intervals++; return (setI as unknown as (...x: unknown[]) => number).apply(window, a) } as typeof window.setInterval

  // ---- Workers: their heaps are in no column of this thread's, and terrain and rides can start one per core.
  const workers = { made: 0, ended: 0 }
  const NativeWorker = window.Worker
  if (NativeWorker) {
    window.Worker = new Proxy(NativeWorker, { construct(t, a) { workers.made++; return Reflect.construct(t, a) as object } })
    // Terminated twice is ended once, or live would read too low.
    const ended = new WeakSet<Worker>()
    const terminate = NativeWorker.prototype.terminate
    NativeWorker.prototype.terminate = function (this: Worker) {
      if (!ended.has(this)) { ended.add(this); workers.ended++ }
      terminate.call(this)
    }
  }

  // ---- Frames, while the tab draws.
  const frameTimes = new Float32Array(4096)
  let frameN = 0
  let lastFrame = 0
  const onFrame = (t: number): void => {
    if (lastFrame && t - lastFrame < 5000 && frameN < frameTimes.length) frameTimes[frameN++] = t - lastFrame
    lastFrame = t
    requestAnimationFrame(onFrame)
  }
  requestAnimationFrame(onFrame)

  // ---- Long tasks, and long frames with what ran in them.
  const long = { n: 0, ms: 0, max: 0, res: 0, resB: 0 }
  const observe = (type: string, f: (e: PerformanceEntry) => void): void => {
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) f(e) }).observe({ type, buffered: true }) } catch { /* not in this browser */ }
  }
  observe('longtask', (e) => { long.n++; long.ms += e.duration; long.max = Math.max(long.max, e.duration) })
  observe('long-animation-frame', (e) => {
    if (e.duration < SLOW_FRAME_MS) return
    const scripts = (e as unknown as { scripts?: Array<{ duration: number; invoker?: string; sourceFunctionName?: string; sourceCharPosition?: number; sourceURL?: string }> }).scripts ?? []
    slow.push([Math.round(performance.now() / 1000), Math.round(e.duration), scripts.slice().sort((a, b) => b.duration - a.duration).slice(0, 3).map((s) => [Math.round(s.duration), invokerLabel(s.invoker), safeLabel(s.sourceFunctionName), s.sourceCharPosition ?? -1, safeLabel((s.sourceURL ?? '').split('/').pop())])])
  })
  observe('resource', (e) => { long.res++; long.resB += (e as PerformanceResourceTiming).encodedBodySize ?? 0 })

  // ---- Which part of the app is up. Ids and flags, nothing of what they show.
  const uiNow = (): string => {
    const cs = useCyberspace.getState()
    const open = [...document.querySelectorAll('[data-panel-id]:not(.slot--collapsed)')].map((e) => safeLabel((e as HTMLElement).dataset.panelId)).join(',')
    return [
      open && `panels:${open}`,
      modalUp() && 'modal',
      cs.walking && 'walk',
      cs.spectate !== null && 'spectate',
      cs.focus !== null && 'view',
      useHyperspace.getState().viewOwned && 'hyperview',
      useTv.getState().on && 'tv',
      useWorkshop.getState().open && 'workshop',
    ].filter(Boolean).join('|')
  }

  // ---- Storage sizes, never contents.
  let storage: { usage?: number; quota?: number; details?: Record<string, number> } = {}
  const readStorage = async (): Promise<void> => {
    try {
      const e = (await navigator.storage.estimate()) as StorageEstimate & { usageDetails?: Record<string, number> }
      storage = { usage: e.usage, quota: e.quota, details: e.usageDetails }
    } catch { /* not in this browser */ }
  }
  void readStorage()

  // ---- The sample.
  const fine = new Ring<Array<number | string | null>>(FINE_ROWS)
  const coarse = new Ring<Array<number | string | null>>(COARSE_ROWS)
  const peak = { heapUsed: 0, heapUsedAt: 0, glBytes: 0, glBytesAt: 0, ctxHeld: 0, ctxHeldAt: 0, longMax: 0, longMaxAt: 0, subs: 0, subsAt: 0 }
  const heapReadings: number[] = []
  let lastCoarse = -COARSE_MS
  let lastStorage = 0
  // Each distinct state of the UI once, and rows point at it: a menu's panel list would be most of a row.
  const uiStates: string[] = []
  let lastUi = ''
  let lastHidden = false
  let hiddenSince: number | null = null
  let hiddenTotal = 0

  let lastKept = 0
  // Refused or full: the log in memory still stands.
  const keep = (): void => { try { sessionStorage.setItem(DIAG_LAST_KEY, report()) } catch { /* as above */ } }

  const take = (): void => {
    const t0 = performance.now()
    const row: DiagRow = { t: Math.round(t0 / 1000) }
    const hidden = document.visibilityState === 'hidden'
    if (hidden !== lastHidden) {
      lastHidden = hidden
      note(hidden ? 'hidden' : 'visible')
      if (hidden) hiddenSince = t0
      else if (hiddenSince !== null) { hiddenTotal += t0 - hiddenSince; hiddenSince = null }
    }
    row.hidden = hidden ? 1 : 0
    row.focused = document.hasFocus() ? 1 : 0

    row.frames = frameN
    const f = framePercentiles(frameTimes, frameN)
    frameN = 0
    row.ftP50 = f.p50; row.ftP95 = f.p95; row.ftP99 = f.p99; row.ftMax = f.max

    row.longN = long.n; row.longMs = Math.round(long.ms); row.longMax = Math.round(long.max)
    row.resN = long.res; row.resB = long.resB
    long.n = 0; long.ms = 0; long.max = 0; long.res = 0; long.resB = 0

    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory
    if (mem) {
      row.heapUsed = mem.usedJSHeapSize; row.heapTotal = mem.totalJSHeapSize
      // Enough to tell precise readings from buckets: one that is not a round thousand settles it.
      if (heapReadings.length < 50) heapReadings.push(mem.usedJSHeapSize)
    }

    const ctxs = liveContexts()
    row.ctxHeld = ctxs.length
    let inDom = 0
    let lostNow = 0
    let canvasB = 0
    for (const gl of ctxs) {
      if (gl.isContextLost()) { lostNow++; continue }
      const c = gl.canvas as HTMLCanvasElement
      if (c.isConnected) inDom++
      const attrs = gl.getContextAttributes()
      // Colour, the back and front buffers, and a depth buffer if asked. Multisampling only if asked.
      canvasB += gl.drawingBufferWidth * gl.drawingBufferHeight * 4 * (attrs?.antialias ? 4 : 1) * (attrs?.depth ? 3 : 2)
    }
    row.ctxInDom = inDom; row.ctxLost = lostNow; row.glCanvasB = canvasB

    const g = ledger.totals(ctxs, isLost)
    row.glBuffers = g.buffers; row.glBufferB = g.bufferBytes
    row.glTextures = g.textures; row.glTextureB = g.textureBytes
    row.glRbs = g.renderbuffers; row.glRbB = g.renderbufferBytes
    row.glFbos = g.framebuffers; row.glVaos = g.vaos; row.glPrograms = g.programs
    const k = ledger.takeCounts()
    row.draws = k.draws; row.verts = k.verts; row.bufData = k.bufferData; row.bufDataB = k.bufferDataBytes
    row.bufSub = k.bufferSub; row.bufSubB = k.bufferSubBytes; row.texUp = k.texUploads; row.texUpB = k.texUploadBytes; row.links = k.links

    row.renderers = alive(renderers).length
    const { renderer, scene } = sceneOf()
    if (renderer?.info) {
      row.riGeoms = renderer.info.memory.geometries; row.riTextures = renderer.info.memory.textures
      row.riPrograms = renderer.info.programs?.length ?? 0
    }
    if (scene) {
      let objects = 0, meshes = 0, visible = 0, faces = 0, points = 0, lines = 0, instanced = 0, geoms = 0, verts = 0
      const seen = new Set<unknown>()
      scene.traverse?.((o) => {
        objects++
        if (o.isMesh) { meshes++; if (o.visible) visible++ }
        if (o.isInstancedMesh) instanced += o.count as number
        if (o.isLine || o.isLineSegments) lines++
        if (o.isPoints) points++
        if (o.name === 'shard-faces') faces++
        const geo = o.geometry as { attributes?: { position?: { count: number } } } | undefined
        if (geo && !seen.has(geo)) { seen.add(geo); geoms++; verts += geo.attributes?.position?.count ?? 0 }
      })
      row.objects = objects; row.meshes = meshes; row.visibleMeshes = visible; row.shardFaces = faces
      row.points = points; row.lines = lines; row.instanced = instanced; row.geoms = geoms; row.sceneVerts = verts
    }

    let open = 0
    for (const s of alive(sockets)) if (s.readyState === WebSocket.OPEN) open++
    row.wsOpen = open
    const relays = (getPool() as unknown as { relays?: Map<string, { connected?: boolean; openSubs?: Map<string, unknown> }> }).relays
    let up = 0, subs = 0
    if (relays) for (const r of relays.values()) { if (r.connected) up++; subs += r.openSubs?.size ?? 0 }
    row.relays = relays?.size ?? 0; row.relaysUp = up; row.subs = subs
    row.txReq = wire.txReq; row.txClose = wire.txClose; row.txEvent = wire.txEvent; row.txAuth = wire.txAuth; row.rxN = wire.rxN; row.rxB = wire.rxB
    wire.txReq = 0; wire.txClose = 0; wire.txEvent = 0; wire.txAuth = 0; wire.rxN = 0; wire.rxB = 0
    row.workersMade = workers.made; row.workersLive = workers.made - workers.ended
    row.timeouts = timers.timeouts; row.intervals = timers.intervals
    timers.timeouts = 0; timers.intervals = 0

    row.dom = document.getElementsByTagName('*').length
    row.canvases = document.getElementsByTagName('canvas').length
    // Unread stays null: a refused estimate is not a measured 0.
    row.idbB = storage.details?.indexedDB
    row.storeB = storage.usage
    const th = useThumbs.getState()
    row.thumbs = th.order.length; row.thumbQueue = th.queue.length

    const ui = uiNow()
    let uiAt = uiStates.indexOf(ui)
    if (uiAt < 0) uiAt = uiStates.push(ui) - 1
    row.ui = uiAt
    if (ui !== lastUi) { lastUi = ui; note('ui', uiAt) }

    const glBytes = g.bufferBytes + g.textureBytes + g.renderbufferBytes + canvasB
    if ((mem?.usedJSHeapSize ?? 0) > peak.heapUsed) { peak.heapUsed = mem!.usedJSHeapSize; peak.heapUsedAt = row.t as number }
    if (glBytes > peak.glBytes) { peak.glBytes = glBytes; peak.glBytesAt = row.t as number }
    if (ctxs.length > peak.ctxHeld) { peak.ctxHeld = ctxs.length; peak.ctxHeldAt = row.t as number }
    if ((row.longMax as number) > peak.longMax) { peak.longMax = row.longMax as number; peak.longMaxAt = row.t as number }
    if (subs > peak.subs) { peak.subs = subs; peak.subsAt = row.t as number }

    row.selfMs = Math.round((performance.now() - t0) * 10) / 10
    const out = toRow(row)
    fine.push(out)
    if (t0 - lastCoarse >= COARSE_MS) { lastCoarse = t0; coarse.push(out) }
    if (t0 - lastStorage >= STORAGE_EVERY_MS) { lastStorage = t0; void readStorage() }
    if (t0 - lastKept >= KEEP_EVERY_MS) { lastKept = t0; keep() }
  }
  window.setInterval(take, SAMPLE_MS)
  document.addEventListener('visibilitychange', take)

  // ---- The report.
  const isBrave = !!(navigator as unknown as { brave?: unknown }).brave
  let gpuInfo: { gpu: string | null; maxSamples: number | null } | null = null
  const report = (): string => {
    const ctxs = liveContexts()
    let lsBytes = 0
    let lsKeys = 0
    try {
      lsKeys = localStorage.length
      for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i)!; lsBytes += key.length + (localStorage.getItem(key)?.length ?? 0) }
    } catch { /* refused */ }
    // The largest drawing context: a throwaway probe may be WebGL 1, with no MAX_SAMPLES to ask.
    const first = ctxs.filter((gl) => !gl.isContextLost()).sort((a, b) => b.drawingBufferWidth * b.drawingBufferHeight - a.drawingBufferWidth * a.drawingBufferHeight)[0]
    // Read once: these wait on the GPU process, and a stalled one must not hold the tab each time he copies.
    if (first && !gpuInfo) {
      const ext = first.getExtension('WEBGL_debug_renderer_info')
      gpuInfo = {
        gpu: ext ? safeDescription(first.getParameter(ext.UNMASKED_RENDERER_WEBGL), 120) : null,
        maxSamples: first.MAX_SAMPLES ? (first.getParameter(first.MAX_SAMPLES) as number) : null,
      }
    }
    return JSON.stringify({
      diag: 1,
      at: new Date().toISOString(),
      uptimeS: Math.round(performance.now() / 1000),
      hiddenS: Math.round((hiddenTotal + (hiddenSince !== null ? performance.now() - hiddenSince : 0)) / 1000),
      env: {
        build: safeLabel(String(__ONOSENDAI_BUILD__).slice(0, 12)), version: safeLabel(__ONOSENDAI_VERSION__),
        ua: safeDescription(navigator.userAgent),
        nav: safeLabel((performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type),
        heap: heapReading(heapReadings),
        brave: isBrave,
        // Default Shields farble these and Strict randomizes `gpu`, so under Brave they are not facts about his machine.
        farbled: isBrave ? ['cores', 'memGb', 'screen'] : [],
        cores: navigator.hardwareConcurrency, memGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? null,
        dpr: window.devicePixelRatio, inner: [window.innerWidth, window.innerHeight], screen: [screen.width, screen.height],
        gpu: gpuInfo?.gpu ?? null, maxSamples: gpuInfo?.maxSamples ?? null, lateStart, route: safeLabel(location.pathname.split('/')[1] ?? '', 12), isolated: window.crossOriginIsolated,
        heapLimit: (performance as unknown as { memory?: { jsHeapSizeLimit: number } }).memory?.jsHeapSizeLimit ?? null,
      },
      contexts: { made: contextsMade, lostEver: contextsLostEver },
      workers: { made: workers.made, ended: workers.ended },
      renderers: alive(renderers).map((r) => ({ w: r.domElement?.width, h: r.domElement?.height, pr: r.getPixelRatio?.(), geoms: r.info?.memory.geometries, textures: r.info?.memory.textures, programs: r.info?.programs?.length ?? 0 })),
      largest: ledger.largest(ctxs, isLost),
      storage: { ...storage, localStorageKeys: lsKeys, localStorageChars: lsBytes },
      peak,
      columns: DIAG_COLUMNS,
      uiStates,
      fine: fine.all(),
      coarse: coarse.all(),
      slow: slow.all(),
      events: events.all(),
    })
  }

  const save = (json: string): void => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    a.download = `onosendai-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // What the load before this one left, kept aside before this load writes over it.
  let found = false
  try {
    const last = sessionStorage.getItem(DIAG_LAST_KEY)
    if (last) { sessionStorage.setItem(DIAG_FOUND_KEY, last); sessionStorage.removeItem(DIAG_LAST_KEY); found = true }
    else found = sessionStorage.getItem(DIAG_FOUND_KEY) !== null
  } catch { /* refused: nothing to offer */ }

  // ---- The chip.
  const chip = document.createElement('div')
  chip.className = 'diag-chip'
  chip.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:2147483647;display:flex;gap:4px;align-items:center;font:10px monospace;color:#0f0;background:#000c;padding:2px 4px;'
  const label = document.createElement('span')
  label.textContent = 'DIAG'
  const button = (text: string, onTap: () => void): HTMLButtonElement => {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = text
    b.style.cssText = 'font:inherit;color:inherit;background:none;border:1px solid currentColor;padding:4px 8px;cursor:pointer;'
    // Not left holding focus: Space is COMMIT in this app, and a focused button would take it.
    b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); onTap() })
    return b
  }
  const say = (text: string): void => {
    label.textContent = text
    setT(() => { label.textContent = 'DIAG' }, 3000)
  }
  const copy = (json: string): void => {
    // A clipboard that refuses, is missing, or never answers still gets him the file.
    let settled = false
    const asFile = (): void => { if (settled) return; settled = true; save(json); say('SAVED') }
    const late = setT(asFile, COPY_WAIT_MS)
    const written = navigator.clipboard?.writeText(json)
    if (!written) { clearTimeout(late); asFile(); return }
    written.then(() => {
      clearTimeout(late)
      if (settled) return
      settled = true
      say(`COPIED ${Math.round(json.length / 1024)} KB`)
    }, () => { clearTimeout(late); asFile() })
  }
  const fresh = (): string => { take(); return report() }
  const off = (): void => {
    try { diagForget(sessionStorage) } catch { /* refused */ }
    const u = new URL(location.href)
    u.searchParams.delete('diag')
    location.replace(u)
  }
  chip.append(
    button('COPY', () => copy(fresh())),
    button('SAVE', () => { save(fresh()); say('SAVED') }),
    ...(found ? [button('LAST', () => {
      let last: string | null = null
      try { last = sessionStorage.getItem(DIAG_FOUND_KEY) } catch { /* refused */ }
      if (last) copy(last)
    })] : []),
    button('OFF', off),
    // After the buttons: a long status moves nothing he might be about to tap.
    label,
  )
  const mount = (): void => { document.body.append(chip) }
  if (document.body) mount()
  else document.addEventListener('DOMContentLoaded', mount)

  w.__diag = { report: fresh }
  take()
}
