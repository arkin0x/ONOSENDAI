/**
 * miningSyncLine.test.ts - MINING's foot says what is true now (review of
 * #951): synced across your devices, saved on this device only, or that the
 * last sync failed, never "synced" over a failure or a signer that cannot
 * encrypt.
 */

import { describe, expect, it } from 'vitest'
import { syncLine } from '../MiningPanel'

const NOW = 1_790_000_000_000
const base = { enabled: true, live: true, status: 'synced' as const, dirty: false, syncedAt: NOW - 5 * 60_000, now: NOW }

describe('the sync line', () => {
  it('synced: across your devices, with when', () => {
    expect(syncLine(base)).toEqual({ synced: true, words: 'Synced across your devices', when: 'Last synced 5 min ago' })
  })

  it('new stats not yet saved: says when they will be', () => {
    expect(syncLine({ ...base, status: 'idle', dirty: true })).toEqual({ synced: true, words: 'Synced across your devices', when: 'New stats save within 10 min' })
  })

  it('a failed sync says so, never synced', () => {
    expect(syncLine({ ...base, status: 'error' })).toEqual({ synced: false, words: 'Sync failed', when: 'Last synced 5 min ago' })
    expect(syncLine({ ...base, status: 'error', syncedAt: 0 })).toEqual({ synced: false, words: 'Sync failed', when: 'Not synced yet' })
  })

  it('a signer without NIP-44, LOCAL, or the switch off: saved on this device only', () => {
    expect(syncLine({ ...base, status: 'unsupported' })).toMatchObject({ synced: false, words: 'Saved on this device only' })
    expect(syncLine({ ...base, live: false })).toEqual({ synced: false, words: 'Saved on this device only', when: 'Switch to LIVE to sync' })
    expect(syncLine({ ...base, enabled: false })).toEqual({ synced: false, words: 'Saved on this device only', when: 'Sync is off in Settings' })
  })

  it('never synced yet: not synced, not a claim', () => {
    expect(syncLine({ ...base, status: 'idle', syncedAt: 0 })).toEqual({ synced: false, words: 'Not synced yet', when: '' })
    expect(syncLine({ ...base, status: 'idle', syncedAt: 0, dirty: true })).toMatchObject({ words: 'Not synced yet', when: 'New stats save within 10 min' })
  })
})
