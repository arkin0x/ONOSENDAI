/**
 * perf-scene-fanout.mjs: what the world's scene costs when one shard places
 * a big object many times (2026-10-25, the scene mesh budget).
 *
 * ShardMesh's Placements draws each root placement with its reference's whole
 * resolved tree, so a shard of a few kilobytes placing one object a thousand
 * times draws a thousand copies of that object's tree. This puts world shards
 * at your own place, waits for them to settle, and reports, per scene:
 * - draw calls per frame (renderer.info.render.calls), and the scene's
 *   objects by type (Mesh, Points, LineSegments, InstancedMesh), counted by a
 *   traverse of window.__scene;
 * - frame time over a few seconds (mean and p95 of requestAnimationFrame
 *   deltas), and the longest task;
 * - the JS heap (CDP Runtime.getHeapUsage) after a GC.
 *
 * Scenes (SCENES, comma separated):
 * - hostile: one stranger's shard placing one carried object N times (FANOUT,
 *   300), the object four levels of K placements (K, 4: 1 + 4 + 16 + 64 = 85
 *   nodes), so N x 85 copies drawn without a budget;
 * - own: the same fan-out as yours, drawn from the share reserved for you;
 * - kit: the owner's Maze Kit (KIT, maze-kit-all.zip), every piece that places
 *   others hidden with the pieces it places carried (sno-core carryAll), in a
 *   grid around you, as yours.
 *
 * Nothing leaves the machine: LOCAL is set before the first script runs and
 * the run aborts if the store is not LOCAL; every HTTP request and WebSocket
 * to anything but localhost is refused.
 *
 * Usage (a dev server running): node scripts/perf-scene-fanout.mjs <url> [out.json]
 * Env: SCENES (hostile,kit), FANOUT (300), K (4), KIT, SETTLE (8 s), MEASURE (4 s), W (1280), H (800), CHROME.
 */
import fs from 'node:fs'
import { chromium } from 'playwright'
import { unzipSync, strFromU8 } from 'fflate'

