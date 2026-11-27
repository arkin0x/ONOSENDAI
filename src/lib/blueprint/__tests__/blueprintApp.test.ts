import { afterEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const m = new Map<string, string>()
  ;(globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return m.size },
    clear: () => m.clear(),
    getItem: (k: string) => m.get(k) ?? null,
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => { m.delete(k) },
    setItem: (k: string, v: string) => { m.set(k, String(v)) },
  }
})
import { COMPILER_ID, emptyInventory, tidyInventory, withCompiler, withoutCompiler } from '../../terrain/terrainDb'
import { shownCell, partsList, revealSummary } from '../../../store/useBlueprintTool'
import { arrangementFrom } from '../arrangement'
import { COMPILER_RECIPE, FERROVEIN, GLOWCORE, GRIDSTONE, sameArrangement } from '../recipes'
import { compile, relayAsker, smashGroup, type SmashDeps } from '../smash'
import { hammerPose, IDLE_CLOCK, POSE_IDLE } from '../hammerAnim'
import { ringSpot } from '../../../scene/PrizeToys'
import { startSmashHold, cancelSmashHold, useSmashHold } from '../../../terrain/smashHold'
import { makeBlueprint, makeRefusal } from '../make'
import { keyOf } from '../keyClient'
import { readRecord, type RecordEvent } from '../format'

describe('the Compiler in slot 1', () => {
  it('joins slot 1 and shifts the block slots one along, keeping the chosen block chosen', () => {
    const inv = { counts: { 1: 3, 40: 2 }, hotbar: [1, 40, 0, 0, 0, 0, 0, 0, 9], slot: 1 }
    const w = withCompiler(inv, 'made')
    expect(w.hotbar).toEqual([COMPILER_ID, 1, 40, 0, 0, 0, 0, 0, 0])
    expect(w.slot).toBe(2)
    expect(w.compiler).toBe('made')
    expect(withCompiler(w, 'granted')).toBe(w)
  })

  it('a stored Compiler comes back in slot 1; a granted one leaves when the grant is off', () => {
    const w = withCompiler(emptyInventory(), 'granted')
    const back = tidyInventory(JSON.parse(JSON.stringify(w)))
    expect(back.hotbar[0]).toBe(COMPILER_ID)
    expect(back.compiler).toBe('granted')
    const off = withoutCompiler(back)
    expect(off.hotbar.includes(COMPILER_ID)).toBe(false)
    expect(off.compiler).toBeUndefined()
    // Nobody gets one from storage that never had one.
    expect(tidyInventory({ counts: {}, hotbar: [COMPILER_ID], slot: 0 }).hotbar[0]).toBe(0)
  })
})

describe('the dev grant', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); localStorage.clear() })
  it('never grants on the production host, in any build', async () => {
    vi.stubGlobal('location', { hostname: 'www.onosendai.tech', search: '?compiler=1' })
    vi.stubEnv('DEV', true)
    const g = await import('../devGrant')
    expect(g.previewHost()).toBe(false)
    expect(g.compilerGranted()).toBe(false)
  })
  it('grants on a Vercel preview, and ?compiler=0 turns it off', async () => {
    vi.stubGlobal('location', { hostname: 'onosendai-git-x.vercel.app', search: '?compiler=0' })
    vi.stubEnv('DEV', false)
    const g = await import('../devGrant')
    expect(g.previewHost()).toBe(true)
    expect(g.compilerGranted()).toBe(false)
    localStorage.removeItem('onosendai:compiler-grant')
    expect(g.compilerGranted()).toBe(true)
  })
})

describe('the recipe reveal', () => {
  const arrangement = arrangementFrom([
    { at: [0, 0, 0], id: GRIDSTONE }, { at: [1, 0, 0], id: GRIDSTONE }, { at: [2, 0, 0], id: GRIDSTONE }, { at: [1, 1, 0], id: GLOWCORE },
  ])!
  const base = { arrangement, typeHidden: new Set<number>(), flipped: new Set<number>(), randomPct: 100, seed: 7 }

  it('everything starts revealed', () => {
    expect(revealSummary(partsList(base))).toBe('Finders see every block.')
  })

  it('an eye hides a whole type; a tap flips one block; the summary says so', () => {
    const s = { ...base, typeHidden: new Set([GRIDSTONE]) }
    expect(revealSummary(partsList(s))).toBe('Finders see the shape and the Glowcore.')
    const one = { ...s, flipped: new Set([0]) }
    expect(shownCell(one, 0)).toBe(true)
    expect(revealSummary(partsList(one))).toBe('Finders see the shape, 1 of 3 Gridstone and the Glowcore.')
    expect(revealSummary(partsList({ ...base, typeHidden: new Set([GRIDSTONE, GLOWCORE]) }))).toBe('Finders see only the shape.')
  })

  it('the random shortcut keeps about N% of the shown types, steadily', () => {
    const big = arrangementFrom(Array.from({ length: 200 }, (_, i) => ({ at: [i % 10, Math.floor(i / 100), Math.floor(i / 10) % 10] as const, id: GRIDSTONE })))!
    const s = { ...base, arrangement: big, randomPct: 30 }
    const shown = partsList(s)[0].shown
    expect(shown).toBeGreaterThan(30)
    expect(shown).toBeLessThan(90)
    expect(partsList(s)[0].shown).toBe(shown)
  })
})

