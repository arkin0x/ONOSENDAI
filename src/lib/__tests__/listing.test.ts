/**
 * listing.test.ts - an object for sale as a card shows it: its naddr (the
 * address its seller's page is opened with), its price label, and the
 * https-only rule for its pictures.
 */
import { describe, expect, it } from 'vitest'
import { nip19, verifyEvent } from 'nostr-tools'
import { listingFromEvent } from 'sno-core/feed'
import { httpsImage, listingNaddr, listingPictures, satsLabel } from '../listing'
import { LISTING, listingWith } from './listingFixture'

describe('a listing as a card shows it', () => {
  it('the fixture is a real signed event (a throwaway key, never published)', () => {
    expect(verifyEvent({ ...LISTING })).toBe(true)
  })

  it('its naddr names kind 33331, the seller, the d and the relays it was seen on', () => {
    const naddr = listingNaddr({ ...listingFromEvent(LISTING)!, seen: ['wss://cyberspace.nostr1.com', 'wss://nos.lol'] })!
    const decoded = nip19.decode(naddr)
    expect(decoded.type).toBe('naddr')
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
    expect(listingPictures({ preview: { url: 'http://cdn.example.com/a.gif', mime: 'image/gif' } })).toEqual([])
    const plain = listingWith((tags) => tags.map((t) => (t[0] === 'imeta' ? t.map((p) => p.replace('url https:', 'url http:')) : t)))
    expect(listingPictures(listingFromEvent(plain)!)).toEqual([])
  })
})
