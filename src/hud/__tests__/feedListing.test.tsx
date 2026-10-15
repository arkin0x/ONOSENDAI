/**
 * feedListing.test.tsx - an object for sale in the Shard Feed: a card with
 * its GIF, title, price and BUY ON <seller> with the link's own domain, which
 * opens the seller's page in a new tab (its NIP-89 handler's, a known key
 * service's app, or njump). Never pickable (no shape until bought), and
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

// A server render reads a store's initial state; here it reads the live one (as hudBuildOrder.test.ts does).
vi.mock('zustand', async (importOriginal) => {
  const real = await importOriginal<typeof import('zustand')>()
  const live = (init: Parameters<typeof real.create>[0]) => {
    const hook = real.create(init)
    return Object.assign((sel: (s: unknown) => unknown = (x) => x) => sel(hook.getState()), hook)
  }
  return { ...real, create: (init?: Parameters<typeof real.create>[0]) => (init === undefined ? live : live(init)) }
})

import { renderToStaticMarkup } from 'react-dom/server'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { useHandlers } from '../../store/useHandlers'
import { listingFromEvent } from 'sno-core/feed'
import { ListingTile } from '../FeedList'
import { LISTING, listingWith } from '../../lib/__tests__/listingFixture'

const render = (ev = LISTING): string => renderToStaticMarkup(<ul><ListingTile listing={{ ...listingFromEvent(ev)!, seen: ['wss://relay.test'] }} /></ul>)

describe('a listing in the Shard Feed', () => {
  it('is a card: the GIF, the title, the price in sats, a BUY button', () => {
    const html = render()
    expect(html).toContain('src="https://cdn.example.com/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.gif"')
    expect(html).toContain('alt="A brass orrery turning on its base"')
    expect(html).toMatch(/referrerpolicy="no-referrer"/i)
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('Brass Orrery')
    expect(html).toContain('2,100 sats')
    expect(html).toMatch(/BUY ON /)
  })

  const buy = (html: string): { tag: string; label: string; domain: string } => ({
    tag: /<a [^>]*class="feed__act feed__act--buy"[^>]*>/.exec(html)?.[0] ?? '',
    label: /<span class="feed__buy-label">([^<]*)<\/span>/.exec(html)?.[1] ?? '',
    domain: /<span class="feed__buy-domain">([^<]*)<\/span>/.exec(html)?.[1] ?? '',
  })
  const keyService = (url: string) => listingWith((tags) => tags.map((t) => (t[0] === 'encrypted' ? [t[0], t[1], t[2], url] : t)))

  it('with no handler and a Fanfares key service: BUY ON Fanfares, fanfares.io, its naddr page, a new tab, no opener, no referrer', () => {
    const b = buy(render(keyService('https://api.fanfares.live/request-key')))
    expect(b.label).toBe('BUY ON Fanfares')
    expect(b.domain).toBe('fanfares.io')
    expect(b.tag).toMatch(/href="https:\/\/fanfares\.io\/naddr\/naddr1[0-9a-z]+"/)
    expect(b.tag).toContain('target="_blank"')
    expect(b.tag).toContain('rel="noopener noreferrer"')
  })

  it("with no handler and another key service: njump, named for the key service's domain, njump.me beside it", () => {
    const b = buy(render(keyService('https://keys.sno.example.org/request-key')))
    expect(b.label).toBe('BUY ON example.org')
    expect(b.domain).toBe('njump.me')
    expect(b.tag).toMatch(/href="https:\/\/njump\.me\/naddr1[0-9a-z]+"/)
  })

  it("with the seller's handler: its page, its name, and the page's own domain, whatever the name claims", () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const listing = listingWith((tags) => [...tags.filter((t) => t[0] !== 'a'), ['client', 'Sno Shop', `31990:${pk}:snoshop`]])
    const handler = finalizeEvent({ kind: 31990, created_at: 1, content: JSON.stringify({ name: 'Fanfares' }), tags: [['d', 'snoshop'], ['k', '33331'], ['web', 'https://shop.snoshop.example/item/<bech32>', 'naddr']] }, sk)
    useHandlers.setState({ handlers: { [`31990:${pk}:snoshop`]: handler } })
    const b = buy(render(listing))
    // A handler may call itself anything; the domain says where the button really goes.
    expect(b.label).toBe('BUY ON Fanfares')
    expect(b.domain).toBe('snoshop.example')
    expect(b.tag).toMatch(/href="https:\/\/shop\.snoshop\.example\/item\/naddr1[0-9a-z]+"/)
    useHandlers.setState({ handlers: {} })
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
