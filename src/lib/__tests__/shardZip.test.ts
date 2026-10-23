/**
 * shardZip.test.ts - what bulk import makes of a zip's directory.
 *
 * What these prove: a path becomes folders and a name with `..`, roots and
 * drive letters refused, dotfiles and __MACOSX skipped as hidden, control
 * and direction-override characters gone and segments cut to a shard name's
 * length; only .json SNO objects and the 3D files IMPORT reads become rows,
 * everything else is listed as skipped with its reason; an OBJ's MTL and a
 * glTF's .bin travel with the models in their folder; the size, count and
 * depth limits mark rows before a byte is read; and duplicate matching finds
 * your namesakes (in a folder when folders exist), an earlier row of the
 * zip before them, and turns SKIP, COPY and UPDATE into one action per row.
 */
import { describe, expect, it } from 'vitest'
import type { ZipEntry } from '../zipRead'
import {
  NAME_MAX, ZIP_MAX_DEPTH, ZIP_MAX_ENTRY_BYTES, ZIP_MAX_SHARDS, ZIP_MAX_TOTAL_BYTES,
  cleanSegment, copyName, dupAction, dupKey, findDups, nameOf, planZip, splitPath,
} from '../shardZip'

const entry = (name: string, size = 100, extra: Partial<ZipEntry> = {}): ZipEntry =>
  ({ name, dir: name.endsWith('/'), method: 8, encrypted: false, compressedSize: size, size, offset: 0, ...extra })

describe('splitPath', () => {
  it('splits folders from the file, dropping empty and dot segments and reading backslashes', () => {
    expect(splitPath('maze-kit/forest/hall-straight.json')).toEqual({ ok: true, folder: ['maze-kit', 'forest'], file: 'hall-straight.json' })
    expect(splitPath('maze-kit//./forest\\tee.ply')).toEqual({ ok: true, folder: ['maze-kit', 'forest'], file: 'tee.ply' })
    expect(splitPath('cube.ply')).toEqual({ ok: true, folder: [], file: 'cube.ply' })
  })

  it('refuses paths that climb out or start at a root or a drive', () => {
    for (const p of ['../evil.json', 'kit/../../evil.json', '/etc/evil.json', '\\evil.json', 'C:\\evil.json', 'c:evil.json']) {
      expect(splitPath(p)).toEqual({ ok: false, reason: 'unsafe' })
    }
  })

  it('skips dotfiles, dot-folders and the __MACOSX tree as hidden', () => {
    for (const p of ['.DS_Store', 'kit/.hidden.json', '.git/config.json', '__MACOSX/kit/._a.json', 'kit/__MACOSX/a.json']) {
      expect(splitPath(p)).toEqual({ ok: false, reason: 'hidden' })
    }
  })

  it('removes control and direction-override characters, and refuses a segment that is nothing after', () => {
    expect(splitPath('kit/ha\u0000ll\u202e.json')).toEqual({ ok: true, folder: ['kit'], file: 'hall.json' })
    expect(splitPath('kit/\u0007/a.json')).toEqual({ ok: false, reason: 'unsafe' })
    expect(splitPath('kit/.\u200e./a.json')).toEqual({ ok: false, reason: 'hidden' })
    expect(splitPath('kit/\u200e..\u200f/a.json')).toEqual({ ok: false, reason: 'unsafe' })
  })

  it('refuses a path more folders deep than the limit', () => {
    const deep = `${Array.from({ length: ZIP_MAX_DEPTH + 1 }, (_, i) => `f${i}`).join('/')}/a.json`
    expect(splitPath(deep)).toEqual({ ok: false, reason: 'deep' })
    const ok = `${Array.from({ length: ZIP_MAX_DEPTH }, (_, i) => `f${i}`).join('/')}/a.json`
    expect(splitPath(ok).ok).toBe(true)
  })
})

