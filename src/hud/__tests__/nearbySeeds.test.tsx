/**
 * nearbySeeds.test.tsx: SEEDS in DISCOVERED NEARBY (arkinox, 2026-11-13: "we
 * need to add seeds to this modal"). The seeds the list holds are counted
 * under SEEDS, never SHARDS, and in the DECRYPTED HERE total; a seed's row
 * says its DNA's name ("unknown DNA" until it is resolved), where it is and
 * how far it has grown on the card's clock ("day 12 of 41", "fully grown"),
 * who planted it (the seed's signer, "you" for your own) and how far, and
 * VIEW, which flies to it framed at the seed's scale as the card's GO TO
 * does. Its name opens the seed's card. The listed seeds are asked to grow
 * only while SEEDS is showing. The tabs keep their size on a phone and wrap,
 * four and three. No network: the blooms store is a stand-in.
 */
import { readFileSync } from 'node:fs'
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
;(globalThis as { window?: unknown }).window ??= globalThis

const list = vi.hoisted(() => ({ items: [] as unknown[] }))
vi.mock('../../hooks/useNearbyLoot', () => ({ useNearbyLoot: () => list.items }))
vi.mock('../ShardThumb', () => ({ ShardThumb: () => null }))
const blooms = vi.hoisted(() => ({ wanted: [] as string[][], room: [] as boolean[] }))
vi.mock('../../store/useBlooms', () => {
  // The store's shape, read where it is drawn: a test sets the views before it renders.
  let state = { views: {} as Record<string, unknown> }
  const useBlooms = Object.assign(<T,>(pick: (s: typeof state) => T): T => pick(state), {
    getState: () => state,
    setState: (part: Partial<typeof state>) => { state = { ...state, ...part } },
  })
  return {
    useBlooms,
    wantSeeds: (seeds: Array<{ id: string }>, o: { room?: boolean } = {}) => { if (seeds.length > 0) { blooms.wanted.push(seeds.map((s) => s.id)); blooms.room.push(o.room === true) } },
    growAnyway: () => undefined,
  }
})

import { renderToStaticMarkup } from 'react-dom/server'
import { NearbyList, SeedRow } from '../NearbyLootModal'
import { mount, textOf } from '../../test/elementRoot'
import { useBlooms } from '../../store/useBlooms'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'
import { seedItemOf } from '../../lib/seeds/seedItem'
import { bloomGrowthWords } from '../../lib/seeds/bloomWords'
import { safeNpub } from '../../lib/npub'
import type { BloomView } from '../../lib/seeds/bloomEngine'
import type { NearbyItem } from '../../hooks/useNearbyLoot'
import { crystalDna, mineSeedEvent, planter } from '../../lib/__tests__/seedsFixture'

const ME = useCyberspace.getState().identity.pubkey
const HIDER = 'a'.repeat(64)
const at = { x: 90_000n, y: 4_000n, z: 71n }
const dna = crystalDna()
// Two seeds of the planter's: one at 2^4, one at 2^0.
const bigEvent = mineSeedEvent({ dnaId: dna.id, planted: 975300, at, plane: 0, createdAt: 1794300000, scale: 4 })
const smallEvent = mineSeedEvent({ dnaId: dna.id, planted: 975400, at: { ...at, x: at.x + 9n }, plane: 0, createdAt: 1794300050 })
const big = seedItemOf(bigEvent)!
const small = seedItemOf(smallEvent)!

const base = { plane: 0, height: 6, mine: false, author: HIDER, distance: 9n }
const seedItem = (ev: typeof bigEvent, createdAt: number): NearbyItem => ({ ...base, key: ev.id, type: 'seed', at, createdAt, event: ev }) as unknown as NearbyItem
const bigItem = seedItem(bigEvent, 3)
const smallItem = seedItem(smallEvent, 2)
const shardItem = { ...base, key: '5'.repeat(64), type: 'shard', at, createdAt: 1, shard: { name: 'Lantern', unit: 2, vertices: [], faces: [] } } as unknown as NearbyItem

/** A grown view: `days` whole days of blocks since planted, the original DNAs' 40 days. */
const grownView = (seedId: string, planted: number, days: number, name = 'fiddlehead'): BloomView => ({
  seedId, status: 'grown', dna: { id: dna.id, name, author: HIDER, price: 21, generations: 40 }, clock: planted + days * 144 + 5, planted,
})

const row = (item: NearbyItem, me = ME): string => renderToStaticMarkup(<ul><SeedRow item={item} me={me} onView={() => undefined} /></ul>)

beforeEach(() => {
  list.items = []
  blooms.wanted = []
  blooms.room = []
  useBlooms.setState({ views: {} })
  useShards.setState({ mine: [], discovered: {}, nearbyOpen: true, selectedSecret: null })
})

