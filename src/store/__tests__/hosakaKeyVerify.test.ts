/**
 * hosakaKeyVerify.test.ts: a region key bought from HOSAKA is checked at
 * purchase (lib/regionKeyCheck.ts), and a wrong one is refused, never held,
 * and never seals a bag.
 *
 * HOSAKA here is a fake client (createHosaka mocked): nothing is asked of the
 * real one and nothing is paid. Heights are small (4), so the derivation the
 * check makes is the runner's cheap inline one; above-ceiling cases lower the
 * calibrated ceiling instead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

/** HOSAKA, faked: a region key job that completes at once with `result`. */
const hosaka = vi.hoisted(() => {
  const state = { result: null as unknown }
  const fake = {
    apiUrl: 'http://fake',
    limits: vi.fn(async () => null), provider: vi.fn(async () => null), quote: vi.fn(), submitHop: vi.fn(), submitSidestep: vi.fn(), submitRide: vi.fn(), rideQuote: vi.fn(),
    submitRegionKey: vi.fn(async () => ({ id: 'job1', status: 'computing', cost_msats: 2_000, poll_token: 'tok', result: null, error: null, balance_debited: true })),
    waitForJob: vi.fn(async () => ({ id: 'job1', status: 'completed', cost_msats: 2_000, result: state.result, error: null })),
    getJob: vi.fn(), startJob: vi.fn(), claimDeposit: vi.fn(), balance: vi.fn(async () => ({ balance_msats: 0 })), deposit: vi.fn(), waitForDeposit: vi.fn(),
  }
  return { state, fake }
})
vi.mock('../../lib/hosaka', async (o) => ({ ...(await o<typeof import('../../lib/hosaka')>()), createHosaka: () => hosaka.fake }))
vi.mock('../../lib/relay', async (o) => {
  const a = await o<typeof import('../../lib/relay')>()
  const { offlineRelay } = await import('../../test/offlineRelay')
  return { ...a, ...offlineRelay, publishMany: vi.fn(offlineRelay.publishMany), relaySet: () => ['wss://relay.test'] }
})
vi.mock('../../lib/regionKeyOffThread', async (orig) => {
  const real = await orig() as typeof import('../../lib/regionKeyOffThread')
  return { ...real, regionKeyOffThread: vi.fn(real.regionKeyOffThread) }
})
// The row self-check's test, a passthrough spy: the check runs as written unless a case says otherwise.
vi.mock('../../lib/regionKeyCheck', async (orig) => {
  const real = await orig() as typeof import('../../lib/regionKeyCheck')
  return { ...real, keyFitsLookup: vi.fn(real.keyFitsLookup) }
})

import { useCyberspace } from '../useCyberspace'
import { useSecrets, type HeldKey } from '../useSecrets'
import { useShards } from '../useShards'
import { useToast } from '../useToast'
import { useCalibration } from '../../lib/calibration'
import { publishMany } from '../../lib/relay'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import { regionKeyAt } from '../../lib/shardCrypto'
import { WRONG_KEY, keyFitsLookup } from '../../lib/regionKeyCheck'
import { REFUSED_KEY, readBought, readRefused } from '../../lib/secrets/backstop'
import { bytesToHex } from '../../lib/events'
import type { Position } from '../../lib/space'

const HEIGHT = 4
const AT: Position = { x: (1n << 40n) + 0x35n, y: (1n << 39n) + 0x12n, z: (1n << 38n) + 0x2an }
const ELSEWHERE: Position = { x: AT.x + 1000n, y: AT.y, z: AT.z }
const h = BigInt(HEIGHT)
const BASE = { x: ((AT.x >> h) << h).toString(), y: ((AT.y >> h) << h).toString(), z: ((AT.z >> h) << h).toString() }

/** What HOSAKA hands back: the key of `at`'s cube, labelled with AT's cube. */
function result(at: Position = AT, over: Record<string, unknown> = {}): Record<string, unknown> {
  const rk = regionKeyAt(at, HEIGHT, 20)
  return { secret_key: bytesToHex(rk.key), lookup_id: rk.lookupId, height: HEIGHT, base: BASE, ...over }
}

const C = () => useCyberspace.getState()

