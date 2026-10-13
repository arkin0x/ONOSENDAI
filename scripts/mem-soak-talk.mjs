/**
 * mem-soak-talk.mjs: the TALK modal open on an agent, for a long time
 * (2026-10-13, arkinox's 13 GB tab: TALK with XOR open, in the background
 * for 15 minutes).
 *
 * Nobody real is involved. A throwaway key is made here and handed to the
 * page as its local signer; a throwaway agent names it as operator and is
 * followed by it; its kind 10050 names one DM inbox, wss://fake-inbox.test,
 * which is served in-process and behaves like wheat.oslim.dev: it sends an
 * AUTH challenge, refuses a kind 1059 read with CLOSED auth-required until
 * the page authenticates, then serves real NIP-17 wraps (nostr-tools nip59)
 * from the agent to the throwaway key, and a new one every WRAP_EVERY
 * seconds. AUTHFAIL=1 makes the inbox refuse every AUTH, as an extension
 * signer failing AUTH would leave it.
 *
 * Every other relay is the real one, reads only: a REQ for the throwaway
 * key's own profile, follows or inbox list, or for the agent's profile, is
 * answered here with the fakes; everything else passes, and every EVENT or
 * AUTH frame bound for a real relay is dropped and counted. Non-GET HTTP to
 * anything but localhost is refused. LOCAL is set before the page loads.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=/data/claude/ms-playwright \
 *   node scripts/mem-soak-talk.mjs <url> <out dir> <name> [minutes]
 * Env: HEADED=1 (run under xvfb-run: a background tab is really hidden
 * only in a headed browser), HIDDEN=1 (a second tab in front), AUTHFAIL=1, SAMPLE=<s> (30),
 * WRAP_EVERY=<s> (30), SNAPSHOTS=1.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { wrapEvent } from 'nostr-tools/nip59'
import { nip19 } from 'nostr-tools'

const [url, out, name, minutes = '20'] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const SAMPLE = Number(process.env.SAMPLE ?? 30) * 1000
const WRAP_EVERY = Number(process.env.WRAP_EVERY ?? 30) * 1000
const INBOX = 'wss://fake-inbox.test/'
const until = Date.now() + Number(minutes) * 60_000
const now = () => Math.floor(Date.now() / 1000)

const meSk = generateSecretKey(); const me = getPublicKey(meSk)
const agentSk = generateSecretKey(); const agent = getPublicKey(agentSk)
const fakes = [
  finalizeEvent({ kind: 10050, created_at: now() - 3600, tags: [['relay', INBOX]], content: '' }, meSk),
  finalizeEvent({ kind: 10050, created_at: now() - 3600, tags: [['relay', INBOX]], content: '' }, agentSk),
  finalizeEvent({ kind: 3, created_at: now() - 3600, tags: [['p', agent]], content: '' }, meSk),
  finalizeEvent({ kind: 0, created_at: now() - 3600, tags: [['p', me, '', 'operator']], content: JSON.stringify({ name: 'SOAK', bot: true }) }, agentSk),
  finalizeEvent({ kind: 0, created_at: now() - 3600, tags: [], content: JSON.stringify({ name: 'soak operator' }) }, meSk),
]
const matches = (f, ev) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f.authors || f.authors.includes(ev.pubkey))
  && (!f['#p'] || ev.tags.some((t) => t[0] === 'p' && f['#p'].includes(t[1]))) && (!f.ids || f.ids.includes(ev.id))
  && (!f.since || ev.created_at >= f.since)
// Only REQs that are about the throwaway pair are answered here.
const aboutUs = (f) => (f.authors && f.authors.some((a) => a === me || a === agent)) || (f['#p'] && f['#p'].includes(me) && f.kinds && f.kinds.includes(0))

let n = 0
const wrapMsg = () => {
  n++
  const text = `soak message ${n}: ` + 'the quick brown fox jumps over the lazy dog. '.repeat(1 + (n % 5))
  return wrapEvent({ kind: 14, created_at: now(), tags: [['p', me]], content: text }, agentSk, me)
}
const inboxStore = []
for (let i = 0; i < 60; i++) inboxStore.push(wrapMsg())

const stats = { sockets: 0, realSockets: 0, inboxSockets: 0, inboxReqs: 0, inboxAuths: 0, inboxCloses: 0, inboxClosedByServer: 0, droppedEVENT: 0, droppedAUTH: 0, fakeAnswered: 0 }
const inboxSubs = new Set()

const browser = await chromium.launch({ headless: !process.env.HEADED, args: ['--enable-precise-memory-info', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const ctx = await browser.newContext({ viewport: { width: 1200, height: 860 } })
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
await ctx.routeWebSocket(/.*/, (ws) => {
  const u = ws.url()
  if (/localhost|127\.0\.0\.1/.test(u)) { ws.connectToServer(); return }
  stats.sockets++
  if (u.replace(/\/?$/, '/') === INBOX) {
    stats.inboxSockets++
    let authed = false
    const challenge = Math.random().toString(36).slice(2)
    const mine = new Map()
    ws.send(JSON.stringify(['AUTH', challenge]))
    ws.onClose(() => { for (const s of mine.values()) inboxSubs.delete(s) })
    ws.onMessage((raw) => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      if (m[0] === 'AUTH') {
        stats.inboxAuths++
        if (process.env.AUTHFAIL) ws.send(JSON.stringify(['OK', m[1].id, false, 'auth-required: signature rejected']))
        else { authed = true; ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }
      } else if (m[0] === 'REQ') {
        stats.inboxReqs++
        const [, id, ...filters] = m
        if (!authed) { ws.send(JSON.stringify(['CLOSED', id, 'auth-required: this relay serves DMs only to their recipient'])); return }
        for (const f of filters) {
          const hits = inboxStore.filter((ev) => matches(f, ev)).sort((a, b) => b.created_at - a.created_at).slice(0, f.limit ?? 500)
          for (const ev of hits) ws.send(JSON.stringify(['EVENT', id, ev]))
        }
        ws.send(JSON.stringify(['EOSE', id]))
        const sub = { ws, id, filters }
        mine.set(id, sub); inboxSubs.add(sub)
      } else if (m[0] === 'CLOSE') {
        stats.inboxCloses++
        const s = mine.get(m[1]); if (s) { inboxSubs.delete(s); mine.delete(m[1]) }
      } else if (m[0] === 'EVENT') {
        ws.send(JSON.stringify(['OK', m[1].id, false, 'blocked: soak']))
      }
    })
    return
  }
  stats.realSockets++
  const server = ws.connectToServer()
  ws.onMessage((raw) => {
    let m = null
    try { m = JSON.parse(String(raw)) } catch { /* pass */ }
    if (Array.isArray(m) && m[0] === 'EVENT') { stats.droppedEVENT++; return }
    if (Array.isArray(m) && m[0] === 'AUTH') { stats.droppedAUTH++; return }
    if (Array.isArray(m) && m[0] === 'REQ' && m.slice(2).some(aboutUs)) {
      stats.fakeAnswered++
      const [, id, ...filters] = m
      for (const ev of fakes) if (filters.some((f) => matches(f, ev))) ws.send(JSON.stringify(['EVENT', id, ev]))
      ws.send(JSON.stringify(['EOSE', id]))
      return
    }
    server.send(raw)
  })
})

