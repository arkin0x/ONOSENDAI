/**
 * tapThroughClick.test.tsx - a dimmed occluder is tapped through on R3F's own
 * click path (arkinox, 2026-11-09), not only in tapRaycast.
 *
 * R3F calls a click handler only on an object the press also hit (its
 * `initialHits`), and works out the click distance from the press. So the
 * order matters: press, then whatever changes the dim, then release and click.
 * These drive that path for real (test/r3fRoot.ts): a wall in front of a shard,
 * each with its TapTarget, on one line of sight.
 *
 * - Not dimmed: the wall takes the tap.
 * - Dimmed before the press: the shard behind takes it.
 * - Dimmed between press and click: the shard behind takes it, never the wall.
 * - Undimmed between press and click: still the shard behind, which the press
 *   reached; the wall the press passed through does not take it.
 * - A dimmed set left behind with the Builder off: the wall takes it again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, useRef, type RefObject } from 'react'
import type { Group } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { TapTarget } from '../TapTarget'
import { setDimmed } from '../../store/useBuildDim'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'

const taps = { wall: vi.fn(), shard: vi.fn() }

/** A 2-unit box at depth `z` and its tap target, as a world shard draws one. */
function Thing({ z, occluder, onTap }: { z: number; occluder?: string; onTap: () => void }): JSX.Element {
  const drawn = useRef<Group>(null)
  return createElement('group', { position: [0, 0, z] },
    createElement('group', { ref: drawn }, createElement('mesh', null, createElement('boxGeometry', { args: [2, 2, 2] }), createElement('meshBasicMaterial'))),
    createElement(TapTarget, { measure: drawn as RefObject<Group>, occluder, onTap }))
}

function Scene(): JSX.Element {
  return createElement('group', null,
    createElement(Thing, { z: -5, occluder: 'wall', onTap: () => taps.wall() }),
    createElement(Thing, { z: -15, onTap: () => taps.shard() }))
}

const CENTRE = 400
let r: R3fRoot

beforeEach(async () => {
  taps.wall.mockClear()
  taps.shard.mockClear()
  // The Builder last: a change to the cyberspace store can stand it down.
  useCyberspace.setState({ walking: false })
  r = await r3fRoot()
  await r.render(createElement(Scene))
  await r.frame()
  useBuilder.setState({ active: true })
})

afterEach(async () => {
  await r.unmount()
  setDimmed(new Set())
  useBuilder.setState({ active: false })
})

describe("a dimmed occluder, tapped on R3F's own click path", () => {
  it('not dimmed: the wall takes the tap', async () => {
    await r.tap(CENTRE, CENTRE)
    expect(taps.wall).toHaveBeenCalledTimes(1)
    expect(taps.shard).not.toHaveBeenCalled()
  })

  it('dimmed before the press: the shard behind takes it', async () => {
    setDimmed(new Set(['wall']))
    expect(useBuilder.getState().active).toBe(true)
    await r.tap(CENTRE, CENTRE)
    expect(taps.shard).toHaveBeenCalledTimes(1)
    expect(taps.wall).not.toHaveBeenCalled()
  })

  it('dimmed between the press and the click: the shard behind takes it, never the wall', async () => {
    await r.pointer('pointerdown', CENTRE, CENTRE)
    setDimmed(new Set(['wall']))
    await r.frame()
    await r.pointer('pointerup', CENTRE, CENTRE)
    await r.pointer('click', CENTRE, CENTRE)
    expect(taps.shard).toHaveBeenCalledTimes(1)
    expect(taps.wall).not.toHaveBeenCalled()
  })

  it('undimmed between the press and the click: the shard the press reached takes it', async () => {
    setDimmed(new Set(['wall']))
    await r.pointer('pointerdown', CENTRE, CENTRE)
    setDimmed(new Set())
    await r.frame()
    await r.pointer('pointerup', CENTRE, CENTRE)
    await r.pointer('click', CENTRE, CENTRE)
    expect(taps.shard).toHaveBeenCalledTimes(1)
    expect(taps.wall).not.toHaveBeenCalled()
  })

  it('a dimmed set left behind once the Builder is off: the wall takes its taps again', async () => {
    setDimmed(new Set(['wall']))
    useBuilder.setState({ active: false })
    await r.tap(CENTRE, CENTRE)
    expect(taps.wall).toHaveBeenCalledTimes(1)
    expect(taps.shard).not.toHaveBeenCalled()
  })

  it('a tap beside both reaches neither', async () => {
    await r.tap(20, 20)
    expect(taps.wall).not.toHaveBeenCalled()
    expect(taps.shard).not.toHaveBeenCalled()
  })
})
