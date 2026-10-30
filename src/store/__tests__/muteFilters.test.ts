import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { Hidden } from '../../lib/hidden'
import { bagTemplate, chatInnerTemplate, CHAT_BAG_KIND } from '../../lib/hidden'
import { hidesThing, NOTHING_MUTED, withoutMuted, type Muted } from '../../lib/muteList'
import { shownBags } from '../../hud/DiscoveredPanel'
import type { LootItem } from '../../lib/loot'
import { spectate } from '../../lib/spectator'
import { findHidden, useShards, worldItemHidden } from '../useShards'
import { useCyberspace } from '../useCyberspace'
import { useMutes } from '../useMutes'
import { presenceDrawn, usePresence } from '../usePresence'
import { useChat } from '../useChat'
import { useSecrets } from '../useSecrets'
import { useCeremony } from '../useCeremony'
import { useToast } from '../useToast'
import { useInventory } from '../useInventory'
import { muteIdOf } from '../../hud/SecretModal'

const ME = '1'.repeat(64)
const BLOCKED = 'b'.repeat(64)
const FRIEND = 'f'.repeat(64)
const MUTED_ITEM = 'e'.repeat(64)
const LINEAGE = 'd'.repeat(64)

const muted: Muted = { pubkeys: new Set([BLOCKED]), items: new Set([MUTED_ITEM, LINEAGE]) }

function find(over: Partial<Hidden>): Hidden {
  return { eventId: '0'.repeat(63) + '1', bagId: 'bag', lookupId: 'look', author: FRIEND, at: { x: 0n, y: 0n, z: 0n }, plane: 0, height: 5, createdAt: 1, type: 'message', text: 'hi', ...over }
}

const inner = (pubkey: string, id: string, tags: string[][] = []): NonNullable<Hidden['inner']> =>
  ({ id, pubkey, kind: 3330, created_at: 1, tags, content: '' }) as unknown as NonNullable<Hidden['inner']>

let identityBefore: ReturnType<typeof useCyberspace.getState>['identity']

beforeEach(() => {
  identityBefore = useCyberspace.getState().identity
  useCyberspace.setState({ identity: { ...identityBefore, pubkey: ME } })
  useMutes.setState({ muted })
})

afterEach(() => {
  useMutes.setState({ muted: NOTHING_MUTED })
  useCyberspace.setState({ identity: identityBefore })
})

describe('the one rule', () => {
  it('hides by any author or any id, and never what is yours', () => {
    expect(hidesThing(muted, { authors: [BLOCKED] }, ME)).toBe(true)
    expect(hidesThing(muted, { authors: [FRIEND, BLOCKED] }, ME)).toBe(true)
    expect(hidesThing(muted, { authors: [FRIEND], ids: [MUTED_ITEM] }, ME)).toBe(true)
    expect(hidesThing(muted, { authors: [FRIEND], ids: ['x'] }, ME)).toBe(false)
    // In your own bag, or flagged yours: never, whoever made what it holds.
    expect(hidesThing(muted, { authors: [ME, BLOCKED], ids: [MUTED_ITEM] }, ME)).toBe(false)
    expect(hidesThing(muted, { authors: [BLOCKED], mine: true }, ME)).toBe(false)
  })

  it('keeps your own events in a list, and returns the same list when nothing is muted', () => {
    const evs = [{ id: 'a', pubkey: BLOCKED }, { id: 'b', pubkey: ME }, { id: MUTED_ITEM, pubkey: ME }, { id: 'c', pubkey: FRIEND }]
    expect(withoutMuted(evs, muted, ME).map((e) => e.id)).toEqual(['b', MUTED_ITEM, 'c'])
    expect(withoutMuted(evs, NOTHING_MUTED, ME)).toBe(evs)
  })
})

describe('hidden bags in the world (worldItems: shards, notes, keys, chests, coins, the modal)', () => {
  afterEach(() => { useShards.setState({ discovered: {}, curated: null }) })

  it('hides a blocked hider, a muted item and a moved one by its lineage, and keeps the rest', () => {
    useShards.setState({
      curated: null,
      discovered: {
        a: find({ eventId: 'a'.repeat(64), author: BLOCKED }),
        b: find({ eventId: MUTED_ITEM }),
        c: find({ eventId: 'c'.repeat(64), type: 'shard', inner: inner(FRIEND, 'c'.repeat(64), [['d', LINEAGE]]) }),
        k: find({ eventId: '9'.repeat(64) }),
      },
    })
    expect(useShards.getState().worldItems().map((w) => w.key)).toEqual(['9'.repeat(64)])
    expect(useShards.getState().secretByEvent('a'.repeat(64))).toBeNull()
  })

  it('hides a LIVE LINK whose object is by someone blocked, and a chest entry claiming them', () => {
    expect(findHidden(find({ inner: inner(BLOCKED, '5'.repeat(64)) }), muted, ME)).toBe(true)
    expect(worldItemHidden({ key: 'x', mine: false, author: FRIEND, target: { kind: 33331, pubkey: BLOCKED } as never }, muted, ME)).toBe(true)
  })

  it('never hides your own things, even one holding a blocked person\'s object', () => {
    useShards.setState({ curated: null, discovered: { m: find({ eventId: '8'.repeat(64), author: ME, inner: inner(BLOCKED, MUTED_ITEM) }) } })
    expect(useShards.getState().worldItems().map((w) => w.key)).toEqual(['8'.repeat(64)])
  })

  it('shows everything again once unblocked', () => {
    useShards.setState({ curated: null, discovered: { a: find({ eventId: 'a'.repeat(64), author: BLOCKED }) } })
    expect(useShards.getState().worldItems()).toHaveLength(0)
    useMutes.setState({ muted: NOTHING_MUTED })
    expect(useShards.getState().worldItems()).toHaveLength(1)
  })
})

