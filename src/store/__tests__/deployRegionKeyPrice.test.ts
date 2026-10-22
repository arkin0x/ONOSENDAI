/**
 * deployRegionKeyPrice.test.ts - a hide above this machine's ceiling buys a
 * region key from HOSAKA, and the price it asks about (or goes ahead at, in
 * AUTO) is the provider's region key price when /provider publishes one
 * (hosaka-api#30), and the hop ladder's as before when it does not. What
 * would fail silently without it: a hide asking at the hop's price for a key
 * HOSAKA charges more for, or AUTO buying past its cap without asking.
 *
 * Network-free: the relays are mocked and the purchase itself is replaced, so
 * nothing reaches HOSAKA or a relay. The cap comes from the fixture's /limits.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: false })),
  query: vi.fn(async () => []),
  queryEach: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCalibration } from '../../lib/calibration'
import type { HosakaLimits, HosakaProvider } from '../../lib/hosaka'
import { useCyberspace } from '../useCyberspace'
import { useSecrets } from '../useSecrets'
import { useShards } from '../useShards'

const LIMITS: HosakaLimits = {
  max_hop_height: 30, max_sidestep_height: 31, hop_min_msats: 1000,
  deposit_min_msats: 1000, deposit_max_msats: 10_000_000, invoice_ttl_seconds: 600,
}
const hop = [
  { max_height: 27, sats: 300, est_time: 'about 9 min', est_seconds: 540 },
  { max_height: 28, sats: 700, est_time: 'about 20 min', est_seconds: 1200 },
  { max_height: 30, sats: 9000, est_time: 'about 1.5 hr', est_seconds: 5400 },
]
const region_key = [
  { max_height: 27, sats: 250, est_time: 'about 11 min', est_seconds: 660 },
  { max_height: 28, sats: 1500, est_time: 'about 30 min', est_seconds: 1800 },
  { max_height: 30, sats: 20000, est_time: 'about 2.5 hr', est_seconds: 9000 },
]
const provider = (pricing: HosakaProvider['pricing']): HosakaProvider => ({ version: 1, name: 'HOSAKA', pricing })

const buy = vi.fn(async () => null)

function setUp(p: HosakaProvider, mode: 'ask' | 'auto', autoMaxSats: number, height: number): void {
  useCalibration.setState({ hopHeight: 17 })
  useCyberspace.setState({
    cloud: { ...useCyberspace.getState().cloud, limits: LIMITS, provider: p },
    cloudPrefs: { ...useCyberspace.getState().cloudPrefs, mode, autoMaxSats },
  })
  useShards.getState().startDeployMessage('under the floor')
  useShards.setState({ deployHeight: height, deployAsk: null })
}

beforeEach(() => {
  buy.mockClear()
  useSecrets.setState({ buy })
  useShards.setState({ mine: [], pending: null, deployStatus: 'idle', deployError: null, deployAsk: null })
})

describe('the HOSAKA ask for a hide', () => {
  it('asks at the region key price when the provider publishes one', async () => {
    setUp(provider({ hop, region_key }), 'ask', 0, 28)
    await useShards.getState().deploy()
    expect(useShards.getState().deployAsk).toEqual({ sats: 1500, seconds: 1800 })
    expect(buy).not.toHaveBeenCalled()
  })

  it('asks at the hop ladder price on a provider that predates the region key ladder', async () => {
    setUp(provider({ hop }), 'ask', 0, 28)
    await useShards.getState().deploy()
    expect(useShards.getState().deployAsk).toEqual({ sats: 700, seconds: 1200 })
  })

  it('AUTO asks when the region key costs more than its cap, though the hop would not', async () => {
    setUp(provider({ hop, region_key }), 'auto', 1000, 28)
    await useShards.getState().deploy()
    expect(useShards.getState().deployAsk).toEqual({ sats: 1500, seconds: 1800 })
    expect(buy).not.toHaveBeenCalled()
  })

  it('AUTO goes ahead without asking when the region key is within its cap', async () => {
    setUp(provider({ hop, region_key }), 'auto', 260, 26)
    await useShards.getState().deploy()
    expect(useShards.getState().deployAsk).toBeNull()
    expect(buy).toHaveBeenCalledTimes(1)
  })
})

describe('every place a region key is priced', () => {
  const src = (...p: string[]): string => readFileSync(join(__dirname, '..', '..', ...p), 'utf8')

  it('reads the region key ladder, never the hop ladder directly', () => {
    // The BUY button, the deploy bar's quote and the hide's ask.
    for (const file of [['hud', 'SecretsModal.tsx'], ['hud', 'DeployBar.tsx'], ['store', 'useShards.ts']]) {
      expect(src(...file), file.join('/')).not.toContain('pricing?.hop')
    }
    expect(src('hud', 'SecretsModal.tsx')).toContain('regionKeyQuote(buyHeight, provider)')
    expect(src('hud', 'DeployBar.tsx')).toContain('regionKeyLadder(s.cloud.provider)')
    expect(src('store', 'useShards.ts')).toContain('regionKeyQuote(deployHeight, cs.cloud.provider)')
  })

  it('and a bought region key waits by the region key ladder too', () => {
    const cs = src('store', 'useCyberspace.ts')
    const buyRegionKey = cs.slice(cs.indexOf('  buyRegionKey: async'), cs.indexOf('  rideViaHosaka: async'))
    expect(buyRegionKey).toContain('regionKeyQuote(height, get().cloud.provider)')
    expect(buyRegionKey).not.toContain('pricing?.hop')
  })
})
