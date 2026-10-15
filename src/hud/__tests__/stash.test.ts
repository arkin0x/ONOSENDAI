/**
 * stash.test.ts - bags in the Stash (arkinox, 2026-09-26): deployments group
 * into bags by lookup id, newest first; a deploy started from the Models modal
 * returns to it when cancelled and not when placed.
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import type { MyDeployment } from '../../store/useShards'
import { useShards } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { bagsOf, useStash } from '../stash'

const dep = (eventId: string, lookupId: string, createdAt: number, over: Partial<MyDeployment> = {}): MyDeployment => ({
  eventId, lookupId, createdAt, type: 'message', text: eventId, height: 12, plane: 0, published: true,
  at: { x: '1', y: '2', z: '3' }, keyHex: '', relays: [], bagId: 'b', inner: {} as never, ...over,
} as MyDeployment)

describe('bagsOf', () => {
  it('groups by lookup id, newest bag first, newest item first, and is LIVE only when every item is', () => {
    const bags = bagsOf([
      dep('a1', 'A', 10), dep('b1', 'B', 30), dep('a2', 'A', 20, { published: false }), dep('c1', 'C', 5),
    ])
    expect(bags.map((b) => b.lookupId)).toEqual(['B', 'A', 'C'])
    expect(bags[1].items.map((d) => d.eventId)).toEqual(['a2', 'a1'])
    expect(bags[1].published).toBe(false)
    expect(bags[0].published).toBe(true)
  })
})

describe('Models modal and the deploy it starts', () => {
  beforeEach(() => {
    useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployStatus: 'idle', deployError: null })
    useStash.setState({ models: false, bags: false, bag: null, returnToModels: false })
    useWorkshop.setState({ shards: [], currentId: null })
  })

  it('cancelling a deploy started from the modal brings the modal back', () => {
    const id = useWorkshop.getState().create('tile')
    useStash.getState().openModels()
    useStash.getState().deployModel(id)
    expect(useStash.getState().models).toBe(false)
    expect(useShards.getState().pending).not.toBeNull()
    useShards.getState().cancelDeploy()
    expect(useStash.getState().models).toBe(true)
    expect(useStash.getState().returnToModels).toBe(false)
  })

  it('a deploy that places does not reopen it', () => {
    const id = useWorkshop.getState().create('tile')
    useStash.getState().deployModel(id)
    useShards.setState({ deployStatus: 'done', pending: null })
    expect(useStash.getState().models).toBe(false)
  })

  it('a deploy started anywhere else never opens it', () => {
    const id = useWorkshop.getState().create('tile')
    useShards.getState().startDeployShard(id)
    useShards.getState().cancelDeploy()
    expect(useStash.getState().models).toBe(false)
  })
})
