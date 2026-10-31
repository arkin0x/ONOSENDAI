/**
 * chestFailures.test.ts: what a chest's hider is left with when things fail
 * (review of #544). A reseal never wipes what this device cannot read. A relay that
 * takes nothing is reported, and nothing claims to have moved, changed or been
 * hidden. A same-bag MOVE leaves the old chest out of the bag itself. The relay is
 * a mock that keeps what is published and can refuse. No network.
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

type Ev = { id: string; kind: number; pubkey: string; created_at: number; tags: string[][]; content: string }
const relay = vi.hoisted(() => ({ events: [] as Ev[], refuse: (_e: Ev) => false as boolean }))
vi.mock('../../lib/relay', () => {
  const answer = async (f: { kinds?: number[]; authors?: string[]; '#d'?: string[] }): Promise<unknown[]> => relay.events.filter((e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey)) && (!f['#d'] || f['#d'].includes(e.tags.find((t) => t[0] === 'd')?.[1] ?? '')))
  return {
    publishMany: vi.fn(async (_r: string[], ev: Ev) => { if (relay.refuse(ev)) return { ok: false }; relay.events.push(ev); return { ok: true } }),
    query: vi.fn(answer),
    queryAny: vi.fn((_r: string[], f: never) => answer(f)),
    queryEach: vi.fn(async (f: never) => [{ url: 'wss://relay.test', outcome: 'answered', events: await answer(f) }]),
    relaySet: () => ['wss://relay.test'],
  }
})

import { newShard, type ShardModel } from 'sno-core/shards'
import { takeIntoKeeping } from '../../lib/carried'
import { forgeKey, openWithSecret, readContents } from '../../lib/chests'
import { hexToBytes, type NostrEvent } from '../../lib/events'
import { HIDDEN_KIND, OBJECT_KIND, bagEntries, chestItemOf, type KeyItem } from '../../lib/hidden'
import type { Position } from '../../lib/space'
import { useStash } from '../../hud/stash'
import { useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { usePublished } from '../usePublished'
import { positionOf, useShards, type MyDeployment } from '../useShards'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const dOf = (e: Ev): string => e.tags.find((t) => t[0] === 'd')?.[1] ?? ''
const bags = (d: string): Ev[] => relay.events.filter((e) => e.kind === HIDDEN_KIND && dOf(e) === d).sort((a, b) => a.created_at - b.created_at)
const goTo = (p: Position): void => { useCyberspace.setState({ cursor: p, position: p, anchor: p }) }

let lock: KeyItem
const draft = (text = 'inside') => ({ name: 'Wind Chest', lock: { pubkey: lock.itemPubkey, label: 'Wind Key' }, requires: 'the Wind Key', contents: [{ kind: 'message' as const, text }] })
const chest = (): MyDeployment => S().mine.find((d) => d.type === 'chest')!

async function seal(): Promise<MyDeployment> {
  S().startPlaceChest()
  S().setDeployHeight(4)
  S().placeChest()
  await S().sealPlacedChest(draft())
  expect(S().deployError).toBeNull()
  return chest()
}

beforeEach(() => {
  relay.events = []
  relay.refuse = () => false
  lock = forgeKey('Wind Key')
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, chestBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, placedLast: null })
  useBuilder.getState().exit()
  useStash.getState().close()
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('a chest this device cannot open', () => {
  /** A chest whose contents this device did not keep and cannot open. */
  async function unreadable(): Promise<MyDeployment> {
    const d = await seal()
    const { sealed: _kept, ...rest } = d
    void _kept
    useShards.setState({ mine: S().mine.map((m) => (m.eventId === d.eventId ? rest : m)) })
    return chest()
  }

  it('ADD refuses rather than wipe what is inside: the chest is the very one it was', async () => {
    const d = await unreadable()
    const events = relay.events.length
    expect(await S().resealChest(d.eventId, draft('only this'))).toMatch(/Opening the chest needs the key/)
    expect(relay.events.length).toBe(events)
    expect(chest().eventId).toBe(d.eventId)
    expect(readContents(openWithSecret(chestItemOf(chest().inner)!, lock.secretHex)).map((e) => e.body.text)).toEqual(['inside'])
  })

  it('a chest it can open is another matter', async () => {
    const d = await unreadable()
    const held = await C().signEvent({ kind: 3340, created_at: 1, content: '', tags: [] })
    useInventory.getState().holdForged(held, lock, { lookupId: 'e'.repeat(64), bagId: 'f'.repeat(64), at: { x: '0', y: '0', z: '0' }, plane: 0, height: 4 })
    expect(await S().resealChest(d.eventId, draft('replaced on purpose'))).toBeNull()
  })
})

