/**
 * walkBounceWrite.test.ts - the writer behind the workshop's BOUNCE control
 * (arkinox, 2026-11-10: "can i make bounce surfaces in the workshop now
 * then?"). What these prove: withBounce writes `bounce` and `springboard` only
 * as readBounce and readSpringboard read them, so no press can store an
 * invalid value; OFF removes both; SPRINGBOARD rides only beside a fixed
 * height; a press that changes nothing is the same object; every other field
 * in `extra` (constrain first) is kept; and the chip names what a walker meets.
 */
import { describe, expect, it } from 'vitest'
import { newShard, toPayload, fromPayload, type ShardModel } from 'sno-core/shards'
import {
  BOUNCE_MAX, BOUNCE_MIN, BOUNCE_PRESETS, BOUNCE_REFLECT, BOUNCE_START,
  bounceChip, bounceChipTip, bounceOf, clampBounce, readBounce, readSpringboard, springboardOf, withBounce,
} from '../walkBounce'
import { withConstrain } from '../walkConstrain'

function pad(): ShardModel {
  return { ...newShard('Pad'), mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 0, 1], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}

/** Whatever is in `extra` for the two fields is something the walker reads exactly as written. */
function valid(s: ShardModel): void {
  const e = s.extra ?? {}
  if ('bounce' in e) expect(readBounce(e.bounce)).toBe(e.bounce)
  if ('springboard' in e) {
    expect(e.springboard).toBe(true)
    expect(typeof e.bounce).toBe('number')
  }
  expect(s).not.toHaveProperty('bounce')
  expect(s).not.toHaveProperty('springboard')
}

describe('withBounce', () => {
  it('writes a fixed height, REFLECT and a springboard into extra, as the walker reads them', () => {
    const h = withBounce(pad(), 12)
    expect(h.extra).toEqual({ bounce: 12 })
    expect(bounceOf(h)).toBe(12)
    expect(springboardOf(h)).toBe(false)
    const s = withBounce(pad(), 12, true)
    expect(s.extra).toEqual({ bounce: 12, springboard: true })
    expect(springboardOf(s)).toBe(true)
    const r = withBounce(pad(), BOUNCE_REFLECT)
    expect(r.extra).toEqual({ bounce: 'reflect' })
    expect(bounceOf(r)).toBe('reflect')
    // On the wire: flat fields beside constrain, and back again.
    const wire = toPayload(withConstrain(s, 'all')) as unknown as Record<string, unknown>
    expect(wire.bounce).toBe(12)
    expect(wire.springboard).toBe(true)
    expect(wire.constrain).toBe('all')
    const back = fromPayload(JSON.parse(JSON.stringify(wire)), 'x')!
    expect(bounceOf(back)).toBe(12)
    expect(springboardOf(back)).toBe(true)
  })

  it('OFF removes both fields, and leaves no empty extra behind', () => {
    const off = withBounce(withBounce(pad(), 18, true), 0)
    expect(off).not.toHaveProperty('extra')
    expect(bounceOf(off)).toBe(0)
    expect(springboardOf(off)).toBe(false)
    expect(toPayload(off)).not.toHaveProperty('bounce')
    expect(toPayload(off)).not.toHaveProperty('springboard')
  })

  it('keeps every other field in extra: constrain survives a bounce and an OFF', () => {
    const walled = withConstrain(pad(), 'off')
    const b = withBounce(walled, 6, true)
    expect(b.extra).toEqual({ constrain: 'off', bounce: 6, springboard: true })
    expect(withBounce(b, 0).extra).toEqual({ constrain: 'off' })
  })

  it('SPRINGBOARD rides only beside a fixed height: REFLECT and OFF drop it', () => {
    expect(withBounce(pad(), BOUNCE_REFLECT, true).extra).toEqual({ bounce: 'reflect' })
    expect(withBounce(pad(), 0, true)).not.toHaveProperty('extra')
    expect(withBounce(withBounce(pad(), 12, true), BOUNCE_REFLECT).extra).toEqual({ bounce: 'reflect' })
  })

  it('never writes an invalid value: anything the walker would not read is no bounce', () => {
    const junk: unknown[] = [0, -1, BOUNCE_MIN - 1, BOUNCE_MAX + 1, 12.5, NaN, Infinity, '12', 'REFLECT', 'reflect ', null, undefined, true, {}, [12]]
    for (const raw of junk) {
      const s = withBounce(withBounce(pad(), 12, true), raw, true)
      valid(s)
      expect(s).not.toHaveProperty('extra')
    }
    for (let n = BOUNCE_MIN; n <= BOUNCE_MAX; n++) {
      const s = withBounce(pad(), n, true)
      valid(s)
      expect(s.extra).toEqual({ bounce: n, springboard: true })
    }
    // A truthy springboard that is not `true` is no springboard.
    expect(withBounce(pad(), 12, 1 as unknown as boolean).extra).toEqual({ bounce: 12 })
  })

  it('replaces a malformed value already there, and drops a top-level copy so it cannot shadow the new one', () => {
    const bad = { ...pad(), extra: { bounce: 99, springboard: 'yes', constrain: 'all' } } as ShardModel
    expect(withBounce(bad, 3).extra).toEqual({ constrain: 'all', bounce: 3 })
    expect(withBounce(bad, 0).extra).toEqual({ constrain: 'all' })
    const lifted = { ...pad(), bounce: 7, springboard: true } as ShardModel
    const set = withBounce(lifted, 12)
    valid(set)
    expect(bounceOf(set)).toBe(12)
    expect(springboardOf(set)).toBe(false)
  })

  it('a press that changes nothing is the same object', () => {
    const s = withBounce(pad(), 12, true)
    expect(withBounce(s, 12, true)).toBe(s)
    const r = withBounce(pad(), BOUNCE_REFLECT)
    expect(withBounce(r, BOUNCE_REFLECT, true)).toBe(r)
    const plain = pad()
    expect(withBounce(plain, 0)).toBe(plain)
    expect(withBounce(s, 12, false)).not.toBe(s)
  })
})

