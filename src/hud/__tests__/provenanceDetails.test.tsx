/**
 * provenanceDetails.test.tsx: an item's details say where it was obtained
 * (arkinox, 2026-10-30): taken out of a chest, the chest's name with VIEW
 * CHEST, where it stands, its coordinate and when; found in a bag, where
 * with VIEW; pasted, nothing. Rendered to a string.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { messageInnerTemplate } from '../../lib/hidden'
import { heldFromEntry, type HeldPlace } from '../../lib/inventory'
import { positionHex, type NostrEvent } from '../../lib/events'
import { Provenance } from '../InventoryPanel'

const at = { x: 10n, y: 20n, z: 30n }
const place: HeldPlace = { lookupId: 'l', bagId: 'b', at: { x: '10', y: '20', z: '30' }, plane: 1, height: 6 }
const note = finalizeEvent(messageInnerTemplate('inside', at, 1, 1), generateSecretKey()) as NostrEvent
const entry = { id: note.id, event: note, verified: true, body: { type: 'message' as const, text: 'inside' } }
const owner = 'a'.repeat(64)

describe('an item’s details', () => {
  it('out of a chest: the chest, VIEW CHEST, where, the coordinate, when', () => {
    const html = renderToStaticMarkup(<dl><Provenance item={heldFromEntry(owner, entry, { chestId: 'c'.repeat(64), chestName: 'Strongbox' }, place, 1_800_000_000)} /></dl>)
    expect(html).toContain('Found in')
    expect(html).toContain('chest “Strongbox”')
    expect(html).toContain('>VIEW CHEST<')
    expect(html).toContain('ideaspace')
    expect(html).toContain('Coordinate')
    expect(html).toContain(positionHex(at, 1).slice(0, 14))
    expect(html).toContain('Taken')
  })

  it('found in a bag: where, with VIEW', () => {
    const html = renderToStaticMarkup(<dl><Provenance item={{ ...heldFromEntry(owner, entry, { chestId: '', chestName: '' }, place, 1), from: null }} /></dl>)
    expect(html).toContain('Found at')
    expect(html).toContain('>VIEW<')
    expect(html).not.toContain('VIEW CHEST')
  })

  it('pasted from another device: nothing', () => {
    expect(renderToStaticMarkup(<dl><Provenance item={{ ...heldFromEntry(owner, entry, { chestId: '', chestName: '' }, null, 1), from: null }} /></dl>)).toBe('<dl></dl>')
  })
})
