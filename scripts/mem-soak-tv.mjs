/**
 * mem-soak-tv.mjs: Cyberspace TV's broadcast (/tv?broadcast=1) over a long
 * session, and after its GPU goes away, offline (2026-10-26).
 *
 * The 24/7 stream (the cyberspace-tv StartOS service) went black every one
 * to two hours: "WebGL context lost", then the streamer's reload, then twice
 * "the TV page had not loaded" (60 s each) before it came back, the music
 * playing on through all of it (arkinox, 2026-10-26). This drives the dev
 * build the way the streamer does (a 1921 x 1081 window, the broadcast
 * address, sound allowed) and says what it holds:
 *
 *   soak      every SAMPLE seconds: the JS heap, process RSS by role (the
 *             GPU process is where SwiftShader keeps what a GPU would),
 *             renderer.info (window.__gl), every WebGL buffer, texture,
 *             renderbuffer and program counted at the context with the bytes
 *             it was given, the 2D canvases alive and their pixels, the
 *             pictures and videos made; and, every second, what TV is doing
 *             (shot, spot, explainer, zoom), so each sample says how many
 *             spots, explainers and cuts it has been through.
 *   gpucrash  once TV is drawing, the GPU process is crashed (CDP
 *             Browser.crashGpuProcess), then the page is reloaded as the
 *             streamer reloads it (Page.navigate to the same address, after
 *             its next 5 s sample sees __tvCtxLost go up), and again every
 *             60 s while window.__tvFrames is not a number ("the TV page had
 *             not loaded"); it says how long each load took to draw a frame,
 *             what WebGL said, and what the screen showed. A crash is one
 *             loss to Chromium (all the page's contexts at once), so it is
 *             never refused WebGL after it: that is what blocked is for.
 *   blocked   WebGL refused for BLOCK_S seconds (120), as Chromium refuses it
 *             to a domain that lost two or more contexts to the GPU in two
 *             minutes: getContext gives null, with the browser's own words on
 *             a webglcontextcreationerror. The page loaded as the streamer
 *             loads it after a loss, and again every 60 s while it has not
 *             drawn; every 5 s what it shows (window.__tvStandby, the page's
 *             text), whether TV and its music are on, and when it draws.
 *   probe     after [minutes] seconds, every WebGL context the page made: when,
 *             how big, and whether it was in the page.
 *
 * The relays are a recording (RELAY_DUMP), REQ by REQ, as in mem-soak-world:
 * an EVENT is answered OK false and counted, never sent anywhere. Every HTTP
 * request to anything but localhost is refused, except that a picture is
 * answered with one large local JPEG (PIC), music with a local MP3 (TONE),
 * and the explainers' two videos with local copies of the same files
 * (MEDIA/ex1.mp4, ex2.mp4; their hashes are checked by the app). LOCAL is set
 * before the first script runs.
 *
 * Usage (from the repo, a dev server running):
 *   DISPLAY=:N node scripts/mem-soak-tv.mjs <soak|gpucrash|blocked|probe> <url> <out dir> [minutes]
 * Env: MEDIA (dir with ex1.mp4, ex2.mp4, pic.jpg, tone.mp3), RELAY_DUMP,
 * SAMPLE (30), CAP (500), W (1921), H (1081), TEXT (large), ANGLE
 * (swiftshader), CHROME, TAG, FLAGS (extra Chromium switches, comma separated),
 * ROUNDS (gpucrash, 2), BLOCK_S (blocked, 120).
 */
import fs from 'node:fs'
import readline from 'node:readline'
import { chromium } from 'playwright'

