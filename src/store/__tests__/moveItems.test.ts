/**
 * moveItems.test.ts - MOVE on a placed key item, message or hidden audio
 * (arkinox, 2026-11-02: "need to be able to move placed items"). EDIT's way
 * for every kind: the new version lands at the cursor first and the old one
 * leaves its bag only after, so a failure midway loses nothing and leaves
 * one copy; the new version is the same item (every tag and its content as
 * they were) carrying its first version's id as `d`, so reactions, mutes,
 * once-triggers and notifications follow it; a key stays held once, its
 * blue box with it; and a device that read both versions draws one.
 * Relays are mocked; nothing leaves the machine.
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

const sent: { kind: number; tags: string[][]; id: string; content?: string; created_at?: number }[] = []
/** What the fake relay holds: everything it took, whatever a test clears from `sent`, its log. */
const held: typeof sent = []
/** Kinds every relay refuses in the current test. */
const refused = new Set<number>()
/** No relay answers a bag query while set. */
let silent = false
/** Events the relay holds but does not serve: a lagging relay, or the one with the newest copy not answering. */
const withheld = new Set<string>()
const served = (e: { id: string }) => !withheld.has(e.id)
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async (_relays: string[], ev: { kind: number; tags: string[][]; id: string }) => {
    if (refused.has(ev.kind)) return { ok: false }
    sent.push(ev)
    held.push(ev)
    return { ok: true }
  }),
  // What the relay holds, by kind, author, address and d: a deletion (NIP-09) among it.
  query: vi.fn(async (f: { kinds?: number[]; authors?: string[]; '#a'?: string[]; '#d'?: string[] }) => held.filter(served).filter((e) => (!f.kinds || f.kinds.includes(e.kind))
    && (!f.authors || f.authors.includes((e as { pubkey?: string }).pubkey ?? ''))
    && (!f['#a'] || e.tags.some((t) => t[0] === 'a' && f['#a']!.includes(t[1])))
    && (!f['#d'] || e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1]))))),
  // What the relay holds at an address: the bags it took.
  queryEach: vi.fn(async (f: { kinds: number[]; '#d': string[] }) => silent ? [{ url: 'wss://relay.test', outcome: 'unreachable', reason: 'down', events: [] }] : [{ url: 'wss://relay.test', outcome: 'answered', events: held.filter(served).filter((e) => f.kinds.includes(e.kind) && e.tags.some((t) => t[0] === 'd' && f['#d'].includes(t[1]))) }]),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { forgeKey } from '../../lib/chests'
import { AUDIO_KIND, type AudioItem } from '../../lib/audioItem'
import { bagEntries, HIDDEN_KIND, itemLineage, KEY_KIND, MESSAGE_KIND, movedTemplate, type Hidden } from '../../lib/hidden'
import { hexToBytes, positionHex, type NostrEvent } from '../../lib/events'
import { addHeld, heldFromFind, holdsItem, type HeldItem } from '../../lib/inventory'
import type { Position } from '../../lib/space'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { movePlaced, useBuilder } from '../useBuilder'
import { useToast } from '../useToast'
import { HIDE_AGAIN_BUSY, MOVE_GONE, MOVE_STALE, MOVE_UNANSWERED, inItsBag, movable, movingId, newestOfMoved, oneVersionEach, repeatable, useShards, type MyDeployment } from '../useShards'

const S = () => useShards.getState()
const me = () => useCyberspace.getState().identity.pubkey

/** A corner of a 2^3 region well inside the space: at(1) and at(5) share it, at(9) is the next one. */
const BASE: Position = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const at = (dx: bigint): Position => ({ x: BASE.x + dx, y: BASE.y, z: BASE.z })
/** The same, 4 gibsons in from the region's y and z walls: room for a sound's sphere. */
const mid = (dx: bigint): Position => ({ x: BASE.x + dx, y: BASE.y + 4n, z: BASE.z + 4n })
const aim = (p: Position): void => { useCyberspace.setState({ cursor: { ...p } }) }
const tag = (ev: { tags: string[][] }, name: string) => ev.tags.find((t) => t[0] === name)?.[1]
const row = (id: string) => S().mine.find((d) => d.eventId === id)!

