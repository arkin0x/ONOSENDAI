/**
 * tapUpClose.test.tsx - a chest you stand in, or right beside, still takes a
 * tap (arkinox, 2026-11-13: "on the You Made It step, im having a lot of
 * trouble tapping on the chest again. it just doesnt activate the modal";
 * "im in walk mode btw").
 *
 * In WALK the eye is the walker's own cell centre (Scene.tsx WALK_EYE), and a
 * bounce onto the finish deck can land you in the finish chest's own cell:
 * the chest is all round the eye and fills the screen. TapTarget refused every
 * tap then, by rules made for a large shard that surrounds you: its box held
 * the camera, or reached behind it, or was more than MAX_SCREENS screens
 * across. A chest or a door (LookMark) is at most a few gibsons, so up close
 * it is still a thing to tap: those rules are lifted for a target no larger
 * than its `upClose`. A large shard keeps them.
 *
 * Driven through R3F's own click path (test/r3fRoot.ts), as a finger taps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
vi.mock('../WorldLabel', async (real) => ({ ...(await real<object>()), WorldLabel: () => null }))
// What a chest draws, as a solid box of its look's bounds: its inside drawn too, as ShardMesh draws a chest seen from within.
vi.mock('../ShardMesh', async () => {
  const { createElement } = await import('react')
  const { DoubleSide } = await import('three')
  // Not through LookMark, which imports this module: its bounds worked here as lookBounds works them.
  const { flatten } = await import('sno-core/shards')
  const { extentOf } = await import('../../lib/itemModel')
  return {
    ShardMesh: ({ shard }: { shard: import('sno-core/shards').ShardModel }) => {
      const e = extentOf(flatten(shard).positions, null)!
      return createElement('mesh', { position: e.centre }, createElement('boxGeometry', { args: e.half.map((h: number) => 2 * h) }), createElement('meshBasicMaterial', { side: DoubleSide }))
    },
  }
})

import { createElement, useRef, type RefObject } from 'react'
import { Box3, DoubleSide, Mesh, Vector3, type Group } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { builtInLook } from '../../lib/looks'
import { trueScale } from '../../lib/itemModel'
import type { ViewAxes } from '../../lib/space'
import { LookMark, UP_CLOSE_GIBSONS, lookBounds } from '../LookMark'
import { TapTarget } from '../TapTarget'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const SIZE = 800
const AT: [number, number, number] = [0, 0, -6]
const onTap = vi.fn()
let r: R3fRoot

/** Put the camera at `eye` (relative to the chest's place), looking down -z, as WALK's eye looks ahead. */
function eyeAt(eye: [number, number, number], look: [number, number, number] = [0, 0, -1]): void {
  const cam = r.state().camera
  cam.position.set(AT[0] + eye[0], AT[1] + eye[1], AT[2] + eye[2])
  cam.lookAt(cam.position.x + look[0], cam.position.y + look[1], cam.position.z + look[2])
  cam.updateMatrixWorld(true)
}

/** Where a point (relative to the chest's place) is on screen, CSS pixels. */
function onScreen(p: [number, number, number]): [number, number] {
  const v = new Vector3(AT[0] + p[0], AT[1] + p[1], AT[2] + p[2]).project(r.state().camera)
  return [((v.x + 1) / 2) * SIZE, ((1 - v.y) / 2) * SIZE]
}

/** The world box of what the chest draws (the mocked ShardMesh's mesh, not the hidden tap target). */
function drawnBox(): Box3 {
  const box = new Box3()
  r.state().scene.traverse((o) => { if (o instanceof Mesh && o.visible) box.expandByObject(o) })
  return box
}

beforeEach(async () => {
  onTap.mockClear()
  r = await r3fRoot({ width: SIZE, height: SIZE })
})

afterEach(async () => {
  await r.unmount()
})

