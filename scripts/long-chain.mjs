/**
 * long-chain.mjs: give a throwaway identity a long LOCAL chain, for soaks
 * that need one (2026-10-13). arkinox's tab carries thousands of actions,
 * and work that scales with the chain only shows at that size.
 *
 * Makes (or reuses) a throwaway key in <dir>/key.json, loads the dev build
 * as it, LOCAL before anything, and commits `n` one-gibson hops in a square
 * walk, each proved and signed on this device. Every relay is an empty one
 * answered in-process; the chain never leaves.
 * Then it saves the page's whole localStorage to <dir>/storage.json, which a
 * soak restores to start as this identity with this chain.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/long-chain.mjs <url> <dir> [n]
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'

const [url, dir, n = '1500'] = process.argv.slice(2)
fs.mkdirSync(dir, { recursive: true })
const keyFile = `${dir}/key.json`
if (!fs.existsSync(keyFile)) {
  const sk = generateSecretKey()
  fs.writeFileSync(keyFile, JSON.stringify({ pubkey: getPublicKey(sk), nsec: nip19.nsecEncode(sk) }))
}
const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'))
const storageFile = `${dir}/storage.json`
const saved = fs.existsSync(storageFile) ? JSON.parse(fs.readFileSync(storageFile, 'utf8')) : null

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } })
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
let dropped = 0
await ctx.routeWebSocket(/.*/, (ws) => {
  if (/localhost|127\.0\.0\.1/.test(ws.url())) { ws.connectToServer(); return }
  // An empty relay, in-process: every question answered with nothing, so
  // the head check before each move is answered, and nothing ever reaches
  // the network.
  ws.onMessage((raw) => {
    let m = null
    try { m = JSON.parse(String(raw)) } catch { return }
    if (!Array.isArray(m)) return
    if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]]))
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
    else if (m[0] === 'EVENT' || m[0] === 'AUTH') dropped++
  })
})
const page = await ctx.newPage()
await page.addInitScript(([k, s]) => {
  try {
    if (s && !sessionStorage.getItem('restored')) { for (const [a, b] of Object.entries(s)) localStorage.setItem(a, b); sessionStorage.setItem('restored', '1') }
    localStorage.setItem('onosendai:live', '0')
    localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: k.pubkey, nsec: k.nsec }))
  } catch {}
}, [key, saved])
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(8000)
const st = await page.evaluate(() => ({ live: window.__store.getState().live, me: window.__store.getState().identity.pubkey, events: window.__store.getState().events.length }))
if (st.live !== false || st.me !== key.pubkey) { console.log('ABORT', JSON.stringify(st)); await browser.close(); process.exit(2) }
console.log('start events', st.events)
// MEASURE=1: commit in rounds of 25 and sample the heap between them (and,
// with SNAPSHOTS=1, write heap snapshots before and after), to see what one
// action leaves behind.
const cdp = await ctx.newCDPSession(page)
const snap = async (label) => {
  if (!process.env.SNAPSHOTS) return
  const chunks = []
  const h = (p) => chunks.push(p.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', h)
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', h)
  fs.writeFileSync(`${dir}/${label}.heapsnapshot`, chunks.join(''))
}
const usage = async () => {
  await cdp.send('HeapProfiler.collectGarbage')
  const h = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  const gl = await page.evaluate(() => { const r = window.__gl; return r ? [r.info.memory.geometries, r.info.memory.textures] : null })
  return `used ${Math.round(h.usedSize / 1e6)} MB backing ${Math.round((h.backingStorageSize ?? 0) / 1e6)} MB nodes ${dom.nodes} gl ${JSON.stringify(gl)}`
}
if (process.env.MEASURE) { console.log('before', await usage()); await snap('before') }
const rounds = process.env.MEASURE ? Math.ceil(Number(n) / 25) : 1
const per = process.env.MEASURE ? 25 : Number(n)
let made = null
for (let round = 0; round < rounds; round++) {
made = await page.evaluate(async (count) => {
  const S = window.__store
  const axes = ['x', 'y', 'z']
  let ok = 0
  for (let i = 0; i < count; i++) {
    const s = S.getState()
    if (s.proof.status === 'computing') { await new Promise((r) => setTimeout(r, 20)); i--; continue }
    const before = s.events.length
    const p = s.position
    const axis = axes[Math.floor(i / 40) % 3]
    const dir = Math.floor(i / 120) % 2 === 0 ? 1n : -1n
    S.setState({ cursor: { ...p, [axis]: p[axis] + dir } })
    await S.getState().commit()
    const t0 = Date.now()
    while (S.getState().events.length === before && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 10))
    if (S.getState().events.length > before) ok++
    else return { ok, stuck: S.getState().proof.message }
  }
  return { ok }
}, per)
if (process.env.MEASURE) console.log('round', round + 1, 'events', await page.evaluate(() => window.__store.getState().events.length), await usage())
}
if (process.env.MEASURE) await snap('after')
console.log('made', JSON.stringify(made), 'events', await page.evaluate(() => window.__store.getState().events.length), 'dropped', dropped)
const storage = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])))
fs.writeFileSync(storageFile, JSON.stringify(storage))
console.log('saved', Object.keys(storage).length, 'keys', Math.round(JSON.stringify(storage).length / 1024), 'KB')
await browser.close()
