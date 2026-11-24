/**
 * blockImport.test.ts - IMPORT A BUILD from file to workshop
 * (store/useBlockImport.ts), on the fixture files scripts/block-fixtures.mjs
 * writes: PUBLISH starts off, a small build is one shard, a castle is pieces
 * and a parent in IMPORTS, and PLACE opens BUILD on what was saved. The
 * session runs inline here (no Worker in the tests), through the same steps
 * the worker runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true, accepted: ['wss://relay.test'] })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  queryEach: vi.fn(async () => [{ url: 'wss://relay.test', outcome: 'answered', events: [] }]),
  relaySet: () => ['wss://relay.test'],
  connectRelay: vi.fn(async () => true),
  authForRead: vi.fn(async () => {}),
  subscribeOne: vi.fn(() => ({ close: () => {} })),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { setLocalAuthor } from '../../lib/carried'
import { folders, useBlockImport, IMPORTS_FOLDER } from '../useBlockImport'
import { usePublished } from '../usePublished'
import { useShards } from '../useShards'
import { useWorkshop } from '../useWorkshop'
import type { FolderApi } from '../../lib/importFolders'
import { write, Int32 } from 'nbtify'

const ME = 'b'.repeat(64)
const fixture = (name: string): File => new File([readFileSync(join(__dirname, '..', '..', 'lib', 'blocks', '__tests__', 'fixtures', name))], name)
const s = () => useBlockImport.getState()

/** Waits until the store has a build plan in hand. */
async function built(): Promise<void> {
  for (let i = 0; i < 400 && (!s().plan || s().building); i++) await new Promise((r) => setTimeout(r, 10))
  if (!s().plan) throw new Error(s().error ?? 'no plan')
}

let filed: Array<{ id: string; folder: string }>
beforeEach(() => {
  filed = []
  const made = new Map<string, string>()
  const api: FolderApi = {
    createFolderPath: (path) => { const key = path.join('/'); if (!made.has(key)) made.set(key, `f${made.size}`); return made.get(key)! },
    assignToFolder: (id, folder) => { filed.push({ id, folder: [...made.entries()].find(([, v]) => v === folder)![0] }) },
  }
  folders.api = () => api
  setLocalAuthor(() => ME)
  useWorkshop.setState({ shards: [], currentId: null, notice: null, open: true })
  s().close()
})
afterEach(() => { setLocalAuthor(null); s().close() })

describe('IMPORT A BUILD', () => {
  it('starts at DROP with PUBLISH off, and keeps it off for every file', async () => {
    s().show()
    expect(s().open).toBe(true)
    expect(s().step).toBe('drop')
    expect(s().publish).toBe(false)
    await s().pick(fixture('house.schem'))
    expect(s().publish).toBe(false)
    s().setPublish(true)
    s().show()
    expect(s().publish).toBe(false)
  })

  it('reads a file, lists what is in it, and builds a plan', async () => {
    s().show()
    await s().pick(fixture('house.litematic'))
    expect(s().step).toBe('ready')
    expect(s().summary?.name).toBe('Cottage')
    expect(s().summary?.states.some((f) => f.state === 'minecraft:oak_planks')).toBe(true)
    await built()
    // The house has glass, which is a piece of its own: a solid piece and a glass piece.
    expect(s().plan!.single).toBe(false)
    expect(s().plan!.objects.map((o) => o.layer).sort()).toEqual(['glass', 'solid'])
  })

  it('refuses a file that is not a block build, in words, and stays at DROP', async () => {
    s().show()
    await s().pick(new File([new Uint8Array([1, 2, 3])], 'thing.schem'))
    expect(s().step).toBe('drop')
    expect(s().error).toMatch(/not a block build/)
    await s().pick(new File(['x'], 'old.schematic'))
    expect(s().error).toMatch(/old .schematic/)
  })

  it('saves the castle as pieces and a parent in IMPORTS, unpublished, and PLACE opens BUILD on the parent', async () => {
    const start = vi.fn()
    useShards.setState({ startDeployShard: start })
    const send = vi.spyOn(usePublished.getState(), 'send')
    s().show()
    await s().pick(fixture('castle.schem'))
    await built()
    const pieces = s().plan!.objects.length
    expect(pieces).toBeGreaterThan(2)
    await s().save()
    expect(s().step).toBe('saved')
    expect(send).not.toHaveBeenCalled()
    const saved = s().saved!
    const shards = useWorkshop.getState().shards
    expect(shards).toHaveLength(pieces + 1)
    const parent = shards.find((m) => m.id === saved.placeId)!
    expect(parent.name).toBe('Castle')
    expect(parent.refs).toHaveLength(pieces)
    // Every piece the parent names is a shard in the workshop, under this key.
    for (const ref of parent.refs!) {
      expect(ref[1].startsWith(`33331:${ME}:`)).toBe(true)
      expect(shards.some((m) => m.id === ref[1].slice(`33331:${ME}:`.length))).toBe(true)
    }
    expect(filed.find((f) => f.id === parent.id)?.folder).toBe(IMPORTS_FOLDER)
    expect(filed.filter((f) => f.folder === `${IMPORTS_FOLDER}/Castle pieces`)).toHaveLength(pieces)
    s().place()
    expect(start).toHaveBeenCalledWith(saved.placeId, 'workshop')
    expect(useWorkshop.getState().open).toBe(false)
    expect(s().open).toBe(false)
    send.mockRestore()
  })

  it('saves a build of one solid object as one shard, in IMPORTS', async () => {
    // A stone plinth, written here as a structure file.
    const blocks = []
    for (let x = 0; x < 4; x++) for (let z = 0; z < 4; z++) blocks.push({ state: new Int32(0), pos: [new Int32(x), new Int32(0), new Int32(z)] })
    const raw = await write({ DataVersion: new Int32(3465), size: [new Int32(4), new Int32(1), new Int32(4)], palette: [{ Name: 'minecraft:stone' }], blocks, entities: [] }, { rootName: '', endian: 'big', compression: null, bedrockLevel: false })
    s().show()
    await s().pick(new File([raw as BlobPart], 'plinth.nbt'))
    await built()
    expect(s().plan!.single).toBe(true)
    await s().save()
    const shards = useWorkshop.getState().shards
    expect(shards).toHaveLength(1)
    expect(shards[0].id).toBe(s().saved!.placeId)
    expect(shards[0].name).toBe('plinth')
    expect(shards[0].refs).toBeUndefined()
    expect(filed).toEqual([{ id: shards[0].id, folder: IMPORTS_FOLDER }])
  })

  it('never saves the build from before a change: SAVE waits while one is due', async () => {
    s().show()
    await s().pick(fixture('house.schem'))
    await built()
    s().setMerge(true)
    expect(s().building).toBe(true)
    await s().save()
    expect(s().step).toBe('ready')
    expect(useWorkshop.getState().shards).toHaveLength(0)
    await built()
    await s().save()
    expect(s().step).toBe('saved')
  })

  it('changes a colour by block name, and puts ours back', async () => {
    s().show()
    await s().pick(fixture('house.schem'))
    await built()
    s().setColour('minecraft:oak_planks', 77)
    expect(s().choices.overrides['minecraft:oak_planks']).toBe(77)
    s().setColour('minecraft:oak_planks', null)
    expect(s().choices.overrides['minecraft:oak_planks']).toBeUndefined()
  })
})
