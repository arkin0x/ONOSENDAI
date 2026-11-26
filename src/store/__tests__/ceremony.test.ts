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
import { clearNearbyNew, nearbyNewFor } from '../nearbyNew'
import { useTv } from '../useTv'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import type { Hidden } from '../../lib/hidden'

/** How many finds NEARBY counts new (the orange +N) for the identity on screen. */
const newFinds = (): number => nearbyNewFor(useCyberspace.getState().identity.pubkey).size

const item = (id: string, text: string): Hidden => ({
  eventId: id, bagId: 'bag', lookupId: 'aa'.repeat(32), author: 'b'.repeat(64), at: { x: 1n, y: 2n, z: 3n }, plane: 0,
  height: 4, createdAt: 1, type: 'message', text,
})

describe('the new finds NEARBY counts (the orange +N, store/nearbyNew.ts)', () => {
  beforeEach(() => {
    useShards.setState({ nearbyOpen: false, discovered: {} })
    useCeremony.setState({ births: {}, pending: [] }); clearNearbyNew()
    useCyberspace.setState({ anchorPlane: 0, headPlane: 0, anchor: { x: 1n, y: 2n, z: 3n } })
  })

  it('counts what was found, and keeps counting until the Nearby list is opened', () => {
    // Found where the view stands, so the Nearby list shows them.
    useShards.setState({ discovered: Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((id) => [id, item(id, id)])) })
    useCeremony.getState().mark([item('a', 'one'), item('b', 'two')])
    expect(newFinds()).toBe(2)
    useCeremony.getState().mark([item('c', 'three')])
    expect(newFinds()).toBe(3)
    // The same find marked again is not counted twice.
    useCeremony.getState().mark([item('c', 'three')])
    expect(newFinds()).toBe(3)
    expect(useCeremony.getState().births.c).toBeDefined()
    useShards.getState().setNearbyOpen(true)
    expect(newFinds()).toBe(0)
    // Found with the list open: it is on screen already.
    useCeremony.getState().mark([item('e', 'five')])
    expect(newFinds()).toBe(0)
    useShards.getState().setNearbyOpen(false)
    useCeremony.getState().mark([item('d', 'four')])
    expect(newFinds()).toBe(1)
  })

  it('opening the list clears only what it lists: a find somewhere else stays new', () => {
    const far = { ...item('f', 'far away'), at: { x: 1n << 30n, y: 2n, z: 3n } }
    useShards.setState({ discovered: { a: item('a', 'here'), f: far } })
    useCeremony.getState().mark([item('a', 'here'), far])
    expect(newFinds()).toBe(2)
    useShards.getState().setNearbyOpen(true)
    useShards.getState().setNearbyOpen(false)
    expect([...nearbyNewFor(useCyberspace.getState().identity.pubkey)]).toEqual(['f'])
  })

  it('does nothing for an empty find', () => {
    useCeremony.getState().mark([])
    expect(newFinds()).toBe(0)
  })
})

describe('the new finds and the plane (spec §7.6 Planes)', () => {
  const at = { x: 1n, y: 2n, z: 3n }
  const standAt = (plane: 0 | 1, anchor = at): void => {
    useCyberspace.setState({ anchorPlane: plane, headPlane: plane, plane, anchor, position: anchor, spectate: null, exploreIndex: null, focus: null, transit: null })
  }
  beforeEach(() => {
    useShards.setState({ nearbyOpen: false })
    useCeremony.setState({ births: {}, pending: [] }); clearNearbyNew()
    useTv.setState({ on: false })
    standAt(0)
  })

  it('counts only finds in the plane the view is in, and gives the rest their ceremony in their own region and plane', () => {
    const twin = { ...item('t', 'in ideaspace'), plane: 1 as const }
    useShards.setState({ discovered: { t: twin } })
    useCeremony.getState().mark([item('h', 'in dataspace'), twin])
    expect(newFinds()).toBe(1)
    expect(useCeremony.getState().births.t).toBeUndefined()
    expect(useCeremony.getState().pending.map((h) => h.eventId)).toEqual(['t'])
    standAt(1)
    expect(newFinds()).toBe(2)
    expect(useCeremony.getState().births.t).toBeDefined()
    expect(useCeremony.getState().pending).toEqual([])
  })

  it('does not fire in the right plane at the wrong place, and fires on arriving', () => {
    const twin = { ...item('w', 'over there'), plane: 1 as const }
    useShards.setState({ discovered: { w: twin } })
    useCeremony.getState().mark([twin])
    standAt(1, { x: 1n << 30n, y: 2n, z: 3n })
    expect(newFinds()).toBe(0)
    expect(useCeremony.getState().pending).toHaveLength(1)
    standAt(1)
    expect(newFinds()).toBe(1)
  })

  it('does not fire while TV is on, or spectating someone', () => {
    const twin = { ...item('v', 'seen on TV'), plane: 1 as const }
    useShards.setState({ discovered: { v: twin } })
    useCeremony.getState().mark([twin])
    useTv.setState({ on: true })
    standAt(1)
    expect(newFinds()).toBe(0)
    useTv.setState({ on: false })
    useCyberspace.setState({ anchorPlane: 0 })
    useCyberspace.setState({ anchorPlane: 1, spectate: 'f'.repeat(64) } as never)
    expect(newFinds()).toBe(0)
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
    expect(newFinds()).toBe(0)
    expect(useCeremony.getState().pending).toEqual([])
  })
})
