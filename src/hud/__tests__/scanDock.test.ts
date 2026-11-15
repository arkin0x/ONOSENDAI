/**
 * scanDock.test.ts - SCAN's dock as drawn (owner, 2026-11-15): the key hints
 * ("." under the up button, "," under the down button, SPACE beside the orb,
 * in HOSAKA's range too), the tag under the height (UNKNOWN and the time,
 * COMPLETE, HOSAKA; never FREE or HELD), the price on the orb above the
 * device's range, and CONFIRM with the price after a first press.
 * Network-free: the relays are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

vi.hoisted(() => {
  ;(globalThis as { WebSocket?: unknown }).WebSocket = class {
    static OPEN = 1
    readyState = 0
    onopen = null; onclose = null; onerror = null; onmessage = null
    send(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

vi.mock('../../lib/workers', () => ({ postProof: vi.fn(), cancelProof: vi.fn(), setProofHandler: vi.fn() }))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
  onResume: () => () => {},
}))
// A server render reads a store's initial state; here each hook reads the live state, as in the browser.
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import type { HosakaLimits, HosakaProvider } from '../../lib/hosaka'
import { useCalibration } from '../../lib/calibration'
import { SCAN_MIN_HEIGHT, scanBase } from '../../lib/scanCube'
import { useCyberspace } from '../../store/useCyberspace'
import { useSecrets } from '../../store/useSecrets'
import { spaceScan, useScan } from '../../store/useScan'
import { placeSpawn } from '../../store/fixtures/placeSpawn'
import { ScanDock } from '../ScanControls'

const S = () => useCyberspace.getState()
const LIMITS: HosakaLimits = { max_hop_height: 30, max_sidestep_height: 31, hop_min_msats: 1000, deposit_min_msats: 1000, deposit_max_msats: 10_000_000, invoice_ttl_seconds: 600 }
const PROVIDER = { version: 1, name: 'HOSAKA', pricing: { hop: [], region_key: [{ max_height: 30, sats: 21, est_time: 'about 1 min', est_seconds: 60 }] } } as unknown as HosakaProvider
const buy = vi.fn(async () => null)
const dock = (): string => renderToString(createElement(ScanDock))

beforeEach(async () => {
  buy.mockClear()
  useScan.getState().cancel()
  useScan.getState().exit()
  await placeSpawn()
  useCalibration.setState({ hopHeight: 16 })
  useSecrets.setState({ keys: {}, buy, buying: null, buyError: null })
  useCyberspace.setState({
    cloud: { ...S().cloud, status: 'idle', job: null, limits: LIMITS, provider: PROVIDER },
    cloudPrefs: { ...S().cloudPrefs, mode: 'auto', autoMaxSats: 100 },
  })
  useScan.setState({ height: SCAN_MIN_HEIGHT, result: null, job: null, confirm: null })
  useScan.getState().enter()
})

describe('SCAN\'s dock', () => {
  it('shows "." under the up button, "," under the down button and SPACE beside the orb', () => {
    const html = dock()
    expect(html).toMatch(/aria-label="Raise the scan height"[\s\S]*?<\/button><span class="flyorb__key scanorbs__key" aria-hidden="true">\.<\/span>/)
    expect(html).toMatch(/aria-label="Lower the scan height"[\s\S]*?<\/button><span class="flyorb__key scanorbs__key" aria-hidden="true">,<\/span>/)
    expect(html).toContain('>SPACE</span>')
    expect(html).toContain('<span class="scanorb__word">SCAN</span>')
  })

  it('says UNKNOWN on this device, COMPLETE for a cube whose key is held; never FREE or HELD', () => {
    expect(dock()).toMatch(/class="scanorbs__tag">UNKNOWN/)
    const base = scanBase(S().cursor, SCAN_MIN_HEIGHT)
    useSecrets.getState().hold([{ lookupId: 'f'.repeat(64), keyHex: '1'.repeat(64), height: SCAN_MIN_HEIGHT, base: { x: String(base.x), y: String(base.y), z: String(base.z) }, plane: S().anchorPlane, source: 'scanmode', at: 1 }])
    const html = dock()
    expect(html).toContain('class="scanorbs__tag">COMPLETE</span>')
    expect(html).not.toMatch(/FREE|HELD/)
  })

  it('in HOSAKA\'s range: HOSAKA under the height, the price on the orb, SPACE still shown; then CONFIRM over the price', async () => {
    useScan.getState().setHeight(22)
    let html = dock()
    expect(html).toContain('class="scanorbs__tag is-hosaka">HOSAKA</span>')
    expect(html).toContain('<span class="scanorb__word">21 SATS</span>')
    expect(html).toContain('>SPACE</span>')
    expect(html).not.toMatch(/FREE|HELD/)
    spaceScan()
    await Promise.resolve()
    html = dock()
    expect(html).toContain('<span class="scanorb__word">CONFIRM</span><span class="scanorb__sats">21 SATS</span>')
    expect(buy).not.toHaveBeenCalled()
  })
})
