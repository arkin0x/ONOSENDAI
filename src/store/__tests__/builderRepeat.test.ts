/**
 * builderRepeat.test.ts - placing the same thing again (arkinox, 2026-10-23:
 * "When in build mode after I place something, I'd actually like build to
 * default to that same object so I can place another one. Switching the
 * object should be a choice" and "Maintain the scale and other settings from
 * the previous placement so we don't have to readjust every time").
 *
 * A placement lines the same thing up again with every setting it went out
 * with and the STEP kept (useShards `placedLast`); a copy exactly on top of
 * the last one is refused; switching is CANCEL and PLACE OBJECT; CANCEL
 * stands the copy down where a placement used to leave you and PLACE AGAIN
 * brings it back; a failed placement keeps everything. A key, a chest, a
 * message with cashu in it, a move and an aim into a chest do not repeat.
 * Relays are mocked; nothing is published.
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

import { newShard, type ShardModel, type ShardPayload } from 'sno-core/shards'
import { forgeKey } from '../../lib/chests'
import { moveDirection } from '../../lib/moves'
import { useStash } from '../../hud/stash'
import { stepBuild } from '../buildStep'
import { editPlaced, useBuilder } from '../useBuilder'
import { useCyberspace } from '../useCyberspace'
import { useInventory } from '../useInventory'
import { againName, repeatable, useShards, type DeployPending } from '../useShards'
import { useToast } from '../useToast'
import { useWorkshop } from '../useWorkshop'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useShards.getState()
const B = () => useBuilder.getState()
const C = () => useCyberspace.getState()
const up = (n = 1): void => { for (let i = 0; i < n; i++) C().moveCursor(moveDirection(C().axes(), 'up')) }

function model(name: string, unit: number): ShardModel {
  return {
    ...newShard(name),
    unit,
    vertices: [
      { p: [0, 0, 0], c: [1, 0, 0] },
      { p: [2, 0, 0], c: [0, 1, 0] },
      { p: [0, 1, 0], c: [0, 0, 1] },
    ],
    faces: [[0, 1, 2]],
  }
}

/** Two models on the bench: the one placed, and one to switch to. */
function bench(): { lantern: ShardModel; pebble: ShardModel } {
  const lantern = model('Lantern', 12)
  const pebble = model('Pebble', 3)
  useWorkshop.setState({ shards: [lantern, pebble], currentId: lantern.id })
  return { lantern, pebble }
}

const payloadOf = (i: number): ShardPayload => JSON.parse(S().mine[i].inner.content) as ShardPayload
const coin = 'cashuA' + btoa(JSON.stringify({ token: [{ mint: 'https://mint.example', proofs: [{ id: '00ad', amount: 21, secret: 'a', C: '02aa' }] }], unit: 'sat' })).replace(/=+$/, '')

beforeEach(async () => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, placedLast: null, chestBack: null, workshopBack: null, deployHeight: 0, deployUnit: 0, deployTurn: [0, 0, 0], deployStatus: 'idle', deployError: null })
  B().exit()
  useBuilder.setState({ itemDraft: null, messageDraft: null })
  useStash.setState({ models: false, chest: false, returnToModels: false, returnToFeed: false, returnToChest: false })
  useWorkshop.setState({ open: false })
  useInventory.setState({ owner: C().identity.pubkey, items: {}, storage: 'memory' })
  useToast.getState().dismiss()
  C().clearFocus()
  useCyberspace.setState({ live: false, scaleExp: 6, buildStep: null })
  vi.spyOn(console, 'warn').mockImplementation(() => { /* IndexedDB is absent here */ })
  await placeSpawn()
  // Building somewhere: BUILD on, the cursor off your avatar.
  B().enter('build')
  up(2)
})

