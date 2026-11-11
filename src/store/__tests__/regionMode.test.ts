/**
 * regionMode.test.ts - the region selector's state (store/useRegion.ts): it
 * turns on inside VIEW, grows to hold the entry cell and the cursor cell as
 * the cursor moves, X collapses it back to the entry cell, RESET restores its
 * entry size, and leaving VIEW folds it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { regionAtOriginalSize, useRegion } from '../useRegion'
import { useBuilder } from '../useBuilder'

const cs = () => useCyberspace.getState()
const region = () => useRegion.getState()

beforeEach(() => {
  useRegion.getState().exit()
  cs().clearFocus()
  useCyberspace.setState({ scaleExp: 4 })
})
afterEach(() => {
  useRegion.getState().exit()
  cs().clearFocus()
})

describe('region mode, a tool inside VIEW', () => {
  it('does not turn on outside VIEW', () => {
    region().enter()
    expect(region().active).toBe(false)
  })

  it('turns on in VIEW with the entry cell as the region, grows on a cursor move, and RESET and X return it', () => {
    cs().viewHere()
    expect(cs().viewing()).toBe(true)
    region().enter()
    expect(region().active).toBe(true)
    const entryPrefix = region().prefix
    expect(entryPrefix).not.toBeNull()
    expect(regionAtOriginalSize(region())).toBe(true)

    // Move the cursor well away (far enough that the region must coarsen past a
    // single cell whatever the entry cell's alignment): it grows to hold both
    // cells, a shorter prefix, and is no longer at its original size.
    const right = cs().axes().right
    for (let i = 0; i < 20; i++) cs().moveCursor({ axis: right.axis, dir: right.dir as 1 | -1 })
    const grown = region().prefix
    expect(grown).not.toBeNull()
    expect(grown).not.toBe(entryPrefix)
    expect(grown!.length).toBeLessThan(entryPrefix!.length)
    expect(regionAtOriginalSize(region())).toBe(false)

    // RESET: back to the entry size, the cursor left where it is.
    region().resetSize()
    expect(region().prefix).toBe(entryPrefix)
    expect(regionAtOriginalSize(region())).toBe(true)

    // Grow again, then X: the cursor returns to the entry cell and the region
    // collapses to it.
    for (let i = 0; i < 20; i++) cs().moveCursor({ axis: right.axis, dir: right.dir as 1 | -1 })
    expect(regionAtOriginalSize(region())).toBe(false)
    const entry = region().entry!
    region().collapseToEntry()
    expect(cs().cursor).toEqual(entry)
    expect(region().prefix).toBe(entryPrefix)
  })

  it('folds when VIEW ends', () => {
    cs().viewHere()
    region().enter()
    expect(region().active).toBe(true)
    cs().clearFocus()
    expect(region().active).toBe(false)
  })

  it('ends when BUILD starts from VIEW', () => {
    cs().viewHere()
    region().enter()
    expect(region().active).toBe(true)
    useBuilder.getState().enter('build')
    expect(useBuilder.getState().active).toBe(true)
    expect(region().active).toBe(false)
    useBuilder.getState().exit()
  })
})
