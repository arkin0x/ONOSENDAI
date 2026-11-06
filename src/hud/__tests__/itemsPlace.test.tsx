/**
 * itemsPlace.test.tsx: PLACE on an ITEMS row, only for what you made
 * (arkinox, 2026-11-06). Rendered to a string, each store brought up to date.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { forgeKey } from '../../lib/chests'
import { keyInnerTemplate, messageInnerTemplate } from '../../lib/hidden'
import { heldFromEntry, heldFromFind, heldFromForged, type HeldItem, type HeldPlace } from '../../lib/inventory'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards } from '../../store/useShards'
import { InventoryPanel } from '../InventoryPanel'

const at = { x: 1n, y: 2n, z: 3n }
const place: HeldPlace = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 4 }
const COIN = 'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC50ZXN0IiwicHJvb2ZzIjpbXX1dfQ'

function render(items: HeldItem[], me: string): string {
  useInventory.setState({ owner: me, items: Object.fromEntries(items.map((it) => [it.id, it])), storage: 'memory' })
  for (const store of [useShards, useInventory, useCyberspace] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(<InventoryPanel />)
}

/** The PLACE buttons in the rows that name `name`. */
function placesIn(html: string, name: string): number {
  const rows = html.split('<li').filter((r) => r.includes(name))
  return rows.reduce((n, r) => n + (r.match(/>PLACE</g)?.length ?? 0), 0)
}

describe('PLACE in ITEMS', () => {
  it('on an item and a message you made; never on what someone else made, nor on a coin', () => {
    const sk = generateSecretKey()
    const me = getPublicKey(sk)
    const them = generateSecretKey()
    const was = useCyberspace.getState().identity
    useCyberspace.setState({ identity: { ...was, pubkey: me } })
    const mine = forgeKey('My Key')
    const mineEv = finalizeEvent(keyInnerTemplate(mine, at, 0, 5), sk) as NostrEvent
    const theirs = forgeKey('Their Key')
    const theirEv = finalizeEvent(keyInnerTemplate(theirs, at, 0, 6), them) as NostrEvent
    const found = heldFromFind(me, { eventId: theirEv.id, inner: theirEv, keyHex: 'aa'.repeat(32), bagId: 'b', lookupId: 'l', author: theirEv.pubkey, at, plane: 0, height: 4, createdAt: 6, type: 'key', key: theirs }, 2)!
    const note = (text: string, sk2: Uint8Array) => {
      const ev = finalizeEvent(messageInnerTemplate(text, at, 0, 7), sk2) as NostrEvent
      return heldFromEntry(me, { event: ev, body: { type: 'message', text }, verified: true } as never, { chestId: 'c', chestName: 'Wind Chest' }, place, 3)
    }
    const html = render([heldFromForged(me, mineEv, mine, place, 1), found, note('my own words', sk), note('their words', them), note(COIN, sk)], me)
    expect(placesIn(html, 'My Key')).toBe(1)
    expect(placesIn(html, 'Their Key')).toBe(0)
    expect(placesIn(html, 'my own words')).toBe(1)
    expect(placesIn(html, 'their words')).toBe(0)
    expect(html.split('>PLACE<').length - 1).toBe(2)
    useCyberspace.setState({ identity: was })
  })
})
