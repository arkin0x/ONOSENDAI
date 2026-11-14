/**
 * hiddenSectorFirst.test.tsx - HIDDEN BAGS shows the bags of the sector you
 * stand in first, under THIS SECTOR, then every other bag under ELSEWHERE, as
 * the list was (owner, 2026-11-14). A bag without a hint is always elsewhere.
 * With nothing in your sector the list is plain, without headings. Rendered
 * to markup: no network.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const loot = vi.hoisted(() => ({ items: [] as unknown[], sector: null as string | null }))
vi.mock('../../hooks/useLoot', async (orig) => {
  const real = await orig<typeof import('../../hooks/useLoot')>()
  return { ...real, useLoot: () => ({ items: loot.items, status: 'ready', trouble: null, sector: loot.sector }), refreshLoot: vi.fn() }
})
vi.mock('../../hooks/useProfile', () => ({ useProfile: () => null }))

import { HiddenPanel } from '../DiscoveredPanel'
import type { LootItem } from '../../lib/loot'

const bag = (n: number, sector: string | null): LootItem => ({
  bagId: `${n}`.padStart(64, '0'), key: `a:${n}`, author: 'ab'.repeat(32), lookupId: `${n}`.padStart(64, 'a'),
  height: 8, createdAt: 1_790_000_000 - n, bytes: 100, riddle: `riddle ${n}`, sector, hint: null,
})

/** The riddles and headings in the order the markup has them. */
function order(html: string): string[] {
  // A row says its riddle twice (its title and its text): once each here.
  const all = [...html.matchAll(/riddle (\d+)|class="loot__group"[^>]*>([A-Z ]+)</g)].map((m) => m[1] ? `r${m[1]}` : m[2])
  return all.filter((x, i) => x !== all[i - 1])
}

beforeEach(() => {
  loot.sector = '1-2-3'
})

describe('HIDDEN BAGS, your sector first', () => {
  it('lists your sector\'s bags first under THIS SECTOR, then the rest, newest first, under ELSEWHERE', () => {
    // Newest first, as the list keeps them: 1 (no hint), 2 (elsewhere), 3 (here), 4 (here).
    loot.items = [bag(1, null), bag(2, '9-9-9'), bag(3, '1-2-3'), bag(4, '1-2-3')]
    expect(order(renderToStaticMarkup(<HiddenPanel />))).toEqual(['THIS SECTOR', 'r3', 'r4', 'ELSEWHERE', 'r1', 'r2'])
  })

  it('with nothing in your sector, the plain list, no headings', () => {
    loot.items = [bag(1, null), bag(2, '9-9-9')]
    expect(order(renderToStaticMarkup(<HiddenPanel />))).toEqual(['r1', 'r2'])
    loot.sector = null
    loot.items = [bag(1, null), bag(3, '1-2-3')]
    expect(order(renderToStaticMarkup(<HiddenPanel />))).toEqual(['r1', 'r3'])
  })

  it('fills the panel\'s few rows from your sector first, ELSEWHERE only when room is left', () => {
    loot.items = [bag(1, null), bag(2, null), bag(5, '1-2-3'), bag(6, '1-2-3'), bag(7, '1-2-3'), bag(8, '1-2-3')]
    expect(order(renderToStaticMarkup(<HiddenPanel />))).toEqual(['THIS SECTOR', 'r5', 'r6', 'r7', 'r8'])
  })

})
