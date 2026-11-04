/**
 * notificationsViewItem.test.ts: VIEW ITEM finds the item this identity hid
 * (arkinox, 2026-11-02: "That item is not one this device hid", four of four,
 * on his phone, where he hid them).
 *
 * The four were reactions from other clients (Amethyst, Ditto) to his kind
 * 33331 objects, the shards he publishes: `e` the object's id, `k` 33331, and
 * from Amethyst an `a` address. VIEW ITEM looked for a row whose eventId was
 * that id. A shard hidden by reference keeps the id it had when it was hidden,
 * and the object is republished under the same address since, so the id a
 * reactor sees is a newer one. An item carried inline and moved (EDIT) has a
 * new id, and reactions name its first version's (the lineage `d`). And a
 * shard that is only published, hidden nowhere, is no hidden item at all.
 */
import { describe, expect, it } from 'vitest'
import { classify, hiddenRowFor, publishedShardOnly, type Notification } from '../notifications'
import type { NostrEvent } from '../events'

const ME = 'e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a'
const THEM = '686a8c45'.padEnd(64, '0')
const ADDRESS = `33331:${ME}:maze-kit/cistern/decor/bones/cistern-decor-bones-skulls`
const OLD = '1'.repeat(64)
const NOW = '2a5745a9dc87c0d431629e4a10fd7649207bbdf1e4d2c100dbd27384f87dec1e'

function reaction(tags: string[][], content = '🤙'): NostrEvent {
  return { id: 'r'.repeat(64), pubkey: THEM, created_at: 1_762_000_000, kind: 7, content, tags: [...tags, ['p', ME]], sig: '' }
}
function onOf(ev: NostrEvent): Notification['on'] {
  return classify(ev, ME)!.n.on
}

interface Row { eventId: string; lookupId: string; inner?: { id: string; kind: number; tags: string[][] }; ref?: string[] }
/** The skulls, hidden by reference before the object was republished: the row keeps the old id. */
const byReference: Row = { eventId: OLD, lookupId: 'l1', inner: { id: OLD, kind: 33331, tags: [['d', 'maze-kit/cistern/decor/bones/cistern-decor-bones-skulls']] }, ref: ['a', ADDRESS] }
/** A message hidden inline and moved once: a new id, its first version's id as `d`. */
const FIRST = '3'.repeat(64)
const moved: Row = { eventId: '4'.repeat(64), lookupId: 'l2', inner: { id: '4'.repeat(64), kind: 1, tags: [['d', FIRST], ['C', 'x']] } }

describe('VIEW ITEM on a reaction to something this identity hid', () => {
  it('Amethyst: `a` names the address of a shard hidden by reference', () => {
    const on = onOf(reaction([['e', NOW], ['a', ADDRESS], ['k', '33331']], ':PepePls:'))
    expect(hiddenRowFor([moved, byReference], on as never)).toBe(byReference)
  })

  it('Ditto: only `e` and `k`, the object as refreshed on this device', () => {
    const refreshed: Row = { ...byReference, inner: { ...byReference.inner!, id: NOW } }
    const on = onOf(reaction([['e', NOW], ['k', '33331']]))
    expect(hiddenRowFor([refreshed], on as never)).toBe(refreshed)
  })

  it('a moved item, reacted to by its lineage', () => {
    const on = onOf(reaction([['e', FIRST, '', ME], ['p', ME], ['k', '1']]))
    expect(hiddenRowFor([byReference, moved], on as never)).toBe(moved)
  })

  it('still by its own id, and by its bag', () => {
    expect(hiddenRowFor([moved], { id: moved.eventId })).toBe(moved)
    expect(hiddenRowFor([moved], { id: null, lookupId: 'l2' })).toBe(moved)
  })
})

describe('a reaction to a shard that is only published', () => {
  it('is not called a hidden item, and is no refusal waiting to happen', () => {
    const on = onOf(reaction([['e', 'd434cce2'.padEnd(64, '0')], ['k', '33331']], '❤️'))
    expect(hiddenRowFor([byReference, moved], on as never)).toBeUndefined()
    expect(publishedShardOnly(on, [byReference, moved])).toBe(true)
  })

  it('a hidden one is not "only published"', () => {
    const on = onOf(reaction([['e', NOW], ['a', ADDRESS], ['k', '33331']]))
    expect(publishedShardOnly(on, [byReference])).toBe(false)
  })
})
