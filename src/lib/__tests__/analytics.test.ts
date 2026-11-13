/**
 * analytics.test.ts - what Vercel Web Analytics may be told (lib/analytics.ts):
 * an origin and a coarse route, never a coordinate, a query or a hash, no
 * custom events, nothing from the 24/7 stream or from a non-production build.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { BeforeSendEvent } from '@vercel/analytics'
import { analyticsBeforeSend, coarseRoute, OTHER_ROUTE, scrubAnalyticsUrl, startAnalytics } from '../analytics'
import { withCard, ROUTE_PAGES } from '../routeCard'

const O = 'https://www.onosendai.tech'
const FULL = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9f'
const view = (url: string): BeforeSendEvent => ({ type: 'pageview', url })
const never = (): boolean => false

describe('coarseRoute', () => {
  it('collapses every /C/ address, in any case, to /C/:region', () => {
    for (const p of [`/C/${FULL}`, `/c/${FULL}`, '/C/56db', '/C/', '/c', '/C/0xABC/', '/C/not-hex/deeper', '/C/%20secret']) {
      expect(coarseRoute(p), p).toBe('/C/:region')
    }
  })
  it('keeps the routes the app serves, without a step id or a trailing slash', () => {
    expect(coarseRoute('/')).toBe('/')
    expect(coarseRoute('/index.html')).toBe('/')
    expect(coarseRoute('/tv')).toBe('/tv')
    expect(coarseRoute('/TV/')).toBe('/tv')
    expect(coarseRoute('/tv.html')).toBe('/tv')
    expect(coarseRoute('/demo')).toBe('/demo')
    expect(coarseRoute('/demo/identity')).toBe('/demo')
    expect(coarseRoute('/workshop')).toBe('/workshop')
    expect(coarseRoute('/Workshop/')).toBe('/workshop')
    expect(coarseRoute('/workshop.html')).toBe('/workshop')
    expect(coarseRoute('/tutorial')).toBe('/tutorial')
    expect(coarseRoute('/TUTORIAL/')).toBe('/tutorial')
  })
  it('reports any other address as /other, whatever it holds', () => {
    for (const p of ['/nsec1qqqqqqqq', '/speakeasy', '/tvx', '/workshop/x', '/tutorial/x', '/demox', `/${FULL}`, '//evil', '/ncryptsec1abc']) {
      expect(coarseRoute(p), p).toBe('/other')
    }
  })
})

describe('scrubAnalyticsUrl', () => {
  it('drops the query and the hash, always', () => {
    expect(scrubAnalyticsUrl(`${O}/?mode=view&tutorial=1&games=1&announce=test&diag=1#nsec1abc`)).toBe(`${O}/`)
    expect(scrubAnalyticsUrl(`${O}/tv?broadcast=1&text=xl&layout=portrait`)).toBe(`${O}/tv`)
    expect(scrubAnalyticsUrl(`${O}/workshop#bunker://abc?secret=xyz`)).toBe(`${O}/workshop`)
    expect(scrubAnalyticsUrl(`${O}/?nwc=nostr%2Bwalletconnect%3A%2F%2Fx%3Fsecret%3Dy`)).toBe(`${O}/`)
  })
  it('never sends a coordinate', () => {
    const out = scrubAnalyticsUrl(`${O}/C/${FULL}?mode=region#x`)
    expect(out).toBe(`${O}/C/:region`)
    expect(out).not.toContain(FULL.slice(0, 6))
  })
  it('keeps the origin, so www, the apex and previews stay apart, and drops credentials in the address', () => {
    expect(scrubAnalyticsUrl('https://onosendai.tech/demo/identity?x=1')).toBe('https://onosendai.tech/demo')
    expect(scrubAnalyticsUrl('https://user:pass@onosendai-git-x.vercel.app/C/56')).toBe('https://onosendai-git-x.vercel.app/C/:region')
  })
  it('sends nothing for an address that is not http(s) or does not parse', () => {
    expect(scrubAnalyticsUrl('not a url')).toBeNull()
    expect(scrubAnalyticsUrl('javascript:alert(1)')).toBeNull()
    expect(scrubAnalyticsUrl('file:///C/x')).toBeNull()
  })
  it('names the landed route only in place of /', () => {
    expect(scrubAnalyticsUrl(`${O}/`, '/tutorial')).toBe(`${O}/tutorial`)
    expect(scrubAnalyticsUrl(`${O}/`, `/C/${FULL}`)).toBe(`${O}/C/:region`)
    expect(scrubAnalyticsUrl(`${O}/tv`, '/tutorial')).toBe(`${O}/tv`)
    expect(scrubAnalyticsUrl(`${O}/`, '/nsec1abc')).toBe(`${O}/other`)
  })
})

describe('analyticsBeforeSend', () => {
  it('sends page views scrubbed, as a fresh event with only type and url', () => {
    const send = analyticsBeforeSend({ broadcast: never })
    const extra = { type: 'pageview', url: `${O}/C/${FULL}?diag=1#k`, payload: { pubkey: FULL } } as unknown as BeforeSendEvent
    expect(send(extra)).toEqual({ type: 'pageview', url: `${O}/C/:region` })
  })
  it('drops every custom event', () => {
    const send = analyticsBeforeSend({ broadcast: never })
    expect(send({ type: 'event', url: `${O}/` })).toBeNull()
  })
  it('drops everything on the 24/7 stream', () => {
    const send = analyticsBeforeSend({ broadcast: () => true })
    expect(send(view(`${O}/tv?broadcast=1`))).toBeNull()
    expect(send(view(`${O}/`))).toBeNull()
  })
  it('drops an address it cannot read', () => {
    expect(analyticsBeforeSend({ broadcast: never })(view('::'))).toBeNull()
  })
  it('names the landed route on the first page view only', () => {
    const send = analyticsBeforeSend({ broadcast: never, landed: '/tutorial' })
    expect(send(view(`${O}/`))?.url).toBe(`${O}/tutorial`)
    expect(send(view(`${O}/`))?.url).toBe(`${O}/`)
  })
})

describe('startAnalytics', () => {
  it('injects in production, in production mode, with the scrubber', () => {
    const inject = vi.fn()
    expect(startAnalytics({ prod: true, broadcast: never, landed: '/', inject })).toBe(true)
    expect(inject).toHaveBeenCalledTimes(1)
    const props = inject.mock.calls[0][0]
    expect(props.mode).toBe('production')
    expect(props.beforeSend(view(`${O}/C/${FULL}?x=1#y`))).toEqual({ type: 'pageview', url: `${O}/C/:region` })
  })
  it('does not inject on the 24/7 stream', () => {
    const inject = vi.fn()
    expect(startAnalytics({ prod: true, broadcast: () => true, landed: '/tv', inject })).toBe(false)
    expect(inject).not.toHaveBeenCalled()
  })
  it('does not inject outside a production build', () => {
    const inject = vi.fn()
    expect(startAnalytics({ prod: false, broadcast: never, landed: '/', inject })).toBe(false)
    expect(inject).not.toHaveBeenCalled()
  })
})

describe('everything that can go out is one of the fixed routes', () => {
  const ALLOWED = new Set(['/', '/C/:region', '/tv', '/demo', '/workshop', '/tutorial', OTHER_ROUTE])
  const MARK = 'zq7marker'
  const segments = ['', 'C', 'c', 'tv', 'TV', 'demo', 'workshop', 'tutorial', 'index.html', 'tv.html', 'speakeasy', FULL, `nsec1${MARK}`, `${MARK}`, '%2F', '..', 'C%2F', `${MARK}.html`]
  it('for any path, query and hash, the address is the origin and an allowed route, with no marker in it', () => {
    let n = 0
    for (const a of segments) for (const b of segments) for (const q of ['', `?x=${MARK}`, `?mode=view&k=${MARK}`]) for (const h of ['', `#${MARK}`, `#/C/${MARK}`]) {
      const url = `${O}/${a}${b ? `/${b}` : ''}${q}${h}`
      const out = scrubAnalyticsUrl(url, n % 2 ? `/${b}${MARK}` : undefined)
      expect(out, url).not.toBeNull()
      expect(out!.startsWith(O), url).toBe(true)
      expect(ALLOWED.has(out!.slice(O.length)), url).toBe(true)
      expect(out, url).not.toContain(MARK)
      expect(out, url).not.toContain(FULL.slice(0, 8))
      n++
    }
    expect(n).toBeGreaterThan(2000)
  })
})

describe('the page and the wiring', () => {
  const ROOT = path.resolve(__dirname, '../../..')
  const SRC = path.join(ROOT, 'src')
  const REFERRER = /<meta name="referrer" content="strict-origin" \/>/
  it('index.html, and each route page built from it, sends same-origin requests only the origin as referrer (the collector\'s Referer header)', () => {
    const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
    expect(page).toMatch(REFERRER)
    // Before any script or stylesheet, so no request goes out under the default policy.
    expect(page.search(REFERRER)).toBeLessThan(page.search(/<script|<link/))
    for (const [, card] of ROUTE_PAGES) expect(withCard(page, card)).toMatch(REFERRER)
  })
  it('only main.tsx and lib/analytics.ts touch @vercel/analytics, and nothing calls track or pageview', () => {
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p) } else if (/\.(ts|tsx)$/.test(e.name)) files.push(p)
      }
    }
    walk(SRC)
    const users = files.filter((f) => fs.readFileSync(f, 'utf8').includes('@vercel/analytics')).map((f) => path.relative(SRC, f).split(path.sep).join('/')).sort()
    expect(users).toEqual(['lib/analytics.ts', 'main.tsx'])
    for (const f of users) {
      const text = fs.readFileSync(path.join(SRC, f), 'utf8')
      expect(text, f).not.toMatch(/\b(track|pageview)\s*\(/)
      expect(text, f).not.toMatch(/import\s*\{[^}]*\b(track|pageview)\b[^}]*\}\s*from\s*'@vercel\/analytics/)
    }
    const main = fs.readFileSync(path.join(SRC, 'main.tsx'), 'utf8')
    expect(main).toContain('startAnalytics({ prod: import.meta.env.PROD, broadcast: isBroadcast, landed: landedPath(), inject })')
  })
})
