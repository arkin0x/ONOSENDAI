/**
 * A shard's picture key changes with how it draws: opacity, point size and
 * glow (lib/thumbKey.ts), read as the renderer reads them, and LOOK moved
 * on when pictures began to draw halos.
 */
import { describe, expect, it } from 'vitest'
import { newShard, type ShardModel } from 'sno-core/shards'
import { LOOK, thumbKeyOf } from '../thumbKey'

const base = (): ShardModel => ({ ...newShard('Lamp'), mode: 'points', vertices: [{ p: [0, 0, 0], c: [1, 0.6, 0.2] }] })

describe('thumbKeyOf', () => {
  it('pictures drawn before halos are not shown again', () => {
    expect(LOOK).toBeGreaterThanOrEqual(2)
  })
  it('changes with opacity, point size and glow', () => {
    const s = base()
    const keys = [
      thumbKeyOf(s),
      thumbKeyOf({ ...s, opacity: 0 }),
      thumbKeyOf({ ...s, opacity: 40 }),
      thumbKeyOf({ ...s, extra: { pointsize: 48 } }),
      thumbKeyOf({ ...s, extra: { pointsize: 0 } }),
      thumbKeyOf({ ...s, extra: { glow: ['light', 240, 35] } }),
      thumbKeyOf({ ...s, extra: { glow: ['fog', 240, 35] } }),
      thumbKeyOf({ ...s, extra: { glow: ['fog', 120, 35] } }),
      thumbKeyOf({ ...s, extra: { glow: ['fog', 120, 90] } }),
    ]
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('a malformed value keys as absent, and other extra fields do not matter', () => {
    const s = base()
    expect(thumbKeyOf({ ...s, extra: { glow: ['smog', 240, 35], pointsize: -1 } })).toBe(thumbKeyOf(s))
    expect(thumbKeyOf({ ...s, extra: { constrain: 'all' } })).toBe(thumbKeyOf(s))
  })
})