describe('a chest up close in WALK (LookMark)', () => {
  const look = builtInLook('treasure')
  const chest = (): Promise<void> => r.render(createElement(LookMark, { look, model: look.closed, at: AT, axes: AXES, minPx: 8, onTap }))

  it('is a chest-sized thing, well inside the up-close limit', () => {
    const b = lookBounds(look.closed)
    expect(b.longest * trueScale(look.closed.unit, 0)).toBeLessThanOrEqual(UP_CLOSE_GIBSONS)
  })

  it('from far enough back, a tap on it opens it, as it always did', async () => {
    await chest()
    eyeAt([0, 0, 3])
    await r.frame()
    await r.tap(SIZE / 2, SIZE / 2)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('standing in its cell (the eye at its centre, as WALK puts it), a tap on the chest around you opens it', async () => {
    await chest()
    eyeAt([0, 0, 0.001])
    await r.frame()
    await r.tap(SIZE / 2, SIZE / 2)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('right beside it, its box reaching behind the eye, a tap where it draws opens it', async () => {
    await chest()
    eyeAt([0.5, 0, 0.2])
    await r.frame()
    // A point inside what it draws, on its far side and near the eye's side: a little left of straight ahead.
    const box = drawnBox()
    const [x, y] = onScreen([box.max.x - 0.15 - AT[0], (box.min.y + box.max.y) / 2 - AT[1], box.min.z + 0.1 - AT[2]])
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(SIZE)
    await r.tap(x, y)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('a tap that misses it, beside it, opens nothing', async () => {
    await chest()
    eyeAt([0.5, 0, 0.2])
    await r.frame()
    await r.tap(SIZE * 0.95, SIZE * 0.05)
    expect(onTap).not.toHaveBeenCalled()
  })
})

describe('a large shard keeps the rules for what surrounds you', () => {
  /** A box `side` units across around the chest's place, with its target; `upClose` passed through. */
  function Big({ side, upClose }: { side: number; upClose?: number }): JSX.Element {
    const drawn = useRef<Group>(null)
    return createElement('group', { position: AT },
      // Drawn on both sides, as ShardMesh draws a thing seen from within it: from inside, the tap must still land on it.
      createElement('group', { ref: drawn }, createElement('mesh', null, createElement('boxGeometry', { args: [side, side, side] }), createElement('meshBasicMaterial', { side: DoubleSide }))),
      createElement(TapTarget, { measure: drawn as RefObject<Group>, onTap, upClose }))
  }

  it('standing inside a large shard, a tap opens nothing (no upClose)', async () => {
    await r.render(createElement(Big, { side: 10 }))
    eyeAt([0, 0, 0.001])
    await r.frame()
    await r.tap(SIZE / 2, SIZE / 2)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('a target larger than its upClose keeps the rules: inside it, a tap opens nothing', async () => {
    await r.render(createElement(Big, { side: 10, upClose: 4 }))
    eyeAt([0, 0, 0.001])
    await r.frame()
    await r.tap(SIZE / 2, SIZE / 2)
    expect(onTap).not.toHaveBeenCalled()
  })

  it('standing in a hollow chest, a tap where no face of it is under the finger still opens it (WALK\'s eye sits on its floor, and rays graze its walls)', async () => {
    // Only two corner posts drawn: its box holds the eye, but a ray straight ahead meets nothing it draws.
    function Hollow(): JSX.Element {
      const drawn = useRef<Group>(null)
      const post = (x: number, y: number, z: number) => createElement('mesh', { position: [x, y, z] }, createElement('boxGeometry', { args: [0.05, 0.05, 0.05] }), createElement('meshBasicMaterial', { side: DoubleSide }))
      return createElement('group', { position: AT },
        createElement('group', { ref: drawn }, post(-0.45, 0, -0.45), post(0.45, 0.8, 0.45)),
        createElement(TapTarget, { measure: drawn as RefObject<Group>, onTap, upClose: 4 }))
    }
    await r.render(createElement(Hollow))
    eyeAt([0, 0.1, 0.001])
    await r.frame()
    await r.tap(SIZE / 2, SIZE / 2)
    expect(onTap).toHaveBeenCalledTimes(1)
  })

  it('one within its upClose takes the tap from inside', async () => {
    await r.render(createElement(Big, { side: 3, upClose: 4 }))
    eyeAt([0, 0, 0.001])
    await r.frame()
    await r.tap(SIZE / 2, SIZE / 2)
    expect(onTap).toHaveBeenCalledTimes(1)
  })
})
