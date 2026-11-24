/**
 * buildExitToHop.test.ts - every way out of BUILD lands in HOP (arkinox,
 * 2026-11-17: "I don't like how exiting build mode goes into a nonstandard
 * VIEW mode. It should just go back to HOP.").
 *
 * Before, leaving BUILD off your avatar left BUILD's driven view standing:
 * not the standard VIEW (no `view` flag), not HOP either (the cursor off
 * your head, COMMIT hidden, a RETURN TO AVATAR bar). Now each way out ends
 * that view, back at the zoom you had before BUILD (or kept, on your
 * avatar), with nothing of BUILD's left behind and nothing the view came
 * from reopening. The hand-off to SCAN and the explicit VIEW flows are
 * unchanged.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // No relay is ever dialed from here: a socket that never opens.
  ;(globalThis as { WebSocket?: unknown }).WebSocket = class {
    static OPEN = 1
    readyState = 0
    onopen = null; onclose = null; onerror = null; onmessage = null
    send(): void {}
    close(): void {}
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})

vi.mock('../../lib/workers', () => ({ postProof: vi.fn(), cancelProof: vi.fn(), setProofHandler: vi.fn() }))
vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))
vi.mock('../../lib/chains', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/chains')>()),
  fetchChainEvents: vi.fn(async () => []),
  confirmChainEvents: vi.fn(async () => []),
  watchAuthor: vi.fn(() => () => {}),
}))

import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { newShard, type ShardModel } from 'sno-core/shards'
import { useCyberspace, VIEW_FOCUS_LABEL } from '../useCyberspace'
import { BUILD_FOCUS_LABEL, useBuilder } from '../useBuilder'
import { useSecrets } from '../useSecrets'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import { useWalk } from '../useWalk'
import { useScan } from '../useScan'
import { useRegion } from '../useRegion'
import { applyArrivalMode } from '../arrivalMode'
import { buildToHop, currentPadMode, cycleMode, enterWalk, leaveWalk } from '../padMode'
import { escapeTop, topEscape } from '../../hooks/useEscape'
import { viewingLabel } from '../../hud/FocusBar'
import { spectate, stopSpectating } from '../../lib/spectator'
import { leavePlanting } from '../../tutorial/director'
import { placeSpawn } from '../fixtures/placeSpawn'
import type { Position } from '../../lib/space'

const S = () => useCyberspace.getState()
const B = () => useBuilder.getState()

/** A shard on the bench with enough geometry to deploy. */
function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Beacon'),
    vertices: [
      { p: [0, 0, 0], c: [1, 0, 0] },
      { p: [1, 0, 0], c: [0, 1, 0] },
      { p: [0, 1, 0], c: [0, 0, 1] },
    ],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id, open: false })
  return shard
}

/** The zoom HOP is at before BUILD starts in each test. */
const HOP_ZOOM = 2

/** BUILD on, zoomed in from HOP's zoom, the build cursor carried off your avatar, a finer STEP and an ADD height set: all of BUILD's own state in use. */
function buildAway(): void {
  B().enter('build')
  S().adjustScale(3)
  for (let i = 0; i < 4; i++) S().moveCursor({ axis: 'x', dir: 1 })
  S().setBuildStep(1)
  useShards.setState({ deployInto: 5 })
  expect(B().leftAvatar).toBe(true)
  expect(S().atHead()).toBe(false)
}

/**
 * Standard HOP at your head, at HOP's zoom from before BUILD, with nothing of
 * BUILD's left behind. `kept`: a switch of mode (B, the ring) leaves the
 * build cursor where it was, as HOP's cursor (owner, 2026-11-24); EXIT, Esc
 * and the rest bring it home.
 */
