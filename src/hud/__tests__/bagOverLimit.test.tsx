/**
 * bagOverLimit.test.tsx: a bag a shard cannot fit in, even with entries moved
 * out, turns HIDE & PUBLISH off and says what to do (owner's screenshot,
 * 2026-11-16: "323,623 of 240,000 bytes · INLINE" with HIDE & PUBLISH on).
 *
 * The bag here holds one message too large to move out as an event of its own
 * (lib/bagFit.ts sealFor), so nothing can bring it under the cap: the meter
 * reads TOO LARGE, the button is disabled, and the BAG row's note says to hide
 * it at another height. At another height (another bag) the same shard goes.
 * The deploy itself refuses such a write in signBag (lib/bagFit.ts
 * planUnderCap, bagFit.test.ts and bagAutoReference.test.ts), so the pad's
 * COMMIT and Enter cannot send it either. Mounted for real (elementRoot.ts);
 * the relay is a mock. No network.
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

import { newShard, type ShardModel } from 'sno-core/shards'
import { MESSAGE_KIND, rumorOf } from '../../lib/hidden'
import { BAG_SAFE_BYTES } from '../../lib/bagSize'
import type { Position } from '../../lib/space'
import { buildPlane } from '../../lib/buildCursor'
import { deployPoint } from '../../lib/space'
import { mount, type Host } from '../../test/elementRoot'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useWorkshop } from '../../store/useWorkshop'
import { regionOf, useShards, type MyDeployment } from '../../store/useShards'
import { DeployBar, bagTooBigLine } from '../DeployBar'

const S = () => useShards.getState()
const C = () => useCyberspace.getState()
const me = (): string => C().identity.pubkey
const CURSOR: Position = { x: (1n << 70n) + 0x1d3c5a7f0n, y: (1n << 60n) + 0x2b0n, z: (1n << 72n) + 0x7e0n }
const H = 5

const triangle = (): ShardModel => ({ ...newShard('Courtyard'), unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]] })

/** A row of yours in the cursor's bag at height H: one message too large to move out on its own, so the bag is past the cap for good. */
function fullBag(): MyDeployment {
  const at = deployPoint(C().cursor, 0, H)
  const inner = rumorOf({ kind: MESSAGE_KIND, created_at: 1_800_000_000, content: 'm'.repeat(BAG_SAFE_BYTES + 10_000), tags: [['C', 'ab'.repeat(32)], ['-']] }, me())
  const plane = buildPlane(C())
  return {
    eventId: inner.id, inner, bagId: 'b'.repeat(64), bagAt: 1_800_000_000, type: 'message', text: inner.content,
    at: { x: at.x.toString(), y: at.y.toString(), z: at.z.toString() }, plane, height: H, lookupId: 'c'.repeat(64), keyHex: 'd'.repeat(64),
    relays: ['wss://relay.test'], createdAt: inner.created_at, published: true, bag: { ...S().deployBag },
  } as MyDeployment
}

const deployButton = (all: Host[]): Host => all.find((h) => h.type === 'button' && String(h.props.className ?? '').includes('deploybar__deploy'))!

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, deletedBags: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null, selectedSecret: null, deployLeaveOut: [], deployRoomSnap: null, deployInto: null, placedLast: null })
  useBuilder.getState().exit()
  useInventory.setState({ owner: me(), items: {}, storage: 'memory' })
  useCyberspace.setState({ live: true, position: CURSOR, anchor: CURSOR, cursor: CURSOR, spectate: null, exploreIndex: null, transit: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
})

describe('a bag too full for the shard (owner, 2026-11-16)', () => {
  it('HIDE & PUBLISH is off and the BAG row says to hide it at another height; at another height it is on again', async () => {
    const model = triangle()
    useWorkshop.setState({ shards: [model] })
    const row = fullBag()
    expect(regionOf({ x: BigInt(row.at.x), y: BigInt(row.at.y), z: BigInt(row.at.z) }, row.plane, H)).toBeTruthy()
    useShards.setState({ mine: [row] })
    S().startDeployShard(model.id)
    useShards.setState({ deployHeightAuto: false })
    S().setDeployHeight(H)
    const bar = await mount(<DeployBar />)
    expect(bar.says('TOO LARGE')).toBe(true)
    const button = deployButton(bar.all())
    expect(button).toBeDefined()
    expect(bar.says('HIDE & PUBLISH')).toBe(true)
    expect(button.props.disabled).toBe(true)
    expect(bar.says(bagTooBigLine(true))).toBe(true)
    expect(button.props.title).toBe(bagTooBigLine(true))
    // The owner's voice: no em dashes.
    expect(bagTooBigLine(true)).not.toContain('—')
    expect(bagTooBigLine(false)).not.toContain('—')
    await bar.unmount()

    // Another height is another bag, with nothing in it: the same shard fits and the button is on.
    S().setDeployHeight(H + 1)
    const other = await mount(<DeployBar />)
    expect(other.says('TOO LARGE')).toBe(false)
    expect(other.says(bagTooBigLine(true))).toBe(false)
    expect(deployButton(other.all()).props.disabled).toBe(false)
    await other.unmount()
  })
})
