import { describe, expect, it } from 'vitest'
import { gather, arrangementFrom, connected } from '../arrangement'
import { type Arrangement,
  encodeArrangement, deriveKey, lookupOf, sealPrize, openPrize, cellIndex, cellAt, DOMAIN, sheetShape, readSheetShape, finderView, readRecord,
  recordTemplate, recordLookup, recordRefusal, toRuns, expandRuns, cardTemplate, cardRecord, type RecordEvent, type Sheet,
} from '../format'
import { FERROVEIN, GLOWCORE, GRIDSTONE } from '../recipes'
import { prizesOf, makerRank, rankRecords } from '../smash'
import { bytesToHex } from '../../events'

/** The spec's own vector arrangement (DECK-0010's compiler_recipe vector, the plus of 2026-11-26): four Gridstone in a plus round a Ferrovein, a Glowcore on top. The game's Compiler is now the hammer (recipes.ts). */
const COMPILER_RECIPE: Arrangement = arrangementFrom([
  { at: [1, 0, 0], id: GRIDSTONE }, { at: [0, 0, 1], id: GRIDSTONE }, { at: [1, 0, 1], id: FERROVEIN },
  { at: [2, 0, 1], id: GRIDSTONE }, { at: [1, 0, 2], id: GRIDSTONE }, { at: [1, 1, 1], id: GLOWCORE },
])!

/** A sparse world of blocks for gather. */
function world(cells: Array<[number, number, number, number]>): (x: number, y: number, z: number) => number {
  const m = new Map(cells.map(([x, y, z, id]) => [`${x},${y},${z}`, id]))
  return (x, y, z) => m.get(`${x},${y},${z}`) ?? 0
}

const compilerAt = (ox: number, oy: number, oz: number): Array<[number, number, number, number]> => [
  [ox + 1, oy, oz, GRIDSTONE], [ox, oy, oz + 1, GRIDSTONE], [ox + 1, oy, oz + 1, FERROVEIN], [ox + 2, oy, oz + 1, GRIDSTONE], [ox + 1, oy, oz + 2, GRIDSTONE], [ox + 1, oy + 1, oz + 1, GLOWCORE],
]

describe('the scan order and encoding (DECK-0010 §3)', () => {
  it('reads Y outermost, then Z, then X fastest', () => {
    const size = [3, 2, 3] as const
    expect(cellIndex(size, 1, 0, 0)).toBe(1)
    expect(cellIndex(size, 0, 0, 1)).toBe(3)
    expect(cellIndex(size, 0, 1, 0)).toBe(9)
    expect(cellAt(size, 13)).toEqual([1, 1, 1])
  })

  it('encodes the Compiler recipe to the spec\'s 62 bytes', () => {
    expect(bytesToHex(encodeArrangement(COMPILER_RECIPE))).toBe(
      '435942455253504143455f424c55455052494e545f5631' + '030302'
      + '000000010000' + '000100280001' + '000000010000'
      + '000000000000' + '0000002a0000' + '000000000000',
    )
    expect(DOMAIN.length).toBe(23)
  })

  it('a location lock adds the region key', () => {
    expect(encodeArrangement(COMPILER_RECIPE, new Uint8Array(32).fill(7)).length).toBe(62 + 32)
  })

  it('the Compiler recipe\'s key and lookup match the spec\'s vector (500,000 rounds)', async () => {
    const key = await deriveKey(encodeArrangement(COMPILER_RECIPE))
    expect(bytesToHex(key)).toBe('65d408f994300326544e75e15077f54b9fd4540eb80434d15962263ed0dbb50a')
    expect(await lookupOf(key)).toBe('f61bb6171413d8ed06390bb83f000af859f12cedd3fbde80aa7b249c6642058d')
  })
})

