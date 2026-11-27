/**
 * miningPanelLayout.test.ts - MINING (owner, 2026-11-27), rendered as the
 * app renders it inside the menu column with the app's own stylesheet, in
 * headless Chromium (playwright), at a 375 px phone and a desktop window,
 * with real counts. Nothing overflows the panel or the page, every number
 * and every label shows whole, and the sync line is there. Nothing is
 * fetched: the page is set from a string, and every request is refused.
 *
 * Skipped, saying so, where Playwright's Chromium is not installed.
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

import { MiningPanel } from '../MiningPanel'
import { useCyberspace } from '../../store/useCyberspace'
import { addTerrainTime, noteMining, setMiningDeps } from '../../store/miningStats'

const CSS = readFileSync(fileURLToPath(new URL('../../styles.css', import.meta.url)), 'utf8')
const HAVE_CHROMIUM = (() => { try { return existsSync(chromium.executablePath()) } catch { return false } })()
if (!HAVE_CHROMIUM) console.warn('miningPanelLayout: Playwright Chromium is not installed here; the layout test is skipped')

/** The identity the page starts with: a server render reads each store's first state. */
const ME = useCyberspace.getInitialState().identity.pubkey

/** A busy player's numbers: long counts, every kind of tile filled. */
function seed(): void {
  const store = new Map<string, string>()
  setMiningDeps({ self: () => ME, live: () => true, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v) }, removeItem: (k) => { store.delete(k) } }, prefs: null })
  for (let i = 0; i < 1234; i++) noteMining({ type: 'survey', chunk: `c${i % 900}` })
  for (const [kind, n] of [[1, 9000], [2, 3100], [5, 1200], [40, 640], [42, 31], [196, 1]] as const) for (let i = 0; i < n; i++) noteMining({ type: 'mine', kind })
  for (let i = 0; i < 2000; i++) noteMining({ type: 'place', air: i % 7 === 0 })
  for (let i = 0; i < 88; i++) noteMining({ type: 'smash', bare: i % 3 === 0, blocks: 9 })
  for (let i = 0; i < 12; i++) noteMining({ type: 'compile' })
  for (let i = 0; i < 9; i++) noteMining({ type: 'prize' })
  noteMining({ type: 'compiler' })
  noteMining({ type: 'blueprint', what: 'made' })
  noteMining({ type: 'blueprint', what: 'placed' })
  noteMining({ type: 'blueprint', what: 'found' })
  addTerrainTime(3600 * 41 + 60 * 17)
}

function page(): string {
  const panel = renderToString(createElement(MiningPanel))
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>`
    + `<body><div class="hud hud--menu"><div class="hud__col hud__col--left"><div class="slot" data-panel-id="mining">${panel}</div></div></div></body></html>`
}

describe('MINING renders the numbers', () => {
  it('every group, the kinds mined most, the rarest find and the sync line', () => {
    seed()
    const html = page()
    for (const word of ['Surveys', 'Unique chunks', 'Blocks mined', 'Rarest find', 'Singularity core', 'Placed in the air', 'With the Compiler', 'Bare-handed', 'Prizes taken', 'Compiler crafted', 'Left in the world', 'In TERRAIN', 'Day streak', 'Longest streak', 'Not synced yet', 'New stats save within 10 min', 'LIVE']) expect(html).toContain(word)
    expect(html).toContain('1,234')
    expect(html).toContain('41h 17m')
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })
})

describe.skipIf(!HAVE_CHROMIUM)('MINING in a real browser', () => {
  let browser: Browser
  beforeAll(async () => { browser = await chromium.launch(); seed() }, 30_000)
  afterAll(async () => { await browser?.close() })

  for (const [name, viewport] of [['a 375 px phone', { width: 375, height: 812 }], ['a desktop window', { width: 1440, height: 900 }]] as const) {
    it(`on ${name}: nothing overflows, every number and label shows whole`, async () => {
      const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
      try {
        const p = await ctx.newPage()
        await p.route('**/*', (r) => r.abort())
        await p.setContent(page())
        const m = await p.evaluate(() => {
          const panel = document.querySelector('.panel--mining') as HTMLElement
          const pr = panel.getBoundingClientRect()
          const tiles = Array.from(document.querySelectorAll('.mining__tile, .mining__kind')) as HTMLElement[]
          const cut = (el: Element | null): number => (el ? (el as HTMLElement).scrollWidth - (el as HTMLElement).clientWidth : 0)
          return {
            tiles: tiles.length,
            panelOverflow: panel.scrollWidth - panel.clientWidth,
            docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            outside: tiles.filter((t) => { const r = t.getBoundingClientRect(); return r.left < pr.left - 0.5 || r.right > pr.right + 0.5 }).length,
            clipped: tiles.flatMap((t) => [t.querySelector('.mining__num'), t.querySelector('.mining__label')]).filter((el) => cut(el) > 0).map((el) => el!.textContent),
            width: pr.width,
          }
        })
        expect(m.tiles).toBeGreaterThan(20)
        expect(m.panelOverflow).toBeLessThanOrEqual(0)
        expect(m.docOverflow).toBeLessThanOrEqual(0)
        expect(m.outside).toBe(0)
        expect(m.clipped).toEqual([])
      } finally {
        await ctx.close()
      }
    }, 30_000)
  }
})