describe('names', () => {
  it('names a shard after its file, without the extension, cut to the name limit', () => {
    expect(nameOf('hall-straight.json')).toBe('hall-straight')
    expect(nameOf('plug.wall.arch.ply')).toBe('plug.wall.arch')
    expect(nameOf('  spaced  .ply')).toBe('spaced')
    expect(nameOf(`${'x'.repeat(100)}.ply`)).toHaveLength(NAME_MAX)
    expect(cleanSegment(` a\u0001b `)).toBe('ab')
  })

  it('names a copy as the workshop does, within the limit', () => {
    expect(copyName('hall')).toBe('hall copy')
    expect(copyName('x'.repeat(64))).toHaveLength(NAME_MAX)
  })
})

describe('planZip', () => {
  it('makes rows of SNO objects and 3D files, skips the rest with reasons, and ignores folders', () => {
    const plan = planZip([
      entry('maze-kit/'),
      entry('maze-kit/forest/'),
      entry('maze-kit/forest/hall-straight.json'),
      entry('maze-kit/forest/rotunda.PLY'),
      entry('maze-kit/shared/plug.stl'),
      entry('maze-kit/README.txt'),
      entry('maze-kit/renders/hall.png'),
      entry('maze-kit/.DS_Store'),
      entry('__MACOSX/maze-kit/._hall-straight.json'),
      entry('../escape.json'),
    ])
    expect(plan.rows.map((r) => [r.path, r.name, r.folder, r.kind])).toEqual([
      ['maze-kit/forest/hall-straight.json', 'hall-straight', ['maze-kit', 'forest'], 'sno'],
      ['maze-kit/forest/rotunda.PLY', 'rotunda', ['maze-kit', 'forest'], 'mesh'],
      ['maze-kit/shared/plug.stl', 'plug', ['maze-kit', 'shared'], 'mesh'],
    ])
    expect(plan.skipped).toEqual([
      { path: 'maze-kit/README.txt', reason: 'Not a shard file' },
      { path: 'maze-kit/renders/hall.png', reason: 'Not a shard file' },
      { path: 'maze-kit/.DS_Store', reason: 'Hidden file' },
      { path: '__MACOSX/maze-kit/._hall-straight.json', reason: 'Hidden file' },
      { path: '../escape.json', reason: 'Unsafe path' },
    ])
  })

  it('attaches an MTL or .bin to the OBJ and glTF models in its own folder, and skips one nothing uses', () => {
    const plan = planZip([entry('a/chair.obj'), entry('a/chair.mtl'), entry('b/lamp.gltf'), entry('b/lamp.bin'), entry('c/orphan.mtl'), entry('a/box.ply')])
    expect(plan.rows.find((r) => r.name === 'chair')!.companions).toEqual(['a/chair.mtl'])
    expect(plan.rows.find((r) => r.name === 'lamp')!.companions).toEqual(['b/lamp.bin'])
    expect(plan.rows.find((r) => r.name === 'box')!.companions).toEqual([])
    expect(plan.skipped).toEqual([{ path: 'c/orphan.mtl', reason: 'Not a shard file' }])
  })

  it('marks rows over the per-file and per-zip size limits, encrypted ones and unknown compression, before reading', () => {
    const half = Math.floor(ZIP_MAX_TOTAL_BYTES / 2) - 10
    const plan = planZip([
      entry('big.ply', ZIP_MAX_ENTRY_BYTES + 1),
      entry('lock.json', 10, { encrypted: true }),
      entry('odd.json', 10, { method: 14 }),
      ...Array.from({ length: 6 }, (_, i) => entry(`part${i}.ply`, Math.min(half, ZIP_MAX_ENTRY_BYTES))),
    ])
    expect(plan.rows[0].error).toMatch(/Over 50 MB/)
    expect(plan.rows[1].error).toBe('Encrypted')
    expect(plan.rows[2].error).toMatch(/Compressed/)
    const parts = plan.rows.slice(3)
    const fit = Math.floor(ZIP_MAX_TOTAL_BYTES / Math.min(half, ZIP_MAX_ENTRY_BYTES))
    expect(parts.filter((r) => !r.error)).toHaveLength(fit)
    expect(parts.slice(fit).every((r) => /for the zip/.test(r.error ?? ''))).toBe(true)
  })

  it('takes at most the shard limit and lists the rest as skipped', () => {
    const plan = planZip(Array.from({ length: ZIP_MAX_SHARDS + 3 }, (_, i) => entry(`s${i}.json`)))
    expect(plan.rows).toHaveLength(ZIP_MAX_SHARDS)
    expect(plan.skipped).toHaveLength(3)
    expect(plan.skipped[0].reason).toMatch(/Past 500/)
  })
})

