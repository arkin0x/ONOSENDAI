/**
 * viewFlyTick.test.ts - VIEW's fly against the real store, one frame at a
 * time, as the rig runs it (scene/ViewFly.ts): the cursor goes the way the
 * camera looks, by the zoom's cells, to whole gibsons, only in a free view,
 * and the rig is told to keep the camera locked to it while it flies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/relay')>()),
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { flyGesture, tickViewFly } from '../ViewFly'
import { FLY_CELLS_PER_SECOND, FLY_HOLD_MS, renderToCyber, useViewFly } from '../../lib/viewFly'
import { useCyberspace } from '../../store/useCyberspace'
import { useBuilder } from '../../store/useBuilder'
import type { Position } from '../../lib/space'

const cs = () => useCyberspace.getState()
/** A camera 10 units back from its target along render +z: looking down render -z. */
const eye = new Vector3(0, 0, 10)
const target = new Vector3(0, 0, 0)

/** How far the cursor went from `from`, in gibsons, along each axis. */
const moved = (from: Position): [number, number, number] => {
  const c = cs().cursor
  return [Number(c.x - from.x), Number(c.y - from.y), Number(c.z - from.z)]
}

/** Where looking down render -z goes, in cyberspace: one axis, with its sign. */
const ahead = (): [number, number, number] => {
  const a = renderToCyber([0, 0, -1], cs().axes())
  return [a.x, a.y, a.z]
}

beforeEach(() => {
  useCyberspace.setState({ scaleExp: 0 })
  useViewFly.setState({ button: 0, touch: 0 })
  flyGesture.clear()
})
afterEach(() => {
  useViewFly.setState({ button: 0, touch: 0 })
  flyGesture.clear()
  useBuilder.getState().exit()
  cs().clearFocus()
})

describe('the fly buttons in VIEW', () => {
  it('forward moves the cursor the way the camera looks, by the zoom: 8 cells a second', () => {
    cs().viewHere()
    const from = { ...cs().cursor }
    useViewFly.getState().setButton(1)
    // Half a second in 1/20 s frames.
    for (let i = 0; i < 10; i++) expect(tickViewFly(eye, target, 0.05, 0)).toBe(true)
    const d = ahead().map((k) => k * FLY_CELLS_PER_SECOND * 0.5)
    expect(moved(from)).toEqual(d)
  })

  it('back moves it the other way', () => {
    cs().viewHere()
    const from = { ...cs().cursor }
    useViewFly.getState().setButton(-1)
    for (let i = 0; i < 10; i++) tickViewFly(eye, target, 0.05, 0)
    expect(moved(from)).toEqual(ahead().map((k) => -k * FLY_CELLS_PER_SECOND * 0.5 + 0))
  })

  it('crosses the same number of cells at 2^0 and at 2^12: 4,096 times the gibsons', () => {
    cs().viewHere()
    useViewFly.getState().setButton(1)
    const run = (scaleExp: number): number => {
      useCyberspace.setState({ scaleExp })
      const from = { ...cs().cursor }
      for (let i = 0; i < 10; i++) tickViewFly(eye, target, 0.05, 0)
      return Math.max(...moved(from).map(Math.abs))
    }
    const fine = run(0)
    const coarse = run(12)
    expect(fine).toBe(4)
    expect(coarse).toBe(4 * 4096)
  })

  it('a slanted look moves two axes, each to a whole gibson', () => {
    cs().viewHere()
    const from = { ...cs().cursor }
    useViewFly.getState().setButton(1)
    useCyberspace.setState({ scaleExp: 6 })
    tickViewFly(new Vector3(6, 0, 8), target, 0.1, 0)
    // 8 cells of 64 a second for 0.1 s: 51.2 gibsons along (-0.6, 0, -0.8).
    const a = renderToCyber([-0.6, 0, -0.8], cs().axes())
    const want = [a.x, a.y, a.z].map((k) => Math.round(k * 51.2))
    expect(moved(from)).toEqual(want)
  })

  it('released, it stops', () => {
    cs().viewHere()
    useViewFly.getState().setButton(1)
    tickViewFly(eye, target, 0.1, 0)
    useViewFly.getState().setButton(0)
    const at = { ...cs().cursor }
    expect(tickViewFly(eye, target, 0.1, 0)).toBe(false)
    expect(cs().cursor).toEqual(at)
  })

  it('does nothing at your head, in BUILD or in WALK', () => {
    useViewFly.getState().setButton(1)
    const home = { ...cs().cursor }
    expect(tickViewFly(eye, target, 0.1, 0)).toBe(false)
    expect(cs().cursor).toEqual(home)
    useBuilder.getState().enter('build')
    const built = { ...cs().cursor }
    expect(tickViewFly(eye, target, 0.1, 0)).toBe(false)
    expect(cs().cursor).toEqual(built)
  })

  it('a free view of a typed place flies too, and the view follows (no fixed look)', () => {
    cs().focusOn({ x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }, 0, '1, 2, 3', undefined, true)
    const from = { ...cs().cursor }
    useViewFly.getState().setButton(1)
    expect(tickViewFly(eye, target, 0.1, 0)).toBe(true)
    expect(moved(from).some((k) => k !== 0)).toBe(true)
    cs().focusOn({ x: 5n, y: 5n, z: 5n }, 0, 'BLOCK 1')
    expect(tickViewFly(eye, target, 0.1, 0)).toBe(false)
  })
})

describe('two and three fingers on the scene', () => {
  const touch = (n: number, at = 0): void => { for (let i = 0; i < n; i++) flyGesture.down(i + 1, 100 + 100 * i, 400, at) }

  it('two fingers at rest fly forward once they have rested, and stop when they lift', () => {
    cs().viewHere()
    const from = { ...cs().cursor }
    touch(2)
    expect(tickViewFly(eye, target, 0.05, FLY_HOLD_MS - 1)).toBe(false)
    expect(cs().cursor).toEqual(from)
    for (let i = 0; i < 10; i++) tickViewFly(eye, target, 0.05, FLY_HOLD_MS + i)
    expect(moved(from)).toEqual(ahead().map((k) => k * FLY_CELLS_PER_SECOND * 0.5))
    flyGesture.up(2, FLY_HOLD_MS + 20)
    const at = { ...cs().cursor }
    expect(tickViewFly(eye, target, 0.05, FLY_HOLD_MS + 30)).toBe(false)
    expect(cs().cursor).toEqual(at)
  })

  it('three fingers fly back', () => {
    cs().viewHere()
    const from = { ...cs().cursor }
    touch(3)
    for (let i = 0; i < 10; i++) tickViewFly(eye, target, 0.05, FLY_HOLD_MS + i)
    expect(moved(from)).toEqual(ahead().map((k) => -k * FLY_CELLS_PER_SECOND * 0.5 + 0))
  })

  it('a pinch does not fly, and one finger (the orbit) does not either', () => {
    cs().viewHere()
    const from = { ...cs().cursor }
    touch(2)
    flyGesture.move(2, 260, 400)
    for (let i = 0; i < 10; i++) tickViewFly(eye, target, 0.05, FLY_HOLD_MS + 100 * i)
    flyGesture.clear()
    touch(1)
    flyGesture.move(1, 300, 300)
    for (let i = 0; i < 10; i++) tickViewFly(eye, target, 0.05, FLY_HOLD_MS + 100 * i)
    expect(cs().cursor).toEqual(from)
  })
})
