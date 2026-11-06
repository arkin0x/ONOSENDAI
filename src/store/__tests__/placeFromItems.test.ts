/**
 * placeFromItems.test.ts: PLACE on an ITEMS row (arkinox, 2026-11-06: "I
 * should be able to place the same item again easily once its in my
 * inventory (keeping its settings and everything, just a new instance)").
 *
 * Only for what the signed-in identity made; found or taken from someone else
 * has no PLACE. A key placed again is the same key (its keypair and secret),
 * so either instance opens the same chests and ITEMS keeps one row for it.
 * A message keeps every tag; a coin is never copied; a sound goes as PLACE
 * AGAIN's copy, sealed again. Relays are mocked; no network.
 */

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

import { finalizeEvent, generateSecretKey, verifyEvent } from 'nostr-tools/pure'
import type { NostrEvent } from '../../lib/events'
import { forgeKey } from '../../lib/chests'
import { addHeld, heldFromEntry, heldFromFind, heldFromForged, holdsItem, type HeldItem } from '../../lib/inventory'
import { itemLineage, keyInnerTemplate, keyItemOf, messageInnerTemplate, type Hidden } from '../../lib/hidden'
import type { Position } from '../../lib/space'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { PLACE_COIN, PLACE_KIND, PLACE_NOT_YOURS, copyTemplateAt, placeCopyOf, placingCopy, positionOf, useShards } from '../useShards'

const S = () => useShards.getState()
const I = () => useInventory.getState()
const C = () => useCyberspace.getState()
const HERE: Position = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4n, z: (1n << 72n) + 0x7e5n }
const THERE: Position = { ...HERE, x: HERE.x + (1n << 40n) }
const at = { x: 1n, y: 2n, z: 3n }
const place = { lookupId: 'l', bagId: 'b', at: { x: '1', y: '2', z: '3' }, plane: 0 as const, height: 4 }

function standAt(p: Position): void {
  useCyberspace.setState({ position: p, anchor: p, cursor: p, spectate: null, exploreIndex: null, transit: null })
}

beforeEach(() => {
  useShards.setState({ mine: [], discovered: {}, deleted: {}, pending: null, placedLast: null, deployHeight: 0, deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  useBuilder.setState({ itemDraft: null, messageDraft: null })
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: false })
  standAt(HERE)
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here; items stay in memory */ })
})

/** Hide a key with a model and a motion, and pick it up with TAKE. */
async function hideAndHold(): Promise<{ id: string; event: NostrEvent }> {
  const key = { ...forgeKey('Silver Key', 'an unremarkable key'), model: { address: `33331:${'ab'.repeat(32)}:key` }, animation: ['bob' as const] }
  S().startDeployKey(key)
  S().setDeployHeight(4)
  await S().deploy()
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  const d = S().mine.find((m) => m.type === 'key')!
  // Hiding may hold it or not (#614); TAKE makes sure it is held.
  if (!I().items[d.eventId]) S().takeFound([d.eventId])
  expect(I().items[d.eventId]).toBeDefined()
  return { id: d.eventId, event: d.inner as NostrEvent }
}

describe('PLACE on a key of your own', () => {
  it('lines up a new instance in BUILD, and places it at the cursor: the same key, every tag kept, newer, no lineage', async () => {
    const first = await hideAndHold()
    standAt(THERE)
    expect(S().placeFromItems(first.id)).toBeNull()
    const pending = S().pending!
    expect(pending.type).toBe('key')
    expect(placingCopy(pending)).toBe(true)
    // BUILD mode comes up on a deploy lined up (useBuilder).
    expect(useBuilder.getState().active).toBe(true)
    await S().deploy()
    expect(S().deployError).toBeNull()
    const keys = S().mine.filter((m) => m.type === 'key')
    expect(keys).toHaveLength(2)
    const copy = keys.find((m) => m.eventId !== first.id)!
    expect(verifyEvent(copy.inner as NostrEvent)).toBe(true)
    // The same key: its keypair and secret, its name, model and motion.
    expect(keyItemOf(copy.inner)).toEqual(keyItemOf(first.event))
    expect(copy.inner.content).toBe(first.event.content)
    const notC = (tags: string[][]) => tags.filter((t) => t[0] !== 'C')
    expect(notC(copy.inner.tags)).toEqual(notC(first.event.tags))
    expect(copy.inner.tags.some((t) => t[0] === 'model')).toBe(true)
    expect(copy.inner.tags).toContainEqual(['animate', 'bob'])
    // A new instance, not a version: no lineage, newer, somewhere else.
    expect(itemLineage(copy.inner)).toBe(copy.eventId)
    expect(copy.inner.tags.some((t) => t[0] === 'd')).toBe(false)
    expect(copy.inner.created_at).toBeGreaterThanOrEqual(first.event.created_at)
    expect(positionOf(copy)).not.toEqual(positionOf(S().mine.find((m) => m.eventId === first.id)!))
    // The original stands where it was.
    expect(S().mine.some((m) => m.eventId === first.id)).toBe(true)
  })

  it('ITEMS keeps one row for the keypair; either instance is held, and TAKE on the copy adds nothing', async () => {
    const first = await hideAndHold()
    standAt(THERE)
    S().placeFromItems(first.id)
    await S().deploy()
    const copy = S().mine.find((m) => m.type === 'key' && m.eventId !== first.id)!
    expect(Object.keys(I().items)).toEqual([first.id])
    expect(holdsItem(I().items, copy.eventId, itemLineage(copy.inner), copy.inner.pubkey, undefined, copy.key!.itemPubkey)).toBe(true)
    S().takeFound([copy.eventId])
    expect(Object.keys(I().items)).toEqual([first.id])
  })

  it('CANCEL keeps no draft of it: the item is still in ITEMS, one tap from PLACE again', async () => {
    const first = await hideAndHold()
    useBuilder.setState({ itemDraft: null })
    expect(S().placeFromItems(first.id)).toBeNull()
    expect(useBuilder.getState().active).toBe(true)
    // BUILD mode ended under it (the view went somewhere else), as audioRepeat's copy is.
    C().focusOn(C().position, 0, 'EARTH · tap')
    expect(useBuilder.getState().active).toBe(false)
    expect(S().pending).toBeNull()
    expect(useBuilder.getState().itemDraft).toBeNull()
    C().clearFocus()
  })

  it('refuses while something else is lined up', async () => {
    const first = await hideAndHold()
    S().startDeployMessage('busy')
    expect(S().placeFromItems(first.id)).toMatch(/lined up/)
    expect(S().pending).toEqual({ type: 'message', text: 'busy' })
  })
})

