/**
 * starChip.test.ts: which chip stands at the bottom center (lib/starred.ts
 * bottomChip, starSpot), read from the real scene store. The star whenever the
 * spot at the center of the screen is not your avatar; CHAT when it is.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useCyberspace } from '../../store/useCyberspace'
import { bottomChip, isStarred, starSpot } from '../../lib/starred'
import { shortAxis } from '../../lib/viewAt'

const S = () => useCyberspace.getState()

describe('the chip where CHAT sits', () => {
  beforeEach(() => {
    S().clearFocus()
    S().cancel()
    S().setPlane(S().headPlane)
  })

  it('is CHAT on your avatar, with nothing to star', () => {
    expect(S().atHead()).toBe(true)
    expect(starSpot(S())).toBeNull()
    expect(bottomChip(S())).toBe('chat')
  })

  it('is the star once the cursor moves off the avatar, and the spot is the cursor', () => {
    S().moveCursor({ axis: 'x', dir: 1 })
    expect(bottomChip(S())).toBe('star')
    const spot = starSpot(S())!
    expect(spot.position).toEqual(S().cursor)
    expect(spot.plane).toBe(S().headPlane)
    expect(spot.input).toBe(`${S().cursor.x}, ${S().cursor.y}, ${S().cursor.z}`)
    expect(spot.label).toBe([S().cursor.x, S().cursor.y, S().cursor.z].map(shortAxis).join(', '))
  })

  it('goes back to CHAT when the cursor is recalled', () => {
    S().moveCursor({ axis: 'z', dir: -1 })
    expect(bottomChip(S())).toBe('star')
    S().cancel()
    expect(bottomChip(S())).toBe('chat')
  })

  it('is the star with the cursor parked but the plane flipped: another coordinate', () => {
    S().setPlane(S().headPlane === 0 ? 1 : 0)
    expect(bottomChip(S())).toBe('star')
    expect(starSpot(S())!.plane).not.toBe(S().headPlane)
  })

  it('is the star in a free view, starring the driven cursor under the view name while on it', () => {
    const there = { x: 12345n, y: 678n, z: 9n }
    S().focusOn(there, 0, 'PARIS', undefined, true)
    expect(bottomChip(S())).toBe('star')
    expect(starSpot(S())).toMatchObject({ position: there, plane: 0, label: 'PARIS', input: '12345, 678, 9' })
    S().moveCursor({ axis: 'x', dir: 1 })
    const moved = starSpot(S())!
    expect(moved.position).toEqual(S().cursor)
    expect(moved.label).not.toBe('PARIS')
  })

  it('stars the view focus when the cursor cannot be driven (a shard, a region)', () => {
    const shard = { x: 7n, y: 7n, z: 7n }
    S().focusOn(shard, 1, 'a shard')
    expect(S().canDrive()).toBe(false)
    expect(bottomChip(S())).toBe('star')
    expect(starSpot(S())).toMatchObject({ position: shard, plane: 1, label: 'a shard' })
  })

  it('returns to CHAT on RETURN', () => {
    S().focusOn({ x: 1n, y: 1n, z: 1n }, 0, 'x', undefined, true)
    S().clearFocus()
    expect(bottomChip(S())).toBe('chat')
  })

  it('knows a starred spot by its text and plane', () => {
    S().moveCursor({ axis: 'y', dir: 1 })
    const spot = starSpot(S())!
    expect(isStarred([{ input: spot.input, plane: spot.plane, label: 'any', at: 0 }], spot)).toBe(true)
    expect(isStarred([{ input: spot.input, plane: spot.plane === 0 ? 1 : 0, label: 'any', at: 0 }], spot)).toBe(false)
  })
})
