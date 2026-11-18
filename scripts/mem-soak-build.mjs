/**
 * mem-soak-build.mjs: memory over a long session of big kit imports and
 * BUILD work, in headless Chromium against the dev server (2026-11-18).
 *
 * arkinox, 2026-11-18: "I was importing large kits and building and moving.
 * It got up to really high memory, about 11GB, then it started to become
 * unresponsive every minute, then every few moments, then every few seconds."
 *
 * Each round: one of the given zips comes in through the workshop's own bulk
 * import (PUBLISH off; UPDATE once a zip has come in before, so the shard list
 * itself stops growing), a few pieces are opened on the bench and edited with
 * undo and redo, then the workshop closes and BUILD hides several pieces in the
 * world and moves each one (EDIT), and the pad goes round HOP, VIEW, BUILD and
 * WALK. After each round the page is collected (HeapProfiler.collectGarbage)
 * and the settled heap, the DOM counters, every WebGL object counted at the
 * context and each three.js renderer's own info are written to samples.jsonl.
 *
 * Nothing leaves the machine: LOCAL is set before load (or LIVE=1, see below), a throwaway local key
 * signs, every WebSocket is answered by an in-process relay (scripts/smoke-lib
 * style), and any HTTP request to another origin is aborted.
 *
 * Usage: node scripts/mem-soak-build.mjs <url> <out dir> <zip> [zip...]
 * Env: ROUNDS (8), MINUTES (14, a hard stop), DEPLOYS (6 a round), HEAP_MB
 * (4096, the page's own heap cap), SNAPSHOTS=1 (heap snapshots after the first
 * and the last round), MIN_FREE_GB (8: stop when the machine has less).
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19, matchFilter } from 'nostr-tools'

const [base, out, ...zips] = process.argv.slice(2)
if (!base || !out || !zips.length) { console.log('usage: mem-soak-build.mjs <url> <out> <zip> [zip...]'); process.exit(1) }
fs.mkdirSync(out, { recursive: true })
const ROUNDS = Number(process.env.ROUNDS ?? 8)
const DEADLINE = Date.now() + Number(process.env.MINUTES ?? 14) * 60_000
const DEPLOYS = Number(process.env.DEPLOYS ?? 6)
const HEAP_MB = Number(process.env.HEAP_MB ?? 4096)
const MIN_FREE_KB = Number(process.env.MIN_FREE_GB ?? 8) * 1024 * 1024
// LIVE=1: the app publishes as it would, to the in-process relay only (every
// socket is answered here; none reaches a real relay).
const LIVE = process.env.LIVE === '1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const freeKb = () => Number(/MemAvailable:\s+(\d+)/.exec(fs.readFileSync('/proc/meminfo', 'utf8'))[1])
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const browser = await chromium.launch({
  args: [`--memleak-soak-${process.pid}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', `--js-flags=--max-old-space-size=${HEAP_MB}`],
})
let stopping = false
const shutdown = async (code) => { stopping = true; try { await browser.close() } catch {} process.exit(code) }
process.on('SIGTERM', () => void shutdown(143))
process.on('SIGINT', () => void shutdown(130))

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
// The in-process relay: what it is sent stays in this process.
const stats = { events: 0, aborted: 0 }
const kept = []
const subs = new Set()
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => { stats.aborted++; return r.abort() })
await ctx.routeWebSocket(/.*/, (ws) => {
  if (/^wss?:\/\/(localhost|127\.0\.0\.1)/.test(ws.url())) { ws.connectToServer(); return }
  const mine = new Map()
  ws.onClose(() => { for (const s of mine.values()) subs.delete(s) })
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') {
      const [, id, ...filters] = m
      for (const f of filters) for (const ev of kept.filter((e) => matchFilter(f, e)).slice(0, f.limit ?? 500)) ws.send(JSON.stringify(['EVENT', id, ev]))
      ws.send(JSON.stringify(['EOSE', id]))
      const s = { ws, id, filters }; mine.set(id, s); subs.add(s)
    } else if (m[0] === 'CLOSE') { const s = mine.get(m[1]); if (s) { subs.delete(s); mine.delete(m[1]) } }
    else if (m[0] === 'EVENT') {
      stats.events++; kept.push(m[1])
      ws.send(JSON.stringify(['OK', m[1].id, true, '']))
      for (const s of subs) if (s.filters.some((f) => matchFilter(f, m[1]))) s.ws.send(JSON.stringify(['EVENT', s.id, m[1]]))
    } else if (m[0] === 'AUTH') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)))
