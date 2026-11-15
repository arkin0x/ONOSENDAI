/**
 * commentSubjects.test.ts - COMMENT on a key item names one thread wherever
 * it is pressed (owner, 2026-11-15: "we should be able to comment on key items
 * we find and take"): the card where it was found, its DISCOVERED NEARBY row,
 * its row in an opened chest, and KEY ITEMS > MINE once taken. The thread is
 * the bag's (by address) and the item's lineage, sealed under the bag's key,
 * as every item comment is. Nothing secret goes into a comment, and nothing a
 * tutorial guide key sealed has a thread.
 */

import { afterEach, describe, expect, it } from 'vitest'

;(() => {
  if (typeof localStorage !== 'undefined') return
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
    removeItem: (k: string) => { m.delete(k) },
    clear: () => m.clear(),
  }
})()

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, type NostrEvent } from '../events'
import { forgeKey, revealedIn, type ChestEntry } from '../chests'
import { KEY_KIND, keyInnerTemplate, type Hidden } from '../hidden'
import { COMMENT_KIND, PLACEHOLDER, commentsFilter, itemParent, openComments, sealedComment, commentTemplate } from '../comments'
import { heldFromEntry, heldFromFind, heldFromForged, heldFromPasted, placeOf } from '../inventory'
import { heldBagAuthor, isGuideKey, subjectOfHeld, subjectOfHidden, subjectOfWorldItem } from '../commentSubjects'
import { setGuideBags } from '../../tutorial/guideBags'
import { GUIDE_KEY, guideKey } from '../../tutorial/guide'
import { lookupIdOf } from '../regionKeyCheck'

const hiderSk = generateSecretKey()
const HIDER = getPublicKey(hiderSk)
const ME = getPublicKey(generateSecretKey())
const AT = { x: 1000n, y: 2000n, z: 3000n }
const BAG_KEY = new Uint8Array(32).map((_, i) => i * 3 + 5)
const LOOKUP = lookupIdOf(BAG_KEY)
const T = 1_800_000_000

const lock = forgeKey('Silver Key')
const keyEv = finalizeEvent(keyInnerTemplate(lock, AT, 0, T), hiderSk) as NostrEvent

/** The key found inline in the hider's bag, as the scan keeps it. */
const found: Hidden = { eventId: keyEv.id, inner: keyEv, keyHex: bytesToHex(BAG_KEY), bagId: 'bag-1', lookupId: LOOKUP, author: HIDER, at: AT, plane: 0, height: 4, createdAt: T, type: 'key', key: lock }

/** Every tag a comment from this subject publishes, and the filter that reads its thread. */
function wire(subject: NonNullable<ReturnType<typeof subjectOfHeld>>): { tags: string[][]; filter: unknown } {
  const t = commentTemplate(subject, itemParent(subject), 'x', T)
  return { tags: t.tags.filter((tag) => tag[0] !== 'encrypted'), filter: commentsFilter(subject) }
}

afterEach(() => {
  setGuideBags(null)
  localStorage.removeItem(GUIDE_KEY)
})

