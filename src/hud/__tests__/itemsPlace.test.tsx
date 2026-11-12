/**
 * itemsPlace.test.tsx: PLACE on an ITEMS row, only for what you made
 * (arkinox, 2026-11-06). Rendered to a string, each store brought up to date,
 * once per row with that row's ACTIONS open (arkinox, 2026-11-12).
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
import { InventoryPanel, useOpenActions } from '../InventoryPanel'

const at = { x: 1n, y: 2n, z: 3n }
const place: HeldPlace = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 4 }
const COIN = 'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC50ZXN0IiwicHJvb2ZzIjpbXX1dfQ'

/** The panel with one row's ACTIONS open, as a string. */
function render(items: HeldItem[], me: string, open: string): string {
  useInventory.setState({ owner: me, items: Object.fromEntries(items.map((it) => [it.id, it])), storage: 'memory' })
  useOpenActions.setState({ open })
  for (const store of [useShards, useInventory, useCyberspace, useOpenActions] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(<InventoryPanel />)
}

/** The PLACE buttons in the row of `item`, its ACTIONS open, and in the whole panel then. */
function placesIn(items: HeldItem[], me: string, item: HeldItem, name: string): { row: number; all: number } {
  const html = render(items, me, item.id)
  const rows = html.split('<li').filter((r) => r.includes(name))
  return { row: rows.reduce((n, r) => n + (r.match(/>PLACE</g)?.length ?? 0), 0), all: html.split('>PLACE<').length - 1 }
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
    const forged = heldFromForged(me, mineEv, mine, place, 1)
    const own = note('my own words', sk)
    const their = note('their words', them)
    const coin = note(COIN, sk)
    const items = [forged, found, own, their, coin]
    // Closed, no row shows PLACE: it is behind ACTIONS.
    expect(render(items, me, '').split('>PLACE<').length - 1).toBe(0)
    // Open, PLACE on what you made and only in the row that is open.
    expect(placesIn(items, me, forged, 'My Key')).toEqual({ row: 1, all: 1 })
    expect(placesIn(items, me, found, 'Their Key')).toEqual({ row: 0, all: 0 })
    expect(placesIn(items, me, own, 'my own words')).toEqual({ row: 1, all: 1 })
    expect(placesIn(items, me, their, 'their words')).toEqual({ row: 0, all: 0 })
    expect(placesIn(items, me, coin, 'Wind Chest').all).toBe(0)
    useOpenActions.setState({ open: null })
    Object.assign(useOpenActions.getInitialState(), { open: null })
    useCyberspace.setState({ identity: was })
  })
})
