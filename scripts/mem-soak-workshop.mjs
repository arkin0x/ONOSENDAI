/**
 * mem-soak-workshop.mjs: the workshop's memory with a big shard on the bench,
 * over raw CDP, in a real background tab or a visible one (2026-10-23).
 *
 * arkinox, 2026-10-23: "i let onosendai sit in the background on the workshop
 * with that basilica piece open and the tab froze. memory says 12.7GB." This
 * brings a zip of shards in through the workshop's own bulk import (nothing
 * published: PUBLISH off), opens one of them on the bench, and samples the JS
 * heap, the browser's processes by role, and every WebGL buffer, texture and
 * program the page holds (counted at the context, so the bench, the pictures
 * stage and the world are all in it) every SAMPLE seconds.
 *
 * Why raw CDP and not Playwright: see mem-soak3.mjs. BG=1 activates a second
 * tab in front, so the page is really hidden (no frames, throttled timers).
 *
 * Nothing leaves the machine: LOCAL is set before load, every WebSocket to
 * anything but localhost is refused in the page before app code runs, every
 * HTTP request to anything but localhost is failed through the Fetch domain,
 * and an EVENT or AUTH frame seen leaving for a real relay aborts the run.
 *
 * Usage: DISPLAY=:N node scripts/mem-soak-workshop.mjs <url> <out dir> <zip> <piece substring> [minutes]
 * Env: BG=1, FULL=1 (fill localStorage to its quota once the pieces are in, so
 * every later save fails, as arkinox's did), SAMPLE (30), W (1920), H (1080), DPR (1),
 * TAG, ALLOC=<s> (a sampling allocation profile of that many seconds),
 * SNAPSHOTS=1 (heap snapshots at the start and the end), CHROME=<path>.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const [url, out, zipPath, piece, minutes = '15'] = process.argv.slice(2)
if (!url || !out || !zipPath || !piece) { console.log('usage: mem-soak-workshop.mjs <url> <out> <zip> <piece> [minutes]'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const SAMPLE = Number(process.env.SAMPLE ?? 30) * 1000
const DPR = Number(process.env.DPR ?? 1)
const W = Number(process.env.W ?? 1920)
const H = Number(process.env.H ?? 1080)
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const tag = `ws-${piece}${process.env.BG ? '-bg' : '-fg'}${process.env.FULL ? '-full' : ''}${process.env.TAG ? '-' + process.env.TAG : ''}`
const port = 9400 + Math.floor(Math.random() * 400)
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'soakws-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chrome = spawn(CHROME, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--js-flags=--expose-gc', `--window-size=${W},${H + 100}`, `--force-device-scale-factor=${DPR}`, 'about:blank',
], { stdio: 'ignore' })
const shutdown = (code) => { try { chrome.kill() } catch {} ; try { fs.rmSync(profile, { recursive: true, force: true }) } catch {} ; process.exit(code) }
process.on('SIGTERM', () => shutdown(143))
process.on('SIGINT', () => shutdown(130))
await sleep(3000)

const connect = (wsUrl) => {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pend = new Map()
  const handlers = new Map()
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id) { const p = pend.get(d.id); pend.delete(d.id); if (p) d.error ? p.rej(new Error(d.error.message)) : p.res(d.result) }
    else (handlers.get(d.method) ?? []).forEach((h) => h(d.params))
  }
  return {
    ready: new Promise((r) => (ws.onopen = r)),
    send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) }),
    on: (method, h) => handlers.set(method, [...(handlers.get(method) ?? []), h]),
  }
}
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const cdp = connect((await list()).find((t) => t.type === 'page').webSocketDebuggerUrl)
await cdp.ready

let leaked = 0
await cdp.send('Network.enable')
const socketUrls = new Map()
cdp.on('Network.webSocketCreated', (p) => socketUrls.set(p.requestId, p.url))
cdp.on('Network.webSocketFrameSent', (p) => {
  const u = socketUrls.get(p.requestId) ?? ''
  if (/localhost|127\.0\.0\.1/.test(u)) return
  const d = p.response?.payloadData ?? ''
  if (/^\s*\[\s*"(EVENT|AUTH)"/.test(d)) { leaked++; console.log('ABORT: an', d.slice(2, 7), 'frame reached', u); shutdown(3) }
})
// Every HTTP request to anything but localhost: failed.
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
cdp.on('Fetch.requestPaused', (p) => {
  const local = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)[:/]/.test(p.request.url) || /^(data|blob):/.test(p.request.url)
  if (!local) cdp.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' })
  else cdp.send('Fetch.continueRequest', { requestId: p.requestId })
})

await cdp.send('Page.enable')
await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  try { localStorage.setItem('onosendai:live', '0') } catch {}
  const c = { refusedSockets: 0, raf: 0, setItemFail: 0, setItemOk: 0, setItemBytes: 0, stringifyBytes: 0 }
  // No socket to anything but this machine.
  const WS = window.WebSocket
  window.WebSocket = new Proxy(WS, { construct(t, a) { const u = String(a[0]); if (!/^wss?:\\/\\/(localhost|127\\.0\\.0\\.1)[:/]/.test(u)) { c.refusedSockets++; a = ['ws://127.0.0.1:9/refused'] } return new t(...a) } })
  // localStorage writes: how many, how big, how many refused.
  const si = Storage.prototype.setItem
  Storage.prototype.setItem = function (k, v) { try { const r = si.call(this, k, v); c.setItemOk++; c.setItemBytes += String(v).length; return r } catch (e) { c.setItemFail++; c.setItemBytes += String(v).length; throw e } }
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = function (cb) { c.raf++; return raf.call(this, cb) }
  // Every WebGL object, at the context: made and let go.
  const g = { buffers: 0, textures: 0, programs: 0, vaos: 0, contexts: 0, bufferData: 0, bufferBytes: 0, draws: 0, uploads: 0, uploadBytes: 0 }
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    const wrap = (name, f) => { const o = P.prototype[name]; if (o) P.prototype[name] = function (...a) { f(a, this); return o.apply(this, a) } }
    wrap('createBuffer', () => g.buffers++); wrap('deleteBuffer', (a) => { if (a[0]) g.buffers-- })
    wrap('createTexture', () => g.textures++); wrap('deleteTexture', (a) => { if (a[0]) g.textures-- })
    wrap('createProgram', () => g.programs++); wrap('deleteProgram', (a) => { if (a[0]) g.programs-- })
    wrap('createVertexArray', () => g.vaos++); wrap('deleteVertexArray', (a) => { if (a[0]) g.vaos-- })
    wrap('bufferData', (a) => { g.bufferData++; const s = a[1]; g.bufferBytes += typeof s === 'number' ? s : (s?.byteLength ?? 0) })
    wrap('bufferSubData', (a) => { g.uploads++; g.uploadBytes += a[2]?.byteLength ?? 0 })
    for (const d of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) wrap(d, () => g.draws++)
  }
  const gc = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...r) { const x = gc.call(this, type, ...r); if (x && /webgl/i.test(String(type)) && !this.__counted) { this.__counted = true; g.contexts++ } return x }
  window.__soak = () => ({ ...c, gl: { ...g }, canvases: document.querySelectorAll('canvas').length })
})()` })
await cdp.send('Performance.enable')
await cdp.send('Page.navigate', { url })
await sleep(12_000)
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
// A cold dev server takes a while to serve the first load.
for (let i = 0; i < 90 && !(await ev('!!window.__store').catch(() => false)); i++) await sleep(1000)
await sleep(3000)
if ((await ev('window.__store?.getState().live')) !== false) { console.log('ABORT: not LOCAL'); shutdown(2) }

// The zip, through IMPORT, PUBLISH off.
const zipB64 = fs.readFileSync(zipPath).toString('base64')
const imported = await ev(`(async () => {
  const bin = atob(${JSON.stringify(zipB64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  const file = new File([u], ${JSON.stringify(path.basename(zipPath))}, { type: 'application/zip' })
  const { useWorkshop } = await import('/src/store/useWorkshop.ts')
  const { useShardImport } = await import('/src/store/useShardImport.ts')
  useWorkshop.getState().openWorkshop()
  const im = useShardImport.getState()
  await im.openZip(file)
  for (let i = 0; i < 100 && useShardImport.getState().phase !== 'review'; i++) await new Promise((r) => setTimeout(r, 200))
  useShardImport.getState().setPublish(false)
  await useShardImport.getState().start()
  for (let i = 0; i < 300 && useShardImport.getState().phase === 'running'; i++) await new Promise((r) => setTimeout(r, 200))
  const st = useShardImport.getState()
  const rows = st.rows.map((r) => r.run)
  const count = (k) => rows.filter((x) => x === k).length
  const want = useWorkshop.getState().shards.find((s) => s.name.includes(${JSON.stringify(piece)}))
  if (want) useWorkshop.getState().openWorkshop(want.id)
  // As if its window were closed: the import's own list is left as it was.
  return { phase: st.phase, stall: st.stall, done: count('done'), failed: count('failed'), shards: useWorkshop.getState().shards.length, open: want ? { name: want.name, vertices: want.vertices.length, faces: want.faces.length } : null }
})()`)
console.log('imported', JSON.stringify(imported))
if (!imported.open) { console.log('ABORT: no piece', piece); shutdown(4) }
// The bench has drawn it, some frames over, before anything is measured or hidden.
{
  const r0 = await ev('window.__soak().raf')
  const t = Date.now()
  while (Date.now() - t < 600_000 && !(await ev(`!!window.__benchScene && window.__soak().raf - ${r0} >= 20 && window.__soak().gl.draws > 0`))) await sleep(2000)
  console.log('bench drawn', JSON.stringify(await ev('window.__soak().gl')), 'in', Math.round((Date.now() - t) / 1000), 's')
}
if (process.env.FULL) {
  // Storage to its quota once the pieces are in: every save from now on fails, as arkinox's did.
  console.log('filled', await ev(`(() => {
    const chunk = 'x'.repeat(256 * 1024); let i = 0
    try { for (; i < 400; i++) localStorage.setItem('soak:fill:' + i, chunk) } catch {}
    let small = 'x'.repeat(16 * 1024), j = 0
    try { for (; j < 400; j++) localStorage.setItem('soak:small:' + j, small) } catch {}
    return { big: i, small: j }
  })()`))
}

await sleep(10_000)

const procTree = () => {
  const parent = new Map(), cmd = new Map()
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8')
      parent.set(p, st.slice(st.lastIndexOf(')') + 2).split(' ')[1])
      cmd.set(p, fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' '))
    } catch { /* gone */ }
  }
  const mine = new Set([String(chrome.pid)])
  let grew = true
  while (grew) { grew = false; for (const [p, pp] of parent) if (!mine.has(p) && mine.has(pp)) { mine.add(p); grew = true } }
  const rss = { renderer: 0, gpu: 0, other: 0 }
  for (const p of mine) {
    let kb = 0
    try { kb = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/status`, 'utf8'))?.[1] ?? 0) } catch { continue }
    const c = cmd.get(p) ?? ''
    rss[/--type=renderer/.test(c) && !/--extension-process/.test(c) ? 'renderer' : /--type=gpu-process/.test(c) ? 'gpu' : 'other'] += kb * 1024
  }
  return rss
}

if (process.env.BG) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  await fetch(`http://127.0.0.1:${port}/json/activate/${t.id}`)
  await sleep(2000)
}
console.log('visibility', await ev(`new Promise((r) => { const t0 = performance.now(); let f = false; requestAnimationFrame(() => { f = true }); setTimeout(() => r(JSON.stringify({ vis: document.visibilityState, raf: f, timerMs: Math.round(performance.now() - t0) })), 1000) })`))

const sample = async (t) => {
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const app = await ev(`(() => ({ soak: window.__soak?.(), visibility: document.visibilityState, thumbs: window.__thumbs ? { ms: window.__thumbs.ms.length, contexts: window.__thumbs.contexts } : null }))()`)
  const row = { t, used: heap.usedSize, total: heap.totalSize, nodes: dom.nodes, listeners: dom.jsEventListeners, docs: dom.documents, layoutCount: metrics.LayoutCount, recalc: metrics.RecalcStyleCount, scriptMs: Math.round(metrics.ScriptDuration * 1000), taskMs: Math.round(metrics.TaskDuration * 1000), rss: procTree(), ...app, leaked }
  fs.appendFileSync(`${out}/${tag}.jsonl`, JSON.stringify(row) + '\n')
  return row
}

const allocProfile = async (seconds) => {
  await cdp.send('HeapProfiler.enable')
  const f0 = await ev('window.__soak().raf')
  const d0 = await ev('window.__soak().gl.draws')
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  await sleep(seconds * 1000)
  const { profile: prof } = await cdp.send('HeapProfiler.stopSampling')
  const frames = (await ev('window.__soak().raf')) - f0
  const draws = (await ev('window.__soak().gl.draws')) - d0
  const by = new Map(); let total = 0
  const walk = (node) => { const f = node.callFrame; const label = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`; total += node.selfSize; by.set(label, (by.get(label) ?? 0) + node.selfSize); for (const c of node.children) walk(c) }
  walk(prof.head)
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
  console.log(`ALLOC ${tag}: ${Math.round(total / 1e6)} MB in ${seconds} s = ${Math.round(total / seconds * 60 / 1e6)} MB/min over ${frames} rAF callbacks = ${frames ? Math.round(total / frames / 1024) : '?'} KB per callback, ${frames ? Math.round(draws / frames) : '?'} draw calls per callback`)
  for (const [k, v] of top) console.log(`  ${String(Math.round(v / 1e6 * 10) / 10).padStart(8)} MB  ${k}`)
  fs.writeFileSync(`${out}/${tag}-alloc.json`, JSON.stringify({ seconds, total, frames, draws, top }))
}

const snapshot = async (name) => {
  if (!process.env.SNAPSHOTS) return
  const chunks = []
  cdp.on('HeapProfiler.addHeapSnapshotChunk', (p) => chunks.push(p.chunk))
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  fs.writeFileSync(`${out}/${tag}-${name}.heapsnapshot`, chunks.join(''))
  chunks.length = 0
}

const until = Date.now() + Number(minutes) * 60_000
const t0 = Date.now()
await snapshot('start')
if (process.env.ALLOC) await allocProfile(Number(process.env.ALLOC))
let next = 0
while (Date.now() < until) {
  if (Date.now() >= next) {
    const r = await sample(Math.round((Date.now() - t0) / 1000))
    const s = r.soak ?? {}
    console.log(tag, r.t, 'heap', Math.round(r.used / 1e6), '/', Math.round(r.total / 1e6), 'MB rss r/g/o', Math.round(r.rss.renderer / 1e6), Math.round(r.rss.gpu / 1e6), Math.round(r.rss.other / 1e6), 'MB nodes', r.nodes, 'gl', JSON.stringify(s.gl), 'raf', s.raf, 'setItem ok/fail/MB', s.setItemOk, s.setItemFail, Math.round((s.setItemBytes ?? 0) / 1e6), 'script ms', r.scriptMs, 'vis', r.visibility)
    next = Date.now() + SAMPLE
  }
  await sleep(1000)
}
await snapshot('end')
console.log('done', tag, 'leaked', leaked)
shutdown(0)