describe('a placement lines the same thing up again', () => {
  it('placing twice in a row places the same model twice without picking it again', async () => {
    const { lantern } = bench()
    useStash.getState().openModels()
    useStash.getState().deployModel(lantern.id)
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().mine).toHaveLength(1)
    // Lined up again at once: the same model, in BUILD mode, and the Models
    // modal does not jump back up.
    expect(S().pending).toMatchObject({ type: 'shard', shardId: lantern.id })
    expect(B().active).toBe(true)
    expect(useStash.getState().models).toBe(false)
    expect(S().placedLast?.count).toBe(1)

    up(1)
    await S().deploy()
    expect(S().mine).toHaveLength(2)
    expect(S().mine.map((d) => d.shard?.name)).toEqual(['Lantern', 'Lantern'])
    expect(S().mine[0].at).not.toEqual(S().mine[1].at)
    expect(S().placedLast?.count).toBe(2)
    expect(S().pending).toMatchObject({ type: 'shard', shardId: lantern.id })
  })

  it('a changed scale, turn, height and STEP carry over to the second placement', async () => {
    const { lantern } = bench()
    useStash.getState().deployModel(lantern.id)
    S().setDeployUnit(20)
    S().turnDeploy(1)
    S().turnDeploy(2)
    useShards.setState({ deployHeightAuto: false })
    S().setDeployHeight(3)
    stepBuild(-1)
    const step = C().buildStep
    expect(step).not.toBeNull()
    await S().deploy()
    expect(S().deployError).toBeNull()

    // Nothing reset: the bar is as it was when it placed.
    expect(S().deployUnit).toBe(20)
    expect(S().deployTurn).toEqual([0, 1, 1])
    expect(S().deployHeight).toBe(3)
    expect(S().deployHeightAuto).toBe(false)
    expect(C().buildStep).toBe(step)

    up(4)
    await S().deploy()
    expect(S().mine).toHaveLength(2)
    expect(payloadOf(0).unit).toBe(20)
    expect(payloadOf(1).unit).toBe(20)
    expect(S().mine[1].height).toBe(3)
    // Turned the same way both times, and not as built.
    expect(S().mine[1].shard?.vertices).toEqual(S().mine[0].shard?.vertices)
    expect(S().mine[1].shard?.vertices).not.toEqual(lantern.vertices)
    // The bench's own model is untouched.
    expect(useWorkshop.getState().shards[0].unit).toBe(12)
  })

  it('refuses a copy exactly on top of the last one, and places once something changes', async () => {
    const { lantern } = bench()
    useStash.getState().deployModel(lantern.id)
    await S().deploy()
    // A second press, or Space held: nothing more.
    await S().deploy()
    await S().deploy()
    expect(S().mine).toHaveLength(1)
    // The same spot, turned: a different placement, so it goes.
    S().turnDeploy(0)
    await S().deploy()
    expect(S().mine).toHaveLength(2)
  })

  it('a failed placement keeps the object and every setting', async () => {
    const { lantern } = bench()
    useStash.getState().deployModel(lantern.id)
    S().setDeployUnit(18)
    const lined = S().pending
    const real = C().signEvent
    useCyberspace.setState({ signEvent: async () => { throw new Error('the signer is gone') } })
    await S().deploy()
    useCyberspace.setState({ signEvent: real })
    expect(S().deployStatus).toBe('error')
    expect(S().pending).toBe(lined)
    expect(S().deployUnit).toBe(18)
    expect(S().mine).toHaveLength(0)
    await S().deploy()
    expect(S().mine).toHaveLength(1)
    expect(S().pending).toMatchObject({ type: 'shard', shardId: lantern.id })
  })
})

describe('switching, canceling and leaving', () => {
  it('a switch is honored: CANCEL, then PLACE OBJECT, and the new pick starts at its own settings', async () => {
    const { lantern, pebble } = bench()
    useStash.getState().deployModel(lantern.id)
    S().setDeployUnit(20)
    await S().deploy()
    S().cancelDeploy(true)
    // Stood down where a placement leaves you: BUILD mode, no Models modal.
    expect(S().pending).toBeNull()
    expect(B().active).toBe(true)
    expect(useStash.getState().models).toBe(false)

    useStash.getState().openModels()
    useStash.getState().deployModel(pebble.id)
    expect(S().pending).toMatchObject({ type: 'shard', shardId: pebble.id })
    expect(S().deployUnit).toBe(3)
    up(1)
    await S().deploy()
    expect(S().mine.map((d) => d.shard?.name)).toEqual(['Lantern', 'Pebble'])
    expect(S().pending).toMatchObject({ type: 'shard', shardId: pebble.id })
  })

  it('CANCEL keeps the selection: PLACE AGAIN lines it up with its settings and STEP', async () => {
    const { lantern } = bench()
    useStash.getState().deployModel(lantern.id)
    S().setDeployUnit(22)
    S().turnDeploy(1)
    stepBuild(-1)
    const step = C().buildStep
    await S().deploy()
    S().cancelDeploy(true)
    expect(S().pending).toBeNull()
    expect(C().buildStep).toBeNull()
    expect(againName(S())).toBe('Lantern')

    expect(S().placeAgain()).toBe(true)
    expect(S().pending).toMatchObject({ type: 'shard', shardId: lantern.id })
    expect(S().deployUnit).toBe(22)
    expect(S().deployTurn).toEqual([0, 1, 0])
    expect(C().buildStep).toBe(step)
    // Still on the last one's spot: refused until it moves.
    await S().deploy()
    expect(S().mine).toHaveLength(1)
    up(1)
    await S().deploy()
    expect(S().mine).toHaveLength(2)
    expect(payloadOf(1).unit).toBe(22)
  })

  it('CANCEL before anything is placed still goes back to the Models modal', () => {
    const { lantern } = bench()
    useStash.getState().openModels()
    useStash.getState().deployModel(lantern.id)
    S().cancelDeploy(true)
    expect(useStash.getState().models).toBe(true)
    expect(S().placedLast).toBeNull()
    expect(S().placeAgain()).toBe(false)
  })

  it('from the workshop: the copy CANCELs to BUILD mode, not back to the bench', async () => {
    const { lantern } = bench()
    B().exit()
    S().startDeployShard(lantern.id, 'workshop')
    up(2)
    await S().deploy()
    expect(S().pending).toMatchObject({ type: 'shard', shardId: lantern.id })
    expect(S().pending).not.toHaveProperty('from')
    S().cancelDeploy(true)
    expect(B().active).toBe(true)
    expect(useWorkshop.getState().open).toBe(false)
  })

  it('leaving works as before once the copy is stood down, and the next session starts fresh', async () => {
    const { lantern } = bench()
    useStash.getState().deployModel(lantern.id)
    await S().deploy()
    // EXIT is refused while anything is lined up, a copy too.
    B().exit()
    expect(B().active).toBe(true)
    S().cancelDeploy(true)
    B().exit()
    expect(B().active).toBe(false)
    expect(S().placedLast).toBeNull()
    expect(S().pending).toBeNull()
    expect(againName(S())).toBeNull()
  })

  it('a DEPLOY that never left your avatar still ends with its placement, nothing lined up', async () => {
    const { lantern } = bench()
    B().exit()
    C().clearFocus()
    S().startDeployShard(lantern.id)
    expect(B().via).toBe('deploy')
    expect(B().leftAvatar).toBe(false)
    await S().deploy()
    expect(S().pending).toBeNull()
    expect(B().active).toBe(false)
    expect(C().atHead()).toBe(true)
  })

  it('BUILD mode ending while it hides: nothing lined up again, and the mode stays off', async () => {
    const { lantern } = bench()
    useStash.getState().deployModel(lantern.id)
    const hiding = S().deploy()
    expect(S().deployStatus).toBe('working')
    // A tap on the globe.
    C().focusOn(C().position, 0, 'EARTH · 1, 2')
    expect(B().active).toBe(false)
    await hiding
    expect(S().mine).toHaveLength(1)
    expect(S().pending).toBeNull()
    expect(B().active).toBe(false)
    expect(S().placedLast).toBeNull()
  })

  it('EDIT on a placed shard stands the lined-up copy down and moves that one', async () => {
    const { lantern } = bench()
    useStash.getState().deployModel(lantern.id)
    await S().deploy()
    const placed = S().mine[0].eventId
    editPlaced(placed)
    expect(S().pending).toMatchObject({ type: 'shard', edit: { eventId: placed } })
  })
})

