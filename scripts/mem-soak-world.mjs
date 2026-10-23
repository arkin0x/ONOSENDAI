/**
 * mem-soak-world.mjs: ONOSENDAI's memory and freezes while moving through the
 * world, on recorded relay data (2026-10-23).
 *
 * arkinox, 2026-10-23 (Brave on a Windows desktop): "I'm getting some freezes
 * intermittently while just navigating through onosendai. Please look into
 * why the memory is still really high." This drives the dev build through the
 * world for a long session and says, every SAMPLE seconds, what it holds and
 * what stopped the main thread:
 * - the JS heap, process RSS by role (renderer, GPU, the rest), DOM nodes;
 * - renderer.info.memory of the world's renderer (window.__gl) and every
 *   WebGL buffer, texture, program and vertex array counted at the context;
 * - long tasks (a PerformanceObserver installed before app code): count, sum,
 *   longest; and, from a CPU profile kept running over each interval, every
 *   stretch of the main thread busy past LONG_MS with the functions it spent
 *   its time in, so a freeze has a name;
 * - once per phase, an allocation sampling profile (KB a frame).
 *
 * Phases: VIEW (spectate a run of authors with many objects, one after
 * another, orbiting and zooming at each: moving between places), then WALK at
 * your own head among Maze Kit rooms (constrain "all", so every step is tested
 * against their faces) and looping hidden audio, headlamp on (its default).
 *
 * The relays are a recording: every WebSocket that is not this machine is
 * answered in Node from a dump of cyberspace.nostr1.com (RELAY_DUMP), REQ by
 * REQ (at most CAP events a filter, newest first, as a relay caps them), then
 * EOSE. An EVENT is answered OK false and counted, never sent anywhere; AUTH
 * is ignored. HTTP to anything but localhost is refused, except the made-up
 * Blossom host the audio items name, answered from memory. LOCAL is set
 * before the first script runs, and the run aborts if the store is not LOCAL.
 *
 * Usage (from the repo, a dev server running):
 *   DISPLAY=:N node scripts/mem-soak-world.mjs <url> <out dir> [view min] [walk min]
 * Env: RELAY_DUMP (/data/projects/relay-copy/before/src3.jsonl), ZIPS (comma
 * separated Maze Kit zips), SAMPLE (30), CAP (500), LONG_MS (100), W (1920),
 * H (1080), TAG, SNAPSHOTS=1, CHROME, HOLD=<s> (VIEW: seconds at each place, 45).
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import readline from 'node:readline'
import { chromium } from 'playwright'
import { unzipSync, strFromU8 } from 'fflate'

const [url, out, viewMinArg = '8', walkMinArg = '8'] = process.argv.slice(2)
if (!url || !out) { console.log('usage: mem-soak-world.mjs <url> <out dir> [view min] [walk min]'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const SAMPLE = Number(process.env.SAMPLE ?? 30) * 1000
const CAP = Number(process.env.CAP ?? 500)
const LONG_MS = Number(process.env.LONG_MS ?? 100)
const W = Number(process.env.W ?? 1920)
const H = Number(process.env.H ?? 1080)
const HOLD = Number(process.env.HOLD ?? 45) * 1000
const TAG = process.env.TAG ? `-${process.env.TAG}` : ''
const DUMP = process.env.RELAY_DUMP ?? '/data/projects/relay-copy/before/src3.jsonl'
const ZIPS = (process.env.ZIPS ?? '/data/Sync/agents/claude/onosendai/maze-kit/zips/maze-kit-basilica.zip,/data/Sync/agents/claude/onosendai/maze-kit/zips/maze-kit-cistern.zip,/data/Sync/agents/claude/onosendai/maze-kit/zips/maze-kit-forest.zip').split(',').filter(Boolean)
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const log = (...a) => { const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); console.log(line); fs.appendFileSync(`${out}/run${TAG}.log`, line + '\n') }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    const vals = f[k]
    if (!e.tags.some((t) => t[0] === k.slice(1) && vals.includes(t[1]))) return false
  }
  return true
}
const query = (f) => {
  // The smallest index the filter names.
  const pools = []
  if (f.ids) pools.push(f.ids.map((i) => byId.get(i)).filter(Boolean))
  if (f.authors) pools.push(f.authors.flatMap((a) => byAuthor.get(a) ?? []))
  for (const k of Object.keys(f)) if (k[0] === '#') pools.push(f[k].flatMap((v) => byTag.get(`${k.slice(1)}:${v}`) ?? []))
  if (f.kinds) pools.push(f.kinds.flatMap((k) => byKind.get(k) ?? []))
  const pool = pools.length ? pools.sort((a, b) => a.length - b.length)[0] : events
  const hit = pool.filter((e) => matches(f, e)).sort((a, b) => b.created_at - a.created_at)
  return hit.slice(0, Math.min(CAP, f.limit ?? CAP))
}
const relay = { reqs: 0, sent: 0, refusedEvents: 0, auth: 0, maxReqMs: 0 }

// ---- Maze Kit pieces and an audio file -------------------------------------
const pieces = []
for (const z of ZIPS) {
  const files = unzipSync(new Uint8Array(fs.readFileSync(z)))
  for (const [name, bytes] of Object.entries(files)) if (name.endsWith('.json')) pieces.push({ name: path.basename(name, '.json'), text: strFromU8(bytes) })
}
log('maze kit pieces', pieces.length)
// Five seconds of a quiet tone, 48 kHz mono 16-bit WAV, sealed as DECK-0007 seals it.
const wav = (() => {
  const rate = 48000, n = rate * 5, b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22)
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000), 44 + i * 2)
  return b
})()
const key = crypto.randomBytes(32), nonce = crypto.randomBytes(12)
const c = crypto.createCipheriv('aes-256-gcm', key, nonce)
const cipher = Buffer.concat([c.update(wav), c.final(), c.getAuthTag()])
const audioHash = crypto.createHash('sha256').update(cipher).digest('hex')
const BLOSSOM = 'https://blossom.soak.invalid'

// ---- The browser -----------------------------------------------------------
const browser = await chromium.launch({
  headless: false, executablePath: CHROME,
  args: ['--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--expose-gc', '--autoplay-policy=no-user-gesture-required', `--window-size=${W},${H + 100}`],
})
// Playwright does not hand out the browser's process: it is the chrome on this DISPLAY with no --type.
const chromePid = (() => {
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const cl = fs.readFileSync(`/proc/${p}/cmdline`, 'utf8')
      if (!cl.startsWith(CHROME) || cl.includes('--type=')) continue
      const env = fs.readFileSync(`/proc/${p}/environ`, 'utf8').split('\0')
      if (env.includes(`DISPLAY=${process.env.DISPLAY}`)) return Number(p)
    } catch { /* gone, or not ours */ }
  }
  return null
})()
const ctx = await browser.newContext({ viewport: { width: W, height: H } })
let blocked = 0
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u.toString()), (r) => {
  const u = r.request().url()
  if (u.startsWith(BLOSSOM)) return r.fulfill({ status: 200, contentType: 'application/octet-stream', body: cipher })
  blocked++
  return r.abort()
})
await ctx.routeWebSocket(/.*/, (ws) => {
  if (/^wss?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(ws.url())) { ws.connectToServer(); return }
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') {
      relay.reqs++
      const t0 = Date.now()
      const seen = new Set()
      for (const f of m.slice(2)) for (const e of query(f)) if (!seen.has(e.id)) { seen.add(e.id); ws.send(JSON.stringify(['EVENT', m[1], e])); relay.sent++ }
      relay.maxReqMs = Math.max(relay.maxReqMs, Date.now() - t0)
      ws.send(JSON.stringify(['EOSE', m[1]]))
    } else if (m[0] === 'EVENT') { relay.refusedEvents++; ws.send(JSON.stringify(['OK', m[1]?.id ?? '', false, 'blocked: recorded relay, read only'])) }
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
    else if (m[0] === 'AUTH') relay.auth++
  })
})
const page = await ctx.newPage()
await page.addInitScript(() => {
  try { localStorage.setItem('onosendai:live', '0') } catch {}
  const lt = { n: 0, ms: 0, max: 0, list: [] }
  window.__lt = lt
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        lt.n++; lt.ms += e.duration; lt.max = Math.max(lt.max, e.duration)
        if (e.duration >= 100) lt.list.push([Math.round(e.startTime), Math.round(e.duration), (e.attribution ?? []).map((a) => `${a.containerType}:${a.containerName || a.containerSrc || a.name}`).join(',')])
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch {}
  const g = { buffers: 0, textures: 0, programs: 0, vaos: 0, contexts: 0, uploads: 0, uploadBytes: 0, draws: 0 }
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    const wrap = (name, f) => { const o = P.prototype[name]; if (o) P.prototype[name] = function (...a) { f(a, this); return o.apply(this, a) } }
    wrap('createBuffer', () => g.buffers++); wrap('deleteBuffer', (a) => { if (a[0]) g.buffers-- })
    wrap('createTexture', () => g.textures++); wrap('deleteTexture', (a) => { if (a[0]) g.textures-- })
    wrap('createProgram', () => g.programs++); wrap('deleteProgram', (a) => { if (a[0]) g.programs-- })
    wrap('createVertexArray', () => g.vaos++); wrap('deleteVertexArray', (a) => { if (a[0]) g.vaos-- })
    wrap('bufferSubData', (a) => { g.uploads++; g.uploadBytes += a[2]?.byteLength ?? 0 })
    for (const d of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) wrap(d, () => g.draws++)
  }
  const gc = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...r) { const x = gc.call(this, type, ...r); if (x && /webgl/i.test(String(type)) && !this.__counted) { this.__counted = true; g.contexts++ } return x }
  window.__glc = g
})
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(e.message))
// Profiling from before the first script, so the load's own long tasks have names too.
const cdp = await ctx.newCDPSession(page)
await cdp.send('Performance.enable')
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 1000 })
await cdp.send('Profiler.start')
await page.goto(url, { waitUntil: 'load' })
await page.waitForFunction(() => !!window.__store, null, { timeout: 180_000 })
await sleep(4000)
if ((await page.evaluate(() => window.__store.getState().live)) !== false) { log('ABORT: not LOCAL'); await browser.close(); process.exit(2) }
log('browser pid', chromePid)

