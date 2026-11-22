/**
 * lookCopyInUse.test.ts: a copy opened by a double-tap and only looked at is
 * kept out of storage (useWorkshop untouchedLookCopy), but once it is used
 * anywhere (placed inside another shard, picked as the object to stamp, or put
 * in a chest draft) it is stored at that moment, so nothing ever names a shard
 * that is in no stored list. BACK then keeps it, and the parent keeps its link.
 */
import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { newShard, toPayload, type Ref, type ShardModel } from 'sno-core/shards'
import { setLocalAuthor } from '../../lib/carried'
import { useCyberspace } from '../../store/useCyberspace'
import { keepPlacedCopies, kept, untouchedLookCopy, useWorkshop } from '../../store/useWorkshop'
import { useShards } from '../../store/useShards'

const W = () => useWorkshop.getState()
const me = (): string => useCyberspace.getState().identity.pubkey
const THEM = 'b'.repeat(64)
const LINK: Ref = ['a', `33331:${THEM}:statue`, 'wss://relay.test']

function tri(name: string, id: string): ShardModel {
  return { ...newShard(name), id, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}
function placing(name: string, id: string, refs: Ref[]): ShardModel {
  return { ...newShard(name), id, mode: 'solid', vertices: [], faces: [], refs, parts: refs.map((_, i) => ({ ref: i, at: [i * 240, 0, 0], turn: [0, 0, 0], step: 0 })) }
}
const byId = (id: string) => W().shards.find((s) => s.id === id)
const storedIds = () => kept(W().shards).map((s) => s.id)

/** Plaza links a public statue; a double-tap opens your copy of it, only looked at. */
async function lookAtStatue(): Promise<string> {
  useWorkshop.setState({ shards: [tri('Other', 'other'), placing('Plaza', 'plaza', [LINK])], currentId: 'plaza' })
  await W().enterPart(0, async () => toPayload(tri('Statue', 'statue')))
  const id = W().currentId!
  expect(untouchedLookCopy(byId(id)!)).toBe(true)
  expect(storedIds()).not.toContain(id)
  return id
}

beforeEach(() => {
  setLocalAuthor(() => useCyberspace.getState().identity.pubkey)
  useWorkshop.setState({ shards: [], currentId: null, backStack: [], past: [], future: [], stampObject: null })
})

describe('a look copy in use is stored at that moment', () => {
  it('picked as the object to stamp: stored, and BACK keeps it while the parent keeps its link', async () => {
    const id = await lookAtStatue()
    W().setStampObject({ ref: ['a', `33331:${me()}:${id}`], name: 'Statue' } as never)
    expect(storedIds()).toContain(id)
    W().back()
    expect(byId(id)).toBeDefined()
    expect(byId('plaza')!.refs).toEqual([LINK])
  })

  it('placed inside another shard by any edit: stored with the edit that names it', async () => {
    const id = await lookAtStatue()
    // Stamped into Other, as a stamp object chosen before this rule would have been.
    useWorkshop.setState({ currentId: 'other', stampObject: { ref: ['a', `33331:${me()}:${id}`], name: 'Statue' } as never })
    W().placeObject([0, 0, 0], 'other')
    expect(byId('other')!.refs!.map((r) => r[1])).toContain(`33331:${me()}:${id}`)
    expect(storedIds()).toContain(id)
  })

  it('put in a chest draft: stored', async () => {
    const id = await lookAtStatue()
    W().keepCopy(id)
    expect(storedIds()).toContain(id)
    W().back()
    expect(byId(id)).toBeDefined()
  })

  it('nothing else changes: a copy only looked at still goes on BACK, and a shard of yours is untouched by keepCopy', async () => {
    const id = await lookAtStatue()
    const before = byId('other')
    W().keepCopy('other')
    expect(byId('other')).toBe(before)
    W().back()
    expect(byId(id)).toBeUndefined()
  })

  it('deployed (DEPLOY, PLACE OBJECT): stored, so the deploy reads it back by id', async () => {
    const id = await lookAtStatue()
    useShards.getState().startDeployShard(id, 'workshop')
    expect(storedIds()).toContain(id)
    useShards.setState({ pending: null })
  })

  it('kept, then picked away from the list: it stays', async () => {
    const id = await lookAtStatue()
    W().keepCopy(id)
    W().select('other')
    expect(byId(id)).toBeDefined()
    expect(storedIds()).toContain(id)
    expect(byId('plaza')!.refs).toEqual([LINK])
  })

  it('kept, then edited while still inside: its first edit still points the parent at it', async () => {
    const id = await lookAtStatue()
    W().keepCopy(id)
    W().addVertex([5, 5, 5])
    expect(byId('plaza')!.refs).toEqual([['a', `33331:${me()}:${id}`]])
  })

  it('a duplicate of a look copy is a shard of its own, stored', async () => {
    const id = await lookAtStatue()
    const dup = W().duplicate(id)
    W().rename(dup, 'Statue')
    expect(storedIds()).toContain(dup)
  })

  it('keepPlacedCopies only un-marks what the edited shard places under your key', () => {
    const marked = { ...tri('Look', 'look'), lookCopy: 'x' } as ShardModel
    const other = { ...tri('Look 2', 'look2'), lookCopy: 'y' } as ShardModel
    const user = placing('User', 'user', [['a', `33331:${me()}:look`], ['a', `33331:${THEM}:look2`]])
    const out = keepPlacedCopies([marked, other, user], user, me())
    expect((out[0] as { lookCopy?: string }).lookCopy).toBeUndefined()
    expect((out[1] as { lookCopy?: string }).lookCopy).toBe('y')
    // Nobody signed in: nothing is un-marked.
    expect(keepPlacedCopies([marked, other, user], user, null)).toEqual([marked, other, user])
  })
})
