/**
 * The anchor sync's progress reaches the store only when it changes
 * something (2026-10-15): a report that changes nothing must leave the very
 * same sync object, so no panel showing it re-renders.
 */
import { describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const { nextSync } = await import('../useHyperspace')

describe('nextSync', () => {
  const prev = { status: 'syncing' as const, loaded: 100, total: 950000, error: null, source: 'blobs' as const }
  it('returns the same object for a report that changes nothing', () => {
    expect(nextSync(prev, { loaded: 100 })).toBe(prev)
    expect(nextSync(prev, { status: 'syncing', source: 'blobs' })).toBe(prev)
    expect(nextSync(prev, {})).toBe(prev)
  })
  it('returns a new object with the change applied otherwise', () => {
    const next = nextSync(prev, { loaded: 200 })
    expect(next).not.toBe(prev)
    expect(next).toEqual({ ...prev, loaded: 200 })
    expect(nextSync(prev, { status: 'ready', loaded: 950000 })).toEqual({ ...prev, status: 'ready', loaded: 950000 })
  })
})
