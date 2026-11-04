/**
 * identitySafety.test.ts: bag rewrites when the identity switches on the way,
 * the bag clock's upper bound, and one bag rewrite at a time beside a hide
 * (reviews of #597 and #595).
 *
 * A region's lookup id is the same whoever hides there, so two identities on
 * one device can each have rows at it. Work begun as one identity reads,
 * prunes and saves that identity's rows only, and never signs anything as the
 * one signed in since: not a bag, and not a deletion naming the first one's
 * object or bag, which no relay honors and which ties the two keys together in
 * public. The relay is a mock that keeps what is published; a read or a publish
 * can switch identity, or wait, mid-flight. No network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    get length() { return mem.size },
    key: (i: number) => [...mem.keys()][i] ?? null,
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
type Ev = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }
type Filter = { kinds?: number[]; authors?: string[]; '#d'?: string[] }
const relay = vi.hoisted(() => ({
  events: [] as Ev[],
  /** Before a publish lands: true refuses it. May switch identity, or wait. */
  onPublish: (async () => false) as (e: Ev) => Promise<boolean>,
  /** After a read has taken its answer and before it is returned: may switch identity, or wait. */
  onRead: (async () => undefined) as (f: Filter) => Promise<void>,
  /**
   * keepAll keeps every event. silent drops an addressable event older than the one
   * it holds and answers OK (khatru's event store); strict refuses it as blocked
   * (grain). Either replaces an older one with a newer one (review of #599).
   */
  mode: 'keepAll' as 'keepAll' | 'silent' | 'strict',
}))
vi.mock('../../lib/relay', () => {
  const dOf = (e: Ev): string => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  const answer = (f: Filter): Ev[] => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(dOf(e))))
  return {
    publishMany: vi.fn(async (_r: string[], ev: Ev) => {
      if (await relay.onPublish(ev)) return { ok: false }
      if (relay.mode !== 'keepAll' && ev.kind >= 30000 && ev.kind < 40000) {
        const same = relay.events.filter((e) => e.kind === ev.kind && e.pubkey === ev.pubkey && dOf(e) === dOf(ev))
        if (same.some((e) => e.created_at > ev.created_at)) return relay.mode === 'silent' ? { ok: true } : { ok: false, reason: 'blocked: a newer addressable event already exists' }
        relay.events = relay.events.filter((e) => !same.includes(e))
      }
      relay.events.push(ev)
      return { ok: true }
    }),
    query: vi.fn(async (f: Filter) => answer(f)),
    queryAny: vi.fn(async (_r: string[], f: Filter) => answer(f)),
    queryEach: vi.fn(async (f: Filter) => {
      const events = answer(f)
      await relay.onRead(f)
      return [{ url: 'wss://relay.test', outcome: 'answered', events }]
    }),
    relaySet: () => ['wss://relay.test'],
  }
})
import { newShard, type ShardModel } from 'sno-core/shards'
import { forgeKey } from '../../lib/chests'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { HIDDEN_KIND, OBJECT_KIND, bagEntries, entryKey, type KeyItem } from '../../lib/hidden'
import { useStash } from '../../hud/stash'
import { doorSecret, resetDoorSecrets } from '../doorSecrets'
import { entriesIn, reloadLocalView } from '../hiddenStorage'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useWorkshop } from '../useWorkshop'
import { resetOpenedChests } from '../useOpenedChests'
import { BAG_CLOCK_AHEAD, BAG_CLOCK_REFUSE_S, BROADCAST_BUSY, nextBagAt, noteBagAt, useShards, type MyDeployment } from '../useShards'
import type { Position } from '../../lib/space'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const HEIGHT = 4
const Y = 'b2'.repeat(32)
let home = ''
let lock: KeyItem
const lockOf = (k: KeyItem = lock) => ({ pubkey: k.itemPubkey, label: k.name })
const dOf = (e: Ev): string => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
const goTo = (p: Position): void => { useCyberspace.setState({ cursor: p, position: p, anchor: p }) }
const signIn = (pubkey: string): void => { useCyberspace.setState({ identity: { pubkey, npub: `npub-${pubkey.slice(0, 4)}` } }) }
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))
/** One identity's rows as stored on this device. */
const stored = (pubkey: string): MyDeployment[] => entriesIn(pubkey).flatMap((e) => (e.row ? [e.row as MyDeployment] : []))
const ids = (rows: MyDeployment[]): string[] => rows.map((d) => d.eventId)
const deletions = (): Ev[] => relay.events.filter((e) => e.kind === 5)
/** Everything the newest of this bag names, read with its key. */
async function newestEntries(d: MyDeployment): Promise<Set<string>> {
  const bag = relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === d.lookupId).sort((a, b) => b.created_at - a.created_at)[0] as NostrEvent | undefined
  return new Set(bag ? (await bagEntries(bag, hexToBytes(d.keyHex))).map(entryKey) : [])
}

