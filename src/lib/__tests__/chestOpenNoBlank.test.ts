/**
 * chestOpenNoBlank.test.ts: opening a chest never leaves its model blank
 * (arkinox, 2026-11-18: "opening it makes the chest model disappear for a few
 * seconds ... but a custom chest only has 1 model").
 *
 * A chest with one model plays no swap (lib/looks.ts swapsOnOpen): its resting
 * mesh (scene/ChestLooks RestLook) is never hidden, and is handed the very same
 * model before and after OPEN, so nothing is rebuilt or fetched and its walls
 * stay. A two-part look has the closed chest (scene/ChestCeremony LidOpening)
 * or the open look (the resting mesh, shown from restShowsFrom) drawn on every
 * frame of the opening, the lid outlasting the handoff by LID_HANDOFF_MS.
 */
import { describe, expect, it } from 'vitest'
import type { ShardModel } from 'sno-core/shards'
import { builtInLook, drawnLook, swapsOnOpen, type Look } from '../looks'
import { ceremonyLength, LID_MS } from '../ceremony'
import { LID_HANDOFF_MS, lidPartsShown, restShowsFrom } from '../../scene/ChestCeremony'
import { restPlan, restVisible } from '../../scene/ChestLooks'

function model(name: string): ShardModel {
  return {
    id: name, name, unit: 0, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0,
    vertices: [{ p: [-1, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 3, 0], c: [0, 0, 1] }],
    faces: [[0, 1, 2]],
  }
}
const custom = (open: boolean): Look => ({ name: 'custom', kind: 'chest', closed: model('Crate'), open: open ? model('Crate open') : null })

describe('opening a chest never leaves its model blank', () => {
  it('a chest with one model plays no swap, and draws that very model on every frame through opening', () => {
    const look = custom(false)
    expect(swapsOnOpen(look)).toBe(false)
    // The same model object before and after: the resting mesh is never handed another, so nothing is rebuilt or fetched.
    expect(drawnLook(look, true)).toBe(drawnLook(look, false))
    // OPEN's ceremony, on either path, plays nothing over it, so the resting mesh is never hidden, whatever the clock.
    const at = 1000
    for (const calm of [false, true]) {
      const plan = restPlan(look, { kind: 'chest', at, calm })
      expect(plan.swap).toBeUndefined()
      for (let t = 0; t <= ceremonyLength('chest', calm) + 100; t += 4) expect(restVisible(!!plan.swap, plan.showsFrom, at + t)).toBe(true)
    }
    // Its walls are that model too (store/walkWalls wallItems walks drawnLook).
    expect(drawnLook(look, true)).toBe(look.closed)
  })

  it('a two-part look (TREASURE) has the closed chest or the open look drawn on every millisecond of the lid opening', () => {
    const look = builtInLook('treasure')
    expect(swapsOnOpen(look)).toBe(true)
    const at = 5000
    const plan = restPlan(look, { kind: 'chest', at, calm: false })
    expect(plan.swap).toBeDefined()
    const from = plan.showsFrom
    expect(from).toBe(at + LID_MS)
    expect(restShowsFrom(look, { at, calm: false })).toBe(from)
    for (let t = 0; t <= ceremonyLength('chest', false) + 100; t++) {
      expect(lidPartsShown(t) || restVisible(true, from, at + t)).toBe(true)
    }
    // Even read on two clocks a frame apart: the lid outlasts the handoff.
    for (let t = 0; t <= LID_MS + 100; t++) {
      expect(lidPartsShown(t + LID_HANDOFF_MS - 1) || restVisible(true, from, at + t)).toBe(true)
    }
    // A model on either side of OPEN, for drawing and for walls.
    expect(drawnLook(look, false)).not.toBeNull()
    expect(drawnLook(look, true)).not.toBeNull()
  })

  it('a custom look with an open part swaps too; on a crossfade the resting open look waits for the end, while the fade draws both', () => {
    const look = custom(true)
    expect(swapsOnOpen(look)).toBe(true)
    expect(restShowsFrom(look, { at: 0, calm: false })).toBeNull()
    expect(restShowsFrom(builtInLook('treasure'), { at: 0, calm: true })).toBeNull()
    // Once the ceremony is gone the resting mesh shows at once.
    expect(restVisible(false, null, 0)).toBe(true)
  })

  it('a door with no open look still fades away as it opens, and simply stands again as it closes', () => {
    const door: Look = { name: 'custom', kind: 'door', closed: model('Slab'), open: null }
    expect(swapsOnOpen(door)).toBe(true)
    expect(swapsOnOpen(door, true)).toBe(false)
  })
})