// ---- Measuring --------------------------------------------------------------
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

/** The busy stretches of a CPU profile past LONG_MS, each with where its time went. */
const busyStretches = (prof) => {
  const nodes = new Map(prof.nodes.map((n) => [n.id, n]))
  const parentOf = new Map()
  for (const n of prof.nodes) for (const ch of n.children ?? []) parentOf.set(ch, n.id)
  const label = (n) => `${n.callFrame.functionName || '(anon)'} ${(n.callFrame.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\/(\.vite\/deps\/)?/, 'nm/').replace(/\?.*$/, '')}:${n.callFrame.lineNumber + 1}`
  const idle = (n) => ['(idle)', '(program)'].includes(n.callFrame.functionName)
  const out = []
  let t = prof.startTime, run = null
  const close = () => {
    if (run && run.ms >= LONG_MS) {
      const self = [...run.self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(0)}ms`)
      const app = [...run.app.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(0)}ms`)
      out.push({ at: Math.round((run.t0 - prof.startTime) / 1000), ms: Math.round(run.ms), self, app })
    }
    run = null
  }
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (prof.timeDeltas[i] ?? 0) / 1000
    t += prof.timeDeltas[i] ?? 0
    const n = nodes.get(prof.samples[i])
    if (!n || idle(n)) { close(); continue }
    if (!run) run = { t0: t, ms: 0, self: new Map(), app: new Map() }
    run.ms += dt
    const s = label(n)
    run.self.set(s, (run.self.get(s) ?? 0) + dt)
    // Every app frame on the stack, once each: where in ONOSENDAI the time was.
    const seen = new Set()
    for (let id = n.id; id !== undefined; id = parentOf.get(id)) {
      const x = nodes.get(id)
      if (!x || !/\/src\//.test(x.callFrame.url)) continue
      const l = label(x)
      if (seen.has(l)) continue
      seen.add(l)
      run.app.set(l, (run.app.get(l) ?? 0) + dt)
    }
  }
  close()
  return out
}