describe('gather (DECK-0010 §4)', () => {
  it('takes a stand-alone recipe whole from any of its blocks', () => {
    const read = world(compilerAt(10, 5, -3))
    for (const hit of [[11, 6, -2], [10, 5, -2], [11, 5, -1]] as const) {
      const g = gather(read, hit)
      expect(g.isolated).toBe(true)
      expect(g.cells.length).toBe(6)
      expect([...g.arrangement!.cells]).toEqual([...COMPILER_RECIPE.cells])
    }
  })

  it('a block touching only at a corner joins the group', () => {
    expect(gather(world([...compilerAt(0, 0, 0), [2, 2, 2, GRIDSTONE]]), [1, 0, 1]).cells.length).toBe(7)
  })

  it('a block in the grown box that touches nothing leaves it not isolated, and is not taken', () => {
    const diagonal: Array<[number, number, number, number]> = [[0, 0, 0, 1], [1, 0, 1, 1], [2, 0, 2, 1]]
    expect(gather(world(diagonal), [0, 0, 0]).isolated).toBe(true)
    const g = gather(world([...diagonal, [3, 0, -1, 1]]), [0, 0, 0])
    expect(g.cells.length).toBe(3)
    expect(g.isolated).toBe(false)
  })

  it('a construction of at most 16 on every axis comes away whole wherever it is struck (owner, 2026-11-27); 17 never compiles', () => {
    const line = (n: number): Array<[number, number, number, number]> => Array.from({ length: n }, (_, i) => [i, 0, 0, 1])
    for (const x of [0, 7, 8, 15]) {
      const g = gather(world(line(16)), [x, 0, 0])
      expect(g.cells.length, String(x)).toBe(16)
      expect(g.isolated, String(x)).toBe(true)
    }
    // Too long, struck at an end: the 16 cells in the window (x -15 to 15) go, the 17th touches from outside, nothing compiled.
    const end = gather(world(line(17)), [0, 0, 0])
    expect(end.cells.length).toBe(16)
    expect(end.isolated).toBe(false)
    expect(end.arrangement).toBeNull()
  })

  it('natural ground under a build is taken with it', () => {
    const ground: Array<[number, number, number, number]> = []
    for (let x = -3; x < 6; x++) for (let z = -3; z < 6; z++) ground.push([x, -1, z, 9])
    const g = gather(world([...compilerAt(0, 0, 0), ...ground]), [1, 1, 1])
    expect(g.cells.length).toBe(6 + 81)
  })

  it('empty space at the hit takes nothing', () => {
    expect(gather(world([]), [0, 0, 0]).cells).toEqual([])
  })

  it('connected: corner contact counts, a gap does not', () => {
    expect(connected(COMPILER_RECIPE)).toBe(true)
    expect(connected(arrangementFrom([{ at: [0, 0, 0], id: 1 }, { at: [2, 0, 0], id: 1 }])!)).toBe(false)
  })
})

describe('the key and the prize', () => {
  it('the same build, the same key wherever it stands; a quarter turn is another build', async () => {
    const a = gather(world(compilerAt(0, 0, 0)), [1, 0, 1]).arrangement!
    const b = gather(world(compilerAt(-100, 40, 7)), [-99, 40, 8]).arrangement!
    expect(await deriveKey(encodeArrangement(a), 1000)).toEqual(await deriveKey(encodeArrangement(b), 1000))
    // The plus looks the same turned about Y; turned about X it is another build.
    const turned = arrangementFrom(compilerAt(0, 0, 0).map(([x, y, z, id]) => ({ at: [x, -z, y] as const, id })))!
    expect(await deriveKey(encodeArrangement(turned), 1000)).not.toEqual(await deriveKey(encodeArrangement(a), 1000))
  })

  it('only the key opens the prize (AES-256-GCM)', async () => {
    const key = await deriveKey(encodeArrangement(COMPILER_RECIPE), 1000)
    const other = await deriveKey(encodeArrangement(COMPILER_RECIPE, new Uint8Array(32)), 1000)
    const sealed = await sealPrize(key, { type: 'tool', tool: 'compiler' })
    expect(await openPrize(key, sealed)).toEqual({ type: 'tool', tool: 'compiler' })
    expect(await openPrize(other, sealed)).toBeNull()
  })
})

