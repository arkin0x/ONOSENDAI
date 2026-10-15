/**
 * demo-rehearse.mjs: walk the whole /demo tour in a real (headed) browser
 * and record, step by step, whether the scene, the waits, the keys, SPEAK
 * and EXIT behave, plus screenshots and any control the coach covers.
 *
 *   DISPLAY=:97 node scripts/demo-rehearse.mjs <base url> <out dir> <phone|desktop> <steps.json>
 *
 * Never publishes. Every relay frame starting with ["EVENT" or ["AUTH" is
 * dropped and counted. The canonical relay (AUTH-gated for reads) is
 * answered by a stand-in here, so a LOCAL hop can confirm its head; the
 * other relays are read for real. Non-GET requests off localhost are
 * refused, so nothing is paid or posted.
 *
 * Runs, in one browser context (one throwaway identity):
 *   A. a brand-new identity: keys, SPEAK, then every step in order, doing
 *      each step's action (SPAWN, the aimed first hop, a hop on the chain
 *      step, WALK, scan, open an item);
 *   B. the same identity, now with a short LOCAL chain, entered with the
 *      switch on LIVE, to check the tour forces LOCAL and EXIT restores LIVE;
 *   C. every deep link /demo/<id>.
 * Writes <out>/<label>-report.json.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'
import { coordToXyz, hexToCoord } from 'cyberspace-core'

const [base, out, label, stepsFile] = process.argv.slice(2)
fs.mkdirSync(out, { recursive: true })
const { steps, district } = JSON.parse(fs.readFileSync(stepsFile, 'utf8'))
const viewport = label === 'phone' ? { width: 412, height: 915 } : { width: 1920, height: 1080 }
const CANON = /cyberspace\.nostr1\.com/
const dropped = { EVENT: 0, AUTH: 0 }
const consoleErrors = []
const report = { label, viewport, runs: {}, keys: {}, speak: {}, exit: {}, deepLinks: [], dropped, consoleErrors }

const browser = await chromium.launch({
  headless: false,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--window-size=${viewport.width},${viewport.height + 120}`],
})
const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...(label === 'phone' ? { isMobile: true, hasTouch: true } : {}) })
await ctx.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => (r.request().method() === 'GET' ? r.continue() : r.abort()))
await ctx.routeWebSocket(/.*/, (ws) => {
  if (/localhost|127\.0\.0\.1/.test(ws.url())) { ws.connectToServer(); return }
  const kind = (raw) => { try { const m = JSON.parse(String(raw)); return Array.isArray(m) ? m : null } catch { return null } }
  if (CANON.test(ws.url())) {
    ws.onMessage((raw) => {
      const m = kind(raw)
      if (!m) return
      if (m[0] === 'EVENT') { dropped.EVENT++; return }
      if (m[0] === 'AUTH') { dropped.AUTH++; return }
      if (m[0] === 'REQ') ws.send(JSON.stringify(['EOSE', m[1]]))
    })
    return
  }
  const server = ws.connectToServer()
  ws.onMessage((raw) => {
    const m = kind(raw)
    if (m && m[0] === 'EVENT') { dropped.EVENT++; return }
    if (m && m[0] === 'AUTH') { dropped.AUTH++; return }
    server.send(raw)
  })
  server.onMessage((raw) => ws.send(raw))
})
await ctx.addInitScript(() => {
  try { if (localStorage.getItem('onosendai:live') === null) localStorage.setItem('onosendai:live', '0') } catch { /* private */ }
  // SPEAK is observed, not heard: what the tour asks the synthesizer to say, and with which voice.
  try {
    const real = window.speechSynthesis.speak.bind(window.speechSynthesis)
    window.__spoken = []
    window.speechSynthesis.speak = (u) => { window.__spoken.push({ text: u.text.slice(0, 60), voice: u.voice ? u.voice.name : null, rate: u.rate, pitch: u.pitch }); real(u) }
  } catch { /* no speech */ }
})
const page = await ctx.newPage()
let stepTag = 'boot'
page.on('pageerror', (e) => consoleErrors.push({ step: stepTag, kind: 'pageerror', text: e.message.slice(0, 300) }))
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ step: stepTag, kind: 'console', text: m.text().slice(0, 300) }) })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** A screenshot that never ends the run: a renderer too busy to answer is recorded, not fatal. */
async function shot(path) {
  for (let i = 0; i < 2; i++) {
    try { await page.screenshot({ path, timeout: 60_000 }); return true } catch { await sleep(3000) }
  }
  return false
}
const saveReport = () => fs.writeFileSync(`${out}/${label}-report.json`, JSON.stringify(report, null, 1))