describe('the control\'s numbers', () => {
  it('presets and the start are heights the payload can carry', () => {
    for (const n of [...BOUNCE_PRESETS, BOUNCE_START]) expect(readBounce(n)).toBe(n)
    expect(BOUNCE_PRESETS).toEqual([3, 6, 12, 18, 24])
  })

  it('clampBounce keeps a stepped height whole and in range', () => {
    expect(clampBounce(0)).toBe(BOUNCE_MIN)
    expect(clampBounce(25)).toBe(BOUNCE_MAX)
    expect(clampBounce(12.4)).toBe(12)
    expect(clampBounce(NaN)).toBe(BOUNCE_START)
    for (let n = -5; n < 40; n++) expect(readBounce(clampBounce(n))).toBe(clampBounce(n))
  })

  it('readSpringboard is unchanged: only `true`', () => {
    expect(readSpringboard(true)).toBe(true)
    expect(readSpringboard('true')).toBe(false)
  })
})

describe('the chip', () => {
  it('names a fixed height, a springboard and REFLECT, and nothing for no bounce', () => {
    expect(bounceChip(pad())).toBeNull()
    expect(bounceChipTip(pad())).toBe('')
    expect(bounceChip(withBounce(pad(), 12))).toBe('BOUNCE 12')
    expect(bounceChip(withBounce(pad(), 12, true))).toBe('SPRING 12')
    expect(bounceChip(withBounce(pad(), BOUNCE_REFLECT))).toBe('REFLECT')
    expect(bounceChipTip(withBounce(pad(), 6, true))).toBe('Launches walkers 6 gibsons, on walk-on too')
    // A malformed value is no bounce to a walker, and so no chip.
    expect(bounceChip({ extra: { bounce: 30 } })).toBeNull()
  })
})
