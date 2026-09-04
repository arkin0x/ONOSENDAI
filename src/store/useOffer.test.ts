/**
 * useOffer.test.ts - the one action the next commit takes, as the button
 * names it, and the HOSAKA card being asked for per cursor.
 */

import { describe, expect, it } from 'vitest'
import { nextActionFor, useOffer } from './useOffer'

const at = (x: bigint): { x: bigint; y: bigint; z: bigint } => ({ x, y: 0n, z: 0n })
const CAPS = { max_hop_height: 27, max_sidestep_height: 29 }
// A machine that hops to 2^17 and sidesteps to 2^24, as the defaults say.
const next = (cursorX: bigint, limits: typeof CAPS | null = CAPS) => nextActionFor(at(0n), at(cursorX), 0, 17, 24, limits)

describe('nextActionFor', () => {
  it('is nothing with the cursor on the avatar', () => {
    expect(next(0n)).toBeNull()
  })
  it('hops to a cursor within the machine ceiling', () => {
    expect(next(1n << 10n)?.action).toBe('hop')
  })
  it('names a step of the way when the cursor is beyond one hop but a local walk exists', () => {
    const a = next(1n << 22n)
    expect(a && ['hop-to-boundary', 'sidestep'].includes(a.action)).toBe(true)
    expect(a?.step).not.toBeNull()
  })
  it('walks toward a boundary only HOSAKA crosses, and is OFFLOAD only on reaching it', () => {
    // An h26 boundary on the way: above the local sidestep ceiling, within HOSAKA's hop cap.
    expect(next(1n << 25n)?.action).toBe('hop-to-boundary')
    expect(next(1n << 25n, null)?.action).toBe('hop-to-boundary')
    const atWall = (limits: typeof CAPS | null) => nextActionFor(at((1n << 25n) - 1n), at(1n << 25n), 0, 17, 24, limits)
    expect(atWall(CAPS)?.action).toBe('offload')
    expect(atWall(CAPS)?.step?.source).toBe('cloud')
    // HOSAKA has not said what it can: the press asks.
    expect(atWall(null)?.action).toBe('offload')
    expect(atWall(null)?.step).toBeNull()
  })
  it('is TOO FAR past every cap', () => {
    // An h31 boundary: above HOSAKA's sidestep cap too.
    expect(next(1n << 30n)?.action).toBe('too-far')
    expect(next(1n << 30n)?.step).toBeNull()
  })
})

describe('the request', () => {
  it('is per cursor, and NOT NOW clears it', () => {
    useOffer.getState().request('a:b:c:0')
    expect(useOffer.getState().requestedFor).toBe('a:b:c:0')
    useOffer.getState().dismiss('a:b:c:0')
    expect(useOffer.getState().requestedFor).toBeNull()
    expect(useOffer.getState().dismissedFor).toBe('a:b:c:0')
  })
})
