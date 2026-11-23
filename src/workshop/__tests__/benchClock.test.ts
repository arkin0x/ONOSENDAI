/**
 * benchClock.test.ts - the bench's own clock for moving objects (Bench.tsx
 * benchClock, store/animPreview.ts): playing, the world clock; paused, the
 * moment it was paused at; scrubbed, a share of the longest motion's cycle in
 * seconds, marked as chosen by hand so reduced motion still shows it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { benchClock } from '../Bench'
import { useAnimPreview } from '../../store/animPreview'
import { useWorkshop } from '../../store/useWorkshop'
import type { ClockReading } from '../../lib/worldClock'

const shared = (t: number): ClockReading => ({ t, version: 3, nowS: 1, chosen: false })

beforeEach(() => {
  const s = { ...newShard('Two'), extra: { anim: [['turn', 'y', 1, 20, 0], ['slide', 'x', 120, 1, 4, 0]] } } as ShardModel
  useWorkshop.setState({ shards: [s], currentId: s.id })
  useAnimPreview.getState().stop()
})

describe('the bench clock', () => {
  it('playing: the world clock as the frame read it', () => {
    useAnimPreview.getState().play()
    const r = benchClock(shared(1_795_132_800.25))
    expect(r.t).toBe(1_795_132_800.25)
    expect(r.chosen).toBe(false)
  })
  it('paused: held at the moment it was paused at', () => {
    useAnimPreview.getState().pause()
    const at = useAnimPreview.getState().frozen
    expect(benchClock(shared(1_795_132_800)).t).toBe(at)
    expect(benchClock(shared(1_799_000_000)).t).toBe(at)
  })
  it('scrubbed: a share of the longest cycle (20 s here), chosen by hand', () => {
    useAnimPreview.getState().setScrub(0.5)
    const r = benchClock(shared(1_795_132_800))
    expect(r.t).toBe(10)
    expect(r.chosen).toBe(true)
  })
})
