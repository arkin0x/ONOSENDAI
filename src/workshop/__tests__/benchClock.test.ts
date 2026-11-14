/**
 * benchClock.test.ts - the bench's own clock for moving objects (Bench.tsx
 * benchClock, store/animPreview.ts): playing, the paced clock even before
 * headers arrive; paused, the height it was paused at; scrubbed, a share of
 * the longest motion's cycle, marked as chosen by hand so reduced motion
 * still shows it.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { benchClock } from '../Bench'
import { useAnimPreview } from '../../store/animPreview'
import { useWorkshop } from '../../store/useWorkshop'
import { EPOCH_ENDS, pacedHeight } from '../../lib/pacedClock'
import type { PacedReading } from '../../lib/pacedSource'

const shared = (t: number): PacedReading => ({ beta: 0, known: false, secondsPerBlock: 660, version: 3, nowS: 1, t, chosen: false })

beforeEach(() => {
  const s = { ...newShard('Two'), extra: { anim: [['turn', 'y', 30, 1, 0], ['slide', 'x', 120, 1, 4, 0]] } } as ShardModel
  useWorkshop.setState({ shards: [s], currentId: s.id })
  useAnimPreview.getState().stop()
})

describe('the bench clock', () => {
  it('playing: the paced clock, known even before any header (a preview need not wait)', () => {
    useAnimPreview.getState().play()
    const r = benchClock(shared(1_795_132_800))
    expect(r.known).toBe(true)
    expect(r.chosen).toBe(false)
    expect(r.beta).toBeCloseTo(pacedHeight(1_795_132_800, EPOCH_ENDS), 6)
  })
  it('paused: held at the height it was paused at', () => {
    useAnimPreview.getState().pause()
    const at = useAnimPreview.getState().frozen
    expect(benchClock(shared(1_795_132_800)).beta).toBe(at)
    expect(benchClock(shared(1_799_000_000)).beta).toBe(at)
  })
  it('scrubbed: a share of the longest cycle (4 blocks here), chosen by hand', () => {
    useAnimPreview.getState().setScrub(0.5)
    const r = benchClock(shared(1_795_132_800))
    expect(r.beta).toBe(2)
    expect(r.chosen).toBe(true)
  })
})
