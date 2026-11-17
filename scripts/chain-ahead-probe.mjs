/**
 * chain-ahead-probe.mjs: the CHAIN chip's ahead bar in a real browser,
 * offline (2026-11-17; src/hud/ChainAhead.tsx).
 *
 * Measures what a unit test cannot: that the chip keeps its box and every
 * other chip in the stack keeps its place at every count, on a phone and a
 * desktop, that the bar shows what the count says, and that reduced motion
 * runs no animation and still shows the state. Then, with WALK=1, it walks
 * for real and records the bar filling and moves landing.
 *
 * The counts are set on the dev build's walk store (window.__walk, DEV
 * only): the same number the slowdown and the LOSING SYNC warning read.
 *
 * Never on the wire: LOCAL before anything (the run aborts otherwise), every
 * origin but localhost refused, and every WebSocket answered by an empty
 * in-process relay. A throwaway key, made here and never kept, signs.
 * Nothing can be published.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=<browsers> \
 *   node scripts/chain-ahead-probe.mjs http://localhost:5199/ <out dir>
 * Env: DPR=<n> for the phone screenshots' pixel ratio (2), PAD=<n> for the
 * long chain's length (12345). WALK=1 instead records a real walk to
 * <out>/walk.webm: KEYS held in turn (w,a,w,d) for HOLD ms each with GAP ms
 * between, STEPS turns at most, LAG=<ms> to slow the proofs as a slower
 * device does, so the walk gets ahead (LAND=<ms> for the lag once it has
 * stopped), CHAIN=<n> to walk a chain that long first, and DPR=<n> for the
 * video's pixel ratio (1).
 * Exits 1 when a check fails.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nip19 } from 'nostr-tools'

const [url, out] = process.argv.slice(2)
if (!url || !out) { console.log('usage: chain-ahead-probe.mjs <url> <out dir>'); process.exit(2) }
fs.mkdirSync(out, { recursive: true })

const COUNTS = [0, 1, 5, 14, 15, 17, 20, 26]
/** Phone screenshots at this pixel ratio (layout is in CSS pixels either way). */
const dpr = Number(process.env.DPR ?? 2)
const fails = []
const check = (ok, what) => { if (!ok) fails.push(what); console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`) }

const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })

/**
 * A page of the app in LOCAL with the network refused, standing in WALK on
 * a short chain of its own (a spawn and a step). `pad` shows the chip as a
 * chain of that many actions would, for the bar at a long chain's width.
 * `lag` lets the page hold every message to a proof worker back by
 * window.__proofLag ms (0 until set), as a slower device's proofs are, so a
 * walk can get ahead of them.
 */
async function open(options, pad = 0, lag = false) {
  const ctx = await browser.newContext(options)
  await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
  const sent = []
  await ctx.routeWebSocket(/.*/, (ws) => {
    if (/localhost|127\.0\.0\.1/.test(ws.url())) { ws.connectToServer(); return }
    ws.onMessage((raw) => {
      let m; try { m = JSON.parse(String(raw)) } catch { return }
      if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]]))
      else if (m[0] === 'EVENT') { sent.push(m[1].kind); ws.send(JSON.stringify(['OK', m[1].id, true, ''])) }
      else if (m[0] === 'COUNT') ws.send(JSON.stringify(['COUNT', m[1], { count: 0 }]))
    })
  })
  const page = await ctx.newPage()
  const sk = generateSecretKey()
  await page.addInitScript(([pk, ns]) => {
    try {
      localStorage.setItem('onosendai:live', '0')
      // A given key is not a first arrival, and the tutorial hides the chip.
      localStorage.setItem('onosendai:tutorial', 'off')
      localStorage.setItem('onosendai:signer', JSON.stringify({ kind: 'local', pubkey: pk, nsec: ns }))
    } catch {}
  }, [getPublicKey(sk), nip19.nsecEncode(sk)])
  const born = Date.now()
  if (lag) await page.addInitScript(() => {
    window.__proofLag = 0
    const post = Worker.prototype.postMessage
    // In the order they were sent, whatever the lag is changed to meanwhile.
    let last = 0
    Worker.prototype.postMessage = function (...args) {
      const due = Math.max(Date.now() + window.__proofLag, last + 1)
      if (due <= Date.now()) { post.apply(this, args); return }
      last = due
      setTimeout(() => post.apply(this, args), due - Date.now())
    }
  })
  page.on('pageerror', (e) => { if (!/Failed to fetch/.test(e.message)) console.log(`PAGEERROR: ${e.message}`) })
  await page.goto(url, { waitUntil: 'load' })
  await page.waitForTimeout(6000)
  const live = await page.evaluate(() => window.__store.getState().live)
  if (live !== false) { console.log('ABORT: not LOCAL'); await browser.close(); process.exit(2) }
  await page.evaluate(() => window.__walk.getState().enter())
  await page.waitForTimeout(1500)
  if (!(await page.evaluate(() => window.__store.getState().walking))) { console.log('ABORT: not in WALK'); await browser.close(); process.exit(2) }
  // The chip needs a chain: one step makes the spawn and a hop. Then stand until they have landed.
  const standing = () => page.evaluate(() => {
    const w = window.__walk.getState(), s = window.__store.getState()
    return { ready: s.events.length >= 2 && w.behind === 0 && w.open === null && w.running === null && !w.falling, events: s.events.length, behind: w.behind, open: w.open !== null, running: w.running !== null, falling: w.falling, walking: s.walking, message: s.proof.message }
  })
  let at = await standing()
  // Held, not tapped (a press shorter than one of the software renderer's
  // frames is never seen), and again until the walk has taken it: a page
  // still settling in can miss the first.
  for (let tries = 0; tries < 30 && at.events === 0 && at.behind === 0 && !at.open && !at.running; tries++) {
    await page.keyboard.down('w')
    await page.waitForTimeout(500)
    await page.keyboard.up('w')
    await page.waitForTimeout(1500)
    at = await standing()
  }
  for (let i = 0; i < 720 && !at.ready; i++) { await page.waitForTimeout(250); at = await standing() }
  if (!at.ready) { console.log(`ABORT: the first step never landed: ${JSON.stringify(at)}`); await browser.close(); process.exit(2) }
  if (pad) await page.evaluate((n) => {
    const s = window.__store.getState()
    const chain = Array.from({ length: n }, (_, i) => s.focusChain()[Math.min(i, s.focusChain().length - 1)])
    window.__store.setState({ focusChain: () => chain, events: [...s.events] })
  }, pad)
  await page.waitForTimeout(500)
  return { ctx, page, sent, born }
}

/**
 * Put the walk `n` events ahead, as the queue does, and let the styles
 * settle: two frames for the change to be drawn, then every transition and
 * every animation that ends (the breathe does not) run out. The software
 * renderer's frames are slow, so a fixed wait alone reads a fade halfway.
 */
async function ahead(page, n, wait = 700) {
  await page.evaluate((k) => window.__walk.setState({ behind: k }), n)
  await page.waitForTimeout(wait)
  await page.evaluate(async () => {
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    await frame(); await frame()
    const ending = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
    await Promise.all(ending.map((a) => a.finished.catch(() => {})))
    await frame()
  })
}

/** Every box in the instrument stack but the bar's own marks, and what the chip shows. */
const read = (page) => page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100).join(' ') }
  const chip = [...document.querySelectorAll('.explorer__toggle')].find((el) => /CHAIN/.test(el.textContent))
  if (!chip) throw new Error('no CHAIN chip on the page')
  const stack = [...document.querySelectorAll('.instruments *')].filter((el) => !el.closest('.aheadbar, .aheadbrk') && !el.classList.contains('aheadtxt'))
  const bar = chip.querySelector('.aheadbar')
  const brk = chip.querySelector('.aheadbrk')
  const ticks = bar ? [...bar.children] : []
  return {
    chip: box(chip),
    stack: stack.map((el) => `${el.tagName}:${box(el)}`),
    cls: chip.className,
    label: chip.getAttribute('aria-label'),
    words: chip.textContent,
    border: getComputedStyle(chip).borderTopColor,
    drawn: !!bar,
    barOpacity: bar ? Number(getComputedStyle(bar).opacity) : 0,
    barAnimation: bar ? getComputedStyle(bar).animationName : '',
    barBox: bar ? box(bar) : '',
    tickWidth: ticks.length ? Math.round(parseFloat(getComputedStyle(ticks[0]).width) * 100) / 100 : 0,
    slot: ticks.length ? getComputedStyle(ticks[ticks.length - 1]).boxShadow : '',
    ticks: ticks.length,
    lit: ticks.filter((t) => t.classList.contains('is-lit')).length,
    hollow: ticks.filter((t) => t.classList.contains('is-z') && !t.classList.contains('is-lit')).length,
    head: ticks.findIndex((t) => t.classList.contains('is-head')) + 1,
    tickAnimations: ticks.map((t) => getComputedStyle(t).animationName).filter((a) => a !== 'none').length,
    brkOpacity: brk ? Number(getComputedStyle(brk).opacity) : 0,
    brkGap: brk ? brk.style.getPropertyValue('--ahead-gap') : '',
    warn: Number(getComputedStyle(document.querySelector('.syncwarn')).opacity),
    scrollW: document.documentElement.scrollWidth,
  }
})

/**
 * One real step, and its landing as the chip shows it: whether the end tick
 * folded, and the animation on the words (the glint) when the total grew.
 * The classes stay until the next move, so a poll cannot miss them.
 */
async function landing(page) {
  await page.evaluate(() => window.__walk.setState({ behind: 0 }))
  await page.waitForTimeout(2200)
  const before = await page.evaluate(() => window.__store.getState().events.length)
  for (let tries = 0; tries < 10; tries++) {
    await page.keyboard.down('w')
    await page.waitForTimeout(500)
    await page.keyboard.up('w')
    await page.waitForTimeout(300)
    if (await page.evaluate((n) => { const w = window.__walk.getState(); return w.open !== null || w.behind > 0 || w.running !== null || window.__store.getState().events.length > n }, before)) break
  }
  for (let i = 0; i < 1200; i++) {
    const s = await page.evaluate(() => {
      const words = document.querySelector('.aheadtxt.is-glint')
      return { total: window.__store.getState().events.length, glint: words ? getComputedStyle(words).animationName : '', folded: !!document.querySelector('.aheadbar i.is-going'), lit: document.querySelectorAll('.aheadbar i.is-lit').length }
    })
    if (s.total > before && s.glint) return s
    await page.waitForTimeout(50)
  }
  return { total: before, glint: '', folded: false, lit: -1 }
}

async function layout(name, options, pad = 0) {
  const { ctx, page, sent } = await open(options, pad)
  await ahead(page, 0, 3000)
  const base = await read(page)
  check(!base.drawn && /^chip explorer__toggle$/.test(base.cls.trim()), `${name}: nothing ahead, the chip is as it always was (${base.words}; ${base.cls.trim()}; ${base.chip})`)
  const clip = async (file) => {
    const [x, y, w, h] = base.chip.split(' ').map(Number)
    await page.screenshot({ path: `${out}/${file}`, clip: { x: Math.max(0, x - 8), y: Math.max(0, y - 8), width: w + 16, height: h + 16 } })
  }
  for (const n of COUNTS) {
    await ahead(page, n)
    const s = await read(page)
    const want = Math.min(n, 20)
    check(s.chip === base.chip, `${name} at ${n}: the chip's box is unchanged (${s.chip})`)
    check(s.stack.length === base.stack.length && s.stack.every((b, i) => b === base.stack[i]), `${name} at ${n}: all ${base.stack.length} boxes in the stack are where they were`)
    check(s.scrollW === base.scrollW, `${name} at ${n}: the page is no wider`)
    check(s.words === base.words, `${name} at ${n}: the words are unchanged (${s.words})`)
    if (n === 0) continue
    check(s.drawn && s.ticks === 20 && s.lit === want && s.head === want, `${name} at ${n}: ${want} of 20 ticks lit, the newest the head (${s.lit}, head ${s.head})`)
    check(s.hollow === Math.min(6, 20 - want), `${name} at ${n}: ${Math.min(6, 20 - want)} hollow amber slots left (${s.hollow})`)
    // Breathing at the limit: between 0.62 and 1, never out.
    check(n >= 20 ? s.barOpacity >= 0.6 : s.barOpacity === 1, `${name} at ${n}: the bar is shown (opacity ${s.barOpacity})`)
    check((s.brkOpacity === 1) === (n >= 15), `${name} at ${n}: brackets ${n >= 15 ? 'shown' : 'hidden'} (gap ${s.brkGap})`)
    check((s.border === 'rgb(255, 35, 35)') === (n >= 20), `${name} at ${n}: border ${n >= 20 ? 'the warning red' : 'not red'} (${s.border})`)
    check(/ahead-breathe/.test(s.barAnimation) === (n >= 20), `${name} at ${n}: ${n >= 20 ? 'breathing' : 'not breathing'}`)
    check((s.warn > 0) === (n >= 15) && (s.warn === 1) === (n >= 20), `${name} at ${n}: LOSING SYNC at ${Math.round(s.warn * 100)}%`)
    check(s.label.includes(`${n} move${n === 1 ? '' : 's'} ahead of your chain. The walk stops at 20.`), `${name} at ${n}: the label carries the count (${s.label})`)
    check(s.tickWidth >= 1.4, `${name} at ${n}: ticks ${s.tickWidth}px wide in a ${s.barBox.split(' ')[2]}px bar`)
    await clip(`${name}-${String(n).padStart(2, '0')}.png`)
    if (name !== 'desktop' && [5, 17, 20].includes(n)) await page.screenshot({ path: `${out}/${name}-full-${n}.png` })
  }
  // Catching up: the empty bar stays about a second, fades, and is taken off the page.
  await ahead(page, 3)
  await page.evaluate(() => window.__walk.setState({ behind: 0 }))
  await page.waitForTimeout(600)
  const soon = await read(page)
  check(soon.drawn && soon.barOpacity === 1 && soon.lit === 0, `${name}: 0.6 s after catching up the empty bar is still there (opacity ${soon.barOpacity})`)
  check(soon.chip === base.chip, `${name}: while it lingers the chip's box is unchanged`)
  await page.waitForTimeout(1500)
  const later = await read(page)
  check(!later.drawn && later.cls.trim() === base.cls.trim() && later.label === base.label, `${name}: 2.1 s after catching up the bar is gone and the chip is as before`)
  check(later.chip === base.chip && later.stack.every((b, i) => b === base.stack[i]), `${name}: and nothing moved`)
  // A real move landing: its tick folds away and the total glints, in the same moment.
  if (!pad) {
    const hit = await landing(page)
    check(hit.folded && hit.glint === 'ahead-glint', `${name}: a real move landed, its tick folded and the total glinted (${JSON.stringify(hit)})`)
    await page.waitForTimeout(2200)
    const after = await read(page)
    check(!after.drawn && after.chip.split(' ')[3] === base.chip.split(' ')[3] && after.chip.split(' ').slice(0, 2).join(' ') === base.chip.split(' ').slice(0, 2).join(' '), `${name}: and afterwards the bar is gone and the chip is where it was, as tall as it was (${after.chip})`)
  }
  // Out of WALK nothing shows, however far ahead the store says.
  await page.evaluate(() => window.__walk.getState().exit())
  await page.evaluate(() => window.__walk.setState({ behind: 12 }))
  await page.waitForTimeout(2200)
  const off = await read(page)
  check(!off.drawn, `${name}: out of WALK there is no bar`)
  check(sent.length === 0, `${name}: nothing was sent to a relay (${sent.length})`)
  await ctx.close()
}

