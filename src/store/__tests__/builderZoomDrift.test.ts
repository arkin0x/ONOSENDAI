/**
 * builderZoomDrift.test.ts - a zoom never moves a lined-up placement.
 *
 * arkinox, 2026-11-11: "if I position a shard for placement in build, and
 * then I zoom out, when I zoom back in sometimes the shard has changed
 * position. We can't have this happening. Otherwise, I might zoom out to
 * line it up with a different view, and then placing the shard ends up in
 * the wrong place." The zoom changes the view only: the first zoom puts the
 * build cursor on the placement, which is the cursor itself from then on
 * (useCyberspace `buildExact`), and a move steps one cell of the zoom you
 * are at (coordinator's ruling on the review of #676).
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

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
import { atLastSpot, copyLinedUp, positionOf, spotOf, useShards } from '../useShards'
import type { AudioItem } from '../../lib/audioItem'
import { useWorkshop } from '../useWorkshop'
import { useBuilder } from '../useBuilder'
import { stepBuild } from '../buildStep'
import { buildPlane, buildStepOf, moveStepOf } from '../../lib/buildCursor'
import { BASE_CAPS } from 'sno-core/seeds'
import { ORIGINAL_DNAS } from '../../lib/seeds/originalDnas'
import { seedDraftHeight, seedFitFor } from '../../lib/seeds/plant'
import { cycleMode } from '../padMode'
import { deployPoint, type Position } from '../../lib/space'

const S = () => useCyberspace.getState()
const D = () => useShards.getState()

/** Bits set all the way down, so no cell's center is it by accident. */
const SPOT: Position = { x: (1n << 70n) + 0x1d3c5a7f9n, y: (1n << 60n) + 0x2b4c3n, z: (1n << 72n) + 0x7e5a1n }
/** Exactly the center of a 2^12 cell: the coarse snap and the fine one agree only by luck elsewhere. */
const CENTRE: Position = { x: (5n << 40n) + (1n << 11n), y: (3n << 30n) + (1n << 11n), z: (7n << 50n) + (1n << 11n) }

function benchShard(): ShardModel {
  const shard: ShardModel = {
    ...newShard('Disco floor'),
    unit: 0,
    vertices: [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 1, 0], c: [0, 0, 1] }],
    faces: [[0, 1, 2]],
  }
  useWorkshop.setState({ shards: [shard], currentId: shard.id })
  return shard
}

const placed = (): Position => deployPoint(S().cursor, buildStepOf(S()), D().deployHeight)

function at(spot: Position): void {
  useCyberspace.setState({ position: spot, anchor: spot, cursor: spot })
}

beforeEach(() => {
  useShards.setState({ mine: [], deleted: {}, discovered: {}, pending: null, deployHeight: 0, deployUnit: 0, deployStatus: 'idle', deployError: null })
  useBuilder.getState().exit()
  S().clearFocus()
  useCyberspace.setState({ live: false, position: SPOT, anchor: SPOT, cursor: SPOT, scaleExp: 0, buildStep: null, buildSettle: null, buildExact: false, spectate: null, exploreIndex: null, transit: null })
})

afterEach(() => {
  useShards.setState({ pending: null, deployStatus: 'idle' })
  useBuilder.getState().exit()
  S().clearFocus()
})

/** Zoom by `delta` one press at a time, as the pad and Q / E do. */
function zoom(delta: number): void {
  for (let i = 0; i < Math.abs(delta); i++) S().adjustScale(delta > 0 ? 1 : -1)
}

