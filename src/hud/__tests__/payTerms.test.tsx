/**
 * payTerms.test.tsx: one small line beside every pay button, "Payments are
 * final. TERMS", with TERMS opening the live Terms page in a new tab (owner,
 * 2026-11-23: "Go ahead"). No checkbox and no extra tap.
 *
 * - The line itself: its words, the absolute link, a new tab, no em dash.
 * - Mounted at each pay point that has no test of its own to carry it: the
 *   Offload Estimate's PAY, the invoice, the compute top-up's GET INVOICE
 *   and the HOSAKA offer card; and AUTO, once, under its budget in the Cloud
 *   compute panel (the offer card's own line already sits beside its AUTO
 *   and budget). RIDE VIA HOSAKA (hyperspaceRideChoice), the
 *   HOSAKA scan (scanMode), the deploy bar's ask (deployBarIdle) and SEAL A
 *   CHEST's ask (chestItemChoice) are checked beside their own tests.
 * No network: the relay is a mock and HOSAKA is never asked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 }, visibilityState: 'visible' }

// Nothing leaves the machine: a fetch that got this far is a test bug.
vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this test') }))
vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryAnyChecked: vi.fn(async () => ({ events: [], trouble: null })),
}))
// The modals land in place rather than in a portal, so the test reads them where they are mounted.
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (el: unknown) => el,
}))
// The QR library is never loaded: the canvas is not what is checked.
vi.mock('qrcode', () => ({ default: { toCanvas: () => Promise.resolve() }, toCanvas: () => Promise.resolve() }))

import { act } from 'react'
import { renderToString } from 'react-dom/server'
import { mount, textOf, type Host, type Mounted } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useOffer } from '../../store/useOffer'
import { useCalibration } from '../../lib/calibration'
import { PAY_TERMS_URL, PayTerms } from '../ui/PayTerms'
import { CloudApproval, InvoiceModal } from '../InvoiceModal'
import { CloudPanel } from '../CloudPanel'
import { HosakaOffer } from '../HosakaOffer'

const C = () => useCyberspace.getState()
const LINE = 'Payments are final. TERMS'

/** Each pay terms line on screen, with its link. */
function terms(m: Mounted): Array<{ text: string; link: Host | undefined }> {
  const links = (h: Host): Host[] => h.children.flatMap((c) => (typeof c === 'string' ? [] : c.type === 'a' ? [c] : links(c)))
  return m.all().filter((h) => typeof h.props.className === 'string' && (h.props.className as string).split(' ').includes('payterms'))
    .map((h) => ({ text: textOf(h).replace(/\s+/g, ' ').trim(), link: links(h)[0] }))
}

/** The one line, said right, its TERMS opening the Terms page in a new tab. */
function expectOneLine(m: Mounted): void {
  const found = terms(m)
  expect(found).toHaveLength(1)
  expect(found[0].text).toBe(LINE)
  expect(found[0].link?.props).toMatchObject({ href: 'https://www.onosendai.tech/terms', target: '_blank' })
  expect(String(found[0].link?.props.rel)).toContain('noopener')
}

const LIMITS = { max_hop_height: 30, max_sidestep_height: 31, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 10_000_000, invoice_ttl_seconds: 600, hop_proof_version: 2 }
const INVOICE = { depositId: 'd1', paymentHash: 'ab'.repeat(32), amountMsats: 21_000, bolt11: 'lnbc210n1test', expiresAt: Math.floor(Date.now() / 1000) + 600 }
const QUOTE = { costMsats: 21_000, maxHeight: 24, action: 'hop', estTime: '~2 min' }

beforeEach(() => {
  useCyberspace.setState({ cloud: { ...C().cloud, status: 'idle', invoice: null, invoiceOpen: false, quote: null, job: null } })
})

describe('the line itself', () => {
  it('says payments are final, and TERMS opens the live Terms page in a new tab', () => {
    expect(PAY_TERMS_URL).toBe('https://www.onosendai.tech/terms')
    const html = renderToString(<PayTerms />)
    expect(html).toMatch(/^<p class="payterms"[^>]*>Payments are final\.(<!-- -->)? (<!-- -->)?<a href="https:\/\/www\.onosendai\.tech\/terms" target="_blank" rel="noopener noreferrer">TERMS<\/a><\/p>$/)
    expect(html).not.toContain('—')
    // Over the scene it is the same words, white with the dock's edge.
    expect(renderToString(<PayTerms scene />)).toContain('class="payterms payterms--scene"')
  })

  it('is one small dim line in styles.css, and white over the scene', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    expect(css).toMatch(/\.payterms \{[^}]*font-size: 9px;[^}]*color: var\(--dim\);/)
    expect(css).toMatch(/\.payterms--scene \{[^}]*color: rgba\(255, 255, 255, [0-9.]+\);[^}]*text-shadow: var\(--scanorbs-edge\);/)
    // The scan dock keeps its room when empty: a fixed height, so the line coming moves nothing.
    expect(css).toMatch(/\.scanorbs__terms \{[^}]*height: 12px;/)
  })
})