describe('what has PLACE (placeCopyOf)', () => {
  const me = () => C().identity.pubkey
  const someone = generateSecretKey()

  it('never what was found or taken from someone else, nor what only claims to be yours', () => {
    const key = forgeKey('Their Key')
    const theirs = finalizeEvent(keyInnerTemplate(key, at, 0, 5), someone) as NostrEvent
    const found: Hidden = { eventId: theirs.id, inner: theirs, keyHex: 'aa'.repeat(32), bagId: 'b', lookupId: 'l', author: theirs.pubkey, at, plane: 0, height: 4, createdAt: 5, type: 'key', key }
    expect(placeCopyOf(heldFromFind(me(), found, 1)!, me())).toBe(PLACE_NOT_YOURS)
    const mineButClaimed: HeldItem = { ...heldFromForged(me(), { ...theirs, pubkey: me() }, key, place, 1), verified: false }
    expect(placeCopyOf(mineButClaimed, me())).toBe(PLACE_NOT_YOURS)
    expect(placeCopyOf(heldFromForged(me(), { ...theirs, pubkey: me() }, key, place, 1), '')).toBe(PLACE_NOT_YOURS)
  })

  it('a message of yours keeps its words and tags; one holding a coin is refused', () => {
    const msg = { ...messageInnerTemplate('meet me here', at, 0, 5), pubkey: me(), id: 'm1', sig: '' } as NostrEvent
    const row = heldFromEntry(me(), { event: msg, body: { type: 'message', text: 'meet me here' }, verified: true } as never, { chestId: 'c', chestName: 'Wind Chest' }, place, 1)
    expect(placeCopyOf(row, me())).toEqual({ type: 'message', text: 'meet me here', copy: msg })
    const coin = { ...row, text: 'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vbWludC50ZXN0IiwicHJvb2ZzIjpbXX1dfQ' }
    expect(placeCopyOf(coin, me())).toBe(PLACE_COIN)
  })

  it('a sound of yours goes as PLACE AGAIN copies one: sealed again under a fresh key', () => {
    const audio = { title: 'Rain', about: '', url: 'https://blossom.test/abc', hash: 'ab', originalHash: 'cd', keyHex: 'ee'.repeat(32), nonceHex: 'ff'.repeat(12), mime: 'audio/mpeg', size: 10 }
    const ev = { kind: 1, content: '', tags: [], created_at: 1, pubkey: me(), id: 'a1', sig: '' } as NostrEvent
    const row = heldFromEntry(me(), { event: ev, body: { type: 'audio', audio }, verified: true } as never, { chestId: 'c', chestName: 'x' }, place, 1)
    expect(placeCopyOf(row, me())).toEqual({ type: 'audio', audio, reseal: true })
  })

  it('a chest or a model has none: a chest’s contents and a door’s room are not copied, a model goes out from the workshop', () => {
    const ev = { kind: 1, content: '', tags: [], created_at: 1, pubkey: me(), id: 'x', sig: '' } as NostrEvent
    for (const type of ['chest', 'shard'] as const) {
      const row = { ...heldFromEntry(me(), { event: ev, body: { type: 'message', text: '' }, verified: true } as never, null as never, place, 1), type, text: undefined }
      expect(placeCopyOf(row, me())).toBe(PLACE_KIND)
    }
  })
})

describe('copyTemplateAt', () => {
  it('the same kind, content and tags at the new place, newer, and no lineage `d`', () => {
    const prev = { kind: 3340, content: 'x', tags: [['C', 'old'], ['d', 'ab'.repeat(32)], ['title', 'Key'], ['-']] }
    const t = copyTemplateAt(prev, HERE, 0, 99)
    expect(t.created_at).toBe(99)
    expect(t.tags[0][0]).toBe('C')
    expect(t.tags[0][1]).not.toBe('old')
    expect(t.tags.slice(1)).toEqual([['title', 'Key'], ['-']])
  })
})

describe('holding is by keypair (lib/inventory.ts)', () => {
  it('a second instance of a key held is held, and adds no second row', () => {
    const me = C().identity.pubkey
    const key = forgeKey('Silver Key')
    const sk = generateSecretKey()
    const a = finalizeEvent(keyInnerTemplate(key, at, 0, 5), sk) as NostrEvent
    const b = finalizeEvent(keyInnerTemplate(key, { ...at, x: 9n }, 0, 6), sk) as NostrEvent
    const first = heldFromForged(me, a, key, place, 1)
    const items = { [first.id]: first }
    expect(holdsItem(items, b.id, null, b.pubkey, undefined, key.itemPubkey)).toBe(true)
    expect(holdsItem(items, b.id, null, b.pubkey)).toBe(false)
    expect(addHeld(items, [heldFromForged(me, b, key, place, 2)]).added).toEqual([])
  })
})
