/**
 * scanMode.test.ts - SCAN mode (arkinox, 2026-11-14): the ring BUILD to SCAN
 * to HOP, the height's range (12 up to this device's benchmark, HOSAKA past
 * it, the local max when HOSAKA is off), the one cube a scan covers and the
 * key it computes for it, held as SCAN's and asked about at once, HOSAKA's
 * heights through the keyring's purchase as it stands, CANCEL, and the cube
 * the purple box draws. What would fail silently without it: a scan holding
 * the key to the wrong cube (it opens nothing, and says NOTHING AT 2^H), a
 * HOSAKA height computed nowhere or bought without a price, a cube bought
 * twice, or a cancelled scan still landing.
 *
 * Network-free: the relays are mocked, the purchase and the relay question
 * are replaced, and a local scan computes in this thread or in a fake worker.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
}))

// A server render reads a zustand store's initial state; here each hook reads
// the live state, as a mounted component does (as hud/__tests__/walkPad.test.tsx).
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { useCalibration } from '../../lib/calibration'
import type { HosakaLimits, HosakaProvider } from '../../lib/hosaka'
import { regionKeyAt } from '../../lib/shardCrypto'
import { bytesToHex } from '../../lib/events'
import { clampScanHeight, heldCube, scanBase, scanRange, SCAN_MIN_HEIGHT, type WorkerFactory } from '../../lib/scanCube'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { useSecrets, type HeldKey } from '../useSecrets'
import { SCAN_MAX_HEIGHT, useShards } from '../useShards'
import { currentScanRange, SCAN_KEY_AXES, scanCubeShown, scanPrice, scanRoute, scanSeconds, scanSpace, setScanWorkerFactory, useScan, type ScanClock } from '../useScan'
import { currentPadMode, cycleMode, recall } from '../padMode'
import { placeSpawn } from '../fixtures/placeSpawn'
import { ScanControls, scanLine, scanOrbSats, scanPercent, scanTag, scanTagLines, scanTime } from '../../hud/ScanControls'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { drawnRegion } from '../../scene/DeployRegionBox'

const S = () => useCyberspace.getState()
/** Lets the promises a press started settle. */
const flush = () => new Promise((r) => setTimeout(r, 0))
const SC = () => useScan.getState()

const LIMITS: HosakaLimits = {
  max_hop_height: 30, max_sidestep_height: 31, hop_min_msats: 1000,
  deposit_min_msats: 1000, deposit_max_msats: 10_000_000, invoice_ttl_seconds: 600,
}
const PROVIDER: HosakaProvider = {
  version: 1, name: 'HOSAKA',
  pricing: { hop: [], region_key: [{ max_height: 24, sats: 21, est_time: 'about 1 min', est_seconds: 60 }, { max_height: 30, sats: 900, est_time: 'about 10 min', est_seconds: 600 }] },
} as HosakaProvider

const rescan = vi.fn(async (_lookupId: string, _keyHex: string) => 2)
const buy = vi.fn(async (at: { x: bigint; y: bigint; z: bigint }, plane: 0 | 1, height: number): Promise<HeldKey | null> => {
  const base = scanBase(at, height)
  return { lookupId: 'b'.repeat(64), keyHex: 'c'.repeat(64), height, base: { x: String(base.x), y: String(base.y), z: String(base.z) }, plane, source: 'cloud', at: 1 }
})

/** HOSAKA on, AUTO with a 100 sat cap unless said otherwise: a 21 sat cube goes without asking. */
function cloudOn(on = true, mode: 'auto' | 'ask' = 'auto', autoMaxSats = 100): void {
  useCyberspace.setState({
    cloud: { ...S().cloud, status: 'idle', job: null, limits: on ? LIMITS : null, provider: on ? PROVIDER : null },
    cloudPrefs: { ...S().cloudPrefs, mode: on ? mode : 'off', autoMaxSats },
  })
}

beforeEach(async () => {
  setScanWorkerFactory(null)
  rescan.mockClear()
  buy.mockClear()
  SC().cancel()
  SC().exit()
  useBuilder.getState().exit()
  S().clearFocus()
  await placeSpawn()
  S().cancel()
  useCyberspace.setState({ scaleExp: 0 })
  useCalibration.setState({ hopHeight: 16, cantorMsByHeight: undefined })
  useSecrets.setState({ keys: {}, buy, buying: null, buyError: null })
  useShards.setState({ rescan, pending: null, placedLast: null })
  useScan.setState({ height: SCAN_MIN_HEIGHT, result: null, job: null, confirm: null })
  cloudOn(false)
})

