/**
 * scanMode.test.ts - SCAN mode (arkinox, 2026-11-14): the ring BUILD to SCAN
 * to HOP, the height's range (12 up to this device's benchmark, HOSAKA past
 * it, the local max when HOSAKA is off), the one cube a scan covers and the
 * key it computes for it, held as SCAN's and asked about at once, HOSAKA's
 * heights through the keyring's purchase as it stands, CANCEL, and the cube
 * the purple box draws. What would fail silently without it: a scan holding
 * the key to the wrong cube (it opens nothing, and says NOTHING FOUND), a
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

import { useCalibration } from '../../lib/calibration'
import type { HosakaLimits, HosakaProvider } from '../../lib/hosaka'
import { regionKeyAt } from '../../lib/shardCrypto'
import { bytesToHex } from '../../lib/events'
import { clampScanHeight, heldCube, scanBase, scanRange, SCAN_MIN_HEIGHT, type WorkerFactory } from '../../lib/scanCube'
import { MAX_COMPUTE_HEIGHT, useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { useSecrets, type HeldKey } from '../useSecrets'
import { SCAN_MAX_HEIGHT, useShards } from '../useShards'
import { currentScanRange, scanCubeShown, scanRoute, setScanWorkerFactory, useScan } from '../useScan'
import { currentPadMode, cycleMode } from '../padMode'
import { placeSpawn } from '../fixtures/placeSpawn'
import { scanLine, scanPercent, scanTag } from '../../hud/ScanControls'
import { drawnRegion } from '../../scene/DeployRegionBox'

const S = () => useCyberspace.getState()
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

function cloudOn(on = true): void {
  useCyberspace.setState({
    cloud: { ...S().cloud, limits: on ? LIMITS : null, provider: on ? PROVIDER : null },
    cloudPrefs: { ...S().cloudPrefs, mode: on ? 'ask' : 'off' },
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
  useCalibration.setState({ hopHeight: 16 })
  useSecrets.setState({ keys: {}, buy, buying: null, buyError: null })
  useShards.setState({ rescan, pending: null, placedLast: null })
  useScan.setState({ height: SCAN_MIN_HEIGHT, result: null, job: null })
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

  it('says who computes it, and for what', () => {
    const local = scanRange(16, false, null)
    expect(scanTag(13, local, false, null, true)).toBe('ON DEVICE · FREE')
    expect(scanTag(16, local, false, null, true)).toBe('DEVICE MAX · HOSAKA OFF')
    expect(scanTag(16, local, false, null, false)).toBe('DEVICE MAX')
    const cloud = scanRange(16, true, 30)
    expect(scanTag(16, cloud, false, 21, false)).toBe('ON DEVICE · FREE')
    expect(scanTag(17, cloud, false, 21, false)).toBe('HOSAKA · 21 SATS')
    expect(scanTag(17, cloud, false, null, false)).toBe('HOSAKA · NO PRICE YET')
    expect(scanTag(17, cloud, true, 21, false)).toBe('HELD · FREE')
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
    expect(scanLine(null, { kind: 'found', height: 18, count: 0 }, null, 0, 'idle', null)).toBe('NOTHING FOUND')
    expect(scanLine(null, { kind: 'found', height: 18, count: 3 }, null, 0, 'idle', null)).toBe('FOUND 3')
    expect(scanLine({ ...job, route: 'cloud' }, null, null, 0, 'awaiting_payment', 'computing')).toBe('PAY THE INVOICE')
  })
})

describe('above the device\'s max', () => {
  it('buys the cube through the keyring\'s purchase, then asks the relays with it', async () => {
    cloudOn()
    SC().enter()
    SC().setHeight(22)
    const at = { ...S().cursor }
    await SC().start()
    expect(buy).toHaveBeenCalledTimes(1)
    expect(buy).toHaveBeenCalledWith(at, S().anchorPlane, 22)
    expect(rescan).toHaveBeenCalledWith('b'.repeat(64), 'c'.repeat(64))
    expect(SC().result).toEqual({ kind: 'found', height: 22, count: 2 })
  })

  it('never buys without a price, over another purchase, or a cube already held', async () => {
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
    useSecrets.getState().hold([{ lookupId: 'f'.repeat(64), keyHex: '1'.repeat(64), height: 22, base: { x: String(base.x), y: String(base.y), z: String(base.z) }, plane: S().anchorPlane, source: 'cloud', at: 1 }])
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

  it('CANCEL stops HOSAKA\'s job the way the Cloud compute panel does', () => {
    cloudOn()
    const cancelCloud = vi.fn()
    useCyberspace.setState({ cancelCloud })
    buy.mockImplementationOnce(() => new Promise(() => {}))
    SC().enter()
    SC().setHeight(22)
    void SC().start()
    expect(SC().job?.route).toBe('cloud')
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