let phase = 'setup'
let lastLt = { n: 0, ms: 0 }
let ltSeen = 0
const t0 = Date.now()
const sample = async () => {
  const { profile } = await cdp.send('Profiler.stop')
  const stretches = busyStretches(profile)
  await cdp.send('Profiler.start')
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  const app = await page.evaluate(() => {
    const r = window.__gl; const s = window.__store?.getState?.()
    return {
      gl: r ? { geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null, frame: r.info.render.frame } : null,
      glc: { ...window.__glc },
      lt: { n: window.__lt.n, ms: Math.round(window.__lt.ms), max: Math.round(window.__lt.max), list: window.__lt.list.length },
      walking: s?.walking ?? null, scaleExp: s?.scaleExp ?? null,
      spectate: s?.spectate?.pubkey?.slice(0, 8) ?? null,
    }
  })
  const ltList = await page.evaluate((from) => window.__lt.list.slice(from), ltSeen)
  ltSeen += ltList.length
  const row = {
    t: Math.round((Date.now() - t0) / 1000), phase, used: heap.usedSize, total: heap.totalSize, nodes: dom.nodes, listeners: dom.jsEventListeners,
    rss: procTree(), ...app, ltNew: { n: app.lt.n - lastLt.n, ms: app.lt.ms - lastLt.ms }, longtasks: ltList, busy: stretches.slice().sort((a, b) => b.ms - a.ms).slice(0, 4), relay: { ...relay }, blocked,
  }
  lastLt = app.lt
  fs.appendFileSync(`${out}/world${TAG}.jsonl`, JSON.stringify(row) + '\n')
  const mb = (b) => Math.round(b / 1e6)
  log(`${row.t}s ${phase} heap ${mb(row.used)}/${mb(row.total)} MB rss r/g/o ${row.rss ? `${mb(row.rss.renderer)}/${mb(row.rss.gpu)}/${mb(row.rss.other)}` : '?'} gl ${JSON.stringify(row.gl)} glc b${row.glc.buffers} t${row.glc.textures} p${row.glc.programs} v${row.glc.vaos} ctx${row.glc.contexts} | longtasks +${row.ltNew.n} (${row.ltNew.ms} ms) max ${app.lt.max} | busiest ${row.busy.map((b) => b.ms).join(',')} ms | spect ${row.spectate} walk ${row.walking} | reqs ${relay.reqs} sent ${relay.sent} refused ${relay.refusedEvents}`)
  for (const b of row.busy.slice(0, 2)) log(`   busy ${b.ms} ms: app ${b.app.slice(0, 3).join(' | ')} || self ${b.self.slice(0, 3).join(' | ')}`)
  return row
}
let next = Date.now() + SAMPLE
const tick = async () => { if (Date.now() >= next) { next = Date.now() + SAMPLE; await sample() } }
const wait = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { await tick(); await sleep(Math.min(1000, end - Date.now())) } }

