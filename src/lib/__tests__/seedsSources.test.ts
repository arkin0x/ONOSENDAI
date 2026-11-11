/**
 * seedsSources.test.ts: where the seeds clock gets its tip and its headers
 * (DECK-0008 §4.1, §4.2; DECK-0001 §2.5). The tip is NTH's newest verified
 * anchor, never another key's kind 321; heights between the blobs' end and
 * the first anchor with a header tag are not asked for; one height is
 * fetched once however many seeds need it; a manifest that could not be
 * fetched is asked for again. The relays and the manifest are mocks.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import anchor975256 from './vectors/nth-anchor-975256.json'
import type { NostrEvent } from '../events'

const query = vi.fn<(filter: Record<string, unknown>) => Promise<NostrEvent[]>>()
const fetchManifest = vi.fn()
vi.mock('../relay', () => ({ query: (f: Record<string, unknown>) => query(f), publishMany: vi.fn(), relaySet: () => ['wss://relay.test'] }))
vi.mock('../hyperspace/headerSync', () => ({ fetchManifest: () => fetchManifest(), blobUrl: (m: string, f: string) => `${m}/${f}` }))

const fresh = (): NostrEvent => JSON.parse(JSON.stringify(anchor975256)) as NostrEvent

beforeEach(() => {
  vi.resetModules()
  query.mockReset()
  fetchManifest.mockReset()
})

describe('the trusted tip', () => {
  it('is NTH\'s newest verified anchor; another key\'s higher anchor is not believed', async () => {
    const forged = { ...fresh(), pubkey: 'ab'.repeat(32), tags: fresh().tags.map((t) => (t[0] === 'B' ? ['B', '999999'] : t)) }
    query.mockImplementation(async (f) => {
      expect(f.authors).toBeDefined()
      return [forged, fresh()]
    })
    const s = await import('../seeds/seedSources')
    expect(s.trustedTip()).toBeNull()
    expect(await s.refreshTrustedTip(null, 1_000_000)).toBe(975256)
    expect(s.trustedTip()).toBe(975256)
  })
})

describe('fetching headers', () => {
  it('heights between the blobs and the first header tag are never asked for', async () => {
    fetchManifest.mockResolvedValue({ manifest: { blobSize: 50000, blobs: [{ startHeight: 950000, count: 22000, file: 'b', sha256: '00' }], checkpoints: [] }, url: 'https://m.test' })
    query.mockResolvedValue([])
    const s = await import('../seeds/seedSources')
    await s.fetchSeedHeaders([973000, 974000, 975200])
    expect(query).not.toHaveBeenCalled()
    expect(s.headerBook.isAbsent(974000)).toBe(true)
  })

  it('one height needed by many seeds at once goes out once', async () => {
    fetchManifest.mockResolvedValue(null)
    let release: () => void = () => {}
    query.mockImplementation(() => new Promise((r) => { release = () => r([fresh()]) }))
    const s = await import('../seeds/seedSources')
    const all = Array.from({ length: 20 }, () => s.fetchSeedHeaders([975256]))
    await new Promise((r) => setTimeout(r, 0))
    release()
    await Promise.all(all)
    expect(query).toHaveBeenCalledTimes(1)
    expect(s.headerBook.time(975256)).toBeGreaterThan(0)
  })

  it('a manifest that could not be fetched is asked for again', async () => {
    fetchManifest.mockResolvedValue(null)
    query.mockResolvedValue([])
    const s = await import('../seeds/seedSources')
    await s.fetchSeedHeaders([975300])
    await s.fetchSeedHeaders([975301])
    expect(fetchManifest).toHaveBeenCalledTimes(2)
  })
})