async function sealDoor(name = 'North Door', h = HEIGHT): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startPlaceDoor(); S().setDeployHeight(h); S().placeChest()
  await S().sealPlacedChest({ name, lock: lockOf(), requires: `the ${lock.name}`, contents: [] })
  expect(S().deployError).toBeNull()
  return S().mine.find((d) => !before.has(d.eventId))!
}
async function hide(text: string, h: number): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startDeployMessage(text); S().setDeployHeight(h)
  await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
  return S().mine.find((d) => !before.has(d.eventId))!
}
function big(name: string): ShardModel {
  return { ...newShard(name), unit: 1, vertices: Array.from({ length: 3000 }, (_, i) => ({ p: [i % 16, Math.floor(i / 16) % 16, Math.floor(i / 256)] as [number, number, number], c: [1, 1, 1] as [number, number, number] })), faces: [[0, 1, 2]] }
}
/** Another identity's rows, as an earlier session on this device left them; read as a load would. */
function seedRows(pubkey: string, rows: MyDeployment[]): void {
  localStorage.setItem(`onosendai:deployments:${pubkey}`, JSON.stringify(rows))
  reloadLocalView()
  signIn(pubkey); signIn(home)
}
/** Mark a row gone from its bag, as a read of a newer bag that lacks it would (pruneGoneRows). */
function markGone(eventId: string): void {
  useShards.setState({ mine: S().mine.map((m) => (m.eventId === eventId ? { ...m, goneFrom: m.bagAt ?? m.createdAt } : m)) })
}

