/**
 * A wall you cannot see flashes its outline when it stops your walk
 * (store/wallHint.ts); a visible one never does, and the flash expires.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { WALL_HINT_IN_MS, WALL_HINT_MS, noteWallContact, unseenWall, useWallHint, wallHintLive, wallHintShare } from '../wallHint'

const wall = (over: Partial<ShardModel> = {}): ShardModel => ({ ...newShard('Wall'), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]], ...over })

beforeEach(() => useWallHint.setState({ key: null, at: 0 }))

describe('which walls flash', () => {
  it('opacity 0, or bare points at point size 0 with no glow', () => {
    expect(unseenWall(wall({ opacity: 0 }))).toBe(true)
    expect(unseenWall(wall({ opacity: 0, mode: 'points', extra: { glow: ['light', 240, 50] } }))).toBe(true)
    expect(unseenWall(wall({ mode: 'points', extra: { pointsize: 0 } }))).toBe(true)
  })
  it('never a wall you can see', () => {
    expect(unseenWall(wall())).toBe(false)
    expect(unseenWall(wall({ opacity: 5 }))).toBe(false)
    expect(unseenWall(wall({ mode: 'points' }))).toBe(false)
    expect(unseenWall(wall({ mode: 'points', extra: { pointsize: 0, glow: ['fog', 240, 50] } }))).toBe(false)
    expect(unseenWall(wall({ mode: 'lines', extra: { pointsize: 0 } }))).toBe(false)
  })
})

describe('the flash', () => {
  it('a stop by an unseen wall starts it; a visible one does not', () => {
    expect(noteWallContact({ key: 'a', shard: wall() }, 1000)).toBe(false)
    expect(useWallHint.getState().key).toBeNull()
    expect(noteWallContact({ key: 'b', shard: wall({ opacity: 0 }) }, 1000)).toBe(true)
    expect(useWallHint.getState()).toMatchObject({ key: 'b', at: 1000 })
  })
  it('fades in, holds, fades out and expires', () => {
    expect(wallHintShare(0)).toBe(0)
    expect(wallHintShare(WALL_HINT_IN_MS)).toBe(1)
    expect(wallHintShare(WALL_HINT_MS - 1)).toBeGreaterThan(0)
    expect(wallHintShare(WALL_HINT_MS - 1)).toBeLessThan(0.05)
    expect(wallHintShare(WALL_HINT_MS)).toBe(0)
    expect(wallHintShare(WALL_HINT_MS * 3)).toBe(0)
    noteWallContact({ key: 'b', shard: wall({ opacity: 0 }) }, 1000)
    expect(wallHintLive('b', 1000 + WALL_HINT_MS - 1)).toBe(true)
    expect(wallHintLive('b', 1000 + WALL_HINT_MS)).toBe(false)
  })
  it('reduced motion: no fade in, shown at once, then fades', () => {
    expect(wallHintShare(1, true)).toBe(1)
    expect(wallHintShare(WALL_HINT_MS, true)).toBe(0)
  })
  it('a held key keeps one flash going: it carries on fading in, then holds at full strength, never popping', () => {
    noteWallContact({ key: 'b', shard: wall({ opacity: 0 }) }, 1000)
    noteWallContact({ key: 'b', shard: wall({ opacity: 0 }) }, 1100)
    expect(useWallHint.getState().at).toBe(1000)
    // Fading out at 1500: back to full strength, not to nothing.
    noteWallContact({ key: 'b', shard: wall({ opacity: 0 }) }, 1500)
    expect(useWallHint.getState().at).toBe(1500 - WALL_HINT_IN_MS)
    expect(wallHintShare(1500 - useWallHint.getState().at)).toBe(1)
    // Long gone: a new flash.
    noteWallContact({ key: 'b', shard: wall({ opacity: 0 }) }, 5000)
    expect(useWallHint.getState().at).toBe(5000)
  })
  it('the walls\' word on the face that stopped the step wins: an unseen part of a visible object flashes, a visible part of an unseen one does not', () => {
    expect(noteWallContact({ key: 'frame', shard: wall() }, 1000, true)).toBe(true)
    useWallHint.setState({ key: null, at: 0 })
    expect(noteWallContact({ key: 'ghost', shard: wall({ opacity: 0 }) }, 1000, false)).toBe(false)
    expect(useWallHint.getState().key).toBeNull()
  })
})
