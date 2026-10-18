import fs from 'node:fs'
import { launch } from './smoke-lib.mjs'
const [base, tapeFile, out] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const all = fs.readFileSync(tapeFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const seed = all.filter((e) => [3333, 33330, 33331, 1111, 7, 11333].includes(e.kind))
const pick = {
  ad: all.find((e) => e.kind === 33331 && !e.tags.some((t) => t[0] === 'encrypted') && e.tags.find((t) => t[0] === 'd')?.[1] !== 'avatar' && e.content.length > 50),
  comment: all.filter((e) => e.kind === 1111 && e.tags.some((t) => t[0] === 'K' && t[1] === '3333')).sort((a, b) => b.content.length - a.content.length)[0],
  bag: all.find((e) => e.kind === 33330 && !e.tags.some((t) => t[0] === 'hint')),
}
const [vw, vh] = process.env.VP.split('x').map(Number)
const { browser, page, stats } = await launch({ phone: process.env.PHONE === '1', url: base, seed })
await page.route((u) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.toString()), (r) => r.abort())
await page.setViewportSize({ width: vw, height: vh })
await page.goto(`${base}/tv`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__tvPainter, null, { timeout: 120_000 })
const url = (re, d) => page.evaluate(([re, d]) => performance.getEntriesByType('resource').map((e) => e.name).find((x) => new RegExp(re).test(x)) ?? d, [re, d])
const [a, b] = [await url('/src/store/useTv\\.ts', '/src/store/useTv.ts'), await url('/src/lib/tv/tape\\.ts', '/src/lib/tv/tape.ts')]
await page.evaluate(async ([a, b]) => { window.__tvm = await import(a); window.__tape = await import(b) }, [a, b])
await page.waitForFunction(() => window.__tvm.useTv.getState().status === 'playing', null, { timeout: 120_000, polling: 300 })
// Paint cost with and without the minimap, on the same frame.
const cost = await page.evaluate(() => {
  const p = window.__tvPainter
  const timeIt = (n) => { const args = p.__last; const t = performance.now(); for (let i = 0; i < n; i++) p.paint(...args); return (performance.now() - t) / n }
  return new Promise((res) => {
    const o = p.paint.bind(p)
    p.paint = (...args) => { p.__last = args; o(...args) }
    setTimeout(() => {
      p.paint = o
      const withMap = timeIt(30)
      const mm = p.minimap; p.minimap = () => {}
      const without = timeIt(30)
      p.minimap = mm
      res({ withMapMs: +withMap.toFixed(2), withoutMapMs: +without.toFixed(2), canvas: [p.canvas.width, p.canvas.height] })
    }, 1500)
  })
})
console.log(`${vw}x${vh} paint`, JSON.stringify(cost))
await page.screenshot({ path: `${out}/m-${vw}x${vh}-trip.png` })
for (const n of (process.env.ONLY ?? 'comment,ad,bag').split(',')) {
  await page.evaluate((ev) => window.__tvm.cueItem(window.__tape.itemOf(ev), 400), pick[n])
  await page.waitForFunction((id) => window.__tvm.useTv.getState().shot?.id === id, pick[n].id, { timeout: 120_000, polling: 150 })
  await page.waitForFunction((s) => window.__tvm.shotProgress() * 400 >= s, n === 'comment' ? 13 : 4, { timeout: 180_000, polling: 200 })
  await sleep(800)
  await page.screenshot({ path: `${out}/m-${vw}x${vh}-${n}.png` })
}
console.log('EVENTS', stats.events)
await browser.close()
