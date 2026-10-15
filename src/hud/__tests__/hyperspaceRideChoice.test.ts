/**
 * hyperspaceRideChoice.test.ts - the Hyperspace panel offers HOSAKA beside
 * the local estimate only when HOSAKA has priced the ride (onosendai-launch
 * #35 P5; arkinox, 2026-10-11).
 *
 * The quote itself (provider service, fit, the public quote) is
 * useRideQuote's and is covered by lib/__tests__/cloudRide.test.ts; here the
 * hook is stubbed with each of its answers and the panel is rendered, so
 * what is checked is what a person sees: the price row, RIDE HERE and RIDE
 * VIA HOSAKA with their prices, and the profile's highlight.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() },
  }
})
const quote = vi.hoisted(() => ({ state: { status: 'hidden' } as unknown }))
vi.mock('../useRideQuote', () => ({ useRideQuote: () => quote.state }))
vi.mock('../../lib/workers', async (o) => ({ ...(await o() as object), postProof: () => {}, cancelProof: () => {} }))
vi.mock('../../lib/hyperspace/station', async (o) => ({ ...(await o() as object), findStation: () => ({ stop: { height: 100, kind: 'port', coordApprox: (5n << 200n) + 1n }, distance: 3 }) }))
vi.mock('../../store/useHyperspace', async (o) => ({
  ...(await o() as object),
  getStopByHeight: (height: number) => ({ height, kind: 'port', merkleRoot: 'ab'.repeat(32), blockHash: 'cd'.repeat(32), coordExact: (5n << 200n) + 1n, coordApprox: (5n << 200n) + 1n }),
}))
// A server render reads a zustand store's initial state; here each hook reads the live state.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { enterHyperspaceTemplate, type NostrEvent } from '../../lib/events'
import { useCyberspace } from '../../store/useCyberspace'
import { useHyperspace } from '../../store/useHyperspace'
import { HyperspacePanel } from '../HyperspacePanel'
import { placeSpawn } from '../../store/fixtures/placeSpawn'

const OFFER = { fromHeight: 100, toHeight: 105, costMsats: 944_000, estSeconds: 571, estTime: '~10 min' }

async function boarded(): Promise<void> {
  useCyberspace.setState({ events: [] })
  await placeSpawn()
  const s = useCyberspace.getState()
  const pk = s.identity.pubkey
  const enter = await s.signEvent(enterHyperspaceTemplate({ createdAt: s.events[0].created_at + 1, genesisId: s.genesisId, previousId: s.prevEventId, coordHex: pk, proofHash: 'a'.repeat(64) })) as NostrEvent
  const { x, y, z, plane } = coordToXyz(hexToCoord(pk))
  useCyberspace.setState({ events: [...s.events, enter], prevEventId: enter.id, position: { x, y, z }, headPlane: plane, plane, transit: { stage: 'boarded', enterEventId: enter.id, enterCoordHex: pk }, chainConflict: null })
  useHyperspace.setState({ destination: 105, tipHeight: 110, sync: { status: 'ready', loaded: 111, total: 111, error: null, source: 'relay' } })
}

const html = (): string => renderToString(createElement(HyperspacePanel))
/** The opening tag of the button whose text contains `label`. */
function button(page: string, label: string): string {
  const m = [...page.matchAll(/<button[^>]*>(?:(?!<\/button>).)*<\/button>/g)].map((x) => x[0]).find((b) => b.includes(label))
  if (!m) throw new Error(`no button ${label}`)
  return m.slice(0, m.indexOf('>') + 1)
}

describe('the HOSAKA choice in the Hyperspace panel', () => {
  beforeEach(async () => {
    await boarded()
    useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, profile: 'time' } })
  })

  it('no ride service, or a ride it cannot take: the panel is as it was, one RIDE', () => {
    quote.state = { status: 'hidden' }
    const page = html()
    expect(page).not.toContain('RIDE VIA HOSAKA')
    expect(page).not.toContain('<dt>HOSAKA</dt>')
    expect(button(page, '>RIDE<')).not.toContain('disabled')
  })

  it('while HOSAKA is asked, the row says so and RIDE stays', () => {
    quote.state = { status: 'loading' }
    const page = html()
    expect(page).toContain('<dt>HOSAKA</dt><dd>ASKING</dd>')
    expect(page).not.toContain('RIDE VIA HOSAKA')
  })

  it('a quote that did not come back is not a price', () => {
    quote.state = { status: 'unavailable' }
    const page = html()
    expect(page).toContain('UNAVAILABLE')
    expect(page).not.toContain('RIDE VIA HOSAKA')
  })

  it('priced: the price beside the local estimate, and RIDE HERE or RIDE VIA HOSAKA, each with its cost', () => {
    quote.state = { status: 'ready', offer: OFFER }
    const page = html()
    expect(page).toMatch(/<dt>HOSAKA<\/dt><dd>944 SATS · 10 min<\/dd>/)
    expect(page).toContain('RIDE HERE')
    expect(page).toContain('RIDE VIA HOSAKA')
    expect(page).toMatch(/RIDE VIA HOSAKA<\/span><span class="hyper__choicemeta">944 SATS(<!-- -->)? · 10 MIN/)
    expect(page).toMatch(/RIDE HERE<\/span><span class="hyper__choicemeta">FREE/)
    expect(button(page, 'RIDE VIA HOSAKA')).not.toContain('disabled')
  })

  it('the highlight follows the profile: COST lights RIDE HERE; TIME lights the faster', () => {
    quote.state = { status: 'ready', offer: OFFER }
    // Still calibrating: rides are long, so under TIME HOSAKA is the faster.
    expect(button(html(), 'RIDE VIA HOSAKA')).toContain('hyper__btn--ride')
    expect(button(html(), 'RIDE HERE')).not.toContain('hyper__btn--ride')
    useCyberspace.setState({ cloudPrefs: { ...useCyberspace.getState().cloudPrefs, profile: 'cost' } })
    expect(button(html(), 'RIDE HERE')).toContain('hyper__btn--ride')
    expect(button(html(), 'RIDE VIA HOSAKA')).not.toContain('hyper__btn--ride')
  })

  it('a HOSAKA job already kept or running holds RIDE VIA HOSAKA dark', () => {
    quote.state = { status: 'ready', offer: OFFER }
    useCyberspace.setState({ cloud: { ...useCyberspace.getState().cloud, status: 'computing' } })
    expect(button(html(), 'RIDE VIA HOSAKA')).toContain('disabled')
    useCyberspace.setState({ cloud: { ...useCyberspace.getState().cloud, status: 'idle' } })
  })
})
