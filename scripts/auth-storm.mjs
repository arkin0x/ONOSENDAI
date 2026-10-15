/**
 * auth-storm.mjs: what the page does when every relay demands AUTH and the
 * signer will not give it (2026-10-13, the 13 GB background tab).
 *
 * Every relay is answered in-process: it sends an AUTH challenge, closes any
 * REQ from an unauthenticated socket with CLOSED auth-required AFTER first
 * sending what it holds (as a relay that serves a few events before it
 * decides, or a reissue's overlap, would), and refuses every AUTH. It holds
 * the throwaway identity's own chain (from long-chain.mjs storage), so a
 * live subscription to that chain always has something to deliver. The
 * signer is a NIP-07 stand-in that refuses (EXT=reject, default) or never
 * answers (EXT=hang). Nothing can reach the network.
 *
 * Counts REQs, AUTH challenges answered and closes per sample, with the JS
 * heap, so a reopen storm shows as a REQ rate, not only as memory.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/auth-storm.mjs <url> <chain dir> <out dir> <name> [minutes]
 * Env: HIDDENSIM=1, EXT=reject|hang, SAMPLE=<s> (20), SERVE_FIRST=0 to close
 * without sending anything first.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const [url, chainDir, out, name, minutes = '5'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const SAMPLE = Number(process.env.SAMPLE ?? 20) * 1000
const key = JSON.parse(fs.readFileSync(`${chainDir}/key.json`, 'utf8'))
const storage = JSON.parse(fs.readFileSync(`${chainDir}/storage.json`, 'utf8'))
const chainEntry = Object.entries(storage).find(([k, v]) => k.includes(key.pubkey) && v.startsWith('{') && v.includes('"events"'))
const chain = chainEntry ? JSON.parse(chainEntry[1]).events : []
const until = Date.now() + Number(minutes) * 60_000
const matches = (f, ev) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f.authors || f.authors.includes(ev.pubkey))
  && (!f.ids || f.ids.includes(ev.id)) && (!f.since || ev.created_at >= f.since) && (!f.until || ev.created_at <= f.until)
  && Object.entries(f).filter(([k]) => k.startsWith('#')).every(([k, vals]) => ev.tags.some((t) => t[0] === k.slice(1) && vals.includes(t[1])))
const stats = { sockets: 0, reqs: 0, closedAuth: 0, auths: 0, served: 0, events: 0, eventBytes: 0 }

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 } })
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
await ctx.routeWebSocket(/.*/, (ws) => {
  if (/localhost|127\.0\.0\.1/.test(ws.url())) { ws.connectToServer(); return }
  stats.sockets++
  ws.send(JSON.stringify(['AUTH', Math.random().toString(36).slice(2)]))
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (!Array.isArray(m)) return
    if (m[0] === 'AUTH') { stats.auths++; ws.send(JSON.stringify(['OK', m[1]?.id ?? '', false, 'auth-required: signature rejected'])) }
    else if (m[0] === 'REQ') {
      stats.reqs++
      const [, id, ...filters] = m
      if (process.env.SERVE_FIRST !== '0') {
        for (const ev of chain) if (filters.some((f) => matches(f, ev))) { stats.served++; ws.send(JSON.stringify(['EVENT', id, ev])) }
      }
      stats.closedAuth++
      ws.send(JSON.stringify(['CLOSED', id, 'auth-required: authenticate to read']))
    } else if (m[0] === 'EVENT') { stats.events++; stats.eventBytes += String(raw).length; } if (m[0] === 'EVENT') ws.send(JSON.stringify(['OK', m[1]?.id ?? '', false, 'auth-required: authenticate to write']))
  })
})
const page = await ctx.newPage()
await page.addInitScript(([k, s, ext, live]) => {
  try {
    if (!sessionStorage.getItem('restored')) { for (const [a, b] of Object.entries(s)) localStorage.setItem(a, b); sessionStorage.setItem('restored', '1') }
    // LIVE=1 is only ever set against these in-process relays: the network
    // is refused outright above, so a publish has nowhere real to go.
    localStorage.setItem('onosendai:live', live ? '1' : '0')
    localStorage.setItem('onosendai:signer', JSON.stringify(ext === 'local' ? { kind: 'local', pubkey: k.pubkey, nsec: k.nsec } : { kind: 'nip07', pubkey: k.pubkey }))
    window.__extCalls = 0
    const answer = ext === 'hang' ? () => new Promise(() => {}) : () => Promise.reject(new Error('User rejected'))
    window.nostr = { getPublicKey: async () => k.pubkey, signEvent: () => { window.__extCalls++; return answer() }, nip44: { encrypt: answer, decrypt: answer } }
  } catch {}
}, [key, storage, process.env.EXT ?? 'reject', !!process.env.LIVE])
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(6000)
const st = await page.evaluate(() => ({ live: window.__store.getState().live, me: window.__store.getState().identity.pubkey, events: window.__store.getState().events.length }))
if (st.live !== !!process.env.LIVE || st.me !== key.pubkey) { console.log('ABORT', JSON.stringify(st)); await browser.close(); process.exit(2) }
console.log('identity events', st.events, 'chain served', chain.length)
if (process.env.HIDDENSIM) {
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}
const cdp = await ctx.newCDPSession(page)
if (process.env.ALLOC) {
  // Every allocation for ALLOC seconds, garbage included, by function.
  const seconds = Number(process.env.ALLOC)
  await page.waitForTimeout(30_000)
  await cdp.send('HeapProfiler.enable')
  await cdp.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  await page.waitForTimeout(seconds * 1000)
  const { profile } = await cdp.send('HeapProfiler.stopSampling')
  const by = new Map(); let total = 0
  const walk = (node) => { const f = node.callFrame; const label = `${f.functionName || '(anon)'} ${(f.url || '').replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/').replace(/\?.*$/, '')}:${f.lineNumber + 1}`; total += node.selfSize; by.set(label, (by.get(label) ?? 0) + node.selfSize); for (const c of node.children) walk(c) }
  walk(profile.head)
  console.log(`ALLOC ${name}: ${Math.round(total / 1e6)} MB in ${seconds} s = ${Math.round(total / seconds * 60 / 1e6)} MB/min`)
  for (const [k, v] of [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`  ${String(Math.round(v / 1e5) / 10).padStart(8)} MB  ${k}`)
}
const t0 = Date.now()
let last = { ...stats }
while (Date.now() < until) {
  const heap = await cdp.send('Runtime.getHeapUsage')
  const extra = await page.evaluate(() => ({ ext: window.__extCalls, live: window.__live?.list?.().map((l) => [l.reopens, l.attempts, l.events]) ?? null }))
  const t = Math.round((Date.now() - t0) / 1000)
  const d = Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v - last[k]]))
  last = { ...stats }
  const row = { t, used: heap.usedSize, backing: heap.backingStorageSize, delta: d, total: { ...stats }, ...extra }
  fs.appendFileSync(`${out}/${name}.jsonl`, JSON.stringify(row) + '\n')
  console.log(name, t, 'used', Math.round(heap.usedSize / 1e6), 'MB', 'per sample', JSON.stringify(d), 'ext calls', extra.ext, 'live [reopens,attempts,events]', JSON.stringify(extra.live))
  await new Promise((r) => setTimeout(r, SAMPLE))
}
console.log('done', name, JSON.stringify(stats), 'errors', [...new Set(errors)].slice(0, 5))
await browser.close()
