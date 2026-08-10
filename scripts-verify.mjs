/**
 * onosendai-verify.mjs — drive the app in a real browser and report timings.
 *
 * Usage: PLAYWRIGHT_BROWSERS_PATH=... node onosendai-verify.mjs <url>
 */
import { chromium } from '/data/repos/onosendai-v2/node_modules/playwright/index.mjs'

const url = process.argv[2] ?? 'http://localhost:5173'
const shots = '/data/Sync/agents/claude/shots'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

const logs = []
page.on('console', (m) => logs.push({ t: Date.now(), text: m.text() }))
page.on('pageerror', (e) => logs.push({ t: Date.now(), text: `PAGEERROR: ${e.message}` }))

const t0 = Date.now()
await page.goto(url, { waitUntil: 'load' })

/** Points currently in the terrain buffer, read straight off the GL geometry. */
async function pointCount() {
  return page.evaluate(() => {
    const c = document.querySelector('canvas')
    return c ? (window.__terrainPoints ?? -1) : -1
  })
}

async function settle(label, budgetMs = 15000) {
  const start = Date.now()
  let last = -1, stableFor = 0
  while (Date.now() - start < budgetMs) {
    const n = await pointCount()
    if (n === last && n > 0) {
      stableFor += 250
      if (stableFor >= 750) break
    } else {
      stableFor = 0
      last = n
    }
    await page.waitForTimeout(250)
  }
  const ms = Date.now() - start
  console.log(`${label}: ${last} points, settled in ~${ms}ms`)
  return { points: last, ms }
}

console.log(`--- load (${url})`)
const load = await settle('initial load')
await page.screenshot({ path: `${shots}/01-load.png` })

console.log('--- zoom out x3 (Q)')
const zt = Date.now()
for (let i = 0; i < 3; i++) { await page.keyboard.press('q'); await page.waitForTimeout(120) }
const zoomOut = await settle('after zoom out')
console.log(`zoom-out wall clock: ${Date.now() - zt}ms`)
await page.screenshot({ path: `${shots}/02-zoomout.png` })

console.log('--- zoom back in x3 (E) -- should be a cache hit')
const it = Date.now()
for (let i = 0; i < 3; i++) { await page.keyboard.press('e'); await page.waitForTimeout(120) }
const zoomIn = await settle('after zoom in')
console.log(`zoom-in wall clock: ${Date.now() - it}ms`)
await page.screenshot({ path: `${shots}/03-zoomin.png` })

console.log('\n--- console (first 60) ---')
for (const l of logs.slice(0, 60)) console.log(`+${String(l.t - t0).padStart(6)}ms ${l.text}`)
console.log(`\n(${logs.length} console lines total)`)
console.log('errors:', logs.filter((l) => /error|failed|uncaught/i.test(l.text)).length)

await browser.close()
console.log(JSON.stringify({ load, zoomOut, zoomIn }))