const [mode, url, out, minArg = '60'] = process.argv.slice(2)
if (!['soak', 'gpucrash', 'probe', 'blocked'].includes(mode) || !url || !out) { console.log('usage: mem-soak-tv.mjs <soak|gpucrash|blocked|probe> <url> <out dir> [minutes]'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const SAMPLE = Number(process.env.SAMPLE ?? 30) * 1000
const CAP = Number(process.env.CAP ?? 500)
const W = Number(process.env.W ?? 1921)
const H = Number(process.env.H ?? 1081)
const TEXT = process.env.TEXT ?? 'large'
const TAG = process.env.TAG ? `-${process.env.TAG}` : ''
const MEDIA = process.env.MEDIA ?? ''
const DUMP = process.env.RELAY_DUMP ?? '/data/projects/relay-copy/before/src3.jsonl'
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const ANGLE = process.env.ANGLE ?? 'swiftshader'
const FLAGS = (process.env.FLAGS ?? '').split(',').filter(Boolean)
const log = (...a) => { const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(line); fs.appendFileSync(`${out}/${mode}${TAG}.log`, line + '\n') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const media = (f) => (MEDIA && fs.existsSync(`${MEDIA}/${f}`) ? fs.readFileSync(`${MEDIA}/${f}`) : null)
const PIC = media('pic.jpg'), TONE = media('tone.mp3')
const EXPLAINERS = { '7fhEpkDbBuEd3QK5JXrCG5.mp4': media('ex1.mp4'), 'E5soFc2c5mWSFkqErhMllf.mp4': media('ex2.mp4') }

// ---- The recorded relay ----------------------------------------------------
const events = []
const byKind = new Map(), byAuthor = new Map(), byId = new Map(), byTag = new Map()
const push = (m, k, e) => { let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(e) }
{
  const rl = readline.createInterface({ input: fs.createReadStream(DUMP) })
  for await (const line of rl) {
    if (!line.startsWith('{')) continue
    const e = JSON.parse(line)
    events.push(e)
    byId.set(e.id, e)
    push(byKind, e.kind, e)
    push(byAuthor, e.pubkey, e)
    for (const t of e.tags) if (t.length >= 2 && t[0].length === 1) push(byTag, `${t[0]}:${t[1]}`, e)
  }
}
log('dump', DUMP, 'events', events.length)
const matches = (f, e) => {
  if (f.ids && !f.ids.includes(e.id)) return false
  if (f.kinds && !f.kinds.includes(e.kind)) return false
  if (f.authors && !f.authors.includes(e.pubkey)) return false
  if (f.since !== undefined && e.created_at < f.since) return false
  if (f.until !== undefined && e.created_at > f.until) return false
  for (const k of Object.keys(f)) {
    if (k[0] !== '#') continue
    if (!e.tags.some((t) => t[0] === k.slice(1) && f[k].includes(t[1]))) return false
  }
  return true
}
const query = (f) => {
  const pools = []
  if (f.ids) pools.push(f.ids.map((i) => byId.get(i)).filter(Boolean))
  if (f.authors) pools.push(f.authors.flatMap((a) => byAuthor.get(a) ?? []))
  for (const k of Object.keys(f)) if (k[0] === '#') pools.push(f[k].flatMap((v) => byTag.get(`${k.slice(1)}:${v}`) ?? []))
  if (f.kinds) pools.push(f.kinds.flatMap((k) => byKind.get(k) ?? []))
  const pool = pools.length ? pools.sort((a, b) => a.length - b.length)[0] : events
  return pool.filter((e) => matches(f, e)).sort((a, b) => b.created_at - a.created_at).slice(0, Math.min(CAP, f.limit ?? CAP))
}
const relay = { reqs: 0, sent: 0, refusedEvents: 0 }
const net = { blocked: 0, pictures: 0, music: 0, explainers: 0 }

// ---- The browser, as the streamer runs it -------------------------------
const gl = ANGLE === 'swiftshader' ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [`--use-angle=${ANGLE}`]
const browser = await chromium.launch({
  headless: false, executablePath: CHROME,
  args: ['--enable-precise-memory-info', '--js-flags=--expose-gc', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', ...gl, ...FLAGS, `--window-size=${W},${H}`, '--window-position=0,0'],
})
const chromePid = (() => {
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const cl = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8')
      if (!cl.startsWith(CHROME) || cl.includes('--type=')) continue
      if (fs.readFileSync(`/proc/${p}/environ`, 'utf8').split('\0').includes(`DISPLAY=${process.env.DISPLAY}`)) return Number(p)
    } catch { /* gone, or not ours */ }
  }
  return null
})()
const ctx = await browser.newContext({ viewport: null })
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u.toString()), (r) => {
  const req = r.request(), u = req.url()
  const ex = Object.keys(EXPLAINERS).find((k) => u.endsWith(k))
  if (ex && EXPLAINERS[ex]) { net.explainers++; return fulfillRange(r, EXPLAINERS[ex], 'video/mp4') }
  if (req.resourceType() === 'image' && PIC) { net.pictures++; return r.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'access-control-allow-origin': '*' }, body: PIC }) }
  if (req.resourceType() === 'media' && TONE) { net.music++; return fulfillRange(r, TONE, 'audio/mpeg') }
  net.blocked++
  return r.abort()
})
/** A file answered as a server with byte ranges answers it: a video element asks in ranges. */
function fulfillRange(r, buf, type) {
  const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range ?? '')
  const headers = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes' }
  if (!range) return r.fulfill({ status: 200, contentType: type, headers, body: buf })
  const a = Number(range[1]), b = range[2] ? Math.min(buf.length - 1, Number(range[2])) : buf.length - 1
  return r.fulfill({ status: 206, contentType: type, headers: { ...headers, 'content-range': `bytes ${a}-${b}/${buf.length}` }, body: buf.subarray(a, b + 1) })
}
await ctx.routeWebSocket(/.*/, (ws) => {
  if (/^wss?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(ws.url())) { ws.connectToServer(); return }
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') {
      relay.reqs++
      const seen = new Set()
      for (const f of m.slice(2)) for (const e of query(f)) if (!seen.has(e.id)) { seen.add(e.id); ws.send(JSON.stringify(['EVENT', m[1], e])); relay.sent++ }
      ws.send(JSON.stringify(['EOSE', m[1]]))
    } else if (m[0] === 'EVENT') { relay.refusedEvents++; ws.send(JSON.stringify(['OK', m[1]?.id ?? '', false, 'blocked: recorded relay, read only'])) }
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})
const page = await ctx.newPage()
await page.addInitScript((blockUntil) => {
  try { localStorage.setItem('onosendai:live', '0') } catch {}
  // Every WebGL object the page makes, and the bytes it gave each: what a GPU would hold for it.
  const g = { made: [], buffers: 0, textures: 0, renderbuffers: 0, programs: 0, vaos: 0, framebuffers: 0, contexts: 0, lost: 0, restored: 0, createErrors: [] }
  const bytes = new Map()
  const bound = new Map()
  const fmtBytes = (f) => (f === 0x8814 || f === 0x881a || f === 0x8d70 ? 16 : f === 0x822e || f === 0x8d62 ? 8 : 4)
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    const wrap = (name, f) => { const o = P.prototype[name]; if (o) P.prototype[name] = function (...a) { f(a, this); return o.apply(this, a) } }
    const keyOf = (cx, t) => `${cx.__id}:${t}:${cx.__unit ?? 0}`
    wrap('createBuffer', () => g.buffers++); wrap('deleteBuffer', (a) => { if (a[0]) { g.buffers--; bytes.delete(a[0]) } })
    wrap('createTexture', () => g.textures++); wrap('deleteTexture', (a) => { if (a[0]) { g.textures--; bytes.delete(a[0]) } })
    wrap('createRenderbuffer', () => g.renderbuffers++); wrap('deleteRenderbuffer', (a) => { if (a[0]) { g.renderbuffers--; bytes.delete(a[0]) } })
    wrap('createFramebuffer', () => g.framebuffers++); wrap('deleteFramebuffer', (a) => { if (a[0]) g.framebuffers-- })
    wrap('createProgram', () => g.programs++); wrap('deleteProgram', (a) => { if (a[0]) g.programs-- })
    wrap('createVertexArray', () => g.vaos++); wrap('deleteVertexArray', (a) => { if (a[0]) g.vaos-- })
    wrap('activeTexture', (a, cx) => { cx.__unit = a[0] })
    wrap('bindTexture', (a, cx) => bound.set(keyOf(cx, a[0]), a[1]))
    wrap('bindBuffer', (a, cx) => bound.set(`${cx.__id}:b${a[0]}`, a[1]))
    wrap('bindRenderbuffer', (a, cx) => bound.set(`${cx.__id}:r`, a[1]))
    const tex = (cx, target, level, w, h, d, f) => {
      const t = bound.get(keyOf(cx, target === 0x806f || target === 0x8c1a ? target : target >= 0x8515 && target <= 0x851a ? 0x8513 : target))
      if (!t || !(w > 0) || !(h > 0)) return
      const k = (w * h * (d || 1) * fmtBytes(f)) / 4 ** level
      const was = bytes.get(t) ?? 0
      bytes.set(t, level === 0 && !(target >= 0x8515 && target <= 0x851a) ? Math.max(k, was) : was + k)
    }
    const dims = (s) => [s?.videoWidth || s?.naturalWidth || s?.width || 0, s?.videoHeight || s?.naturalHeight || s?.height || 0]
    wrap('texImage2D', (a, cx) => { if (a.length >= 8) tex(cx, a[0], a[1], a[3], a[4], 1, a[2]); else { const [w, h] = dims(a[5]); tex(cx, a[0], a[1], w, h, 1, a[2]) } })
    wrap('texStorage2D', (a, cx) => tex(cx, a[0], 0, a[3], a[4], 1, a[2]) || (a[1] > 1 && bytes.set(bound.get(keyOf(cx, a[0])), (bytes.get(bound.get(keyOf(cx, a[0]))) ?? 0) * 1.33)))
    wrap('texImage3D', (a, cx) => tex(cx, a[0], a[1], a[3], a[4], a[5], a[2]))
    wrap('texStorage3D', (a, cx) => tex(cx, a[0], 0, a[3], a[4], a[5], a[2]))
    wrap('bufferData', (a, cx) => { const b = bound.get(`${cx.__id}:b${a[0]}`); if (b) bytes.set(b, typeof a[1] === 'number' ? a[1] : a[1]?.byteLength ?? 0) })
    wrap('renderbufferStorage', (a, cx) => { const b = bound.get(`${cx.__id}:r`); if (b) bytes.set(b, a[2] * a[3] * 4) })
    wrap('renderbufferStorageMultisample', (a, cx) => { const b = bound.get(`${cx.__id}:r`); if (b) bytes.set(b, a[3] * a[4] * 4 * Math.max(1, a[1])) })
  }
  let ids = 0
  const gc = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...r) {
    // blocked mode: WebGL refused as Chromium refuses it to a domain blocked
    // after its contexts were lost (an event saying so, and null).
    if (/webgl/i.test(String(type)) && Date.now() < blockUntil) {
      g.createErrors.push([Math.round(performance.now()), 'refused (blocked mode)'])
      this.dispatchEvent(Object.assign(new Event('webglcontextcreationerror'), { statusMessage: 'Web page caused context loss and was blocked' }))
      return null
    }
    const x = gc.call(this, type, ...r)
    if (/webgl/i.test(String(type))) {
      if (!x) g.createErrors.push([Math.round(performance.now()), 'getContext returned null'])
      else if (!this.__counted) {
        this.__counted = true; g.contexts++; x.__id = ++ids
        g.made.push({ at: Math.round(performance.now()), inDom: this.isConnected, size: `${this.width}x${this.height}` })
        this.addEventListener('webglcontextlost', () => { g.lost++; g.lastLostAt = Math.round(performance.now()) })
        this.addEventListener('webglcontextrestored', () => { g.restored++; g.lastRestoredAt = Math.round(performance.now()) })
      }
    }
    return x
  }
  addEventListener('webglcontextcreationerror', (e) => g.createErrors.push([Math.round(performance.now()), e.statusMessage || 'creation error']), true)
  // 2D canvases alive and their pixels (an accelerated 2D canvas is GPU memory too), pictures and videos made.
  const canvases = [], images = [], videos = []
  const ce = Document.prototype.createElement
  Document.prototype.createElement = function (tag, ...r) { const el = ce.call(this, tag, ...r); const t = String(tag).toLowerCase(); if (t === 'canvas') canvases.push(new WeakRef(el)); else if (t === 'video') videos.push(new WeakRef(el)); return el }
  const Img = window.Image
  window.Image = function (...a) { const i = new Img(...a); images.push(new WeakRef(i)); return i }
  window.Image.prototype = Img.prototype
  window.__soak = () => {
    let gpuBytes = 0
    for (const v of bytes.values()) gpuBytes += v
    const live = (l) => l.map((r) => r.deref()).filter(Boolean)
    const cv = live(canvases), im = live(images), vd = live(videos)
    return {
      ...g, createErrors: g.createErrors.slice(-5), gpuBytes,
      canvases: cv.length, canvasPx: cv.reduce((s, c) => s + c.width * c.height, 0),
      images: im.length, imagesLoaded: im.filter((i) => i.complete && i.naturalWidth > 0).length, imagePx: im.reduce((s, i) => s + (i.complete ? i.naturalWidth * i.naturalHeight : 0), 0),
      videos: vd.length, videosWithSrc: vd.filter((v) => v.currentSrc).length,
    }
  }
}, mode === 'blocked' ? Date.now() + Number(process.env.BLOCK_S ?? 120) * 1000 : 0)
const pageErrors = [], gpuConsole = []
page.on('pageerror', (e) => pageErrors.push(e.message))
page.on('console', (m) => { const t = m.text(); if (/webgl|context|gpu|blocked/i.test(t)) { gpuConsole.push([Date.now(), t.slice(0, 300)]); log('console:', t.slice(0, 300)) } })
const target = `${url.replace(/\/$/, '')}/tv?broadcast=1&text=${TEXT}`
const cdp = await ctx.newCDPSession(page)
const t0 = Date.now()
const secs = () => Math.round((Date.now() - t0) / 1000)