async function state() {
  return page.evaluate(() => {
    const s = window.__store?.getState()
    if (!s) return null
    const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z
    return {
      pubkey: s.identity.pubkey,
      focus: s.focus?.label ?? null,
      scale: s.scaleExp,
      atHeadView: same(s.anchor, s.position) && s.focus === null,
      anchor: { x: s.anchor.x.toString(), y: s.anchor.y.toString(), z: s.anchor.z.toString() },
      plane: s.anchorPlane,
      walking: !!s.walking,
      live: s.live,
      events: s.events.length,
      spectate: !!s.spectate,
      path: location.pathname,
    }
  })
}

async function dom() {
  return page.evaluate(() => {
    const q = (sel) => document.querySelector(sel)
    const t = (sel) => q(sel)?.textContent?.trim() ?? null
    const coach = q('.demo')
    const rect = coach?.getBoundingClientRect()
    // A control outside the coach whose centre the coach (or nothing at all) covers.
    const covered = []
    if (coach) {
      for (const el of document.querySelectorAll('button, [role="button"], a, input, textarea')) {
        if (coach.contains(el)) continue
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue
        if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2
        const hit = document.elementFromPoint(cx, cy)
        if (hit && coach.contains(hit)) covered.push((el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).toString().trim().slice(0, 40))
      }
    }
    // Instrument chips that overlap the pad or the commit row.
    const inst = [...document.querySelectorAll('.instruments > *, .instruments__group > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0)
    const blocks = [...document.querySelectorAll('.touchpad, .touchops')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0)
    const inter = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
    const stackOnPad = inst.some((a) => blocks.some((b) => inter(a, b)))
    return {
      active: !!coach,
      title: t('.demo__title'),
      progress: t('.demo__progress'),
      wait: t('.demo__wait'),
      next: t('.demo__btn--next'),
      caption: t('.demo__caption'),
      panel: (q('.demo__panel')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null,
      toast: [...document.querySelectorAll('.toast, .toastchip, [class*="toast"]')].map((e) => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 160) || null,
      coachRect: rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom), left: Math.round(rect.left), right: Math.round(rect.right), h: Math.round(rect.height) } : null,
      covered,
      stackOnPad,
      speakShown: [...document.querySelectorAll('.demo__btn')].some((b) => /SPEAK|STOP/.test(b.textContent)),
    }
  })
}

const spawnOf = (pubkey) => { const c = coordToXyz(hexToCoord(pubkey)); return { x: c.x.toString(), y: c.y.toString(), z: c.z.toString(), plane: c.plane } }
const districtXyz = (() => { const c = coordToXyz(hexToCoord(district.coord)); return { x: c.x.toString(), y: c.y.toString(), z: c.z.toString(), plane: c.plane } })()
const sameXyz = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z

function judgeScene(step, st, d, prev) {
  const issues = []
  const t = step.target
  if (t === 'self' && !st.atHeadView && !st.walking) issues.push(`expected your own position, focus=${st.focus}`)
  if (t === 'spawn') {
    const sp = spawnOf(st.pubkey)
    if (!sameXyz(st.anchor, sp)) issues.push('not at your spawn coordinate')
  }
  if (t === 'district' && !(sameXyz(st.anchor, districtXyz) && st.plane === districtXyz.plane)) issues.push(`not at the district (focus=${st.focus})`)
  if (t && typeof t === 'object' && 'block' in t && !/BLOCK/i.test(`${st.focus ?? ''} ${d.toast ?? ''}`)) issues.push(`block not named (focus=${st.focus}, toast=${d.toast})`)
  if (t === 'keep' && prev && !sameXyz(st.anchor, prev.anchor)) issues.push('keep moved the view')
  if (step.scale !== undefined && st.scale !== step.scale) issues.push(`scale ${st.scale}, want ${step.scale}`)
  if (st.live !== false) issues.push(`not LOCAL (live=${st.live})`)
  if (d.title !== step.title) issues.push(`title "${d.title}" != "${step.title}"`)
  if (d.covered.length) issues.push(`coach covers: ${d.covered.join(', ')}`)
  if (d.stackOnPad) issues.push('chip stack overlaps the pad')
  return issues
}

async function waitDone(ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const w = await page.evaluate(() => document.querySelector('.demo__wait')?.textContent ?? '')
    if (/Done/.test(w)) return true
    await sleep(500)
  }
  return false
}

