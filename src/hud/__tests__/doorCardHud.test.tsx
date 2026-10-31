/**
 * doorCardHud.test.tsx: a door's card for a finder (chest and door design
 * 4.7): DOOR on its badge, its name, the door in 3D across the card,
 * REQUIRES until it is opened, then OPEN; no list of contents, since what is
 * behind a door stands in the room. Rendered to a string.
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { sealEntries } from '../../lib/chests'
import { roomEntries, newDoorSecret } from '../../lib/doors'
import { chestInnerTemplate, chestItemOf, type BagEntry, type Hidden } from '../../lib/hidden'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards } from '../../store/useShards'
import { rememberOpened, resetOpenedChests, useOpenedChests } from '../../store/useOpenedChests'
import { SecretModal } from '../SecretModal'

const at = { x: 1n, y: 2n, z: 3n }

function render(): string {
  for (const store of [useShards, useInventory, useCyberspace, useOpenedChests] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(<SecretModal />)
}

function doorFind(): Hidden {
  const sk = generateSecretKey()
  const sealed = sealEntries(roomEntries(newDoorSecret()) as BagEntry[], getPublicKey(generateSecretKey()))
  const t = chestInnerTemplate({ name: 'North Door', lockPubkey: getPublicKey(generateSecretKey()), senderPubkey: sealed.senderPubkey, requires: 'the Silver Key', payload: sealed.payload }, at, 0, 1)
  t.tags.splice(t.tags.length - 1, 0, ['door', '4'])
  const event = finalizeEvent(t, sk) as NostrEvent
  return { eventId: event.id, inner: event, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: event.pubkey, at, plane: 0, height: 4, createdAt: 1, type: 'chest', chest: chestItemOf(event)! }
}

beforeEach(() => {
  localStorage.removeItem('onosendai:chests-opened')
  resetOpenedChests()
})

describe('a door’s card, for a finder', () => {
  it('DOOR, its name, the door in 3D, then REQUIRES', () => {
    const d = doorFind()
    useShards.setState({ discovered: { [d.eventId]: d }, mine: [], selectedSecret: d.eventId })
    const html = render()
    expect(html).toMatch(/secret__badge[^>]*>.*?DOOR<\/span>/)
    expect(html.indexOf('North Door')).toBeLessThan(html.indexOf('secret__spin--look'))
    expect(html).toContain('door (2 x 3), turning')
    expect(html).toContain('REQUIRES: the Silver Key')
  })

  it('OPEN once opened, and no list of contents', () => {
    const d = doorFind()
    useShards.setState({ discovered: { [d.eventId]: d }, mine: [], selectedSecret: d.eventId })
    rememberOpened(useCyberspace.getState().identity.pubkey, d.eventId, d.chest!.lockPubkey, [])
    const html = render()
    expect(html).toMatch(/item__meta[^>]*>OPEN/)
    expect(html).not.toContain('chest__contents')
    expect(html).not.toContain('TAKE ALL')
  })
})
