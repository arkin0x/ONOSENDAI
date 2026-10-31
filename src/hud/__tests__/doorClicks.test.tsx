/**
 * doorClicks.test.tsx: a door by tapping its real buttons (elementRoot.ts).
 *
 * ADD on a door (chest and door design, 4.8): BUILD with the cursor in its red
 * cube; what is placed next starts at the door's height, the chip names the
 * door, and HIDE seals it behind the door. The chip's X leaves it out.
 *
 * A door found inside a chest (DECK-0004 §3.7.1): "a reader that finds a door
 * inside a chest MUST NOT open its room", whichever list or card it is opened
 * from. Its room bag stands on the mock relay, so a door that did open it
 * would find it. No network.
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
// Timers and listeners only: nothing here draws to a real window.
;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }

const relay = vi.hoisted(() => ({ events: [] as Array<{ kind: number; pubkey: string; tags: string[][] }>, asked: [] as string[] }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => {
    relay.asked.push(...(f['#d'] ?? []))
    return relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  }
  return {
    publishMany: vi.fn(async (_r: string[], ev: (typeof relay.events)[number]) => { relay.events.push(ev); return { ok: true } }),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async () => []),
    relaySet: () => ['wss://relay.test'],
  }
})
// The turning model draws to a canvas; the bar's cover measures a real box.
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
vi.mock('../../hooks/useCover', () => ({ useCover: () => () => undefined }))
vi.mock('../ui/Switch', () => ({ Field: () => null, Switch: () => null }))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { bytesToHex, type NostrEvent } from '../../lib/events'
import { forgeKey, readContents, sealEntries } from '../../lib/chests'
import { HIDDEN_KIND, bagTemplate, chestInnerTemplate, chestItemOf, messageInnerTemplate, rumorOf, type BagEntry, type Hidden } from '../../lib/hidden'
import { ROOM_BAG_SETTINGS, inRoom, newDoorSecret, roomEntries, roomKey, roomLookupId } from '../../lib/doors'
import { regionKeyOffThread } from '../../lib/regionKeyOffThread'
import type { Position } from '../../lib/space'
import { mount, settled } from '../../test/elementRoot'
import { doorSecret, resetDoorSecrets } from '../../store/doorSecrets'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { resetOpenedChests } from '../../store/useOpenedChests'
import { positionOf, useShards, type MyDeployment } from '../../store/useShards'
import { enterRoom } from '../../store/rooms'
import { DeployBar } from '../DeployBar'
import { ChestContents } from '../ItemRows'
import { SecretModal } from '../SecretModal'
import { useStash } from '../stash'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const HEIGHT = 4
const T = 1_800_000_000

beforeEach(() => {
  relay.events = []
  relay.asked = []
  localStorage.removeItem('onosendai:door-secrets')
  localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets()
  resetOpenedChests()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: null, deployInto: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

/** A door of yours, sealed as SEAL A DOOR does, BUILD then left, so ADD is what brings it back. */
async function sealedDoor(): Promise<MyDeployment> {
  const lock = forgeKey('Silver Key')
  S().startPlaceDoor()
  S().setDeployHeight(HEIGHT)
  S().placeChest()
  await S().sealPlacedChest({ name: 'North Door', lock: { pubkey: lock.itemPubkey, label: 'Silver Key' }, requires: 'the Silver Key', contents: [] })
  expect(S().deployError).toBeNull()
  useBuilder.getState().exit()
  useShards.setState({ deployInto: null })
  return S().mine.find((d) => d.chest?.door !== undefined)!
}