const audio: AudioItem = {
  title: 'Trickling water', about: 'by the well', url: 'https://blossom.test/' + 'ab'.repeat(32), mime: 'audio/mpeg', hash: 'ab'.repeat(32),
  originalHash: 'cd'.repeat(32), size: 2048, keyHex: 'ef'.repeat(32), nonceHex: '01'.repeat(12), autoplay: true, loop: false, retrigger: 'once', walkOnly: false, fade: 1,
}

type Kind = 'key' | 'message' | 'audio'

/** Hide one thing of this kind at `p`, height 3; its event id. */
async function hide(kind: Kind, p: Position): Promise<string> {
  if (kind === 'key') S().startDeployKey(forgeKey('Brass key', 'opens the old gate'))
  else if (kind === 'message') S().startDeployMessage('meet at the fountain')
  else S().startDeployAudio(audio)
  aim(p)
  useShards.setState({ deployHeight: 3 })
  await S().deploy()
  expect(S().deployError).toBeNull()
  expect(S().deployStatus).toBe('done')
  // Not lined up again for these tests' purposes.
  useShards.setState({ pending: null, placedLast: null })
  return S().mine[S().mine.length - 1].eventId
}

/** MOVE it to `p`; the moved row. */
async function move(eventId: string, p: Position): Promise<MyDeployment> {
  S().startMoveItem(eventId)
  expect(movingId(S().pending)).toBe(eventId)
  aim(p)
  await S().deploy()
  expect(S().deployError).toBeNull()
  expect(S().deployStatus).toBe('done')
  return S().mine[S().mine.length - 1]
}

/** A MOVE that fails: the deploy says why. */
async function failedMove(eventId: string, p: Position): Promise<string | null> {
  S().startMoveItem(eventId)
  aim(p)
  await S().deploy()
  expect(S().deployStatus).toBe('error')
  return S().deployError
}

/** A find as another device's scan files it, from a row of this one. */
function asFound(d: MyDeployment): Hidden {
  return { eventId: d.eventId, type: d.type, inner: d.inner, author: me(), at: { x: BigInt(d.at.x), y: BigInt(d.at.y), z: BigInt(d.at.z) }, plane: d.plane, height: d.height, lookupId: d.lookupId, bagId: d.bagId, createdAt: d.createdAt, text: d.text, key: d.key, audio: d.audio, keyHex: d.keyHex } as Hidden
}

const realSign = useCyberspace.getState().signEvent