async function doAction(step) {
  // SPAWN, offered only to the key the tour generated (a gated step).
  if (step.wait === 'spawn') {
    const b = page.locator('.demo__btn--spawn')
    if (await b.count()) await b.click({ timeout: 10_000 }).catch(() => {})
    return waitDone(30_000)
  }
  // The verify step has aimed the cursor already: COMMIT it.
  if (step.wait === 'own-hop') {
    const commit = page.locator('.touchops__commit', { hasText: 'COMMIT' }).first()
    if (await commit.waitFor({ timeout: 20_000 }).then(() => true, () => false)) await commit.click({ timeout: 10_000 }).catch(() => {})
    return waitDone(90_000)
  }
  if (step.wait === 'hop') {
    // Line up one cell to the right, then COMMIT from the pad.
    await page.keyboard.press('KeyD')
    // Click what a visitor sees: the slot reads COMMIT once the cursor is lined up.
    const commit = page.locator('.touchops__commit', { hasText: 'COMMIT' }).first()
    const ready = await commit.waitFor({ timeout: 20_000 }).then(() => true, () => false)
    if (ready) await commit.click({ timeout: 10_000 }).catch(() => {})
    if (await waitDone(90_000)) return true
    await page.keyboard.press('Space') // the keyboard's COMMIT
    return waitDone(90_000)
  }
  if (step.wait === 'walk') {
    for (let i = 0; i < 3; i++) {
      const walking = await page.evaluate(() => window.__store.getState().walking)
      if (walking) break
      const b = page.locator('.touchops__commit').first()
      if (await b.count()) await b.click({ timeout: 5000 }).catch(() => {})
      await sleep(900)
    }
    return waitDone(10_000)
  }
  if (step.wait === 'scan') return waitDone(90_000)
  if (step.wait === 'open-item') {
    // Open the first found thing, if the district holds any.
    const opened = await page.evaluate(() => {
      const sh = window.__shards?.getState?.()
      const first = sh ? Object.keys(sh.discovered ?? {})[0] : undefined
      if (first && sh.selectSecret) { sh.selectSecret(first); return true }
      return false
    })
    if (!opened) return false
    const ok = await waitDone(5000)
    await page.keyboard.press('Escape').catch(() => {})
    return ok
  }
  return true
}

async function runTour(run) {
  const rows = []
  let prev = null
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    stepTag = `${run}:${step.id}`
    const settle = typeof step.target === 'object' || step.target === 'district' ? 6000 : 2500
    await sleep(settle)
    // A block step names its stop once the line has synced; a presenter's
    // laptop has synced long before chapter 7, so the rehearsal waits too.
    if (step.target && typeof step.target === 'object' && 'block' in step.target) {
      await page.waitForFunction(() => /BLOCK/.test(window.__store?.getState().focus?.label ?? ''), null, { timeout: 480_000 }).catch(() => {})
      await sleep(2000)
    }
    let st = await state()
    let d = await dom()
    const issues = judgeScene(step, st, d, prev)
    const nn = String(i + 1).padStart(2, '0')
    const shotOk = await shot(`${out}/${label}-${run}-${nn}-${step.id}.png`)
    let action = null
    if (step.wait) {
      const t0 = Date.now()
      const ok = await doAction(step)
      action = { wait: step.wait, done: ok, seconds: Math.round((Date.now() - t0) / 1000) }
      if (!ok) issues.push(`wait ${step.wait} not completed (NEXT reads ${(await dom()).next})`)
      await shot(`${out}/${label}-${run}-${nn}-${step.id}-after.png`)
      st = await state()
      d = await dom()
    }
    if (!shotOk) issues.push('screenshot timed out (renderer busy)')
    rows.push({ i: i + 1, id: step.id, chapter: step.chapter, issues, action, focus: st.focus, scale: st.scale, walking: st.walking, events: st.events, caption: d.caption, panel: d.panel, toast: d.toast, coachH: d.coachRect?.h ?? null })
    prev = st
    report.runs[run] = { ...(report.runs[run] ?? {}), rows }
    saveReport()
    if (i < steps.length - 1) {
      await page.locator('.demo__btn--next').click()
    }
  }
  return rows
}

// ---- Run A: brand-new identity ------------------------------------------
await page.goto(`${base}/demo`, { waitUntil: 'load' })
await page.waitForFunction(() => !!document.querySelector('.demo__title'), null, { timeout: 60_000 })
await sleep(3000)