describe('duplicates', () => {
  const rows = [
    { key: 'kit/forest/hall.json', name: 'hall', folder: ['kit', 'forest'], error: null },
    { key: 'kit/cistern/hall.json', name: 'Hall', folder: ['kit', 'cistern'], error: null },
    { key: 'kit/forest/tee.json', name: 'tee', folder: ['kit', 'forest'], error: null },
    { key: 'kit/forest/bad.json', name: 'bad', folder: ['kit', 'forest'], error: 'Not an SNO object.' },
  ]

  it('without folders: a name taken anywhere in yours, or earlier in the zip, case and space aside', () => {
    const d = findDups(rows, [{ id: 'm1', name: 'tee ', folder: null }, { id: 'm2', name: 'bad', folder: null }], false)
    expect(d.get('kit/forest/hall.json')).toBeNull()
    expect(d.get('kit/cistern/hall.json')).toEqual({ in: 'zip', first: 'kit/forest/hall.json' })
    expect(d.get('kit/forest/tee.json')).toEqual({ in: 'mine', ids: ['m1'] })
    expect(d.get('kit/forest/bad.json')).toBeNull()
  })

  it('with folders: a name is taken only in its own folder', () => {
    const mine = [{ id: 'm1', name: 'hall', folder: ['kit', 'forest'] }, { id: 'm2', name: 'tee', folder: ['elsewhere'] }]
    const d = findDups(rows, mine, true)
    expect(d.get('kit/forest/hall.json')).toEqual({ in: 'mine', ids: ['m1'] })
    expect(d.get('kit/cistern/hall.json')).toBeNull()
    expect(d.get('kit/forest/tee.json')).toBeNull()
    expect(dupKey('A', ['K'], true)).toBe(dupKey('a', ['k'], true))
  })

  it('a repeat inside the zip is a zip duplicate even when yours has the name, so UPDATE never hits one shard twice', () => {
    const d = findDups(rows.slice(0, 2), [{ id: 'm1', name: 'hall', folder: null }], false)
    expect(d.get('kit/forest/hall.json')).toEqual({ in: 'mine', ids: ['m1'] })
    expect(d.get('kit/cistern/hall.json')).toEqual({ in: 'zip', first: 'kit/forest/hall.json' })
    expect(dupAction(d.get('kit/cistern/hall.json')!, 'update')).toEqual({ act: 'copy' })
  })

  it('turns each mode into one action', () => {
    const one = { in: 'mine' as const, ids: ['m1'] }
    const two = { in: 'mine' as const, ids: ['m1', 'm2'] }
    const zip = { in: 'zip' as const, first: 'x' }
    expect(dupAction(null, 'skip')).toEqual({ act: 'new' })
    expect(dupAction(one, 'skip')).toEqual({ act: 'skip' })
    expect(dupAction(zip, 'skip')).toEqual({ act: 'skip' })
    expect(dupAction(one, 'copy')).toEqual({ act: 'copy' })
    expect(dupAction(one, 'update')).toEqual({ act: 'update', id: 'm1' })
    // Two of yours with the name: replacing one would be a guess.
    expect(dupAction(two, 'update')).toEqual({ act: 'copy' })
    expect(dupAction(zip, 'update')).toEqual({ act: 'copy' })
  })
})
