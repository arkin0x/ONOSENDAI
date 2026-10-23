/**
 * opacity.test.ts - the workshop's OPACITY (DECK-0003 §1.11): undoable like
 * MODE, 100 stored as no opacity at all, the floor kept, and what is
 * published carries it.
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

import { fromPayload, newShard, toPayload, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../useWorkshop'

const w = () => useWorkshop.getState()
const cur = () => w().current() as ShardModel

beforeEach(() => {
  const s: ShardModel = { ...newShard('Water'), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [0, 0, 1] }, { p: [1, 0, 0], c: [0, 0, 1] }, { p: [0, 0, 1], c: [0, 0, 1] }], faces: [[0, 1, 2]] }
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [], selection: [], partSel: [] })
})

describe('OPACITY', () => {
  it('sets a whole percent, and undo takes it back', () => {
    w().setOpacity(50)
    expect(cur().opacity).toBe(50)
    w().undo()
    expect(cur()).not.toHaveProperty('opacity')
  })

  it('stores 100 as no opacity at all', () => {
    w().setOpacity(40)
    w().setOpacity(100)
    expect(cur()).not.toHaveProperty('opacity')
  })

  it('keeps the floor', () => {
    w().setOpacity(3)
    expect(cur().opacity).toBe(10)
  })

  it('is what the published payload carries, and reads back', () => {
    w().setOpacity(45)
    const wire = JSON.parse(JSON.stringify(toPayload(cur())))
    expect(wire.opacity).toBe(45)
    expect(fromPayload(wire, 'x')?.opacity).toBe(45)
    w().setOpacity(100)
    expect(toPayload(cur())).not.toHaveProperty('opacity')
  })
})
