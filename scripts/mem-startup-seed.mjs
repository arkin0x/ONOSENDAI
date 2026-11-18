/**
 * mem-startup-seed.mjs: build a local world that looks like a heavy returning
 * player's, for mem-startup.mjs to open again and again (2026-11-18).
 *
 * arkinox, 2026-11-19: "been in for 30 seconds and already at 7GB ... It
 * loaded the app at my avatar which is surrounded by a lot of shards." His
 * chain is over ten thousand actions, his spot has about 135 shards around
 * it, and his storage is full.
 *
 * In one persistent browser profile (so IndexedDB and localStorage stay):
 * a throwaway key, LIVE against an in-process relay only, commits CHAIN hops
 * (each proved and signed here), imports the given zips into the workshop
 * (PUBLISH off), then hides HIDES of the biggest pieces in a grid around the
 * spot it ends on. What the relay was sent is written to <dir>/relay.jsonl,
 * which mem-startup.mjs serves back from its own in-process relay.
 *
 * Nothing leaves the machine: every WebSocket is answered here, and every
 * HTTP request to another origin is aborted.
 *
 * Usage: node scripts/mem-startup-seed.mjs <url> <dir> [zip...]
 * Env: CHAIN (2000), HIDES (120), MINUTES (18, a hard stop).
 */
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19, matchFilter } from 'nostr-tools'

