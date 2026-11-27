/**
 * airGhostSwitch.test.tsx - air placing switched off in the scene (owner,
 * 2026-11-27: "Tapping the middle of the place distance button should toggle
 * it off so you can't see the place cube. Tap again to toggle it on."): with
 * the real blocks layer (TerrainLayer's marks) over a real field, the look
 * meeting no block and a block in hand, the ghost stands at arm's length;
 * off, none is drawn or aimed, the HUD is told one would stand there (so the
 * stepper shows its off state), and PLACE puts nothing there, saying how to
 * turn it on once; on again, the ghost is back where it stood.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createElement } from 'react'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { TerrainLayer, terrainCursor } from '../TerrainLayer'
import { useCyberspace } from '../../store/useCyberspace'
import { setTerrainSession, useTerrain, type TerrainSession } from '../../store/useTerrain'
import { commitAnchor, commitScale } from '../../lib/renderFrame'
import { TerrainWorld } from '../../lib/terrain/world'
import { idx } from '../../lib/terrain/coords'
import { terrainInput } from '../../terrain/terrainInput'
import { useAirPlace } from '../../store/useAirPlace'
import { AIR_OFF_HINT, forgetAirSwitch, setAirPlacing } from '../../store/airSwitch'
import type { ViewAxes } from '../../lib/space'

vi.mock('../../lib/terrain/blocksClient', () => ({ meshChunkAsync: () => new Promise(() => {}) }))
vi.mock('../../store/terrainShare', async (real) => ({ ...(await real<object>()), sceneDraws: () => {}, aimAt: () => 'ground' }))

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
const ORIGIN = { x: 0x1000000n, y: 0x2000000n, z: 0x3000000n, plane: 0 }
const ANCHOR = { x: ORIGIN.x + 16n, y: ORIGIN.y + 16n, z: ORIGIN.z + 16n, plane: 0 }
/** A block kind to carry (any solid one). */
const BLOCK = 8

function session(): TerrainSession {
  const world = new TerrainWorld(ORIGIN, AXES)
  const slot = world.slotAt(0, 0, 0, true)!
  // A floor far below, nothing in front of the camera: the look meets open air.
  const blocks = new Uint8Array(32 * 32 * 32)
  for (let x = 0; x < 32; x++) for (let z = 0; z < 32; z++) blocks[idx(x, 0, z)] = 1
  slot.blocks = blocks
  slot.own = new Uint8Array(blocks)
  slot.generated = new Uint8Array(blocks)
  slot.surveyed = true
  const owner = useCyberspace.getState().identity.pubkey || 'local'
  return { owner, plane: 0, world, pending: new Map(), layers: new Map(), surveyedKeys: new Set([slot.key]), unreadable: new Set(), building: new Set(), nextSeq: 0, db: null, version: 0 } as unknown as TerrainSession
}

let r: R3fRoot
let field: TerrainSession
let say: Mock<(message: string | null) => void>
let realSay: (m: string | null) => void

beforeEach(async () => {
  useCyberspace.setState({ anchor: ANCHOR, position: ANCHOR, cursor: ANCHOR, scaleExp: 0, plane: 0, walking: true })
  commitAnchor(ANCHOR)
  commitScale(0)
  field = session()
  setTerrainSession(field)
  terrainInput.action = null
  terrainInput.hover = null
  realSay = useTerrain.getState().say
  say = vi.fn()
  const inv = useTerrain.getState().inventory
  useTerrain.setState({ active: true, sheet: false, say, inventory: { ...inv, hotbar: [BLOCK, ...inv.hotbar.slice(1)], counts: { [BLOCK]: 5 }, slot: 0 } })
  r = await r3fRoot()
  await r.render(createElement(TerrainLayer, { axes: AXES }))
  await r.frame()
})

afterEach(async () => {
  await r?.unmount()
  setTerrainSession(null)
  useTerrain.setState({ active: false, say: realSay })
  useAirPlace.setState({ ghost: 'off' })
  setAirPlacing(true)
  forgetAirSwitch()
})

const at = (c: readonly number[]): number => field.world.blockCs(c[0], c[1], c[2])

describe('air placing in the scene', () => {
  it('on: the ghost stands in open air; off: none, the HUD told it is hidden, PLACE does nothing but hint once; on: back', async () => {
    await r.frame()
    expect(terrainCursor.hit).toBeNull()
    expect(terrainCursor.air).not.toBeNull()
    const shown = useAirPlace.getState().ghost
    expect(['ok', 'bad']).toContain(shown)
    const cell = [...terrainCursor.air!.cell]

    setAirPlacing(false)
    await r.frame()
    expect(terrainCursor.air).toBeNull()
    expect(useAirPlace.getState().ghost).toBe('hidden')
    for (let i = 0; i < 3; i++) {
      terrainInput.action = { kind: 'place', at: null }
      await r.frame()
    }
    expect(at(cell)).toBe(0)
    expect(say).toHaveBeenCalledTimes(1)
    expect(say).toHaveBeenCalledWith(AIR_OFF_HINT)
    expect(useTerrain.getState().inventory.counts[BLOCK]).toBe(5)

    setAirPlacing(true)
    await r.frame()
    expect(terrainCursor.air?.cell).toEqual(cell)
    expect(useAirPlace.getState().ghost).toBe(shown)
  })

  it('off with nothing in hand: no ghost belongs, so the stepper hides (off, not hidden)', async () => {
    setAirPlacing(false)
    useTerrain.setState({ inventory: { ...useTerrain.getState().inventory, counts: {} } })
    await r.frame()
    expect(useAirPlace.getState().ghost).toBe('off')
  })
})