function expectHop(scaleExp = HOP_ZOOM, kept?: Position): void {
  const s = S()
  expect(B().active).toBe(false)
  expect(currentPadMode()).toBe('hop')
  // No view of any kind: BUILD's driven view is gone, not turned into a VIEW.
  expect(s.focus).toBeNull()
  expect(s.viewing()).toBe(false)
  // So no VIEWING bar with a RETURN TO AVATAR (FocusBar).
  expect(viewingLabel(s.focus, s.cursor, s.anchorPlane)).toBeNull()
  // The camera home at your head, in your plane: COMMIT's controls are back.
  expect(s.atHead()).toBe(true)
  expect(s.cursor).toEqual(kept ?? s.position)
  expect(s.anchor).toEqual(s.position)
  expect(s.anchorPlane).toBe(s.plane)
  expect(s.scaleExp).toBe(scaleExp)
  // BUILD's own state: STEP, the held placement, ADD's height, the Escape chip.
  expect(s.buildStep).toBeNull()
  expect(s.buildExact).toBe(false)
  expect(useShards.getState().deployInto).toBeNull()
  expect(topEscape()).toBeNull()
}

beforeEach(async () => {
  stopSpectating()
  useShards.setState({ mine: [], pending: null, placedLast: null, workshopBack: null, deployStatus: 'idle', deployError: null, deployInto: null })
  useWalk.getState().exit()
  B().exit()
  useScan.getState().exit()
  useRegion.getState().exit()
  S().clearFocus()
  useWorkshop.setState({ open: false })
  await placeSpawn()
  S().cancel()
  useCyberspace.setState({ scaleExp: HOP_ZOOM })
  expect(currentPadMode()).toBe('hop')
})

describe('every way out of BUILD goes back to HOP', () => {
  it('EXIT on the bar', () => {
    buildAway()
    B().exit()
    expectHop()
  })

  it('Escape', () => {
    buildAway()
    expect(escapeTop()).toBe(true)
    expectHop()
  })

  it('B, and the Stash panel BUILD (toggle): a switch of mode, so the cursor stays where it was', () => {
    buildAway()
    const at = { ...S().cursor }
    B().toggle()
    expectHop(HOP_ZOOM, at)
  })

  it('the ring’s way home (buildToHop), as WALK uses it: the cursor stays where it was', () => {
    buildAway()
    const at = { ...S().cursor }
    buildToHop()
    expectHop(HOP_ZOOM, at)
  })

  it('EXIT with a copy lined up after a placement stands the copy down and goes to HOP', () => {
    buildAway()
    const pending = { type: 'message' as const, text: 'again' }
    useShards.setState({ pending, placedLast: { pending } as never })
    B().exit()
    expect(useShards.getState().pending).toBeNull()
    expectHop()
  })

  it('a DEPLOY at your avatar ends with its deploy, in HOP', () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id)
    expect(B().active).toBe(true)
    expect(B().via).toBe('deploy')
    useShards.getState().cancelDeploy()
    expectHop()
  })

  it('CANCEL on a deploy from the workshop: BUILD ends in HOP and the workshop reopens over it', () => {
    const shard = benchShard()
    useShards.getState().startDeployShard(shard.id, 'workshop')
    expect(B().active).toBe(true)
    S().adjustScale(3)
    for (let i = 0; i < 3; i++) S().moveCursor({ axis: 'x', dir: 1 })
    expect(S().atHead()).toBe(false)
    useShards.getState().cancelDeploy(true)
    expectHop()
    expect(useWorkshop.getState().open).toBe(true)
  })

  it('BUILD entered from VIEW still leaves to HOP, not back to VIEW', () => {
    S().viewHere()
    expect(currentPadMode()).toBe('view')
    for (let i = 0; i < 3; i++) S().moveCursor({ axis: 'z', dir: 1 })
    B().enter('build')
    S().adjustScale(3)
    B().exit()
    expectHop()
  })

  it('BUILD entered from a place gone to (a pin, a starred place) leaves to HOP, without the zoom that place chose', () => {
    const p = S().position
    S().viewAt({ x: p.x + 9n, y: p.y, z: p.z }, S().plane, 'somewhere', 9)
    B().enter('build')
    expect(S().focus?.label).toBe('somewhere')
    expect(S().scaleExp).toBe(9)
    B().exit()
    expectHop()
  })

  it('on your avatar, the zoom you are building at stays, since the picture is the same', () => {
    B().enter('build')
    S().adjustScale(4)
    B().exit()
    expectHop(HOP_ZOOM + 4)
  })

  it('nothing the view came from reopens: a Nearby list, a door card, the Secrets list (#675)', () => {
    S().viewHere()
    useShards.getState().setNearbyReturn({ spectate: null, exploreIndex: null, anchor: { ...S().anchor }, anchorPlane: S().anchorPlane })
    useSecrets.getState().focus('some-lookup')
    // B straight from the view, not the ring, which already drops these.
    B().enter('build')
    S().moveCursor({ axis: 'x', dir: 1 })
    B().exit()
    expect(useShards.getState().nearbyReturn).toBeNull()
    expect(useSecrets.getState().focused).toBeNull()
    expectHop()
  })

  it('the tutorial’s bud leaves BUILD to HOP', () => {
    buildAway()
    leavePlanting()
    expectHop()
  })

  it('BUILD entered from WALK leaves to HOP too; WALK is not brought back (the default; flagged for the owner)', () => {
    useWalk.getState().enter()
    expect(currentPadMode()).toBe('walk')
    const zoom = S().scaleExp
    B().enter('build')
    expect(currentPadMode()).toBe('build')
    B().exit()
    expect(S().walking).toBe(false)
    expectHop(zoom)
  })
})

