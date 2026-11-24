/**
 * menuGapScroll.test.ts - a wheel over the gap between two menu panels
 * scrolls the menu and never zooms the scene (owner, 2026-11-24: "if I
 * position my cursor between menu panels I zoom instead of scroll"); over
 * the scene beside the menu, the wheel still reaches the canvas and zooms.
 *
 * Measured in headless Chromium (playwright) with the app's own stylesheet:
 * a canvas under the .hud, the two columns of panels over it, and a real
 * wheel from the mouse. The canvas counts the wheels and presses it hears,
 * as OrbitControls' zoom and the scene's taps would. Three layouts: beside
 * the scene on a desktop (each column scrolls itself), a narrow desktop
 * window (the columns stack and the .hud scrolls), and a phone with the menu
 * open (.hud--menu). Nothing is fetched: the page is set from a string.
 *
 * Skipped, saying so, where Playwright's Chromium is not installed (set
 * PLAYWRIGHT_BROWSERS_PATH to where it is).
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser } from 'playwright'

const CSS = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8')
const HAVE_CHROMIUM = (() => { try { return existsSync(chromium.executablePath()) } catch { return false } })()
if (!HAVE_CHROMIUM) console.warn('menuGapScroll: Playwright Chromium is not installed here; the menu wheel test is skipped')

/** Enough panels that every column overflows the screen and can scroll. */
const PANELS = Array.from({ length: 14 }, (_, i) =>
  `<div class="slot" data-panel-id="p${i}"><section class="panel"><header class="panel__head"><h2>PANEL ${i}</h2></header><div style="height:120px"></div></section></div>`).join('')

/** The scene's canvas under the menu as App.tsx lays them out, the menu open or beside it. */
function page(menu: boolean): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>`
    + '<body style="margin:0"><div class="app" style="position:fixed;inset:0">'
    + '<canvas id="scene" style="position:absolute;inset:0;width:100%;height:100%"></canvas>'
    + `<div id="hud" class="hud${menu ? ' hud--menu' : ''}">`
    + `<div id="left" class="hud__col hud__col--left" data-column="left"><div class="brand"><p>ONOSENDAI</p></div>${PANELS}</div>`
    + `<div id="right" class="hud__col hud__col--right" data-column="right">${PANELS}</div>`
    + '</div></div><script>'
    + 'window.zooms = 0; window.presses = 0;'
    + "const c = document.getElementById('scene');"
    + "c.addEventListener('wheel', () => { window.zooms++ }, { passive: true });"
    + "c.addEventListener('pointerdown', () => { window.presses++ });"
    + '</script></body></html>'
}

const LAYOUTS = [
  { name: 'beside the scene on a desktop', viewport: { width: 1600, height: 900 }, menu: false, scroller: 'left', scene: true },
  { name: 'stacked in a narrow desktop window', viewport: { width: 1000, height: 800 }, menu: false, scroller: 'hud', scene: false },
  { name: 'open on a phone', viewport: { width: 390, height: 844 }, menu: true, scroller: 'hud', scene: false },
] as const

describe.skipIf(!HAVE_CHROMIUM)('the wheel over the menu in a real browser', () => {
  let browser: Browser
  beforeAll(async () => { browser = await chromium.launch() }, 30_000)
  afterAll(async () => { await browser?.close() })

  for (const { name, viewport, menu, scroller, scene } of LAYOUTS) {
    it(`${name}: a wheel between two panels scrolls the menu and does not zoom; a tap there does not reach the scene`, async () => {
      const ctx = await browser.newContext({ viewport, hasTouch: menu })
      try {
        const p = await ctx.newPage()
        await p.route('**/*', (r) => r.abort())
        await p.setContent(page(menu))
        // The middle of the 12px gap between the second and third panels of the left column.
        const gap = await p.evaluate(() => {
          const a = document.querySelector('#left [data-panel-id=p1]')!.getBoundingClientRect()
          const b = document.querySelector('#left [data-panel-id=p2]')!.getBoundingClientRect()
          return { x: a.left + a.width / 2, y: (a.bottom + b.top) / 2, height: b.top - a.bottom }
        })
        expect(gap.height).toBeGreaterThan(4)
        const top = (): Promise<number> => p.evaluate((id) => document.getElementById(id)!.scrollTop, scroller)
        expect(await top()).toBe(0)
        await p.mouse.move(gap.x, gap.y)
        await p.mouse.wheel(0, 300)
        await expect.poll(top).toBeGreaterThan(0)
        expect(await p.evaluate(() => (window as unknown as { zooms: number }).zooms)).toBe(0)
        // Scrolled, the point may sit over a panel now; scroll back so it is in the gap again.
        await p.evaluate((id) => { document.getElementById(id)!.scrollTop = 0 }, scroller)
        await p.mouse.click(gap.x, gap.y)
        expect(await p.evaluate(() => (window as unknown as { presses: number }).presses)).toBe(0)

        if (scene) {
          // Between the two columns is the scene: the wheel reaches the canvas and zooms.
          await p.mouse.move(viewport.width / 2, viewport.height / 2)
          await p.mouse.wheel(0, 300)
          await expect.poll(() => p.evaluate(() => (window as unknown as { zooms: number }).zooms)).toBe(1)
          await p.mouse.click(viewport.width / 2, viewport.height / 2)
          expect(await p.evaluate(() => (window as unknown as { presses: number }).presses)).toBe(1)
        }
      } finally {
        await ctx.close()
      }
    }, 30_000)
  }

  it('a desktop menu short enough to end above the foot of the screen leaves the scene under it zooming', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } })
    try {
      const p = await ctx.newPage()
      await p.route('**/*', (r) => r.abort())
      await p.setContent(page(false))
      // Two panels in the left column: it ends well above the bottom.
      await p.evaluate(() => { document.querySelectorAll('#left .slot:nth-of-type(n+3)').forEach((s) => s.remove()) })
      const below = await p.evaluate(() => {
        const r = document.getElementById('left')!.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.bottom + 40, bottom: r.bottom }
      })
      expect(below.bottom).toBeLessThan(600)
      await p.mouse.move(below.x, below.y)
      await p.mouse.wheel(0, 300)
      await expect.poll(() => p.evaluate(() => (window as unknown as { zooms: number }).zooms)).toBe(1)
    } finally {
      await ctx.close()
    }
  }, 30_000)
})