beforeEach(() => {
  localStorage.clear()
  hosaka.fake.submitRegionKey.mockClear()
  hosaka.fake.waitForJob.mockClear()
  vi.mocked(regionKeyOffThread).mockClear()
  vi.mocked(publishMany).mockClear()
  useCalibration.setState({ hopHeight: 17 })
  useCyberspace.setState({ cloudPrefs: { ...C().cloudPrefs, mode: 'auto' }, plan: null, cloud: { ...C().cloud, status: 'idle', job: null } })
  useSecrets.setState({ keys: {}, buying: null, buyError: null })
})

describe('buyRegionKey checks the key at purchase', () => {
  it('passes the right key, and derives it once off the main thread to check', async () => {
    hosaka.state.result = result()
    const out = await C().buyRegionKey(AT, 0, HEIGHT)
    expect(out).toMatchObject({ ok: true, result: { lookup_id: regionKeyAt(AT, HEIGHT, 20).lookupId } })
    expect(hosaka.fake.submitRegionKey).toHaveBeenCalledTimes(1)
    expect(regionKeyOffThread).toHaveBeenCalledWith(AT, HEIGHT, 20)
  })

  it('refuses a key whose lookup id is not sha256 of it, saying HOSAKA RETURNED A WRONG KEY', async () => {
    hosaka.state.result = result(AT, { lookup_id: 'ee'.repeat(32) })
    const out = await C().buyRegionKey(AT, 0, HEIGHT)
    expect(out.ok).toBe(false)
    expect(!out.ok && out.error).toMatch(new RegExp(`^${WRONG_KEY}: its lookup id is not the sha256 of its key`))
  })

  it('refuses a well-formed key of another cube when this device can derive the right one', async () => {
    hosaka.state.result = result(ELSEWHERE)
    const out = await C().buyRegionKey(AT, 0, HEIGHT)
    expect(!out.ok && out.error).toMatch(new RegExp(`^${WRONG_KEY}: it is not the key this device derives`))
  })

  it('above this device\'s ceiling: no derivation, so a well-formed key of another cube is the documented gap', async () => {
    useCalibration.setState({ hopHeight: HEIGHT - 1 })
    hosaka.state.result = result(ELSEWHERE)
    expect((await C().buyRegionKey(AT, 0, HEIGHT)).ok).toBe(true)
    expect(regionKeyOffThread).not.toHaveBeenCalled()
  })

  it('refuses a key that does not hash to the lookup id of the bag it was bought to open', async () => {
    useCalibration.setState({ hopHeight: HEIGHT - 1 })
    hosaka.state.result = result(ELSEWHERE)
    const out = await C().buyRegionKey(AT, 0, HEIGHT, { lookupId: regionKeyAt(AT, HEIGHT, 20).lookupId })
    expect(!out.ok && out.error).toMatch(new RegExp(`^${WRONG_KEY}: it is not the key to the bag`))
  })
})

describe('the Region keys BUY (useSecrets.buy)', () => {
  it('never holds a wrong key, and says HOSAKA RETURNED A WRONG KEY', async () => {
    hosaka.state.result = result(AT, { lookup_id: 'ee'.repeat(32) })
    expect(await useSecrets.getState().buy(AT, 0, HEIGHT)).toBeNull()
    expect(useSecrets.getState().buyError).toMatch(new RegExp(`^${WRONG_KEY}`))
    expect(useSecrets.getState().buyError).toContain('It was set aside, not used')
    expect(Object.keys(useSecrets.getState().keys)).toHaveLength(0)
    expect(useSecrets.getState().buying).toBeNull()
  })

  it('sets a refused key aside, once, where nothing offers it as held, so a false refusal can be put right', async () => {
    hosaka.state.result = result(ELSEWHERE)
    expect(await useSecrets.getState().buy(AT, 0, HEIGHT)).toBeNull()
    expect(await useSecrets.getState().buy(AT, 0, HEIGHT)).toBeNull()
    const aside = readRefused()
    expect(aside).toHaveLength(1)
    expect(aside[0]).toMatchObject({
      keyHex: (hosaka.state.result as { secret_key: string }).secret_key, lookupId: regionKeyAt(ELSEWHERE, HEIGHT, 20).lookupId,
      height: HEIGHT, plane: 0, base: BASE, jobId: 'job1', why: expect.stringMatching(/not the key this device derives/),
    })
    // Never held, never in the bought-key backstop, never in the list.
    expect(Object.keys(useSecrets.getState().keys)).toHaveLength(0)
    expect(readBought()).toEqual({})
  })

  it('says so when the key could not be set aside', async () => {
    hosaka.state.result = result(ELSEWHERE)
    const realSet = localStorage.setItem
    localStorage.setItem = (k: string, v: string) => { if (k === REFUSED_KEY) throw new Error('quota exceeded'); realSet(k, v) }
    try {
      const out = await C().buyRegionKey(AT, 0, HEIGHT)
      expect(!out.ok && out.error).toContain('could not be set aside on this device (quota exceeded)')
    } finally {
      localStorage.setItem = realSet
    }
  })

  it('holds the right one', async () => {
    hosaka.state.result = result()
    const held = await useSecrets.getState().buy(AT, 0, HEIGHT)
    expect(held?.lookupId).toBe(regionKeyAt(AT, HEIGHT, 20).lookupId)
    expect(useSecrets.getState().buyError).toBeNull()
  })
})