describe('the sheet and the record (DECK-0010 §5)', () => {
  it('runs arrays round trip and refuse bad input', () => {
    expect(toRuns([0, 0, 0, 1, 2, 2])).toEqual([0, -2, 1, 2, -1])
    expect(expandRuns([0, -2, 1, 2, -1], 6, 3)).toEqual([0, 0, 0, 1, 2, 2])
    expect(expandRuns([-1], 1, 1)).toBeNull()
    expect(expandRuns([0, -9], 3, 1)).toBeNull()
  })

  it('the shape always shows, hidden cells are null, and no hidden id is written', () => {
    const shape = sheetShape(COMPILER_RECIPE, (i) => i === 13)
    expect(shape.pal).toEqual([0, null, GLOWCORE])
    const sheet: Sheet = { ...shape, lock: 'standard', prize: { reveal: 'hidden' } }
    const cells = readSheetShape(sheet)!
    expect(cells.filter((v) => v !== 0).length).toBe(6)
    expect(JSON.stringify(sheet)).not.toContain(String(FERROVEIN))
    const v = finderView({ sheet, cells })
    expect([...v.revealed]).toEqual([[13, GLOWCORE]])
  })

  it('records are checked as §5.4 says; a card carries one unchanged', () => {
    const sheet: Sheet = { ...sheetShape(COMPILER_RECIPE, () => true), lock: 'standard', prize: { reveal: 'description', text: 'A lamp.' } }
    const t = recordTemplate({ lookup: 'a'.repeat(64), sheet, sealed: 'AAAA', title: 'Sky Shrine', createdAt: 5 })
    const ev: RecordEvent = { ...t, id: '1'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) }
    expect(recordRefusal(ev)).toBeNull()
    expect(readRecord(ev)?.title).toBe('Sky Shrine')
    expect(recordLookup(ev)).toBe('a'.repeat(64))
    expect(recordRefusal({ ...ev, tags: [...ev.tags, ['C', '00']] })).toBe('unknown tag C')
    expect(recordRefusal({ ...ev, content: JSON.stringify({ ...sheet, lock: 'location' }) })).toBe('height')
    const card = cardTemplate(ev, 'ff'.repeat(32), 9)
    expect(card.tags).toContainEqual(['-'])
    expect(cardRecord({ kind: card.kind, content: card.content })).toEqual(ev)
  })
})

describe('unsealing order (DECK-0010 §6)', () => {
  it('every maker\'s newest record pays out, muted makers never; yours, then follows, then others', async () => {
    const key = await deriveKey(encodeArrangement(COMPILER_RECIPE), 1000)
    const lookup = await lookupOf(key)
    const sealed = await sealPrize(key, { type: 'sno', payload: { v: 2, name: 'Lantern' } })
    const sheet: Sheet = { ...sheetShape(COMPILER_RECIPE, () => false), lock: 'standard', prize: { reveal: 'hidden' } }
    const rec = (pubkey: string, id: string, t: number, s = sealed): RecordEvent => ({ ...recordTemplate({ lookup, sheet, sealed: s, title: pubkey.slice(0, 4), createdAt: t }), id, pubkey, sig: '' })
    const me = 'a'.repeat(64), friend = 'b'.repeat(64), stranger = 'c'.repeat(64), muted = 'd'.repeat(64), liar = 'e'.repeat(64)
    const deps = { me: () => me, follows: () => new Set([friend]), muted: () => new Set([muted]) }
    const records = [rec(stranger, '1', 5), rec(stranger, '0', 3), rec(muted, '2', 9), rec(friend, '3', 1), rec(me, '4', 2), rec(liar, '5', 8, 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')]
    expect(rankRecords(records, lookup, deps).map((r) => r.pubkey)).toEqual([me, friend, liar, stranger])
    const found = await prizesOf(records, lookup, key, deps)
    expect(found.map((f) => f.maker)).toEqual([me, friend, stranger])
    expect(found[2].record!.id).toBe('1')
    expect(makerRank(friend, deps)).toBe(2)
  })
})

describe('strict records (DECK-0010 at 83929cd)', () => {
  it('no client tag, or any other, is ever added to a record or a card by the publish wrapper', async () => {
    const { attributed } = await import('../../client')
    for (const kind of [33343, 3343]) expect(attributed({ kind, created_at: 1, tags: [['d', 'x']], content: '' }).tags).toEqual([['d', 'x']])
    expect(attributed({ kind: 1, created_at: 1, tags: [], content: '' }).tags.some((t) => t[0] === 'client')).toBe(true)
  })

  it('a writer puts free text in plain: a line break or tab in the words becomes a space, and a blank prize name is never written', async () => {
    const { makeBlueprint } = await import('../make')
    const a = { size: [1, 1, 1] as [number, number, number], cells: Uint16Array.from([1]) }
    const made = await makeBlueprint({ arrangement: a, shown: () => true, title: 'Two\\nlines'.replace('\\\\n', '\n'), prize: { type: 'sno', payload: { v: 2 } }, reveal: 'description', text: 'A\tsmall\nlamp', lock: 'standard', prizeName: '   ' },
      async (t) => ({ ...t, id: 'f'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) }))
    if ('refused' in made) throw new Error(made.refused)
    expect(recordRefusal(made.record)).toBeNull()
    const sheet = JSON.parse(made.record.content)
    expect(sheet.prize.text).toBe('A small lamp')
    expect('name' in sheet.prize).toBe(false)
    expect(made.record.tags.find((t) => t[0] === 'title')?.[1]).not.toMatch(/\n/)
  }, 60_000)
})