const sk = generateSecretKey()
await page.addInitScript(([pk, ns, live]) => {
  try {
    localStorage.setItem('onosendai:live', live ? '1' : '0')
    localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
    // No tutorial: a returning arrival.
    localStorage.setItem('onosendai:tutorial', 'off')
  } catch {}
  // Every WebGL object, per context: made and let go. A context that is lost
  // or whose canvas is gone holds nothing any more, so live counts add up
  // only the contexts still standing.
  const per = new Map()
  let made = 0
  const of = (gl) => { let c = per.get(gl); if (!c) { c = { buffers: 0, textures: 0, programs: 0, vaos: 0, framebuffers: 0, renderbuffers: 0, bufferBytes: 0, gl: new WeakRef(gl) }; per.set(gl, c) } return c }
  for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
    const wrap = (name, f) => { const o = P.prototype[name]; if (o) P.prototype[name] = function (...a) { f(a, of(this)); return o.apply(this, a) } }
    for (const [mk, rm, k] of [['createBuffer', 'deleteBuffer', 'buffers'], ['createTexture', 'deleteTexture', 'textures'], ['createProgram', 'deleteProgram', 'programs'], ['createVertexArray', 'deleteVertexArray', 'vaos'], ['createFramebuffer', 'deleteFramebuffer', 'framebuffers'], ['createRenderbuffer', 'deleteRenderbuffer', 'renderbuffers']]) {
      wrap(mk, (a, c) => c[k]++); wrap(rm, (a, c) => { if (a[0]) c[k]-- })
    }
    wrap('bufferData', (a, c) => { const s = a[1]; c.bufferBytes += typeof s === 'number' ? s : (s?.byteLength ?? 0) })
  }
  const gc = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (type, ...r) { const x = gc.call(this, type, ...r); if (x && /webgl/i.test(String(type)) && !this.__counted) { this.__counted = true; made++ } return x }
  const glLive = () => {
    const g = { buffers: 0, textures: 0, programs: 0, vaos: 0, framebuffers: 0, renderbuffers: 0, live: 0, made }
    for (const [ctx, c] of per) {
      if (ctx.isContextLost() || !ctx.canvas.isConnected) { per.delete(ctx); continue }
      g.live++
      for (const k of ['buffers', 'textures', 'programs', 'vaos', 'framebuffers', 'renderbuffers']) g[k] += c[k]
    }
    return g
  }
  // Frames asked for: a leak that grows per frame grows with this.
  let frames = 0
  const raf = window.requestAnimationFrame
  window.requestAnimationFrame = function (cb) { frames++; return raf.call(this, cb) }
  // three.js announces each renderer to its devtools hook: kept weakly.
  const renderers = []
  window.__THREE_DEVTOOLS__ ??= new EventTarget()
  window.__THREE_DEVTOOLS__.addEventListener('observe', (e) => { if (e.detail?.isWebGLRenderer) renderers.push(new WeakRef(e.detail)) })
  window.__mem = () => {
    const ri = renderers.map((w) => w.deref()).filter(Boolean).map((r) => ({ geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? 0, w: r.domElement?.width ?? 0 }))
    return { gl: glLive(), frames, renderers: ri, canvases: document.querySelectorAll('canvas').length, used: performance.memory?.usedJSHeapSize ?? 0 }
  }
}, [getPublicKey(sk), nip19.nsecEncode(sk), LIVE])

