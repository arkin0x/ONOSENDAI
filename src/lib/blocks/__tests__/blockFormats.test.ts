/**
 * blockFormats.test.ts: each block format the importer reads, from files
 * written by scripts/block-fixtures.mjs (our own house and castle, built
 * block by block there), into the same build.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gridBounds, normalizeState, stateCounts, type BlockGrid } from '../blockGrid'
import { fieldOf } from '../blockMesh'
import { decodeGrid, unpackSpanning } from '../formats'
import { checkNbt, gunzipCapped } from '../nbtRead'
import { isBlockFile, readBlockFile } from '../readBlockFile'

const dir = join(__dirname, 'fixtures')
const bytes = (name: string): Uint8Array => new Uint8Array(readFileSync(join(dir, name)))
const census = JSON.parse(readFileSync(join(dir, 'census.json'), 'utf8')) as Record<'house' | 'castle', { size: number[]; blocks: number; states: Record<string, number> }>

/** The build's blocks by normalized state, as census.json counts them (air left out). */
function counts(grid: BlockGrid): Record<string, number> {
  const c = stateCounts(grid)
  const out: Record<string, number> = {}
  grid.palette.forEach((s, i) => { if (c[i]) out[s] = (out[s] ?? 0) + c[i] })
  return out
}
const expected = (which: 'house' | 'castle'): Record<string, number> =>
  Object.fromEntries(Object.entries(census[which].states).map(([s, n]) => [normalizeState(s), n]))