beforeEach(() => {
  sent.length = 0
  held.length = 0
  refused.clear()
  silent = false
  withheld.clear()
  useCyberspace.setState({ signEvent: realSign, live: true, scaleExp: 0, buildStep: null })
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, placedLast: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null, selectedSecret: null })
  useBuilder.setState({ active: false, via: null, leftAvatar: false, itemDraft: null, messageDraft: null })
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useToast.getState().dismiss()
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('MOVE inside its own region', () => {
  it.each<Kind>(['key', 'message', 'audio'])('a %s: one bag rewrite, the same item at the new place, naming its first version', async (kind) => {
    const first = await hide(kind, at(1n))
    const old = row(first)
    sent.length = 0
    const moved = await move(first, at(5n))
    expect(S().mine).toHaveLength(1)
    expect(moved.eventId).not.toBe(first)
    expect(moved.lookupId).toBe(old.lookupId)
    expect(tag(moved.inner, 'd')).toBe(first)
    expect(tag(moved.inner, 'C')).toBe(positionHex(at(5n), moved.plane))
    // Nothing about it changed but where it is.
    expect(moved.inner.kind).toBe(old.inner.kind)
    expect(moved.inner.content).toBe(old.inner.content)
    expect(moved.inner.tags.filter((t) => t[0] !== 'C' && t[0] !== 'd')).toEqual(old.inner.tags.filter((t) => t[0] !== 'C'))
    expect(moved.inner.created_at).toBeGreaterThan(old.inner.created_at - 1)
    // One bag, holding only the new version; nothing deleted on the relay.
    expect(sent.map((e) => e.kind)).toEqual([HIDDEN_KIND])
    const entries = await bagEntries(sent[0] as unknown as NostrEvent, hexToBytes(moved.keyHex))
    expect(entries.map((e) => (e as NostrEvent).id)).toEqual([moved.eventId])
    expect(S().deleted[first]).toBe(true)
  })

  it('a message and a sound stay rumors (never to the signer); a key stays signed', async () => {
    const msg = await hide('message', at(1n))
    const snd = await hide('audio', at(2n))
    const key = await hide('key', at(3n))
    const signed: number[] = []
    useCyberspace.setState({ signEvent: async (t) => { signed.push(t.kind); return realSign(t) } })
    const m = await move(msg, at(5n))
    const a = await move(snd, at(6n))
    const k = await move(key, at(7n))
    expect('sig' in m.inner).toBe(false)
    expect(m.inner.kind).toBe(MESSAGE_KIND)
    expect('sig' in a.inner).toBe(false)
    expect(a.inner.kind).toBe(AUDIO_KIND)
    expect(k.inner.kind).toBe(KEY_KIND)
    expect(typeof (k.inner as NostrEvent).sig).toBe('string')
    expect(signed.filter((x) => x !== HIDDEN_KIND)).toEqual([KEY_KIND])
  })

  it('keeps the first version as the lineage across a second move, into another region and back', async () => {
    const first = await hide('audio', at(1n))
    const once = await move(first, at(9n))
    const twice = await move(once.eventId, at(2n))
    expect(tag(twice.inner, 'd')).toBe(first)
    expect(itemLineage(twice.inner)).toBe(first)
    // What NOW PLAYING mutes and a once-trigger is kept by (AudioCard triggerId, useSoundMutes).
    expect(S().worldItems().find((w) => w.key === twice.eventId)?.lineage).toBe(first)
    expect(S().mine).toHaveLength(1)
  })

  it('hidden audio takes its sphere as set for the new place, and only one fade tag', async () => {
    const first = await hide('audio', at(1n))
    S().startMoveItem(first)
    S().setDeployFade(2)
    aim(mid(12n))
    await S().deploy()
    const moved = S().mine[0]
    expect(moved.inner.tags.filter((t) => t[0] === 'fade')).toEqual([['fade', '2']])
    expect(moved.inner.tags.find((t) => t[0] === 'decryption-key')?.[1]).toBe(audio.keyHex)
  })
})

describe('MOVE into another region', () => {
  it.each<Kind>(['key', 'message', 'audio'])('a %s: the new bag first, then the old one taken down', async (kind) => {
    const first = await hide(kind, at(1n))
    const old = row(first)
    sent.length = 0
    const moved = await move(first, at(9n))
    expect(S().mine).toHaveLength(1)
    expect(moved.lookupId).not.toBe(old.lookupId)
    expect(tag(moved.inner, 'd')).toBe(first)
    expect(sent.map((e) => e.kind)).toEqual([HIDDEN_KIND, 5])
    expect(sent[1].tags).toContainEqual(['a', `${HIDDEN_KIND}:${me()}:${old.lookupId}`])
  })

  it('rewrites the old bag without it when something else of yours stays there', async () => {
    const stays = await hide('message', at(2n))
    const goes = await hide('key', at(1n))
    const oldBag = row(goes).lookupId
    sent.length = 0
    await move(goes, at(9n))
    expect(sent.map((e) => e.kind)).toEqual([HIDDEN_KIND, HIDDEN_KIND])
    const rewrite = sent[1] as unknown as NostrEvent
    expect(tag(rewrite, 'd')).toBe(oldBag)
    const left = await bagEntries(rewrite, hexToBytes(row(stays).keyHex))
    expect(left.map((e) => (e as NostrEvent).id)).toEqual([stays])
  })
})

describe('a moved key is the same item', () => {
  it('stays held once, its row at the new place, and its blue box with it', async () => {
    const first = await hide('key', at(1n))
    expect(Object.keys(useInventory.getState().items)).toEqual([first])
    const moved = await move(first, at(9n))
    const items = useInventory.getState().items
    expect(Object.keys(items)).toEqual([first])
    expect(items[first].place?.lookupId).toBe(moved.lookupId)
    expect(items[first].place?.at).toEqual(moved.at)
    // The world reads it as held (WorldMessages itemDrawAs), and KeyLine offers no TAKE.
    const w = S().worldItems().find((x) => x.key === moved.eventId)!
    expect(holdsItem(items, w.key, w.lineage, w.event?.pubkey)).toBe(true)
  })

  it('a finder who took the old version holds the moved one already: TAKE adds nothing', async () => {
    const first = await hide('key', at(1n))
    const old = row(first)
    const moved = await move(first, at(9n))
    const taken = heldFromFind('finder', asFound(old), 1, false, null)!
    const held: Record<string, HeldItem> = { [taken.id]: taken }
    const again = heldFromFind('finder', asFound(moved), 2, false, null)!
    const after = addHeld(held, [again])
    expect(after.added).toEqual([])
    expect(Object.keys(after.items)).toEqual([first])
    expect(holdsItem(held, moved.eventId, itemLineage(moved.inner), moved.inner.pubkey)).toBe(true)
  })
})

