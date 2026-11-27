/**
 * mining-shots.mjs: screenshots of the MINING panel (owner, 2026-11-27) with
 * seeded counts from two devices, LIVE, after the panel's own sync on open.
 *
 * Nothing reaches a relay: every non-localhost request is refused and every
 * socket is answered here (EOSE to a REQ, OK to an EVENT). The 30078 the
 * panel's sync writes is caught on the way and checked: only the `d` (and
 * `client`) tag, and nothing readable in its content.
 *
 * Usage: start the dev server (npx vite --port 5293), then
 *   SHOTS=<dir> node scripts/mining-shots.mjs [http://localhost:5293/]
 * Exit 1 on any problem.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools'

const URL = process.argv[2] ?? 'http://localhost:5293/'
const SHOTS = process.env.SHOTS ?? '.'
mkdirSync(SHOTS, { recursive: true })
const SIZES = [
  { name: '390x844', w: 390, h: 844, touch: true },
  { name: '1440x900', w: 1440, h: 900, touch: false },
]

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
let bad = 0
for (const size of SIZES) {
  const ctx = await browser.newContext(size.touch ? { viewport: { width: size.w, height: size.h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: size.w, height: size.h } })
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
  // The 30078s written are kept and served back, as a relay would, so the read after a write finds it.
  const written = []
  const matches = (f, ev) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f.authors || f.authors.includes(ev.pubkey)) && (!f['#d'] || ev.tags.some((t) => t[0] === 'd' && f['#d'].includes(t[1])))
  await ctx.routeWebSocket(/.*/, (ws) => {
    ws.onMessage((raw) => {
      let m
      try { m = JSON.parse(String(raw)) } catch { return }
      if (m[0] === 'REQ') {
        const filters = m.slice(2)
        const newest = written.length ? [written.reduce((a, b) => (b.created_at >= a.created_at ? b : a))] : []
        for (const ev of newest) if (filters.some((f) => matches(f, ev))) ws.send(JSON.stringify(['EVENT', m[1], ev]))
        ws.send(JSON.stringify(['EOSE', m[1]]))
      } else if (m[0] === 'EVENT') {
        if (m[1].kind === 30078) written.push(m[1])
        ws.send(JSON.stringify(['OK', m[1].id, true, '']))
      }
    })
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.log(`${size.name}: page error: ${e.message}`))
  const sk = generateSecretKey(); const pk = getPublicKey(sk); const ns = nip19.nsecEncode(sk)
  await page.addInitScript(([pk, ns]) => { try { localStorage.setItem('onosendai:live', '1'); localStorage.setItem('onosendai:nsec', ns); localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns })) } catch {} }, [pk, ns])
  await page.goto(URL)
  await page.waitForTimeout(9000)
  await page.keyboard.press('Escape')
  const seeded = await page.evaluate(async () => {
    const tut = await import('/src/store/useTutorial.ts')
    const tutorial = tut.tutorialRunFor()
    if (tutorial) tut.useTutorial.setState({ active: false })
    const cs = (await import('/src/store/useCyberspace.ts')).useCyberspace
    if (!cs.getState().live) cs.getState().setLive(true)
    const me = cs.getState().identity.pubkey
    const ms = await import('/src/store/miningStats.ts')
    const mr = await import('/src/lib/miningRecord.ts')
    const { kvStorage } = await import('/src/lib/kvStore.ts')
    const l = ms.localFor(me)
    const today = mr.dayNumber()
    const nowS = Math.floor(Date.now() / 1000)
    const rec = {
      devices: {
        [l.device]: { c: { surveys: 212, chunks: 198, mined: 2950, placed: 1100, placedAir: 120, smashes: 30, smashBare: 8, smashCompiler: 22, smashed: 240, compiles: 5, prizes: 4, bpMade: 2, bpPlaced: 1, bpFound: 1, terrainSec: 19800 }, k: { 1: 1700, 2: 700, 5: 420, 40: 110, 42: 19, 194: 1 }, u: nowS },
        c84e20f15a9b3d07: { c: { surveys: 106, chunks: 101, mined: 699, placed: 430, placedAir: 50, smashes: 16, smashBare: 4, smashCompiler: 12, smashed: 128, compiles: 2, prizes: 2, bpMade: 1, bpFound: 1, terrainSec: 4320 }, k: { 1: 510, 2: 140, 40: 49 }, u: nowS - 3600 },
      },
      first: { survey: nowS - 21 * 86400, compiler: nowS - 12 * 86400 },
      best: { streak: 4 },
      days: [[today - 21, today - 18], [today - 9, today - 8], [today - 2, today]],
    }
    kvStorage.setItem(`onosendai:mining:${me}`, JSON.stringify({ ...l, rec, rev: l.rev + 1 }))
    ms.useMiningStats.setState((s) => ({ flips: s.flips + 1 }))
    return { me, tutorial, live: cs.getState().live }
  })
  console.log(`${size.name}: seeded ${seeded.me.slice(0, 8)}, live ${seeded.live}, tutorial was running ${seeded.tutorial}`)
  await page.evaluate(() => document.querySelector('.hamburger-menu')?.click())
  await page.waitForTimeout(1500)
  const found = await page.evaluate(() => { const p = document.querySelector('.panel--mining'); p?.scrollIntoView({ block: 'start' }); return !!p })
  if (!found) { bad++; console.log(`${size.name}: no MINING panel in the menu`); await ctx.close(); continue }
  // The panel's sync on open: read, merge, seal, sign, publish (to the sockets above).
  let status = ''
  for (let i = 0; i < 40 && status !== 'synced'; i++) {
    await page.waitForTimeout(500)
    status = await page.evaluate(async () => (await import('/src/store/miningStats.ts')).useMiningStats.getState().status)
  }
  await page.waitForTimeout(800)
  if (status !== 'synced') { bad++; console.log(`${size.name}: sync status ${status}`) }
  const ev = written.at(-1)
  if (!ev) { bad++; console.log(`${size.name}: no 30078 written`) }
  else {
    const tags = ev.tags.map((t) => t[0]).sort().join(',')
    const okTags = ev.tags.every((t) => t[0] === 'client' || (t[0] === 'd' && t[1] === 'onosendai/mining' && t.length === 2))
    const sealed = /^1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(ev.content) && !/surveys|devices|terrainSec/.test(ev.content)
    if (!okTags || !sealed) { bad++; console.log(`${size.name}: 30078 not as it should be: tags ${tags}, sealed ${sealed}`) }
    else console.log(`${size.name}: 30078 written, tags ${tags}, content sealed (${ev.content.length} chars)`)
  }
  const words = await page.evaluate(() => document.querySelector('.mining__sync')?.textContent ?? '')
  console.log(`${size.name}: sync line "${words}"`)
  const overflow = await page.evaluate(() => {
    const p = document.querySelector('.panel--mining')
    const pr = p.getBoundingClientRect()
    // Every tile inside the panel, and every number and label shown whole (the tiles' corner ticks are drawn past their box on purpose).
    const outside = [...p.querySelectorAll('.mining__tile, .mining__kind')].filter((e) => { const r = e.getBoundingClientRect(); return r.left < pr.left - 0.5 || r.right > pr.right + 0.5 })
    const clipped = [...p.querySelectorAll('.mining__num, .mining__label, .mining__kind-name, .mining__kind-num')].filter((e) => e.scrollWidth > e.clientWidth + 1)
    return [...outside, ...clipped].map((e) => `${e.className} "${e.textContent}" ${e.scrollWidth}>${e.clientWidth}`)
  })
  if (overflow.length) { bad++; console.log(`${size.name}: overflow: ${overflow.join('; ')}`) }
  await page.screenshot({ path: `${SHOTS}/mining-${size.w}x${size.h}.png` })
  // On a phone the panel runs past one screen: the rest of it too.
  const more = await page.evaluate(() => {
    const p = document.querySelector('.panel--mining')
    const r = p.getBoundingClientRect()
    if (r.bottom <= innerHeight) return false
    p.querySelector('.mining__sync')?.scrollIntoView({ block: 'center' })
    return true
  })
  if (more) { await page.waitForTimeout(400); await page.screenshot({ path: `${SHOTS}/mining-${size.w}x${size.h}-lower.png` }) }
  await ctx.close()
}
await browser.close()
console.log(bad ? `${bad} problem(s)` : 'MINING shots: all clear')
process.exit(bad ? 1 : 0)
