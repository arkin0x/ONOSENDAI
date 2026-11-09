/**
 * doorHere.test.tsx: a door's HERE list, by its real buttons (elementRoot.ts).
 *
 * Every placement of yours in the room's cube, at any height, not behind the
 * door yet (arkinox, 2026-11-09: "the list of things I could seal ... seems
 * to be missing a lot of shards"): all of them, never cut short. A row's
 * name flies to it, and RETURN reopens the card on the same door with the
 * list scrolled as it was. No network.
 */
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
;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }

const relay = vi.hoisted(() => ({ events: [] as Array<{ kind: number; pubkey: string; tags: string[][] }> }))
vi.mock('../../scene/CardSpin', () => ({ CardSpin: () => null }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    publishMany: vi.fn(async (_r: string[], ev: (typeof relay.events)[number]) => { relay.events.push(ev); return { ok: true } }),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: Parameters<typeof answer>[0]) => answer(f)),
    queryChecked: vi.fn(async (f: Parameters<typeof answer>[0]) => ({ events: await answer(f), trouble: null })),
    queryAnyChecked: vi.fn(async (_r: string[], f: Parameters<typeof answer>[0]) => ({ events: await answer(f), trouble: null })),
    queryEach: vi.fn(async () => []),
    relaySet: () => ['wss://relay.test'],
    onAuthChange: () => () => {},
    signInFailed: () => false,
  }
})
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
vi.mock('../../hooks/useCover', () => ({ useCover: () => () => undefined }))
vi.mock('../ui/Switch', () => ({ Field: () => null, Switch: () => null }))

import { forgeKey } from '../../lib/chests'
import { doorReturnWaiting, resetDoorReturn, restoreDoorReturn, viewFromDoor, watchDoorReturn } from '../../lib/doorReturn'
import type { Position } from '../../lib/space'
import { mount, type Host } from '../../test/elementRoot'
import { resetDoorSecrets } from '../../store/doorSecrets'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { resetOpenedChests } from '../../store/useOpenedChests'
import { hereInRoom, positionOf, useShards, type MyDeployment } from '../../store/useShards'
import { SecretModal } from '../SecretModal'
import { useStash } from '../stash'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const HEIGHT = 6
const MANY = 40

let stop: (() => void) | null = null

beforeEach(() => {
  relay.events = []
  localStorage.removeItem('onosendai:door-secrets')
  resetDoorSecrets()
  resetOpenedChests()
  resetDoorReturn()
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, nearbyOpen: false, deployLeaveOut: [], deployRoomSnap: null, deployInto: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null, focus: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
  stop = watchDoorReturn()
})
afterEach(() => { stop?.(); stop = null })

/**
 * MANY of your placements in the cube, hidden before the door, at every
 * height from 0 to 9: one real message, and copies of its row at other points
 * and heights (only the list reads them here; nothing is sealed).
 */
async function crowdedRoom(): Promise<{ door: MyDeployment; rows: MyDeployment[] }> {
  S().startDeployMessage('first')
  S().setDeployHeight(HEIGHT)
  await S().deploy()
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  const first = S().mine[0]
  const copies = Array.from({ length: MANY - 1 }, (_, i): MyDeployment => ({
    ...first,
    eventId: `${(i + 1).toString(16).padStart(2, '0')}${first.eventId.slice(2)}`,
    text: `copy ${i + 1}`,
    height: i % 10,
    // Spread across the cube's 64 gibsons on x, every one inside it.
    at: { x: (((CURSOR.x >> BigInt(HEIGHT)) << BigInt(HEIGHT)) + BigInt(i)).toString(), y: first.at.y, z: first.at.z },
  }))
  useShards.setState({ mine: [...S().mine, ...copies] })
  const lock = forgeKey('Silver Key')
  S().startPlaceDoor()
  S().setDeployHeight(HEIGHT)
  S().placeChest()
  await S().sealPlacedChest({ name: 'North Door', lock: { pubkey: lock.itemPubkey, label: 'Silver Key' }, requires: 'x', contents: [] })
  expect(S().deployError).toBeNull()
  S().cancelDeploy()
  useBuilder.getState().exit()
  return { door: S().mine.find((d) => d.chest?.door !== undefined)!, rows: [first, ...copies] }
}

