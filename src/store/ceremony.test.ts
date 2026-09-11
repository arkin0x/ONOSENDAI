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
if (typeof performance === 'undefined') (globalThis as { performance?: unknown }).performance = { now: () => Date.now() }

import { useCeremony } from './useCeremony'
import type { Hidden } from '../lib/hidden'

const item = (id: string, text: string): Hidden => ({
  eventId: id, bagId: 'bag', lookupId: 'aa'.repeat(32), author: 'b'.repeat(64), at: { x: 1n, y: 2n, z: 3n }, plane: 0,
  height: 4, createdAt: 1, type: 'message', text,
})

describe('the found chip', () => {
  beforeEach(() => { useCeremony.setState({ chip: null, births: {} }) })

  it('counts what was found, and keeps counting until tapped', () => {
    useCeremony.getState().mark([item('a', 'one'), item('b', 'two')])
    expect(useCeremony.getState().chip?.count).toBe(2)
    useCeremony.getState().mark([item('c', 'three')])
    expect(useCeremony.getState().chip?.count).toBe(3)
    expect(useCeremony.getState().chip?.label).toBe('three')
    useCeremony.getState().dismiss()
    expect(useCeremony.getState().chip).toBeNull()
    useCeremony.getState().mark([item('d', 'four')])
    expect(useCeremony.getState().chip?.count).toBe(1)
  })

  it('does nothing for an empty find', () => {
    useCeremony.getState().mark([])
    expect(useCeremony.getState().chip).toBeNull()
  })
})