describe('LOCAL and LIVE', () => {
  it('a LOCAL item moved while LOCAL sends nothing', async () => {
    useCyberspace.setState({ live: false })
    const first = await hide('message', at(1n))
    const moved = await move(first, at(9n))
    expect(sent).toEqual([])
    expect(S().mine.map((d) => d.eventId)).toEqual([moved.eventId])
    expect(moved.published).toBe(false)
  })

  it('a published item moved while LOCAL goes to the relays, as a DELETE would', async () => {
    const first = await hide('message', at(1n))
    useCyberspace.setState({ live: false })
    sent.length = 0
    const moved = await move(first, at(9n))
    expect(moved.published).toBe(true)
    expect(sent.map((e) => e.kind)).toEqual([HIDDEN_KIND, 5])
  })
})

describe('a move cancelled or failed midway', () => {
  it('CANCEL leaves everything as it was', async () => {
    const first = await hide('key', at(1n))
    sent.length = 0
    S().startMoveItem(first)
    aim(at(9n))
    S().cancelDeploy(true)
    expect(S().mine.map((d) => d.eventId)).toEqual([first])
    expect(sent).toEqual([])
    expect(S().pending).toBeNull()
  })

  it('a move does not repeat, and BUILD ending under it keeps no draft that would hide a second copy', async () => {
    const first = await hide('message', at(1n))
    S().startMoveItem(first)
    expect(repeatable(S().pending!)).toBe(false)
    expect(useBuilder.getState().active).toBe(true)
    // Another identity: BUILD ends under the deploy (useBuilder endUnder).
    const was = useCyberspace.getState().identity
    useCyberspace.setState({ identity: { ...was, pubkey: 'f'.repeat(64) } })
    useCyberspace.setState({ identity: was })
    expect(useBuilder.getState().messageDraft).toBeNull()
    expect(useBuilder.getState().itemDraft).toBeNull()
    expect(S().pending).toBeNull()
  })

  it('a new bag no relay takes moves nothing: the old copy stays, nothing is taken down, and MOVE again works', async () => {
    const first = await hide('audio', at(1n))
    const before = S().mine
    sent.length = 0
    refused.add(HIDDEN_KIND)
    expect(await failedMove(first, at(9n))).toMatch(/No relay took the moved sound\. It stays where it was\./)
    expect(S().mine).toEqual(before)
    expect(S().deleted).toEqual({})
    expect(sent).toEqual([])
    // Still lined up: the same bar moves it once a relay takes it.
    refused.clear()
    await S().deploy()
    expect(S().deployStatus).toBe('done')
    expect(S().mine).toHaveLength(1)
    expect(tag(S().mine[0].inner, 'd')).toBe(first)
  })

  it('a bag the signer refuses publishes nothing and keeps the old copy', async () => {
    const first = await hide('key', at(1n))
    const before = S().mine
    sent.length = 0
    useCyberspace.setState({ signEvent: async (t) => { if (t.kind === HIDDEN_KIND) throw new Error('declined'); return realSign(t) } })
    expect(await failedMove(first, at(9n))).toMatch(/declined/)
    expect(sent).toEqual([])
    expect(S().mine).toEqual(before)
    expect(Object.keys(useInventory.getState().items)).toEqual([first])
  })

  it('an old place that cannot be taken down keeps its copy and says so; a device that read both draws one', async () => {
    const first = await hide('message', at(1n))
    const old = row(first)
    useCyberspace.setState({ signEvent: async (t) => { if (t.kind === 5) throw new Error('declined'); return realSign(t) } })
    const moved = await move(first, at(9n))
    // Here: both rows, and the toast says to take the old one down.
    expect(S().mine.map((d) => d.eventId).sort()).toEqual([first, moved.eventId].sort())
    expect(useToast.getState().toast?.label).toBe('MOVED, OLD COPY STAYED')
    // Another device, whose scan read the old bag and the new one: one copy, the new.
    useShards.setState({ mine: [], deleted: {}, discovered: { [first]: asFound(old), [moved.eventId]: asFound(moved) } })
    expect(S().worldItems().map((w) => w.key)).toEqual([moved.eventId])
  })

  it('refuses when what it moves is gone', async () => {
    const first = await hide('key', at(1n))
    S().startMoveItem(first)
    useShards.setState({ mine: [] })
    await S().deploy()
    expect(S().deployError).toBe(MOVE_GONE)
  })
})

