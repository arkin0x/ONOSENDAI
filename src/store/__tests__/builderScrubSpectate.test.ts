/**
 * builderScrubSpectate.test.ts - the chain explorer and spectating in BUILD
 * mode (arkinox, 2026-10-08):
 *
 * - "Chain ui chip comes back; scrubbing a chain moves the build cursor to
 *   that chain position": a step along a chain, yours or a spectated
 *   avatar's, aims the build cursor at that action, in its plane, and
 *   changes nothing about your own chain. It never sets your head, signs,
 *   or brings back the movement controls.
 * - "Spectating should be allowed in build mode and shouldnt end it. Then
 *   you can scrub thru other avatars chains and build near them.": spectate
 *   start and end keep BUILD mode on, a deploy while spectating lands at the
 *   build cursor in the plane on screen, and the auto-exits that protect
 *   correctness (a respawn, a ride arriving, the relays' chain, an identity
 *   switch) still end it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

// The spectated chain comes from here instead of a relay; the live watch is
// a no-op. mergeEvents and the rest stay real.
const relayChain: { events: NostrEvent[] } = { events: [] }
// Every watch opened, by pubkey, with its close, so a test can see it closed.
const watches: Array<{ pubkey: string; close: ReturnType<typeof vi.fn> }> = []
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: vi.fn(async () => relayChain.events),
  watchAuthor: vi.fn((pubkey: string) => { const close = vi.fn(); watches.push({ pubkey, close }); return close }),
}))

import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { coordToXyz, hexToCoord } from 'cyberspace-core'
import { newShard, type ShardModel } from 'sno-core/shards'
import { hopTemplate, spawnTemplate, ACTION_KIND, type EventTemplate, type NostrEvent } from '../../lib/events'
import { useCyberspace } from '../useCyberspace'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { useToast } from '../useToast'
import { stepChain, useBuilder, walkChain } from '../useBuilder'
import { spectate, stopSpectating } from '../../lib/spectator'
import { avatarInBuild, buildCursorOf, buildPlane, cubeAt } from '../../lib/buildCursor'
import { deployPoint } from '../../lib/space'
import { placeSpawn } from '../fixtures/placeSpawn'

const S = () => useCyberspace.getState()
const B = () => useBuilder.getState()

// Someone else's chain: spawn, two hops along +x, then a hop into the other plane.
const sk = generateSecretKey()
const pk = getPublicKey(sk)
const theirSpawn = coordToXyz(hexToCoord(pk))
const spawnEv = finalizeEvent(spawnTemplate(pk, 100), sk)
function hop(prev: NostrEvent, at: number, dx: bigint, flip = false): NostrEvent {
  const prevC = prev.tags.find((t) => t[0] === 'C')![1]
  const from = coordToXyz(hexToCoord(prevC))
  return finalizeEvent(hopTemplate({
    createdAt: at, genesisId: spawnEv.id, previousId: prev.id, prevCoordHex: prevC,
    to: { x: from.x + dx, y: from.y, z: from.z }, plane: flip ? (from.plane === 0 ? 1 : 0) : from.plane, proofHash: '1'.repeat(64),
  }), sk)
}
const h1 = hop(spawnEv, 110, 1n)
const h2 = hop(h1, 120, 1n)
const h3 = hop(h2, 130, 1n, true)

/** A move landing on your own chain, as a finished proof writes it. */
async function land(dx: bigint): Promise<void> {
  const s = S()
  useCyberspace.setState({ pendingTarget: { ...s.position, x: s.position.x + dx } })
  await s.applyProofMessage({
    type: 'done', id: 0, mode: 'hop', elapsedMs: 1, proofHash: 'ab'.repeat(32),
    terrainK: 8, lca: { x: 1, y: 0, z: 0 }, totalOps: 1,
  })
}

/** Everything about you that a move would change. */
function chainSnapshot() {
  const s = S()
  return { position: { ...s.position }, events: s.events.length, prev: s.prevEventId, genesis: s.genesisId, headPlane: s.headPlane, plane: s.plane, plan: s.plan, pendingTarget: s.pendingTarget, proof: s.proof.status }
}

function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Marker'),
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

let signed: EventTemplate[] = []
let realSign: ReturnType<typeof S>['signEvent']

beforeAll(async () => {
  // Your own chain: spawn, +1, +2, +3 along x.
  await placeSpawn()
  await land(1n); await land(1n); await land(1n)
})

