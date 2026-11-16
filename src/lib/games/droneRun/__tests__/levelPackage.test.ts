/**
 * levelPackage.test.ts - a level package (level/package.ts) and how a level
 * imported on this device is kept (levelDb.ts), chosen (levelChoice.ts,
 * store/useDroneRunLevels.ts) and turned into a world (level/levelWorld.ts).
 *
 * Zips are built here with fflate, as the zip reader's own tests build them,
 * from made-up levels (the built-in field's frame and pieces).
 */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync, type Zippable } from 'fflate'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { LEVEL_MAX_FACES, PIECE_MAX_BYTES, readLevelPackage } from '../level/package'
import { placeholderField } from '../level/placeholderField'
import { worldFromLevel } from '../level/levelWorld'
import { insideBox, type Level } from '../level/level'
import { chooseLevel, chosenLevel, LEVEL_CHOICE_KEY } from '../levelChoice'
import { deleteLevel, getLevel, listLevels, openLevelsDb, putLevel, type StoredLevel } from '../levelDb'
import { DRONE_RUN_GAME } from '../game'
import { NO_STORAGE_MESSAGE, useDroneRunLevels } from '../../../../store/useDroneRunLevels'

const field = placeholderField()

/** A made-up level: the built-in field's frame, its own id, three pieces. */
function testLevel(over: Partial<Level> = {}): Level {
  return {
    ...field.level,
    id: 'test-field-1',
    name: 'Test field',
    pieces: [
      { piece: 'field-ground-flat', at: [128, 64, 192] },
      { piece: 'field-crate', at: [128, 64, 170] },
      { piece: 'field-crate', at: [120, 64, 160] },
    ],
    ...over,
  }
}

/** A zip of `level` as level.json, and payloads/<name>.json for each name in `pieces` (all the level places by default). */
function zipOf(level: unknown, pieces?: Record<string, unknown>, prefix = ''): Uint8Array {
  const files: Zippable = { [`${prefix}level.json`]: strToU8(JSON.stringify(level)) }
  const names = pieces ?? Object.fromEntries([...new Set((level as Level).pieces.map((p) => p.piece))].map((n) => [n, field.payloads[n]]))
  for (const [n, pl] of Object.entries(names)) files[`${prefix}payloads/${n}.json`] = strToU8(typeof pl === 'string' ? pl : JSON.stringify(pl))
  return zipSync(files)
}

async function clearDb(): Promise<void> {
  const db = await openLevelsDb()
  for (const l of await listLevels(db)) await deleteLevel(db, l.id)
  db.close()
}

beforeEach(async () => {
  await clearDb()
  localStorage.removeItem(LEVEL_CHOICE_KEY)
  useDroneRunLevels.setState({ levels: [], chosen: null, loaded: false, busy: null })
})