beforeEach(() => {
  home ||= C().identity.pubkey
  relay.events = []
  relay.onPublish = async () => false
  relay.onRead = async () => undefined
  relay.mode = 'keepAll'
  lock = forgeKey('Silver Key')
  localStorage.clear()
  reloadLocalView()
  resetDoorSecrets(); resetOpenedChests()
  signIn(home)
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, deployNote: null, selectedSecret: null, deployLeaveOut: null, deployInto: null, deployDoorHeight: null, placedLast: null, broadcasting: null, broadcastError: null, broadcastFailed: null })
  useBuilder.getState().exit(); useStash.getState().close()
  useInventory.setState({ owner: home, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('a bag rewrite reads and prunes the rows of the identity it began as (review of #597)', () => {
  it('BROADCAST: Y signs in while the relay read is out; Y\'s door at the same lookup id is kept, and nothing goes out', async () => {
    const h1 = await hide('home here', HEIGHT)
    // Y's own door, in the same region's bag: a lookup id is the same whoever hides there.
    const yDoor = {
      ...h1, eventId: 'y-door', inner: { ...h1.inner, id: 'y-door', pubkey: Y }, type: 'chest', text: undefined, createdAt: 1, bagAt: undefined, published: true,
      chest: { name: 'Their Door', lockPubkey: lock.itemPubkey, senderPubkey: lock.itemPubkey, requires: '', payload: '', door: HEIGHT },
    } as MyDeployment
    seedRows(Y, [yDoor])
    expect(ids(S().mine)).toEqual([h1.eventId])
    const sentBefore = relay.events.length
    relay.onRead = async (f) => { if (f['#d']?.includes(h1.lookupId)) signIn(Y) }
    expect(await S().broadcast(h1.lookupId)).toBe(false)
    expect(S().broadcastError).toMatch(/switched identity/)
    expect(ids(stored(Y))).toEqual(['y-door'])
    expect(ids(S().mine)).toEqual(['y-door'])
    expect(relay.events.length).toBe(sentBefore)
    expect(ids(stored(home))).toEqual([h1.eventId])
  })

  it('DELETE: the same, and the first identity\'s row stays listed', async () => {
    const h1 = await hide('home one', HEIGHT)
    const h2 = await hide('home two', HEIGHT)
    const yDoor = { ...h1, eventId: 'y-door', inner: { ...h1.inner, id: 'y-door', pubkey: Y }, type: 'chest', text: undefined, createdAt: 1, bagAt: undefined, published: true, chest: { name: 'Their Door', lockPubkey: lock.itemPubkey, senderPubkey: lock.itemPubkey, requires: '', payload: '', door: HEIGHT } } as MyDeployment
    seedRows(Y, [yDoor])
    const sentBefore = relay.events.length
    relay.onRead = async (f) => { if (f['#d']?.includes(h1.lookupId)) signIn(Y) }
    await S().deleteInstance(h2.eventId)
    expect(ids(stored(Y))).toEqual(['y-door'])
    expect(relay.events.length).toBe(sentBefore)
    expect(ids(stored(home)).sort()).toEqual([h1.eventId, h2.eventId].sort())
  })
})

describe('a deletion is only ever signed by the identity whose object or bag it names (review of #597)', () => {
  it('a hide whose bag is refused for a switch does not take its object back as the next identity', async () => {
    const shard = big('large')
    useWorkshop.setState({ shards: [shard], currentId: shard.id })
    // The object goes out first; the switch lands right after it.
    relay.onPublish = async (e) => { if (e.kind === OBJECT_KIND) signIn(Y); return false }
    S().startDeployShard(shard.id); S().setDeployHeight(HEIGHT)
    await S().deploy()
    expect(S().deployError).toMatch(/switched identity/)
    expect(relay.events.map((e) => e.kind)).toEqual([OBJECT_KIND])
    expect(deletions()).toEqual([])
  })

  it('a new lock whose door no relay took: the room bag it made is not retracted as the next identity', async () => {
    const d = await sealDoor()
    await hide('behind it', HEIGHT)
    let switchedAt = -1
    relay.onPublish = async (e) => {
      if (e.kind !== HIDDEN_KIND || dOf(e) !== d.lookupId) return false
      signIn(Y)
      switchedAt = relay.events.length
      return true
    }
    const why = await S().resealDoor(d.eventId, { name: 'North Door', requires: 'new', lock: lockOf(forgeKey('New')) })
    expect(switchedAt).toBeGreaterThan(0)
    expect(why).toMatch(/switched identity/)
    expect(relay.events.slice(switchedAt).filter((e) => e.kind === 5)).toEqual([])
  })
})

describe('a door\'s work writes the rows of the identity it began as (review of #597)', () => {
  it('DELETE of a door: a switch while the room is read stops it, and nothing is retracted as the next identity', async () => {
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    expect(inside.room?.doorId).toBe(d.eventId)
    const sentBefore = relay.events.length
    relay.onRead = async (f) => { if (f['#d']?.includes(inside.lookupId)) signIn(Y) }
    expect(await S().deleteDoor(d.eventId, false)).toMatch(/switched identity/)
    expect(relay.events.length).toBe(sentBefore)
    expect(ids(stored(home)).sort()).toEqual([d.eventId, inside.eventId].sort())
    expect(stored(Y)).toEqual([])
  })

  it('one door of two removed: what stood behind it follows the other on the first identity\'s list, though it switched meanwhile', async () => {
    const a = await sealDoor('North Door')
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    const b = await sealDoor('East Door')
    expect(doorSecret(home, b.eventId)).toBe(doorSecret(home, a.eventId))
    const inside = await hide('behind it', HEIGHT)
    const named = inside.room!.doorId
    const other = named === a.eventId ? b : a
    // The door's own bag goes out without it; the switch lands as it does.
    relay.onPublish = async (e) => { if (e.kind === HIDDEN_KIND && dOf(e) === a.lookupId) signIn(Y); return false }
    expect(await S().deleteDoor(named, false)).toBeNull()
    expect(stored(home).find((m) => m.eventId === inside.eventId)?.room?.doorId).toBe(other.eventId)
    expect(stored(Y)).toEqual([])
  })
})

describe('the bag clock (reviews of #597 and #599)', () => {
  /** The same identity's other device wrote this bag dated `ahead` seconds past this device's clock. */
  async function theirBagAhead(first: MyDeployment, ahead: number): Promise<Ev> {
    const theirs = relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === first.lookupId)[0]
    const later = { ...theirs, id: 'a'.repeat(64), created_at: Math.floor(Date.now() / 1000) + ahead }
    relay.events = [...relay.events.filter((e) => e !== theirs), later]
    return later
  }

  it('runs past a newer bag however far ahead it is, and refuses only past BAG_CLOCK_REFUSE_S', () => {
    const now = Math.floor(Date.now() / 1000)
    noteBagAt('near', now + 600)
    expect(nextBagAt('near')).toBe(now + 601)
    noteBagAt('hours', now + 6 * 3600)
    expect(nextBagAt('hours')).toBe(now + 6 * 3600 + 1)
    noteBagAt('far', now + 10 * 365 * 86400)
    expect(() => nextBagAt('far')).toThrow(BAG_CLOCK_AHEAD)
    expect(BAG_CLOCK_REFUSE_S).toBe(86400)
  })

  for (const mode of ['silent', 'strict'] as const) {
    it(`a ${mode} relay: another device's bag 10 minutes ahead of this clock; a hide here still lands in the bag (review of #599)`, async () => {
      relay.mode = mode
      const first = await hide('one', 7)
      const theirs = await theirBagAhead(first, 600)
      const two = await hide('two', 7)
      expect(two.published).toBe(true)
      expect(two.bagAt).toBeGreaterThan(theirs.created_at)
      expect((await newestEntries(two)).has(two.eventId)).toBe(true)
      // The next rewrite here reads the relays' bag, which holds it: nothing is marked gone.
      const three = await hide('three', 7)
      expect(S().mine.find((m) => m.eventId === two.eventId)?.goneFrom).toBeUndefined()
      const inBag = await newestEntries(three)
      expect(inBag.has(two.eventId)).toBe(true)
      expect(inBag.has(three.eventId)).toBe(true)
    })
  }

  it('a relay that drops older bags: one dated an hour ahead still takes the next rewrite here, one second newer', async () => {
    relay.mode = 'silent'
    const first = await hide('one', 8)
    const theirs = await theirBagAhead(first, 3600)
    const two = await hide('two', 8)
    const ours = relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === first.lookupId)
    expect(ours.map((e) => e.created_at)).toEqual([theirs.created_at + 1])
    expect((await newestEntries(two)).has(two.eventId)).toBe(true)
  })

  it('a bag dated more than a day ahead: the hide is refused in words, and nothing is sent', async () => {
    relay.mode = 'strict'
    const first = await hide('one', 9)
    await theirBagAhead(first, BAG_CLOCK_REFUSE_S + 3600)
    const sentBefore = relay.events.length
    S().startDeployMessage('two'); S().setDeployHeight(9)
    await S().deploy()
    expect(S().deployError).toBe(BAG_CLOCK_AHEAD)
    expect(relay.events.length).toBe(sentBefore)
    expect(S().mine.some((m) => m.text === 'two')).toBe(false)
  })
})