beforeEach(() => {
  relayChain.events = [spawnEv, h1, h2, h3]
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  B().exit()
  stopSpectating()
  S().explore(null)
  S().clearFocus()
  S().adjustScale(-S().scaleExp)
  useToast.getState().dismiss()
  useCyberspace.setState({ live: false })
  signed = []
  realSign = S().signEvent
  useCyberspace.setState({ signEvent: async (t, patience) => { signed.push(t); return realSign(t, patience) } })
})

afterEach(() => {
  useCyberspace.setState({ signEvent: realSign })
  useShards.setState({ pending: null, deployStatus: 'idle' })
  B().exit()
  stopSpectating()
  S().clearFocus()
})

describe('scrubbing your own chain in BUILD mode', () => {
  it('moves the build cursor to the scrubbed action and changes nothing about your chain', async () => {
    B().enter('build')
    const before = chainSnapshot()
    const chain = S().focusChain()
    expect(chain).toHaveLength(4)

    walkChain(1)
    expect(B().active).toBe(true)
    expect(B().scrub).toBe(1)
    expect(buildCursorOf(S())).toEqual({ position: chain[1].position, plane: chain[1].plane })
    // Not history: the scene stays on the build cursor, which still drives.
    expect(S().exploreIndex).toBeNull()
    expect(S().atHead()).toBe(false)
    expect(S().canDrive()).toBe(true)

    // [ and ]: one action back, clamped at the spawn; forward past the end is the head.
    stepChain(-1)
    expect(B().scrub).toBe(0)
    expect(S().cursor).toEqual(chain[0].position)
    stepChain(-1)
    expect(B().scrub).toBe(0)
    stepChain(50)
    expect(B().scrub).toBeNull()
    expect(S().cursor).toEqual(chain[3].position)
    // Home and End.
    walkChain(0)
    expect(S().cursor).toEqual(chain[0].position)
    walkChain(null)
    expect(S().cursor).toEqual(S().position)

    // Nothing to sign, no head set, no move lined up; and COMMIT stays away.
    walkChain(2)
    await S().commit()
    expect(signed).toEqual([])
    expect(chainSnapshot()).toEqual(before)
    expect(S().atHead()).toBe(false)
  })

  it('leaves the cursor where the last scrubbed action put it, and the pad carries on from there', () => {
    B().enter('build')
    walkChain(1)
    const at = { ...S().cursor }
    S().moveCursor({ axis: 'y', dir: 1 })
    expect(S().cursor).toEqual({ ...at, y: at.y + 1n })
    // The mark stays, so ] carries on from the action last aimed at.
    expect(B().scrub).toBe(1)
    stepChain(1)
    expect(S().cursor).toEqual(S().focusChain()[2].position)
  })

  it('outside BUILD mode the same steps still walk history, as they always have', () => {
    walkChain(1)
    expect(S().exploreIndex).toBe(1)
    expect(B().active).toBe(false)
    stepChain(1)
    expect(S().exploreIndex).toBe(2)
  })
})