describe('what does not repeat', () => {
  it('a key: its secret would be hidden twice', async () => {
    S().startDeployKey(forgeKey('Wind Key'))
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().mine).toHaveLength(1)
    expect(S().pending).toBeNull()
    expect(B().active).toBe(true)
  })

  it('a chest: its contents are sealed once', async () => {
    const lock = forgeKey('Wind Key')
    S().startDeployChest({ name: 'Wind Chest', lock: { pubkey: lock.itemPubkey, label: 'Wind Key' }, requires: '', contents: [{ kind: 'message', text: 'north' }] })
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().mine).toHaveLength(1)
    expect(S().pending).toBeNull()
  })

  it('a message with cashu in it: the same token twice is the same money twice', async () => {
    S().startDeployMessage(`for whoever finds this ${coin}`)
    await S().deploy()
    expect(S().mine).toHaveLength(1)
    expect(S().pending).toBeNull()
  })

  it('a plain message does repeat', async () => {
    S().startDeployMessage('you are here')
    await S().deploy()
    expect(S().pending).toEqual({ type: 'message', text: 'you are here' })
    up(1)
    await S().deploy()
    expect(S().mine.map((d) => d.text)).toEqual(['you are here', 'you are here'])
  })

  it('a move (EDIT): the shard stands where it was put', async () => {
    const { lantern } = bench()
    useStash.getState().deployModel(lantern.id)
    await S().deploy()
    editPlaced(S().mine[0].eventId)
    up(3)
    await S().deploy()
    expect(S().deployError).toBeNull()
    expect(S().pending).toBeNull()
    expect(S().mine).toHaveLength(1)
  })

  it('an aim into a chest: the chest goes back to its composer', async () => {
    const { lantern } = bench()
    useStash.getState().aimIntoChest({ name: 'Wind Chest', lock: null, requires: '', contents: [{ kind: 'shard', shardId: lantern.id }] }, 0)
    await S().deploy()
    expect(S().pending).toBeNull()
    expect(useStash.getState().chest).toBe(true)
  })

  it('repeatable says so for every type', () => {
    const shard: DeployPending = { type: 'shard', shardId: 'x' }
    expect(repeatable(shard)).toBe(true)
    expect(repeatable({ ...shard, from: 'workshop' })).toBe(true)
    expect(repeatable({ ...shard, edit: { eventId: 'x' } })).toBe(false)
    expect(repeatable({ ...shard, intoChest: { draft: { name: 'c', lock: null, requires: '', contents: [] }, contentIndex: 0 } })).toBe(false)
    expect(repeatable({ type: 'message', text: 'hi' })).toBe(true)
    expect(repeatable({ type: 'message', text: `hi ${coin}` })).toBe(false)
    expect(repeatable({ type: 'key', key: forgeKey('k') })).toBe(false)
    expect(repeatable({ type: 'chest', name: 'c', lock: null, requires: '', contents: [] })).toBe(false)
  })
})