describe('other devices see one copy', () => {
  it('a scan that reads the moved version supersedes the row it had for the old one', async () => {
    const first = await hide('key', at(1n))
    const old = row(first)
    const moved = await move(first, at(9n))
    // This device had the old row; the scan claims the moved one.
    expect(newestOfMoved([old, moved], [moved]).map((d) => d.eventId)).toEqual([moved.eventId])
    // Read in the same scan, a stale copy loses to the newer version.
    expect(newestOfMoved([old, moved], [old, moved]).map((d) => d.eventId)).toEqual([moved.eventId])
    // A move made here whose old copy stayed: rows this device already had stay, to DELETE.
    expect(newestOfMoved([old, moved], []).map((d) => d.eventId)).toEqual([first, moved.eventId])
    // Through the scan's filing: the old row goes, the new one is claimed.
    useShards.setState({ mine: [old], deleted: {}, discovered: {} })
    S().addDiscovered([{ ...asFound(moved), bag: moved.bag } as Hidden])
    expect(S().mine.map((d) => d.eventId)).toEqual([moved.eventId])
  })

  it('draws only the newest version of an item by one hider, never dropping your own rows or other hiders\' items', () => {
    const v1 = { id: 'a'.repeat(64), kind: 1, tags: [] as string[][], created_at: 10, pubkey: 'p', content: '' }
    const v2 = { ...movedTemplate(v1, at(1n), 0, 20), id: 'b'.repeat(64), pubkey: 'p' }
    const w = (key: string, ev: typeof v1, mine = false, author = 'p') => ({ key, type: 'message' as const, at: at(1n), plane: 0 as const, height: 3, mine, author, event: ev as unknown as NostrEvent, lineage: itemLineage(ev) ?? undefined })
    expect(oneVersionEach([w(v1.id, v1), w(v2.id, v2)]).map((x) => x.key)).toEqual([v2.id])
    expect(oneVersionEach([w(v1.id, v1, true), w(v2.id, v2, true)]).map((x) => x.key)).toEqual([v1.id, v2.id])
    expect(oneVersionEach([w(v1.id, v1, false, 'p'), w(v2.id, v2, false, 'q')]).map((x) => x.key)).toEqual([v1.id, v2.id])
  })
})

describe('what can move', () => {
  it('your key item, message and audio inline; not someone else\'s, not a reference', async () => {
    const k = await hide('key', at(1n))
    const d = row(k)
    expect(movable(d, me())).toBe(true)
    expect(movable(row(await hide('message', at(2n))), me())).toBe(true)
    expect(movable(row(await hide('audio', at(3n))), me())).toBe(true)
    expect(movable(d, 'someone else')).toBe(false)
    expect(movable({ ...d, inner: { ...d.inner, pubkey: 'someone else' } }, me())).toBe(false)
    expect(movable({ ...d, ref: ['a', '33331:x:y', '', ''] }, me())).toBe(false)
  })

  it('MOVE from a card or a DEPLOYED row lines it up where it stands: placed at once, it stays put', async () => {
    const first = await hide('key', at(1n))
    const old = row(first)
    sent.length = 0
    movePlaced(first)
    expect(useBuilder.getState().active).toBe(true)
    expect(S().pending).toMatchObject({ type: 'key', move: { eventId: first } })
    expect(S().deployHeight).toBe(old.height)
    await S().deploy()
    const moved = S().mine[0]
    expect(S().mine).toHaveLength(1)
    expect(tag(moved.inner, 'C')).toBe(tag(old.inner, 'C'))
    expect(moved.lookupId).toBe(old.lookupId)
    expect(tag(moved.inner, 'd')).toBe(first)
  })
})

