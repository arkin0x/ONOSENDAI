/**
 * destination.test.tsx - a ride destination is set once, named while set, and
 * changed only by clearing it; every path confirms with the same toast
 * (arkinox, 2026-10-15).
 */
import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { renderToStaticMarkup } from 'react-dom/server'
const { useHyperspace } = await import('../useHyperspace')
const { useToast } = await import('../useToast')
const { useGoal } = await import('../useGoal')
const { clearRideDestination, setRideDestination, DESTINATION_SET_META } = await import('../destination')
const { DestinationButton } = await import('../../hud/LineScrubber')

const toast = () => useToast.getState().toast

beforeEach(() => {
  useHyperspace.getState().setDestination(null)
  useToast.setState({ toast: null })
  useGoal.setState({ goal: null })
})

describe('setting a ride destination', () => {
  it('sets one when none is set, and confirms it', () => {
    expect(setRideDestination(7)).toBe(true)
    expect(useHyperspace.getState().destination).toBe(7)
    expect(toast()?.label).toBe('Destination: block 7')
    expect(toast()?.meta).toBe(DESTINATION_SET_META)
    expect(toast()?.mark).toBe('goal')
  })

  it('keeps a destination already set: another is refused until it is cleared', () => {
    setRideDestination(7)
    expect(setRideDestination(9)).toBe(false)
    expect(useHyperspace.getState().destination).toBe(7)
    expect(toast()?.label).toBe('Destination is block 7')
    clearRideDestination()
    expect(setRideDestination(9)).toBe(true)
    expect(useHyperspace.getState().destination).toBe(9)
  })

  it('a quiet set (a tap on a stop in the scene) refuses without a toast', () => {
    setRideDestination(7)
    useToast.setState({ toast: null })
    expect(setRideDestination(9, { quiet: true })).toBe(false)
    expect(toast()).toBeNull()
  })
})

describe('the destination button', () => {
  it('reads SET DESTINATION with none set', () => {
    const html = renderToStaticMarkup(<DestinationButton destination={null} height={5} />)
    expect(html).toContain('SET DESTINATION')
    expect(html).not.toContain('CLEAR DESTINATION')
  })

  it('with one set, is a dead label naming that block, whatever is scrubbed, beside its own CLEAR DESTINATION', () => {
    const html = renderToStaticMarkup(<DestinationButton destination={7} height={12} />)
    expect(html.replace(/<!-- -->/g, '')).toContain('DESTINATION: BLOCK 7')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>DESTINATION: BLOCK/)
    expect(html).toContain('CLEAR DESTINATION')
    expect(html).not.toContain('SET DESTINATION')
  })
})

describe("GOAL's SET", () => {
  const stop = (height: number) => ({ height, kind: 'port' as const, coord: (1n << 200n) + BigInt(height), distance: 3 })
  const ridePlan = { kind: 'ride' as const, directDistance: 80, station: stop(2), exit: stop(7), blocks: 5 }

  it('sets the exit stop with the same confirmation as SET DESTINATION', () => {
    useGoal.setState({ goal: { target: { x: 1n, y: 1n, z: 1n }, plane: 1, label: 'X', plan: ridePlan } as never })
    useGoal.getState().aim()
    expect(useHyperspace.getState().destination).toBe(7)
    expect(toast()?.label).toBe('Destination: block 7')
    expect(toast()?.mark).toBe('goal')
  })

  it('never replaces a destination already set', () => {
    setRideDestination(4)
    useGoal.setState({ goal: { target: { x: 1n, y: 1n, z: 1n }, plane: 1, label: 'X', plan: ridePlan } as never })
    useGoal.getState().aim()
    expect(useHyperspace.getState().destination).toBe(4)
    expect(toast()?.label).toBe('Destination is block 4')
  })
})
