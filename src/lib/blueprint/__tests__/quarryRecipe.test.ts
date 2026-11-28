/**
 * quarryRecipe.test.ts - the Quarry Charge's game recipe (DECK-0010 §8.5):
 * its key and lookup are the spec's, by the real derivation; it compiles
 * with the Compiler, struck at any of its seven blocks, into seven Quarry
 * Charges from the client's own copy, never bare-handed; mirrored across X
 * it compiles nothing, across Y or Z it is the same; and no record, from a
 * relay or a card, ever gives a tool.
 */

import { describe, expect, it } from 'vitest'
import { arrangementFrom, type Cell } from '../arrangement'
import { CINDERROCK, COMPILER_RECIPE, FERROVEIN, QUARRY_CHARGE_COUNT, QUARRY_CHARGE_RECIPE, RUSTBAND, UMBERSLATE, sameArrangement } from '../recipes'
import { compile, compiles, smashGroup, type SmashDeps } from '../smash'
import { QUARRY_KEY_HEX, QUARRY_LOOKUP, QUARRY_NAME, gameNoDeploy, isQuarryPrize, toolName, toolWhat } from '../gameCard'
import { isPrize, readRecord, recordTemplate, sealPrize, sheetShape, type RecordEvent } from '../format'
import { keyOf } from '../keyClient'
import { QUARRY_LOOK } from '../quarryModel'
import { bytesToHex, hexToBytes } from '../../events'
import vectors from './fixtures/blueprints-vectors.json'

type Cell4 = [number, number, number, number]
const SPEC: Cell4[] = [[1, 0, 1, 2], [1, 1, 1, 40], [0, 1, 1, 5], [1, 1, 2, 5], [1, 1, 0, 5], [2, 1, 1, 7], [1, 2, 1, 2]]
const arr = (cells: readonly Cell4[]) => arrangementFrom(cells.map(([x, y, z, id]) => ({ at: [x, y, z] as const, id })))!

const deps = (records: RecordEvent[] = [], relay: RecordEvent[] | null = null): SmashDeps => ({
  known: async () => records, relay: async () => relay, remember: () => {}, me: () => 'a'.repeat(64), follows: () => new Set(), muted: () => new Set(), lockHeights: () => [], regionKey: () => null,
})

/** The recipe built at `at` in an otherwise empty world, as a smash reads it. */
function world(cells: readonly Cell4[], at: Cell = [10, 20, 30]): (x: number, y: number, z: number) => number {
  const m = new Map(cells.map(([x, y, z, id]) => [`${x + at[0]},${y + at[1]},${z + at[2]}`, id]))
  return (x, y, z) => m.get(`${x},${y},${z}`) ?? 0
}

/** A record anyone could publish under a lookup, sealing a tool. */
async function toolRecord(lookup: string, keyHex: string): Promise<RecordEvent> {
  const sheet = { ...sheetShape(QUARRY_CHARGE_RECIPE, () => true), lock: 'standard' as const, prize: { reveal: 'hidden' as const } }
  const sealed = await sealPrize(hexToBytes(keyHex), { type: 'tool', tool: 'quarry-charge', count: 9999 })
  const t = recordTemplate({ lookup, sheet, sealed, title: 'Free charges', createdAt: 1_795_000_100 })
  return { ...t, id: 'e'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) }
}