/** The newest bag the fake relay holds at a lookup id. */
const newestBag = (lookupId: string) => held.filter((e) => e.kind === HIDDEN_KIND && tag(e, 'd') === lookupId).sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0] as unknown as NostrEvent | undefined

/** The newest bag the fake relay holds at a lookup id, opened: its entries' ids. */
async function bagIdsIn(lookupId: string, keyHex: string): Promise<string[]> {
  const bag = newestBag(lookupId)
  return bag ? (await bagEntries(bag, hexToBytes(keyHex))).map((e) => (e as NostrEvent).id) : []
}

describe('review of #595: a second device that missed the move', () => {
  it('R1: hiding in the old region from that device never writes the old copy back; its row is kept, gone from its bag', async () => {
    const stays = await hide('message', at(2n))
    const goes = await hide('message', at(1n))
    const oldRow = row(goes)
    const device2 = S().mine.map((d) => ({ ...d }))
    // Device 1 moves it into the next region.
    await move(goes, at(9n))
    expect(await bagIdsIn(oldRow.lookupId, oldRow.keyHex)).toEqual([stays])
    // Device 2, which has not scanned since, hides something else in the old region.
    useShards.setState({ mine: device2, deleted: {}, discovered: {} })
    const added = await hide('message', at(3n))
    const oldBagNow = await bagIdsIn(oldRow.lookupId, oldRow.keyHex)
    expect(oldBagNow).not.toContain(goes)
    expect(oldBagNow.sort()).toEqual([stays, added].sort())
    // Kept, marked, not drawn, and not movable: the copy at the new place is the one.
    const stale = row(goes)
    expect(stale.goneFrom).toBeDefined()
    expect(S().worldItems().some((w) => w.key === goes)).toBe(false)
    expect(movable(stale, me())).toBe(false)
    S().startMoveItem(goes)
    expect(S().pending).toBeNull()
    // A later rewrite from that device still leaves it out.
    await hide('message', at(4n))
    expect(await bagIdsIn(oldRow.lookupId, oldRow.keyHex)).not.toContain(goes)
  })

  it('P1: a scan reads only some of a bag (TV\'s fresh finds), so it takes no row away, however new the bag', async () => {
    const a = await hide('message', at(1n))
    const b = await hide('message', at(2n))
    const rowB = row(b)
    const bag = newestBag(rowB.lookupId)!
    // A row that last saw an older version of the bag.
    useShards.setState({ mine: S().mine.map((d) => (d.eventId === a ? { ...d, bagAt: bag.created_at - 5, createdAt: bag.created_at - 5 } : d)) })
    S().addDiscovered([{ ...asFound(rowB), bag: rowB.bag, bagAt: bag.created_at + 10 } as Hidden], { watched: true })
    expect(S().mine.map((d) => d.eventId).sort()).toEqual([a, b].sort())
    // Not by a played scan either: only a whole bag, read for a rewrite, says what is gone.
    S().addDiscovered([{ ...asFound(rowB), bag: rowB.bag, bagAt: bag.created_at + 10 } as Hidden])
    expect(S().mine.map((d) => d.eventId).sort()).toEqual([a, b].sort())
  })

  it('a relay\'s older copy of the bag takes nothing away', async () => {
    const stays = await hide('message', at(2n))
    const goes = await hide('message', at(1n))
    S().addDiscovered([{ ...asFound(row(stays)), bagAt: row(goes).createdAt - 5 } as Hidden])
    expect(S().mine.map((d) => d.eventId).sort()).toEqual([stays, goes].sort())
  })

  it('R2: MOVE of the old row is refused once its bag no longer holds it: no second live copy', async () => {
    const goes = await hide('key', at(1n))
    const device2 = S().mine.map((d) => ({ ...d }))
    await move(goes, at(9n))
    useShards.setState({ mine: device2, deleted: {}, discovered: {} })
    const mark = sent.length
    expect(await failedMove(goes, at(17n))).toBe(MOVE_STALE)
    expect(sent.length).toBe(mark)
    expect(S().mine.map((d) => d.eventId)).toEqual([goes])
  })

  it('R2: the same for a message (a cashu token never stands at two places)', async () => {
    const goes = await hide('message', at(1n))
    const device2 = S().mine.map((d) => ({ ...d }))
    await move(goes, at(9n))
    useShards.setState({ mine: device2, deleted: {}, discovered: {} })
    expect(await failedMove(goes, at(5n))).toBe(MOVE_STALE)
  })

  it('a move refuses, rather than risk a second copy, when no relay answers', async () => {
    const goes = await hide('audio', at(1n))
    const mark = sent.length
    silent = true
    expect(await failedMove(goes, at(9n))).toBe(MOVE_UNANSWERED)
    expect(sent.length).toBe(mark)
    expect(S().mine.map((d) => d.eventId)).toEqual([goes])
  })

  it('a LOCAL row asks no relay before it moves', async () => {
    useCyberspace.setState({ live: false })
    const goes = await hide('message', at(1n))
    silent = true
    await move(goes, at(9n))
    expect(tag(S().mine[0].inner, 'd')).toBe(goes)
  })
})

