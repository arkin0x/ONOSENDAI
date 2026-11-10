/**
 * planeViews.test.ts: what each view shows when one bag holds a region and
 * its twin in the other plane (spec §7.6 Planes): TV's FOUND lines, the
 * plane chat listens in, and a bag's Where.
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

import type { Hidden } from '../../lib/hidden'
import { tvFresh } from '../useTv'
import { useMutes } from '../useMutes'
import { linesInPlane, listeningPlane, type ChatLine } from '../useChat'
import { wherePlanes } from '../../hud/LootDetail'
import { openedTitle } from '../../hud/DiscoveredPanel'

const item = (id: string, plane: 0 | 1): Hidden => ({
  eventId: id, bagId: 'bag', lookupId: 'aa'.repeat(32), author: 'b'.repeat(64), at: { x: 1n, y: 2n, z: 3n }, plane,
  height: 4, createdAt: 1, type: 'shard',
}) as Hidden

describe('TV shows a find only in its own plane', () => {
  it('a FOUND line and a find are only what stands in the plane the view is in; the rest stay unfound', () => {
    const opened = [{ items: [item('d', 0), item('i', 1)], bag: { created_at: 5 } }] as never
    expect(tvFresh({ found: {} }, opened, 0, useMutes.getState().muted, 'me').map((f) => f.h.eventId)).toEqual(['d'])
    expect(tvFresh({ found: {} }, opened, 1, useMutes.getState().muted, 'me').map((f) => f.h.eventId)).toEqual(['i'])
  })
})

describe('the plane chat listens in', () => {
  it('at the head, the plane you stand in, whatever plane is lined up for the next hop', () => {
    expect(listeningPlane({ atHead: () => true, headPlane: 0, anchorPlane: 1 })).toBe(0)
  })
  it('spectating, in free view or in your history, the plane the view is in', () => {
    expect(listeningPlane({ atHead: () => false, headPlane: 0, anchorPlane: 1 })).toBe(1)
  })
})

describe('the chat dock shows the listening plane\'s talk', () => {
  it('keeps lines of this plane and lines that name none, and leaves out the other plane\'s', () => {
    const line = (id: string, plane?: 0 | 1): ChatLine => ({ id, from: 'f'.repeat(64), text: id, at: 1, region: 'r', height: 12, mine: false, ...(plane === undefined ? {} : { plane }) })
    const lines = [line('d', 0), line('i', 1), line('old')]
    expect(linesInPlane(lines, 0).map((l) => l.id)).toEqual(['d', 'old'])
    expect(linesInPlane(lines, 1).map((l) => l.id)).toEqual(['i', 'old'])
  })
})

describe('a bag\'s Where', () => {
  it('names the plane its items are in, both when they differ, and marks each row then', () => {
    expect(wherePlanes([])).toEqual({ label: 'hidden', mixed: false })
    expect(wherePlanes([{ plane: 0 }, { plane: 0 }])).toEqual({ label: 'known · dataspace', mixed: false })
    expect(wherePlanes([{ plane: 1 }])).toEqual({ label: 'known · ideaspace', mixed: false })
    expect(wherePlanes([{ plane: 0 }, { plane: 1 }])).toEqual({ label: 'known · dataspace and ideaspace', mixed: true })
  })
  it('the DISCOVERED BAGS title splits the count by plane when the bag holds both', () => {
    expect(openedTitle('none', 3, { data: 2, idea: 1 })).toBe('Opened: 3 items (2 in dataspace, 1 in ideaspace)')
    expect(openedTitle('none', 2, { data: 2, idea: 0 })).toBe('Opened: 2 items')
  })
})
