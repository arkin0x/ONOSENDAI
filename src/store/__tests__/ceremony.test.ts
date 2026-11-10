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

import { PENDING_MAX, useCeremony } from '../useCeremony'
import { useTv } from '../useTv'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import type { Hidden } from '../../lib/hidden'

const item = (id: string, text: string): Hidden => ({
  eventId: id, bagId: 'bag', lookupId: 'aa'.repeat(32), author: 'b'.repeat(64), at: { x: 1n, y: 2n, z: 3n }, plane: 0,
  height: 4, createdAt: 1, type: 'message', text,
})

describe('the found chip', () => {
  beforeEach(() => { useCeremony.setState({ chip: null, births: {}, pending: [] }); useCyberspace.setState({ anchorPlane: 0, headPlane: 0 }) })

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

describe('the found chip and the plane (spec §7.6 Planes)', () => {
  const at = { x: 1n, y: 2n, z: 3n }
  const standAt = (plane: 0 | 1, anchor = at): void => {
    useCyberspace.setState({ anchorPlane: plane, headPlane: plane, plane, anchor, position: anchor, spectate: null, exploreIndex: null, focus: null, transit: null })
  }
  beforeEach(() => {
    useCeremony.setState({ chip: null, births: {}, pending: [] })
    useTv.setState({ on: false })
    standAt(0)
  })

  it('counts only finds in the plane the view is in, and gives the rest their ceremony in their own region and plane', () => {
    const twin = { ...item('t', 'in ideaspace'), plane: 1 as const }
    useShards.setState({ discovered: { t: twin } })
    useCeremony.getState().mark([item('h', 'in dataspace'), twin])
    expect(useCeremony.getState().chip?.count).toBe(1)
    expect(useCeremony.getState().births.t).toBeUndefined()
    expect(useCeremony.getState().pending.map((h) => h.eventId)).toEqual(['t'])
    standAt(1)
    expect(useCeremony.getState().chip?.count).toBe(2)
    expect(useCeremony.getState().chip?.label).toBe('in ideaspace')
    expect(useCeremony.getState().births.t).toBeDefined()
    expect(useCeremony.getState().pending).toEqual([])
  })

  it('does not fire in the right plane at the wrong place, and fires on arriving', () => {
    const twin = { ...item('w', 'over there'), plane: 1 as const }
    useShards.setState({ discovered: { w: twin } })
    useCeremony.getState().mark([twin])
    standAt(1, { x: 1n << 30n, y: 2n, z: 3n })
    expect(useCeremony.getState().chip).toBeNull()
    expect(useCeremony.getState().pending).toHaveLength(1)
    standAt(1)
    expect(useCeremony.getState().chip?.count).toBe(1)
  })

  it('does not fire while TV is on, or spectating someone', () => {
    const twin = { ...item('v', 'seen on TV'), plane: 1 as const }
    useShards.setState({ discovered: { v: twin } })
    useCeremony.getState().mark([twin])
    useTv.setState({ on: true })
    standAt(1)
    expect(useCeremony.getState().chip).toBeNull()
    useTv.setState({ on: false })
    useCyberspace.setState({ anchorPlane: 0 })
    useCyberspace.setState({ anchorPlane: 1, spectate: 'f'.repeat(64) } as never)
    expect(useCeremony.getState().chip).toBeNull()
    expect(useCeremony.getState().pending).toHaveLength(1)
  })

  it('keeps at most PENDING_MAX finds waiting, dropping the oldest', () => {
    const many = Array.from({ length: PENDING_MAX + 5 }, (_, i) => ({ ...item(`p${i}`, `find ${i}`), plane: 1 as const }))
    useCeremony.getState().mark(many)
    const pending = useCeremony.getState().pending
    expect(pending).toHaveLength(PENDING_MAX)
    expect(pending[0].eventId).toBe('p5')
    expect(pending.at(-1)!.eventId).toBe(`p${PENDING_MAX + 4}`)
  })

  it('a find set aside and gone before it is reached gets no ceremony', () => {
    const twin = { ...item('g', 'deleted meanwhile'), plane: 1 as const }
    useShards.setState({ discovered: {} })
    useCeremony.getState().mark([twin])
    standAt(1)
    expect(useCeremony.getState().chip).toBeNull()
    expect(useCeremony.getState().pending).toEqual([])
  })
})
