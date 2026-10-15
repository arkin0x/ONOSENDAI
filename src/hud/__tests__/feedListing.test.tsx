/**
 * feedListing.test.tsx - an object for sale on Fanfares in the Shard Feed:
 * a card with its GIF, title, price and BUY ON FANFARES, which opens the
 * Fanfares page in a new tab. Never pickable (no shape until bought), and
 * its pictures are https only and sent with no referrer, as profile pictures are.
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

// No relay is ever reached from here.
vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => { throw new Error('nothing publishes in a test') }),
  query: vi.fn(async () => []),
  askEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { renderToStaticMarkup } from 'react-dom/server'
import { listingFromEvent } from 'sno-core/feed'
import { ListingTile } from '../FeedList'
import { LISTING, listingWith } from '../../lib/__tests__/listingFixture'

const render = (ev = LISTING): string => renderToStaticMarkup(<ul><ListingTile listing={{ ...listingFromEvent(ev)!, seen: ['wss://relay.test'] }} /></ul>)

describe('a listing in the Shard Feed', () => {
  it('is a card: the GIF, the title, the price in sats, BUY ON FANFARES', () => {
    const html = render()
    expect(html).toContain('src="https://cdn.example.com/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.gif"')
    expect(html).toContain('alt="A brass orrery turning on its base"')
    expect(html).toMatch(/referrerpolicy="no-referrer"/i)
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('Brass Orrery')
    expect(html).toContain('2,100 sats')
    expect(html).toContain('BUY ON FANFARES')
  })

  it('BUY ON FANFARES opens the Fanfares naddr page in a new tab, with no opener and no referrer', () => {
    const html = render()
    const a = /<a [^>]*class="feed__act feed__act--buy"[^>]*>/.exec(html)?.[0] ?? ''
    expect(a).toMatch(/href="https:\/\/fanfares\.io\/naddr\/naddr1[0-9a-z]+"/)
    expect(a).toContain('target="_blank"')
    expect(a).toContain('rel="noopener noreferrer"')
  })

  it('cannot be picked or placed: no button on the card but the link', () => {
    const html = render()
    expect(html).not.toContain('<button')
    expect(html).not.toContain('DEPLOY')
    expect(html).not.toContain('REMIX')
  })

  it('shows a lock, not a picture, when no picture is https', () => {
    const html = render(listingWith((tags) => tags.map((t) => (t[0] === 'imeta' ? t.map((p) => p.replace('url https:', 'url http:')) : t))))
    expect(html).not.toContain('<img')
    expect(html).toContain('feed__lock')
  })

  it('the feed list draws listings with their own card, newest first among the objects (source)', () => {
    const src = readFileSync(join(__dirname, '..', 'FeedList.tsx'), 'utf8')
    expect(src).toMatch(/feedItems\(\{ objects, listings \}\)/)
    expect(src).toMatch(/isListing\(o\)\s*\n?\s*\? <ListingTile/)
    // The list's merge is memoized, not redone per frame or per render.
    expect(src).toMatch(/useMemo\(\(\) => feedItems/)
  })
})