describe('the ring', () => {
  it('goes BUILD, SCAN, HOP, and SCAN starts where BUILD\'s cursor was', () => {
    useBuilder.getState().enter('build')
    S().moveCursor({ axis: 'z', dir: 1 })
    const aimed = { ...S().cursor }
    cycleMode()
    expect(currentPadMode()).toBe('scan')
    expect(S().cursor).toEqual(aimed)
    cycleMode()
    expect(currentPadMode()).toBe('hop')
    expect(SC().active).toBe(false)
  })

  it('ends with its view (RETURN), and when BUILD comes on', () => {
    SC().enter()
    expect(currentPadMode()).toBe('scan')
    S().clearFocus()
    expect(SC().active).toBe(false)
    SC().enter()
    useBuilder.getState().enter('build')
    expect(SC().active).toBe(false)
    expect(currentPadMode()).toBe('build')
  })
})

describe('the height', () => {
  it('starts at 12, the passive scan\'s ceiling, and never goes under it', () => {
    expect(SCAN_MIN_HEIGHT).toBe(SCAN_MAX_HEIGHT)
    SC().enter()
    expect(SC().height).toBe(12)
    SC().stepHeight(-1)
    expect(SC().height).toBe(12)
  })

  it('goes up to the device benchmark and stops there with HOSAKA off', () => {
    SC().enter()
    expect(currentScanRange()).toEqual({ localMax: 16, top: 16, cloud: false })
    SC().setHeight(40)
    expect(SC().height).toBe(16)
    expect(scanRoute(16)).toBe('local')
    // A slower device: the benchmark is the limit, never past the protocol's 20 either.
    useCalibration.setState({ hopHeight: 14 })
    expect(currentScanRange().localMax).toBe(14)
    useCalibration.setState({ hopHeight: 26 })
    expect(currentScanRange().localMax).toBe(20)
    // A device under 12 still scans 12 itself: the passive scan does.
    useCalibration.setState({ hopHeight: 9 })
    expect(currentScanRange().localMax).toBe(12)
  })

  it('goes on past it to HOSAKA\'s cap when HOSAKA is on and its limits are known', () => {
    cloudOn()
    SC().enter()
    expect(currentScanRange()).toEqual({ localMax: 16, top: 30, cloud: true })
    SC().setHeight(17)
    expect(scanRoute(17)).toBe('cloud')
    SC().setHeight(99)
    expect(SC().height).toBe(30)
    expect(scanRange(16, true, null)).toEqual({ localMax: 16, top: 16, cloud: false })
    expect(clampScanHeight(31, scanRange(16, true, 30))).toBe(30)
  })

  it('says UNKNOWN and the time here, COMPLETE when held, HOSAKA above the device max: never FREE or HELD', () => {
    const local = scanRange(16, false, null)
    expect(scanTagLines(13, local, false, 2)).toEqual(['UNKNOWN', 'ABOUT 2 SEC'])
    expect(scanTag(16, local, false, 40)).toBe('UNKNOWN · ABOUT 40 SEC')
    const cloud = scanRange(16, true, 30)
    expect(scanTag(16, cloud, false, 7)).toBe('UNKNOWN · ABOUT 7 SEC')
    // HOSAKA's heights: just HOSAKA, whatever the time; the price is the button's.
    expect(scanTagLines(17, cloud, false, 60)).toEqual(['HOSAKA'])
    expect(scanTagLines(17, cloud, false, null)).toEqual(['HOSAKA'])
    // Already held, at any height: COMPLETE (SCAN only asks the relays again).
    expect(scanTagLines(13, cloud, true, 0)).toEqual(['COMPLETE'])
    expect(scanTagLines(17, cloud, true, 0)).toEqual(['COMPLETE'])
    // None of the old words, anywhere.
    for (const h of [12, 16, 17, 30]) for (const held of [false, true]) for (const r of [local, cloud]) {
      expect(scanTag(h, r, held, 5)).not.toMatch(/FREE|HELD|INSTANT|ON DEVICE/)
    }
  })

  it('puts a HOSAKA height\'s price on the SCAN button, always, and nothing on a height computed here', () => {
    expect(scanOrbSats(true, false, 32)).toBe('32 SATS')
    expect(scanOrbSats(true, false, null)).toBe('NO PRICE')
    expect(scanOrbSats(false, false, 32)).toBeNull()
    expect(scanOrbSats(true, true, 32)).toBeNull()
  })

  it('renders the keys under their buttons (. up, , down, SPACE under SCAN, HOSAKA\'s range too) and the status words', () => {
    const html = (): string => renderToString(createElement(ScanControls))
    SC().enter()
    SC().setHeight(13)
    let out = html()
    expect(out).toMatch(/scanorbs__hint[^"]*"[^>]*>\.<\/span>/)
    expect(out).toMatch(/scanorbs__hint[^"]*"[^>]*>,<\/span>/)
    expect(out).toMatch(/class="flyorb__key"[^>]*>SPACE<\/span>/)
    expect(out).toContain('>UNKNOWN<')
    // A HOSAKA height: HOSAKA under the height, the price on the button, SPACE still there.
    cloudOn()
    SC().setHeight(22)
    out = html()
    expect(out).toContain('>HOSAKA<')
    expect(out).toMatch(/scanorb__sats[^>]*>21 SATS</)
    expect(out).toMatch(/class="flyorb__key"[^>]*>SPACE<\/span>/)
    // At the top: why up stops, where the . key was.
    SC().setHeight(30)
    expect(html()).toContain('>HOSAKA MAX<')
    for (const h of [12, 16, 22, 30]) {
      SC().setHeight(h)
      expect(html()).not.toMatch(/\b(FREE|HELD|INSTANT)\b/)
    }
  })

  it('keeps the status line\'s room in every state, one fixed height, so no button ever moves (arkinox, 2026-11-15: "I don\'t like the layout jump")', async () => {
    const html = (): string => renderToString(createElement(ScanControls))
    /** The status slot: its class and what it says, or '' when empty. */
    const slot = (out: string): { count: number; cls: string; text: string } => {
      const all = [...out.matchAll(/<div class="(scanorbs__line[^"]*)" role="status"[^>]*>(.*?)<\/div>/g)]
      return { count: all.length, cls: all[0]?.[1] ?? '', text: (all[0]?.[2] ?? '').replace(/<[^>]*>/g, '') }
    }
    /** Everything before the slot: the up and down buttons, the height, the orb's place. */
    const row = (out: string): string => out.slice(0, out.indexOf('<div class="scanorbs__line'))
      // What changes inside them (the words, the disabled state, the orb's own look) is not where they are.
      .replace(/>[^<]*</g, '><').replace(/ (disabled|title|aria-label)="[^"]*"/g, '').replace(/ disabled=""/g, '')
      .replace(/class="flyorb scanorb[^"]*"/g, 'class="flyorb scanorb"').replace(/ is-off/g, '')
      .replace(/<span class="scanorbs__tag"><\/span>/g, '').replace(/<span class="scanorb__sats"><\/span>/g, '')
    SC().enter()
    cloudOn(true, 'ask')
    SC().setHeight(22)
    const states: Record<string, string> = {}
    states.idle = html()
    scanSpace(false)
    await flush()
    expect(SC().confirm).not.toBeNull()
    states.confirm = html()
    SC().setHeight(13)
    useScan.setState({ job: { at: S().cursor, plane: 0, height: 13, route: 'local', startedAt: Date.now(), estSeconds: 10, asking: false } })
    states.scanning = html()
    useScan.setState({ job: { ...SC().job!, asking: true } })
    states.asking = html()
    SC().setHeight(22)
    useScan.setState({ job: { at: S().cursor, plane: 0, height: 22, route: 'cloud', startedAt: Date.now(), estSeconds: 108, asking: false } })
    states.hosaka = html()
    useScan.setState({ job: null, result: { kind: 'found', height: 13, count: 2 } })
    states.result = html()
    useScan.setState({ result: { kind: 'failed', height: 13, message: 'HOSAKA could not take the job right now because its queue is full. Try again in a few minutes or scan a lower height here.' } })
    states.error = html()
    useScan.setState({ result: null })
    // One slot in every state, the same element, empty or not.
    for (const out of Object.values(states)) expect(slot(out).count).toBe(1)
    expect(slot(states.idle).text).toBe('')
    expect(slot(states.confirm).text).toBe('PRESS AGAIN TO PAY')
    expect(slot(states.scanning).text).toMatch(/^SCANNING 2\^13/)
    expect(slot(states.scanning).cls).toContain('has-bar')
    expect(slot(states.asking).text).toBe('ASKING RELAYS')
    expect(slot(states.asking).cls).not.toContain('has-bar')
    expect(slot(states.hosaka).text).toBe('HOSAKA SCANNING 2^22')
    expect(slot(states.result).text).toBe('FOUND 2 AT 2^13')
    expect(slot(states.error).cls).toContain('is-error')
    // The controls before it are the same elements in every state.
    const shape = row(states.idle)
    for (const out of Object.values(states)) expect(row(out)).toBe(shape)
    // The slot and the height label are one fixed height (never min-height), the longest line's three.
    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    const rule = (sel: string): string => new RegExp(`\\n${sel.replace(/\./g, '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? ''
    const px = (name: string): number => Number(new RegExp(`--${name}:\\s*(\\d+)px`).exec(css)?.[1])
    const line = rule('.scanorbs__line')
    expect(line).toMatch(/\bheight:\s*var\(--scanorbs-line-h\)/)
    expect(line).not.toMatch(/min-height|max-height/)
    expect(line).toMatch(/flex:\s*0 0 auto/)
    const lineH = Number(/line-height:\s*(\d+)px/.exec(line)?.[1])
    expect(px('scanorbs-line-h')).toBe(3 * lineH)
    expect(css).toMatch(/\.scanorbs__line > span:first-child \{[^}]*line-clamp: 3/)
    // Two lines over the bar: two lines, the gap and the bar fit the same room.
    expect(css).toMatch(/\.scanorbs__line\.has-bar > span:first-child \{[^}]*line-clamp: 2/)
    const gap = Number(/\bgap:\s*(\d+)px/.exec(line)?.[1])
    const bar = Number(/\.scanorbs__bar \{[^}]*\bheight:\s*(\d+)px/.exec(css)?.[1])
    expect(gap).toBeGreaterThan(0)
    expect(bar).toBeGreaterThan(0)
    expect(2 * lineH + gap + bar).toBeLessThanOrEqual(px('scanorbs-line-h'))
    // The empty room takes no taps: they reach the scene, as before it was kept.
    expect(css).toMatch(/\.flyorbs\.scanorbs \{ pointer-events: none; \}/)
    expect(css).toMatch(/\.scanorbs__line:not\(:empty\)[^{]*\{ pointer-events: auto; \}/)
    const value = rule('.scanorbs__value')
    expect(value).toMatch(/\bheight:\s*var\(--scanorbs-value-h\)/)
    expect(value).not.toMatch(/min-height/)
    // SCAN HEIGHT and two tag lines fit the label's room.
    const bLine = Number(/\.scanorbs__value b \{[^}]*line-height:\s*(\d+)px/.exec(css)?.[1])
    const tagLine = Number(/\.scanorbs__tag \{[^}]*line-height:\s*(\d+)px/.exec(css)?.[1])
    expect(bLine + 2 * tagLine).toBeLessThanOrEqual(px('scanorbs-value-h'))
    // The open chat starts past the dock's own width, read from the same numbers.
    const width = /--scanorbs-w:\s*calc\(([^;]*)\);/.exec(css)?.[1] ?? ''
    for (const part of ['--scanorbs-col', '--scanorbs-gap', '--menu-size']) expect(width).toContain(`var(${part})`)
  })

  it('keeps the old words out of SCAN\'s code, and its hints white with the labels\' edge', () => {
    const src = readFileSync(join(process.cwd(), 'src/hud/ScanControls.tsx'), 'utf8')
    // The code, its comments left out (they quote the owner's words about the old ones).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/\b(FREE|HELD|INSTANT)\b/)
    const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    const rule = /\.scanorbs \.flyorb__key \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/color:\s*#fff/)
    expect(rule).toMatch(/text-shadow:\s*var\(--scanorbs-edge\)/)
  })
})

describe('the time estimate', () => {
  /** A benchmark: 10 ms an axis at 12, 40 at 14 (twice per height), so 2.5 a height past it. */
  const BENCH = { 12: 10, 14: 40 }
  const clock = (over: Partial<ScanClock> = {}): ScanClock => ({ cantorMsByHeight: BENCH, hopHeight: 16, provider: PROVIDER, experience: 1, ...over })

  it('rounds the way a person says it', () => {
    expect(scanTime(0.03)).toBe('UNDER 1 SEC')
    expect(scanTime(1.6)).toBe('ABOUT 2 SEC')
    expect(scanTime(9.4)).toBe('ABOUT 9 SEC')
    expect(scanTime(12)).toBe('ABOUT 10 SEC')
    expect(scanTime(41)).toBe('ABOUT 40 SEC')
    expect(scanTime(58)).toBe('ABOUT 1 MIN')
    expect(scanTime(88)).toBe('ABOUT 1 MIN')
    expect(scanTime(6 * 60 + 10)).toBe('ABOUT 6 MIN')
    expect(scanTime(14 * 60)).toBe('ABOUT 15 MIN')
    expect(scanTime(58 * 60)).toBe('ABOUT 1 HR')
    expect(scanTime(1.9 * 3600)).toBe('ABOUT 2 HR')
    expect(scanTime(3 * 3600)).toBe('ABOUT 3 HR')
    expect(scanTime(17 * 3600)).toBe('ABOUT 15 HR')
    expect(scanTime(30 * 3600)).toBe('ABOUT 1 DAY')
    expect(scanTime(80 * 3600)).toBe('ABOUT 3 DAYS')
    expect(scanTime(1e30)).toBe('OVER 99 DAYS')
    expect(scanTime(NaN)).toBe('TIME UNKNOWN')
  })

  it('is the key\'s axis trees\' worth at the benchmark\'s time for the height, and grows with it', () => {
    expect(SCAN_KEY_AXES).toBe(4.5)
    // Measured heights as measured.
    expect(scanSeconds(12, 'local', clock())).toBeCloseTo(0.045)
    expect(scanSeconds(14, 'local', clock())).toBeCloseTo(0.18)
    // Above the top measurement: the fitted growth, floored at 2.5 a height.
    expect(scanSeconds(15, 'local', clock())).toBeCloseTo(0.45)
    expect(scanSeconds(18, 'local', clock())).toBeCloseTo(0.18 * 2.5 ** 4)
    // Never shrinks as the height goes up.
    let last = 0
    for (let h = 12; h <= 20; h++) {
      const s = scanSeconds(h, 'local', clock())!
      expect(s).toBeGreaterThan(last)
      last = s
    }
    // A bigger benchmark, a bigger estimate at the same height (the formatting of minutes;
    // the app's own device max keeps a local scan to seconds, since one axis fits 5 s there).
    expect(scanTag(20, scanRange(20, false, null), false, scanSeconds(20, 'local', clock({ cantorMsByHeight: { 12: 400, 14: 2500 } })))).toBe('UNKNOWN · ABOUT 45 MIN')
  })

  it('before the benchmark has run, takes the device max to be one axis at the hop budget', () => {
    const unmeasured = clock({ cantorMsByHeight: undefined, hopHeight: 17 })
    expect(scanSeconds(17, 'local', unmeasured)).toBeCloseTo(22.5)
    expect(scanSeconds(16, 'local', unmeasured)).toBeCloseTo(9)
    expect(scanSeconds(17, 'local', clock({ cantorMsByHeight: {}, hopHeight: 17 }))).toBeCloseTo(22.5)
  })

  it('is HOSAKA\'s own estimate above the device max, corrected by its record here (the SCAN button\'s tooltip)', () => {
    expect(scanSeconds(20, 'cloud', clock())).toBe(60)
    expect(scanSeconds(28, 'cloud', clock())).toBe(600)
    expect(scanSeconds(20, 'cloud', clock({ experience: 2 }))).toBe(120)
    expect(scanSeconds(20, 'cloud', clock({ provider: null }))).toBeNull()
    cloudOn()
    expect(scanOrbSats(true, false, scanPrice(28))).toBe('900 SATS')
  })

  it('is nothing for a cube already held, which says COMPLETE', () => {
    expect(scanSeconds(18, 'held', clock())).toBe(0)
    expect(scanTag(18, scanRange(16, true, 30), true, scanSeconds(18, 'held', clock()))).toBe('COMPLETE')
  })

  it('is what a local scan\'s progress is measured against', async () => {
    useCalibration.setState({ cantorMsByHeight: BENCH })
    SC().enter()
    SC().setHeight(14)
    const started = SC().start({ route: 'local' })
    expect(SC().job?.estSeconds).toBeCloseTo(0.18)
    await started
  })

  it('gives a local scan no progress bar before the benchmark has run: the time is only a guess then', async () => {
    SC().enter()
    SC().setHeight(13)
    const started = SC().start({ route: 'local' })
    expect(SC().job?.estSeconds).toBeNull()
    expect(scanPercent(SC().job, Date.now() + 1000)).toBeNull()
    await started
  })

})

describe('a local scan', () => {
  it('computes the key of the cube at the cursor, holds it as SCAN\'s, and asks the relays with it', async () => {
    SC().enter()
    for (let i = 0; i < 5; i++) S().moveCursor({ axis: 'x', dir: 1 })
    const at = { ...S().cursor }
    await SC().start()
    const want = regionKeyAt(at, 12, MAX_COMPUTE_HEIGHT)
    const held = useSecrets.getState().keys[want.lookupId]
    expect(held).toBeDefined()
    expect(held.keyHex).toBe(bytesToHex(want.key))
    expect(held.source).toBe('scanmode')
    expect(held.height).toBe(12)
    const base = scanBase(at, 12)
    expect(held.base).toEqual({ x: String(base.x), y: String(base.y), z: String(base.z) })
    // The same cube anywhere inside it: the corner's key.
    expect(regionKeyAt(base, 12, MAX_COMPUTE_HEIGHT).lookupId).toBe(want.lookupId)
    expect(rescan).toHaveBeenCalledWith(want.lookupId, bytesToHex(want.key))
    expect(SC().job).toBeNull()
    expect(SC().result).toEqual({ kind: 'found', height: 12, count: 2 })
    expect(buy).not.toHaveBeenCalled()
  })

  it('Space on a height computed here, or a cube held, scans at once, as a tap does', async () => {
    SC().enter()
    scanSpace(false)
    expect(SC().job?.route).toBe('local')
    await vi.waitFor(() => expect(SC().job).toBeNull())
    expect(rescan).toHaveBeenCalledTimes(1)
    scanSpace(false)
    expect(SC().job?.route).toBe('held')
    await vi.waitFor(() => expect(SC().job).toBeNull())
    expect(rescan).toHaveBeenCalledTimes(2)
  })

  it('asks again with a cube already held, and computes nothing', async () => {
    SC().enter()
    await SC().start()
    rescan.mockClear()
    const run = vi.fn()
    setScanWorkerFactory(() => { run(); throw new Error('no worker') })
    await SC().start()
    expect(run).not.toHaveBeenCalled()
    expect(rescan).toHaveBeenCalledTimes(1)
    expect(heldCube(useSecrets.getState().keys, S().cursor, S().anchorPlane, 12)).not.toBeNull()
  })

  it('stops on CANCEL: the worker goes, and its answer, if any, never lands', async () => {
    const workers: Array<{ terminate: ReturnType<typeof vi.fn>; onmessage: ((e: MessageEvent) => void) | null; postMessage: ReturnType<typeof vi.fn> }> = []
    const factory: WorkerFactory = () => {
      const w = { terminate: vi.fn(), onmessage: null, onerror: null, postMessage: vi.fn() }
      workers.push(w)
      return w as unknown as Worker
    }
    setScanWorkerFactory(factory)
    SC().enter()
    SC().setHeight(15)
    const started = SC().start()
    expect(SC().job?.route).toBe('local')
    expect(workers[0].postMessage).toHaveBeenCalledWith(expect.objectContaining({ heights: [15] }))
    SC().cancel()
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(SC().job).toBeNull()
    expect(SC().result).toEqual({ kind: 'cancelled', height: 15 })
    workers[0].onmessage?.({ data: { type: 'key', id: 1, key: { height: 15, lookupId: 'd'.repeat(64), keyHex: 'e'.repeat(64) } } } as MessageEvent)
    workers[0].onmessage?.({ data: { type: 'done', id: 1 } } as MessageEvent)
    await started
    expect(Object.keys(useSecrets.getState().keys)).toHaveLength(0)
    expect(rescan).not.toHaveBeenCalled()
  })

  it('keeps running when SCAN is left, and lands', async () => {
    let worker: { onmessage: ((e: MessageEvent) => void) | null } | null = null
    setScanWorkerFactory(() => {
      const w = { terminate: vi.fn(), onmessage: null, onerror: null, postMessage: vi.fn() }
      worker = w
      return w as unknown as Worker
    })
    SC().enter()
    const started = SC().start()
    cycleMode()
    expect(currentPadMode()).toBe('hop')
    expect(SC().job).not.toBeNull()
    worker!.onmessage?.({ data: { type: 'key', id: 1, key: { height: 12, lookupId: 'd'.repeat(64), keyHex: 'e'.repeat(64) } } } as MessageEvent)
    worker!.onmessage?.({ data: { type: 'done', id: 1 } } as MessageEvent)
    await started
    expect(useSecrets.getState().keys['d'.repeat(64)]?.source).toBe('scanmode')
    expect(rescan).toHaveBeenCalledWith('d'.repeat(64), 'e'.repeat(64))
  })

  it('says how far along it is from the benchmark, never 100 before it is done', () => {
    const job = { at: S().cursor, plane: 0 as const, height: 18, route: 'local' as const, startedAt: 1000, estSeconds: 10, asking: false }
    expect(scanPercent(job, 6000)).toBe(50)
    expect(scanPercent(job, 60_000)).toBe(99)
    expect(scanPercent({ ...job, estSeconds: null }, 6000)).toBeNull()
    expect(scanLine(job, null, 50, 5, 'idle', null)).toBe('SCANNING 2^18 · 50%')
    expect(scanLine(job, null, null, 5, 'idle', null)).toBe('SCANNING 2^18 · 5 S')
    expect(scanLine({ ...job, asking: true }, null, null, 5, 'idle', null)).toBe('ASKING RELAYS')
    // Said with its height: a scan at 2^18 opens what was hidden at 18, not below.
    expect(scanLine(null, { kind: 'found', height: 18, count: 0 }, null, 0, 'idle', null)).toBe('NOTHING AT 2^18')
    expect(scanLine(null, { kind: 'found', height: 18, count: 3 }, null, 0, 'idle', null)).toBe('FOUND 3 AT 2^18')
    // Armed: only what to do; the price is on the CONFIRM button above it, never said twice.
    expect(scanLine(null, null, null, 0, 'idle', null, true)).toBe('PRESS AGAIN TO PAY')
    expect(scanLine(null, null, null, 0, 'idle', null, false)).toBeNull()
    expect(scanLine({ ...job, route: 'cloud' }, null, null, 0, 'awaiting_payment', 'computing')).toBe('PAY THE INVOICE')
  })
})

describe('above the device\'s max', () => {
  it('buys the cube through the keyring\'s purchase, then asks the relays with it', async () => {
    cloudOn()
    SC().enter()
    SC().setHeight(22)
    const at = { ...S().cursor }
    await SC().start({ route: 'cloud', sats: 21 })
    expect(buy).toHaveBeenCalledTimes(1)
    expect(buy).toHaveBeenCalledWith(at, S().anchorPlane, 22)
    expect(rescan).toHaveBeenCalledWith('b'.repeat(64), 'c'.repeat(64))
    expect(SC().result).toEqual({ kind: 'found', height: 22, count: 2 })
  })

  it('asks first as the Cloud compute mode says: ASK, and AUTO over its cap (0 is always), two presses', async () => {
    for (const [mode, cap] of [['ask', 100], ['auto', 0], ['auto', 20]] as const) {
      buy.mockClear()
      cloudOn(true, mode, cap)
      SC().enter()
      SC().setHeight(22)
      await SC().start({ route: 'cloud', sats: 21 })
      expect(buy, `${mode} ${cap}`).not.toHaveBeenCalled()
      expect(SC().confirm).toMatchObject({ height: 22, sats: 21 })
      expect(SC().job).toBeNull()
      await SC().start({ route: 'cloud', sats: 21 })
      expect(buy, `${mode} ${cap}`).toHaveBeenCalledTimes(1)
      expect(SC().confirm).toBeNull()
      SC().exit()
    }
  })

  it('Space on a HOSAKA height takes two presses in every mode: CONFIRM with the price, then pay; held down, never', async () => {
    for (const [mode, cap] of [['auto', 100], ['ask', 100], ['auto', 0]] as const) {
      buy.mockClear()
      cloudOn(true, mode, cap)
      SC().enter()
      SC().setHeight(22)
      scanSpace(false)
      await flush()
      expect(buy, `${mode} ${cap}`).not.toHaveBeenCalled()
      expect(SC().confirm).toMatchObject({ height: 22, sats: 21 })
      // Held down: the repeats do nothing, never the second press.
      scanSpace(true)
      scanSpace(true)
      await flush()
      expect(buy, `${mode} ${cap}`).not.toHaveBeenCalled()
      scanSpace(false)
      await flush()
      expect(buy, `${mode} ${cap}`).toHaveBeenCalledTimes(1)
      await vi.waitFor(() => expect(SC().job).toBeNull())
      SC().exit()
    }
  })

  it('Space never pays a price that changed after CONFIRM, nor with no price or over another purchase', async () => {
    cloudOn(true, 'auto', 100)
    SC().enter()
    SC().setHeight(22)
    scanSpace(false)
    await flush()
    expect(SC().confirm).toMatchObject({ sats: 21 })
    // The price moves under the armed CONFIRM: the next press arms again at the new price.
    useCyberspace.setState({ cloud: { ...S().cloud, provider: { ...PROVIDER, pricing: { hop: [], region_key: [{ max_height: 24, sats: 34, est_seconds: 60, est_time: '' }] } } as HosakaProvider } })
    scanSpace(false)
    await flush()
    expect(buy).not.toHaveBeenCalled()
    expect(SC().confirm).toMatchObject({ sats: 34 })
    SC().cancel()
    // No price: as the disabled button, nothing.
    useCyberspace.setState({ cloud: { ...S().cloud, provider: null } })
    scanSpace(false)
    scanSpace(false)
    await flush()
    expect(SC().confirm).toBeNull()
    expect(buy).not.toHaveBeenCalled()
    // Another purchase under way: nothing.
    cloudOn(true, 'auto', 100)
    useSecrets.setState({ buying: { height: 20, status: 'computing', costMsats: 0, estSeconds: null, startedAt: 0 } })
    scanSpace(false)
    scanSpace(false)
    await flush()
    expect(SC().confirm).toBeNull()
    expect(buy).not.toHaveBeenCalled()
  })

  it('a move, a change of height or CANCEL disarms a CONFIRM, and the next press asks again', async () => {
    cloudOn(true, 'ask')
    SC().enter()
    SC().setHeight(22)
    await SC().start({ route: 'cloud', sats: 21 })
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(SC().confirm).toBeNull()
    await SC().start({ route: 'cloud', sats: 21 })
    SC().stepHeight(1)
    expect(SC().confirm).toBeNull()
    SC().stepHeight(-1)
    await SC().start({ route: 'cloud', sats: 21 })
    SC().cancel()
    expect(SC().confirm).toBeNull()
    await SC().start({ route: 'cloud', sats: 21 })
    expect(buy).not.toHaveBeenCalled()
  })

  it('never pays a price that was not on screen, nor for a height shown as free', async () => {
    cloudOn()
    SC().enter()
    SC().setHeight(22)
    await SC().start({ route: 'cloud', sats: 5 })
    expect(buy).not.toHaveBeenCalled()
    expect(SC().result).toEqual({ kind: 'failed', height: 22, message: 'The price changed. Check it and scan again.' })
    // Shown free (the benchmark moved under the press), or Space's local route: no purchase.
    await SC().start({ route: 'local' })
    expect(buy).not.toHaveBeenCalled()
  })

  it('never buys without a price, over another purchase, or a cube already held, in either plane', async () => {
    cloudOn()
    useCyberspace.setState({ cloud: { ...S().cloud, provider: null } })
    SC().enter()
    SC().setHeight(22)
    await SC().start()
    expect(buy).not.toHaveBeenCalled()
    expect(SC().result?.kind).toBe('failed')

    cloudOn()
    useSecrets.setState({ buying: { height: 20, status: 'computing', costMsats: 0, estSeconds: null, startedAt: 0 } })
    await SC().start()
    expect(buy).not.toHaveBeenCalled()

    useSecrets.setState({ buying: null })
    const base = scanBase(S().cursor, 22)
    // Held from the other plane: a region key is x, y and z alone, the same in both.
    const other = S().anchorPlane === 0 ? 1 : 0
    useSecrets.getState().hold([{ lookupId: 'f'.repeat(64), keyHex: '1'.repeat(64), height: 22, base: { x: String(base.x), y: String(base.y), z: String(base.z) }, plane: other, source: 'cloud', at: 1 }])
    await SC().start()
    expect(buy).not.toHaveBeenCalled()
    expect(rescan).toHaveBeenCalledWith('f'.repeat(64), '1'.repeat(64))
  })

  it('says what failed when the purchase fails, in the purchase\'s own words', async () => {
    cloudOn()
    buy.mockImplementationOnce(async () => { useSecrets.setState({ buyError: 'Finish or cancel the move in progress first.' }); return null })
    SC().enter()
    SC().setHeight(22)
    await SC().start()
    expect(SC().result).toEqual({ kind: 'failed', height: 22, message: 'Finish or cancel the move in progress first.' })
  })

  it('CANCEL abandons an unpaid invoice the Cloud compute panel\'s way, and never a paid job; RECALL and X leave it be', () => {
    cloudOn()
    const cancelCloud = vi.fn()
    const cancel = vi.fn()
    useCyberspace.setState({ cancelCloud, cancel })
    buy.mockImplementationOnce(() => new Promise(() => {}))
    SC().enter()
    SC().setHeight(22)
    void SC().start()
    expect(SC().job?.route).toBe('cloud')
    // Asking HOSAKA, then paid and computing: nothing to cancel that would not lose what was paid.
    useCyberspace.setState({ cloud: { ...S().cloud, status: 'quoting' } })
    SC().cancel()
    useCyberspace.setState({ cloud: { ...S().cloud, status: 'computing' } })
    SC().cancel()
    expect(cancelCloud).not.toHaveBeenCalled()
    expect(SC().job).not.toBeNull()
    // RECALL in SCAN brings the cursor home and leaves the purchase running.
    S().moveCursor({ axis: 'x', dir: 1 })
    recall()
    expect(cancel).not.toHaveBeenCalled()
    expect(currentPadMode()).toBe('scan')
    // An invoice waiting unpaid: CANCEL abandons it.
    useCyberspace.setState({ cloud: { ...S().cloud, status: 'awaiting_payment', job: null } })
    SC().cancel()
    expect(cancelCloud).toHaveBeenCalledTimes(1)
    expect(SC().result).toEqual({ kind: 'cancelled', height: 22 })
  })
})

describe('the purple box', () => {
  it('is the cube at the cursor at the chosen height, only in SCAN', () => {
    const cs = (): Parameters<typeof scanCubeShown>[1] => ({ cursor: S().cursor, anchorPlane: S().anchorPlane, viewing: S().viewing(), building: useBuilder.getState().active })
    expect(scanCubeShown(SC(), cs())).toBeNull()
    SC().enter()
    SC().setHeight(14)
    expect(scanCubeShown(SC(), cs())).toEqual({ at: S().cursor, height: 14 })
    // Drawn as that cube: 2^14 gibsons a side, at 2^12 a cell, four cells.
    useCyberspace.setState({ scaleExp: 12 })
    const axes = S().axes()
    const box = drawnRegion(S().cursor, S().cursor, 14, 12, axes, 25)!
    for (const side of box.size) expect(side).toBeCloseTo(4, 3)
    SC().exit()
    expect(scanCubeShown(SC(), cs())).toBeNull()
  })

  it('stays on the cube being scanned while the cursor moves on', () => {
    setScanWorkerFactory(() => ({ terminate: vi.fn(), onmessage: null, onerror: null, postMessage: vi.fn() }) as unknown as Worker)
    SC().enter()
    const at = { ...S().cursor }
    void SC().start()
    S().moveCursor({ axis: 'x', dir: 1 })
    const shown = scanCubeShown(SC(), { cursor: S().cursor, anchorPlane: S().anchorPlane, viewing: true, building: false })
    expect(shown).toEqual({ at, height: 12 })
    SC().cancel()
  })
})

describe('the keyring', () => {
  it('has no BUY any more: SCAN mode took it, and the purchase stays for SCAN and the hide', () => {
    const src = (...p: string[]): string => readFileSync(join(__dirname, '..', '..', ...p), 'utf8')
    const modal = src('hud', 'SecretsModal.tsx')
    expect(modal).not.toContain('Buy a key where you stand')
    expect(modal).not.toContain('.buy(')
    expect(modal).toContain('To scan a bigger cube, use SCAN mode.')
    expect(modal).toContain("k.source === 'scanmode' ? 'scanned'")
    expect(src('store', 'useScan.ts')).toContain('useSecrets.getState().buy(at, plane, height)')
  })
})
