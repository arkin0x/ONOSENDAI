/**
 * shardImport.test.ts - bulk import from a zip (store/useShardImport.ts),
 * against a fake relay and the local signer. Nothing reaches a network.
 *
 * What these prove: a zip's .json SNO objects and PLY files are read into
 * shards named after their files, a broken one is an error row and junk is
 * skipped; IMPORT adds each picked one to your shards and publishes it as
 * PUBLISH does (kind 33331, `d` = the shard's id), an unticked one is left
 * out; a taken name is skipped by default, COPY adds "<name> copy", UPDATE
 * replaces yours and publishes to the same address; a retry after a refusal
 * publishes the same shard again (no second shard, the same `d`), and a
 * shard the ledger already shows as sent is not sent twice; a signer that
 * never answers fails the send at the deadline, two in a row pause the run,
 * and STOP ends the wait at once; a rate-limited relay is asked again after
 * a wait; and once the workshop has folders each new shard goes in its zip
 * folder.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true, accepted: ['wss://relay.test'] })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
  connectRelay: vi.fn(async () => true),
  authForRead: vi.fn(async () => {}),
  subscribeOne: vi.fn(() => ({ close: () => {} })),
}))

vi.mock('../../lib/importFolders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/importFolders')>()),
  folderApi: vi.fn(() => null),
}))

import { strToU8, zipSync } from 'fflate'
import { folderApi } from '../../lib/importFolders'
import { publishMany } from '../../lib/relay'
import { useCyberspace } from '../useCyberspace'
import { useWorkshop } from '../useWorkshop'
import { usePublished } from '../usePublished'
import { timing, useShardImport } from '../useShardImport'

const sno = (name: string, x = 1): string => JSON.stringify({
  v: 2, name, unit: 0, mode: 'solid',
  vertices: [[0, 0, 0], [x, 0, 0], [0, x, 0], [0, 0, x]], colors: [0, 0, 0, 0], faces: [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]],
})

const CUBE = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 4
property list uchar int vertex_indices
end_header
0 0 0
1 0 0
0 1 0
0 0 1
3 0 2 1
3 0 3 2
3 0 1 3
3 1 2 3
`

function kitZip(extra: Record<string, string> = {}): File {
  const files: Record<string, Uint8Array> = {
    'maze-kit/forest/hall-straight.json': strToU8(sno('Maze Kit: hall, straight')),
    'maze-kit/forest/rotunda.json': strToU8(sno('Maze Kit: rotunda', 2)),
    'maze-kit/shared/tetra.ply': strToU8(CUBE),
    'maze-kit/extras/broken.json': strToU8('{"v":2,"name":"broken"'),
    'maze-kit/README.txt': strToU8('not a shard'),
    'maze-kit/.DS_Store': new Uint8Array([0, 0, 0, 1]),
    '__MACOSX/maze-kit/._hall-straight.json': new Uint8Array([0, 5, 22, 7]),
  }
  for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v)
  return new File([zipSync(files)], 'maze-kit.zip', { type: 'application/zip' })
}

const imp = () => useShardImport.getState()
const mine = () => useWorkshop.getState().shards
const sent = () => vi.mocked(publishMany).mock.calls.map((c) => c[1] as unknown as { kind: number; tags: string[][]; content: string })
const dOf = (ev: { tags: string[][] }): string | undefined => ev.tags.find((t) => t[0] === 'd')?.[1]
const rowOf = (name: string) => imp().rows.find((r) => r.name === name)!

const realSign = useCyberspace.getState().signEvent

beforeEach(() => {
  timing.gapMs = 0
  timing.rateBackoffMs = 1
  timing.sendDeadlineMs = 90_000
  vi.mocked(publishMany).mockClear()
  vi.mocked(publishMany).mockImplementation(async () => ({ ok: true, accepted: ['wss://relay.test'] }))
  useCyberspace.setState({ signEvent: realSign })
  usePublished.setState({ ledger: {}, publishing: false, retracting: false })
  localStorage.removeItem('onosendai:published')
  useWorkshop.setState({ shards: [], currentId: null, notice: null })
  imp().close()
})

afterEach(() => {
  useCyberspace.setState({ signEvent: realSign })
  vi.mocked(folderApi).mockReturnValue(null)
})

describe('reading a zip', () => {
  it('lists the shard files, named after their files, with errors and skips', async () => {
    await imp().openZip(kitZip())
    const s = imp()
    expect(s.phase).toBe('review')
    expect(s.error).toBeNull()
    expect(s.rows.map((r) => [r.name, r.folder.join('/'), r.read])).toEqual([
      ['hall-straight', 'maze-kit/forest', 'ok'],
      ['rotunda', 'maze-kit/forest', 'ok'],
      ['tetra', 'maze-kit/shared', 'ok'],
      ['broken', 'maze-kit/extras', 'error'],
    ])
    expect(rowOf('hall-straight').shard!.name).toBe('hall-straight')
    expect(rowOf('tetra').shard!.faces.length).toBeGreaterThan(0)
    expect(rowOf('tetra').note).toMatch(/Imported/)
    expect(rowOf('broken').error).toBe('Not an SNO object.')
    expect(rowOf('broken').picked).toBe(false)
    expect(s.skipped.map((f) => f.reason).sort()).toEqual(['Hidden file', 'Hidden file', 'Not a shard file'])
    // Nothing is yours until IMPORT.
    expect(mine()).toHaveLength(0)
  })

  it('says why a file that is not a zip cannot be read', async () => {
    await imp().openZip(new File([strToU8('hello')], 'nope.zip'))
    expect(imp().error).toMatch(/not a zip/)
    expect(imp().rows).toHaveLength(0)
  })
})

describe('IMPORT', () => {
  it('adds every picked shard and publishes each as a kind 33331 at its own address', async () => {
    await imp().openZip(kitZip())
    imp().toggle(rowOf('rotunda').key)
    await imp().start()
    expect(imp().phase).toBe('done')
    expect(mine().map((s) => s.name).sort()).toEqual(['hall-straight', 'tetra'])
    expect(rowOf('rotunda').run).toBe('idle')
    const events = sent()
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.kind === 33331)).toBe(true)
    expect(events.map(dOf).sort()).toEqual(mine().map((s) => s.id).sort())
    expect(JSON.parse(events[0].content).name).toBe('hall-straight')
    expect(usePublished.getState().ledger[rowOf('hall-straight').shardId!]).toBeDefined()
  })

  it('with PUBLISH off only adds them', async () => {
    await imp().openZip(kitZip())
    imp().setPublish(false)
    await imp().start()
    expect(mine()).toHaveLength(3)
    expect(sent()).toHaveLength(0)
    imp().setPublish(true)
  })
})

describe('a taken name', () => {
  beforeEach(() => { useWorkshop.getState().importText(sno('hall-straight', 3)) })

  it('is skipped by default', async () => {
    await imp().openZip(kitZip())
    await imp().start()
    expect(rowOf('hall-straight').run).toBe('skipped')
    expect(mine().filter((s) => s.name.startsWith('hall-straight'))).toHaveLength(1)
    expect(sent().map((e) => JSON.parse(e.content).name).sort()).toEqual(['rotunda', 'tetra'])
  })

  it('COPY adds "<name> copy"', async () => {
    await imp().openZip(kitZip())
    imp().setDupMode('copy')
    await imp().start()
    expect(mine().map((s) => s.name).sort()).toEqual(['hall-straight', 'hall-straight copy', 'rotunda', 'tetra'])
    expect(rowOf('hall-straight').outcome).toBe('copy')
  })

  it('UPDATE replaces yours, keeping its id, and publishes it to the same address', async () => {
    const before = mine()[0]
    await imp().openZip(kitZip())
    imp().setDupMode('update')
    await imp().start()
    const after = mine().find((s) => s.id === before.id)!
    expect(mine().filter((s) => s.name === 'hall-straight')).toHaveLength(1)
    expect(after.vertices.map((v) => v.p)).not.toEqual(before.vertices.map((v) => v.p))
    expect(rowOf('hall-straight').outcome).toBe('update')
    expect(sent().some((e) => dOf(e) === before.id)).toBe(true)
  })
})

describe('failure and retry', () => {
  it('a retry publishes the same shard to the same address, never a second shard', async () => {
    vi.mocked(publishMany).mockImplementation(async (_r, ev) => (JSON.parse((ev as unknown as { content: string }).content).name === 'rotunda'
      ? { ok: false, reason: 'blocked: not today' }
      : { ok: true, accepted: ['wss://relay.test'] }))
    await imp().openZip(kitZip())
    await imp().start()
    expect(rowOf('rotunda').run).toBe('failed')
    expect(rowOf('rotunda').failure).toBe('blocked: not today')
    const id = rowOf('rotunda').shardId
    expect(mine()).toHaveLength(3)
    vi.mocked(publishMany).mockClear()
    vi.mocked(publishMany).mockImplementation(async () => ({ ok: true, accepted: ['wss://relay.test'] }))
    await imp().retry()
    expect(rowOf('rotunda').run).toBe('done')
    expect(mine()).toHaveLength(3)
    // Only the failed one went again, under the id it was made with.
    expect(sent().map(dOf)).toEqual([id])
  })

  it('does not send again what the ledger shows was sent (a send that timed out and landed)', async () => {
    let release: (() => void) | null = null
    vi.mocked(publishMany).mockImplementation(async () => {
      await new Promise<void>((r) => { release = r })
      return { ok: true, accepted: ['wss://relay.test'] }
    })
    timing.sendDeadlineMs = 20
    await imp().openZip(kitZip())
    for (const name of ['rotunda', 'tetra']) imp().toggle(rowOf(name).key)
    await imp().start()
    expect(rowOf('hall-straight').run).toBe('failed')
    expect(rowOf('hall-straight').failure).toBe('No answer in time')
    // The relay answers after all, and the ledger writes it down.
    release!()
    await vi.waitFor(() => expect(usePublished.getState().ledger[rowOf('hall-straight').shardId!]).toBeDefined())
    vi.mocked(publishMany).mockClear()
    await imp().retry()
    expect(rowOf('hall-straight').run).toBe('done')
    expect(sent()).toHaveLength(0)
  })

  it('a signer that never answers fails at the deadline, and two in a row pause the run', async () => {
    timing.sendDeadlineMs = 20
    useCyberspace.setState({ signEvent: () => new Promise(() => {}) })
    await imp().openZip(kitZip())
    await imp().start()
    expect(imp().phase).toBe('done')
    expect(imp().stall).toMatch(/signer/)
    expect(imp().rows.filter((r) => r.run === 'failed')).toHaveLength(2)
    expect(rowOf('tetra').run).toBe('idle')
    expect(sent()).toHaveLength(0)
  })

  it('STOP ends the wait on a hung signer at once', async () => {
    useCyberspace.setState({ signEvent: () => new Promise(() => {}) })
    await imp().openZip(kitZip())
    const running = imp().start()
    await vi.waitFor(() => expect(rowOf('hall-straight').run).toBe('working'))
    imp().stop()
    await running
    expect(imp().phase).toBe('done')
    expect(rowOf('hall-straight').failure).toBe('Stopped')
    expect(rowOf('rotunda').run).toBe('idle')
  })

  it('asks a rate-limited relay again after a wait', async () => {
    let calls = 0
    vi.mocked(publishMany).mockImplementation(async () => (++calls === 1 ? { ok: false, reason: 'rate-limited: slow down' } : { ok: true, accepted: ['wss://relay.test'] }))
    await imp().openZip(kitZip())
    await imp().start()
    expect(imp().rows.filter((r) => r.run === 'done')).toHaveLength(3)
    expect(calls).toBe(4)
  })
})

describe('folders', () => {
  it('puts each new shard in its zip folder once the workshop has folders', async () => {
    const createFolderPath = vi.fn((path: readonly string[]) => path.join('/'))
    const assignToFolder = vi.fn()
    vi.mocked(folderApi).mockReturnValue({ createFolderPath, assignToFolder })
    await imp().openZip(kitZip())
    expect(imp().foldersOn).toBe(true)
    await imp().start()
    expect(createFolderPath.mock.calls.map((c) => c[0].join('/')).sort()).toEqual(['maze-kit/forest', 'maze-kit/shared'])
    expect(assignToFolder).toHaveBeenCalledWith(rowOf('tetra').shardId, 'maze-kit/shared')
  })

  it('with folders, a name is taken only in its own folder', async () => {
    useWorkshop.getState().importText(sno('hall-straight', 3))
    const other = useWorkshop.getState().shards[0].id
    vi.mocked(folderApi).mockReturnValue({ createFolderPath: (p) => p.join('/'), assignToFolder: () => {}, folderPathOf: (id) => (id === other ? ['elsewhere'] : []) })
    await imp().openZip(kitZip())
    expect(imp().dups[rowOf('hall-straight').key]).toBeNull()
    await imp().start()
    expect(mine().filter((s) => s.name === 'hall-straight')).toHaveLength(2)
  })
})

describe('review fixes', () => {
  it('reads an OBJ with only the MTL it names, never the other MTLs in its folder', async () => {
    const obj = 'mtllib paint.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nusemtl red\nf 1 2 3\nf 1 3 4\nf 1 4 2\nf 2 4 3\n'
    const files: Record<string, Uint8Array> = {
      'k/chair.obj': strToU8(obj),
      'k/paint.mtl': strToU8('newmtl red\nKd 1 0 0\n'),
    }
    // Large, well compressed MTLs nothing names: reading them all was the bomb.
    for (let i = 0; i < 20; i++) files[`k/alias${i}.mtl`] = new Uint8Array(4 * 1024 * 1024)
    await imp().openZip(new File([zipSync(files)], 'obj.zip'))
    expect(rowOf('chair').read).toBe('ok')
    const colors = new Set(rowOf('chair').shard!.vertices.map((v) => v.c.join(',')))
    expect([...colors].some((c) => c.startsWith('255,') || c.startsWith('1,'))).toBe(true)
  })

  it('imports both of two entries that share one name', async () => {
    const twice = zipSync({ 'k/x.json': strToU8(sno('a')) })
    // fflate keys files by name, so the second entry is spliced in by hand: a second central record for the same data.
    const eocd = twice.length - 22
    const cdOff = twice[eocd + 16] | (twice[eocd + 17] << 8) | (twice[eocd + 18] << 16) | (twice[eocd + 19] << 24)
    const cd = twice.subarray(cdOff, eocd)
    const out = new Uint8Array(twice.length + cd.length)
    out.set(twice.subarray(0, eocd))
    out.set(cd, eocd)
    out.set(twice.subarray(eocd), eocd + cd.length)
    const e = eocd + cd.length
    out[e + 8] = 2; out[e + 10] = 2
    const size = cd.length * 2
    out[e + 12] = size & 255; out[e + 13] = (size >> 8) & 255
    await imp().openZip(new File([out], 'twice.zip'))
    expect(imp().rows).toHaveLength(2)
    expect(imp().rows[0].key).not.toBe(imp().rows[1].key)
    imp().setDupMode('copy')
    await imp().start()
    expect(mine().map((x) => x.name).sort()).toEqual(['x', 'x copy'])
  })

  it('an exception mid-run marks the row failed and leaves the modal closable', async () => {
    vi.mocked(folderApi).mockReturnValue({ createFolderPath: () => { throw new Error('folder store broke') }, assignToFolder: () => {} })
    await imp().openZip(kitZip())
    await imp().start()
    expect(imp().phase).toBe('done')
    expect(rowOf('hall-straight').run).toBe('failed')
    expect(rowOf('hall-straight').failure).toBe('folder store broke')
    imp().close()
    expect(imp().open).toBe(false)
  })

  it('a second zip waits while a run is going, and STOP still ends the wait', async () => {
    useCyberspace.setState({ signEvent: () => new Promise(() => {}) })
    await imp().openZip(kitZip())
    const running = imp().start()
    await vi.waitFor(() => expect(rowOf('hall-straight').run).toBe('working'))
    await imp().openZip(new File([zipSync({ 'other.json': strToU8(sno('other')) })], 'other.zip'))
    expect(imp().fileName).toBe('maze-kit.zip')
    imp().stop()
    await running
    expect(rowOf('hall-straight').failure).toBe('Stopped')
  })

  it('a run that cannot save the workshop stops before publishing', async () => {
    const setItem = localStorage.setItem.bind(localStorage)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === 'onosendai:shards') throw new DOMException('full', 'QuotaExceededError')
      setItem(k, v)
    })
    try {
      await imp().openZip(kitZip())
      await imp().start()
    } finally { spy.mockRestore() }
    expect(rowOf('hall-straight').run).toBe('failed')
    expect(rowOf('hall-straight').failure).toBe('Workshop storage is full')
    expect(imp().stall).toMatch(/storage/)
    expect(rowOf('rotunda').run).toBe('idle')
    expect(sent()).toHaveLength(0)
  })

  it('a row SKIP left out comes back when the answer changes after a run', async () => {
    useWorkshop.getState().importText(sno('hall-straight', 3))
    await imp().openZip(kitZip())
    await imp().start()
    expect(rowOf('hall-straight').run).toBe('skipped')
    imp().setDupMode('copy')
    expect(rowOf('hall-straight').run).toBe('idle')
    await imp().retry()
    expect(rowOf('hall-straight').run).toBe('done')
    expect(mine().map((x) => x.name)).toContain('hall-straight copy')
  })

  it('STOP ends a rate-limit wait at once', async () => {
    timing.rateBackoffMs = 60_000
    vi.mocked(publishMany).mockImplementation(async () => ({ ok: false, reason: 'rate-limited: slow down' }))
    await imp().openZip(kitZip())
    const running = imp().start()
    await vi.waitFor(() => expect(vi.mocked(publishMany)).toHaveBeenCalled())
    const t = Date.now()
    imp().stop()
    await running
    expect(Date.now() - t).toBeLessThan(2000)
    expect(imp().phase).toBe('done')
  })
})