describe('reading block files', () => {
  it.each([
    ['house.schem', 'schem'], ['house-v3.schem', 'schem'], ['house.litematic', 'litematic'], ['house.nbt', 'structure'],
  ])('reads %s as the house', async (file, format) => {
    const grid = await readBlockFile(file, bytes(file))
    expect(grid.format).toBe(format)
    expect(gridBounds(grid).size).toEqual(census.house.size)
    expect(counts(grid)).toEqual(expected('house'))
    expect(grid.palette[0]).toBe('minecraft:air')
  })

  it.each(['castle.schem', 'castle.litematic', 'castle.nbt'])('reads %s as the castle', async (file) => {
    const grid = await readBlockFile(file, bytes(file))
    expect(gridBounds(grid).size).toEqual(census.castle.size)
    expect(counts(grid)).toEqual(expected('castle'))
  })

  it('takes the name a file carries, else the file name', async () => {
    expect((await readBlockFile('house.schem', bytes('house.schem'))).name).toBe('Cottage')
    expect((await readBlockFile('house.litematic', bytes('house.litematic'))).name).toBe('Cottage')
    expect((await readBlockFile('my-house.nbt', bytes('house.nbt'))).name).toBe('my-house')
  })

  it('reads every cell of a Sponge file to the same place as the structure file', async () => {
    const a = fieldOf(await readBlockFile('castle.schem', bytes('castle.schem')))
    const ga = await readBlockFile('castle.schem', bytes('castle.schem'))
    const gb = await readBlockFile('castle.nbt', bytes('castle.nbt'))
    const b = fieldOf(gb)
    expect(a.size).toEqual(b.size)
    for (let i = 0; i < a.cells.length; i++) if (ga.palette[a.cells[i]] !== gb.palette[b.cells[i]]) throw new Error(`cell ${i} differs`)
  })

  it('places two Litematica regions, one with a negative size, where they belong', async () => {
    const grid = await readBlockFile('castle.litematic', bytes('castle.litematic'))
    expect(grid.regions.map((r) => r.name)).toEqual(['North half', 'South half'])
    // The north half was written from its far corner with a negative size: it still starts at 0.
    expect(grid.regions[0].origin).toEqual([0, 0, 0])
    expect(grid.regions[0].size).toEqual([48, 20, 24])
    expect(grid.regions[1].origin).toEqual([0, 0, 24])
    const lit = fieldOf(grid)
    const ref = await readBlockFile('castle.nbt', bytes('castle.nbt'))
    const nbt = fieldOf(ref)
    for (let i = 0; i < lit.cells.length; i++) if (grid.palette[lit.cells[i]] !== ref.palette[nbt.cells[i]]) throw new Error(`cell ${i} differs`)
  })

  it('unpacks Litematica indices that span two longs', () => {
    // 3 bits an entry: entry 21 takes bits 63 of the first long and 0 and 1 of the second.
    const values = Array.from({ length: 50 }, (_, i) => (i * 5 + 3) % 8)
    const longs = new BigInt64Array(Math.ceil((values.length * 3) / 64))
    const u = new BigUint64Array(longs.buffer)
    values.forEach((v, i) => {
      const start = i * 3, li = Math.floor(start / 64), off = start % 64
      u[li] |= (BigInt(v) << BigInt(off)) & 0xffffffffffffffffn
      if (off + 3 > 64) u[li + 1] |= BigInt(v) >> BigInt(64 - off)
    })
    expect(Array.from(unpackSpanning(longs, 3, values.length))).toEqual(values)
    expect(Math.floor((21 * 3) / 64)).not.toBe(Math.floor((21 * 3 + 2) / 64))
  })

  it('refuses a file that is not a build, and one cut short, in a sentence', async () => {
    await expect(readBlockFile('x.schem', new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a block build/)
    const whole = bytes('house.nbt')
    await expect(readBlockFile('x.nbt', whole.slice(0, whole.length - 40))).rejects.toThrow(/./)
    await expect(readBlockFile('x.nbt', new Uint8Array())).rejects.toThrow('That file is empty.')
  })

  it('refuses a declared length the bytes cannot hold, before anything is allocated', () => {
    // A compound holding a long array that says it has a billion entries.
    const evil = new Uint8Array([10, 0, 0, 12, 0, 1, 0x61, 0x3b, 0x9a, 0xca, 0x00, 0])
    expect(() => checkNbt(evil)).toThrow(/not a block build/)
  })

  it('refuses a file of millions of tiny tags, which would take gigabytes to read, before reading it', () => {
    // A compound holding a list of 3,000,001 empty compounds: 3 MB, a few kilobytes gzipped.
    const n = 3_000_001
    const evil = new Uint8Array(3 + 3 + 1 + 4 + n + 1)
    evil.set([10, 0, 0, 9, 0, 1, 0x6c, 10, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
    expect(() => checkNbt(evil)).toThrow(/more pieces of data/)
  })

  it('reads a Litematica region of one kind of block with no block data as that block throughout', () => {
    const grid = decodeGrid({ Version: 6, Metadata: { Name: 'Slab' }, Regions: { R: { Position: { x: 0, y: 0, z: 0 }, Size: { x: 2, y: 1, z: 2 }, BlockStatePalette: [{ Name: 'minecraft:stone' }] } } }, 'x.litematic')
    expect(Array.from(grid.regions[0].cells).map((c) => grid.palette[c])).toEqual(Array(4).fill('minecraft:stone'))
  })

  it('stops unpacking a file that unpacks past the cap', async () => {
    const { gzipSync } = await import('node:zlib')
    const bomb = new Uint8Array(gzipSync(new Uint8Array(1024 * 1024)))
    await expect(gunzipCapped(bomb, 64 * 1024)).rejects.toThrow(/unpacks to more than/)
  })

  it('knows block files by their endings', () => {
    expect(['a.schem', 'B.LITEMATIC', 'c.nbt'].every(isBlockFile)).toBe(true)
    expect(['a.obj', 'b.vox', 'c.schematic'].some(isBlockFile)).toBe(false)
  })

  it('sorts a state\'s properties, so two spellings are one block', () => {
    expect(normalizeState('minecraft:oak_stairs[half=bottom,facing=north]')).toBe(normalizeState('oak_stairs', { facing: 'north', half: 'bottom' }))
  })
})