describe('reading a level package', () => {
  it('a good zip: the level, each piece once, the bytes read and the faces drawn', () => {
    const pkg = readLevelPackage(zipOf(testLevel()))
    expect(pkg.level).toEqual(testLevel())
    expect(Object.keys(pkg.payloads).sort()).toEqual(['field-crate', 'field-ground-flat'])
    expect(pkg.faces).toBe(field.payloads['field-ground-flat'].faces.length + 2 * field.payloads['field-crate'].faces.length)
    expect(pkg.bytes).toBeGreaterThan(0)
  })

  it('reads the files inside one top folder too, and ignores what it does not need', () => {
    const files: Zippable = {
      'my-level/level.json': strToU8(JSON.stringify(testLevel())),
      'my-level/payloads/field-ground-flat.json': strToU8(JSON.stringify(field.payloads['field-ground-flat'])),
      'my-level/payloads/field-crate.json': strToU8(JSON.stringify(field.payloads['field-crate'])),
      'my-level/notes.txt': strToU8('hello'),
    }
    expect(readLevelPackage(zipSync(files)).level.id).toBe('test-field-1')
  })

  it('the built-in field itself reads as a package', () => {
    const pkg = readLevelPackage(zipOf(field.level))
    expect(pkg.level).toEqual(field.level)
  })

  it('refuses what is not a zip, and a zip with no level.json', () => {
    expect(() => readLevelPackage(strToU8('not a zip at all, just words'))).toThrow(/not a zip/)
    expect(() => readLevelPackage(zipSync({ 'readme.txt': strToU8('hi') }))).toThrow(/no level\.json/)
    expect(() => readLevelPackage(zipSync({ 'level.json': strToU8('{oops') }))).toThrow(/level\.json is not JSON/)
  })

  it('refuses a piece with no payload, naming it', () => {
    const zip = zipOf(testLevel(), { 'field-ground-flat': field.payloads['field-ground-flat'] })
    expect(() => readLevelPackage(zip)).toThrow('The level places field-crate, but payloads/field-crate.json is not in the zip.')
  })

  it('refuses a payload that is not an SNO object, or not JSON', () => {
    expect(() => readLevelPackage(zipOf(testLevel(), { 'field-ground-flat': field.payloads['field-ground-flat'], 'field-crate': { v: 2, name: 'x' } }))).toThrow(/payloads\/field-crate\.json is not an SNO object/)
    expect(() => readLevelPackage(zipOf(testLevel(), { 'field-ground-flat': field.payloads['field-ground-flat'], 'field-crate': 'nope{' }))).toThrow(/payloads\/field-crate\.json is not JSON/)
  })

  it('refuses a bad zone, an entry outside the start zone, and a piece outside the region', () => {
    const zones = field.level.zones
    expect(() => readLevelPackage(zipOf(testLevel({ zones: { start: zones.start, finish: { lo: [114, 66, 66], hi: [142, 78, 300] } } })))).toThrow(/zones\.finish\.hi is not a region-local point/)
    expect(() => readLevelPackage(zipOf(testLevel({ zones: { start: zones.start, finish: zones.start } })))).toThrow(/overlap/)
    expect(() => readLevelPackage(zipOf(testLevel({ entry: [128, 65, 100] })))).toThrow(/entry point is not inside the start zone/)
    expect(() => readLevelPackage(zipOf(testLevel({ pieces: [{ piece: 'field-crate', at: [128, 64, 256] }] })))).toThrow(/region-local/)
  })

  it('refuses a level missing a spawn point the waves use, and an over-long name', () => {
    const spawns = field.level.spawns.filter((sp) => sp.id !== 's3')
    expect(() => readLevelPackage(zipOf(testLevel({ spawns })))).toThrow(/no spawn point s3, which the waves use/)
    expect(() => readLevelPackage(zipOf(testLevel({ name: 'x'.repeat(65) })))).toThrow(/longer than 64 characters/)
  })

  it('refuses a payload over the size limit', () => {
    const big = { ...field.payloads['field-crate'], name: 'x'.repeat(PIECE_MAX_BYTES) }
    expect(() => readLevelPackage(zipOf(testLevel(), { 'field-ground-flat': field.payloads['field-ground-flat'], 'field-crate': big }))).toThrow(`payloads/field-crate.json is over ${PIECE_MAX_BYTES / 1024} KB.`)
  })

  it('refuses a level with more faces than a phone can draw', () => {
    const many = Math.ceil(LEVEL_MAX_FACES / field.payloads['field-ground-flat'].faces.length) + 1
    const pieces = Array.from({ length: many }, () => ({ piece: 'field-ground-flat', at: [128, 64, 192] as [number, number, number] }))
    expect(() => readLevelPackage(zipOf(testLevel({ pieces })))).toThrow(/faces/)
  })
})

describe('an imported level as a world', () => {
  it('the entry marker at its entry, then every placement where it stands, inside the region', () => {
    const level = testLevel({ entry: [120, 65, 194] })
    const world = worldFromLevel(DRONE_RUN_GAME, 'k', level, readLevelPackage(zipOf(level)).payloads)
    const b = DRONE_RUN_GAME.region.base
    const local = (p: { x: bigint; y: bigint; z: bigint }) => [Number(p.x - b.x), Number(p.y - b.y), Number(p.z - b.z)]
    expect(world.door).toBeNull()
    expect(local(world.entry)).toEqual([120, 65, 194])
    expect(insideBox(level.zones.start, level.entry)).toBe(true)
    expect(world.shards.map((s) => local(s.at))).toEqual([level.entry, ...level.pieces.map((p) => p.at)])
    expect(world.shards.every((s) => s.height === 8)).toBe(true)
    expect(() => worldFromLevel(DRONE_RUN_GAME, 'k', level, {})).toThrow(/no payload/)
  })
})

