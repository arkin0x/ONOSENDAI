/**
 * lookHud.test.tsx: the look on the HUD (chest and door design, D2, D3,
 * 4.7). The chest card opens with the chest's name, then the chest in 3D
 * across the card, then what opens it; its name is not said twice. The hide
 * bar's model row offers the built-ins and OTHER, says which OTHER was
 * picked, and says so when a look is too large to wear. Rendered to a
 * string, with each store brought up to date first (wireData.test).
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
import { newShard } from 'sno-core/shards'
import type { NostrEvent } from '../../lib/events'
import { sealEntries } from '../../lib/chests'
import { builtInLookTags } from '../../lib/looks'
import { chestInnerTemplate, chestItemOf, messageInnerTemplate, type ChestItem, type Hidden } from '../../lib/hidden'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { SecretModal } from '../SecretModal'
import { LookRow } from '../DeployBar'

const hider = generateSecretKey()
const at = { x: 1n, y: 2n, z: 3n }

function render(el: JSX.Element): string {
  for (const store of [useShards, useInventory, useCyberspace, useWorkshop] as const) Object.assign(store.getInitialState(), store.getState())
  return renderToStaticMarkup(el)
}

function chestFind(look?: string[][]): Hidden {
  const note = finalizeEvent(messageInnerTemplate('behind it', at, 0, 1), hider) as NostrEvent
  const lock = getPublicKey(generateSecretKey())
  const sealed = sealEntries([note], lock)
  const item: ChestItem = { name: 'Wind Chest', lockPubkey: lock, senderPubkey: sealed.senderPubkey, requires: 'the Wind Key', payload: sealed.payload, ...(look ? { look } : {}) }
  const event = finalizeEvent(chestInnerTemplate(item, at, 0, 1), hider) as NostrEvent
  return { eventId: event.id, inner: event, keyHex: 'aa'.repeat(32), bagId: 'bag', lookupId: 'lookup', author: event.pubkey, at, plane: 0, height: 4, createdAt: 1, type: 'chest', chest: chestItemOf(event)! } as Hidden
}

beforeEach(() => {
  useShards.setState({ mine: [], discovered: {}, deleted: {}, deletedBags: {}, selectedSecret: null, curated: null })
})

describe('the chest card (4.7)', () => {
  it('names the chest once, above its look in 3D across the card, then what opens it', () => {
    const h = chestFind(builtInLookTags('treasure', { unit: 0, turn: [0, 0, 0], constrain: 'all' }))
    useShards.setState({ discovered: { [h.eventId]: h }, selectedSecret: h.eventId })
    const html = render(<SecretModal />)
    const name = html.indexOf('class="secret__look-name">Wind Chest')
    const spin = html.indexOf('secret__spin--look')
    const requires = html.indexOf('REQUIRES: the Wind Key')
    expect(name).toBeGreaterThan(-1)
    expect(spin).toBeGreaterThan(name)
    expect(requires).toBeGreaterThan(spin)
    expect(html).toContain('width:100%')
    expect(html.match(/>Wind Chest</g)).toHaveLength(1)
  })

  it('a chest from before looks shows the built-in treasure the same way', () => {
    const h = chestFind()
    useShards.setState({ discovered: { [h.eventId]: h }, selectedSecret: h.eventId })
    expect(render(<SecretModal />)).toContain('Treasure chest, turning')
  })
})

describe('the model row', () => {
  it('offers the built-ins and OTHER, with the chosen one pressed', () => {
    const html = render(<LookRow choices={['treasure']} look={{ from: 'builtin', name: 'treasure' }} refusal={null} />)
    expect(html).toMatch(/aria-pressed="true"[^>]*>TREASURE/)
    expect(html).toMatch(/aria-pressed="false"[^>]*>OTHER/)
  })

  it('names the OTHER picked from MINE, and says when a look is too large', () => {
    const statue = { ...newShard('Statue') }
    useWorkshop.setState({ shards: [statue] })
    const html = render(<LookRow choices={['treasure']} look={{ from: 'mine', shardId: statue.id }} refusal={null} />)
    expect(html).toMatch(/aria-pressed="true"[^>]*>OTHER/)
    expect(html).toContain('Statue')
    expect(render(<LookRow choices={['treasure']} look={{ from: 'mine', shardId: statue.id }} refusal="This model is too large to wear: 20,000 of 16,384 bytes." />)).toContain('too large to wear')
  })
})
