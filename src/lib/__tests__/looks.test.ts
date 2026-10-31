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
import { flatten } from 'sno-core/shards'
import { builtInLook, drawnLook, isDoor, keptInChest, lookOf, type Look } from '../looks'
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

  it('reads a door only from one door tag with a well-formed height (spec #82: a malformed one is dropped)', () => {
    expect(isDoor([['door']])).toBe(false)
    expect(isDoor([['door', '04']])).toBe(false)
    expect(isDoor([['door', '0']])).toBe(false)
    expect(isDoor([['door', '4'], ['door', '4']])).toBe(false)
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

describe('what stays in a chest', () => {
  const here = { x: 8n, y: 9n, z: 10n }
  const box = { at: here, tags: [['title', 'Box']] }
  const gate = { at: here, tags: [['title', 'Gate'], ['door', '4']] }
  it('a thing found in a bag is drawn where it stands', () => {
    expect(keptInChest({ at: here }, undefined)).toBe(false)
  })
  it('a thing out of a chest at the chest\u2019s own place stays in it, to float out as loot', () => {
    expect(keptInChest({ chestId: 'box', at: here }, box)).toBe(true)
  })
  it('a thing aimed at its own point in the chest\u2019s region is drawn there, as before', () => {
    expect(keptInChest({ chestId: 'box', at: { ...here, x: 9n } }, box)).toBe(false)
  })
  it('everything behind a door stands in the room, and a thing whose chest is unknown is drawn', () => {
    expect(keptInChest({ chestId: 'gate', at: here }, gate)).toBe(false)
    expect(keptInChest({ chestId: 'gone', at: here }, undefined)).toBe(false)
  })
})

describe('the treasure chest’s lid', () => {
  const t = builtInLook('treasure')
  it('cuts the closed chest into a body and a lid, every face once, every point it uses', () => {
    const lid = t.lid!
    expect(lid.body.faces.length + lid.lid.faces.length).toBe(t.closed.faces.length)
    expect(lid.lid.faces.length).toBe(154)
    for (const part of [lid.body, lid.lid]) {
      expect(part.facecolors).toHaveLength(part.faces.length)
      const used = new Set(part.faces.flat())
      expect(used.size).toBe(part.vertices.length)
      expect(Math.max(...used)).toBe(part.vertices.length - 1)
    }
  })

  it('turned on its hinge, the lid stands where the owner’s open chest has it', () => {
    const { lid, hinge } = t.lid!
    const open = flatten(t.open!).positions
    const pts = flatten(lid).positions
    const c = Math.cos(hinge.angle), s = Math.sin(hinge.angle)
    let landed = 0
    let worst = 0
    const n = pts.length / 3
    for (let i = 0; i < n; i++) {
      // A turn about +X through the hinge, as three's rotation.x turns a group.
      const y = pts[i * 3 + 1] - hinge.y, z = pts[i * 3 + 2] - hinge.z
      const p = [pts[i * 3], hinge.y + y * c - z * s, hinge.z + y * s + z * c]
      let best = Infinity
      for (let j = 0; j < open.length; j += 3) best = Math.min(best, Math.hypot(open[j] - p[0], open[j + 1] - p[1], open[j + 2] - p[2]))
      if (best < 2.5 / 120) landed++
      worst = Math.max(worst, best)
    }
    expect(n).toBe(90)
    expect(landed).toBeGreaterThanOrEqual(82)
    // Every point, the straps' feet at the cut included (the worst, 4.8 ticks), within 5 ticks (review of #533).
    expect(worst * 120).toBeLessThan(5)
  })

  it('the lid is everything at or above the cut, the body everything below it but the gold band (review of #533)', () => {
    const { lid, body } = t.lid!
    const lb = lookBounds(lid), bb = lookBounds(body)
    expect(Math.round(lb.min[1] * 120)).toBe(62)
    expect(Math.round(lb.max[1] * 120)).toBe(95)
    expect(Math.round(bb.min[1] * 120)).toBe(0)
    expect(Math.round(bb.max[1] * 120)).toBe(64)
  })

  it('only TREASURE has a lid', () => {
    expect(builtInLook('door').lid).toBeUndefined()
  })
})