describe('a deploy above this device\'s ceiling never seals with a wrong key', () => {
  beforeEach(() => {
    useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, deployStatus: 'idle', deployError: null })
    useCyberspace.setState({ live: true, cloud: { ...C().cloud, status: 'idle', job: null, limits: { max_hop_height: 30 } as never } })
    useCalibration.setState({ hopHeight: 12 })
    vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
  })

  /** A message lined up at height 14, so the key is HOSAKA's; `buy` stands in for the purchase. */
  async function deployWith(buy: () => Promise<HeldKey | null>): Promise<number> {
    const real = useSecrets.getState().buy
    const asked = vi.fn(buy)
    useSecrets.setState({ buy: asked })
    try {
      useShards.getState().startDeployMessage('hello')
      useShards.setState({ deployHeight: 14, deployHeightAuto: false })
      await useShards.getState().deploy(true)
      return asked.mock.calls.length
    } finally {
      useSecrets.setState({ buy: real })
    }
  }

  it('refuses a held key whose lookup id is not its own, and publishes nothing', async () => {
    expect(await deployWith(async () => ({ lookupId: 'ee'.repeat(32), keyHex: '11'.repeat(32), height: 14, base: BASE, plane: 0, source: 'cloud', at: 1 } as HeldKey))).toBe(1)
    expect(useShards.getState().deployError).toMatch(new RegExp(`^${WRONG_KEY}`))
    expect(useShards.getState().mine).toHaveLength(0)
    expect(publishMany).not.toHaveBeenCalled()
  })

  it('a purchase that refused the key fails the deploy with its words', async () => {
    await deployWith(async () => { useSecrets.setState({ buyError: `${WRONG_KEY}: it is for another cube. It was set aside, not used: nothing was hidden or opened with it.` }); return null })
    expect(useShards.getState().deployError).toMatch(new RegExp(`^${WRONG_KEY}: it is for another cube`))
    expect(useShards.getState().mine).toHaveLength(0)
  })

  it('seals with a key whose lookup id is its own, and the stored row passes the self-check', async () => {
    const rk = regionKeyAt(ELSEWHERE, 3, 20)
    useToast.setState({ toast: null })
    const bought = await deployWith(async () => ({ lookupId: rk.lookupId, keyHex: bytesToHex(rk.key), height: 14, base: BASE, plane: 0, source: 'cloud', at: 1 } as HeldKey))
    expect(bought).toBe(1)
    expect(useShards.getState().deployError).toBeNull()
    expect(publishMany).toHaveBeenCalled()
    expect(useToast.getState().toast?.label).not.toBe('KEY CHECK FAILED')
    const row = useShards.getState().mine[0]
    expect(row.lookupId).toBe(rk.lookupId)
    expect(row.keyHex).toBe(bytesToHex(rk.key))
  })

  it('says so in a toast when the row as stored fails the self-check (its lookup id is not sha256 of its key)', async () => {
    const rk = regionKeyAt(ELSEWHERE, 3, 20)
    useToast.setState({ toast: null })
    // The seal's check passes; the check of the stored row is told it does not.
    vi.mocked(keyFitsLookup).mockReturnValueOnce(true).mockReturnValueOnce(false)
    await deployWith(async () => ({ lookupId: rk.lookupId, keyHex: bytesToHex(rk.key), height: 14, base: BASE, plane: 0, source: 'cloud', at: 1 } as HeldKey))
    expect(useToast.getState().toast).toMatchObject({ label: 'KEY CHECK FAILED', meta: expect.stringContaining(WRONG_KEY) })
  })
})
