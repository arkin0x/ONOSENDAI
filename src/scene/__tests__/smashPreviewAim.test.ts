/**
 * smashPreviewAim.test.ts - when the smash preview shows (scene/SmashPreview.tsx
 * previewAim): with the Compiler in hand at a block in reach; bare-handed only
 * while a SMASH hold is under way, at the hold's own block; never outside
 * TERRAIN, with the bag open, or from the swing to the shatter's main burst.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { previewAim } from '../SmashPreview'
import { useTerrain, type TerrainSession } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { useSmashHold } from '../../terrain/smashHold'
import { terrainCursor } from '../TerrainLayer'
import { COMPILER_ID } from '../../lib/terrain/terrainDb'
import { RESOLVE_AFTER_MS, SWING_MS } from '../../lib/blueprint/smash'
import type { PreviewAim } from '../../lib/blueprint/smashPreview'

const field = { plane: useCyberspace.getState().plane, version: 7, world: {} } as unknown as TerrainSession
let reach = true
/** The aim for the fake field, with reach as the test says. */
const aim = (o: PreviewAim, now: number): PreviewAim | null => previewAim(o, now, field, () => reach)
const out = (): PreviewAim => ({ field: {}, x: 0, y: 0, z: 0, bare: false, version: 0 })
const hand = (compiler: boolean): void => {
  const inv = useTerrain.getState().inventory
  useTerrain.setState({ active: true, sheet: false, inventory: { ...inv, hotbar: [compiler ? COMPILER_ID : 8, ...inv.hotbar.slice(1)], slot: 0 } })
}

describe('when the smash preview shows', () => {
  beforeEach(() => {
    reach = true
    useSmashHold.setState({ since: null, ms: 0, target: null, bare: false, swingAt: null })
    terrainCursor.hit = { cell: [3, 4, 5] } as typeof terrainCursor.hit
  })
  afterEach(() => {
    terrainCursor.hit = null
    useTerrain.setState({ active: false, sheet: false })
  })

  it('the Compiler in hand, aimed at a block in reach: that block, the Compiler\'s reach, the blocks\' version', () => {
    hand(true)
    const a = aim(out(), 1000)!
    expect(a).not.toBeNull()
    expect([a.x, a.y, a.z, a.bare, a.version, a.field]).toEqual([3, 4, 5, false, 7, field])
  })

  it('writes into the aim it is given, so a frame makes nothing new', () => {
    hand(true)
    const o = out()
    expect(aim(o, 1000)).toBe(o)
  })

  it('out of reach, or aimed at nothing: none', () => {
    hand(true)
    reach = false
    expect(aim(out(), 1000)).toBeNull()
    reach = true
    terrainCursor.hit = null
    expect(aim(out(), 1000)).toBeNull()
  })

  it('a bare hand: none while aiming, the hold\'s block while SMASH is held', () => {
    hand(false)
    expect(aim(out(), 1000)).toBeNull()
    useSmashHold.setState({ since: 900, ms: 7000, target: [9, 9, 9], bare: true })
    const a = aim(out(), 1000)!
    expect([a.x, a.y, a.z, a.bare]).toEqual([9, 9, 9, true])
  })

  it('a Compiler hold keeps to the block it started on, wherever the cross goes', () => {
    hand(true)
    useSmashHold.setState({ since: 900, ms: 4000, target: [1, 1, 1], bare: false })
    terrainCursor.hit = { cell: [20, 0, 0] } as typeof terrainCursor.hit
    const a = aim(out(), 1000)!
    expect([a.x, a.y, a.z, a.bare]).toEqual([1, 1, 1, false])
  })

  it('hidden outside TERRAIN, with the bag open, and from the swing until the shatter\'s main burst is over', () => {
    hand(true)
    useTerrain.setState({ sheet: true })
    expect(aim(out(), 1000)).toBeNull()
    useTerrain.setState({ sheet: false, active: false })
    expect(aim(out(), 1000)).toBeNull()
    useTerrain.setState({ active: true })
    useSmashHold.setState({ swingAt: 1000 })
    expect(aim(out(), 1000)).toBeNull()
    expect(aim(out(), 1000 + SWING_MS + RESOLVE_AFTER_MS - 1)).toBeNull()
    expect(aim(out(), 1000 + SWING_MS + RESOLVE_AFTER_MS)).not.toBeNull()
  })
})