describe('at each pay point', () => {
  it('the Offload Estimate: under PAY', async () => {
    useCyberspace.setState({ cloud: { ...C().cloud, status: 'confirm', quote: QUOTE as never } })
    const m = await mount(<CloudApproval />)
    expect(m.buttons('PAY 21 SATS')).toHaveLength(1)
    expectOneLine(m)
    await m.unmount()
  })

  it('the invoice: under COPY INVOICE and OPEN IN WALLET', async () => {
    useCyberspace.setState({ cloud: { ...C().cloud, status: 'awaiting_payment', invoice: INVOICE, invoiceOpen: true } })
    const m = await mount(<InvoiceModal />)
    expect(m.says('OPEN IN WALLET')).toBe(true)
    expectOneLine(m)
    await m.unmount()
  })

  it('the compute top-up: beside GET INVOICE, and only once the form is open', async () => {
    useCyberspace.setState({ cloudPrefs: { ...C().cloudPrefs, mode: 'ask' } })
    const m = await mount(<CloudPanel />)
    expect(terms(m)).toHaveLength(0)
    await m.press('INCREASE COMPUTE BALANCE')
    expect(m.buttons('GET INVOICE')).toHaveLength(1)
    expectOneLine(m)
    await m.unmount()
  })

  it('AUTO: once, under the budget, where the player agrees to spending without being asked; not in ASK or OFF', async () => {
    // HOSAKA's caps already known, so switching modes asks HOSAKA nothing.
    useCyberspace.setState({ cloud: { ...C().cloud, limits: LIMITS }, cloudPrefs: { ...C().cloudPrefs, mode: 'ask' } })
    const m = await mount(<CloudPanel />)
    expect(terms(m)).toHaveLength(0)
    await m.press(/^AUTO$/)
    expect(C().cloudPrefs.mode).toBe('auto')
    expect(m.all().some((h) => h.props['aria-label'] === 'Auto-approve budget in sats')).toBe(true)
    expectOneLine(m)
    expect(m.all().find((h) => String(h.props.className).includes('payterms'))?.props.className).toContain('cloud__budget-terms')
    await m.press(/^OFF$/)
    expect(terms(m)).toHaveLength(0)
    await m.unmount()
  })

  it('the HOSAKA offer card: under its buttons', async () => {
    // A boundary at 2^25 on the way: past this machine's default sidestep, so the move has a verdict.
    const far = { x: 1n << 25n, y: 0n, z: 0n }
    useCyberspace.setState({ position: { x: 0n, y: 0n, z: 0n }, cursor: far, plane: 0, exploreIndex: null, spectate: null, focus: null, transit: null, cloudPrefs: { ...C().cloudPrefs, mode: 'ask' } })
    useOffer.setState({ requestedFor: null, dismissedFor: null })
    // HOSAKA's caps are never fetched: the card asks for them through this.
    useCyberspace.setState({ resumeCloudJob: async () => undefined, cloud: { ...C().cloud, limits: LIMITS } })
    const m = await mount(<HosakaOffer />)
    await act(async () => { useOffer.getState().request(`${far.x}:${far.y}:${far.z}:0`) })
    expect(m.says('NOT NOW')).toBe(true)
    expectOneLine(m)
    // AUTO and its budget are on this card: its one line covers them, never a second.
    await act(async () => { useCyberspace.setState({ cloudPrefs: { ...C().cloudPrefs, mode: 'auto' } }) })
    expect(m.all().some((h) => h.props['aria-label'] === 'Auto-pay budget in sats')).toBe(true)
    expectOneLine(m)
    // A move no one computes: nothing to buy here, but AUTO's switch and budget still are, so AUTO keeps the line and ASK does not.
    const beyond = { x: 1n << 40n, y: 0n, z: 0n } // a 2^41 wall, past HOSAKA's 2^31 sidestep
    // This machine's benchmark as a modest one, so nothing but HOSAKA could cross it, and HOSAKA cannot.
    const bench = useCalibration.getState()
    await act(async () => { useCalibration.setState({ hopHeight: 17, sidestepHeight: 24 }); useCyberspace.setState({ cursor: beyond }); useOffer.getState().request(`${beyond.x}:${beyond.y}:${beyond.z}:0`) })
    expect(m.says('IMPOSSIBLE')).toBe(true)
    expectOneLine(m)
    await act(async () => { useCyberspace.setState({ cloudPrefs: { ...C().cloudPrefs, mode: 'ask' } }) })
    expect(terms(m)).toHaveLength(0)
    // With the cloud off nothing can be paid from the card, so no line.
    await act(async () => { useCyberspace.setState({ cloudPrefs: { ...C().cloudPrefs, mode: 'off' } }) })
    expect(m.says('CLOUD IS OFF')).toBe(true)
    expect(terms(m)).toHaveLength(0)
    await m.unmount()
    useCalibration.setState({ hopHeight: bench.hopHeight, sidestepHeight: bench.sidestepHeight })
    useOffer.setState({ requestedFor: null, dismissedFor: null })
  })
})