// ---- What TV is doing, every second: transitions counted --------------------
const seen = { ads: 0, explainers: 0, cuts: 0, zooms: 0, lastAd: null, lastEx: null, lastCut: null, lastShot: null }
let watching = true
const tvState = () => page.evaluate(async () => {
  const { useTv } = await import('/src/store/useTv.ts')
  const { useTvExplainer } = await import('/src/store/useTvExplainer.ts')
  const s = useTv.getState(), e = useTvExplainer.getState()
  return { on: s.on, status: s.status, ad: s.ad ? `${s.ad.id}@${Math.round(s.ad.at)}` : null, ex: e.showing ? `${e.showing.id ?? e.showing.title}@${Math.round(e.showing.at)}` : null, cutAt: Math.round(s.cutAt ?? 0), shot: s.shot ? `${s.shot.kind ?? ''}:${s.shot.pubkey?.slice(0, 8) ?? ''}` : null, frames: window.__tvFrames ?? -1, scaleExp: window.__store?.getState?.().scaleExp ?? null }
}).catch(() => null)
const watch = async () => {
  let lastScale = null
  while (watching) {
    const s = await tvState()
    if (s) {
      if (s.ad && s.ad !== seen.lastAd) { seen.ads++; log(`${secs()}s SPOT ${s.ad}`) }
      if (s.ex && s.ex !== seen.lastEx) { seen.explainers++; log(`${secs()}s EXPLAINER ${s.ex}`) }
      if (s.cutAt !== seen.lastCut) seen.cuts++
      if (lastScale !== null && s.scaleExp !== lastScale) seen.zooms++
      seen.lastAd = s.ad; seen.lastEx = s.ex; seen.lastCut = s.cutAt; seen.lastShot = s.shot; lastScale = s.scaleExp
    }
    await sleep(1000)
  }
}