const [url, outPath] = process.argv.slice(2)
if (!url) { console.log('usage: perf-scene-fanout.mjs <url> [out.json]'); process.exit(1) }
const SCENES = (process.env.SCENES ?? 'hostile,kit').split(',')
const FANOUT = Number(process.env.FANOUT ?? 300)
const K = Number(process.env.K ?? 4)
const KIT = process.env.KIT ?? '/data/Sync/agents/claude/onosendai/maze-kit/zips/maze-kit-all.zip'
const SETTLE = Number(process.env.SETTLE ?? 8) * 1000
const MEASURE = Number(process.env.MEASURE ?? 4) * 1000
const W = Number(process.env.W ?? 1280), H = Number(process.env.H ?? 800)
const CHROME = process.env.CHROME ?? '/data/claude/ms-playwright/chromium-1234/chrome-linux64/chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The kit's pieces, as text, by their stable ids.
const kit = {}
if (SCENES.includes('kit')) {
  const files = unzipSync(fs.readFileSync(KIT))
  for (const [name, bytes] of Object.entries(files)) if (name.endsWith('.json')) kit[name.replace(/\.json$/, '')] = strFromU8(bytes)
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] })
const results = []
for (const scene of SCENES) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H } })
  let blocked = 0
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u.toString()), (r) => { blocked++; return r.abort() })
  await ctx.routeWebSocket(/.*/, (ws) => {
    if (/^wss?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(ws.url())) { ws.connectToServer(); return }
    blocked++
    ws.close()
  })
  const page = await ctx.newPage()
  await page.addInitScript(() => {
    try { localStorage.setItem('onosendai:live', '0') } catch {}
    const lt = { max: 0 }
    window.__ltmax = lt
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) lt.max = Math.max(lt.max, e.duration) }).observe({ type: 'longtask', buffered: true }) } catch {}
    // Draw calls, counted at the context: renderer.info counts only the last pass.
    const g = { draws: 0 }
    window.__draws = g
    for (const P of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
      for (const d of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const o = P.prototype[d]
        if (o) P.prototype[d] = function (...a) { g.draws++; return o.apply(this, a) }
      }
    }
  })
  const cdp = await ctx.newCDPSession(page)
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__store, null, { timeout: 180_000 })
  await sleep(4000)
  if ((await page.evaluate(() => window.__store.getState().live)) !== false) { console.log('ABORT: not LOCAL'); await browser.close(); process.exit(2) }

  const placed = await page.evaluate(async ({ scene, FANOUT, K, kit }) => {
    const { useShards } = await import('/src/store/useShards.ts')
    // sno-core's own files, as the dev server serves them: pure functions on plain models.
    const { fromPayload, toPayload, newShard } = await import('/node_modules/sno-core/dist/shards.js')
    const { carryAll, parseAddress } = await import('/node_modules/sno-core/dist/parts.js')
    const s = window.__store.getState()
    const me = s.identity.pubkey
    const at = s.position
    const items = []
    const add = (shard, i, author, dx = 0n, dz = 0n) => items.push({ eventId: (0x7000 + i).toString(16).padStart(64, '0'), bagId: 'fanout', lookupId: 'fanout', author, at: { x: at.x + dx, y: at.y, z: at.z + dz }, plane: s.plane, height: 6, createdAt: 1792700000, type: 'shard', shard })
    if (scene === 'hostile' || scene === 'own') {
      // The same fan-out, a stranger's (hostile) or your own (own: the trusted share).
      const THEM = scene === 'own' ? me : 'b'.repeat(64)
      const addr = (d) => `33331:${THEM}:${d}`
      const cube = { ...toPayload({ ...newShard('c'), mode: 'solid', vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]].map((p) => ({ p, c: [1, 0, 1] })), faces: [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]] }) }
      const level = (name, next) => ({ ...cube, name, ...(next ? { refs: [['a', addr(next)]], parts: Array.from({ length: K }, (_, i) => [0, i * 120, 0, 0, 0, 0, 0, 0]) } : {}) })
      const objects = { [addr('l1')]: level('l1', 'l2'), [addr('l2')]: level('l2', 'l3'), [addr('l3')]: level('l3', null) }
      const root = { ...toPayload({ ...newShard('Fan-out'), mode: 'solid' }), refs: [['a', addr('l1')]], parts: Array.from({ length: FANOUT }, (_, i) => [0, (i % 40) * 120, 0, Math.floor(i / 40) * 120, 0, 0, 0, 0]), objects }
      const model = fromPayload(root, 'fanout')
      add({ ...model, author: THEM }, 0, THEM)
      useShards.getState().addDiscovered(items)
      return { shards: 1, rootPlacements: FANOUT, perCopy: 1 + K + K * K, unbudgeted: FANOUT * (1 + K + K * K) }
    }
    // kit: every piece, hidden as yours, composites carrying what they place.
    const byId = {}
    for (const [id, text] of Object.entries(kit)) { try { const m = fromPayload(JSON.parse(text), id); if (m) byId[id] = m } catch {} }
    // The zip's refs name the kit's own ids under whoever imported it: here, you.
    const rekey = (m) => (m.refs ? { ...m, refs: m.refs.map((r) => { const a = parseAddress(r[1]); return a ? ['a', `33331:${me}:${a.d}`] : r }) } : m)
    let i = 0, composites = 0
    for (const [id, m0] of Object.entries(byId)) {
      let m = rekey(m0)
      if (m.parts?.length) {
        composites++
        m = carryAll(m, ([, a]) => { const p = parseAddress(a); const piece = p && byId[p.d]; return piece ? { object: rekey(piece), carry: true } : null })
      }
      const gx = BigInt((i % 17) - 8) * 48n, gz = BigInt(Math.floor(i / 17) - 8) * 48n
      add({ ...m, author: me }, i, me, gx, gz)
      i++
    }
    useShards.getState().addDiscovered(items)
    return { shards: i, composites }
  }, { scene, FANOUT, K, kit })
  await sleep(SETTLE)
  const stats = await page.evaluate(async (MEASURE) => {
    const counts = { Mesh: 0, Points: 0, LineSegments: 0, InstancedMesh: 0, Line: 0, other: 0 }
    window.__scene?.traverse((o) => { if (o.type in counts) counts[o.type]++; else if (o.isObject3D && o.type !== 'Group' && o.type !== 'Object3D' && o.type !== 'Scene') counts.other++ })
    const d0 = window.__draws.draws
    const deltas = []
    await new Promise((done) => {
      let last = performance.now()
      const end = last + MEASURE
      const tick = (t) => { deltas.push(t - last); last = t; if (t < end) requestAnimationFrame(tick); else done() }
      requestAnimationFrame(tick)
    })
    const calls = Math.round((window.__draws.draws - d0) / Math.max(1, deltas.length))
    deltas.sort((a, b) => a - b)
    const mean = deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length)
    return { objects: counts, drawsPerFrame: calls, geometries: window.__gl?.info.memory.geometries ?? null, frames: deltas.length, frameMs: { mean: Math.round(mean * 10) / 10, p95: Math.round((deltas[Math.floor(deltas.length * 0.95)] ?? 0) * 10) / 10 }, longestTaskMs: Math.round(window.__ltmax.max) }
  }, MEASURE)
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {})
  const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize
  const row = { scene, placed, ...stats, heapMB: Math.round(heap / 1e6), blocked }
  console.log(JSON.stringify(row))
  results.push(row)
  await ctx.close()
}
await browser.close()
if (outPath) fs.writeFileSync(outPath, JSON.stringify(results, null, 2))