const page = await ctx.newPage()
const nsec = nip19.nsecEncode(meSk)
await page.addInitScript(([pk, ns, ext]) => {
  try {
    localStorage.setItem('onosendai:live', '0')
    if (!ext) localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
    else {
      // EXT=hang|reject: a NIP-07 extension for the throwaway key whose
      // signatures never come back (a prompt nobody can see in a background
      // tab) or are refused. It can never sign anything.
      localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'nip07', pubkey: pk }))
      window.__extCalls = { sign: 0, decrypt: 0 }
      const never = () => new Promise(() => {})
      const fail = () => Promise.reject(new Error('User rejected'))
      const answer = ext === 'hang' ? never : fail
      window.nostr = {
        getPublicKey: async () => pk,
        signEvent: () => { window.__extCalls.sign++; return answer() },
        nip44: { encrypt: () => answer(), decrypt: () => { window.__extCalls.decrypt++; return answer() } },
      }
    }
  } catch {}
}, [me, nsec, process.env.EXT ?? ''])
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
await page.goto(url, { waitUntil: 'load' })
await page.waitForTimeout(8000)
const st = await page.evaluate(() => ({ live: window.__store.getState().live, me: window.__store.getState().identity.pubkey }))
if (st.live !== false || st.me !== me) { console.log('ABORT', JSON.stringify(st), me); await browser.close(); process.exit(2) }
// Open TALK on the agent through the store, as its row's TALK does (not with NOTALK=1).
if (!process.env.NOTALK) await page.evaluate(async (a) => { const m = await import('/src/store/useAgentDms.ts'); m.setTalking(a) }, agent)
await page.waitForTimeout(5000)
console.log('talk open:', await page.locator('.talk, [aria-label*="onversation"]').count(), 'agents', await page.evaluate(async () => (await import('/src/hooks/useMyAgents.ts')).useMyAgentsAnswer.getState().agents.length))