describe('the HIDDEN BAGS and DISCOVERED BAGS lists', () => {
  const bag = (author: string, bagId: string): LootItem => ({ author, bagId } as unknown as LootItem)
  it('lists no bag by someone blocked, nor one muted by its id, and always yours', () => {
    const items = [bag(BLOCKED, 'b1'), bag(FRIEND, MUTED_ITEM), bag(FRIEND, 'f1'), bag(ME, 'm1')]
    expect(shownBags(items, new Set(), 'hidden', null, muted, ME).map((b) => b.bagId)).toEqual(['f1', 'm1'])
    expect(shownBags(items, new Set(), 'hidden', null).map((b) => b.bagId)).toEqual(['b1', MUTED_ITEM, 'f1', 'm1'])
  })
})

describe('the find ceremony', () => {
  it('raises no chip and no decode for a blocked hider\'s find', () => {
    useCeremony.setState({ chip: null, births: {} })
    useShards.setState({ curated: null })
    useCeremony.getState().mark([find({ eventId: 'a'.repeat(64), author: BLOCKED })])
    expect(useCeremony.getState().chip).toBeNull()
    useCeremony.getState().mark([find({ eventId: 'c'.repeat(64) })])
    expect(useCeremony.getState().chip?.count).toBe(1)
  })
})

describe('avatars of the people here', () => {
  const person = (pubkey: string) => ({ pubkey, position: { x: 0n, y: 0n, z: 0n }, plane: 0 as const, lastActive: 1, type: 'hop', checkedAt: 1, actionId: 'x', frozen: false })
  it('draws, lists and counts nobody blocked, but keeps tracking them', () => {
    const people = { [BLOCKED]: person(BLOCKED), [FRIEND]: person(FRIEND) } as never
    expect(presenceDrawn(people, { me: ME, focus: ME, targets: {}, plane: 0, muted: muted.pubkeys }).map((p) => p.pubkey)).toEqual([FRIEND])
    usePresence.setState({ people })
    expect(usePresence.getState().others().map((p) => p.pubkey)).toEqual([FRIEND])
    expect(Object.keys(usePresence.getState().people)).toContain(BLOCKED)
    usePresence.setState({ people: {} })
  })
})

describe('local chat', () => {
  const regionKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff)
  const region = 'cc'.repeat(32)
  const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

  it('drops a line from someone blocked: no line, no unfold, no unread', async () => {
    useChat.setState({ lines: [], open: false, unread: 0, muted: true })
    useSecrets.setState({ current: { [region]: { keyHex: hex(regionKey), height: 12 } } })
    const sk = generateSecretKey()
    useMutes.setState({ muted: { pubkeys: new Set([getPublicKey(sk)]), items: new Set() } })
    const line = finalizeEvent(chatInnerTemplate('buy my coin', { x: 1n, y: 2n, z: 3n }, 0, 10, region), sk)
    await useChat.getState().receive(finalizeEvent(await bagTemplate([line], regionKey, region, 12, 10, CHAT_BAG_KIND), sk))
    expect(useChat.getState().lines).toHaveLength(0)
    expect(useChat.getState().open).toBe(false)
    expect(useChat.getState().unread).toBe(0)
  })
})

describe('spectating', () => {
  it('refuses someone blocked and says so', async () => {
    useToast.setState({ toast: null })
    const before = useCyberspace.getState().spectate
    await spectate(BLOCKED)
    expect(useCyberspace.getState().spectate).toBe(before)
    expect(useToast.getState().toast?.label).toBe('BLOCKED')
  })
})

describe('MUTE THIS ITEM names an id something can hide by (review of #464, B2)', () => {
  it('the lineage, else the item\'s own id, else a LIVE LINK\'s object id', () => {
    expect(muteIdOf({ key: 'a'.repeat(64), lineage: LINEAGE })).toBe(LINEAGE)
    expect(muteIdOf({ key: 'a'.repeat(64) })).toBe('a'.repeat(64))
    expect(muteIdOf({ key: 'look/entry', event: { id: MUTED_ITEM } as never })).toBe(MUTED_ITEM)
    expect(worldItemHidden({ key: 'look/entry', mine: false, author: FRIEND, event: { id: MUTED_ITEM, pubkey: FRIEND } as never }, muted, ME)).toBe(true)
  })
})

describe('keys found in a bag (review of #464, S5)', () => {
  afterEach(() => { useShards.setState({ discovered: {} }); vi.restoreAllMocks() })
  it('a blocked hider\'s key is not taken; another\'s is, and a scan holds neither', () => {
    const hold = vi.spyOn(useInventory.getState(), 'holdFinds').mockReturnValue([])
    const key = (id: string, author: string): Hidden => find({ eventId: id, author, type: 'key', text: undefined, key: { name: 'k', about: '', itemPubkey: 'f'.repeat(64), secretHex: '1'.repeat(64) } as never })
    useShards.getState().addDiscovered([key('7'.repeat(64), BLOCKED), key('6'.repeat(64), FRIEND)])
    expect(hold).not.toHaveBeenCalled()
    useShards.getState().takeFound(['7'.repeat(64), '6'.repeat(64)])
    expect(hold.mock.calls.at(-1)?.[0].map((h: Hidden) => h.eventId)).toEqual(['6'.repeat(64)])
  })
})
