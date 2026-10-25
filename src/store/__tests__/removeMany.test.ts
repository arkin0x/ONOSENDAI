/**
 * removeMany.test.ts: a folder's DELETE CONTENTS deletes its shards through
 * useWorkshop removeMany (arkinox, 2026-10-25: "i need an option to actually
 * delete a folder and everything in it"). Hundreds of shards are one change
 * to the list and one storage write; the shard on the bench never stays one
 * that is gone; nothing is retracted, and the publish ledger is untouched.
 * It answers whether the write committed, and a folder's DELETE CONTENTS
 * takes the folders only when it did (review of PR 509), so a failed write
 * never brings the shards back loose at the top on a reload.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const persist = vi.fn()
/** The storage's answer to saveNow: whether the write committed. */
const saveNow = vi.fn(async () => true)
vi.mock('../workshopStorage', async (importOriginal) => ({ ...(await importOriginal<typeof import('../workshopStorage')>()), persist: (list: unknown) => persist(list), saveNow: () => saveNow() }))

const { newShard } = await import('sno-core/shards')
const { useWorkshop } = await import('../useWorkshop')
const { usePublished } = await import('../usePublished')
const { useShardFolders } = await import('../useShardFolders')
const { deleteFolderNow } = await import('../../hud/ShardFolders')
const { EMPTY_TREE, applyOps, buildTree } = await import('../../lib/shardFolders')

const w = () => useWorkshop.getState()

/** `n` shards, the last one edited most recently. */
function library(n: number) {
  return Array.from({ length: n }, (_, i) => ({ ...newShard(`s${i}`), id: `s${i}`, updatedAt: 1000 + i }))
}

function start(n: number, current: string | null, open = true): void {
  useWorkshop.setState({ shards: library(n), currentId: current, open, selection: [3], partSel: [], selectedFace: null, facePick: [], past: [library(1)[0]], future: [], notice: null })
  persist.mockClear()
  saveNow.mockClear()
}

describe('removeMany', () => {
  beforeEach(() => { persist.mockClear(); saveNow.mockReset(); saveNow.mockResolvedValue(true); useWorkshop.setState({ stampObject: null }) })

  it('deletes hundreds of shards in one change and one storage write', async () => {
    start(400, 's399')
    const sets = vi.fn()
    const off = useWorkshop.subscribe(sets)
    const gone = Array.from({ length: 300 }, (_, i) => `s${i}`)
    await expect(w().removeMany(gone)).resolves.toBe(true)
    off()
    expect(w().shards.map((s) => s.id)).toEqual(Array.from({ length: 100 }, (_, i) => `s${300 + i}`))
    expect(persist).toHaveBeenCalledTimes(1)
    expect(saveNow).toHaveBeenCalledTimes(1)
    expect(sets).toHaveBeenCalledTimes(1)
  })

  it('answers false when the write failed', async () => {
    start(5, 's4')
    saveNow.mockResolvedValue(false)
    await expect(w().removeMany(['s0', 's4'])).resolves.toBe(false)
  })

  it('lets STAMP\'s chosen object go when it was one of them, and keeps it otherwise', () => {
    start(5, 's4')
    const own = { ref: ['a', `33331:${'ee'.repeat(32)}:s1`] as ['a', string], name: 's1', shard: { ...newShard('s1'), id: 's1' } }
    useWorkshop.setState({ stampObject: own })
    w().removeMany(['s0'])
    expect(w().stampObject).toBe(own)
    w().removeMany(['s1'])
    expect(w().stampObject).toBeNull()
    // By its address alone, as an object read back from the relays may carry another id.
    const byAddress = { ...own, shard: { ...newShard('x'), id: 'other' }, ref: ['a', `33331:${'ee'.repeat(32)}:s2`] as ['a', string] }
    useWorkshop.setState({ stampObject: byAddress })
    w().removeMany(['s2'])
    expect(w().stampObject).toBeNull()
  })

  it('leaves the open shard, its selection and its undo alone when it is not one of them', () => {
    start(10, 's9')
    w().removeMany(['s0', 's1'])
    expect(w().currentId).toBe('s9')
    expect(w().selection).toEqual([3])
    expect(w().past).toHaveLength(1)
  })

  it('moves the bench to the newest shard left when the open one goes, clearing what was on it', () => {
    start(10, 's9')
    w().removeMany(['s9', 's8', 's2'])
    expect(w().currentId).toBe('s7')
    expect(w().current()?.id).toBe('s7')
    expect(w().selection).toEqual([])
    expect(w().past).toEqual([])
  })

  it('puts a new empty shard on the bench when nothing is left and the workshop is open, in the same write', () => {
    start(3, 's1')
    w().removeMany(['s0', 's1', 's2'])
    expect(w().shards).toHaveLength(1)
    expect(w().currentId).toBe(w().shards[0].id)
    expect(w().shards[0].vertices).toEqual([])
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('leaves no current shard when nothing is left and the workshop is closed', () => {
    start(2, 's0', false)
    w().removeMany(['s0', 's1'])
    expect(w().shards).toEqual([])
    expect(w().currentId).toBeNull()
  })

  it('writes nothing when none of them is there', async () => {
    start(3, 's0')
    const before = w().shards
    await expect(w().removeMany(['nope'])).resolves.toBe(true)
    expect(w().shards).toBe(before)
    expect(persist).not.toHaveBeenCalled()
    expect(saveNow).not.toHaveBeenCalled()
  })

  it('retracts nothing and leaves the publish ledger as it was', () => {
    start(5, 's4')
    const retract = vi.fn(async () => undefined)
    const publish = vi.fn(async () => undefined)
    const ledger = { s1: { at: 1, fp: '', pubkey: 'ee'.repeat(32) }, s2: { at: 1, fp: '', pubkey: 'ee'.repeat(32) } }
    usePublished.setState({ ledger, retract, publish } as never)
    w().removeMany(['s1', 's2', 's3'])
    expect(retract).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(usePublished.getState().ledger).toBe(ledger)
  })

  it('through a folder\'s DELETE CONTENTS: a failed write takes no folder, a saved one takes them all', async () => {
    start(6, 's5')
    const tree = applyOps(EMPTY_TREE, [
      { op: 'create', id: 'kit', name: 'maze-kit', parent: null, at: 1 },
      { op: 'create', id: 'cistern', name: 'cistern', parent: 'kit', at: 1 },
      { op: 'assign', refs: ['s0', 's1'], folder: 'kit' },
      { op: 'assign', refs: ['s2', 's3'], folder: 'cistern' },
    ])
    useShardFolders.setState({ tree, storage: 'memory' })
    const kit = buildTree(tree, w().shards, (s) => s.id).folders[0]
    const contents = { remove: (refs: string[]) => w().removeMany(refs), published: () => 0 }
    saveNow.mockResolvedValue(false)
    expect(await deleteFolderNow(kit, true, (s) => s.id, contents)).toBe(false)
    // Gone from this tab, not saved: the folders and filings stay, so a reload puts them back where they were.
    expect(w().shards.map((s) => s.id)).toEqual(['s4', 's5'])
    expect(useShardFolders.getState().tree).toBe(tree)
    saveNow.mockResolvedValue(true)
    useWorkshop.setState({ shards: library(6) })
    expect(await deleteFolderNow(kit, true, (s) => s.id, contents)).toBe(true)
    expect(useShardFolders.getState().tree.folders).toEqual({})
    expect(useShardFolders.getState().tree.assign).toEqual({})
  })
})
