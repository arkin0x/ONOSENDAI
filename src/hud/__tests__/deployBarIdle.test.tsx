/**
 * deployBarIdle.test.tsx: the deploy bar asks nothing while nothing is being
 * placed (arkinox, 2026-11-21: WALK stutters on his phone).
 *
 * The bar is mounted all the time (App.tsx). In WALK the build cursor is the
 * walker and moves several times a second, and the bar's body read every
 * hide you have at each of those moves to find the bag at the cursor
 * (useShards ownBagIn), for a bar that draws nothing. Here a walk of the
 * cursor with nothing placed reads none of them, and with a shard lined up
 * the bar reads them as it always did. Mounted for real (elementRoot.ts); the
 * relay is a mock. No network.
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
;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryAnyChecked: vi.fn(async () => ({ events: [], trouble: null })),
  queryEach: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
  onAuthChange: () => () => {},
  signInFailed: () => false,
}))
vi.mock('../../scene/ShardSpin', () => ({ ShardSpin: () => null }))
vi.mock('../../hooks/useCover', () => ({ useCover: () => () => undefined }))
vi.mock('../ui/Switch', () => ({ Field: () => null, Switch: () => null }))

import { act } from 'react'
import { newShard } from 'sno-core/shards'
import { MESSAGE_KIND, rumorOf } from '../../lib/hidden'
import { mount } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useWorkshop } from '../../store/useWorkshop'
import { useShards, type MyDeployment } from '../../store/useShards'
import { DeployBar } from '../DeployBar'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()

/** A hide of yours, somewhere: a message, enough for ownBagIn to read. */
function hide(i: number): MyDeployment {
  const me = C().identity.pubkey
  const inner = rumorOf({ kind: MESSAGE_KIND, created_at: 1_700_000_000 + i, tags: [], content: `note ${i}` }, me)
  return {
    eventId: inner.id, inner, bagId: 'b'.repeat(64), lookupId: 'l'.repeat(64), keyHex: 'k'.repeat(64),
    at: { x: String((1n << 40n) + BigInt(i) * 4096n), y: String(1n << 39n), z: String(1n << 38n) },
    plane: 0, height: 4, type: 'message', text: `note ${i}`, createdAt: 1_700_000_000 + i, published: true,
  } as MyDeployment
}

/** `mine`, with its reads counted: ownBagIn reads it with `filter`. */
function countedMine(n: number): { rows: MyDeployment[]; reads: () => number } {
  const rows = Array.from({ length: n }, (_, i) => hide(i))
  let reads = 0
  const filter = rows.filter.bind(rows)
  Object.defineProperty(rows, 'filter', { value: (...a: Parameters<typeof filter>) => { reads++; return filter(...a) } })
  return { rows, reads: () => reads }
}

beforeEach(() => {
  S().cancelDeploy?.()
  useShards.setState({ pending: null })
})

describe('the deploy bar with nothing placed', () => {
  it('draws nothing and reads none of your hides while the cursor walks', async () => {
    const { rows, reads } = countedMine(200)
    useShards.setState({ mine: rows })
    const bar = await mount(<DeployBar />)
    expect(bar.all().length).toBe(0)
    const start = C().cursor
    for (let i = 1; i <= 40; i++) {
      await act(async () => { useCyberspace.setState({ cursor: { x: start.x + BigInt(i) * 64n, y: start.y, z: start.z } }) })
    }
    expect(reads()).toBe(0)
    await bar.unmount()
  })

  it('reads them as before once a shard is lined up', async () => {
    const { rows, reads } = countedMine(20)
    useShards.setState({ mine: rows })
    const model = { ...newShard('Block'), id: 'idle-bar-shard' }
    useWorkshop.setState({ shards: [model] })
    S().startDeployShard(model.id)
    const bar = await mount(<DeployBar />)
    expect(bar.all().length).toBeGreaterThan(0)
    expect(reads()).toBeGreaterThan(0)
    await bar.unmount()
    S().cancelDeploy?.()
  })
})