describe('the Quarry Charge recipe (DECK-0010 §8.5)', () => {
  it('is the spec\'s cross of seven: Umberslate below and above a Ferrovein, Rustband on -X, -Z and +Z, Cinderrock on +X', () => {
    expect([UMBERSLATE, RUSTBAND, CINDERROCK, FERROVEIN]).toEqual([2, 5, 7, 40])
    expect(sameArrangement(QUARRY_CHARGE_RECIPE, arr(SPEC))).toBe(true)
    expect(QUARRY_CHARGE_RECIPE.size).toEqual([3, 3, 3])
    expect(QUARRY_CHARGE_RECIPE.cells.filter(Boolean)).toHaveLength(7)
    const v = (vectors.arrangements as unknown as Array<{ name: string; cells: Cell4[]; key: string; lookup: string }>).find((a) => a.name === 'quarry-charge')!
    expect(sameArrangement(QUARRY_CHARGE_RECIPE, arr(v.cells))).toBe(true)
    expect(v.key).toBe(QUARRY_KEY_HEX)
    expect(v.lookup).toBe(QUARRY_LOOKUP)
  })

  it('its key and lookup are the spec\'s, by the real derivation', async () => {
    const k = await keyOf(QUARRY_CHARGE_RECIPE)
    expect(bytesToHex(k.key)).toBe('4a98648039e97902a1e300ec678a4a2d37dfdebf177b8ef5d644343cad3819d9')
    expect(k.lookup).toBe('e12e7f66a13349efa89ad831967ef367411d0c9831081b8d420993c4afb46995')
  }, 60_000)

  it('compiles with the Compiler into seven Quarry Charges, struck at any of its seven blocks', async () => {
    const read = world(SPEC)
    for (const [x, y, z] of SPEC) {
      const g = smashGroup(read, [x + 10, y + 20, z + 30], false)
      expect(g.isolated).toBe(true)
      expect(sameArrangement(g.arrangement!, QUARRY_CHARGE_RECIPE)).toBe(true)
      expect(compiles(g.arrangement, false)).toBe(true)
      const out = await compile(g.arrangement!, false, deps())
      expect(out.lookup).toBe(QUARRY_LOOKUP)
      expect(out.found).toHaveLength(1)
      expect(out.found[0].prize).toEqual({ type: 'tool', tool: 'quarry-charge', count: QUARRY_CHARGE_COUNT })
      expect(out.found[0]).toMatchObject({ name: QUARRY_NAME, maker: 'game', record: null })
    }
    expect(QUARRY_CHARGE_COUNT).toBe(7)
  })

  it('never bare-handed: a bare hand compiles only the Compiler', async () => {
    const read = world(SPEC)
    for (const [x, y, z] of SPEC) {
      // It fits a bare hand's reach of 3, so it is gathered whole, and still compiles nothing.
      const g = smashGroup(read, [x + 10, y + 20, z + 30], true)
      expect(sameArrangement(g.arrangement!, QUARRY_CHARGE_RECIPE)).toBe(true)
      expect(compiles(g.arrangement, true)).toBe(false)
      expect((await compile(g.arrangement!, true, deps())).found).toEqual([])
    }
    expect(compiles(COMPILER_RECIPE, true)).toBe(true)
  })

  it('mirrored across X it is another arrangement and compiles nothing; across Y or Z it is the same', async () => {
    const mx = SPEC.map(([x, y, z, id]) => [2 - x, y, z, id] as Cell4)
    const my = SPEC.map(([x, y, z, id]) => [x, 2 - y, z, id] as Cell4)
    const mz = SPEC.map(([x, y, z, id]) => [x, y, 2 - z, id] as Cell4)
    expect(sameArrangement(arr(mx), QUARRY_CHARGE_RECIPE)).toBe(false)
    expect(sameArrangement(arr(my), QUARRY_CHARGE_RECIPE)).toBe(true)
    expect(sameArrangement(arr(mz), QUARRY_CHARGE_RECIPE)).toBe(true)
    const vx = (vectors.arrangements as unknown as Array<{ name: string; lookup: string }>).find((a) => a.name === 'quarry-charge-mirrored-x')!
    const g = smashGroup(world(mx), [11, 21, 31], false)
    const out = await compile(g.arrangement!, false, deps())
    expect(out.lookup).toBe(vx.lookup)
    expect(out.found).toEqual([])
    // Turned a quarter turn about Y, the Cinderrock on +Z: another arrangement too.
    const turned = SPEC.map(([x, y, z, id]) => [2 - z, y, x, id] as Cell4)
    expect(sameArrangement(arr(turned), QUARRY_CHARGE_RECIPE)).toBe(false)
  }, 60_000)

  it('a tool comes only from the game recipe: a record under its lookup, or under the mirror\'s, gives nothing', async () => {
    const own = await toolRecord(QUARRY_LOOKUP, QUARRY_KEY_HEX)
    expect(readRecord(own)?.lookup).toBe(QUARRY_LOOKUP)
    // Under the game recipe's lookup, the client's own copy alone: seven, never the record's 9999.
    const out = await compile(QUARRY_CHARGE_RECIPE, false, deps([own], [own]))
    expect(out.found.map((f) => f.prize)).toEqual([{ type: 'tool', tool: 'quarry-charge', count: 7 }])
    // Under any other lookup a record's tool prize is passed over.
    const mx = arr(SPEC.map(([x, y, z, id]) => [2 - x, y, z, id] as Cell4))
    const k = await keyOf(mx)
    const stranger = await toolRecord(k.lookup, bytesToHex(k.key))
    expect((await compile(mx, false, deps([stranger], [stranger]))).found).toEqual([])
  }, 60_000)

  it('its prize reads, with a count of 1 or more; its words and model are its own', () => {
    expect(isPrize({ type: 'tool', tool: 'quarry-charge', count: 7 })).toBe(true)
    expect(isPrize({ type: 'tool', tool: 'quarry-charge' })).toBe(true)
    expect(isPrize({ type: 'tool', tool: 'quarry-charge', count: 0 })).toBe(false)
    expect(isPrize({ type: 'tool', tool: 'quarry-charge', count: 1.5 })).toBe(false)
    expect(isPrize({ type: 'tool', tool: 'wide-pick' })).toBe(false)
    const p = { type: 'tool', tool: 'quarry-charge', count: 7 }
    expect(isQuarryPrize(p)).toBe(true)
    expect(toolName(p)).toBe('Quarry Charges')
    expect(toolName({ type: 'tool', tool: 'compiler' })).toBe('The Compiler')
    expect(toolWhat(p)).toMatch(/^Seven Quarry Charges/)
    expect(gameNoDeploy({ record: { id: 'game:quarry-charge' } })).toMatch(/seven Quarry Charges/)
    expect(gameNoDeploy({ record: { id: 'game:compiler' } })).toMatch(/Compiler/)
    expect(QUARRY_LOOK).toBe('tri-pack')
  })
})