const hereList = (all: Host[]): Host | undefined => all.find((h) => h.type === 'ul' && String(h.props.className).includes('doorowner__here'))

describe('HERE lists every thing of yours in the room', () => {
  it('at every height, all of them, with a visible count; SEAL on each', async () => {
    const { door, rows } = await crowdedRoom()
    expect(new Set(rows.map((r) => r.height)).size).toBe(10)
    expect(hereInRoom(S().mine, door)).toHaveLength(MANY)
    useShards.setState({ selectedSecret: door.eventId })
    const card = await mount(<SecretModal />)
    expect(card.says(`HERE · ${MANY}`)).toBe(true)
    expect(card.buttons(/^SEAL$/)).toHaveLength(MANY)
    expect(card.says('copy 39')).toBe(true)
    await card.unmount()
  })
})

describe('a row flies to it; RETURN comes back to the card, scrolled as it was', () => {
  it('VIEW from a row, then RETURN: the same door’s card, the list where it was', async () => {
    const { door, rows } = await crowdedRoom()
    useShards.setState({ selectedSecret: door.eventId })
    const card = await mount(<SecretModal />)
    const list = hereList(card.all())!
    expect(list).toBeTruthy()
    // As the list stands scrolled on a screen.
    ;(list as unknown as { scrollTop: number }).scrollTop = 137
    const target = rows.find((r) => r.text === 'copy 27')!
    await card.press('copy 27')
    expect(S().selectedSecret).toBeNull()
    expect(C().focus?.item).toBe(true)
    expect(C().focus?.position).toEqual(positionOf(target))
    expect(doorReturnWaiting()).toMatchObject({ owner: me(), doorId: door.eventId, listTop: 137 })
    expect(card.says('North Door')).toBe(false)
    // RETURN on the viewing bar.
    C().clearFocus()
    await vi.waitFor(() => expect(S().selectedSecret).toBe(door.eventId))
    await vi.waitFor(() => expect(hereList(card.all())).toBeTruthy())
    const back = hereList(card.all())!
    expect(back).not.toBe(list)
    expect((back as unknown as { scrollTop: number }).scrollTop).toBe(137)
    expect(card.says(`HERE · ${MANY}`)).toBe(true)
    expect(doorReturnWaiting()).toBeNull()
    await card.unmount()
  })

  it('only for the identity that left it, and only while the door is still there (review of #633)', async () => {
    const { door } = await crowdedRoom()
    restoreDoorReturn({ owner: 'f'.repeat(64), doorId: door.eventId, listTop: 0, cardTop: 0 })
    expect(S().selectedSecret).toBeNull()
    restoreDoorReturn({ owner: me(), doorId: 'e'.repeat(64), listTop: 0, cardTop: 0 })
    expect(S().selectedSecret).toBeNull()
    // Waiting, then another identity signs in: dropped.
    viewFromDoor({ doorId: door.eventId, listTop: 0, cardTop: 0 }, CURSOR, 0, 'X', 0)
    expect(doorReturnWaiting()?.owner).toBe(me())
    const was = C().identity
    useCyberspace.setState({ identity: { ...was, pubkey: 'f'.repeat(64) } })
    expect(doorReturnWaiting()).toBeNull()
    useCyberspace.setState({ identity: was })
    C().clearFocus()
    expect(S().selectedSecret).toBeNull()
  })

  it('a view that was not from a door brings no card back', async () => {
    useCyberspace.getState().focusItem(CURSOR, 0, 'ELSEWHERE', 0)
    C().clearFocus()
    expect(S().selectedSecret).toBeNull()
  })
})