describe('one thread for a key item, before and after TAKE', () => {
  it('found inline: the card, a DISCOVERED NEARBY row and KEY ITEMS > MINE name the same bag and the same item', () => {
    const card = subjectOfHidden(found)!
    const held = heldFromFind(ME, found, T)!
    const mine = subjectOfHeld(held, heldBagAuthor(held, { discovered: {}, mine: [], me: ME }))!
    expect(card).not.toBeNull()
    expect(mine).not.toBeNull()
    expect(wire(mine)).toEqual(wire(card))
    // The bag by address, the item by its id and kind, the hider told.
    expect(wire(mine).tags).toEqual(expect.arrayContaining([
      ['A', `33330:${HIDER}:${LOOKUP}`], ['K', '33330'], ['P', HIDER],
      ['e', keyEv.id, '', HIDER], ['k', String(KEY_KIND)], ['p', HIDER],
    ]))
    // The world item shape (SecretModal) agrees with the find's.
    expect(subjectOfWorldItem({ key: found.eventId, type: 'key', author: HIDER, lookupId: LOOKUP, lineage: keyEv.id, at: AT, height: 4, bagKeyHex: found.keyHex })).toEqual(card)
  })

  it('out of a chest: TAKE on the chest row and TAKE on the key itself both keep the thread the revealed key names', () => {
    const chest = { eventId: 'chest-1', bagId: 'bag-1', lookupId: LOOKUP, author: HIDER, at: AT, plane: 0 as const, height: 4 }
    const entry: ChestEntry = { id: keyEv.id, event: keyEv, verified: true, body: { type: 'key', key: lock } }
    const [revealed] = revealedIn(chest, [entry])
    const card = subjectOfHidden(revealed)!
    // TAKE on the chest's own list: the place ChestBlock passes down, with its author (ItemRows contentPlace).
    const fromList = heldFromEntry(ME, entry, { chestId: 'chest-1', chestName: 'Box' }, { ...placeOf(chest), author: HIDER }, T)
    // TAKE on the key revealed in the world (useShards takeFound): the find's own author.
    const fromFind = heldFromFind(ME, revealed, T, false, { from: { chestId: 'chest-1', chestName: 'Box' }, place: { ...placeOf(chest), author: revealed.author } })!
    for (const held of [fromList, fromFind]) {
      const s = subjectOfHeld(held, heldBagAuthor(held, { discovered: {}, mine: [], me: ME }))!
      expect(wire(s)).toEqual(wire(card))
    }
  })

  it('a comment sealed from KEY ITEMS > MINE opens with the bag key, as one from the card does, and says nothing else in public', async () => {
    const held = heldFromFind(ME, found, T)!
    const subject = subjectOfHeld(held, HIDER)!
    const t = await sealedComment(subject, itemParent(subject), 'nice key', T, BAG_KEY)
    expect(t.kind).toBe(COMMENT_KIND)
    expect(t.content).toBe(PLACEHOLDER)
    expect(t.tags.find((x) => x[0] === 'encrypted')?.slice(0, 2)).toEqual(['encrypted', 'aes-256-gcm'])
    // Never the key item's secret, nor the bag key, nor the words, in anything public.
    const out = JSON.stringify(t)
    expect(out).not.toContain(lock.secretHex)
    expect(out).not.toContain(bytesToHex(BAG_KEY))
    expect(out).not.toContain('nice key')
    // No key item fields leak into the thread's subject either.
    expect(JSON.stringify(subject, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(lock.secretHex)
    const ev = { ...t, id: 'c1', pubkey: ME, sig: '' } as NostrEvent
    expect((await openComments([ev], BAG_KEY)).get('c1')).toBe('nice key')
    expect((await openComments([ev], new Uint8Array(32).fill(9))).size).toBe(0)
  })
})

describe('who signed the bag, for a row held before it was kept', () => {
  const legacy = (h: ReturnType<typeof heldFromFind>) => ({ ...h!, place: { ...h!.place!, author: undefined } })

  it('found inline or forged: the item\'s own signer, who is the bag\'s', () => {
    expect(heldBagAuthor(legacy(heldFromFind(ME, found, T)), { discovered: {}, mine: [], me: ME })).toBe(HIDER)
    const forged = heldFromForged(ME, keyEv, lock, { lookupId: LOOKUP, bagId: 'bag-1', at: { x: '1', y: '2', z: '3' }, plane: 0, height: 4 }, T)
    expect(heldBagAuthor(forged, { discovered: {}, mine: [], me: ME })).toBe(HIDER)
  })

  it('out of a chest: the chest as found here, or none when it is not, never a guess from the item', () => {
    const entry: ChestEntry = { id: keyEv.id, event: keyEv, verified: true, body: { type: 'key', key: lock } }
    const held = heldFromEntry(ME, entry, { chestId: 'chest-1', chestName: 'Box' }, placeOf({ lookupId: LOOKUP, bagId: 'bag-1', at: AT, plane: 0, height: 4 }), T)
    const other = getPublicKey(generateSecretKey())
    expect(heldBagAuthor(held, { discovered: {}, mine: [], me: ME })).toBeNull()
    expect(subjectOfHeld(held, null)).toBeNull()
    expect(heldBagAuthor(held, { discovered: { 'chest-1': { author: other, bagId: 'bag-1' } }, mine: [], me: ME })).toBe(other)
    expect(heldBagAuthor(held, { discovered: {}, mine: [{ eventId: 'chest-1', bagId: 'bag-1' }], me: ME })).toBe(ME)
  })
})

describe('no thread', () => {
  it('for a key pasted from another device: it was found nowhere', () => {
    const pasted = heldFromPasted(ME, keyEv, lock, true, T)
    expect(subjectOfHeld(pasted, heldBagAuthor(pasted, { discovered: {}, mine: [], me: ME }))).toBeNull()
  })

  it('for anything a tutorial guide key sealed: staged this visit, or the guide key this device keeps after a reload', () => {
    const guide = guideKey()
    expect(isGuideKey(guide.pubkey)).toBe(true)
    const held = heldFromFind(ME, { ...found, author: guide.pubkey }, T)!
    expect(subjectOfHeld(held, guide.pubkey)).toBeNull()
    expect(subjectOfHidden({ ...found, author: guide.pubkey })).toBeNull()
    localStorage.removeItem(GUIDE_KEY)
    const staged = finalizeEvent({ kind: 33330, created_at: T, tags: [['d', 'x']], content: '' }, generateSecretKey()) as NostrEvent
    setGuideBags([staged])
    expect(subjectOfHidden({ ...found, author: staged.pubkey })).toBeNull()
    expect(isGuideKey(HIDER)).toBe(false)
  })

  it('for something that is not a key item', () => {
    const held = { ...heldFromFind(ME, found, T)!, type: 'message' as const }
    expect(subjectOfHeld(held, HIDER)).toBeNull()
  })
})
