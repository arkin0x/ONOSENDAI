/**
 * doorFailures.test.ts: what a door's author is left with when a signer refuses or
 * a relay fails (review of #545 to #547; §3.7.5, §3.7.7, §3.7.8). Nothing goes out
 * until everything is signed; deletion comes last; a read that heard nothing, or
 * could not read everything, refuses rather than rewriting by what it has; a second
 * device does not write back a door the first has replaced. The relay is a mock
 * that keeps what is published, can refuse, and can stay silent. No network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => { mem.clear() } }
}
type Ev = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }
const relay = vi.hoisted(() => ({ events: [] as Ev[], refuse: (_e: Ev) => false as boolean, blind: (_d: string) => false as boolean, silent: (_d: string) => false as boolean as boolean, partial: false }))
vi.mock('../../lib/relay', () => {
  const dOf = (e: Ev): string => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
  const live = (e: Ev): boolean => !relay.events.some((x) => x.kind === 5 && x.created_at >= e.created_at && x.tags.some((t) => t[0] === 'a' && t[1] === `${e.kind}:${e.pubkey}:${dOf(e)}`))
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || (f['#d'].includes(dOf(e)) && !relay.blind(dOf(e)))) && live(e))
  return {
    publishMany: vi.fn(async (_r: string[], ev: Ev) => { if (relay.refuse(ev)) return { ok: false }; relay.events.push(ev); return { ok: true } }),
    query: vi.fn(answer), queryAny: vi.fn(async (_r: string[], f: never) => answer(f)),
    queryEach: vi.fn(async (f: { '#d'?: string[] }) => (f['#d']?.some((d) => relay.silent(d)) ? [{ url: 'wss://relay.test', outcome: 'silent', events: [] }] : [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f as never) }, ...(relay.partial ? [{ url: 'wss://down.test', outcome: 'unreachable', events: [] }] : [])])),
    relaySet: () => ['wss://relay.test'],
  }
})
import { newShard, type ShardModel } from 'sno-core/shards'
import { forgeKey } from '../../lib/chests'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { HIDDEN_KIND, OBJECT_KIND, bagEntries, unbag, type KeyItem, type Hidden } from '../../lib/hidden'
import { roomKey, roomLookupId, roomOf } from '../../lib/doors'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import type { Position } from '../../lib/space'
import { useStash } from '../../hud/stash'
import { doorSecret, resetDoorSecrets, keepDoorSecret } from '../doorSecrets'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { useWorkshop } from '../useWorkshop'
import { resetOpenedChests } from '../useOpenedChests'
import { behindDoor, ownBagIn, positionOf, regionOf, useShards, type MyDeployment } from '../useShards'
import { enterRoom, openRoom, doorAsFound } from '../rooms'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const HEIGHT = 4
let lock: KeyItem
const lockOf = (k: KeyItem = lock) => ({ pubkey: k.itemPubkey, label: k.name })
const doors = (): MyDeployment[] => S().mine.filter((d) => d.chest?.door !== undefined)
const goTo = (p: Position): void => { useCyberspace.setState({ cursor: p, position: p, anchor: p }) }
const dOf = (e: Ev): string => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
const newestBag = (d: string): NostrEvent | undefined => relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === d).sort((a, b) => b.created_at - a.created_at)[0] as NostrEvent | undefined
const retracted = (d: string): boolean => relay.events.some((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'a' && t[1] === `${HIDDEN_KIND}:${me()}:${d}`))

async function sealDoor(name = 'North Door', h = HEIGHT, key = lock): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startPlaceDoor(); S().setDeployHeight(h); S().placeChest()
  await S().sealPlacedChest({ name, lock: lockOf(key), requires: `the ${key.name}`, contents: [] })
  expect(S().deployError).toBeNull()
  return S().mine.find((d) => !before.has(d.eventId))!
}
async function hide(text: string, h: number): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startDeployMessage(text); S().setDeployHeight(h)
  await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
  return S().mine.find((d) => !before.has(d.eventId))!
}
function big(name: string, seed: number): ShardModel {
  return { ...newShard(name), unit: 1, vertices: Array.from({ length: 3000 }, (_, i) => ({ p: [(i + seed) % 16, Math.floor(i / 16) % 16, Math.floor(i / 256)] as [number, number, number], c: [1, 1, 1] as [number, number, number] })), faces: [[0, 1, 2]] }
}
async function hideBig(name: string, seed: number, h: number): Promise<MyDeployment> {
  const shard = big(name, seed)
  useWorkshop.setState({ shards: [...useWorkshop.getState().shards, shard], currentId: shard.id })
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startDeployShard(shard.id); S().setDeployHeight(h)
  await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
  return S().mine.find((d) => !before.has(d.eventId))!
}
async function chestHere(name = 'Old Room', text = 'inside the chest', key = lock): Promise<MyDeployment> {
  S().startPlaceChest(); S().setDeployHeight(HEIGHT); S().placeChest()
  await S().sealPlacedChest({ name, lock: lockOf(key), requires: 'x', contents: [{ kind: 'message', text }] })
  expect(S().deployError).toBeNull()
  return S().mine.find((m) => m.chest?.name === name)!
}
function failSigningWhen(p: (t: { kind: number; tags?: string[][] }) => boolean): () => void {
  const real = C().signEvent
  useCyberspace.setState({ signEvent: (async (t: { kind: number; tags?: string[][] }, ms?: number) => { if (p(t)) throw new Error('signer refused'); return (real as (a: unknown, b?: number) => Promise<NostrEvent>)(t, ms) }) as never })
  return () => useCyberspace.setState({ signEvent: real })
}

beforeEach(() => {
  relay.events = []; relay.refuse = () => false; relay.blind = () => false; relay.silent = () => false; relay.partial = false
  lock = forgeKey('Silver Key')
  localStorage.removeItem('onosendai:door-secrets'); localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets(); resetOpenedChests()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: null, deployInto: null, deployDoorHeight: null, placedLast: null })
  useBuilder.getState().exit(); useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})


const read = async (d: MyDeployment, secret: string): Promise<Array<string | number | undefined>> => {
  const { forgetReference } = await import('../../lib/references')
  for (const r of S().mine) if (r.ref) forgetReference(r.ref)
  const o = await openRoom(doorAsFound(d.eventId)!, secret)
  return o.items.map((h) => h.text ?? h.shard?.vertices.length).sort()
}
const sent = (): number => relay.events.length

describe('a new lock when something fails (§3.7.7)', () => {
  it('the signer refuses a door: nothing goes out, the old room stands, the old key opens it', async () => {
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    const secret = doorSecret(me(), d.eventId)!
    const before = sent()
    const restore = failSigningWhen((t) => t.kind === 3341)
    const why = await S().resealDoor(d.eventId, { name: 'North Door', requires: 'new', lock: lockOf(forgeKey('New')) })
    restore()
    expect(why).toMatch(/signer refused/)
    expect(sent()).toBe(before)
    expect(retracted(inside.lookupId)).toBe(false)
    expect(S().mine.find((m) => m.text === 'behind it')!.lookupId).toBe(inside.lookupId)
    expect(doors()[0].eventId).toBe(d.eventId)
    expect(await read(d, secret)).toEqual(['behind it'])
  })

  it('the signer refuses the door’s bag, signed last: nothing goes out either', async () => {
    const d = await sealDoor()
    await hide('behind it', HEIGHT)
    const before = sent()
    const restore = failSigningWhen((t) => t.kind === HIDDEN_KIND && !!t.tags?.some((x: string[]) => x[0] === 'd' && x[1] === d.lookupId))
    expect(await S().resealDoor(d.eventId, { name: 'North Door', requires: 'new', lock: lockOf(forgeKey('New')) })).toMatch(/signer refused/)
    restore()
    expect(sent()).toBe(before)
    expect(doors()[0].eventId).toBe(d.eventId)
  })

  it('no relay takes the door’s bag: said so; the old room is not retracted and still opens; the new bag is taken back', async () => {
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    const secret = doorSecret(me(), d.eventId)!
    relay.refuse = (e) => e.kind === HIDDEN_KIND && dOf(e) === d.lookupId
    const why = await S().resealDoor(d.eventId, { name: 'North Door', requires: 'new', lock: lockOf(forgeKey('New')) })
    relay.refuse = () => false
    expect(why).toBe('No relay took the door. Nothing has changed.')
    expect(retracted(inside.lookupId)).toBe(false)
    expect(doors()[0].eventId).toBe(d.eventId)
    expect(S().mine.find((m) => m.text === 'behind it')!.lookupId).toBe(inside.lookupId)
    expect(await read(d, secret)).toEqual(['behind it'])
    const fresh = relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) !== d.lookupId && dOf(e) !== inside.lookupId).map(dOf)
    expect(fresh.length).toBeGreaterThan(0)
    for (const lookup of fresh) expect(retracted(lookup)).toBe(true)
  })

  it('deletion comes last: the old bag’s retraction goes out after the new bag and the door', async () => {
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    const from = sent()
    expect(await S().resealDoor(d.eventId, { name: 'North Door', requires: 'new', lock: lockOf(forgeKey('New')) })).toBeNull()
    const order = relay.events.slice(from).map((e) => (e.kind === 5 ? 'retract' : dOf(e) === d.lookupId ? 'door' : 'room'))
    expect(order).toEqual(['room', 'door', 'retract'])
    expect(retracted(inside.lookupId)).toBe(true)
  })
})

describe('a large shard when a move fails', () => {
  const NEW = () => ({ name: 'North Door', requires: 'new', lock: lockOf(forgeKey('New')) })

  it('the signer refuses the second shard: no relay heard anything, both still open from the old room', async () => {
    const d = await sealDoor()
    await hideBig('a', 1, HEIGHT)
    await hideBig('b', 2, HEIGHT)
    const secret = doorSecret(me(), d.eventId)!
    const before = sent()
    let objects = 0
    const restore = failSigningWhen((t) => t.kind === OBJECT_KIND && ++objects === 2)
    expect(await S().resealDoor(d.eventId, NEW())).toMatch(/signer refused/)
    restore()
    expect(sent()).toBe(before)
    expect((await read(d, secret)).length).toBe(2)
  })

  it('no relay takes the new bag: the old versions go back, both still open, and the words are true', async () => {
    const d = await sealDoor()
    await hideBig('a', 1, HEIGHT)
    await hideBig('b', 2, HEIGHT)
    const secret = doorSecret(me(), d.eventId)!
    const lookups = new Set(S().mine.filter((m) => m.room).map((m) => m.lookupId))
    relay.refuse = (e) => e.kind === HIDDEN_KIND
    expect(await S().resealDoor(d.eventId, NEW())).toMatch(/Nothing has moved/)
    relay.refuse = () => false
    expect((await read(doors()[0], secret)).length).toBe(2)
    expect(new Set(S().mine.filter((m) => m.room).map((m) => m.lookupId))).toEqual(lookups)
  })

  it('a later EDIT of a shard whose old version no relay took back still has it to put back', async () => {
    const d = await sealDoor()
    await hideBig('a', 1, HEIGHT)
    let objects = 0
    relay.refuse = (e) => e.kind === HIDDEN_KIND || (e.kind === OBJECT_KIND && ++objects > 1)
    expect(await S().resealDoor(d.eventId, NEW())).toMatch(/Nothing has moved/)
    relay.refuse = () => false
    expect(S().mine.find((m) => m.type === 'shard')?.putBack).toBeDefined()
  })

  it('SEAL when no relay takes the room: it stays where it was and opens from the place', async () => {
    const a = await hideBig('a', 1, HEIGHT)
    const d = await sealDoor()
    const place = await regionKeyOffThread(positionOf(d), HEIGHT, 20)
    relay.refuse = (e) => e.kind === HIDDEN_KIND && dOf(e) !== d.lookupId
    expect(await S().sealIntoRoom(d.eventId, [a.eventId])).toMatch(/Nothing has moved/)
    relay.refuse = () => false
    const r = S().mine.find((m) => m.type === 'shard')!
    expect(r.room).toBeUndefined()
    const { forgetReference } = await import('../../lib/references')
    forgetReference(r.ref!)
    const found = await unbag(newestBag(d.lookupId)!, place.key, (await import('../../lib/references')).resolveReference, undefined, HEIGHT)
    expect(found.some((h) => h.type === 'shard')).toBe(true)
  })

  it('SEAL when the signer refuses the source’s rewrite: nothing has gone out', async () => {
    const a = await hideBig('a', 1, HEIGHT)
    const d = await sealDoor()
    const before = sent()
    const restore = failSigningWhen((t) => t.kind === HIDDEN_KIND && !!t.tags?.some((x: string[]) => x[0] === 'd' && x[1] === d.lookupId))
    expect(await S().sealIntoRoom(d.eventId, [a.eventId])).toMatch(/signer refused/)
    restore()
    expect(sent()).toBe(before)
    expect(S().mine.find((m) => m.type === 'shard')?.room).toBeUndefined()
  })
})

describe('one secret to a room, CONVERT too (§3.7.5)', () => {
  it('a chest converted beside a door joins its room, and what it held stands behind both', async () => {
    const c = await chestHere()
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    const a = await sealDoor('Standing')
    await hide('already behind', HEIGHT)
    expect(await S().convertToDoor(c.eventId)).toBeNull()
    const b = doors().find((m) => m.chest?.name === 'Old Room')!
    expect(doorSecret(me(), b.eventId)).toBe(doorSecret(me(), a.eventId))
    expect(await read(b, doorSecret(me(), b.eventId)!)).toEqual(['already behind', 'inside the chest'])
  })

  it('two room-chests in one tile: one room with both inside', async () => {
    const c1 = await chestHere('One', 'first room')
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    await chestHere('Two', 'second room')
    expect(await S().convertToDoor(c1.eventId)).toBeNull()
    expect(await S().convertToDoor(S().mine.find((m) => m.chest?.name === 'Two')!.eventId)).toBeNull()
    const one = doors().find((m) => m.chest?.name === 'One')!
    const two = doors().find((m) => m.chest?.name === 'Two')!
    expect(doorSecret(me(), two.eventId)).toBe(doorSecret(me(), one.eventId))
    expect(await read(one, doorSecret(me(), one.eventId)!)).toEqual(['first room', 'second room'])
  })

  it('beside a door whose secret is not known here: refused, the chest stays', async () => {
    const c = await chestHere()
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    const a = await sealDoor('Standing')
    localStorage.removeItem('onosendai:door-secrets'); resetDoorSecrets()
    expect(await S().convertToDoor(c.eventId)).toMatch(/Open it first/)
    expect(doors().map((m) => m.eventId)).toEqual([a.eventId])
    expect(S().mine.some((m) => m.eventId === c.eventId)).toBe(true)
  })

  it('failing after a room already stood there does not take that room back', async () => {
    const c = await chestHere()
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    const a = await sealDoor('Standing')
    const inside = await hide('already behind', HEIGHT)
    const restore = failSigningWhen((t) => t.kind === 3341)
    expect(await S().convertToDoor(c.eventId)).toMatch(/signer refused/)
    restore()
    expect(retracted(inside.lookupId)).toBe(false)
    // That room as it was: what stood there stands, and what was copied in has gone back out.
    const held = await read(a, doorSecret(me(), a.eventId)!)
    expect(held).toContain('already behind')
    expect(held).not.toContain('inside the chest')
    expect(S().mine.some((m) => m.eventId === c.eventId)).toBe(true)
  })
})

describe('a read that cannot be trusted refuses (§3.7.8)', () => {
  it('no relay answers: DELETE with the switch off refuses; nothing is retracted, the door stands', async () => {
    const d = await sealDoor()
    const inside = await hide('from the other device', HEIGHT)
    useShards.setState({ mine: S().mine.filter((m) => m.eventId !== inside.eventId) })
    relay.silent = (x) => x === inside.lookupId
    expect(await S().deleteDoor(d.eventId, false)).toMatch(/No relay answered/)
    relay.silent = () => false
    expect(retracted(inside.lookupId)).toBe(false)
    expect(doors()).toHaveLength(1)
    expect(await read(d, doorSecret(me(), d.eventId)!)).toEqual(['from the other device'])
  })

  it('relays answering: what the other device hid does reach the ordinary bag', async () => {
    const d = await sealDoor()
    const inside = await hide('from the other device', HEIGHT)
    useShards.setState({ mine: S().mine.filter((m) => m.eventId !== inside.eventId) })
    expect(await S().deleteDoor(d.eventId, false)).toBeNull()
    expect(S().mine.find((m) => m.text === 'from the other device')?.room).toBeUndefined()
    const place = await regionKeyOffThread(positionOf(d), HEIGHT, 20)
    expect((await bagEntries(newestBag(place.lookupId)!, place.key) as NostrEvent[]).some((e) => e.content?.includes?.('from the other device'))).toBe(true)
  })

  it('a reference that cannot be fetched: DELETE refuses with a count; the room is not retracted', async () => {
    const d = await sealDoor()
    const a = await hideBig('a', 1, HEIGHT)
    const m = await hide('readable', HEIGHT)
    useShards.setState({ mine: S().mine.filter((r) => r.eventId !== a.eventId && r.eventId !== m.eventId) })
    const { forgetReference } = await import('../../lib/references')
    forgetReference(a.ref!)
    const stash = relay.events.filter((e) => e.kind === OBJECT_KIND)
    relay.events = relay.events.filter((e) => e.kind !== OBJECT_KIND)
    expect(await S().deleteDoor(d.eventId, false)).toMatch(/^1 behind this door could not be read/)
    relay.events.push(...stash)
    expect(retracted(m.lookupId)).toBe(false)
    expect(doors()).toHaveLength(1)
  })

  it('so does a new lock', async () => {
    const d = await sealDoor()
    const inside = await hide('from the other device', HEIGHT)
    useShards.setState({ mine: S().mine.filter((m) => m.eventId !== inside.eventId) })
    relay.silent = (x) => x === inside.lookupId
    expect(await S().resealDoor(d.eventId, { name: 'North Door', requires: 'new', lock: lockOf(forgeKey('New')) })).toMatch(/No relay answered/)
    relay.silent = () => false
    expect(retracted(inside.lookupId)).toBe(false)
  })
})

describe('a second device after the first rotated or renamed', () => {
  async function asSecondDeviceAfter(edit: (d: MyDeployment) => Promise<unknown>, { scan = true, also }: { scan?: boolean; also?: () => Promise<unknown> } = {}): Promise<{ d: MyDeployment; now: MyDeployment; secret: string; nowSecret: string; found: Hidden }> {
    const d = await sealDoor()
    await hide('behind it', HEIGHT)
    await also?.()
    const b = { mine: S().mine.map((m) => ({ ...m })), secret: doorSecret(me(), d.eventId)! }
    // The bag A writes is a later second than anything B has.
    await new Promise((r) => setTimeout(r, 1100))
    await edit(d)
    const now = doors()[0]
    const nowSecret = doorSecret(me(), now.eventId)!
    const bag = newestBag(now.lookupId)!
    const found: Hidden = { eventId: now.eventId, inner: now.inner, keyHex: now.keyHex, bagId: now.bagId, bagAt: bag.created_at, lookupId: now.lookupId, author: me(), at: positionOf(now), plane: now.plane, height: now.height, createdAt: now.createdAt, type: 'chest', chest: now.chest }
    useShards.setState({ mine: b.mine, discovered: {} })
    localStorage.removeItem('onosendai:door-secrets'); resetDoorSecrets(); keepDoorSecret(me(), d.eventId, b.secret)
    if (scan) S().addDiscovered([found])
    return { d, now, secret: b.secret, nowSecret, found }
  }
  const ROTATE = (d: MyDeployment) => S().resealDoor(d.eventId, { name: 'North Door', requires: 'n', lock: lockOf(forgeKey('New')) })

  it('a door the bag read just now no longer holds goes; the new one is the only one', async () => {
    const { now } = await asSecondDeviceAfter(ROTATE)
    expect(doors().map((m) => m.eventId)).toEqual([now.eventId])
  }, 30000)

  it('nothing is sealed into a room whose door is not known here: refused, in words', async () => {
    const { now } = await asSecondDeviceAfter(ROTATE)
    S().startDeployMessage('placed on B'); S().setDeployHeight(HEIGHT)
    await S().deploy()
    expect(S().deployError).toMatch(/OPEN it first/)
    expect(S().mine.some((m) => m.text === 'placed on B')).toBe(false)
    S().cancelDeploy()
    expect(doors().map((m) => m.eventId)).toEqual([now.eventId])
  }, 30000)

  it('left out with the ×, it goes in the ordinary bag, and the old door does not come back', async () => {
    const { d, now } = await asSecondDeviceAfter(ROTATE)
    S().startDeployMessage('ordinary, left out'); S().setDeployHeight(HEIGHT)
    S().setDeployLeaveOut(roomOf(positionOf(d), d.plane, HEIGHT))
    await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
    const ids = (await bagEntries(newestBag(d.lookupId)!, hexToBytes(d.keyHex)) as NostrEvent[]).map((e) => e.id)
    expect(ids).toContain(now.eventId)
    expect(ids).not.toContain(d.eventId)
  }, 30000)

  it('renamed: DELETE on the real door leaves nothing of the old', async () => {
    const { d, now, secret } = await asSecondDeviceAfter((x) => S().resealDoor(x.eventId, { name: 'Renamed', requires: 'n', lock: lockOf() }))
    keepDoorSecret(me(), now.eventId, secret)
    expect(await S().deleteDoor(now.eventId, false)).toBeNull()
    expect(doors()).toEqual([])
    const place = await regionKeyOffThread(positionOf(d), HEIGHT, 20)
    expect((await bagEntries(newestBag(place.lookupId)!, place.key) as NostrEvent[]).map((e) => e.id)).not.toContain(d.eventId)
  }, 30000)

  const inOrdinaryBag = async (d: MyDeployment): Promise<string[]> => {
    const place = await regionKeyOffThread(positionOf(d), HEIGHT, 20)
    const bag = newestBag(place.lookupId)
    return bag ? (await bagEntries(bag, place.key) as NostrEvent[]).map((e) => e.content) : []
  }
  const RENAME = (x: MyDeployment) => S().resealDoor(x.eventId, { name: 'Renamed', requires: 'n', lock: lockOf() })

  it('renamed there; scanned, OPENed and DELETEd here: the card counts what is behind it, and it goes only as asked', async () => {
    const { now, secret, found } = await asSecondDeviceAfter(RENAME)
    await enterRoom(found, secret)
    const row = doors().find((m) => m.eventId === now.eventId)!
    const inside = S().mine.find((m) => m.text === 'behind it')!
    expect(inside.room).toEqual({ doorId: now.eventId })
    expect(behindDoor(S().mine, row)).toHaveLength(1)
    expect(await S().deleteDoor(now.eventId, true)).toBeNull()
    expect(retracted(inside.lookupId)).toBe(true)
    expect(S().mine.some((m) => m.text === 'behind it')).toBe(false)
    expect((await inOrdinaryBag(now)).join()).not.toContain('behind it')
  }, 30000)

  it('rotated there; scanned, OPENed and DELETEd here: the row follows the new room, and the same', async () => {
    const { now, nowSecret, found } = await asSecondDeviceAfter(ROTATE)
    await enterRoom(found, nowSecret)
    const row = doors().find((m) => m.eventId === now.eventId)!
    const inside = S().mine.find((m) => m.text === 'behind it')!
    expect(inside.room).toEqual({ doorId: now.eventId })
    expect(inside.lookupId).toBe(roomLookupId(roomKey((await regionKeyOffThread(positionOf(row), HEIGHT, 20)).key, hexToBytes(nowSecret))))
    expect(inside.published).toBe(true)
    expect(behindDoor(S().mine, row)).toHaveLength(1)
    expect(await S().deleteDoor(now.eventId, true)).toBeNull()
    expect(retracted(inside.lookupId)).toBe(true)
    expect(S().mine.some((m) => m.text === 'behind it')).toBe(false)
    expect((await inOrdinaryBag(now)).join()).not.toContain('behind it')
  }, 30000)

  it('rotated there: a large shard behind it has a new id and one row here, not two', async () => {
    const { nowSecret, found } = await asSecondDeviceAfter(ROTATE, { also: () => hideBig('Statue', 3, HEIGHT) })
    await enterRoom(found, nowSecret)
    expect(S().mine.filter((m) => m.ref).length).toBe(1)
  }, 30000)

  it('with no scan first: the write itself leaves out a door the bag no longer holds', async () => {
    const { d, now } = await asSecondDeviceAfter(ROTATE, { scan: false })
    expect(doors().map((m) => m.eventId)).toContain(d.eventId)
    S().startDeployMessage('left out, no scan'); S().setDeployHeight(HEIGHT)
    S().setDeployLeaveOut(roomOf(positionOf(d), d.plane, HEIGHT))
    await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
    const ids = (await bagEntries(newestBag(d.lookupId)!, hexToBytes(d.keyHex)) as NostrEvent[]).map((e) => e.id)
    expect(ids).toContain(now.eventId)
    expect(ids).not.toContain(d.eventId)
    expect(doors().map((m) => m.eventId)).not.toContain(d.eventId)
  }, 30000)

  it('deleted there, with its bag retracted: this device does not write it back', async () => {
    const d = await sealDoor()
    await hide('behind it', HEIGHT)
    const b = { mine: S().mine.map((m) => ({ ...m })), secret: doorSecret(me(), d.eventId)! }
    await new Promise((res) => setTimeout(res, 1100))
    expect(await S().deleteDoor(d.eventId, true)).toBeNull()
    expect(retracted(d.lookupId)).toBe(true)
    useShards.setState({ mine: b.mine, discovered: {} })
    localStorage.removeItem('onosendai:door-secrets'); resetDoorSecrets(); keepDoorSecret(me(), d.eventId, b.secret)
    S().startDeployMessage('ordinary'); S().setDeployHeight(HEIGHT)
    S().setDeployLeaveOut(roomOf(positionOf(d), d.plane, HEIGHT))
    await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
    const ids = (await bagEntries(newestBag(d.lookupId)!, hexToBytes(d.keyHex)) as NostrEvent[]).map((e) => e.id)
    expect(ids).not.toContain(d.eventId)
    expect(doors()).toEqual([])
  }, 30000)

  it('a retraction is newer than the bag it takes down, however fast the writes before it came', async () => {
    const d = await sealDoor()
    for (const text of ['one', 'two', 'three']) {
      S().startDeployMessage(text); S().setDeployHeight(HEIGHT)
      S().setDeployLeaveOut(roomOf(positionOf(d), d.plane, HEIGHT))
      await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
    }
    for (const r of S().mine.filter((m) => m.lookupId === d.lookupId && !m.chest)) await S().deleteInstance(r.eventId)
    expect(await S().deleteDoor(d.eventId, true)).toBeNull()
    const newest = Math.max(...relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === d.lookupId).map((e) => e.created_at))
    const deletion = relay.events.filter((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'a' && t[1] === `${HIDDEN_KIND}:${me()}:${d.lookupId}`)).map((e) => e.created_at)
    expect(Math.max(...deletion)).toBeGreaterThan(newest)
  }, 30000)

  it('a relay’s stale copy, older than the door, takes nothing away', async () => {
    const d = await sealDoor()
    S().addDiscovered([{ eventId: 'e'.repeat(64), inner: { id: 'e'.repeat(64), pubkey: me(), created_at: d.createdAt - 100, kind: 1, tags: [], content: 'old' }, keyHex: d.keyHex, bagId: 'f'.repeat(64), bagAt: d.createdAt - 100, lookupId: d.lookupId, author: me(), at: positionOf(d), plane: d.plane, height: d.height, createdAt: d.createdAt - 100, type: 'message', text: 'old' } as Hidden])
    expect(doors().map((m) => m.eventId)).toEqual([d.eventId])
  })
})

describe('a door this device has not seen stands in the room (§3.7.5)', () => {
  async function unseen(): Promise<void> {
    await sealDoor('Elsewhere')
    await hide('behind the first', HEIGHT)
    useShards.setState({ mine: [], discovered: {} })
    localStorage.removeItem('onosendai:door-secrets'); resetDoorSecrets()
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
  }
  const secondDoor = async (): Promise<void> => {
    S().startPlaceDoor(); S().setDeployHeight(HEIGHT); S().placeChest()
    await S().sealPlacedChest({ name: 'Here', lock: lockOf(), requires: 'x', contents: [] })
  }

  it('a second door is refused in words: no second secret, and nothing written', async () => {
    await unseen()
    const before = relay.events.length
    await secondDoor()
    expect(S().deployError).toMatch(/Open it first/)
    expect(doors()).toEqual([])
    expect(relay.events.length).toBe(before)
    S().cancelDeploy()
  }, 30000)

  it('CONVERT beside it too: refused, the chest stays', async () => {
    await unseen()
    const c = await chestHere()
    expect(await S().convertToDoor(c.eventId)).toMatch(/Open it first/)
    expect(S().mine.some((m) => m.eventId === c.eventId && m.chest?.door === undefined)).toBe(true)
  }, 30000)

  it('the limit, as it stands: LOCAL reads no relay, so it cannot know', async () => {
    await unseen()
    useCyberspace.setState({ live: false })
    await secondDoor()
    expect(S().deployError).toBeNull()
    expect(doors()).toHaveLength(1)
  }, 30000)
})

describe('sending a door and its room', () => {
  it('BROADCAST sends the room first, and fails if the room fails', async () => {
    useCyberspace.setState({ live: false })
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    useCyberspace.setState({ live: true })
    relay.refuse = (e) => e.kind === HIDDEN_KIND && dOf(e) === inside.lookupId
    expect(await S().broadcast(d.lookupId)).toBe(false)
    expect(relay.events.some((e) => e.kind === HIDDEN_KIND && dOf(e) === d.lookupId)).toBe(false)
    relay.refuse = () => false
    const from = sent()
    expect(await S().broadcast(d.lookupId)).toBe(true)
    expect(relay.events.slice(from).filter((e) => e.kind === HIDDEN_KIND).map((e) => (dOf(e) === d.lookupId ? 'door' : 'room'))).toEqual(['room', 'door'])
  })

  it('a LIVE door with a LOCAL room: DELETE still reaches the relays', async () => {
    useCyberspace.setState({ live: false })
    const d = await sealDoor()
    await hide('behind it', HEIGHT)
    useCyberspace.setState({ live: true })
    // The door's bag alone goes out, as if the room's failed long ago.
    useShards.setState({ mine: S().mine.map((m) => (m.lookupId === d.lookupId ? { ...m, published: true } : m)) })
    expect(await S().deleteDoor(d.eventId, false)).toBeNull()
    const place = await regionKeyOffThread(positionOf(d), HEIGHT, 20)
    const held = await bagEntries(newestBag(place.lookupId)!, place.key) as NostrEvent[]
    expect(held.map((e) => e.id)).not.toContain(d.eventId)
    expect(held.some((e) => e.content === 'behind it')).toBe(true)
  })
})

describe('a read of a room when not everything is known', () => {
  it('a thing deleted here that a relay still holds counts as read: the door can still go, and the thing stays gone', async () => {
    const d = await sealDoor()
    const gone = await hide('stays on the relay', HEIGHT)
    await hide('other', HEIGHT)
    relay.refuse = (e) => e.kind === HIDDEN_KIND && dOf(e) === gone.lookupId
    await S().deleteInstance(gone.eventId)
    relay.refuse = () => false
    expect(await S().deleteDoor(d.eventId, false)).toBeNull()
    const place = await regionKeyOffThread(positionOf(d), HEIGHT, 20)
    const out = (await bagEntries(newestBag(place.lookupId)!, place.key) as NostrEvent[]).map((e) => e.content).join()
    expect(out).toContain('other')
    expect(out).not.toContain('stays on the relay')
  }, 30000)

  it('one relay of two silent: DELETE and a new lock refuse; nothing is retracted', async () => {
    const d = await sealDoor()
    const inside = await hide('behind it', HEIGHT)
    relay.partial = true
    expect(await S().deleteDoor(d.eventId, false)).toMatch(/did not answer/)
    expect(await S().resealDoor(d.eventId, { name: 'North Door', requires: 'n', lock: lockOf(forgeKey('New')) })).toMatch(/did not answer/)
    relay.partial = false
    expect(retracted(inside.lookupId)).toBe(false)
    expect(doors().map((m) => m.eventId)).toEqual([d.eventId])
    expect(await read(d, doorSecret(me(), d.eventId)!)).toContain('behind it')
  }, 30000)
})

describe('after a placement in a room, the next left out of it', () => {
  it('starts from the place’s settings: the ordinary bag keeps its H', async () => {
    const d = await sealDoor()
    S().startDeployMessage('behind it'); S().setDeployHeight(HEIGHT)
    await S().deploy(); expect(S().deployError).toBeNull()
    expect(S().pending).not.toBeNull()
    expect(S().deployBag.heightTag).toBe(true)
    S().setDeployLeaveOut(roomOf(positionOf(d), d.plane, HEIGHT))
    goTo({ ...CURSOR, x: CURSOR.x + 1n })
    await S().deploy(); expect(S().deployError).toBeNull(); S().cancelDeploy()
    expect(newestBag(d.lookupId)!.tags.some((t) => t[0] === 'H')).toBe(true)
  }, 30000)
})

describe('small things', () => {
  it('a door gone from two: the one that stands knows the secret this device knew', async () => {
    const a = await sealDoor('North Door')
    goTo({ ...CURSOR, x: CURSOR.x + 3n })
    const b = await sealDoor('East Door')
    const secret = doorSecret(me(), a.eventId)!
    localStorage.setItem('onosendai:door-secrets', JSON.stringify({ [me()]: { [a.eventId]: secret } })); resetDoorSecrets()
    expect(await S().deleteDoor(a.eventId, false)).toBeNull()
    expect(doorSecret(me(), b.eventId)).toBe(secret)
  })

  it('a room’s rows are not the place’s bag settings', async () => {
    const d = await sealDoor()
    const before = ownBagIn(S().mine, regionOf(positionOf(d), d.plane, HEIGHT))!
    expect(before.count).toBe(1)
    await hide('behind it', HEIGHT)
    const after = ownBagIn(S().mine, regionOf(positionOf(d), d.plane, HEIGHT))!
    expect(after.count).toBe(1)
    expect(after.settings.heightTag).toBe(true)
  })
})