describe('compiling', () => {
  const deps = (records: RecordEvent[] = []): SmashDeps => ({
    known: async () => records, relay: async () => null, remember: () => {}, me: () => 'a'.repeat(64), follows: () => new Set(), muted: () => new Set(), lockHeights: () => [], regionKey: () => null,
  })

  it('the Compiler recipe yields the Compiler, bare hand or not', async () => {
    expect((await compile(COMPILER_RECIPE, true, deps())).found.map((f) => f.prize)).toEqual([{ type: 'tool', tool: 'compiler' }])
  })

  it('a bare hand compiles nothing else; the Compiler unseals a held blueprint', async () => {
    const arrangement = arrangementFrom([{ at: [0, 0, 0], id: GRIDSTONE }, { at: [1, 0, 0], id: FERROVEIN }])!
    const made = await makeBlueprint({ arrangement, shown: () => true, title: 'Rail', prize: { type: 'sno', payload: { v: 2, name: 'Rail piece' } }, reveal: 'hidden', lock: 'standard' },
      async (t) => ({ ...t, id: 'f'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) }))
    if ('refused' in made) throw new Error(made.refused)
    expect((await keyOf(arrangement)).lookup).toBe(made.lookup)
    expect((await compile(arrangement, true, deps([made.record]))).found).toEqual([])
    const found = (await compile(arrangement, false, deps([made.record]))).found
    expect(found.map((f) => [f.name, f.maker])).toEqual([['Rail', 'b'.repeat(64)]])
  })

  it('records are never asked of the relay until it takes them', async () => {
    const query = vi.fn(async () => [])
    expect(await relayAsker(query, () => true)('a'.repeat(64))).toBeNull()
    expect(query).not.toHaveBeenCalled()
  })

  it('a blueprint whose blocks do not all touch is refused before sealing', () => {
    const apart = arrangementFrom([{ at: [0, 0, 0], id: GRIDSTONE }, { at: [3, 0, 0], id: GRIDSTONE }])
    // Apart blocks box to 4 wide with a gap: never one group.
    expect(makeRefusal({ arrangement: apart!, reveal: 'hidden', lock: 'standard' })).toMatch(/touch/)
    expect(makeRefusal({ arrangement: COMPILER_RECIPE, reveal: 'description', text: ' ', lock: 'standard' })).toMatch(/few words/)
  })
})

describe('the hold, the swing and the ring', () => {
  it('the hold fills, then swings; letting go cancels with nothing spent', () => {
    vi.useFakeTimers()
    const done = vi.fn()
    startSmashHold([1, 2, 3], 3000, false, done, 0)
    vi.advanceTimersByTime(2000)
    cancelSmashHold()
    vi.advanceTimersByTime(2000)
    expect(done).not.toHaveBeenCalled()
    startSmashHold([1, 2, 3], 3000, false, done, 0)
    vi.advanceTimersByTime(3000)
    expect(done).toHaveBeenCalledWith([1, 2, 3], false)
    expect(useSmashHold.getState().swingAt).not.toBeNull()
    vi.useRealTimers()
  })

  it('the hammer charges across the hold, streaks in the swing and comes back to rest', () => {
    // The phases and the poses have their own tests (hammerAnim.test.ts).
    expect(hammerPose(2900, { ...IDLE_CLOCK, since: 0, ms: 3000 }, 180, false).charge).toBeGreaterThan(0.6)
    expect(hammerPose(150, { ...IDLE_CLOCK, ms: 3000, swingAt: 0 }, 180, false).trail).toBeGreaterThan(0)
    expect(hammerPose(5000, { ...IDLE_CLOCK, ms: 3000, swingAt: 0 }, 180, false)).toEqual(POSE_IDLE)
  })

  it('one prize floats alone; several share a ring; reduced motion holds still', () => {
    expect(ringSpot(0, 1, 5, false)).toEqual([0, 0.35, 0])
    const a = ringSpot(0, 3, 0, true), b = ringSpot(0, 3, 10, true)
    expect(a).toEqual([a[0], a[1], a[2]])
    expect(a[0]).toBeCloseTo(b[0])
    expect(Math.hypot(ringSpot(1, 3, 2, false)[0], ringSpot(1, 3, 2, false)[2])).toBeCloseTo(0.9 + 0.36)
  })
})