describe('spectating in BUILD mode', () => {
  it('does not end BUILD mode: the build cursor goes to them and the pad still drives it', async () => {
    B().enter('build')
    const before = chainSnapshot()
    const pending = spectate(pk)
    // While the chain loads: at their spawn.
    expect(B().active).toBe(true)
    expect(S().spectate?.pubkey).toBe(pk)
    expect(S().cursor).toEqual({ x: theirSpawn.x, y: theirSpawn.y, z: theirSpawn.z })
    await pending
    // Their chain arrived: at their head, in its plane.
    const theirs = S().focusChain()
    expect(theirs.map((a) => a.id)).toEqual([spawnEv.id, h1.id, h2.id, h3.id])
    expect(B().active).toBe(true)
    expect(buildCursorOf(S())).toEqual({ position: theirs[3].position, plane: theirs[3].plane })
    // Build near them: the pad moves the build cursor while spectating.
    S().moveCursor({ axis: 'z', dir: 1 })
    expect(S().cursor).toEqual({ ...theirs[3].position, z: theirs[3].position.z + 1n })
    // Read-only throughout.
    expect(signed).toEqual([])
    expect(chainSnapshot()).toEqual(before)
  })

  it('scrubbing their chain aims the build cursor at their actions, plane included, and never touches yours', async () => {
    B().enter('build')
    const before = chainSnapshot()
    await spectate(pk)
    const theirs = S().focusChain()
    expect(theirs[3].plane).not.toBe(theirs[2].plane)
    walkChain(2)
    expect(buildCursorOf(S())).toEqual({ position: theirs[2].position, plane: theirs[2].plane })
    stepChain(1)
    expect(buildCursorOf(S())).toEqual({ position: theirs[3].position, plane: theirs[3].plane })
    walkChain(0)
    expect(S().cursor).toEqual(theirs[0].position)
    expect(S().exploreIndex).toBeNull()
    expect(S().spectate?.pubkey).toBe(pk)
    expect(B().active).toBe(true)
    await S().commit()
    expect(signed).toEqual([])
    expect(chainSnapshot()).toEqual(before)
  })

  it('END SPECTATION keeps BUILD mode on with the build cursor where it is', async () => {
    B().enter('build')
    await spectate(pk)
    walkChain(1)
    S().moveCursor({ axis: 'x', dir: -1 })
    const at = { ...S().cursor }
    const plane = buildPlane(S())
    stopSpectating()
    expect(S().spectate).toBeNull()
    expect(B().active).toBe(true)
    expect(buildCursorOf(S())).toEqual({ position: at, plane })
    // The mark was an index into their chain; your own is on show now.
    expect(B().scrub).toBeNull()
    expect(useToast.getState().toast).toBeNull()
  })

  it('a deploy while spectating lands at the build cursor, in the plane on screen, and moves nothing', async () => {
    const shard = benchShard()
    B().enter('build')
    const before = chainSnapshot()
    await spectate(pk)
    walkChain(1)
    S().moveCursor({ axis: 'y', dir: 1 })
    const aim = buildCursorOf(S())
    useShards.getState().startDeployShard(shard.id)
    await useShards.getState().deploy()
    expect(useShards.getState().deployStatus).toBe('done')
    const mine = useShards.getState().mine
    expect(mine).toHaveLength(1)
    const want = deployPoint(aim.position, S().scaleExp, 0)
    expect(mine[0].at).toEqual({ x: want.x.toString(), y: want.y.toString(), z: want.z.toString() })
    expect(mine[0].plane).toBe(aim.plane)
    // The item and its bag are signed; never a movement action.
    expect(signed.length).toBeGreaterThan(0)
    expect(signed.every((t) => t.kind !== ACTION_KIND)).toBe(true)
    expect(chainSnapshot()).toEqual(before)
    // Still spectating, still building.
    expect(S().spectate?.pubkey).toBe(pk)
    expect(B().active).toBe(true)
  })

  it('entering BUILD while spectating keeps the spectation and starts on the action on screen', async () => {
    await spectate(pk)
    S().explore(1)
    const theirs = S().focusChain()
    B().enter('build')
    expect(B().active).toBe(true)
    expect(S().spectate?.pubkey).toBe(pk)
    expect(S().exploreIndex).toBeNull()
    expect(B().scrub).toBe(1)
    expect(buildCursorOf(S())).toEqual({ position: theirs[1].position, plane: theirs[1].plane })
  })

  it('EXIT while spectating goes back to plain spectating, at the action last aimed at', async () => {
    B().enter('build')
    await spectate(pk)
    walkChain(2)
    const theirs = S().focusChain()
    const cursorHome = { ...S().position }
    B().exit()
    expect(B().active).toBe(false)
    expect(S().focus).toBeNull()
    expect(S().spectate?.pubkey).toBe(pk)
    expect(S().exploreIndex).toBe(2)
    expect(S().anchor).toEqual(theirs[2].position)
    // The cursor that went out with the view is home again, and nothing drives.
    expect(S().cursor).toEqual(cursorHome)
    expect(S().canDrive()).toBe(false)
  })
})

