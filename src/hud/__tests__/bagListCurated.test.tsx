/**
 * bagListCurated.test.tsx - the HIDDEN and DISCOVERED bag lists during the
 * /demo tour's district steps (review of #364, 2026-10-15): on a desktop the
 * panels stay open beside the scene, so while the tour curates the district
 * they list only the curators' bags, and everyone's again once it does not.
 */
import { describe, expect, it } from 'vitest'
import { shownBags } from '../DiscoveredPanel'
import { DEMO_CURATORS } from '../../demo/script'
import type { LootItem } from '../../lib/loot'

const bag = (author: string, n: number): LootItem => ({
  bagId: `${n}`.padStart(64, '0'), key: `${author}:${n}`, author, lookupId: `${n}`.padStart(64, 'a'),
  height: 8, createdAt: 1_790_000_000 + n, bytes: 100, riddle: `riddle ${n}`, sector: null, hint: null,
})
const STRANGER = 'ef'.repeat(32)

describe('the bag lists while the tour curates the district', () => {
  const items = [bag(DEMO_CURATORS[0], 1), bag(STRANGER, 2), bag(DEMO_CURATORS[1], 3), bag(STRANGER, 4)]
  const opened = new Set([items[2].bagId, items[3].bagId])
  const riddles = (l: LootItem[]): string[] => l.map((b) => b.riddle)

  it('lists everyone outside the tour', () => {
    expect(riddles(shownBags(items, opened, 'hidden', null))).toEqual(['riddle 1', 'riddle 2'])
    expect(riddles(shownBags(items, opened, 'discovered', null))).toEqual(['riddle 3', 'riddle 4'])
  })

  it('lists only the curators\' bags while curated, hidden and opened alike', () => {
    expect(riddles(shownBags(items, opened, 'hidden', DEMO_CURATORS))).toEqual(['riddle 1'])
    expect(riddles(shownBags(items, opened, 'discovered', DEMO_CURATORS))).toEqual(['riddle 3'])
  })
})