// Keys: ArrowRight, ArrowLeft, Space on a reading step.
{
  stepTag = 'keys'
  const t0 = (await dom()).title
  await page.keyboard.press('ArrowRight'); await sleep(800)
  const t1 = (await dom()).title
  await page.keyboard.press('ArrowLeft'); await sleep(800)
  const t2 = (await dom()).title
  await page.keyboard.press('Space'); await sleep(800)
  const t3 = (await dom()).title
  await page.keyboard.press('ArrowLeft'); await sleep(800)
  report.keys = { start: t0, afterRight: t1, afterLeft: t2, afterSpace: t3, ok: t1 === steps[1].title && t2 === steps[0].title && t3 === steps[1].title }
}
// SPEAK on the first step.
{
  stepTag = 'speak'
  const voices = await page.evaluate(() => (window.speechSynthesis?.getVoices?.() ?? []).map((v) => `${v.name} (${v.lang})`))
  const btn = page.locator('.demo__btn', { hasText: 'SPEAK' })
  const shown = await btn.count()
  if (shown) await btn.click()
  await sleep(2500)
  const spoken = await page.evaluate(() => window.__spoken ?? [])
  const label2 = shown ? await page.locator('.demo__foot .demo__btn').nth(1).textContent() : null
  report.speak = { shown: shown > 0, voices: voices.slice(0, 20), voiceCount: voices.length, spoken, buttonAfter: label2?.trim() ?? null }
  // Stop if still reading.
  const stop = page.locator('.demo__btn', { hasText: 'STOP' })
  if (await stop.count()) await stop.click()
}
const startState = await state()
report.runs.A = { pubkey: startState.pubkey.slice(0, 12) }
report.runs.A.rows = await runTour('A')
saveReport()
// Space on the walk step must not advance (it is a movement key there).
{
  stepTag = 'space-on-walk'
  await page.goto(`${base}/demo/walk`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!document.querySelector('.demo__title'), null, { timeout: 60_000 })
  await sleep(2500)
  const before = (await dom()).title
  await page.keyboard.press('Space'); await sleep(1200)
  const after = (await dom()).title
  report.keys.spaceOnWalkStays = before === after
}
// EXIT from the last step: FINISH ends the tour, LOCAL stays (it was LOCAL), view cleared, address back to /.
{
  stepTag = 'exit-A'
  await page.goto(`${base}/demo/live`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!document.querySelector('.demo__title'), null, { timeout: 60_000 })
  await sleep(2500)
  await page.locator('.demo__btn--next').click()
  await sleep(1500)
  const st = await state(); const d = await dom()
  report.exit.A = { coachGone: !d.active, live: st.live, focus: st.focus, path: st.path, ok: !d.active && st.live === false && st.focus === null && st.path === '/' }
}

// ---- Run B: short LOCAL chain, entered from LIVE ---------------------------
{
  stepTag = 'B-setup'
  await page.evaluate(() => { try { localStorage.setItem('onosendai:live', '1') } catch {} })
  await page.goto(`${base}/demo`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!document.querySelector('.demo__title'), null, { timeout: 60_000 })
  await sleep(3000)
  const st = await state()
  report.runs.B = { enteredLiveForcedLocal: st.live === false, events: st.events }
  report.runs.B.rows = await runTour('B')
  saveReport()
  // X exits mid-tour from wherever it ended (the last step): back to LIVE.
  stepTag = 'exit-B'
  await page.goto(`${base}/demo/spawn`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!document.querySelector('.demo__title'), null, { timeout: 60_000 })
  await sleep(2500)
  await page.locator('.demo__icon[aria-label="Exit the tour"]').click()
  await sleep(1500)
  const after = await state(); const d = await dom()
  report.exit.B = { coachGone: !d.active, live: after.live, focus: after.focus, path: after.path, ok: !d.active && after.live === true && after.focus === null && after.path === '/' }
  // Back to LOCAL before anything else (EVENT frames are dropped regardless).
  await page.evaluate(() => window.__store.getState().setLive(false))
}

// ---- Run C: deep links ----------------------------------------------------
for (const step of steps) {
  stepTag = `deep:${step.id}`
  await page.goto(`${base}/demo/${step.id}`, { waitUntil: 'load' })
  const ok = await page.waitForFunction((title) => document.querySelector('.demo__title')?.textContent?.trim() === title, step.title, { timeout: 30_000 }).then(() => true, () => false)
  report.deepLinks.push({ id: step.id, ok })
}

fs.writeFileSync(`${out}/${label}-report.json`, JSON.stringify(report, null, 1))
await browser.close()
const bad = (rows) => rows.filter((r) => r.issues.length).length
console.log(JSON.stringify({ label, A_bad: bad(report.runs.A.rows), B_bad: bad(report.runs.B.rows), keys: report.keys, speak: { shown: report.speak.shown, voiceCount: report.speak.voiceCount, spoken: report.speak.spoken.length }, exit: report.exit, deepBad: report.deepLinks.filter((x) => !x.ok).map((x) => x.id), dropped, errors: consoleErrors.length }))