describe('a seed row', () => {
  it('names its DNA, says where it is and its day, who planted it and how far, with VIEW', () => {
    useBlooms.setState({ views: { [big.id]: grownView(big.id, 975300, 12) } })
    const html = row(bigItem, planter)
    expect(html).toContain('fiddlehead')
    expect(html).toContain('Dataspace, height 6 · day 12 of 41')
    expect(html).toMatch(/<span>you<\/span>/)
    expect(html).toContain('away')
    expect(html).toContain('VIEW')
  })

  it('says unknown DNA and what it waits on before its DNA is resolved', () => {
    const html = row(bigItem)
    expect(html).toContain('unknown DNA')
    expect(html).toContain('Reading the seed')
    useBlooms.setState({ views: { [big.id]: { seedId: big.id, status: 'dna-missing' } } })
    expect(row(bigItem)).toContain('Its DNA was not found')
  })

  it('says fully grown from the DNA\'s last day on', () => {
    useBlooms.setState({ views: { [big.id]: grownView(big.id, 975300, 40) } })
    expect(row(bigItem)).toContain('day 40 of 41')
    useBlooms.setState({ views: { [big.id]: grownView(big.id, 975300, 41) } })
    expect(row(bigItem)).toContain('fully grown')
    useBlooms.setState({ views: { [big.id]: grownView(big.id, 975300, 300) } })
    expect(bloomGrowthWords(useBlooms.getState().views[big.id])).toBe('fully grown')
  })

  it('says it did not grow, not its day, when growing failed (its planted height and clock kept)', () => {
    useBlooms.setState({ views: { [big.id]: { ...grownView(big.id, 975300, 12), status: 'error', error: 'Worker gone.' } } })
    const html = row(bigItem)
    expect(html).toContain('It did not grow. Worker gone')
    expect(html).not.toContain('day 12')
  })

  it('names the planter, the seed\'s signer, not the bag\'s hider', () => {
    const html = row(bigItem, ME)
    expect(html).not.toMatch(/<span>you<\/span>/)
    // With no profile, a name is its npub's start (profileLabel): the planter's, never the hider's.
    expect(html).toContain(safeNpub(planter).slice(0, 12))
    expect(html).not.toContain(safeNpub(HIDER).slice(0, 12))
  })

  it('is one tap for the card: its words are the button', () => {
    const html = row(bigItem)
    expect(html).toMatch(/<button class="nearby__body nearby__name"[^>]*>.*nearby__label.*nearby__where.*nearby__meta.*<\/button><span class="nearby__acts">/)
  })
})

describe('SEEDS in the list', () => {
  it('counts every seed the list holds under SEEDS, not SHARDS, and in the total', () => {
    list.items = [bigItem, smallItem, shardItem]
    const html = renderToStaticMarkup(<NearbyList />)
    expect(html).toMatch(/<span>SEEDS<\/span><span class="nearby__count">2</)
    expect(html).toMatch(/<span>SHARDS<\/span><span class="nearby__count">1</)
    expect(html).toContain('3 DECRYPTED HERE')
  })

  it('opens on SEEDS when only seeds are here, the rows newest first', () => {
    list.items = [smallItem, bigItem]
    useBlooms.setState({ views: { [big.id]: grownView(big.id, 975300, 12), [small.id]: grownView(small.id, 975400, 3, 'crystal') } })
    const html = renderToStaticMarkup(<NearbyList />)
    expect(html).toMatch(/aria-selected="true"[^>]*><span>SEEDS<\/span>/)
    expect(html.indexOf('fiddlehead')).toBeLessThan(html.indexOf('crystal'))
  })

  it('VIEW flies to the seed framed at its scale, as the card\'s GO TO does; the name opens its card', async () => {
    const viewAt = vi.fn()
    const realViewAt = useCyberspace.getState().viewAt
    useCyberspace.setState({ viewAt })
    try {
      list.items = [bigItem, shardItem]
      useBlooms.setState({ views: { [big.id]: grownView(big.id, 975300, 12) } })
      const r = await mount(<NearbyList />)
      // Opens on SHARDS, the first tab with anything; nothing is asked to grow yet.
      expect(blooms.wanted).toEqual([])
      await r.press(/^SEEDS/)
      expect(blooms.wanted).toEqual([[big.id]])
      // Only into room: the list never pushes out a bloom the world is drawing.
      expect(blooms.room).toEqual([true])
      expect(r.says('day 12 of 41')).toBe(true)
      await r.press(/^VIEW/)
      expect(viewAt).toHaveBeenCalledWith(bigItem.at, 0, 'FIDDLEHEAD', 4, { item: true })
      expect(useShards.getState().nearbyOpen).toBe(false)
      await r.unmount()

      useShards.setState({ nearbyOpen: true })
      const again = await mount(<NearbyList />)
      // RETURN from that VIEW comes back to SEEDS.
      expect(textOf(again.all().find((h) => h.props['aria-selected'] === true)!)).toBe('SEEDS1')
      await again.press('fiddlehead')
      expect(useShards.getState().selectedSecret).toBe(big.id)
      expect(useShards.getState().nearbyOpen).toBe(false)
      await again.unmount()
    } finally {
      useCyberspace.setState({ viewAt: realViewAt })
    }
  })
})

describe('the tabs at phone width', () => {
  const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  it('seven in a row, wrapping four and three at 480 px and under, the words kept their size', () => {
    expect(css).toMatch(/\.nearby__tabs \{[^}]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/)
    const phone = css.match(/@media \(max-width: 480px\) \{ \.nearby__tabs \{([^}]*)\} \}/)
    expect(phone?.[1]).toContain('grid-template-columns: repeat(4, minmax(0, 1fr))')
    expect(phone?.[1]).not.toMatch(/font-size|letter-spacing/)
  })
})