const allocProfile = async (name, seconds) => {
  await cdp.send('HeapProfiler.enable')
  const f0 = await page.evaluate(() => window.__gl?.info.render.frame ?? 0)
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  await wait(seconds * 1000)
  const { profile: prof } = await cdp.send('HeapProfiler.stopSampling')
  const frames = (await page.evaluate(() => window.__gl?.info.render.frame ?? 0)) - f0
  const by = new Map(); let total = 0
  const walk = (node) => { const f = node.callFrame; const l = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\/(\.vite\/deps\/)?/, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`; total += node.selfSize; by.set(l, (by.get(l) ?? 0) + node.selfSize); for (const ch of node.children) walk(ch) }
  walk(prof.head)
  const top = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
  log(`ALLOC ${name}: ${Math.round(total / 1e6)} MB in ${seconds} s over ${frames} frames = ${frames ? Math.round(total / frames / 1024) : '?'} KB/frame (at 144 fps ${frames ? Math.round((total / frames) * 144 * 60 / 1e6) : '?'} MB/min)`)
  for (const [k, v] of top.slice(0, 12)) log(`  ${(v / 1e6).toFixed(1).padStart(7)} MB  ${k}`)
  fs.writeFileSync(`${out}/alloc-${name}${TAG}.json`, JSON.stringify({ seconds, total, frames, top }))
}
const snapshot = async (name) => {
  if (!process.env.SNAPSHOTS) return
  const chunks = []
  const on = (p) => chunks.push(p.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', on)
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', on)
  fs.writeFileSync(`${out}/${name}${TAG}.heapsnapshot`, chunks.join(''))
}

const mouse = page.mouse
const orbit = async (dx, dy) => {
  await mouse.move(W / 2, H / 2); await mouse.down()
  for (let i = 1; i <= 12; i++) { await mouse.move(W / 2 + (dx * i) / 12, H / 2 + (dy * i) / 12); await sleep(16) }
  await mouse.up()
}

await sample()

// ---- VIEW: moving between places ---------------------------------------
const PLACES = (process.env.PLACES ?? 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a,d4e4c079ad8e2f84af0da56f95c161431226934398e78c7a3c244e2547f6f3d4,8378a903830ff85c06c036913b06b732fff451422b26e5692f9e2e1a5e3c1b22,fe32b72cf7c34a8ea1a45f2b98d389258d9b3f3f4b0c704601e2368914cfcb1e,341db5a7e3a931f49095d82a4acc939cf8a67293b1e4179fd4b5c0544c4fc2ef,0ded28b3adf21f55f4d3e767635c54a5accf830094cb72fe9f50648373b74f9f,21580a98aaf64f7d66705abe7bf7a7acf4ee440fcf6b59d0b76e16217824d895,3e6f48e0293bd47b503f55b75e6e13efaed55a38c2bae18d1598453b5f3559a6').split(',')
phase = 'view'
const viewEnd = Date.now() + Number(viewMinArg) * 60_000
let k = 0, allocDone = false
await snapshot('view-start')
while (Date.now() < viewEnd) {
  const pk = PLACES[k++ % PLACES.length]
  await page.evaluate(async (p) => { const m = await import('/src/lib/spectator.ts'); await m.spectate(p) }, pk).catch((e) => log('spectate failed', e.message))
  const placeEnd = Math.min(viewEnd, Date.now() + HOLD)
  let j = 0
  while (Date.now() < placeEnd) {
    await orbit(j % 2 ? 180 : -180, j % 3 ? 40 : -40)
    if (j % 3 === 2) await mouse.wheel(0, j % 6 === 2 ? 400 : -400)
    j++
    await wait(2500)
    if (!allocDone && Date.now() - t0 > 90_000) { allocDone = true; await allocProfile('view', 40) }
  }
}
await snapshot('view-end')

// ---- WALK: at your own head, among Maze Kit rooms and hidden audio -------
phase = 'walk-setup'
await page.evaluate(async () => { const m = await import('/src/lib/spectator.ts'); m.stopSpectating() }).catch(() => {})
await wait(5000)
const placed = await page.evaluate(async ({ pieces, audio }) => {
  const { useShards } = await import('/src/store/useShards.ts')
  const { shardFromText } = await import('/src/store/useWorkshop.ts')
  const s = window.__store.getState()
  const a = s.position
  const items = []
  let i = 0
  for (const p of pieces) {
    const shard = shardFromText(p.text, `soak-${i}`)
    if (!shard) continue
    // Rooms in a grid on the plane around you, one 64 gibson region each, the nearest first.
    const gx = BigInt((i % 9) - 4) * 64n, gz = BigInt(Math.floor(i / 9) - 5) * 64n
    items.push({ eventId: (0x5000 + i).toString(16).padStart(64, '0'), bagId: 'soak', lookupId: 'soak', author: s.identity.pubkey, at: { x: a.x + gx, y: a.y, z: a.z + gz }, plane: s.plane, height: 6, createdAt: 1792700000, type: 'shard', shard })
    i++
  }
  for (let j = 0; j < 4; j++) {
    const off = BigInt(j * 8 - 12)
    items.push({ eventId: (0x6000 + j).toString(16).padStart(64, '0'), bagId: 'soak', lookupId: 'soak', author: s.identity.pubkey, at: { x: a.x + off, y: a.y, z: a.z - off }, plane: s.plane, height: 6, createdAt: 1792700000, type: 'audio',
      audio: { title: `soak tone ${j}`, about: '', url: `${audio.base}/${audio.hash}`, mime: 'audio/wav', hash: audio.hash, originalHash: '', size: audio.size, keyHex: audio.key, nonceHex: audio.nonce, autoplay: true, loop: true, retrigger: 'auto', walkOnly: false } })
  }
  useShards.getState().addDiscovered(items)
  return { shards: i, audio: 4, at: [String(a.x), String(a.y), String(a.z)] }
}, { pieces, audio: { base: BLOSSOM, hash: audioHash, size: cipher.length, key: key.toString('hex'), nonce: nonce.toString('hex') } })
log('placed', placed)
await wait(15_000)
// A tap anywhere lets the sound out (a gesture), as TAP FOR SOUND asks.
await mouse.click(W / 2, H / 2)
await wait(5000)
await snapshot('walk-before')
const before = await page.evaluate(() => ({ used: performance.memory?.usedJSHeapSize ?? null, lt: { ...window.__lt, list: undefined } }))
const heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize
const tEnter = Date.now()
await page.evaluate(async () => { const { useWalk } = await import('/src/store/useWalk.ts'); useWalk.getState().enter() })
await sleep(10_000)
const heapAfter = (await cdp.send('Runtime.getHeapUsage')).usedSize
const after = await page.evaluate(() => ({ walking: window.__store.getState().walking, lt: { ...window.__lt, list: undefined }, recent: window.__lt.list.slice(-10) }))
log('WALK ENTER', { heapBeforeMB: Math.round(heapBefore / 1e6), heapAfter10sMB: Math.round(heapAfter / 1e6), walking: after.walking, longtasksIn10s: after.lt.n - before.lt.n, longtaskMsIn10s: Math.round(after.lt.ms - before.lt.ms), maxSoFar: Math.round(after.lt.max), recent: after.recent, ms: Date.now() - tEnter })
phase = 'walk'
// Fine steps, so the rooms are walked into.
await page.evaluate(() => { const s = window.__store.getState(); for (let i = 0; i < 40 && s.scaleExp > 0; i++) window.__store.getState().adjustScale(-1) })
const keys = ['w', 'w', 'w', 'a', 'w', 'd', 'w', 's', 'r', 'f', 'w', 'w', 'd', 'd', 's', 'a']
const walkEnd = Date.now() + Number(walkMinArg) * 60_000
let n = 0, walkAlloc = false
while (Date.now() < walkEnd) {
  await page.keyboard.press(keys[n % keys.length])
  n++
  if (n % 23 === 0) await orbit(n % 2 ? 120 : -120, 0)
  await wait(n % 9 === 0 ? 2500 : 250)
  if (!walkAlloc && Date.now() > tEnter + 90_000) { walkAlloc = true; await allocProfile('walk', 40) }
}
await sample()
await snapshot('walk-end')
log('done', { relay, blocked, pageErrors: pageErrors.slice(0, 8), steps: n })
await browser.close()