describe('review of #235', () => {
  it('SHOULD-FIX 1: RETURN TO AVATAR drops the mark, and your own avatar always stands at your true head', () => {
    B().enter('build')
    walkChain(1)
    expect(B().scrub).toBe(1)
    // While the mark is on a past action of your own chain, your avatar is
    // still drawn where you stand: only the build cursor went there.
    expect(avatarInBuild(S(), B().scrub)).toEqual({ position: S().position, plane: S().headPlane })
    B().toAvatar()
    expect(B().scrub).toBeNull()
    expect(S().cursor).toEqual(S().position)
    expect(B().active).toBe(true)
  })

  it('SHOULD-FIX 1: a spectated avatar stands at the aimed action, or their head', async () => {
    B().enter('build')
    await spectate(pk)
    const theirs = S().focusChain()
    walkChain(1)
    expect(avatarInBuild(S(), B().scrub)?.position).toEqual(theirs[1].position)
    walkChain(null)
    expect(avatarInBuild(S(), B().scrub)?.position).toEqual(theirs[3].position)
  })

  it('NIT 3: their chain replaced under the mark (a respawn) drops the mark, so their avatar shows at the new head', async () => {
    B().enter('build')
    await spectate(pk)
    walkChain(2)
    expect(B().scrub).toBe(2)
    const respawned = finalizeEvent(spawnTemplate(pk, 200), sk)
    S().setSpectateChain(pk, [spawnEv, h1, h2, h3, respawned])
    expect(S().focusChain().map((a) => a.id)).toEqual([respawned.id])
    expect(B().scrub).toBeNull()
    expect(avatarInBuild(S(), B().scrub)?.position).toEqual(S().focusChain()[0].position)
  })

  it('NIT 4: switching spectations in BUILD keeps the camera you had before the first one', async () => {
    const original = S().view.clone()
    B().enter('build')
    await spectate(pk)
    S().rotate('left')
    expect(S().view.equals(original)).toBe(false)
    await spectate(getPublicKey(generateSecretKey()))
    B().exit()
    stopSpectating()
    expect(S().view.equals(original)).toBe(true)
  })

  it('NIT 5: choosing the relays\' version of your chain ends the mode as your avatar moved, not as the view moving', () => {
    B().enter('build')
    const dest = { x: S().position.x + 7n, y: S().position.y, z: S().position.z }
    // What resolveHeldConflict('relay') writes: a new chain, and no view.
    useCyberspace.setState({ prevEventId: 'relay-head', genesisId: 'relay-genesis', position: dest, cursor: { ...dest }, anchor: { ...dest }, spectate: null, focus: null })
    expect(B().active).toBe(false)
    expect(useToast.getState().toast?.meta).toMatch(/Your avatar was moved under it/)
  })

  it('PRE-EXISTING (a): in BUILD the cube is the build cursor, not a pending move\'s target', () => {
    B().enter('build')
    S().moveCursor({ axis: 'x', dir: 1 })
    const pending = { ...S().position, y: S().position.y + 9n }
    useCyberspace.setState({ pendingTarget: pending })
    try {
      expect(cubeAt(S(), B().active)).toEqual(S().cursor)
      // At your head the cube still shows a computing move's target.
      expect(cubeAt({ ...S(), canDrive: () => true }, false)).toEqual(pending)
    } finally {
      useCyberspace.setState({ pendingTarget: null })
    }
  })

  it('PRE-EXISTING (b): a view that replaces a spectation closes the relay watch', async () => {
    await spectate(pk)
    const watch = watches.filter((w) => w.pubkey === pk).at(-1)!
    expect(watch.close).not.toHaveBeenCalled()
    S().focusOn({ ...S().position }, 0, 'a shard')
    expect(S().spectate).toBeNull()
    expect(watch.close).toHaveBeenCalledTimes(1)
  })

})

describe('the auto-exits that protect correctness still end BUILD mode while spectating', () => {
  it('a ride arriving (a new head that also writes the cursor)', async () => {
    B().enter('build')
    await spectate(pk)
    const dest = { x: S().position.x + 100n, y: S().position.y, z: S().position.z }
    useCyberspace.setState({ prevEventId: 'ride-event', position: dest, cursor: { ...dest }, anchor: { ...dest } })
    expect(B().active).toBe(false)
    expect(useToast.getState().toast?.label).toBe('BUILD MODE ENDED')
    // No free view is left standing beside the spectation without the mode.
    expect(S().focus).toBeNull()
    expect(S().canDrive()).toBe(false)
  })

  it('a respawn', async () => {
    B().enter('build')
    await spectate(pk)
    await S().respawn()
    expect(B().active).toBe(false)
    expect(useToast.getState().toast?.meta).toMatch(/Your avatar was moved under it/)
    expect(S().focus).toBeNull()
  })

  it('a view somewhere you cannot build from (an Earth tap)', async () => {
    B().enter('build')
    await spectate(pk)
    S().focusOn(S().position, 0, 'EARTH · 1, 2')
    expect(B().active).toBe(false)
  })

  // Last in the file: it replaces the identity the rest of it builds on.
  it('an identity switch, with its own reason in the toast (review of #235, NIT 5)', async () => {
    B().enter('build')
    await spectate(pk)
    await S().useNewKey()
    expect(B().active).toBe(false)
    expect(S().spectate).toBeNull()
    expect(useToast.getState().toast?.meta).toMatch(/You switched identity/)
  })
})
