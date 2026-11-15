/**
 * hides-sync-proof.mjs: two devices, one generated test key, one in-process
 * relay (owner ruling, 2026-11-15: your hidden things on every device signed
 * in as you). Device A hides two shards; device B, which has never been to
 * those places, lists both and opens one. Every WebSocket is answered by the
 * fake relay here and every other non-localhost request is aborted: nothing
 * reaches a real relay.
 *
 *   node scripts/hides-sync-proof.mjs http://localhost:5237 /path/to/out
 */
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19, matchFilter } from 'nostr-tools'
import path from 'node:path'
import fs from 'node:fs'

const url = process.argv[2] ?? 'http://localhost:5237'
const out = process.argv[3] ?? '/tmp/hides-sync-proof'
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sk = generateSecretKey()
const pk = getPublicKey(sk)
const nsec = nip19.nsecEncode(sk)

// One relay for both devices: the newest of each replaceable or addressable event, as strfry keeps it.
const store = []
const subs = new Set()
const stats = { aborted: 0, events: {}, sockets: 0 }
function keep(ev) {
  const addressable = ev.kind >= 30000 && ev.kind < 40000
  const replaceable = ev.kind === 0 || ev.kind === 3 || (ev.kind >= 10000 && ev.kind < 20000)
  if (addressable || replaceable) {
    const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? ''
    const i = store.findIndex((e) => e.pubkey === ev.pubkey && e.kind === ev.kind && (!addressable || (e.tags.find((t) => t[0] === 'd')?.[1] ?? '') === d))
    if (i >= 0 && store[i].created_at > ev.created_at) return
    if (i >= 0) store.splice(i, 1)
  }
  store.push(ev)
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u.toString()), (r) => { stats.aborted++; return r.abort() })
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
        const ev = m[1]
        stats.events[ev.kind] = (stats.events[ev.kind] ?? 0) + 1
        keep(ev)
        ws.send(JSON.stringify(['OK', ev.id, true, '']))
        for (const s of subs) if (s.filters.some((f) => matchFilter(f, ev))) s.ws.send(JSON.stringify(['EVENT', s.id, ev]))
      } else if (m[0] === 'AUTH') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
      else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
    })
  })
  const page = await ctx.newPage()
  await page.addInitScript(([pk, ns]) => {
    try {
      localStorage.setItem('onosendai:live', '1')
      localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
    } catch {}
  }, [pk, nsec])
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  const mod = (p, fn, arg) => page.evaluate(async ([p, fn, arg]) => { const m = await import(p); return (0, eval)(fn)(m, arg) }, [p, fn, arg])
  const shot = (n) => page.screenshot({ path: path.join(out, `${name}-${n}.png`), timeout: 120_000 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__store && !!window.__shards, null, { timeout: 60_000 })
  await sleep(6000)
  return { ctx, page, mod, shot, errors, name }
}

async function waitFor(fn, ms, every = 500) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(every) } return false }
const mineCount = (d) => d.page.evaluate(() => window.__shards.getState().mine.length)
const openMenu = async (d) => { if (!await d.page.locator('.panel--shards').count()) { await d.page.locator('.hamburger-menu').click(); await sleep(900) } }

// ---- device A: hide two shards, at two heights (two bags) ----
const A = await device('A')
console.log('A live:', await A.page.evaluate(() => window.__store.getState().live), 'pubkey', pk.slice(0, 12))
for (const [name, height] of [['Red pyramid', 3], ['Blue pyramid', 5]]) {
  const before = await mineCount(A)
  const err = await A.mod('/src/store/useWorkshop.ts', `async (m, [name, height]) => {
    const w = m.useWorkshop.getState()
    const id = w.create(name)
    const c = name.startsWith('Red') ? [255, 60, 60] : [60, 120, 255]
    const shards = m.useWorkshop.getState().shards.map((s) => s.id === id ? { ...s, vertices: [{ p: [0, 0, 0], c }, { p: [4, 0, 0], c }, { p: [0, 4, 0], c }, { p: [0, 0, 4], c }], faces: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] } : s)
    m.useWorkshop.setState({ shards })
    const sh = (await import('/src/store/useShards.ts')).useShards
    sh.getState().startDeployShard(id)
    sh.getState().setDeployHeight(height)
    await sh.getState().deploy()
    return sh.getState().deployError
  }`, [name, height])
  const ok = await waitFor(async () => (await mineCount(A)) > before, 90_000)
  console.log(`A hid ${name} at height ${height}:`, ok, err ?? '')
}
await A.page.evaluate(() => window.__shards.getState().cancelDeploy?.())
const synced = await waitFor(async () => store.some((e) => e.kind === 30078 && e.pubkey === pk), 30_000)
const rec = store.filter((e) => e.kind === 30078)
console.log('A wrote the record:', synced, rec.map((e) => `${e.tags.find((t) => t[0] === 'd')[1]} ${JSON.stringify(e).length} B`))
const secrets = await A.page.evaluate(() => window.__shards.getState().mine.flatMap((d) => [d.lookupId, d.keyHex, d.shard?.name ?? '']))
console.log('A record leaks no lookup id, key or name:', rec.every((e) => secrets.every((x) => !x || !JSON.stringify(e).includes(x))))
await openMenu(A)
await A.page.locator('.panel--shards').first().scrollIntoViewIfNeeded()
await A.shot('1-create-panel-two-bags')
const errorsA = A.errors.slice(0, 5)
// Device A is done: closed, so its software-rendered scene stops taking the CPU from B's.
await A.ctx.close()

// ---- device B: never been there ----
const B = await device('B')
const before = await mineCount(B)
console.log('B list on load:', before)
const adopted = await waitFor(async () => (await mineCount(B)) >= 2, 60_000)
console.log('B adopted both:', adopted, await mineCount(B), await B.page.evaluate(() => window.__shards.getState().mine.map((d) => `${d.shard?.name} h${d.height} ${d.published ? 'LIVE' : 'LOCAL'}`)))
await openMenu(B)
await B.page.locator('.panel--shards').first().scrollIntoViewIfNeeded()
await B.shot('2-create-panel-shows-As-two-bags')
await B.page.locator('button', { hasText: 'VIEW ALL STASHED BAGS' }).first().click()
await sleep(1000)
await B.shot('3-stashed-bags-modal')
await B.page.locator('.stash-modal .shards__goto').first().dispatchEvent('click')
await sleep(1000)
await B.shot('4-bag-contents')
await B.page.locator('.stash-modal .shards__goto').first().dispatchEvent('click')
await sleep(4000)
const selected = await B.page.evaluate(() => window.__shards.getState().selectedSecret)
console.log('B opened an item:', !!selected)
await B.shot('5-viewed-item-modal')
// The same bag from DISCOVERED BAGS: its record, and VIEW on the item.
await B.page.keyboard.press('Escape'); await sleep(800)
await openMenu(B)
const disc = B.page.locator('.loot__open').first()
if (await disc.count()) {
  await disc.dispatchEvent('click'); await sleep(1500)
  await B.shot('6-bag-record-with-VIEW')
  const view = B.page.locator('.lootd__view', { hasText: 'VIEW' }).first()
  if (await view.count()) { await view.dispatchEvent('click'); await sleep(4000); await B.shot('7-after-VIEW') }
}

console.log('relay events by kind:', JSON.stringify(stats.events), 'aborted non-localhost requests:', stats.aborted)
console.log('errors A:', errorsA, 'errors B:', B.errors.slice(0, 5))
await browser.close()