describe('kept on this device (IndexedDB)', () => {
  const row = (id: string, importedAt: number): StoredLevel => ({ id, name: `Level ${id}`, importedAt, bytes: 10, faces: 20, level: testLevel({ id }), payloads: { 'field-crate': field.payloads['field-crate'] } })

  it('keeps, lists (oldest first, no payloads), reads back, replaces by id, and removes', async () => {
    const db = await openLevelsDb()
    await putLevel(db, row('b', 2))
    await putLevel(db, row('a', 1))
    expect((await listLevels(db)).map((l) => l.id)).toEqual(['a', 'b'])
    expect(Object.keys((await listLevels(db))[0]).sort()).toEqual(['bytes', 'faces', 'id', 'importedAt', 'name'])
    expect((await getLevel(db, 'a'))?.level.id).toBe('a')
    await putLevel(db, { ...row('a', 3), name: 'Again' })
    expect((await listLevels(db)).map((l) => [l.id, l.name])).toEqual([['b', 'Level b'], ['a', 'Again']])
    await deleteLevel(db, 'a')
    expect(await getLevel(db, 'a')).toBeNull()
    expect((await listLevels(db)).map((l) => l.id)).toEqual(['b'])
    db.close()
  })
})

describe('the field choice', () => {
  it('remembers an imported level by id on this device; null is the built-in field', () => {
    expect(chosenLevel()).toBeNull()
    chooseLevel('test-field-1')
    expect(localStorage.getItem(LEVEL_CHOICE_KEY)).toBe('test-field-1')
    expect(chosenLevel()).toBe('test-field-1')
    chooseLevel(null)
    expect(chosenLevel()).toBeNull()
  })

  it('IMPORT LEVEL keeps the level and chooses it; a refusal keeps nothing and changes nothing', async () => {
    const L = () => useDroneRunLevels.getState()
    expect(await L().importZip(strToU8('nope'))).toEqual({ refused: expect.stringMatching(/not a zip/) })
    expect(L().levels).toEqual([])
    expect(L().chosen).toBeNull()
    expect(await L().importZip(zipOf(testLevel()))).toEqual({ name: 'Test field' })
    expect(L().levels.map((l) => l.id)).toEqual(['test-field-1'])
    expect(L().chosen).toBe('test-field-1')
    expect(chosenLevel()).toBe('test-field-1')
    // The built-in field again, then back.
    L().choose(null)
    expect(chosenLevel()).toBeNull()
    L().choose('test-field-1')
    expect(chosenLevel()).toBe('test-field-1')
    // A level not kept here cannot be chosen.
    L().choose('nothing-here')
    expect(L().chosen).toBeNull()
  })

  it('REMOVE takes it off this device and the built-in field is chosen again; it can be imported again', async () => {
    const L = () => useDroneRunLevels.getState()
    await L().importZip(zipOf(testLevel()))
    expect(await L().remove('test-field-1')).toBe(true)
    expect(L().levels).toEqual([])
    expect(L().chosen).toBeNull()
    expect(chosenLevel()).toBeNull()
    await L().importZip(zipOf(testLevel()))
    expect(L().chosen).toBe('test-field-1')
  })

  it('a reload: the list is read again, and a chosen level that is gone falls back to the built-in field', async () => {
    const L = () => useDroneRunLevels.getState()
    await L().importZip(zipOf(testLevel()))
    useDroneRunLevels.setState({ levels: [], loaded: false })
    await L().load()
    expect(L().levels.map((l) => l.id)).toEqual(['test-field-1'])
    expect(L().chosen).toBe('test-field-1')
    await clearDb()
    await L().load(true)
    expect(L().chosen).toBeNull()
    expect(chosenLevel()).toBeNull()
  })

  it('no storage: the import is refused in words', async () => {
    const open = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('blocked') })
    try {
      expect(await useDroneRunLevels.getState().importZip(zipOf(testLevel()))).toEqual({ refused: NO_STORAGE_MESSAGE })
    } finally { open.mockRestore() }
  })
})
