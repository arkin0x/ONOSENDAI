/**
 * looks.test.ts: the built-in looks a chest and a door wear (lib/looks.ts;
 * chest and door design, D2, R14), and how the scene sizes one
 * (scene/LookMark.tsx).
 *
 * Every chest wears the owner's treasure chest, and a chest with a `door`
 * tag the door slab, until a custom `look` (spec PR #82) plugs in at
 * lookOf. Both are the Maze Kit's files as built: the closed looks solid
 * (constrain "all"), the open door with none. An opened look is the open
 * one; a door without an open look is not drawn once opened, a chest keeps
 * its closed look.
 */
import { describe, expect, it } from 'vitest'
import { builtInLook, drawnLook, isDoor, lookOf, type Look } from '../looks'
import { constrainOf } from '../walkConstrain'
import { lookBounds, lookScale } from '../../scene/LookMark'

describe('which look a thing wears', () => {
  it('a chest wears TREASURE, a chest with a door tag DOOR, and nothing else wears one', () => {
    expect(lookOf({ type: 'chest', event: { tags: [['title', 'Strongbox']] } })?.name).toBe('treasure')
    expect(lookOf({ type: 'chest' })?.name).toBe('treasure')
    expect(lookOf({ type: 'chest', event: { tags: [['door', '4']] } })?.name).toBe('door')
    expect(lookOf({ type: 'key', event: { tags: [['door', '4']] } })).toBeNull()
    expect(lookOf({ type: 'shard' })).toBeNull()
  })

  it('reads a door tag in any form, and only an array tag named door', () => {
    expect(isDoor([['door']])).toBe(true)
    expect(isDoor([['door', '4']])).toBe(true)
    expect(isDoor([['doors', '4'], 'door', ['title', 'door']])).toBe(false)
    expect(isDoor(undefined)).toBe(false)
  })

  it('is one shared model per look, read once', () => {
    expect(builtInLook('treasure')).toBe(builtInLook('treasure'))
    expect(lookOf({ type: 'chest' })).toBe(builtInLook('treasure'))
  })
})

describe('the built-in models', () => {
  it('the treasure chest is the owner’s model, closed and open, both solid', () => {
    const t = builtInLook('treasure')
    expect(t.closed.vertices).toHaveLength(188)
    expect(t.closed.faces).toHaveLength(330)
    expect(t.open?.vertices).toHaveLength(221)
    expect(t.open?.faces).toHaveLength(374)
    expect(constrainOf(t.closed)).toBe('all')
    expect(constrainOf(t.open!)).toBe('all')
  })

  it('the door slab is solid closed and walkable open', () => {
    const d = builtInLook('door')
    expect(d.closed.mode).toBe('solid')
    expect(constrainOf(d.closed)).toBe('all')
    expect(d.open).not.toBeNull()
    expect(constrainOf(d.open!)).toBe('off')
  })

  it('the chest stands on its origin: base on y 0, centred, one gibson', () => {
    const b = lookBounds(builtInLook('treasure').closed)
    expect(b.min[1]).toBeCloseTo(0, 6)
    expect(b.max[1]).toBeCloseTo(95 / 120, 6)
    expect(Math.abs(b.min[0] + b.max[0])).toBeLessThan(0.05)
    expect(b.longest).toBeLessThanOrEqual(1)
    expect(b.longest).toBeGreaterThan(0.85)
  })
})

describe('where each model stands about its origin (review of #532)', () => {
  const box = (m: Parameters<typeof lookBounds>[0]): number[] => { const b = lookBounds(m); return [...b.min, ...b.max].map((x) => Math.round(x * 1000) / 1000) }
  it('the door slab fills a 2 x 3 opening above its sill, 0.5 deep behind it with its plates proud', () => {
    expect(box(builtInLook('door').closed)).toEqual([-1, 0, -0.642, 1, 3, 0.142])
  })
  it('the open door is its bottom rail, up in the lintel, clear of the opening below', () => {
    expect(box(builtInLook('door').open!)).toEqual([-0.983, 2.6, -0.483, 0.983, 2.983, -0.017])
  })
  it('the open chest\u2019s lid stands up to 1.4 and leans back (-z), never forward', () => {
    expect(box(builtInLook('treasure').closed)).toEqual([-0.45, 0, -0.442, 0.45, 0.792, 0.467])
    expect(box(builtInLook('treasure').open!)).toEqual([-0.45, 0, -0.775, 0.45, 1.4, 0.467])
  })
})

describe('what is drawn', () => {
  const treasure = builtInLook('treasure')
  const door = builtInLook('door')
  it('closed until opened, then the open look', () => {
    expect(drawnLook(treasure, false)).toBe(treasure.closed)
    expect(drawnLook(treasure, true)).toBe(treasure.open)
    expect(drawnLook(door, true)).toBe(door.open)
  })

  it('with no open look: a chest keeps its closed look, a door is not drawn', () => {
    const chest: Look = { ...treasure, open: null }
    const slab: Look = { ...door, open: null }
    expect(drawnLook(chest, true)).toBe(treasure.closed)
    expect(drawnLook(slab, true)).toBeNull()
  })
})

describe('how big a look is drawn', () => {
  it('at its true size, or at the floor when that is larger on screen', () => {
    // True size 2 render units a model unit, a 1-unit chest, a 24 px floor at 0.01 units a pixel: 0.24 < 2.
    expect(lookScale(2, 1, 24, 0.01)).toBe(2)
    // Zoomed out: the true size is a speck, so the floor wins.
    expect(lookScale(1e-6, 1, 24, 0.01)).toBeCloseTo(0.24, 9)
    // Nothing to measure: the true size.
    expect(lookScale(3, 0, 24, 0.01)).toBe(3)
  })
})