describe('ADD on a door, by its buttons (4.8)', () => {
  it('BUILD in its red cube; the next placement starts at its height, the chip names it, HIDE seals it behind it', async () => {
    const door = await sealedDoor()
    expect(useBuilder.getState().active).toBe(false)
    // Away from it, so ADD is what brings the cursor back.
    const away: Position = { ...CURSOR, x: CURSOR.x + (1n << 20n) }
    useCyberspace.setState({ cursor: away, anchor: away })
    useShards.setState({ selectedSecret: door.eventId })
    const card = await mount(<SecretModal />)
    await card.press(/^ADD$/)
    expect(S().selectedSecret).toBeNull()
    expect(useBuilder.getState().active).toBe(true)
    expect(S().deployInto).toBe(HEIGHT)
    expect(inRoom(positionOf(door), HEIGHT, C().cursor)).toBe(true)
    await card.unmount()

    S().startDeployMessage('behind it')
    S().setDeployHeight(HEIGHT + 2)
    const bar = await mount(<DeployBar />)
    expect(S().deployHeight).toBe(HEIGHT)
    expect(bar.says('North Door')).toBe(true)
    await bar.press(/HIDE & PUBLISH|HIDE \(LOCAL\)/)
    await vi.waitFor(() => expect(S().mine.some((d) => d.text === 'behind it')).toBe(true))
    expect(S().mine.find((d) => d.text === 'behind it')?.room).toEqual({ doorId: door.eventId })
    await bar.unmount()
  })

  it('the chip goes with the height, and its X leaves one placement out', async () => {
    const door = await sealedDoor()
    S().startDeployMessage('left out')
    S().setDeployHeight(HEIGHT)
    const bar = await mount(<DeployBar />)
    expect(bar.says('North Door')).toBe(true)
    await bar.press('×')
    expect(bar.says('North Door')).toBe(false)
    await bar.press(/HIDE & PUBLISH|HIDE \(LOCAL\)/)
    await vi.waitFor(() => expect(S().mine.some((d) => d.text === 'left out')).toBe(true))
    expect(S().mine.find((d) => d.text === 'left out')?.room).toBeUndefined()
    expect(S().mine.find((d) => d.text === 'left out')?.lookupId).toBe(door.lookupId)
    await bar.unmount()
  })
})

describe('the chip while a door moves', () => {
  it('names the room it stays in, and offers no X: a door moving stays in the bag that holds it (R7)', async () => {
    await sealedDoor()
    S().startPlaceDoor()
    S().setDeployHeight(HEIGHT)
    S().setDeployDoorHeight(HEIGHT - 2)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Inner Door', lock: { pubkey: forgeKey('Brass Key').itemPubkey, label: 'Brass Key' }, requires: 'the Brass Key', contents: [] })
    expect(S().deployError).toBeNull()
    const inner = S().mine.find((d) => d.chest?.name === 'Inner Door')!
    useBuilder.getState().exit()
    S().startMoveChest(inner.eventId)
    const moving = await mount(<DeployBar />)
    expect(moving.says('North Door')).toBe(true)
    expect(moving.says('×')).toBe(false)
    await moving.unmount()
    S().cancelDeploy()
    // The same chip on anything else still has its X.
    S().startDeployMessage('not a door')
    S().setDeployHeight(HEIGHT)
    const other = await mount(<DeployBar />)
    expect(other.says('North Door')).toBe(true)
    expect(other.says('×')).toBe(true)
    await other.unmount()
  })
})

describe('CONVERT TO DOOR, by its button', () => {
  it('says what blocks it, on the card, and the chest stays', async () => {
    const lock = forgeKey('Silver Key')
    const far: Position = { ...CURSOR, x: CURSOR.x + (1n << 12n) }
    const outside = rumorOf(messageInnerTemplate('far away', far, C().anchorPlane as 0 | 1, T), me())
    S().startPlaceChest()
    S().setDeployHeight(HEIGHT)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Old Room', lock: { pubkey: lock.itemPubkey, label: 'Silver Key' }, requires: '', contents: [{ kind: 'sealed', entry: outside, label: 'x', type: 'message' }] })
    expect(S().deployError).toBeNull()
    const chest = S().mine.find((d) => d.chest?.name === 'Old Room')!
    useShards.setState({ selectedSecret: chest.eventId })
    const card = await mount(<SecretModal />)
    await card.press('CONVERT TO DOOR')
    await vi.waitFor(() => expect(card.says("1 CAN'T MOVE")).toBe(true))
    expect(S().mine.find((d) => d.eventId === chest.eventId)).toBe(chest)
    expect(S().mine.some((d) => d.chest?.door !== undefined)).toBe(false)
    await card.unmount()
  })
})