describe('no relay takes the bag', () => {
  const refuseBags = (): void => { relay.refuse = (e) => e.kind === HIDDEN_KIND }

  it('MOVE to another bag: said so, and the old chest is not taken down', async () => {
    const d = await seal()
    S().startMoveChest(d.eventId)
    goTo({ ...CURSOR, x: CURSOR.x + (1n << 30n) })
    refuseBags()
    await S().deploy()
    relay.refuse = () => false
    expect(S().deployError).toBe('No relay took the moved chest. It stays where it was.')
    expect(S().mine.filter((m) => m.type === 'chest').map((m) => m.eventId)).toEqual([d.eventId])
    expect(relay.events.some((e) => e.kind === 5)).toBe(false)
    expect((await bagEntries(bags(d.lookupId).at(-1) as unknown as NostrEvent, hexToBytes(d.keyHex))).map((e) => (e as NostrEvent).id)).toEqual([d.eventId])
    S().cancelDeploy()
  })

  it('EDIT, ADD: said so, and the row and the bag stay as they were', async () => {
    const d = await seal()
    refuseBags()
    expect(await S().resealChest(d.eventId, { ...draft('more'), name: 'Renamed' })).toBe('No relay took the new bag. The chest stays as it was.')
    relay.refuse = () => false
    expect(chest().eventId).toBe(d.eventId)
    expect(chest().chest?.name).toBe('Wind Chest')
    expect(chest().published).toBe(true)
  })

  it('a first seal: said so, with the bag’s size, and nothing claims to be hidden', async () => {
    S().startPlaceChest()
    S().setDeployHeight(4)
    S().placeChest()
    refuseBags()
    await S().sealPlacedChest(draft())
    relay.refuse = () => false
    expect(S().deployError).toMatch(/^No relay took the bag \([\d,]+ bytes\)\. Nothing was hidden\.$/)
    expect(S().mine).toEqual([])
    // Its modal is up to say so, and it can be tried again.
    expect(useStash.getState().chest).toBe(true)
    await S().sealPlacedChest(draft())
    expect(S().deployError).toBeNull()
    expect(chest()).toBeDefined()
  })
})

describe('MOVE inside its own bag', () => {
  it('the bag itself holds the moved chest and not the old one', async () => {
    const d = await seal()
    S().startMoveChest(d.eventId)
    goTo({ ...CURSOR, x: CURSOR.x + 1n })
    await S().deploy()
    expect(S().deployError).toBeNull()
    const ids = (await bagEntries(bags(d.lookupId).at(-1) as unknown as NostrEvent, hexToBytes(d.keyHex))).map((e) => (e as NostrEvent).id)
    expect(ids).toEqual([chest().eventId])
    expect(ids).not.toContain(d.eventId)
    expect(positionOf(chest())).not.toEqual(positionOf(d))
  })

  it('a look this client will not read goes with it as it is, never swapped for TREASURE', async () => {
    const d = await seal()
    const big = JSON.stringify({ v: 2, name: 'Monument', unit: 0, mode: 'solid', vertices: Array.from({ length: 2500 }, () => [1, 2, 3]), colors: [], faces: [] })
    const look = [['look', big]]
    const chestItem = { ...d.chest!, look }
    const inner = await C().signEvent({ kind: 3341, created_at: d.createdAt, content: d.inner.content, tags: [...d.inner.tags.filter((t) => t[0] !== 'look' && t[0] !== '-'), ...look, ['-']] })
    useShards.setState({ mine: S().mine.map((m) => (m.eventId === d.eventId ? { ...m, eventId: inner.id, inner, chest: chestItem } : m)) })
    S().startMoveChest(inner.id)
    expect(S().pending).toMatchObject({ look: { from: 'kept' } })
    goTo({ ...CURSOR, x: CURSOR.x + 1n })
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(chestItemOf(chest().inner)?.look).toEqual(look)
  })
})

describe('closing the modal during a seal', () => {
  it('does not strand the chest: it stays up while working, and a signer’s refusal brings it back to say so', async () => {
    const sign = C().signEvent
    useCyberspace.setState({ signEvent: (async (t: { kind: number }) => { if (t.kind === 3341) throw new Error('The signer said no.'); return sign(t as never) }) as never })
    S().startPlaceChest()
    S().setDeployHeight(4)
    S().placeChest()
    const sealing = S().sealPlacedChest(draft())
    expect(S().deployStatus).toBe('working')
    // Anything that closed the modal in the meanwhile.
    useStash.getState().close()
    await sealing
    useCyberspace.setState({ signEvent: sign })
    expect(S().deployError).toBe('The signer said no.')
    expect(useStash.getState().chest).toBe(true)
    S().cancelDeploy()
  })
})

describe('PUBLISH of a model carrying parts that came sealed', () => {
  const piece = `33331:${'a'.repeat(64)}:piece`
  const taken = (): ShardModel => takeIntoKeeping({ ...newShard('Statue'), author: 'a'.repeat(64), vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 1, 0], c: [0, 0, 1] }], faces: [[0, 1, 2]], refs: [['a', piece]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }], objects: { [piece]: { v: 2, name: 'Piece', unit: 0, mode: 'solid', vertices: [], colors: [], faces: [] } } }, C().identity.pubkey)
  const published = (): string => relay.events.filter((e) => e.kind === OBJECT_KIND).at(-1)?.content ?? ''

  it('goes out without them, and no `a` tag names them', async () => {
    expect((await usePublished.getState().send(taken())).ok).toBe(true)
    const ev = relay.events.filter((e) => e.kind === OBJECT_KIND).at(-1)!
    expect(published()).not.toContain('objects')
    expect(ev.tags.some((t) => t[0] === 'a' && t[1].endsWith(':piece'))).toBe(false)
    expect(ev.content).not.toContain(C().identity.pubkey)
  })

  it('goes out with them only if you said so', async () => {
    expect((await usePublished.getState().send(taken(), false, true)).ok).toBe(true)
    expect(published()).toContain('objects')
  })
})
