/**
 * bloomsTip.test.ts: when the blooms regrow for a new trusted tip (useBlooms).
 * With nothing kept and NTH silent at first, seeds wait for blocks; NTH is
 * asked again in seconds, and a tip that arrives meanwhile by another road (a
 * planting's forced ask) still regrows every seed. The kept tip is where the
 * passes start: only a newer one regrows. The engine and its sources are
 * stand-ins: no network, no worker, fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Each test imports useBlooms' tree afresh (vi.resetModules): slow under load, never a hang.
vi.setConfig({ testTimeout: 30_000 })

const engine = vi.hoisted(() => ({ refreshed: 0 }))
const src = vi.hoisted(() => ({ trusted: null as number | null, asked: 0, answer: null as number | null, kept: null as number | null }))
vi.mock('../../lib/seeds/bloomEngine', () => ({
  BloomEngine: class {
    want(): void {}
    wanted(): string[] { return [] }
    forget(): void {}
    refreshAll(only?: unknown): void { if (!only) engine.refreshed++ }
    growAnyway(): void {}
  },
}))
vi.mock('../../lib/seeds/seedSources', () => ({
  dnaResolver: { onChange: () => () => undefined },
  fetchSeedHeaders: async () => undefined,
  headerBook: {},
  refreshTrustedTip: async () => {
    src.asked++
    if (src.answer !== null && (src.trusted === null || src.answer > src.trusted)) src.trusted = src.answer
    return src.trusted
  },
  trustedTip: () => src.trusted,
  headersReady: async () => { if (src.kept !== null) src.trusted = src.kept },
  settledBefore: () => undefined,
  noteSettled: () => undefined,
  onKeptTip: () => () => undefined,
  TIP_REFRESH_MS: 120_000,
  TIP_RETRY_MS: 10_000,
}))
vi.mock('../../lib/seeds/growClient', () => ({ growInWorker: async () => ({}), forgetInWorker: () => undefined }))

import type { SeedItem } from '../../lib/seeds/seedItem'

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve() }

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  engine.refreshed = 0
  Object.assign(src, { trusted: null, asked: 0, answer: null, kept: null })
})
afterEach(() => { vi.useRealTimers() })

describe('the trusted tip and the blooms', () => {
  it('nothing kept, NTH silent: asked again in seconds; a tip another caller fetched meanwhile still regrows', async () => {
    const { wantSeeds } = await import('../useBlooms')
    wantSeeds([{ id: 'a' } as SeedItem])
    await flush()
    expect(src.asked).toBe(1)
    expect(engine.refreshed).toBe(0)
    // A planting forced NTH's answer in between the asks.
    src.trusted = 975_300
    await vi.advanceTimersByTimeAsync(10_001)
    await flush()
    expect(src.asked).toBe(2)
    expect(engine.refreshed).toBe(1)
  })

  it('the kept tip is where the passes start: the same tip from NTH regrows nothing, a newer one does', async () => {
    src.kept = 975_300
    src.answer = 975_300
    const { wantSeeds } = await import('../useBlooms')
    wantSeeds([{ id: 'a' } as SeedItem])
    await flush()
    expect(engine.refreshed).toBe(0)
    src.answer = 975_301
    await vi.advanceTimersByTimeAsync(120_001)
    await flush()
    expect(engine.refreshed).toBe(1)
  })
})