const [base, dir, ...zips] = process.argv.slice(2)
if (!base || !dir) { console.log('usage: mem-startup-seed.mjs <url> <dir> [zip...]'); process.exit(1) }
fs.mkdirSync(dir, { recursive: true })
const CHAIN = Number(process.env.CHAIN ?? 2000)
const HIDES = Number(process.env.HIDES ?? 120)
const DEADLINE = Date.now() + Number(process.env.MINUTES ?? 18) * 60_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const keyFile = path.join(dir, 'key.json')
if (!fs.existsSync(keyFile)) {
  const sk = generateSecretKey()
  fs.writeFileSync(keyFile, JSON.stringify({ pubkey: getPublicKey(sk), nsec: nip19.nsecEncode(sk) }), { mode: 0o600 })
}
const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'))
const relayFile = path.join(dir, 'relay.jsonl')
const kept = fs.existsSync(relayFile) ? fs.readFileSync(relayFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
const ids = new Set(kept.map((e) => e.id))

const ctx = await chromium.launchPersistentContext(path.join(dir, 'profile'), {
  viewport: { width: 1280, height: 800 },
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--js-flags=--max-old-space-size=4096'],
})
// What the relay holds is written whatever ends the run, so the next run serves it.
const save = () => fs.writeFileSync(relayFile, kept.map((e) => JSON.stringify(e)).join('\n') + '\n')
process.on('exit', save)
const shutdown = async (code) => {
  try { await ctx.close() } catch {}
  process.exit(code)
}
process.on('SIGTERM', () => void shutdown(143))
process.on('SIGINT', () => void shutdown(130))

const subs = new Set()
const LOCAL = /^(https?|wss?):\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/
await ctx.route((u) => !LOCAL.test(u.toString()), (r) => r.abort())
await ctx.routeWebSocket(/.*/, (ws) => {
  if (LOCAL.test(ws.url())) { ws.connectToServer(); return }
  const mine = new Map()
  ws.onClose(() => { for (const s of mine.values()) subs.delete(s) })
  ws.onMessage((raw) => {
    let m; try { m = JSON.parse(String(raw)) } catch { return }
    if (m[0] === 'REQ') {
      const [, id, ...filters] = m
      for (const f of filters) for (const ev of kept.filter((e) => matchFilter(f, e)).slice(-(f.limit ?? 500))) ws.send(JSON.stringify(['EVENT', id, ev]))
      ws.send(JSON.stringify(['EOSE', id]))
      const s = { ws, id, filters }; mine.set(id, s); subs.add(s)
    } else if (m[0] === 'CLOSE') { const s = mine.get(m[1]); if (s) { subs.delete(s); mine.delete(m[1]) } }
    else if (m[0] === 'EVENT') {
      if (!ids.has(m[1].id)) { ids.add(m[1].id); kept.push(m[1]) }
      ws.send(JSON.stringify(['OK', m[1].id, true, '']))
      for (const s of subs) if (s.filters.some((f) => matchFilter(f, m[1]))) s.ws.send(JSON.stringify(['EVENT', s.id, m[1]]))
    } else if (m[0] === 'AUTH') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
    else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
  })
})
const page = ctx.pages()[0] ?? await ctx.newPage()
page.on('pageerror', (e) => log('pageerror', e.message.slice(0, 200)))
await page.addInitScript(([pk, ns]) => {
  try {
    localStorage.setItem('onosendai:live', '1')
    localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
    localStorage.setItem('onosendai:tutorial', 'off')
  } catch {}
}, [key.pubkey, key.nsec])
const mod = (p, expr) => page.evaluate(async ([p, expr]) => { const m = await import(p); return await (0, eval)(`(async (m) => ${expr})`)(m) }, [p, expr])

await page.goto(base, { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 120 && !(await page.evaluate(() => !!window.__store).catch(() => false)); i++) await sleep(1000)
await sleep(6000)
const st = await page.evaluate(() => ({ live: window.__store.getState().live, me: window.__store.getState().identity.pubkey, events: window.__store.getState().events.length }))
if (st.live !== true || st.me !== key.pubkey) { log('ABORT', JSON.stringify(st)); await shutdown(2) }
// Anything this profile signed that the relay file missed (a run that ended early) goes in first.
for (const e of await page.evaluate(() => window.__store.getState().events)) if (!ids.has(e.id)) { ids.add(e.id); kept.push(e) }
log('start', JSON.stringify(st), 'relay holds', kept.length)

// The chain: one-gibson hops in a square walk, as long-chain.mjs makes them.
const want = CHAIN - st.events
for (let done = 0; done < want && Date.now() < DEADLINE;) {
  const n = Math.min(250, want - done)
  const r = await page.evaluate(async (count) => {
    const S = window.__store
    const axes = ['x', 'z']
    let ok = 0
    for (let i = 0; i < count; i++) {
      const s = S.getState()
      if (s.proof.status === 'computing') { await new Promise((r) => setTimeout(r, 10)); i--; continue }
      const before = s.events.length
      const p = s.position
      const k = before + i
      const axis = axes[Math.floor(k / 20) % 2]
      const dir = Math.floor(k / 40) % 2 === 0 ? 1n : -1n
      S.setState({ cursor: { ...p, [axis]: p[axis] + dir } })
      await S.getState().commit()
      const t0 = Date.now()
      while (S.getState().events.length === before && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 5))
      if (S.getState().events.length > before) ok++
      else return { ok, stuck: S.getState().proof.message }
    }
    return { ok }
  }, n)
  done += r.ok
  log('chain', JSON.stringify(r), 'events', await page.evaluate(() => window.__store.getState().events.length))
  if (r.stuck !== undefined) break
}

// The workshop: the zips, PUBLISH off.
let pieceIds = []
for (const zip of zips) {
  const b64 = fs.readFileSync(zip).toString('base64')
  const r = await page.evaluate(async ([b64, name]) => {
    const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
    const file = new File([u], name, { type: 'application/zip' })
    const { useWorkshop } = await import('/src/store/useWorkshop.ts')
    const { useShardImport } = await import('/src/store/useShardImport.ts')
    useWorkshop.getState().openWorkshop()
    await useShardImport.getState().openZip(file)
    for (let i = 0; i < 600 && useShardImport.getState().phase !== 'review'; i++) await new Promise((r) => setTimeout(r, 200))
    useShardImport.getState().setPublish(false)
    useShardImport.getState().setDupMode('skip')
    await useShardImport.getState().start()
    for (let i = 0; i < 1500 && useShardImport.getState().phase === 'running'; i++) await new Promise((r) => setTimeout(r, 200))
    const s = useShardImport.getState()
    const out = { phase: s.phase, ids: s.rows.map((r) => r.shardId).filter(Boolean) }
    useShardImport.getState().close()
    useWorkshop.getState().closeWorkshop()
    return out
  }, [b64, 'import.zip'])
  pieceIds.push(...r.ids)
  log('import', r.phase, r.ids.length)
}

// The hides: the biggest pieces, in a grid of 6-gibson cells around the spot.
const waitDeploy = async () => {
  for (let i = 0; i < 240; i++) {
    const s = await mod('/src/store/useShards.ts', '(() => { const s = m.useShards.getState(); return { status: s.deployStatus, error: s.deployError, ask: !!s.deployAsk } })()')
    if (s.ask) await mod('/src/store/useShards.ts', 'm.useShards.getState().confirmDeploy()')
    if (s.status !== 'working' && i > 1) return s
    await sleep(250)
  }
  return { status: 'timeout' }
}
const already = await mod('/src/store/useShards.ts', 'm.useShards.getState().mine.length')
const order = await mod('/src/store/useWorkshop.ts', `(() => { const ids = new Set(${JSON.stringify(pieceIds)}); return m.useWorkshop.getState().shards.filter((s) => ids.has(s.id)).sort((a, b) => b.faces.length - a.faces.length).map((s) => s.id) })()`)
if (order.length) {
  await mod('/src/store/useBuilder.ts', "m.useBuilder.getState().enter('build')")
  await sleep(800)
  const home = await page.evaluate(() => { const p = window.__store.getState().position; return { x: String(p.x), y: String(p.y), z: String(p.z) } })
  let hid = 0, errors = []
  for (let i = already; i < HIDES && Date.now() < DEADLINE; i++) {
    const id = order[i % order.length]
    await mod('/src/store/useShards.ts', `m.useShards.getState().startDeployShard(${JSON.stringify(id)})`)
    await mod('/src/store/useShards.ts', 'm.useShards.getState().setDeployHeight(0)')
    const side = 11
    await page.evaluate(([h, i, side]) => { const S = window.__store; const p = S.getState().cursor; S.setState({ cursor: { ...p, x: BigInt(h.x) + BigInt(((i % side) - 5) * 6), y: BigInt(h.y), z: BigInt(h.z) + BigInt((Math.floor(i / side) - 5) * 6) } }) }, [home, i, side])
    await sleep(200)
    await mod('/src/store/useShards.ts', 'm.useShards.getState().deploy()')
    const r = await waitDeploy()
    if (r.status === 'error' || r.status === 'timeout') errors.push(r.error ?? r.status)
    else hid++
    await mod('/src/store/useShards.ts', 'm.useShards.getState().pending && m.useShards.getState().cancelDeploy()')
    if (i % 10 === 0) log('hides', i, 'ok', hid, 'errors', errors.length, errors.at(-1) ?? '')
  }
  await mod('/src/store/padMode.ts', 'm.buildToHop()')
  log('hid', hid, 'errors', JSON.stringify(errors.slice(0, 5)))
}
await sleep(4000)
const ls = await page.evaluate(() => { let c = 0; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); c += k.length + localStorage.getItem(k).length } return { keys: localStorage.length, chars: c } })
log('done', JSON.stringify(ls), 'relay events', kept.length)
await shutdown(0)