describe('one bag rewrite at a time beside a hide (review of #595)', () => {
  /**
   * Hold the next read of this bag, with the answer it had when asked, until
   * released. A bag that reaches the relays while that read is held (a hide
   * that did not wait) stays on its way until `landed` settles, as a slow relay
   * would keep it: the hide's row is not on the list yet when the held rewrite
   * reads the list and signs, so a rewrite that does not wait drops it.
   */
  function holdRead(lookupId: string): { reached: Promise<void>; release: () => void; landsAfter: (p: Promise<unknown>) => void } {
    let release = (): void => {}
    let arrive = (): void => {}
    let held = true
    let landed: Promise<unknown> = Promise.resolve()
    const until = new Promise<void>((r) => { release = () => { held = false; r() } })
    const reached = new Promise<void>((r) => { arrive = r })
    let once = true
    relay.onRead = async (f) => {
      if (!once || !f['#d']?.includes(lookupId)) return
      once = false
      arrive()
      await until
    }
    relay.onPublish = async (e) => {
      if (held && e.kind === HIDDEN_KIND) await landed.catch(() => undefined)
      return false
    }
    return { reached, release, landsAfter: (p) => { landed = p } }
  }

  it('PLACE started while HIDE AGAIN reads the bag waits for it: the bag ends with both', async () => {
    const gone = await hide('gone from here', HEIGHT)
    markGone(gone.eventId)
    const read = holdRead(gone.lookupId)
    const again = S().hideAgain(gone.eventId)
    read.landsAfter(again)
    await read.reached
    S().startDeployMessage('placed meanwhile'); S().setDeployHeight(HEIGHT)
    const placing = S().deploy()
    await tick(20)
    read.release()
    expect(await again).toBeNull()
    await placing
    expect(S().deployError).toBeNull()
    const copy = S().mine.find((m) => m.text === 'gone from here')!
    const placed = S().mine.find((m) => m.text === 'placed meanwhile')!
    expect(copy.eventId).not.toBe(gone.eventId)
    const inBag = await newestEntries(placed)
    expect(inBag.has(copy.eventId)).toBe(true)
    expect(inBag.has(placed.eventId)).toBe(true)
  })

  it('PLACE started while BROADCAST reads the bag waits for it: the bag ends with both', async () => {
    useCyberspace.setState({ live: false })
    const local = await hide('local first', HEIGHT)
    expect(local.published).toBe(false)
    useCyberspace.setState({ live: true })
    const read = holdRead(local.lookupId)
    const broadcasting = S().broadcast(local.lookupId)
    read.landsAfter(broadcasting)
    await read.reached
    S().startDeployMessage('placed meanwhile'); S().setDeployHeight(HEIGHT)
    const placing = S().deploy()
    await tick(20)
    read.release()
    expect(await broadcasting).toBe(true)
    await placing
    expect(S().deployError).toBeNull()
    const placed = S().mine.find((m) => m.text === 'placed meanwhile')!
    const inBag = await newestEntries(placed)
    expect(inBag.has(local.eventId)).toBe(true)
    expect(inBag.has(placed.eventId)).toBe(true)
  })

  it('BROADCAST and HIDE AGAIN do not start while a hide is working', async () => {
    const gone = await hide('gone from here', HEIGHT)
    markGone(gone.eventId)
    useShards.setState({ deployStatus: 'working' })
    const sentBefore = relay.events.length
    expect(await S().broadcast(gone.lookupId)).toBe(false)
    expect(S().broadcastError).toBe(BROADCAST_BUSY)
    expect(await S().hideAgain(gone.eventId)).toMatch(/still going out/)
    expect(relay.events.length).toBe(sentBefore)
  })

  it('HIDE AGAIN of a key item: one ITEMS row for its keypair, holding the copy where it now stands', async () => {
    S().startDeployKey(lock); S().setDeployHeight(HEIGHT)
    await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
    const k = S().mine.find((m) => m.type === 'key')!
    const ofKey = () => Object.values(useInventory.getState().items).filter((it) => it.key?.itemPubkey === lock.itemPubkey)
    expect(ofKey().map((it) => it.id)).toEqual([k.inner.id])
    markGone(k.eventId)
    expect(await S().hideAgain(k.eventId)).toBeNull()
    const copy = S().mine.find((m) => m.type === 'key')!
    expect(copy.eventId).not.toBe(k.eventId)
    expect(ofKey().map((it) => it.id)).toEqual([copy.inner.id])
    expect(ofKey()[0].place?.bagId).toBe(copy.bagId)
  })

  /** A large shard lined up to PLACE while HIDE AGAIN holds the bag lock, its read held. */
  async function placeWhileHideAgainReads(): Promise<{ again: Promise<string | null>; placing: Promise<void>; release: () => void }> {
    const gone = await hide('gone from here', HEIGHT)
    markGone(gone.eventId)
    const read = holdRead(gone.lookupId)
    const again = S().hideAgain(gone.eventId)
    await read.reached
    const shard = big('large')
    useWorkshop.setState({ shards: [shard], currentId: shard.id })
    S().startDeployShard(shard.id); S().setDeployHeight(7)
    const placing = S().deploy()
    await tick(20)
    expect(S().deployNote).toBe('Waiting for a bag already going out')
    return { again, placing, release: read.release }
  }

  it('PLACE waiting on the lock when the identity switches: nothing is signed or sent after the switch (review of #599)', async () => {
    const { again, placing, release } = await placeWhileHideAgainReads()
    const sentAtSwitch = relay.events.length
    signIn(Y)
    release()
    expect(await again).toMatch(/switched identity/)
    await placing
    expect(S().deployError).toMatch(/switched identity/)
    expect(relay.events.slice(sentAtSwitch)).toEqual([])
  })

  it('CANCEL works while PLACE waits on the lock, and the cancelled PLACE sends nothing (review of #599)', async () => {
    const { again, placing, release } = await placeWhileHideAgainReads()
    S().cancelDeploy()
    expect(S().deployStatus).toBe('idle')
    expect(S().pending).toBeNull()
    release()
    expect(await again).toBeNull()
    await placing
    expect(S().deployError).toBeNull()
    expect(relay.events.filter((e) => e.kind === OBJECT_KIND)).toEqual([])
    expect(S().mine.some((m) => m.type === 'shard')).toBe(false)
  })

  it('HIDE AGAIN of a key item when the identity switches as its bag goes out: the hider\'s ITEMS still follow the copy (review of #599)', async () => {
    S().startDeployKey(lock); S().setDeployHeight(HEIGHT)
    await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
    const k = S().mine.find((m) => m.type === 'key')!
    markGone(k.eventId)
    const holdAgain = vi.fn(async () => undefined)
    useInventory.setState({ holdAgain })
    relay.onPublish = async (e) => { if (e.kind === HIDDEN_KIND) signIn(Y); return false }
    expect(await S().hideAgain(k.eventId)).toBeNull()
    const copy = stored(home).find((m) => m.type === 'key')!
    expect(copy.eventId).not.toBe(k.eventId)
    expect(holdAgain).toHaveBeenCalledWith(copy.inner, k.key, expect.objectContaining({ bagId: copy.bagId }), home)
  })
})
