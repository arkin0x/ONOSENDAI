/**
 * chain-sync-two-device.mjs: one identity on two devices, one in-process
 * relay (owner, 2026-11-21: "when I go to my tablet and refresh, it doesn't
 * immediately get the movement chain events I did on my phone. I'm afraid to
 * move because I dont want to fork my chain").
 *
 * A throwaway key, two browser contexts (the PHONE and the TABLET, each with
 * its own storage), and a fake relay here that keeps every event and answers
 * newest first, at most 500 events per REQ (as the canonical relay's
 * nostrdb does). Every WebSocket is answered by it and every other
 * non-localhost request is aborted: nothing reaches a real relay.
 *
 * | Case | What is checked |
 * |---|---|
 * | reload | the tablet has an older copy of the chain; the phone moved since; the tablet reloads and reaches the phone's head with no move |
 * | live | the tablet stays open; the phone moves; the tablet follows within seconds |
 * | press during sync | the tablet reloads and a move is pressed at once; it lands on the true head, never on the stale one |
 * | unreachable | the tablet reloads with the relay silent; it says so and signs nothing |
 * | gap458, gap600 | the tablet reloads after 458, then 600, moves made elsewhere: more than one page of the relay's answer (CAP) |
 * | kept | moves kept on the phone while LOCAL wait, after a reload on LIVE, for a move there; the chip says so; that move sends them all |
 * | blip | a move signed while LIVE whose send was lost goes out after a reload, with no action |
 * | drain | the owner's case: moves signed while LOCAL, published one at a time later, the tablet reloading partway; it gets them all without another reload |
 * | standing | an open, caught-up tablet's move asks the relay nothing before it is signed: the head check reads the standing subscription (owner's ruling of 2026-11-22) |
 * | stall | the tablet's socket goes silent (no frames, nothing answered) while the phone moves on; a move pressed on the tablet is never signed on the stale head |
 * | race | both devices press a move at the same moment; whatever lands, neither device signs on top of a fork afterwards; with no fork each is on the relay head or holds its move behind the diverged-branch prompt |
 *
 *   node scripts/chain-sync-two-device.mjs http://localhost:5287 /path/to/out
 */
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19, matchFilter } from 'nostr-tools'
import fs from 'node:fs'

const url = process.argv[2] ?? 'http://localhost:5287'
const out = process.argv[3] ?? '/tmp/chain-sync-two-device'
const CAP = Number(process.env.CAP ?? 500)
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
fs.mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sk = generateSecretKey()
const pk = getPublicKey(sk)
const nsec = nip19.nsecEncode(sk)