async function reduced() {
  const { ctx, page } = await open({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
  await ahead(page, 0, 3000)
  const base = await read(page)
  for (const n of [5, 17, 20]) {
    await ahead(page, n)
    const s = await read(page)
    check(s.barAnimation === 'none' && s.tickAnimations === 0, `reduced motion at ${n}: no animation on the bar or its ticks (${s.barAnimation})`)
    check(s.lit === n && s.barOpacity === 1 && (s.brkOpacity === 1) === (n >= 15) && (s.border === 'rgb(255, 35, 35)') === (n >= 20), `reduced motion at ${n}: the state still shows (${s.lit} lit, brackets ${s.brkOpacity}, border ${s.border})`)
    check(s.chip === base.chip, `reduced motion at ${n}: the chip's box is unchanged`)
  }
  // A real move landing: the total still changes, with no glint animation.
  const hit = await landing(page)
  check(hit.glint === 'none', `reduced motion: a real move landed and the words did not animate (${JSON.stringify(hit)})`)
  await ctx.close()
}

/**
 * A real walk, recorded: turns made faster than the proofs land, to the stop
 * at 20 when the proofs are slow enough (LAG), then standing while they
 * land. Each turn closes a segment, and every segment is one event to prove.
 * With CHAIN it first walks, proofs at full speed, until the chain is that
 * long, so the chip is as wide as a played-in chain's; the part worth
 * keeping is printed as seconds into the video.
 */
async function walk() {
  const size = { width: 375, height: 812 }
  const scale = Number(process.env.DPR ?? 1)
  const lag = Number(process.env.LAG ?? 0)
  const { ctx, page, sent, born } = await open({ viewport: size, deviceScaleFactor: scale, isMobile: true, hasTouch: true, recordVideo: { dir: out, size: { width: size.width * scale, height: size.height * scale } } }, 0, lag > 0)
  const keys = (process.env.KEYS ?? 'w,a,w,d').split(',')
  const steps = Number(process.env.STEPS ?? 160)
  const hold = Number(process.env.HOLD ?? 220)
  const gap = Number(process.env.GAP ?? 30)
  const seen = new Set()
  const shot = async (tag) => { if (seen.has(tag)) return; seen.add(tag); await page.screenshot({ path: `${out}/walk-${tag}.png` }) }
  const state = () => page.evaluate(() => {
    const w = window.__walk.getState()
    const chip = [...document.querySelectorAll('.explorer__toggle')].find((el) => /CHAIN/.test(el.textContent))
    const bar = chip?.querySelector('.aheadbar')
    const r = chip?.getBoundingClientRect()
    return {
      behind: w.behind, open: w.open !== null, falling: w.falling,
      lit: bar ? bar.querySelectorAll('.is-lit').length : 0,
      going: bar ? bar.querySelectorAll('.is-going').length : 0,
      glint: !!chip?.querySelector('.aheadtxt.is-glint'),
      limit: !!chip?.classList.contains('is-limit'),
      box: r ? [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100).join(' ') : '',
      total: window.__store.getState().events.length,
      warn: Number(getComputedStyle(document.querySelector('.syncwarn')).opacity),
    }
  })
  const turn = async (i) => {
    const key = keys[i % keys.length]
    await page.keyboard.down(key)
    await page.waitForTimeout(hold)
    await page.keyboard.up(key)
    await page.waitForTimeout(gap)
    return state()
  }
  /** Stand until every move has landed and the bar has gone; `each` sees every poll. */
  const stand = async (each = () => {}) => {
    for (let i = 0; i < 1800; i++) {
      const s = await state()
      await each(s)
      if (s.lit === 0 && s.behind === 0 && !s.open && !s.falling) break
      await page.waitForTimeout(100)
    }
    await page.waitForTimeout(2600)
  }
  const place = (box) => { const [x, y, , h] = box.split(' '); return `${x} ${y} ${h}` }
  // A played-in chain first, at the proofs' own speed.
  const chain = Number(process.env.CHAIN ?? 0)
  for (let i = 0; i < 900 && (await state()).total < chain; i++) await turn(i)
  if (chain) await stand()
  const from = (Date.now() - born) / 1000
  if (lag) await page.evaluate((ms) => { window.__proofLag = ms }, lag)
  const start = await state()
  let top = 0
  let moved = false
  const log = []
  for (let i = 0; i < steps; i++) {
    const s = await turn(i)
    top = Math.max(top, s.lit)
    log.push(s.lit)
    // Its left, top and height: the width follows the total's digits, as it always has.
    if (place(s.box) !== place(start.box)) moved = true
    if (s.lit >= 3 && s.lit <= 9) await shot('1-filling')
    if (s.lit >= 15 && s.lit <= 19) await shot('2-amber')
    if (s.limit) { await page.waitForTimeout(1200); await shot('3-red-20'); await page.waitForTimeout(1500); break }
  }
  // Standing still: the proofs land, the ticks fold away and the total glints.
  if (lag && process.env.LAND !== undefined) await page.evaluate((ms) => { window.__proofLag = ms }, Number(process.env.LAND))
  let landings = 0
  let wasTotal = (await state()).total
  await stand(async (s) => {
    if (s.total > wasTotal) { landings += s.total - wasTotal; wasTotal = s.total }
    if (s.going > 0 && s.glint && s.lit > 0 && s.lit < 15) await shot('4-landing')
  })
  const to = (Date.now() - born) / 1000
  const end = await state()
  await shot('5-caught-up')
  console.log(`walk: top ${top} ahead, ${start.total} to ${end.total} actions, ${landings} landed while standing, sent to the stand-in relay: ${JSON.stringify(sent)}`)
  console.log(`walk video: the walk is from ${Math.max(0, from - 1).toFixed(1)} s to ${to.toFixed(1)} s`)
  console.log(`walk counts per turn: ${log.join(' ')}`)
  check(top >= 1, `walk: the bar filled (top ${top})`)
  check(!moved && place(end.box) === place(start.box), `walk: the chip kept its place and height throughout (${start.box} to ${end.box})`)
  check(end.lit === 0 && !(await page.evaluate(() => !!document.querySelector('.aheadbar'))), 'walk: caught up, the bar is gone')
  check(sent.length === 0, `walk: nothing was sent to a relay (${sent.length})`)
  const video = page.video()
  await ctx.close()
  if (video) fs.renameSync(await video.path(), `${out}/walk.webm`)
}

if (process.env.WALK) await walk()
else {
  await layout('phone', { viewport: { width: 375, height: 812 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true })
  await layout('desktop', { viewport: { width: 1280, height: 720 } })
  // A long chain's chip, as wide as the design drew it.
  await layout('phone-long', { viewport: { width: 375, height: 812 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true }, Number(process.env.PAD ?? 12345))
  await reduced()
}
await browser.close()
console.log(fails.length ? `\n${fails.length} FAILED:\n${fails.join('\n')}` : '\nall checks passed')
process.exit(fails.length ? 1 : 0)