const cdp = await ctx.newCDPSession(page)
await cdp.send('HeapProfiler.enable')
const ev = (fn, arg) => page.evaluate(fn, arg)
// A module of the app, by its dev path, and one expression over it.
const mod = (p, expr) => page.evaluate(async ([p, expr]) => { const m = await import(p); return await (0, eval)(`(async (m) => ${expr})`)(m) }, [p, expr])

const t0 = Date.now()
// The browser's processes by role, from the one started with TAG.
const TAG = `--memleak-soak-${process.pid}`
function procRss() {
  const parent = new Map(), cmd = new Map()
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try {
      const st = fs.readFileSync(`/proc/${p}/stat`, 'utf8')
      parent.set(p, st.slice(st.lastIndexOf(')') + 2).split(' ')[1])
      cmd.set(p, fs.readFileSync(`/proc/${p}/cmdline`, 'utf8').replace(/\0/g, ' '))
    } catch { /* gone */ }
  }
  const mine = new Set([...cmd].filter(([, c]) => c.includes(TAG) && !/--type=/.test(c)).map(([p]) => p))
  let grew = true
  while (grew) { grew = false; for (const [p, pp] of parent) if (!mine.has(p) && mine.has(pp)) { mine.add(p); grew = true } }
  const rss = { renderer: 0, gpu: 0, other: 0 }
  for (const p of mine) {
    let kb = 0
    try { kb = Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/status`, 'utf8'))?.[1] ?? 0) } catch { continue }
    const c = cmd.get(p) ?? ''
    rss[/--type=renderer/.test(c) ? 'renderer' : /--type=gpu-process/.test(c) ? 'gpu' : 'other'] += Math.round(kb / 1024)
  }
  return rss
}
const samples = fs.createWriteStream(path.join(out, 'samples.jsonl'))
async function sample(label, settle = false) {
  if (settle) { for (let i = 0; i < 2; i++) { await cdp.send('HeapProfiler.collectGarbage'); await sleep(500) } }
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters').catch(() => ({}))
  const m = await ev(() => window.__mem())
  // The walls avatars stand on, where the build has the count (store/walkWalls restWallsKept).
  m.restWalls = await mod('/src/store/walkWalls.ts', 'm.restWallsKept ? m.restWallsKept() : null').catch(() => null)
  const row = { t: Math.round((Date.now() - t0) / 1000), label, settle, heapMB: +(heap.usedSize / 1048576).toFixed(1), totalMB: +(heap.totalSize / 1048576).toFixed(1), extMB: +(((heap.backingStorageSize ?? 0) + (heap.embedderHeapUsedSize ?? 0)) / 1048576).toFixed(1), rss: procRss(), dom, ...m, relayEvents: stats.events, freeGB: +(freeKb() / 1048576).toFixed(1) }
  samples.write(JSON.stringify(row) + '\n')
  log(label, `heap ${row.heapMB} MB`, `frames ${m.frames}`, `gl buf ${m.gl.buffers} tex ${m.gl.textures} prog ${m.gl.programs} ctx ${m.gl.live}/${m.gl.made}`, `ext ${row.extMB} MB rss r ${row.rss.renderer} g ${row.rss.gpu}`, 'ri', JSON.stringify(m.renderers), `nodes ${dom.nodes} listeners ${dom.jsEventListeners}`)
  if (freeKb() < MIN_FREE_KB) { log('STOP: machine free memory below the floor'); await shutdown(5) }
  return row
}
// A background sampler, every 5 s, so a climb within a round shows too.
const ticker = setInterval(() => { if (!stopping) sample('tick').catch(() => {}) }, 5000)

async function snapshot(name) {
  const file = path.join(out, `${name}.heapsnapshot`)
  const fd = fs.openSync(file, 'w')
  const onChunk = (p) => fs.writeSync(fd, p.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk)
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk)
  fs.closeSync(fd)
  log('snapshot', file)
}

await page.goto(base, { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 120 && !(await ev(() => !!window.__store).catch(() => false)); i++) await sleep(1000)
await sleep(5000)
if ((await ev(() => window.__store.getState().live)) !== LIVE) { log('ABORT: LIVE is not', LIVE); await shutdown(2) }
await sample('loaded', true)

// ALLOC=<s>: a sampling allocation profile of the first round's first ALLOC seconds, summarised by function (alloc.txt).
async function allocProfile(seconds) {
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 65536, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  await sleep(seconds * 1000)
  const { profile } = await cdp.send('HeapProfiler.stopSampling')
  fs.writeFileSync(path.join(out, 'alloc.heapprofile'), JSON.stringify(profile))
  const by = new Map()
  const walk = (n, stack) => {
    const f = n.callFrame
    const here = `${f.functionName || '(anon)'} ${f.url.replace(/^.*?\/(src|node_modules)\//, '$1/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`
    const st = [...stack, here]
    if (n.selfSize) { const k = st.slice(-4).reverse().join(' < '); by.set(k, (by.get(k) ?? 0) + n.selfSize) }
    for (const c of n.children) walk(c, st)
  }
  walk(profile.head, [])
  const total = [...by.values()].reduce((a, b) => a + b, 0)
  const lines = [...by].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${(v / 1048576).toFixed(1).padStart(8)} MB  ${k}`)
  fs.writeFileSync(path.join(out, 'alloc.txt'), `total allocated (sampled) ${(total / 1048576).toFixed(1)} MB over ${seconds} s\n` + lines.join('\n') + '\n')
  log('alloc profile written')
}

const seen = new Set()
async function importZip(zipPath) {
  const b64 = fs.readFileSync(zipPath).toString('base64')
  const mode = seen.has(zipPath) ? 'update' : 'skip'
  seen.add(zipPath)
  return page.evaluate(async ([b64, name, mode]) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
    const file = new File([u], name, { type: 'application/zip' })
    const { useWorkshop } = await import('/src/store/useWorkshop.ts')
    const { useShardImport } = await import('/src/store/useShardImport.ts')
    useWorkshop.getState().openWorkshop()
    await useShardImport.getState().openZip(file)
    for (let i = 0; i < 600 && useShardImport.getState().phase !== 'review'; i++) await new Promise((r) => setTimeout(r, 200))
    useShardImport.getState().setPublish(false)
    useShardImport.getState().setDupMode(mode)
    await useShardImport.getState().start()
    for (let i = 0; i < 900 && useShardImport.getState().phase === 'running'; i++) await new Promise((r) => setTimeout(r, 200))
    const st = useShardImport.getState()
    const rows = st.rows.map((r) => r.run)
    const res = { phase: st.phase, done: rows.filter((x) => x === 'done').length, failed: rows.filter((x) => x === 'failed').length, skipped: rows.filter((x) => x === 'skipped').length, shards: useWorkshop.getState().shards.length, ids: st.rows.map((r) => r.shardId).filter(Boolean) }
    useShardImport.getState().close()
    return res
  }, [b64, path.basename(zipPath), mode])
}

// The biggest pieces of what came in, by face count.
const biggest = (ids, n) => mod('/src/store/useWorkshop.ts', `(() => { const ids = new Set(${JSON.stringify(ids)}); return m.useWorkshop.getState().shards.filter((s) => ids.has(s.id)).sort((a, b) => b.faces.length - a.faces.length).slice(0, ${n}).map((s) => s.id) })()`)

async function benchWork(ids) {
  for (const id of ids) {
    await mod('/src/store/useWorkshop.ts', `m.useWorkshop.getState().openWorkshop(${JSON.stringify(id)})`)
    await sleep(1500)
    await mod('/src/store/useWorkshop.ts', `(() => { const w = m.useWorkshop.getState(); const s = w.shards.find((x) => x.id === w.currentId); w.setSelection(s.vertices.map((_, i) => i)); for (let k = 0; k < 4; k++) m.useWorkshop.getState().moveSelected(k % 3, 1); for (let k = 0; k < 3; k++) m.useWorkshop.getState().undo(); for (let k = 0; k < 2; k++) m.useWorkshop.getState().redo(); m.useWorkshop.getState().setSelection([]) })()`)
    await sleep(1000)
  }
  await mod('/src/store/useWorkshop.ts', 'm.useWorkshop.getState().closeWorkshop()')
}

async function waitDeploy() {
  for (let i = 0; i < 240; i++) {
    const s = await mod('/src/store/useShards.ts', '(() => { const s = m.useShards.getState(); return { status: s.deployStatus, error: s.deployError, ask: !!s.deployAsk, pending: !!s.pending } })()')
    if (s.ask) await mod('/src/store/useShards.ts', 'm.useShards.getState().confirmDeploy()')
    if (s.status !== 'working' && i > 2) return s
    await sleep(500)
  }
  return { status: 'timeout' }
}

let deployed = 0, moved = 0, deployErrors = []
// MOVE_ONLY=1: the first round hides the pieces, later rounds only move them, so what a move keeps shows apart from what a new piece costs.
let hidOnce = false
async function buildWork(ids) {
  await mod('/src/store/useBuilder.ts', "m.useBuilder.getState().enter('build')")
  await sleep(800)
  const hide = !(process.env.MOVE_ONLY && hidOnce)
  hidOnce = true
  for (const id of hide ? ids : []) {
    await mod('/src/store/useShards.ts', `m.useShards.getState().startDeployShard(${JSON.stringify(id)})`)
    await mod('/src/store/useShards.ts', 'm.useShards.getState().setDeployHeight(0)')
    for (let k = 0; k < 3; k++) { await page.keyboard.press(['KeyD', 'KeyW', 'KeyA', 'KeyS'][(deployed + k) % 4]); await sleep(150) }
    await sleep(600)
    const before = await mod('/src/store/useShards.ts', 'm.useShards.getState().mine.length')
    await mod('/src/store/useShards.ts', 'm.useShards.getState().deploy()')
    const r = await waitDeploy()
    const after = await mod('/src/store/useShards.ts', 'm.useShards.getState().mine.length')
    if (after > before) deployed++
    else deployErrors.push(r.error ?? r.status)
    await mod('/src/store/useShards.ts', 'm.useShards.getState().pending && m.useShards.getState().cancelDeploy()')
    await sleep(800)
  }
  // Move the newest ones: EDIT, a step, place.
  const edits = await mod('/src/store/useShards.ts', `m.useShards.getState().mine.filter((d) => d.type === 'shard' && d.shard && d.goneFrom === undefined).slice(-${ids.length}).map((d) => d.eventId)`)
  for (const eid of edits) {
    await mod('/src/store/useShards.ts', `m.useShards.getState().startEditShard(${JSON.stringify(eid)})`)
    for (let k = 0; k < 2; k++) { await page.keyboard.press(moved % 2 ? 'KeyD' : 'KeyW'); await sleep(150) }
    await sleep(500)
    await mod('/src/store/useShards.ts', 'm.useShards.getState().deploy()')
    const r = await waitDeploy()
    if (r.status !== 'error') moved++
    else deployErrors.push('move: ' + r.error)
    await mod('/src/store/useShards.ts', 'm.useShards.getState().pending && m.useShards.getState().cancelDeploy()')
    await sleep(600)
  }
  await mod('/src/store/padMode.ts', 'm.buildToHop()')
}

async function modeRing() {
  await mod('/src/store/useCyberspace.ts', 'm.useCyberspace.getState().viewHere()'); await sleep(1500)
  await mod('/src/store/padMode.ts', 'm.viewToAvatar()'); await sleep(1000)
  await mod('/src/store/padMode.ts', 'm.enterWalk()'); await sleep(1500)
  for (let k = 0; k < 6; k++) { await page.keyboard.press(['KeyW', 'KeyD', 'KeyS', 'KeyA'][k % 4]); await sleep(250) }
  await mod('/src/store/padMode.ts', 'm.leaveWalk()'); await sleep(1000)
  await mod('/src/store/useBuilder.ts', "m.useBuilder.getState().enter('build')"); await sleep(1000)
  await mod('/src/store/padMode.ts', 'm.buildToHop()'); await sleep(800)
}

// PHASES picks the parts of a round (import,bench,build,ring); every zip
// comes in once first, then each round takes the next zip (UPDATE).
const PHASES = new Set((process.env.PHASES ?? 'import,bench,build,ring').split(','))
const rows = []
let ids = []
for (const zip of process.env.WARM ? zips : []) { const im = await importZip(zip); ids = im.ids; log('warm import', JSON.stringify({ ...im, ids: im.ids.length })) }
if (process.env.WARM) await sample('warm', true)
for (let round = 1; round <= ROUNDS && Date.now() < DEADLINE; round++) {
  const zip = zips[(round - 1) % zips.length]
  const t = Date.now()
  if (PHASES.has('import') || !ids.length) {
    const prof = process.env.ALLOC && round === 1 ? allocProfile(Number(process.env.ALLOC)) : null
    const im = await importZip(zip)
    await prof
    ids = im.ids
    log(`round ${round} import`, path.basename(zip).replace(/[^-]*-kit/, 'kit'), JSON.stringify({ ...im, ids: im.ids.length }), `${Math.round((Date.now() - t) / 1000)} s`)
  }
  const top = await biggest(ids, Math.max(DEPLOYS, 3))
  if (PHASES.has('bench')) await benchWork(top.slice(0, 3))
  if (PHASES.has('build')) await buildWork(top.slice(0, DEPLOYS))
  if (PHASES.has('ring')) await modeRing()
  // The workshop opened and closed once more, as he does between rounds.
  await mod('/src/store/useWorkshop.ts', 'm.useWorkshop.getState().openWorkshop()'); await sleep(2000)
  await mod('/src/store/useWorkshop.ts', 'm.useWorkshop.getState().closeWorkshop()'); await sleep(1000)
  const row = await sample(`round ${round}`, true)
  rows.push({ round, s: Math.round((Date.now() - t) / 1000), heapMB: row.heapMB, extMB: row.extMB, rss: row.rss, deployed, moved, ...row.gl, ri: row.renderers, restWalls: row.restWalls, nodes: row.dom.nodes, listeners: row.dom.jsEventListeners })
  if (process.env.SNAPSHOTS && round === 1) await snapshot('round1')
}
// IDLE=<minutes>: then stand still in the world (HOP), collected and sampled each minute, so growth per frame shows apart from the work.
const idle = []
if (process.env.IDLE) {
  if (process.env.SNAPSHOTS) { await cdp.send('HeapProfiler.collectGarbage'); await snapshot('idle0') }
  const end = Math.min(DEADLINE + 60_000, Date.now() + Number(process.env.IDLE) * 60_000)
  while (Date.now() < end) {
    await sleep(60_000)
    const r = await sample('idle', true)
    idle.push({ t: r.t, heapMB: r.heapMB, extMB: r.extMB, frames: r.frames, rss: r.rss })
  }
}
clearInterval(ticker)
if (process.env.SNAPSHOTS) { await cdp.send('HeapProfiler.collectGarbage'); await snapshot('last') }
const rowsNow = await mod('/src/store/useShards.ts', '({ mine: m.useShards.getState().mine.length, gone: m.useShards.getState().mine.filter((d) => d.goneFrom !== undefined).length })').catch(() => null)
const summary = { rowsNow, rounds: rows, idle, deployed, moved, deployErrors: deployErrors.slice(0, 20), relayEvents: stats.events, errors: errors.slice(0, 20), minutes: +((Date.now() - t0) / 60000).toFixed(1) }
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 1))
log('done', JSON.stringify({ deployed, moved, errors: errors.length, deployErrors: deployErrors.length }))
await shutdown(0)