const procTree = () => {
  if (!chromePid) return null
  const parent = new Map(), cmd = new Map()
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8')
      parent.set(p, st.slice(st.lastIndexOf(')') + 2).split(' ')[1])
      cmd.set(p, fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' '))
    } catch { /* gone */ }
  }
  const mine = new Set([String(chromePid)])
  let grew = true
  while (grew) { grew = false; for (const [p, pp] of parent) if (!mine.has(p) && mine.has(pp)) { mine.add(p); grew = true } }
  const rss = { renderer: 0, gpu: 0, other: 0 }
  for (const p of mine) {
    let kb = 0
    try { kb = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/status`, 'utf8'))?.[1] ?? 0) } catch { continue }
    const cl = cmd.get(p) ?? ''
    rss[/--type=renderer/.test(cl) ? 'renderer' : /--type=gpu-process/.test(cl) ? 'gpu' : 'other'] += kb * 1024
  }
  return rss
}
const mb = (b) => Math.round(b / 1e6)
const sample = async () => {
  const heap = await cdp.send('Runtime.getHeapUsage').catch(() => ({ usedSize: 0, totalSize: 0 }))
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({ nodes: 0, jsEventListeners: 0 }))
  const app = await page.evaluate(() => {
    const r = window.__gl
    return { gl: r ? { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null, calls: r.info.render.calls, triangles: r.info.render.triangles } : null, soak: window.__soak?.() ?? null, frames: window.__tvFrames ?? -1, ctxLost: window.__tvCtxLost ?? 0 }
  }).catch(() => ({}))
  const row = { t: secs(), used: heap.usedSize, total: heap.totalSize, nodes: dom.nodes, listeners: dom.jsEventListeners, rss: procTree(), ...app, seen: { ...seen }, relay: { ...relay }, net: { ...net }, errors: pageErrors.length }
  fs.appendFileSync(`${out}/${mode}${TAG}.jsonl`, JSON.stringify(row) + '\n')
  const s = row.soak
  log(`${row.t}s heap ${mb(row.used)}/${mb(row.total)} MB rss r/g/o ${row.rss ? `${mb(row.rss.renderer)}/${mb(row.rss.gpu)}/${mb(row.rss.other)}` : '?'} three ${JSON.stringify(row.gl)} | gl b${s?.buffers} t${s?.textures} rb${s?.renderbuffers} fb${s?.framebuffers} p${s?.programs} v${s?.vaos} ~${mb(s?.gpuBytes ?? 0)} MB | 2d ${s?.canvases} (${mb((s?.canvasPx ?? 0) * 4)} MB) img ${s?.imagesLoaded}/${s?.images} (${mb((s?.imagePx ?? 0) * 4)} MB) vid ${s?.videos}/${s?.videosWithSrc} | frames ${row.frames} lost ${row.ctxLost} | spots ${seen.ads} expl ${seen.explainers} cuts ${seen.cuts} zooms ${seen.zooms} | dom ${row.nodes} err ${row.errors}`)
  return row
}

if (mode === 'soak') {
  await page.goto(target, { waitUntil: 'load' })
  await page.waitForFunction(() => typeof window.__tvFrames === 'number', null, { timeout: 180_000 })
  if ((await page.evaluate(() => window.__store?.getState?.().live)) !== false) { log('ABORT: not LOCAL'); await browser.close(); process.exit(2) }
  log('drawing at', secs(), 's; browser pid', chromePid, 'url', target)
  void watch()
  const end = Date.now() + Number(minArg) * 60_000
  let n = 0
  while (Date.now() < end) {
    await sample()
    if (n++ % 20 === 0) await page.screenshot({ path: `${out}/soak${TAG}-${secs()}.jpg`, type: 'jpeg', quality: 60 }).catch(() => {})
    await sleep(SAMPLE)
  }
  watching = false
  log('done', { seen, relay, net, pageErrors: pageErrors.slice(0, 10) })
  await browser.close()
  process.exit(0)
}

if (mode === 'probe') {
  await page.goto(target, { waitUntil: 'load' })
  await page.waitForFunction(() => typeof window.__tvFrames === 'number', null, { timeout: 180_000 })
  await sleep(Number(minArg) * 1000)
  const made = await page.evaluate(() => ({ made: window.__soak?.().made ?? [], dom: [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height} ${c.parentElement?.className ?? ''} / ${c.parentElement?.parentElement?.className ?? ''}`) }))
  log(JSON.stringify(made, null, 1))
  await browser.close()
  process.exit(0)
}