describe('a door inside a chest never opens its room (§3.7.1)', () => {
  const hider = generateSecretKey()
  const HIDER = getPublicKey(hider)
  const at = CURSOR

  /** A door sealed in a chest, both to a key you hold, its room bag on the relay all the same. */
  async function doorInChest(): Promise<{ door: NostrEvent; chest: NostrEvent; lookupId: string; secret: string; entries: ReturnType<typeof readContents> }> {
    const lock = forgeKey('Silver Key')
    const held = await C().signEvent({ kind: 3340, created_at: T, content: '', tags: [['C', '0'.repeat(64)]] })
    useInventory.getState().holdForged(held, lock, { lookupId: 'e'.repeat(64), bagId: 'f'.repeat(64), at: { x: String(at.x), y: String(at.y), z: String(at.z) }, plane: 1, height: HEIGHT })
    const secret = newDoorSecret()
    const sealed = sealEntries(roomEntries(secret) as BagEntry[], lock.itemPubkey)
    const door = finalizeEvent(chestInnerTemplate({ name: 'Boxed Door', lockPubkey: lock.itemPubkey, senderPubkey: sealed.senderPubkey, requires: '', payload: sealed.payload, door: HEIGHT }, at, 1, T), hider) as NostrEvent
    const outer = sealEntries([door], lock.itemPubkey)
    const chest = finalizeEvent(chestInnerTemplate({ name: 'Box', lockPubkey: lock.itemPubkey, senderPubkey: outer.senderPubkey, requires: '', payload: outer.payload }, at, 1, T), hider) as NostrEvent
    const location = (await regionKeyOffThread(at, HEIGHT, 20)).key
    const key = roomKey(location, Buffer.from(secret, 'hex'))
    const lookupId = roomLookupId(key)
    const room = finalizeEvent(await bagTemplate([rumorOf(messageInnerTemplate('must stay shut', at, 1, T), HIDER)], key, lookupId, HEIGHT, T, HIDDEN_KIND, ROOM_BAG_SETTINGS), hider) as NostrEvent
    relay.events.push(room as never)
    return { door, chest, lookupId, secret, entries: readContents([door], HIDER) }
  }

  const noRoom = (lookupId: string, secret: string, doorId: string): void => {
    expect(relay.asked).not.toContain(lookupId)
    expect(Object.values(S().discovered).some((h) => h.room)).toBe(false)
    expect(doorSecret(me(), doorId)).toBeNull()
    expect(secret).toBeTruthy()
  }

  it('from the list in an opened chest: OPEN reads it as a chest, and the room stays shut', async () => {
    const d = await doorInChest()
    const place = { lookupId: 'e'.repeat(64), bagId: 'f'.repeat(64), at: { x: String(at.x), y: String(at.y), z: String(at.z) }, plane: 1 as const, height: HEIGHT }
    const list = await mount(<ChestContents entries={d.entries} from={{ chestId: d.chest.id, chestName: 'Box' }} place={place} />)
    await list.press(/^OPEN$/)
    await settled()
    noRoom(d.lookupId, d.secret, d.door.id)
    await list.unmount()
  })

  it('from its own card, found out of a chest: OPEN leaves the room shut too', async () => {
    const d = await doorInChest()
    const found: Hidden = { eventId: d.door.id, inner: d.door, keyHex: bytesToHex(new Uint8Array(32).fill(1)), bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: HIDER, at, plane: 1, height: HEIGHT, createdAt: T, type: 'chest', chest: chestItemOf(d.door)!, chestId: d.chest.id }
    useShards.setState({ discovered: { [d.door.id]: found }, selectedSecret: d.door.id })
    const card = await mount(<SecretModal />)
    await card.press(/^OPEN$/)
    await settled()
    noRoom(d.lookupId, d.secret, d.door.id)
    await card.unmount()
  })

  it('and asked directly, the store refuses one', async () => {
    const d = await doorInChest()
    const found: Hidden = { eventId: d.door.id, inner: d.door, keyHex: bytesToHex(new Uint8Array(32).fill(1)), bagId: 'f'.repeat(64), lookupId: 'e'.repeat(64), author: HIDER, at, plane: 1, height: HEIGHT, createdAt: T, type: 'chest', chest: chestItemOf(d.door)!, chestId: d.chest.id }
    await expect(enterRoom(found, d.secret)).rejects.toThrow(/inside a chest/)
    noRoom(d.lookupId, d.secret, d.door.id)
  })
})
