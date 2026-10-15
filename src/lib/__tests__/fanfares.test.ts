/**
 * fanfares.test.ts - where an object for sale is bought: the Fanfares page
 * for a listing (`https://fanfares.io/naddr/<naddr>`, fanfares-next's naddr
 * route), its price label, and the https-only rule for its pictures.
 */
import { describe, expect, it } from 'vitest'
import { nip19, verifyEvent } from 'nostr-tools'
import { listingFromEvent } from 'sno-core/feed'
import { FANFARES_WEB, fanfaresUrl, httpsImage, listingPictures, satsLabel } from '../fanfares'
import { LISTING, listingWith } from './listingFixture'

describe('the Fanfares page for a listing', () => {
  it('the fixture is a real signed event (a throwaway key, never published)', () => {
    expect(verifyEvent({ ...LISTING })).toBe(true)
  })

  it('is fanfares.io/naddr/<naddr>, the naddr naming kind 33331, the seller, the d and the relays it was seen on', () => {
    const l = { ...listingFromEvent(LISTING)!, seen: ['wss://cyberspace.nostr1.com', 'wss://nos.lol'] }
    const url = fanfaresUrl(l)
    expect(FANFARES_WEB).toBe('https://fanfares.io')
    expect(url.startsWith('https://fanfares.io/naddr/naddr1')).toBe(true)
    const decoded = nip19.decode(url.slice('https://fanfares.io/naddr/'.length))
    expect(decoded.type).toBe('naddr')
    if (decoded.type !== 'naddr') return
    expect(decoded.data).toEqual({ kind: 33331, pubkey: LISTING.pubkey, identifier: '6f1c2a8e-4b7d-4e0a-9c3f-2d5e8b1a7c40', relays: ['wss://cyberspace.nostr1.com', 'wss://nos.lol'] })
  })

  it('prices in sats, with thousands separated', () => {
    expect(satsLabel(2100)).toBe('2,100 sats')
    expect(satsLabel(1)).toBe('1 sat')
  })

  it('shows only https pictures: the GIF first, then the still', () => {
    expect(listingPictures(listingFromEvent(LISTING)!)).toEqual([
      'https://cdn.example.com/a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1.gif',
      'https://cdn.example.com/b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2.png',
    ])
    for (const bad of ['http://cdn.example.com/a.gif', 'javascript:alert(1)', 'data:image/gif;base64,R0lG', '//cdn.example.com/a.gif', '']) expect(httpsImage(bad), bad).toBeNull()
    // Even a listing object handed over with an http picture shows none of it.
    expect(listingPictures({ preview: { url: 'http://cdn.example.com/a.gif', mime: 'image/gif' } })).toEqual([])
    const plain = listingWith((tags) => tags.map((t) => (t[0] === 'imeta' ? t.map((p) => p.replace('url https:', 'url http:')) : t)))
    expect(listingPictures(listingFromEvent(plain)!)).toEqual([])
  })
})