describe('review of #595: a forged lineage on a held item', () => {
  it('R3: another author\'s key carrying my key\'s id as its d does not block TAKE of mine', async () => {
    const mineKey = await hide('key', at(1n))
    const real = row(mineKey)
    const mallory = 'b'.repeat(64)
    const decoyInner = { ...real.inner, id: 'c'.repeat(64), pubkey: mallory, tags: [['d', mineKey], ...real.inner.tags.filter((t) => t[0] !== 'd')] }
    const decoy = { ...asFound(real), eventId: decoyInner.id, inner: decoyInner, author: mallory, key: forgeKey('Fake', 'x') } as Hidden
    const tookDecoy = heldFromFind('finder', decoy, 1, false, null)!
    const holding: Record<string, HeldItem> = { [tookDecoy.id]: tookDecoy }
    const realFind = heldFromFind('finder', asFound(real), 2, false, null)!
    expect(holdsItem(holding, real.eventId, itemLineage(real.inner), real.inner.pubkey)).toBe(false)
    expect(addHeld(holding, [realFind]).added.map((h) => h.id)).toEqual([mineKey])
  })
})

describe('review 2 of #595: the bag clock runs ahead of the wall clock', () => {
  it('P2: quick hides, then a relay serving an older bag: the next hide loses nothing', async () => {
    const x = await hide('message', at(1n))
    const y = await hide('message', at(2n))
    const z = await hide('message', at(3n))
    const lookupId = row(z).lookupId
    const bags = held.filter((e) => e.kind === HIDDEN_KIND && tag(e, 'd') === lookupId).sort((p, q) => (p.created_at ?? 0) - (q.created_at ?? 0))
    expect(bags).toHaveLength(3)
    // The bag clock ran ahead: z's own time is not after the second bag.
    expect(row(z).createdAt).toBeLessThanOrEqual(bags[1].created_at ?? 0)
    // The relays serve the second bag, not the newest.
    withheld.add(bags[2].id)
    const w = await hide('message', at(4n))
    expect(S().mine.map((d) => d.eventId).sort()).toEqual([x, y, z, w].sort())
    expect((await bagIdsIn(lookupId, row(z).keyHex)).sort()).toEqual([x, y, z, w].sort())
  })

  it('a row the newest bag holds, read later from an older copy, is kept', async () => {
    const x = await hide('message', at(1n))
    const z = await hide('message', at(3n))
    const lookupId = row(z).lookupId
    const zAt = row(z).bagAt!
    expect(zAt).toBe(newestBag(lookupId)!.created_at)
    // An older copy without z: kept.
    const older = held.filter((e) => e.kind === HIDDEN_KIND && tag(e, 'd') === lookupId).sort((p, q) => (p.created_at ?? 0) - (q.created_at ?? 0))[0]
    withheld.add(newestBag(lookupId)!.id)
    expect(older.created_at).toBeLessThan(zAt)
    await hide('message', at(5n))
    expect(S().mine.some((d) => d.eventId === z)).toBe(true)
    void x
  })
})