if (mode === 'blocked') {
  // The page loaded as the streamer reloads it straight after a loss, WebGL
  // refused for BLOCK_S: what it shows, whether the music plays, and when it draws.
  const at = Date.now()
  let tries = 0
  for (;;) {
    tries++
    await cdp.send('Page.navigate', { url: target })
    const loadAt = Date.now()
    let drew = false
    while (Date.now() - loadAt < 60_000) {
      await sleep(5000)
      const v = await page.evaluate(async () => {
        const music = await import('/src/store/useTvMusic.ts').then((m) => { const s = m.useTvMusic.getState(); return { track: s.track?.title ?? null, blocked: s.blocked, muted: s.muted } }).catch((e) => `no store: ${e.message}`)
        const tv = await import('/src/store/useTv.ts').then((m) => ({ on: m.useTv.getState().on, status: m.useTv.getState().status })).catch(() => null)
        const audio = [...document.querySelectorAll('audio')].map((a) => ({ paused: a.paused, t: Math.round(a.currentTime) }))
        return { frames: typeof window.__tvFrames === 'number' ? window.__tvFrames : -1, lost: window.__tvCtxLost ?? 0, standby: window.__tvStandby ?? null, root: document.getElementById('root')?.childElementCount ?? null, body: document.body.innerText.slice(0, 160).replace(/\s+/g, ' '), music, tv, audio, errs: window.__soak?.().createErrors }
      }).catch((e) => ({ err: e.message }))
      log(`load ${tries} +${Math.round((Date.now() - loadAt) / 1000)}s (${Math.round((Date.now() - at) / 1000)}s since the loss)`, JSON.stringify(v))
      if (tries === 1 && Date.now() - loadAt < 11_000) await page.screenshot({ path: `${out}/blocked${TAG}-load1.jpg`, type: 'jpeg', quality: 60 }).catch(() => {})
      if (v.frames > 0) { drew = true; break }
    }
    if (drew) { log(`DREW on load ${tries}, ${Math.round((Date.now() - at) / 1000)} s after the loss`); break }
    if (tries >= 5) { log('never drew'); break }
    log(`load ${tries}: the streamer would reload now ("the TV page had not loaded")`)
  }
  log('pageErrors', pageErrors.slice(0, 8))
  await browser.close()
  process.exit(0)
}

