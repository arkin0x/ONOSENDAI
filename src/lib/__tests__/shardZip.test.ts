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
  PLACEHOLDER_PUBKEY, blockedRows, cleanSegment, hasPlaceholders, companionsFor, copyName, dupAction, dupKey, findDups, nameOf, planZip, refTargets, resolveRefs, splitPath, unresolved,
} from '../shardZip'

let nextIndex = 0
const entry = (name: string, size = 100, extra: Partial<ZipEntry> = {}): ZipEntry =>
  ({ index: nextIndex++, name, dir: name.endsWith('/'), method: 8, encrypted: false, compressedSize: size, size, offset: 0, crc: 0, ...extra })

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

  it('judges a dotfile after cleaning too, so a stripped character cannot hide one', () => {
    expect(splitPath(`${String.fromCharCode(0x202e)}.secret/x.json`)).toEqual({ ok: false, reason: 'hidden' })
    expect(splitPath(`kit/${String.fromCharCode(0x061c)}.env.json`)).toEqual({ ok: false, reason: 'hidden' })
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

  it('keeps MTL and .bin files by folder for the OBJ and glTF models there, and skips one with no such model', () => {
    const plan = planZip([entry('a/chair.obj'), entry('a/Chair.MTL'), entry('b/lamp.gltf'), entry('b/lamp.bin'), entry('c/orphan.mtl'), entry('c/box.ply')])
    expect(plan.companions.a.map((c) => [c.file, c.match])).toEqual([['Chair.MTL', 'chair.mtl']])
    expect(plan.companions.b.map((c) => c.file)).toEqual(['lamp.bin'])
    expect(plan.skipped).toEqual([{ path: 'c/orphan.mtl', reason: 'Not a shard file' }])
    // Keys are directory places, unique even for two entries with one name.
    const twice = planZip([entry('k/x.json'), entry('k/x.json')])
    expect(new Set(twice.rows.map((r) => r.key)).size).toBe(2)
  })

  it('reads only the companions a model names, once each, else the one sharing its base name', () => {
    const c = (key: string, file: string, size = 10) => ({ key, file, match: file.toLowerCase(), size })
    const here = [
      c('1', 'materials.mtl'), c('2', 'materials.mtl'), c('3', 'chair.mtl'), c('4', 'Tri.bin'), c('5', 'my tri.bin'),
      ...Array.from({ length: 500 }, (_, i) => c(`x${i}`, `alias${i}.mtl`, 50 * 1024 * 1024)),
    ]
    // A glTF's URIs are matched as its reader decodes them, case aside.
    expect(companionsFor('Tri.gltf', ['Tri.bin'], here).map((x) => x.file)).toEqual(['Tri.bin'])
    expect(companionsFor('a.gltf', ['my%20tri.bin'], here).map((x) => x.file)).toEqual(['my tri.bin'])
    expect(companionsFor('a.gltf', ['%E0%A4%A.bin'], here)).toEqual([])
    expect(companionsFor('chair.obj', ['materials.mtl', 'MATERIALS.mtl', 'sub\\materials.mtl'], here).map((c) => c.key)).toEqual(['1'])
    expect(companionsFor('chair.obj', [], here).map((c) => c.key)).toEqual(['3'])
    expect(companionsFor('stool.obj', [], here)).toEqual([])
    expect(companionsFor('lamp.gltf', ['missing.bin'], here)).toEqual([])
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

describe('ids and references', () => {
  it('ids are paths without the extension under the kit folder, or under the zip name when files sit at the top', () => {
    const kit = planZip([entry('maze-kit/forest/hall-straight.json'), entry('maze-kit/shared/plug.ply')], 'whatever.zip')
    expect(kit.kit).toBe('maze-kit')
    expect(kit.rows.map((r) => r.id)).toEqual(['maze-kit/forest/hall-straight', 'maze-kit/shared/plug'])
    const loose = planZip([entry('hall.json'), entry('sub/tee.json')], 'My Kit.zip')
    expect(loose.kit).toBe('My Kit')
    expect(loose.rows.map((r) => r.id)).toEqual(['My Kit/hall', 'My Kit/sub/tee'])
    // A second download keeps the kit.
    expect(planZip([entry('hall.json')], 'My Kit (1).zip').rows[0].id).toBe('My Kit/hall')
    const two = planZip([entry('a/x.json'), entry('b/y.json')], 'pair.zip')
    expect(two.rows.map((r) => r.id)).toEqual(['pair/a/x', 'pair/b/y'])
  })

  it('a colon in a path is an error, since the id is an address part', () => {
    const plan = planZip([entry('kit/a:b.json')], 'k.zip')
    expect(plan.rows[0].error).toBe('A colon in its path')
  })

  it('points a kit-internal reference at the importer\'s piece, by id or by path in the zip, and leaves others alone', () => {
    const plan = planZip([entry('maze-kit/forest/room.json'), entry('maze-kit/forest/water-high.json')], 'k.zip')
    const targets = refTargets(plan.rows)
    const me = 'a'.repeat(64)
    const other = `33331:${'b'.repeat(64)}:theirs`
    const refs: Array<['a' | 'e', string, string?]> = [
      ['a', `33331:${PLACEHOLDER_PUBKEY}:maze-kit/forest/room`],
      ['a', `33331:${PLACEHOLDER_PUBKEY}:maze-kit/forest/water-high`, 'wss://hint'],
      ['a', other],
    ]
    expect(resolveRefs(refs, targets, me)).toEqual([
      ['a', `33331:${me}:maze-kit/forest/room`],
      // The kit's relay hint is not the importer's relay: dropped.
      ['a', `33331:${me}:maze-kit/forest/water-high`],
      ['a', other],
    ])
    expect(unresolved(refs, targets)).toEqual([])
    expect(unresolved([['a', `33331:${PLACEHOLDER_PUBKEY}:maze-kit/hall-straight`]], targets)).toEqual(['maze-kit/hall-straight'])
    // At the top of a zip, a reference may name the path without the zip-name prefix.
    const loose = planZip([entry('room.json')], 'k.zip')
    expect(resolveRefs([['a', `33331:${PLACEHOLDER_PUBKEY}:room`]], refTargets(loose.rows), me)).toEqual([['a', `33331:${me}:k/room`]])
  })
})

describe('pieces that will not exist', () => {
  it('leaves out a row placing a piece that is not coming in, and any row placing that row, until nothing changes', () => {
    const P = (d: string) => ['a', `33331:${PLACEHOLDER_PUBKEY}:${d}`]
    const rows = [
      { key: '1', id: 'k/shell', refs: [P('k/room')] },
      { key: '2', id: 'k/room', refs: [P('k/door')] },
      { key: '3', id: 'k/door' },
      { key: '4', id: 'k/other', refs: [P('k/old')] },
    ]
    const targets = new Map([['k/shell', 'k/shell'], ['k/room', 'k/room'], ['k/door', 'k/door'], ['k/old', 'k/old']])
    // The door is unticked: the room cannot come in, so neither can the shell. k/old is already yours.
    const out = blockedRows(rows, targets, new Set(['k/old']), new Set(['k/shell', 'k/room', 'k/other']))
    expect([...out]).toEqual([['2', 'k/door'], ['1', 'k/room']])
    expect(hasPlaceholders(rows[0].refs)).toBe(true)
    expect(hasPlaceholders([['a', `33331:${'b'.repeat(64)}:x`]])).toBe(false)
  })
})

describe('duplicates', () => {
  const row = (key: string, id: string, name: string, folder: string[]) => ({ key, id, name, folder, error: null as string | null })
  const rows = [
    row('1', 'kit/forest/hall', 'hall', ['kit', 'forest']),
    row('2', 'kit/cistern/hall', 'Hall', ['kit', 'cistern']),
    row('3', 'kit/forest/tee', 'tee', ['kit', 'forest']),
    { ...row('4', 'kit/forest/bad', 'bad', ['kit', 'forest']), error: 'Not an SNO object.' },
    row('5', 'kit/forest/hall', 'hall', ['kit', 'forest']),
  ]

  it('a shard with the row\'s id is the same piece; an unrelated one with its name is a name match; a kit\'s own pieces never clash by name', () => {
    const mine = [
      { id: 'kit/forest/hall', name: 'hall', folder: null },
      { id: 'uuid-1', name: 'tee ', folder: null },
      { id: 'uuid-2', name: 'bad', folder: null },
    ]
    const d = findDups(rows, mine, false, 'kit')
    expect(d.get('1')).toEqual({ in: 'same', id: 'kit/forest/hall' })
    // The cistern hall shares a name only with a piece of the same kit.
    expect(d.get('2')).toBeNull()
    expect(d.get('3')).toEqual({ in: 'name', ids: ['uuid-1'] })
    expect(d.get('4')).toBeNull()
    expect(d.get('5')).toEqual({ in: 'zip', first: '1' })
    // An address your relays hold, with no shard of it here.
    expect(findDups(rows, [], false, 'kit', new Set(['kit/forest/tee'])).get('3')).toEqual({ in: 'published', id: 'kit/forest/tee' })
  })

  it('with folders, a name is taken only in its own folder', () => {
    const mine = [{ id: 'u1', name: 'hall', folder: ['kit', 'forest'] }, { id: 'u2', name: 'tee', folder: ['elsewhere'] }]
    const d = findDups(rows.slice(0, 3), mine, true, 'other')
    expect(d.get('1')).toEqual({ in: 'name', ids: ['u1'] })
    expect(d.get('2')).toBeNull()
    expect(d.get('3')).toBeNull()
    expect(dupKey('A', ['K'], true)).toBe(dupKey('a', ['k'], true))
  })

  it('turns each mode into one action, and never replaces an unrelated shard', () => {
    const same = { in: 'same' as const, id: 'kit/x' }
    const name = { in: 'name' as const, ids: ['u1'] }
    const zip = { in: 'zip' as const, first: '1' }
    expect(dupAction(null, 'skip')).toEqual({ act: 'new', copyName: false })
    for (const d of [same, name, zip]) expect(dupAction(d, 'skip')).toEqual({ act: 'skip' })
    expect(dupAction(same, 'update')).toEqual({ act: 'update', id: 'kit/x' })
    expect(dupAction(same, 'copy')).toEqual({ act: 'copy' })
    expect(dupAction(name, 'update')).toEqual({ act: 'new', copyName: true })
    expect(dupAction(name, 'copy')).toEqual({ act: 'new', copyName: true })
    expect(dupAction(zip, 'update')).toEqual({ act: 'skip' })
    expect(dupAction(zip, 'copy')).toEqual({ act: 'copy' })
    const pub = { in: 'published' as const, id: 'kit/x' }
    expect(dupAction(pub, 'skip')).toEqual({ act: 'skip' })
    expect(dupAction(pub, 'update')).toEqual({ act: 'new', copyName: false })
    expect(dupAction(pub, 'copy')).toEqual({ act: 'copy' })
  })
})