describe('review 3 of #595: two writers, nothing lost', () => {
  /** Device 1 hides x then z; device 2, whose read never saw z's bag, hides w; device 1 then hides q. */
  async function twoWriters(): Promise<{ x: string; z: string; lookupId: string; keyHex: string; device1: MyDeployment[] }> {
    const x = await hide('message', at(1n))
    const device2 = S().mine.map((d) => ({ ...d }))
    const z = await hide('message', at(2n))
    const lookupId = row(z).lookupId
    const keyHex = row(z).keyHex
    const v2 = newestBag(lookupId)!
    const device1 = S().mine.map((d) => ({ ...d }))
    useShards.setState({ mine: device2, deleted: {}, discovered: {} })
    withheld.add(v2.id)
    await hide('message', at(3n))
    withheld.clear()
    expect(await bagIdsIn(lookupId, keyHex)).not.toContain(z)
    useShards.setState({ mine: device1, deleted: {}, discovered: {} })
    await hide('message', at(4n))
    return { x, z, lookupId, keyHex, device1 }
  }

  it('W1: a stale rewrite elsewhere dropped z; z stays listed, gone from its bag, and HIDE AGAIN puts it back', async () => {
    const { z, lookupId, keyHex } = await twoWriters()
    const zRow = row(z)
    expect(zRow).toBeDefined()
    expect(zRow.goneFrom).toBeDefined()
    expect(await bagIdsIn(lookupId, keyHex)).not.toContain(z)
    expect(S().worldItems().some((w) => w.key === z)).toBe(false)
    expect(await S().hideAgain(z)).toBeNull()
    expect(inItsBag(row(z))).toBe(true)
    expect(await bagIdsIn(lookupId, keyHex)).toContain(z)
    expect(S().worldItems().some((w) => w.key === z)).toBe(true)
    // And it stays in through the next rewrite.
    await hide('message', at(5n))
    expect(await bagIdsIn(lookupId, keyHex)).toContain(z)
    expect(inItsBag(row(z))).toBe(true)
  })

  it('HIDE AGAIN that no relay takes leaves it marked and out of the bag', async () => {
    const { z, lookupId, keyHex } = await twoWriters()
    refused.add(HIDDEN_KIND)
    expect(await S().hideAgain(z)).toMatch(/No relay took/)
    expect(row(z).goneFrom).toBeDefined()
    refused.clear()
    await hide('message', at(5n))
    expect(await bagIdsIn(lookupId, keyHex)).not.toContain(z)
  })

  it('HIDE AGAIN waits while a hide is going out', async () => {
    const { z } = await twoWriters()
    useShards.setState({ deployStatus: 'working' })
    expect(await S().hideAgain(z)).toBe(HIDE_AGAIN_BUSY)
    expect(row(z).goneFrom).toBeDefined()
  })

  it('FORGET drops only this device\'s record, and publishes nothing', async () => {
    const { z, x } = await twoWriters()
    const mark = sent.length
    S().forgetRow(z)
    expect(S().mine.some((d) => d.eventId === z)).toBe(false)
    expect(S().mine.some((d) => d.eventId === x)).toBe(true)
    expect(sent.length).toBe(mark)
    // Never a row still in its bag.
    S().forgetRow(x)
    expect(S().mine.some((d) => d.eventId === x)).toBe(true)
  })

  it('a newer version of its bag that holds it again clears the mark; an older one does not', async () => {
    const { z } = await twoWriters()
    const zRow = row(z)
    const gone = zRow.goneFrom!
    S().addDiscovered([{ ...asFound(zRow), bag: zRow.bag, bagAt: gone - 1 } as Hidden])
    expect(row(z).goneFrom).toBe(gone)
    S().addDiscovered([{ ...asFound(zRow), bag: zRow.bag, bagAt: gone + 1 } as Hidden])
    expect(inItsBag(row(z))).toBe(true)
  })

  it('a marked row cannot be moved, even with a move lined up', async () => {
    const { z } = await twoWriters()
    useShards.setState({ pending: { type: 'message', text: 'meet at the fountain', move: { eventId: z } }, deployStatus: 'idle', deployError: null })
    aim(at(9n))
    const mark = sent.length
    await S().deploy()
    expect(S().deployError).toBe(MOVE_STALE)
    expect(sent.length).toBe(mark)
  })
})