describe('what leaving BUILD does not change', () => {
  it('a deploy lined up still holds BUILD: CANCEL ends it, not EXIT', () => {
    buildAway()
    useShards.setState({ pending: { type: 'message', text: 'hold' } })
    B().exit()
    expect(B().active).toBe(true)
    expect(S().focus?.label).toBe(BUILD_FOCUS_LABEL)
    useShards.setState({ pending: null })
  })

  it('the ring still goes BUILD to SCAN at the build cursor and zoom, handing the view on without ending it', () => {
    buildAway()
    const at = { ...S().cursor }
    const zoom = S().scaleExp
    // A hand-off never lets the view go to nothing, which would reopen what a view came from.
    let emptied = false
    const off = useCyberspace.subscribe((s, prev) => { if (prev.focus !== null && s.focus === null) emptied = true })
    cycleMode()
    off()
    expect(emptied).toBe(false)
    expect(currentPadMode()).toBe('scan')
    expect(S().cursor).toEqual(at)
    expect(S().scaleExp).toBe(zoom)
    expect(S().viewing()).toBe(true)
  })

  it('WALK from BUILD and back still comes back to BUILD', () => {
    B().enter('build')
    enterWalk()
    expect(currentPadMode()).toBe('walk')
    leaveWalk()
    expect(currentPadMode()).toBe('build')
  })

  it('spectating, leaving BUILD goes back to watching them (there is no HOP there)', async () => {
    const them = getPublicKey(generateSecretKey())
    B().enter('build')
    await spectate(them)
    expect(B().active).toBe(true)
    B().exit()
    expect(B().active).toBe(false)
    expect(S().spectate?.pubkey).toBe(them)
    expect(S().focus).toBeNull()
  })

  it('VIEW from the pad is still the standard VIEW, with its RETURN, when no BUILD is involved', () => {
    S().viewHere()
    for (let i = 0; i < 3; i++) S().moveCursor({ axis: 'x', dir: 1 })
    expect(currentPadMode()).toBe('view')
    expect(S().focus?.label).toBe(VIEW_FOCUS_LABEL)
    expect(S().atHead()).toBe(false)
  })

  it('?mode=view on arrival still opens VIEW, and region mode still starts from it', () => {
    expect(applyArrivalMode('view')).toBe(true)
    expect(currentPadMode()).toBe('view')
    S().clearFocus()
    expect(applyArrivalMode('region')).toBe(true)
    expect(useRegion.getState().active).toBe(true)
    expect(currentPadMode()).toBe('view')
  })
})
