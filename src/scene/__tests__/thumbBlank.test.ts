/**
 * A shard picture is taken blank only when it is known to be blank
 * (scene/ThumbStage.tsx knownBlank): the object draws nothing itself, and
 * what it places was resolved and draws nothing at any depth. Parts that
 * timed out are not known, so the picture waits and is tried again rather
 * than caching a blank for hours.
 */
import { describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import type { Placed } from 'sno-core/parts'
import { knownBlank } from '../ThumbStage'

const v = [{ p: [0, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }, { p: [1, 0, 0] as [number, number, number], c: [1, 1, 1] as [number, number, number] }]
const shard = (over: Partial<ShardModel> = {}): ShardModel => ({ ...newShard('x'), mode: 'points', vertices: v, faces: [], ...over })
const host = (): ShardModel => ({ ...newShard('Room'), mode: 'solid', vertices: [], faces: [], refs: [['a', `33331:${'a'.repeat(64)}:w`]], parts: [{ ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }] })
const placed = (model: ShardModel | null, children: Placed[] = []): Placed => ({ part: { ref: 0, at: [0, 0, 0], turn: [0, 0, 0], step: 0 }, ref: ['a', `33331:${'a'.repeat(64)}:w`], model, children } as Placed)

describe('knownBlank', () => {
  it('an object that draws nothing itself and places nothing is blank', () => {
    expect(knownBlank(shard({ opacity: 0 }), [])).toBe(true)
    expect(knownBlank(shard({ extra: { pointsize: 0 } }), [])).toBe(true)
    expect(knownBlank(shard(), [])).toBe(false)
    expect(knownBlank(shard({ opacity: 0, extra: { glow: ['light', 120, 40] } }), [])).toBe(false)
  })
  it('a room of invisible parts is blank only once its parts are resolved', () => {
    expect(knownBlank(host(), null)).toBe(false)
    expect(knownBlank(host(), [placed(shard({ opacity: 0 }))])).toBe(true)
    expect(knownBlank(host(), [placed(shard({ opacity: 0 }), [placed(shard())])])).toBe(false)
    expect(knownBlank(host(), [placed(shard({ opacity: 0 })), placed(shard())])).toBe(false)
  })
  it('a placeholder (nothing resolved for a placement) draws its cube, so it is not blank', () => {
    expect(knownBlank(host(), [placed(null)])).toBe(false)
  })
})
