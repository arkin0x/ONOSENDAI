/**
 * sealAChestHud.test.tsx: the three distinct buttons (arkinox, 2026-10-26:
 * "buttons should be forge an item / seal a chest / seal a door"; 2026-10-31:
 * "i thought we talked about these being distinct"), the chest modal after
 * PLACE CHEST, and EDIT · MOVE · ADD · DELETE on a chest of yours, for you
 * alone (4.8). Rendered to a string, each store brought up to date first.
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
import { forgeKey, sealEntries } from '../../lib/chests'
import { chestInnerTemplate, chestItemOf, messageInnerTemplate, type ChestItem } from '../../lib/hidden'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards, type MyDeployment } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { useBuilder } from '../../store/useBuilder'
import { SecretModal } from '../SecretModal'
import { ShardsPanel } from '../ShardsPanel'
import { ChestCompose } from '../ChestCompose'

const at = { x: 1n, y: 2n, z: 3n }

function render(el: JSX.Element): string {
  for (const store of [useShards, useInventory, useCyberspace, useWorkshop, useBuilder] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(el)
}

function chestEvent(sk: Uint8Array): { event: NostrEvent; chest: ChestItem } {
  const lock = getPublicKey(generateSecretKey())
  const sealed = sealEntries([finalizeEvent(messageInnerTemplate('inside', at, 0, 1), sk) as NostrEvent], lock)
  const item: ChestItem = { name: 'Wind Chest', lockPubkey: lock, senderPubkey: sealed.senderPubkey, requires: 'the Wind Key', payload: sealed.payload }
  const event = finalizeEvent(chestInnerTemplate(item, at, 0, 1), sk) as NostrEvent
  return { event, chest: chestItemOf(event)! }
}

beforeEach(() => {
  useShards.setState({ mine: [], discovered: {}, deleted: {}, deletedBags: {}, selectedSecret: null, curated: null, pending: null })
})

/** The card's action buttons, in order. */
const actions = (html: string): string[] => {
  const row = html.slice(html.indexOf('secret__actions'))
  return [...row.slice(0, row.indexOf('</div>')).matchAll(/<button[^>]*>(?:<svg.*?<\/svg>)?([^<]*)<\/button>/g)].map((m) => m[1])
}

describe('FORGE AN ITEM / SEAL A CHEST / SEAL A DOOR', () => {
  it('are three distinct buttons, each live', () => {
    const html = render(<ShardsPanel />)
    const i = html.indexOf('FORGE AN ITEM'), c = html.indexOf('SEAL A CHEST'), d = html.indexOf('SEAL A DOOR')
    expect(i).toBeGreaterThan(-1)
    expect(c).toBeGreaterThan(i)
    expect(d).toBeGreaterThan(c)
    expect(html).not.toContain('title="Soon"')
  })
})

describe('the chest modal after PLACE CHEST', () => {
  it('shows the chest in 3D, its name, lock and label, ADD, and SEAL; never AIM', () => {
    const lock = forgeKey('Wind Key')
    useCyberspace.setState({ live: false })
    useShards.getState().startPlaceChest({ name: 'Wind Chest', lock: { pubkey: lock.itemPubkey, label: 'a pasted key' }, requires: '', contents: [{ kind: 'message', text: 'inside' }] })
    useShards.getState().placeChest()
    const html = render(<ChestCompose onDone={() => undefined} />)
    expect(html).toContain('secret__spin--look')
    expect(html.indexOf('secret__spin--look')).toBeLessThan(html.indexOf('aria-label="Chest name"'))
    for (const t of ['+ MESSAGE', '+ SHARD', '+ ITEM', '+ AUDIO', 'MOVE', 'CANCEL', 'SEAL (LOCAL)']) expect(html).toContain(t)
    expect(html).not.toContain('>AIM<')
    useShards.getState().cancelDeploy()
  })
})

describe('EDIT · MOVE · ADD · DELETE on a chest', () => {
  it('a chest you hid: EDIT, MOVE, ADD, then DELETE, in that order', () => {
    const me = useCyberspace.getState().identity
    const sk = generateSecretKey()
    useCyberspace.setState({ identity: { ...me, pubkey: getPublicKey(sk) } })
    const { event, chest } = chestEvent(sk)
    const row: MyDeployment = { eventId: event.id, inner: event, type: 'chest', chest, bagId: 'bag', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 4, lookupId: 'lookup', keyHex: 'aa'.repeat(32), relays: [], createdAt: 1, published: false }
    useShards.setState({ mine: [row], selectedSecret: event.id })
    const a = actions(render(<SecretModal />))
    expect(a.slice(1)).toEqual(['EDIT', 'MOVE', 'ADD', 'CONVERT TO DOOR', 'DELETE'])
    useCyberspace.setState({ identity: me })
  })

  it('someone else’s chest has none of them', () => {
    const { event, chest } = chestEvent(generateSecretKey())
    useShards.setState({ discovered: { [event.id]: { eventId: event.id, inner: event, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: event.pubkey, at, plane: 0, height: 4, createdAt: 1, type: 'chest', chest } }, selectedSecret: event.id })
    const a = actions(render(<SecretModal />))
    for (const t of ['EDIT', 'MOVE', 'ADD', 'DELETE']) expect(a).not.toContain(t)
  })
})
