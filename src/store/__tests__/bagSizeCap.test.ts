/**
 * bagSizeCap.test.ts: no write grows a bag past what the canonical relay
 * takes, whoever writes it (review of #633). Every bag write passes signBag,
 * which refuses one past the cap and larger than the bag it replaces, before
 * the signer is asked; a write that shrinks a bag already past the cap (a
 * DELETE, the H8 recovery) still goes. The cap is lowered here, through a
 * stand-in for lib/bagSize that keeps its words, to make an old oversized bag
 * cheaply; the reviewer's own case runs at the real cap. The relay is a mock
 * that keeps what is published. No network.
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

const relay = vi.hoisted(() => ({ events: [] as Array<{ id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }> }))
const cap = vi.hoisted(() => ({ bytes: null as number | null }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    publishMany: vi.fn(async (_r: string[], ev: (typeof relay.events)[number]) => { relay.events.push(ev); return { ok: true } }),
    publishRetried: vi.fn(async () => true),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryEach: vi.fn(async (f: Parameters<typeof answer>[0]) => [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f) }]),
    relaySet: () => ['wss://relay.test'],
  }
})
// The real module, its cap lowered while a test asks.
vi.mock('../../lib/bagSize', async (load) => {
  const real = await load<typeof import('../../lib/bagSize')>()
  return {
    ...real,
    bagSizeRefusal: (bytes: number) => (cap.bytes === null ? real.bagSizeRefusal(bytes) : bytes <= cap.bytes ? null : `Too large for one bag: ${bytes.toLocaleString('en-US')} of ${cap.bytes.toLocaleString('en-US')} bytes. Nothing was sent.`),
  }
})

import { forgeKey } from '../../lib/chests'
import { HIDDEN_KIND, bagTemplate, type KeyItem } from '../../lib/hidden'
import { hexToBytes } from '../../lib/events'
import { BAG_SAFE_BYTES } from '../../lib/bagSize'
import type { Position } from '../../lib/space'
import { useStash } from '../../hud/stash'
import { resetDoorSecrets } from '../doorSecrets'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { resetOpenedChests } from '../useOpenedChests'
import { useShards, type MyDeployment } from '../useShards'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a740n, y: (1n << 60n) + 0x2c0n, z: (1n << 72n) + 0x7c0n }
const ROOM = 6
const big = (i: number): string => `${String(i).padStart(3, '0')} ${'abcdefghij'.repeat(999)}`
const dOf = (e: { tags: string[][] }): string => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
const bagsAt = (lookupId: string) => relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === lookupId)
const newestBag = (lookupId: string) => bagsAt(lookupId).sort((a, b) => b.created_at - a.created_at)[0]

let lock: KeyItem
const lockOf = () => ({ pubkey: lock.itemPubkey, label: lock.name })

async function sealDoor(name: string, hide: number): Promise<MyDeployment> {
  const before = new Set(S().mine.map((d) => d.eventId))
  S().startPlaceDoor()
  S().setDeployHeight(hide)
  S().placeChest()
  await S().sealPlacedChest({ name, lock: lockOf(), requires: 'x', contents: [] })
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  return S().mine.find((d) => !before.has(d.eventId))!
}

/** A message hidden at height 2 where the cursor is; the deploy's error, or null. */
async function hide(text: string): Promise<string | null> {
  S().startDeployMessage(text)
  S().setDeployHeight(2)
  await S().deploy()
  const why = S().deployError
  S().cancelDeploy()
  return why
}

beforeEach(() => {
  relay.events = []
  cap.bytes = null
  lock = forgeKey('Silver Key')
  localStorage.removeItem('onosendai:door-secrets')
  localStorage.removeItem('onosendai:chests-opened')
  resetDoorSecrets()
  resetOpenedChests()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: [], deployRoomSnap: null, deployInto: null, deployDoorHeight: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('every bag write keeps under the cap (review of #633)', () => {
  it('the reviewer’s case: an EDIT of a chest in a full room is refused, and no room bag passes the cap', async () => {
    await sealDoor('Room', ROOM)
    S().startPlaceChest()
    S().setDeployHeight(2)
    S().placeChest()
    await S().sealPlacedChest({ name: 'Box', lock: lockOf(), requires: 'x', contents: [{ kind: 'message', text: 'small' }] })
    expect(S().deployError).toBeNull()
    S().cancelDeploy()
    const chest = S().mine.find((d) => d.type === 'chest' && d.chest?.door === undefined)!
    expect(chest.room).toBeTruthy()
    let refused: string | null = null
    for (let n = 0; n < 30 && !refused; n++) refused = await hide(big(n))
    expect(refused).toMatch(/Too large for one bag/)
    const sent = relay.events.length
    const contents = Array.from({ length: 6 }, (_, i) => ({ kind: 'message' as const, text: big(100 + i) }))
    const why = await S().resealChest(chest.eventId, { name: 'Box', lock: lockOf(), requires: 'x', contents })
    expect(why).toMatch(/Too large for one bag/)
    expect(relay.events.length).toBe(sent)
    expect(Math.max(...bagsAt(chest.lookupId).map((e) => JSON.stringify(e).length))).toBeLessThanOrEqual(BAG_SAFE_BYTES)
  }, 120000)

  it('a bag already past the cap: a new hide is refused, a DELETE that shrinks it still goes', async () => {
    for (let i = 0; i < 6; i++) expect(await hide(big(i))).toBeNull()
    const lookupId = S().mine[0].lookupId
    const size = JSON.stringify(newestBag(lookupId)).length
    // The cap drops under what the bag already is: an old bag, as H8 was.
    cap.bytes = size - 5000
    expect(await hide(big(50))).toMatch(/Too large for one bag/)
    const victim = S().mine.find((d) => d.text === big(0))!
    await S().deleteInstance(victim.eventId)
    const after = newestBag(lookupId)
    expect(JSON.stringify(after).length).toBeLessThan(size)
    expect(S().mine.some((d) => d.eventId === victim.eventId)).toBe(false)
  }, 60000)

  it('HIDE AGAIN of a row gone from a bag already at the cap is refused in words, and nothing goes out', async () => {
    for (let i = 0; i < 4; i++) expect(await hide(big(i))).toBeNull()
    const rows = S().mine.filter((d) => d.text)
    const lookupId = rows[0].lookupId
    const gone = rows[0]
    // Another device's newer bag without it: the read marks it gone from its bag.
    const was = newestBag(lookupId)
    const keep = rows.slice(1).map((r) => r.inner)
    const template = await bagTemplate(keep, hexToBytes(gone.keyHex), lookupId, gone.height, was.created_at + 5, HIDDEN_KIND, { ...gone.bag!, heightTag: true })
    relay.events.push(await C().signEvent(template) as never)
    expect(await hide('one more, to read the bag')).toBeNull()
    expect(S().mine.find((d) => d.eventId === gone.eventId)?.goneFrom).toBeDefined()
    cap.bytes = JSON.stringify(newestBag(lookupId)).length + 2000
    const sent = relay.events.length
    expect(await S().hideAgain(gone.eventId)).toMatch(/Too large for one bag/)
    expect(relay.events.length).toBe(sent)
    // Under a cap that holds it, the same HIDE AGAIN goes.
    cap.bytes = null
    expect(await S().hideAgain(gone.eventId)).toBeNull()
  }, 60000)
})
