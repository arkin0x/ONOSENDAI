/**
 * smoke-lib.mjs: the browser, the offline relay and the publish guard shared
 * by scripts/smoke.mjs (2026-10-16).
 *
 * Every WebSocket is answered by one in-process relay that keeps what it is
 * sent in memory: nothing reaches a real relay, ever. HTTP GETs to other
 * origins are allowed (header blobs for the hyperspace line); anything else
 * to another origin is aborted. A throwaway local key signs; LOCAL is set
 * before the app loads.
 */
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19, matchFilter } from 'nostr-tools'

export async function launch({ phone, url, sk = generateSecretKey(), seed = [] }) {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
  // Layout is in CSS pixels, so the device pixel ratio changes only how many
  // pixels the software renderer (SwiftShader) has to fill: at the real
  // 2.625 a phone frame takes about two seconds here, and screenshots wait
  // for frames. SMOKE_DPR=1 (the default) keeps the run usable; set it to
  // 2.625 / 1.25 for true-resolution screenshots.
  const dpr = Number(process.env.SMOKE_DPR ?? 1)
  const ctx = await browser.newContext(phone
    ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: process.env.SMOKE_DPR ? dpr : 1, isMobile: true, hasTouch: true }
    : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: process.env.SMOKE_DPR ? dpr : 1 })
  const stats = { sockets: 0, events: 0, auths: 0, nonGetAborted: 0, leaked: 0, kinds: {} }
  const store = [...seed]
  const subs = new Set()
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => {
    if (r.request().method() === 'GET') return r.continue()
    stats.nonGetAborted++; return r.abort()
  })
  await ctx.routeWebSocket(/.*/, (ws) => {
    if (/^wss?:\/\/(localhost|127\.0\.0\.1)/.test(ws.url())) { ws.connectToServer(); return }
    stats.sockets++
    const mine = new Map()
    ws.onClose(() => { for (const s of mine.values()) subs.delete(s) })
    ws.onMessage((raw) => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      if (m[0] === 'REQ') {
        const [, id, ...filters] = m
        for (const f of filters) for (const ev of store.filter((e) => matchFilter(f, e)).slice(0, f.limit ?? 500)) ws.send(JSON.stringify(['EVENT', id, ev]))
        ws.send(JSON.stringify(['EOSE', id]))
        const s = { ws, id, filters }; mine.set(id, s); subs.add(s)
      } else if (m[0] === 'CLOSE') { const s = mine.get(m[1]); if (s) { subs.delete(s); mine.delete(m[1]) } }
      else if (m[0] === 'EVENT') {
        stats.events++
        const ev = m[1]; store.push(ev)
        stats.kinds[ev.kind] = (stats.kinds[ev.kind] ?? 0) + 1
        ws.send(JSON.stringify(['OK', ev.id, true, '']))
        for (const s of subs) if (s.filters.some((f) => matchFilter(f, ev))) s.ws.send(JSON.stringify(['EVENT', s.id, ev]))
      } else if (m[0] === 'AUTH') { stats.auths++; ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }
      else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
    })
  })
  const page = await ctx.newPage()
  const pk = getPublicKey(sk)
  await page.addInitScript(([pk, ns]) => {
    try {
      localStorage.setItem('onosendai:live', '0')
      localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
    } catch {}
  }, [pk, nip19.nsecEncode(sk)])
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`) })
  return { browser, ctx, page, stats, errors, pk, sk, store }
}
