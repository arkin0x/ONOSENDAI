/**
 * builderLifecycle.test.ts - how BUILD mode ends, and what it keeps.
 *
 * From the review of the Builder (2026-10-07):
 * - the view moving away, or your position being replaced under the mode,
 *   ends it, says why, and keeps the work (a message's text, the model);
 * - a session from DEPLOY that never left your avatar ends with its deploy;
 * - entering takes the camera back from a hyperspace view;
 * - leaving is refused while a deploy is lined up, by every control alike;
 * - one hide at a time, however many presses.
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
  relaySet: () => ['wss://relay.test'],
}))

import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { useHyperspace } from '../useHyperspace'
import { useToast } from '../useToast'
import { useBuilder } from '../useBuilder'
import { useStash } from '../../hud/stash'
import { openWorkshopFromPicker } from '../../hud/PlaceObjectPicker'
import { placeSpawn } from '../fixtures/placeSpawn'
import { moveDirection } from '../../lib/moves'
import { moveUnderWay } from '../../lib/buildCursor'
import type { EventTemplate } from '../../lib/events'

const S = () => useCyberspace.getState()
const B = () => useBuilder.getState()
const up = (n = 1): void => { for (let i = 0; i < n; i++) S().moveCursor(moveDirection(S().axes(), 'up')) }

function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Lantern'),
    vertices: [
      { p: [0, 0, 0], c: [1, 0, 0] },
      { p: [1, 0, 0], c: [0, 1, 0] },
      { p: [0, 1, 0], c: [0, 0, 1] },
    ],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

beforeEach(async () => {
  useShards.setState({ mine: [], pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  useBuilder.setState({ messageDraft: null })
  S().clearFocus()
  useToast.getState().dismiss()
  useCyberspace.setState({ live: false })
  await placeSpawn()
})

describe('the view moving away ends BUILD mode and keeps the work', () => {
  it('a lined-up message goes back to the composer, with a toast saying so (an Earth tap)', () => {
    useShards.getState().startDeployMessage('a long secret message, written with care')
    expect(B().active).toBe(true)
    // What a tap on the globe does: a plain focus, not a build cursor.
    S().focusOn(S().position, 0, 'EARTH · 1, 2')
    expect(B().active).toBe(false)
    expect(useShards.getState().pending).toBeNull()
    expect(B().messageDraft).toBe('a long secret message, written with care')
    const toast = useToast.getState().toast
    expect(toast?.mark).toBe('build')
    expect(toast?.label).toBe('BUILD MODE ENDED')
    expect(toast?.meta).toMatch(/Your message is kept/)
    // The next composer takes it, once.
    expect(B().takeMessageDraft()).toBe('a long secret message, written with care')
    expect(B().messageDraft).toBeNull()
  })

  it('a lined-up shard is canceled with the model untouched, and the Models modal does not jump back up', () => {
    const shard = benchShard()
    useStash.getState().deployModel(shard.id)
    expect(B().active).toBe(true)
    // A deployment tapped in the stash.
    S().focusItem({ x: 1n, y: 2n, z: 3n }, 0, 'a shard')
    expect(B().active).toBe(false)
    expect(useStash.getState().models).toBe(false)
    expect(useToast.getState().toast?.meta).toMatch(/model is unchanged in your workshop/)
    expect(useWorkshop.getState().shards[0].id).toBe(shard.id)
  })
})

describe('your position replaced under BUILD mode ends it, and says why', () => {
  it('a respawn: the mode ends instead of the build cursor following you to the new spawn', async () => {
    B().enter('build')
    up(4)
    await S().respawn()
    expect(B().active).toBe(false)
    expect(useToast.getState().toast?.meta).toMatch(/Your avatar was moved under it/)
    // The cursor is on the new head, so the view is simply your head again.
    expect(S().atHead()).toBe(true)
  })

  it('a ride arriving (a new head that also writes the cursor) ends it and cancels a lined-up deploy', () => {
    useShards.getState().startDeployMessage('hello')
    up(2)
    const dest = { x: S().position.x + 100n, y: S().position.y, z: S().position.z }
    // What completeRide writes.
    useCyberspace.setState({ prevEventId: 'ride-event', position: dest, cursor: { ...dest }, anchor: { ...dest } })
    expect(B().active).toBe(false)
    expect(useShards.getState().pending).toBeNull()
    expect(B().messageDraft).toBe('hello')
  })

  it('a move committed before building lands without ending it (the cursor is not touched)', () => {
    B().enter('build')
    up(2)
    const aim = { ...S().cursor }
    const landed = { x: S().position.x + 1n, y: S().position.y, z: S().position.z }
    // What a proof landing off your head writes: position and head, no cursor.
    useCyberspace.setState({ prevEventId: 'hop-event', position: landed })
    expect(B().active).toBe(true)
    expect(S().cursor).toEqual(aim)
  })
})

describe('a session from DEPLOY that never left your avatar', () => {
  it('ends when the deploy is canceled, back at your head with COMMIT', () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    expect(B().via).toBe('deploy')
    useShards.getState().cancelDeploy()
    expect(B().active).toBe(false)
    expect(S().atHead()).toBe(true)
  })

  it('ends when the deploy is hidden', async () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    expect(B().active).toBe(false)
    expect(S().atHead()).toBe(true)
  })

  it('stays once the build cursor has left your avatar, even if it came back', () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    up(1)
    S().moveCursor(moveDirection(S().axes(), 'down'))
    useShards.getState().cancelDeploy()
    expect(B().active).toBe(true)
  })
})

describe('entering BUILD mode from a hyperspace view', () => {
  it('takes the camera back, so the gibson field returns and no second bar offers RETURN', () => {
    useHyperspace.setState({ viewOwned: true, scrubHeight: 3, viewedStop: 3, returnScaleExp: 52 })
    S().focusOn({ x: 0n, y: 0n, z: 0n }, 0, 'EARTH', 52)
    B().enter('build')
    const hs = useHyperspace.getState()
    expect(hs.viewOwned).toBe(false)
    expect(hs.scrubHeight).toBeNull()
    expect(B().active).toBe(true)
  })
})

describe('leaving while a deploy is lined up', () => {
  it('is refused by EXIT, EXIT BUILD and B alike (they all call the store)', () => {
    useShards.getState().startDeployMessage('wait for me')
    B().exit()
    expect(B().active).toBe(true)
    B().toggle()
    expect(B().active).toBe(true)
    expect(useShards.getState().pending).not.toBeNull()
    useShards.getState().cancelDeploy()
  })
})

describe('one hide at a time', () => {
  it('a second press while the first is hiding signs nothing more and adds nothing', async () => {
    const shard = benchShard()
    B().enter('build')
    up(1)
    const signed: EventTemplate[] = []
    const real = S().signEvent
    useCyberspace.setState({ signEvent: async (t, p) => { signed.push(t); return real(t, p) } })
    useShards.getState().startDeployShard(shard.id)
    const first = useShards.getState().deploy()
    const second = useShards.getState().deploy()
    await Promise.all([first, second])
    useCyberspace.setState({ signEvent: real })
    expect(useShards.getState().mine).toHaveLength(1)
    // One item and one bag.
    expect(signed).toHaveLength(2)
  })
})

describe('the BuildBar warning', () => {
  it('is for a move still going, not a paused or failed route', () => {
    expect(moveUnderWay({ proof: { status: 'computing' }, plan: null })).toBe(true)
    expect(moveUnderWay({ proof: { status: 'idle' }, plan: { status: 'running' } })).toBe(true)
    expect(moveUnderWay({ proof: { status: 'idle' }, plan: { status: 'paused' } })).toBe(false)
    expect(moveUnderWay({ proof: { status: 'infeasible' }, plan: { status: 'failed' } })).toBe(false)
  })
})

describe('PLACE OBJECT with no models yet', () => {
  it('OPEN WORKSHOP leaves BUILD mode as EXIT does and opens the workshop', () => {
    useWorkshop.setState({ shards: [], currentId: null, open: false })
    B().enter('build')
    up(2)
    useStash.getState().openModels()
    openWorkshopFromPicker()
    expect(B().active).toBe(false)
    expect(useStash.getState().models).toBe(false)
    expect(useWorkshop.getState().open).toBe(true)
    // As EXIT: the view stays where the build cursor left it.
    expect(S().focus?.drive).toBe(true)
    useWorkshop.setState({ open: false })
  })
})