const cdp = await ctx.newCDPSession(page)
await cdp.send('Performance.enable')
if (process.env.HIDDENSIM) {
  // A background tab without a window manager: no frames at all, and the
  // document says it is hidden.
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
}
if (process.env.HIDDEN) {
  // Minimized, the page is hidden for real in a headed browser: rAF stops
  // and timers are throttled as in a background tab.
  const { windowId } = await cdp.send('Browser.getWindowForTarget')
  await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
  await page.waitForTimeout(1500)
}
console.log('visibility', await page.evaluate(() => document.visibilityState))

const pusher = setInterval(() => {
  const w = wrapMsg(); inboxStore.push(w)
  for (const s of inboxSubs) if (s.filters.some((f) => matches({ ...f, since: undefined }, w))) { try { s.ws.send(JSON.stringify(['EVENT', s.id, w])) } catch {} }
}, WRAP_EVERY)

const snapshot = async (label) => {
  if (!process.env.SNAPSHOTS) return
  const chunks = []
  const h = (p) => chunks.push(p.chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', h)
  await cdp.send('HeapProfiler.collectGarbage')
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', h)
  fs.writeFileSync(`${out}/${name}-${label}.heapsnapshot`, chunks.join(''))
}

const t0 = Date.now()
await snapshot('start')
while (Date.now() < until) {
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  const extra = await page.evaluate(async () => {
    const m = await import('/src/store/useAgentDms.ts')
    const s = m.useAgentDms.getState()
    const r = window.__gl
    return {
      msgs: Object.values(s.messages).reduce((a, l) => a + l.length, 0),
      reading: s.reading,
      gl: r ? { g: r.info.memory.geometries, t: r.info.memory.textures, p: r.info.programs?.length } : null,
      vis: document.visibilityState,
      ext: window.__extCalls ?? null,
    }
  })
  const row = { t: Math.round((Date.now() - t0) / 1000), used: heap.usedSize, backing: heap.backingStorageSize, embedder: heap.embedderHeapUsedSize, nodes: dom.nodes, listeners: dom.jsEventListeners, ...extra, stats: { ...stats }, inboxSubs: inboxSubs.size }
  fs.appendFileSync(`${out}/${name}.jsonl`, JSON.stringify(row) + '\n')
  console.log(name, row.t, 'used', Math.round(row.used / 1e6), 'MB backing', Math.round((row.backing ?? 0) / 1e6), 'nodes', row.nodes, 'lis', row.listeners, 'msgs', row.msgs, row.reading, 'vis', row.vis, 'subs', row.inboxSubs, 'ext', JSON.stringify(row.ext), JSON.stringify(stats))
  await new Promise((r) => setTimeout(r, SAMPLE))
}
await snapshot('end')
clearInterval(pusher)
console.log('done', name, JSON.stringify(stats), 'errors', errors.slice(0, 5))
await browser.close()