describe('the prize reveal at sealing', () => {
  const arrangement = arrangementFrom([{ at: [0, 0, 0], id: GRIDSTONE }, { at: [1, 0, 0], id: FERROVEIN }])!
  const sign = async (t: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<RecordEvent> => ({ ...t, id: 'e'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) })
  const payload = { v: 2, name: 'Torch' }

  it('a silhouette keeps its pictures in the record, and a finder reads them back', async () => {
    const pic = 'data:image/png;base64,iVBORw0KGgo='
    const made = await makeBlueprint({ arrangement, shown: () => true, title: 'test', prize: { type: 'sno', payload }, reveal: 'silhouette', views: { iso: pic }, lock: 'standard' }, sign)
    if ('refused' in made) throw new Error(made.refused)
    expect(readRecord(made.record)!.views.iso).toBe(pic)
    expect(makeRefusal({ arrangement, reveal: 'silhouette', views: {}, lock: 'standard' })).toMatch(/view/)
  })

  it('the prize\'s own name is never written unless the maker shows it', async () => {
    const quiet = await makeBlueprint({ arrangement, shown: () => true, title: 'test', prize: { type: 'sno', payload }, reveal: 'description', text: 'A light.', lock: 'standard' }, sign)
    if ('refused' in quiet) throw new Error(quiet.refused)
    expect(quiet.record.content).not.toContain('Torch')
    expect(readRecord(quiet.record)!.prizeName).toBeNull()
    expect(readRecord(quiet.record)!.title).toBe('test')
    const shown = await makeBlueprint({ arrangement, shown: () => true, title: 'test', prize: { type: 'sno', payload }, reveal: 'hidden', lock: 'standard', prizeName: 'Torch' }, sign)
    if ('refused' in shown) throw new Error(shown.refused)
    expect(readRecord(shown.record)!.prizeName).toBe('Torch')
  })
})

describe('a bare hand reaches only the 3 by 3 by 3 box round the hit (owner, 2026-11-27)', () => {
  // The Compiler's recipe laid out at the origin, in a world of nothing else.
  const blocks = new Map<string, number>()
  for (let i = 0; i < COMPILER_RECIPE.cells.length; i++) {
    const id = COMPILER_RECIPE.cells[i]
    if (!id) continue
    const [sx, , sz] = COMPILER_RECIPE.size
    const x = i % sx, rest = Math.floor(i / sx), z = rest % sz, y = Math.floor(rest / sz)
    blocks.set(`${x},${y},${z}`, id)
  }
  const read = (x: number, y: number, z: number): number => blocks.get(`${x},${y},${z}`) ?? 0

  it('hit in its middle column, the recipe comes away whole and isolated, bare or not', () => {
    for (const hit of [[1, 0, 1], [1, 1, 1]] as const) {
      const g = smashGroup(read, hit, true)
      expect(g.cells).toHaveLength(6)
      expect(g.isolated).toBe(true)
      expect(sameArrangement(g.arrangement!, COMPILER_RECIPE)).toBe(true)
    }
  })

  it('hit at an arm\'s end, a bare hand takes only what is within one cell, and it is not an arrangement', () => {
    const g = smashGroup(read, [1, 0, 0], true)
    expect(g.cells.length).toBeLessThan(6)
    expect(g.cells.every(([x, y, z]) => Math.abs(x - 1) <= 1 && Math.abs(y) <= 1 && Math.abs(z) <= 1)).toBe(true)
    expect(g.isolated).toBe(false)
    // The Compiler's reach takes it all from the same hit.
    const c = smashGroup(read, [1, 0, 0])
    expect(c.cells).toHaveLength(6)
    expect(c.isolated).toBe(true)
  })

  it('a long row: bare takes three blocks, the Compiler the window\'s sixteen', () => {
    const row = (x: number, y: number, z: number): number => (y === 0 && z === 0 && x >= -20 && x <= 20 ? GRIDSTONE : 0)
    expect(smashGroup(row, [0, 0, 0], true).cells).toHaveLength(3)
    expect(smashGroup(row, [0, 0, 0]).cells).toHaveLength(16)
  })
})