// ---- gpucrash: lose the GPU, then reload as the streamer does --------------
const bcdp = await browser.newBrowserCDPSession()
const loadAndWait = async (label, graceMs) => {
  const at = Date.now()
  await cdp.send('Page.navigate', { url: target })
  for (;;) {
    const v = await page.evaluate(() => [typeof window.__tvFrames === 'number' ? window.__tvFrames : -1, window.__tvCtxLost || 0, window.__soak?.() ?? null, !!document.querySelector('canvas')]).catch(() => [-1, 0, null, false])
    const ms = Date.now() - at
    if (v[0] > 0) { log(`${label}: drawing ${ms} ms after navigate; contexts ${v[2]?.contexts} createErrors ${JSON.stringify(v[2]?.createErrors)}`); return { ok: true, ms } }
    if (ms > graceMs) {
      const probe = await page.evaluate(() => { const c = document.createElement('canvas'); const x = c.getContext('webgl2'); return x ? `webgl2 ok, lost=${x.isContextLost()}` : 'webgl2 NULL' }).catch((e) => `probe failed ${e.message}`)
      await page.screenshot({ path: `${out}/gpucrash${TAG}-${label}.jpg`, type: 'jpeg', quality: 60 }).catch(() => {})
      log(`${label}: NOT LOADED after ${ms} ms (__tvFrames ${v[0]}, canvas ${v[3]}); contexts ${v[2]?.contexts} createErrors ${JSON.stringify(v[2]?.createErrors)}; fresh probe: ${probe}`)
      return { ok: false, ms }
    }
    await sleep(1000)
  }
}
const first = await loadAndWait('first load', 180_000)
if (!first.ok) { log('ABORT: never drew'); await browser.close(); process.exit(2) }
await sleep(20_000)
await sample()
const rounds = Number(process.env.ROUNDS ?? 2)
for (let k = 1; k <= rounds; k++) {
  log(`round ${k}: crashing the GPU process`)
  const before = await page.evaluate(() => window.__tvCtxLost || 0)
  await bcdp.send('Browser.crashGpuProcess').catch((e) => log('crashGpuProcess:', e.message))
  // The streamer samples every 5 s and reloads when __tvCtxLost went up.
  let seenAt = null
  for (let i = 0; i < 12; i++) {
    await sleep(5000)
    const now = await page.evaluate(() => [window.__tvCtxLost || 0, window.__soak?.()]).catch(() => [before, null])
    log(`  +${(i + 1) * 5}s ctxLost ${now[0]} lost/restored ${now[1]?.lost}/${now[1]?.restored} frames ${await page.evaluate(() => window.__tvFrames ?? -1).catch(() => '?')}`)
    if (now[0] > before) { seenAt = (i + 1) * 5; break }
  }
  await page.screenshot({ path: `${out}/gpucrash${TAG}-r${k}-lost.jpg`, type: 'jpeg', quality: 60 }).catch(() => {})
  log(`  the streamer would reload now (${seenAt === null ? 'NO loss counted in 60 s' : `loss counted by +${seenAt}s`})`)
  let tries = 0
  for (;;) {
    tries++
    const r = await loadAndWait(`round ${k} load ${tries}`, 60_000)
    if (r.ok || tries >= 5) break
  }
  await sleep(15_000)
  await sample()
}
log('done', { pageErrors: pageErrors.slice(0, 10), gpuConsole: gpuConsole.slice(0, 20) })
await browser.close()
process.exit(0)