describe('a zoom never moves a lined-up placement', () => {
  const cases: Array<[string, Position, number]> = [
    ['an arbitrary spot at 2^10', SPOT, 10],
    ['an arbitrary spot at 2^3', SPOT, 3],
    ['a coarse cell center at 2^12', CENTRE, 12],
    ['an arbitrary spot at 2^0', SPOT, 0],
  ]

  for (const [name, spot, z] of cases) {
    it(`out N then in N, and in N then out N, leaves it bit for bit (${name})`, () => {
      at(spot)
      useCyberspace.setState({ scaleExp: z })
      D().startDeployShard(benchShard().id)
      useShards.setState({ deployHeight: 40, deployHeightAuto: false })
      S().moveCursor({ axis: 'x', dir: 1 })
      const want = placed()
      for (const n of [1, 2, 5, 9]) {
        zoom(n)
        expect(placed()).toEqual(want)
        zoom(-n)
        expect(S().scaleExp).toBe(z)
        expect(placed()).toEqual(want)
        if (z >= n) {
          zoom(-n)
          expect(placed()).toEqual(want)
          zoom(n)
          expect(placed()).toEqual(want)
        }
      }
      // The first zoom put the cursor on the placement, and nothing moved it since.
      expect(S().cursor).toEqual(want)
    })
  }

  it('holds with STEP lowered, through zooming in to it and past it', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 15 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 40, deployHeightAuto: false })
    while (buildStepOf(S()) > 9) stepBuild(-1)
    S().moveCursor({ axis: 'y', dir: -1 })
    const want = placed()
    zoom(3); expect(placed()).toEqual(want)
    zoom(-3); expect(placed()).toEqual(want)
    zoom(-6); expect(placed()).toEqual(want)
    zoom(-4); expect(placed()).toEqual(want)
    zoom(10); expect(placed()).toEqual(want)
    zoom(-2); expect(placed()).toEqual(want)
    zoom(2); expect(placed()).toEqual(want)
  })

  it('placing after zooming out uses the position lined up, not the coarse cell', async () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 3 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 8, deployHeightAuto: false })
    S().moveCursor({ axis: 'z', dir: 1 })
    const want = placed()
    zoom(4)
    await D().deploy()
    expect(D().deployStatus).toBe('done')
    expect(positionOf(D().mine[0])).toEqual(want)
  })

  it('placing after zooming out and back in uses the position lined up', async () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 6 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 8, deployHeightAuto: false })
    while (buildStepOf(S()) > 3) stepBuild(-1)
    S().moveCursor({ axis: 'x', dir: -1 })
    const want = placed()
    zoom(2); zoom(-5); zoom(3)
    await D().deploy()
    expect(D().deployStatus).toBe('done')
    expect(positionOf(D().mine[0])).toEqual(want)
  })

  it('holds for a message and a door the same way', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 9 })
    D().startDeployMessage('under the floor')
    useShards.setState({ deployHeight: 30 })
    let want = placed()
    zoom(4); expect(placed()).toEqual(want)
    zoom(-7); expect(placed()).toEqual(want)
    zoom(3); expect(placed()).toEqual(want)
    D().cancelDeploy()

    useCyberspace.setState({ scaleExp: 9 })
    D().startPlaceDoor()
    useShards.setState({ deployHeight: 30, deployHeightAuto: false })
    want = placed()
    zoom(5); expect(placed()).toEqual(want)
    zoom(-8); expect(placed()).toEqual(want)
    zoom(3); expect(placed()).toEqual(want)
  })

  it('a placement lined up again after one is placed holds too', async () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 5 })
    D().startDeployMessage('again')
    useShards.setState({ deployHeight: 8 })
    // Off your avatar, so the mode outlives the placement and lines it up again.
    S().moveCursor({ axis: 'y', dir: 1 })
    await D().deploy()
    expect(D().deployStatus).toBe('done')
    expect(D().pending).not.toBeNull()
    S().moveCursor({ axis: 'x', dir: 1 })
    const want = placed()
    zoom(3); expect(placed()).toEqual(want)
    zoom(-6); expect(placed()).toEqual(want)
    zoom(3); expect(placed()).toEqual(want)
  })

  it('with nothing lined up the step still follows the zoom', () => {
    useCyberspace.setState({ scaleExp: 9 })
    useBuilder.getState().enter('build')
    zoom(3)
    expect(S().buildStep).toBeNull()
    expect(buildStepOf(S())).toBe(12)
  })

  it('zooming in puts the cursor on the placement, which does not move', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 10 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 40, deployHeightAuto: false })
    S().moveCursor({ axis: 'x', dir: 1 })
    const want = placed()
    zoom(-4)
    expect(S().cursor).toEqual(want)
    expect(placed()).toEqual(want)
  })

  it('zoom out, move, zoom back: a move is one cell of the zoom you are at, and it places where the cursor is', async () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 2 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 8, deployHeightAuto: false })
    S().moveCursor({ axis: 'x', dir: 1 })
    const want = placed()
    zoom(3)
    expect(placed()).toEqual(want)
    S().moveCursor({ axis: 'x', dir: 1 })
    S().moveCursor({ axis: 'z', dir: -1 })
    const moved = { x: want.x + (1n << 5n), y: want.y, z: want.z - (1n << 5n) }
    expect(placed()).toEqual(moved)
    zoom(-3)
    expect(placed()).toEqual(moved)
    expect(S().cursor).toEqual(moved)
    await D().deploy()
    expect(D().deployStatus).toBe('done')
    expect(positionOf(D().mine[0])).toEqual(moved)
  })

  it('zoom in, move: a move is one fine cell, from the placement as it stood', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 10 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 40, deployHeightAuto: false })
    const want = placed()
    zoom(-6)
    S().moveCursor({ axis: 'y', dir: -1 })
    expect(placed()).toEqual({ ...want, y: want.y - (1n << 4n) })
    zoom(6)
    expect(placed()).toEqual({ ...want, y: want.y - (1n << 4n) })
  })

  it('a STEP lowered before a zoom out still sets how far a move goes, and STEP no longer moves the placement', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 10 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 40, deployHeightAuto: false })
    while (moveStepOf(S()) > 4) stepBuild(-1)
    const want = placed()
    zoom(3)
    expect(moveStepOf(S())).toBe(4)
    S().moveCursor({ axis: 'x', dir: 1 })
    const moved = { ...want, x: want.x + (1n << 4n) }
    expect(placed()).toEqual(moved)
    stepBuild(-1)
    stepBuild(1)
    stepBuild(1)
    expect(placed()).toEqual(moved)
  })

  it('a zoom on your avatar is not leaving it: CANCEL still ends BUILD mode, on your avatar', () => {
    useCyberspace.setState({ scaleExp: 15 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 20, deployHeightAuto: false })
    expect(useBuilder.getState().via).toBe('deploy')
    zoom(-3)
    expect(S().cursor).not.toEqual(S().position)
    expect(useBuilder.getState().leftAvatar).toBe(false)
    D().cancelDeploy()
    expect(useBuilder.getState().active).toBe(false)
    expect(S().cursor).toEqual(S().position)
    expect(S().buildExact).toBe(false)
  })

  it('editing the same deploy in place (a fade, a look, a chest placed and taken back) keeps it after a zoom', () => {
    const audio: AudioItem = {
      title: 'Trickling water', about: '', url: 'https://blossom.test/' + 'ab'.repeat(32), mime: 'audio/mpeg', hash: 'ab'.repeat(32),
      originalHash: 'cd'.repeat(32), size: 2048, keyHex: 'ef'.repeat(32), nonceHex: '01'.repeat(12), autoplay: true, loop: true, retrigger: 'once', walkOnly: false,
    }
    at(SPOT)
    useCyberspace.setState({ scaleExp: 9 })
    D().startDeployAudio(audio)
    useShards.setState({ deployHeight: 30 })
    S().moveCursor({ axis: 'x', dir: 1 })
    let want = placed()
    zoom(4)
    D().setDeployFade(1_000_000)
    expect(placed()).toEqual(want)
    zoom(-4)
    expect(placed()).toEqual(want)
    D().cancelDeploy()

    useCyberspace.setState({ scaleExp: 9 })
    D().startPlaceChest()
    useShards.setState({ deployHeight: 30, deployHeightAuto: false })
    S().moveCursor({ axis: 'y', dir: 1 })
    want = placed()
    zoom(4)
    D().setDeployLook({ from: 'builtin', name: 'crawl' })
    useShards.setState({ deployHeight: 30 })
    expect(placed()).toEqual(want)
    D().placeChest()
    const p = D().pending
    expect(p?.type === 'chest' ? p.spot?.at : null).toEqual(want)
    D().unplaceChest()
    expect(placed()).toEqual(want)
    zoom(-4)
    expect(placed()).toEqual(want)
  })

  // Review of #676: a place gone to at its own zoom came with a new cursor,
  // and the hold snapped it with the old zoom's cell, far from the place.
  it('going to a place at its own zoom while lined up aims there exactly, and holds it', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 20 })
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 40, deployHeightAuto: false })
    S().moveCursor({ axis: 'x', dir: 1 })
    const target: Position = { x: SPOT.x + 0x5a5a5n, y: SPOT.y - 0x33n, z: SPOT.z + 0x777n }
    S().focusOn(target, S().anchorPlane, 'STARRED', 3, true)
    expect(useBuilder.getState().active).toBe(true)
    expect(S().cursor).toEqual(target)
    expect(placed()).toEqual(target)
    zoom(4); zoom(-6); zoom(2)
    expect(placed()).toEqual(target)
  })

  // Review of #676: ending or replacing the deploy after a zoom in threw the
  // cursor back to where it stood before the zoom, across the magnified view.
  it('ending or replacing the deploy after a zoom in, off your avatar, leaves the cursor where it is', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 20 })
    D().startDeployMessage('first')
    useShards.setState({ deployHeight: 30 })
    S().moveCursor({ axis: 'x', dir: 1 })
    zoom(-18)
    const here = { ...S().cursor }
    D().startDeployMessage('second')
    expect(S().cursor).toEqual(here)
    zoom(3)
    const c = { ...S().cursor }
    D().cancelDeploy()
    expect(useBuilder.getState().active).toBe(true)
    expect(S().cursor).toEqual(c)
  })

  it('a seed lined up in BUILD keeps its place and its measured hide height through zooms', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 8 })
    D().startDeployShard(benchShard().id)
    S().moveCursor({ axis: 'x', dir: 1 })
    // SEED measures the seed at this cursor and STEP, and PLANT lines it up in place of the shard.
    const fit = seedFitFor({ height: 10, reach: 6 }, S().cursor, buildPlane(S()), buildStepOf(S()))
    D().startDeploySeed({ text: ORIGINAL_DNAS[5].text, caps: BASE_CAPS, scale: 0, title: '', fit })
    useShards.setState({ deployHeight: 10, deployHeightAuto: false })
    expect(useBuilder.getState().active).toBe(true)
    const height = (): number => {
      const p = D().pending
      return seedDraftHeight(p?.type === 'seed' ? p.seed.fit : undefined, S().cursor, buildPlane(S()), buildStepOf(S()), 20)
    }
    const want = placed()
    expect(height()).toBe(10)
    zoom(3); expect(placed()).toEqual(want); expect(height()).toBe(10)
    zoom(-6); expect(placed()).toEqual(want); expect(height()).toBe(10)
    zoom(3); expect(placed()).toEqual(want); expect(height()).toBe(10)
  })

  it('BUILD entered from VIEW with the mode button, then a deploy and a zoom: nothing drifts', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 9 })
    S().viewHere()
    S().moveCursor({ axis: 'z', dir: 1 })
    const aimed = { ...S().cursor }
    cycleMode()
    expect(useBuilder.getState().active).toBe(true)
    expect(S().cursor).toEqual(aimed)
    D().startDeployShard(benchShard().id)
    useShards.setState({ deployHeight: 40, deployHeightAuto: false })
    const want = placed()
    zoom(4); expect(placed()).toEqual(want)
    zoom(-7); expect(placed()).toEqual(want)
    zoom(3); expect(placed()).toEqual(want)
  })

  // Review of the v2 merge: re-keying the seed's fit made a new deploy object,
  // so a copy lined up again stopped being that copy.
  it('a seed copy lined up again stays that copy through a zoom, and the same-spot refusal stands', () => {
    at(SPOT)
    useCyberspace.setState({ scaleExp: 8 })
    D().startDeployShard(benchShard().id)
    S().moveCursor({ axis: 'x', dir: 1 })
    const fit = seedFitFor({ height: 10, reach: 6 }, S().cursor, buildPlane(S()), buildStepOf(S()))
    D().startDeploySeed({ text: ORIGINAL_DNAS[5].text, caps: BASE_CAPS, scale: 0, title: '', fit })
    useShards.setState({ deployHeight: 10, deployHeightAuto: false })
    // What a placement leaves: the same object lined up again, on the spot it landed.
    const sh = D()
    const settings = { deployHeight: 10, deployHeightAuto: false, deployUnit: sh.deployUnit, deployUp: sh.deployUp, deploySpin: sh.deploySpin, deployTurn: sh.deployTurn, deployFollow: sh.deployFollow, deployLink: sh.deployLink }
    useShards.setState({ placedLast: { pending: sh.pending!, settings, step: S().buildStep, spot: spotOf(placed(), buildPlane(S()), settings), count: 1 } })
    expect(copyLinedUp(D())).toBe(true)
    expect(atLastSpot(D(), S())).toBe(true)
    const want = placed()
    zoom(3)
    expect(placed()).toEqual(want)
    expect(D().pending).toBe(D().placedLast?.pending)
    expect(copyLinedUp(D())).toBe(true)
    expect(atLastSpot(D(), S())).toBe(true)
  })
})