// ---- the relay ----
const store = []
const subs = new Set()
const relay = { silent: new Set(), reqs: {}, dropEvents: new Set() }
function answer(filters) {
  // The union of the filters, newest first, capped as a whole (nostrdb).
  const hit = store.filter((e) => filters.some((f) => matchFilter(f, e)))
  hit.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))
  const limit = Math.min(CAP, ...filters.map((f) => f.limit ?? Infinity))
  return hit.slice(0, limit)
}

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const results = []
const ok = (name, pass, detail = '') => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`) }

async function device(name) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true })
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u.toString()), (r) => r.abort())
  await ctx.routeWebSocket(/.*/, (ws) => {
    if (/^wss?:\/\/(localhost|127\.0\.0\.1)/.test(ws.url())) { ws.connectToServer(); return }
    const mine = new Map()
    ws.onClose(() => { for (const s of mine.values()) subs.delete(s) })
    ws.onMessage((raw) => {
      if (relay.silent.has(name)) return
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      if (m[0] === 'REQ') {
        const [, id, ...filters] = m
        if (filters.some((f) => f.authors?.includes(pk) && f.kinds?.includes(3333))) relay.reqs[name] = (relay.reqs[name] ?? 0) + 1
        if (process.env.TRACE && name === 'tablet') console.log('REQ', Date.now() % 100000, ws.url(), JSON.stringify(filters).slice(0, 160))
        for (const ev of answer(filters)) ws.send(JSON.stringify(['EVENT', id, ev]))
        ws.send(JSON.stringify(['EOSE', id]))
        const s = { ws, id, filters, name }; mine.set(id, s); subs.add(s)
      } else if (m[0] === 'CLOSE') { const s = mine.get(m[1]); if (s) { subs.delete(s); mine.delete(m[1]) } }
      else if (m[0] === 'EVENT') {
        // A network blip on publish: the event never reaches the relay, and no OK comes back.
        if (relay.dropEvents.has(name)) return
        const ev = m[1]
        if (!store.some((e) => e.id === ev.id)) store.push(ev)
        ws.send(JSON.stringify(['OK', ev.id, true, '']))
        for (const s of subs) if (!relay.silent.has(s.name) && s.filters.some((f) => matchFilter(f, ev))) s.ws.send(JSON.stringify(['EVENT', s.id, ev]))
      } else if (m[0] === 'AUTH') ws.send(JSON.stringify(['OK', m[1].id, true, '']))
      else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: store.filter((e) => m.slice(2).some((f) => matchFilter(f, e))).length }]))
    })
  })
  await ctx.addInitScript(([pk, ns]) => {
    try {
      localStorage.setItem('onosendai:live', '1')
      localStorage.setItem('onosendai:nsec', ns)
      localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
    } catch {}
  }, [pk, nsec])
  const d = { name, ctx, page: null, errors: [] }
  d.open = async () => {
    d.page = await ctx.newPage()
    d.page.on('pageerror', (e) => d.errors.push(`pageerror: ${e.message}`))
    await d.page.goto(url, { waitUntil: 'domcontentloaded' })
    await d.page.waitForFunction(() => !!window.__store, null, { timeout: 90_000 })
  }
  d.close = async () => { await d.page?.close(); d.page = null }
  d.state = () => d.page.evaluate(() => {
    const s = window.__store.getState()
    return { head: s.prevEventId, n: s.events.length, pos: s.position, msg: s.proof.message, status: s.proof.status, conflict: s.chainConflict?.kind ?? null, held: s.held, sync: s.chainSync ?? null, notice: s.forkNotice, published: s.events.filter((e) => s.published[e.id] === 'ok').length, check: s.selfCheck?.status ?? null, t: Math.round(performance.now()) }
  })
  return d
}

/** One move: the cursor a cell along x, then COMMIT; resolves once it is signed and the relay holds it. */
async function move(d, axis = 'x') {
  const before = (await d.state()).n
  await d.page.evaluate((axis) => { const s = window.__store.getState(); s.moveCursor({ axis, dir: 1 }); void s.commit() }, axis)
  const end = Date.now() + 120_000
  while (Date.now() < end) {
    const s = await d.state()
    if (s.n > before && store.some((e) => e.id === s.head)) return s
    await sleep(300)
  }
  throw new Error(`${d.name}: move did not land: ${JSON.stringify(await d.state())}`)
}

/** Sample `d` every 250 ms until `pred` holds or `ms` passes; the ms it took, or null. */
async function until(d, pred, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (pred(await d.state())) return Date.now() - t0
    await sleep(250)
  }
  return null
}
const relayHead = () => {
  // The head of the relay's chain: the event no other event names as previous.
  const mine = store.filter((e) => e.pubkey === pk && e.kind === 3333)
  const named = new Set(mine.flatMap((e) => e.tags.filter((t) => t[0] === 'e' && t[3] === 'previous').map((t) => t[1])))
  return mine.filter((e) => !named.has(e.id)).sort((a, b) => b.created_at - a.created_at)[0]?.id ?? null
}
const want = (c) => !ONLY || ONLY.has(c)

const phone = await device('phone')
const tablet = await device('tablet')
await phone.open()
await sleep(4000)
for (let i = 0; i < 2; i++) await move(phone)
console.log('phone chain', (await phone.state()).n, 'relay events', store.length)
await tablet.open()
const first = await until(tablet, (s) => s.head === relayHead(), 30_000)
ok('tablet first load reaches the relay head', first !== null, `${first} ms`)
await tablet.close()

if (want('reload')) {
  for (let i = 0; i < 3; i++) await move(phone)
  const target = relayHead()
  await tablet.open()
  const seen = []
  const t = await until(tablet, (s) => { const k = `${s.check} ${s.n} ${s.head?.slice(0, 6)} ${s.sync ? JSON.stringify(s.sync) : ''}`; if (seen[seen.length - 1]?.k !== k) seen.push({ k, t: s.t }); return s.head === target }, 30_000)
  console.log('tablet timeline (ms since navigation):', seen.map((x) => `${x.t}: ${x.k}`).join(' | '))
  const s = await tablet.state()
  ok('reload: tablet catches up with no move', t !== null, `${t} ms, ${s.n} actions, note ${JSON.stringify(s.notice)}`)
  await tablet.page.screenshot({ path: `${out}/reload-caught-up.png` })
}

if (want('live')) {
  if (!tablet.page) await tablet.open()
  await until(tablet, (s) => s.head === relayHead(), 30_000)
  const reqs0 = relay.reqs.tablet ?? 0
  await move(phone)
  const target = relayHead()
  const t = await until(tablet, (s) => s.head === target, 20_000)
  ok('live: open tablet follows the phone within seconds', t !== null && t < 10_000, `${t} ms`)
  await move(phone)
  await until(tablet, (s) => s.head === relayHead(), 20_000)
  ok('live: no chain REQ churn on the tablet per phone move', (relay.reqs.tablet ?? 0) - reqs0 === 0, `${(relay.reqs.tablet ?? 0) - reqs0} chain REQs over two phone moves`)
  await tablet.close()
}

if (want('standing')) {
  // The tablet open and caught up; its next move is signed from what its
  // standing subscription has delivered, with no chain REQ before it.
  if (!tablet.page) await tablet.open()
  await until(tablet, (s) => s.head === relayHead() && s.sync?.status === 'done', 30_000)
  await sleep(3000)
  const reqs0 = relay.reqs.tablet ?? 0
  const t0 = Date.now()
  const s = await move(tablet, 'y')
  const t = Date.now() - t0
  const reqs = (relay.reqs.tablet ?? 0) - reqs0
  ok('standing: an open, caught-up tablet signs its move with no chain REQ first', reqs === 0 && s.head === relayHead(), `${reqs} chain REQs, landed in ${t} ms`)
  // And the phone, open all along, gets it from its own subscription.
  const tp = await until(phone, (p) => p.head === s.head, 20_000)
  ok('standing: the other open device follows it', tp !== null, `${tp} ms`)
  await tablet.close()
}

if (want('press')) {
  for (let i = 0; i < 2; i++) await move(phone)
  const target = relayHead()
  await tablet.open()
  const had = new Set(store.map((e) => e.id))
  // Pressed the moment the store is up, before the relays have been heard.
  await tablet.page.evaluate(() => { const s = window.__store.getState(); s.moveCursor({ axis: 'z', dir: 1 }); void s.commit() })
  const t = await until(tablet, (s) => s.head === target || store.some((e) => e.id === s.head && !had.has(e.id)), 60_000)
  await sleep(8000)
  const fresh = store.filter((e) => !had.has(e.id) && e.pubkey === pk)
  const prevs = fresh.map((e) => e.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1])
  const s = await tablet.state()
  // Either it waited and landed on the true head, or it was refused with nothing signed; never signed on the stale head.
  ok('press during sync: never signed on the stale head', t !== null && prevs.every((p, i) => (i === 0 ? p === target : p === fresh[i - 1].id)), `${t} ms, ${fresh.length} signed, previous ${prevs[0]?.slice(0, 8) ?? 'none'} target ${target?.slice(0, 8)}, msg ${JSON.stringify(s.msg)}`)
  await tablet.close()
}

if (want('kept')) {
  // Moves kept on the phone while LOCAL, the phone switched to LIVE and
  // reloaded: they wait for an action on the phone (owner, 2026-11-21), the
  // chip says so, and the next move sends them all behind it, with no fork.
  await phone.page.evaluate(() => window.__store.getState().setLive(false))
  const before = store.length
  for (let i = 0; i < 2; i++) {
    const n0 = (await phone.state()).n
    await phone.page.evaluate(() => { const s = window.__store.getState(); s.moveCursor({ axis: 'x', dir: 1 }); void s.commit() })
    await until(phone, (s) => s.n > n0 && s.status !== 'computing', 120_000)
  }
  await phone.page.evaluate(() => window.__store.getState().setLive(true))
  await phone.close()
  await phone.open()
  await until(phone, (s) => s.n > 0 && s.check !== 'checking', 60_000)
  await sleep(8000)
  const chip = await phone.page.evaluate(() => [...document.querySelectorAll('.explorer__toggle')].map((e) => e.textContent).join(' | '))
  const quiet = store.length === before
  const target = await move(phone)
  const mine = store.filter((e) => e.pubkey === pk && e.kind === 3333)
  const prevs = mine.map((e) => e.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1]).filter(Boolean)
  ok('kept: moves kept while LOCAL stay on the phone after a reload on LIVE until a move there, which sends them all', quiet && /KEPT HERE/.test(chip) && store.length === before + 3 && target.head === relayHead() && new Set(prevs).size === prevs.length, `quiet ${quiet}, chip "${chip}", relay +${store.length - before}`)
}

if (want('blip')) {
  // A move signed while LIVE whose send never landed (the relay took nothing),
  // then a reload with the relay back: it goes out by itself, after the
  // publisher's look, with no new action (owner, 2026-11-22).
  if (!(await phone.page.evaluate(() => window.__store.getState().live))) await phone.page.evaluate(() => window.__store.getState().setLive(true))
  const before = store.length
  relay.dropEvents.add('phone')
  const n0 = (await phone.state()).n
  await phone.page.evaluate(() => { const s = window.__store.getState(); s.moveCursor({ axis: 'z', dir: 1 }); void s.commit() })
  await until(phone, (s) => s.n > n0 && s.status !== 'computing', 120_000)
  const signed = (await phone.state()).head
  await sleep(15_000)
  const lost = store.length === before
  relay.dropEvents.delete('phone')
  await phone.close()
  await phone.open()
  const t = await until(phone, () => store.some((e) => e.id === signed), 90_000)
  const chip = await phone.page.evaluate(() => [...document.querySelectorAll('.explorer__toggle')].map((e) => e.textContent).join(' | '))
  const mine = store.filter((e) => e.pubkey === pk && e.kind === 3333)
  const prevs = mine.map((e) => e.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1]).filter(Boolean)
  ok('blip: a LIVE move whose send was lost goes out after a reload with no action', lost && t !== null && new Set(prevs).size === prevs.length, `lost first ${lost}, landed ${t} ms after reload, chip "${chip}"`)
}

/**
 * `n` hops on from the relay's head, signed in the phone's page by the app's
 * own code (events.ts hopTemplate, a real proof from the test fixture, the
 * page's local signer), dated between the head and now as moves made while
 * LOCAL are: the phone's 458 moves of 2026-11-21, without pressing 458 times.
 * Each hop stays inside its aligned pair of cells, so every proof is cheap.
 */
async function signedOffline(n) {
  const headId = relayHead()
  const head = store.find((e) => e.id === headId)
  const now = Math.floor(Date.now() / 1000)
  return phone.page.evaluate(async ([head, n, t0, t1]) => {
    const ev = await import('/src/lib/events.ts')
    const ph = await import('/src/store/fixtures/provedHop.ts')
    const genesis = head.tags.find((t) => t[0] === 'e' && t[3] === 'genesis')?.[1] ?? head.id
    const out = []
    let prev = head
    for (let i = 0; i < n; i++) {
      const a = ev.parseAction(prev)
      const to = { ...a.position, x: a.position.x % 2n === 0n ? a.position.x + 1n : a.position.x - 1n }
      const p = ph.provedHop({ position: a.position, pendingTarget: to, plane: a.plane, prevEventId: prev.id })
      const tmpl = ev.hopTemplate({ createdAt: t0 + Math.floor((i * (t1 - t0)) / n), genesisId: genesis, previousId: prev.id, prevCoordHex: prev.tags.find((t) => t[0] === 'C')[1], to, plane: a.plane, proofHash: p.proofHash, mn: p.hop.mnHex, mp: p.hop.mpHex })
      prev = await window.__store.getState().signEvent(tmpl)
      out.push(prev)
    }
    return out
  }, [head, n, head.created_at + 1, Math.max(head.created_at + 2, now)])
}
/** The relay takes `ev` as if the phone had just published it, and hands it to every live subscription it matches. */
function arrive(ev) {
  if (store.some((e) => e.id === ev.id)) return
  store.push(ev)
  for (const s of subs) if (!relay.silent.has(s.name) && s.filters.some((f) => matchFilter(f, ev))) s.ws.send(JSON.stringify(['EVENT', s.id, ev]))
}

for (const [c, n] of [['gap458', 458], ['gap600', Number(process.env.BIG_GAP ?? 600)]]) {
  if (!want(c)) continue
  const evs = await signedOffline(n)
  for (const ev of evs) arrive(ev)
  const target = relayHead()
  await tablet.open()
  const t = await until(tablet, (s) => s.head === target, 90_000)
  const s = await tablet.state()
  ok(`${c}: a reload catches up ${n} moves made elsewhere (relay cap ${CAP}), no move pressed`, t !== null, `${t} ms, ${s.n} actions, chip note ${JSON.stringify(s.notice)}`)
  await tablet.page.screenshot({ path: `${out}/${c}-caught-up.png` })
  await tablet.close()
}

if (want('drain')) {
  // The owner's case exactly: the phone signed moves while LOCAL, then went
  // LIVE and published them one at a time over a minute or two; the tablet
  // reloaded partway through, and stays open.
  const evs = await signedOffline(Number(process.env.DRAIN ?? 458))
  const target = evs[evs.length - 1].id
  await tablet.open()
  await until(tablet, (s) => s.check !== 'checking' && s.n > 0, 60_000)
  const third = Math.floor(evs.length / 4)
  for (const ev of evs.slice(0, third)) { arrive(ev); await sleep(20) }
  await tablet.page.reload({ waitUntil: 'domcontentloaded' })
  await tablet.page.waitForFunction(() => !!window.__store, null, { timeout: 90_000 })
  for (const ev of evs.slice(third)) { arrive(ev); await sleep(60) }
  const t = await until(tablet, (s) => s.head === target, 60_000)
  const s = await tablet.state()
  ok(`drain: an open tablet that reloaded mid-drain gets all ${evs.length} late-published moves without another reload`, t !== null, `${t} ms after the last one arrived, ${s.n} actions, head ${s.head?.slice(0, 8)} want ${target.slice(0, 8)}`)
  await tablet.close()
}

if (want('unreachable')) {
  const before = store.length
  relay.silent.add('tablet')
  await tablet.open()
  await until(tablet, (s) => s.n > 0, 30_000)
  const chips = () => tablet.page.evaluate(() => [...document.querySelectorAll('.explorer__toggle')].map((e) => e.textContent).join(' | '))
  const seen = new Set([await chips()])
  for (let i = 0; i < 8 && !(await chips()).includes('CHECKING'); i++) { await sleep(250); seen.add(await chips()) }
  await tablet.page.evaluate(() => { const s = window.__store.getState(); s.moveCursor({ axis: 'y', dir: 1 }); void s.commit() })
  const msgs = new Set()
  const t = await until(tablet, (s) => { msgs.add(s.msg); return s.msg === "Can't confirm your latest move. Try again." }, 90_000)
  for (let i = 0; i < 20 && !(await chips()).includes('NOT CHECKED'); i++) { seen.add(await chips()); await sleep(1000) }
  seen.add(await chips())
  const s = await tablet.state()
  await tablet.page.screenshot({ path: `${out}/unreachable.png` })
  const chipText = [...seen].join(' / ')
  ok('unreachable: nothing signed on an unconfirmed head, the move is refused in words, CHECKING is said (chip or panel), then the chip says NOT CHECKED', store.length === before && t !== null && (/CHECKING YOUR CHAIN/.test(chipText) || msgs.has('Checking your chain on the relays.')) && /CHAIN NOT CHECKED/.test(chipText), `${t} ms; messages ${JSON.stringify([...msgs])}; sync ${JSON.stringify(s.sync?.status)}; chips ${chipText}`)
  relay.silent.delete('tablet')
  await tablet.close()
}

if (want('stall')) {
  // The tablet's socket stalls: open, but nothing comes back from the relay
  // and nothing it sends is answered. The phone moves on meanwhile. A move
  // pressed on the tablet after that must not be signed on the old head.
  if (!tablet.page) await tablet.open()
  await until(tablet, (s) => s.head === relayHead() && s.sync?.status === 'done', 30_000)
  relay.silent.add('tablet')
  await move(phone)
  const target = relayHead()
  const before = new Set(store.map((e) => e.id))
  // The tablet sends something (its move's proof takes a moment), and the
  // stalled socket owes it an answer; it drops out of "current" then.
  await tablet.page.evaluate(() => { const s = window.__store.getState(); s.moveCursor({ axis: 'z', dir: 1 }); void s.commit() })
  const msgs = new Set()
  await until(tablet, (s) => { msgs.add(s.msg); return s.msg === "Can't confirm your latest move. Try again." }, 60_000)
  const st = await tablet.state()
  const signedStale = st.head !== target && st.n > 0 && !before.has(st.head) && (await tablet.page.evaluate((h) => { const s = window.__store.getState(); const e = s.events.find((x) => x.id === h); return e?.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1] ?? null }, st.head)) !== target
  relay.silent.delete('tablet')
  // Back: the relay's moves are taken in and nothing was signed on the old head.
  const back = await until(tablet, (s) => s.head === target || store.some((e) => e.id === s.head && !before.has(e.id)), 90_000)
  const st2 = await tablet.state()
  ok('stall: a silently stalled socket is not trusted; nothing is signed on the stale head; once the relay talks again the tablet catches up by itself', !signedStale && back !== null, `messages ${JSON.stringify([...msgs])}, back in step ${back} ms, tablet ${JSON.stringify({ n: st2.n, head: st2.head?.slice(0, 8), status: st2.status, msg: st2.msg, conflict: st2.conflict })} relay ${target?.slice(0, 8)}`)
  await tablet.close()
}

// The relay never holds two branches.
const mine = store.filter((e) => e.pubkey === pk && e.kind === 3333)
const prevs = mine.map((e) => e.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1]).filter(Boolean)
ok('no fork on the relay', new Set(prevs).size === prevs.length, `${mine.length} events`)

if (want('race')) {
  // Both devices open and caught up, a move pressed on each at the same
  // moment. Two moves from one head would fork the chain, and the relays
  // cannot be asked faster than one of them publishes; what is checked is
  // that the devices never build on a fork afterwards, and that with no
  // fork they end on one head.
  if (!phone.page) await phone.open()
  if (!tablet.page) await tablet.open()
  await until(tablet, (s) => s.head === relayHead() && s.sync?.status === 'done', 30_000)
  await until(phone, (s) => s.head === relayHead(), 30_000)
  await sleep(2000)
  const before = new Set(store.map((e) => e.id))
  const press = (d, axis) => d.page.evaluate((axis) => { const s = window.__store.getState(); s.moveCursor({ axis, dir: 1 }); void s.commit() }, axis)
  await Promise.all([press(phone, 'x'), press(tablet, 'y')])
  await sleep(12_000)
  const branchPoints = () => {
    const evs = store.filter((e) => e.pubkey === pk && e.kind === 3333)
    const count = new Map()
    for (const e of evs) { const p = e.tags.find((t) => t[0] === 'e' && t[3] === 'previous')?.[1]; if (p) count.set(p, (count.get(p) ?? 0) + 1) }
    return [...count.values()].filter((c) => c > 1).length
  }
  const forked = branchPoints()
  const [ps, ts] = [await phone.state(), await tablet.state()]
  // A move more on each: on a fork it must not be signed on either branch; with none, both continue one chain.
  await press(phone, 'x')
  await sleep(6000)
  await press(tablet, 'y')
  await sleep(12_000)
  const after = branchPoints()
  const fresh = store.filter((e) => !before.has(e.id) && e.pubkey === pk)
  const [ps2, ts2] = [await phone.state(), await tablet.state()]
  // With no fork, each device is on the relay's head, or holds its unpublished move behind the diverged-branch prompt (it saw the other's first).
  const settled = (st) => st.head === relayHead() || st.conflict === 'branch'
  const oneChain = settled(ps2) && settled(ts2)
  ok('race: two devices pressing at the same moment never build on a fork; with no fork each is on the relay head or holds behind the branch prompt', forked === 0 ? after === 0 && oneChain : after === forked && fresh.length === 2,
    `fork from the simultaneous presses: ${forked > 0}; ${fresh.length} new events on the relay; heads phone ${ps2.head?.slice(0, 8)} tablet ${ts2.head?.slice(0, 8)} relay ${relayHead()?.slice(0, 8)}; after the presses phone ${JSON.stringify({ c: ps.conflict, msg: ps.msg })} tablet ${JSON.stringify({ c: ts.conflict, msg: ts.msg })}; after one more each phone ${JSON.stringify({ c: ps2.conflict, msg: ps2.msg })} tablet ${JSON.stringify({ c: ts2.conflict, msg: ts2.msg })}`)
}
console.log('errors', phone.errors.slice(0, 3), tablet.errors.slice(0, 3))
fs.writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2))
await browser.close()
process.exit(results.every((r) => r.pass) ? 0 : 1)
