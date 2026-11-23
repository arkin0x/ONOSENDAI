/**
 * viewAtRowLayout.test.ts - VIEW A COORDINATE's row keeps the box, VIEW and
 * the dice on one line (arkinox, 2026-11-18), measured in a real browser.
 *
 * The panel is rendered as the app renders it, inside the menu column, with
 * the app's own stylesheet, in headless Chromium (playwright) at a 375 px
 * phone and a desktop window. On both: the three sit on one line, inside the
 * row, nothing overflows the row or the panel, and FINDING in place of VIEW
 * moves nothing. Nothing is fetched: the page is set from a string.
 *
 * Skipped, saying so, where Playwright's Chromium is not installed (set
 * PLAYWRIGHT_BROWSERS_PATH to where it is).
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { chromium, type Browser } from 'playwright'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { ViewAtPanel, useViewDraft } from '../Hud'

const CSS = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8')
const HAVE_CHROMIUM = (() => { try { return existsSync(chromium.executablePath()) } catch { return false } })()
if (!HAVE_CHROMIUM) console.warn('viewAtRowLayout: Playwright Chromium is not installed here; the row layout test is skipped')

/** The View panel in the menu's right column, as the app nests it. */
function page(text: string): string {
  useViewDraft.getState().setText(text)
  const panel = renderToString(createElement(ViewAtPanel))
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>`
    + `<body><div class="hud hud--menu"><div class="hud__col hud__col--right"><div class="slot" data-panel-id="viewat">${panel}</div></div></div></body></html>`
}

interface Measure {
  oneLine: boolean
  inside: boolean
  rowOverflow: number
  panelOverflow: number
  docOverflow: number
  widths: number[]
}

describe.skipIf(!HAVE_CHROMIUM)('the VIEW A COORDINATE row in a real browser', () => {
  let browser: Browser
  beforeAll(async () => { browser = await chromium.launch() }, 30_000)
  afterAll(async () => { await browser?.close() })

  for (const [name, viewport] of [['a 375 px phone', { width: 375, height: 812 }], ['a desktop window', { width: 1440, height: 900 }]] as const) {
    for (const text of ['', 'f'.repeat(64)]) {
      it(`on ${name}, ${text ? 'with a coordinate typed' : 'empty'}: one line, nothing overflows, and FINDING moves nothing`, async () => {
        const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
        try {
          const p = await ctx.newPage()
          await p.route('**/*', (r) => r.abort())
          await p.setContent(page(text))
          const measure = (): Promise<Measure> => p.evaluate(() => {
            const row = document.querySelector('form.viewat__find') as HTMLElement
            const kids = Array.from(row.children) as HTMLElement[]
            const r = row.getBoundingClientRect()
            const boxes = kids.map((k) => k.getBoundingClientRect())
            const panel = row.closest('.panel') as HTMLElement
            return {
              oneLine: kids.length === 3 && boxes.every((b) => Math.abs(b.top - boxes[0].top) < 1),
              inside: boxes.every((b) => b.left >= r.left - 0.5 && b.right <= r.right + 0.5 && b.width > 0),
              rowOverflow: row.scrollWidth - row.clientWidth,
              panelOverflow: panel.scrollWidth - panel.clientWidth,
              docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              widths: boxes.map((b) => Math.round(b.width * 10) / 10),
            }
          })
          const before = await measure()
          expect(before.oneLine).toBe(true)
          expect(before.inside).toBe(true)
          expect(before.rowOverflow).toBeLessThanOrEqual(0)
          expect(before.panelOverflow).toBeLessThanOrEqual(0)
          expect(before.docOverflow).toBeLessThanOrEqual(0)
          // The box shrinks so the buttons keep their room: VIEW and the dice are wide enough to tap.
          expect(before.widths[1]).toBeGreaterThanOrEqual(64)
          expect(before.widths[2]).toBeGreaterThanOrEqual(36)
          expect(before.widths[0]).toBeGreaterThan(100)
          // A place being looked up says FINDING where VIEW was; nothing moves.
          await p.evaluate(() => { (document.querySelector('form.viewat__find button[type=submit]') as HTMLElement).textContent = 'FINDING' })
          const finding = await measure()
          expect(finding.widths).toEqual(before.widths)
          expect(finding.rowOverflow).toBeLessThanOrEqual(0)
          const label = await p.evaluate(() => {
            const b = document.querySelector('form.viewat__find button[type=submit]') as HTMLElement
            return b.scrollWidth - b.clientWidth
          })
          expect(label).toBeLessThanOrEqual(0)
        } finally {
          await ctx.close()
        }
      }, 30_000)
    }
  }
})
