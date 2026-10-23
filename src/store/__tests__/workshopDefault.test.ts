/**
 * workshopDefault.test.ts - which object the workshop opens when it is not
 * told one: the one edited most recently, the top of the list, never simply
 * the oldest one in storage (arkinox, 2026-09-27). A deploy counts as an edit
 * there as it does in the list (2026-10-23), so what opens is what the list
 * shows first.
 */

import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { newShard, type ShardModel } from 'sno-core/shards'
import { newestId, readLastUsedFrom, useWorkshop } from '../useWorkshop'

const w = () => useWorkshop.getState()
const at = (name: string, updatedAt: number): ShardModel => ({ ...newShard(name), id: name, updatedAt })

let used: Record<string, number> = {}
readLastUsedFrom(() => used)

beforeEach(() => {
  used = {}
  // Stored in the order made: the Crucifix first, edited longest ago.
  useWorkshop.setState({ shards: [at('crucifix', 1_000), at('pool', 3_000), at('lamp', 2_000)], currentId: null, open: false })
})

describe('the object the workshop opens', () => {
  it('is the most recently edited on a fresh load, not the first one stored', () => {
    w().openWorkshop()
    expect(w().currentId).toBe('pool')
  })

  it('is still the one already open, within a session', () => {
    w().openWorkshop('lamp')
    w().closeWorkshop()
    w().openWorkshop()
    expect(w().currentId).toBe('lamp')
  })

  it('after deleting the open object, is the most recently edited of the rest', () => {
    w().openWorkshop('pool')
    w().remove('pool')
    expect(w().currentId).toBe('lamp')
  })

  it('is the one deployed most recently on a fresh load, when that is later than every edit', () => {
    used = { crucifix: 4_000 }
    w().openWorkshop()
    expect(w().currentId).toBe('crucifix')
  })

  it('is the one edited since, when an edit is later than the deploy', () => {
    used = { crucifix: 2_500 }
    w().openWorkshop()
    expect(w().currentId).toBe('pool')
  })

  it('after deleting the open object, is the top of the list of the rest, deploys counted', () => {
    used = { crucifix: 2_500 }
    w().openWorkshop('pool')
    w().remove('pool')
    expect(w().currentId).toBe('crucifix')
  })

  it('treats an object with no edit time as oldest, and an empty list as none', () => {
    // Objects saved before edit times existed have none.
    const { updatedAt: _dropped, ...rest } = newShard('bare')
    const bare = { ...rest, id: 'bare' } as unknown as ShardModel
    expect(newestId([bare, at('x', 5)])).toBe('x')
    expect(newestId([])).toBeNull()
    expect(newestId([bare, at('x', 5)], { bare: 9 })).toBe('bare')
  })
})
