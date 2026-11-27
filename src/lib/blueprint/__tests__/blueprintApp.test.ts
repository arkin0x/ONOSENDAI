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
import { shownCell, partsList, revealSummary, useBlueprintTool } from '../../../store/useBlueprintTool'
import { arrangementFrom } from '../arrangement'
import { COMPILER_RECIPE, FERROVEIN, GLOWCORE, GRIDSTONE, RUSTBAND, sameArrangement } from '../recipes'
import { compile, relayAsker, smashGroup, type SmashDeps } from '../smash'
import { hammerPose, IDLE_CLOCK, POSE_IDLE } from '../hammerAnim'
import { ringSpot } from '../../../scene/PrizeToys'
import { startSmashHold, cancelSmashHold, useSmashHold } from '../../../terrain/smashHold'
import { makeBlueprint, makeRefusal, publishRecord } from '../make'
import { keyOf } from '../keyClient'
import { encodeArrangement, readRecord, type RecordEvent } from '../format'
import { bytesToHex } from '../../events'

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
  it('a production deployment never grants, even on its *.vercel.app address', async () => {
    vi.stubGlobal('location', { hostname: 'onosendai-abc123.vercel.app', search: '' })
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_VERCEL_ENV', 'production')
    const g = await import('../devGrant')
    expect(g.previewHost()).toBe(false)
    expect(g.compilerGranted()).toBe(false)
  })
  it('grants on a Vercel preview deployment, and ?compiler=0 turns it off', async () => {
    vi.stubGlobal('location', { hostname: 'onosendai-git-x.vercel.app', search: '?compiler=0' })
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_VERCEL_ENV', 'preview')
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

  it('records are asked of the relay when LIVE (it takes them since cyberspace-relay #52), never in LOCAL', async () => {
    const query = vi.fn(async () => [])
    expect(await relayAsker(query, () => false)('a'.repeat(64))).toBeNull()
    expect(query).not.toHaveBeenCalled()
    expect(await relayAsker(query, () => true)('a'.repeat(64))).toEqual([])
    expect(query).toHaveBeenCalledWith({ kinds: [33343], '#d': ['a'.repeat(64)], limit: 50 })
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
  // The Compiler's recipe laid out at the origin, in a world of nothing else (scan order: X fastest, then Z, then Y).
  const blocks = new Map<string, number>()
  for (let i = 0; i < COMPILER_RECIPE.cells.length; i++) {
    const id = COMPILER_RECIPE.cells[i]
    if (!id) continue
    const [sx, , sz] = COMPILER_RECIPE.size
    const x = i % sx, rest = Math.floor(i / sx), z = rest % sz, y = Math.floor(rest / sz)
    blocks.set(`${x},${y},${z}`, id)
  }
  const read = (x: number, y: number, z: number): number => blocks.get(`${x},${y},${z}`) ?? 0

  it('the Compiler is the hammer (owner, 2026-11-27): a T of two Ferrovein, a Glowcore and two Rustband, 3 by 3 by 1', () => {
    expect(COMPILER_RECIPE.size).toEqual([3, 3, 1])
    expect(blocks).toEqual(new Map([['1,0,0', FERROVEIN], ['1,1,0', FERROVEIN], ['0,2,0', RUSTBAND], ['1,2,0', GLOWCORE], ['2,2,0', RUSTBAND]]))
  })

  it('its key and lookup, for the spec\'s vector (500,000 rounds)', async () => {
    expect(bytesToHex(encodeArrangement(COMPILER_RECIPE))).toBe('435942455253504143455f424c55455052494e545f56310301030000002800000000002800000005002a0005')
    const k = await keyOf(COMPILER_RECIPE)
    expect(k.lookup).toBe('84b131f9c9fd4fe30f118e8c115e7dfd86c7debd3d2f7cef26ddddae053f8564')
    expect(bytesToHex(k.key)).toBe('593eabd69f12d642d07764e4a7599d1ce1aa1f75912928ef892dfdead5821e77')
  }, 60_000)

  it('struck at any of its five blocks, a bare hand takes the hammer whole and compiles it (owner, 2026-11-27)', () => {
    for (const hit of [[1, 0, 0], [1, 1, 0], [0, 2, 0], [1, 2, 0], [2, 2, 0]] as const) {
      const g = smashGroup(read, hit, true)
      expect(g.cells, hit.join(',')).toHaveLength(5)
      expect(g.isolated, hit.join(',')).toBe(true)
      expect(sameArrangement(g.arrangement!, COMPILER_RECIPE), hit.join(',')).toBe(true)
    }
  })

  it('a block touching it joins the group, so it is no longer the recipe; ground under it leaves it not isolated: no compile', () => {
    const beside = (x: number, y: number, z: number): number => (x === 1 && y === 0 && z === 1 ? GRIDSTONE : read(x, y, z))
    const g = smashGroup(beside, [2, 2, 0], true)
    expect(g.arrangement && sameArrangement(g.arrangement, COMPILER_RECIPE)).toBeFalsy()
    // Standing on ground: the group runs into the ground, so nothing compiles; what goes is the group within the bare hand's 5-cell window.
    const ground = (x: number, y: number, z: number): number => (y < 0 ? GRIDSTONE : read(x, y, z))
    const u = smashGroup(ground, [0, 2, 0], true)
    expect(u.isolated).toBe(false)
    expect(u.arrangement).toBeNull()
    // What is deleted is the connected blocks in the 3 by 3 by 3 box round the hit.
    expect(u.smash.every(([x, y, z]) => Math.abs(x) <= 1 && Math.abs(y - 2) <= 1 && Math.abs(z) <= 1)).toBe(true)
  })

  it('a group of extent 4 (one past a bare hand\'s 3) does not compile bare-handed; the Compiler compiles it', () => {
    const four = (x: number, y: number, z: number): number => (y === 0 && z === 0 && x >= 0 && x <= 3 ? GRIDSTONE : 0)
    for (const x of [0, 3]) {
      const g = smashGroup(four, [x, 0, 0], true)
      expect(g.arrangement).toBeNull()
      expect(g.cells.length).toBeLessThan(4)
      expect(smashGroup(four, [x, 0, 0]).isolated).toBe(true)
    }
  })

  it('a 16-long build compiles with the Compiler struck at either end; 17 long never does', () => {
    const row = (n: number) => (x: number, y: number, z: number): number => (y === 0 && z === 0 && x >= 0 && x < n ? GRIDSTONE : 0)
    for (const x of [0, 15]) {
      const g = smashGroup(row(16), [x, 0, 0])
      expect(g.isolated).toBe(true)
      expect(g.cells).toHaveLength(16)
      expect(g.arrangement!.size).toEqual([16, 1, 1])
    }
    for (const x of [0, 8, 16]) {
      const g = smashGroup(row(17), [x, 0, 0])
      expect(g.arrangement).toBeNull()
    }
    // Struck in the middle: the gather finds all 17 standing alone, too long to compile; the smash deletes 16, its box.
    const mid = smashGroup(row(17), [8, 0, 0])
    expect(mid.cells).toHaveLength(17)
    expect(mid.isolated).toBe(true)
    expect(mid.smash).toHaveLength(16)
    expect(mid.smash.every(([x]) => x >= 0 && x <= 15)).toBe(true)
  })

  it('a long row (not a construction): the gather looks 5 (bare) or 31 (the Compiler) across; the smash deletes only its box, 3 or 16', () => {
    const row = (x: number, y: number, z: number): number => (y === 0 && z === 0 && x >= -20 && x <= 20 ? GRIDSTONE : 0)
    const bare = smashGroup(row, [0, 0, 0], true)
    expect(bare.cells).toHaveLength(5)
    expect(bare.smash).toHaveLength(3)
    expect(bare.blocks).toHaveLength(3)
    const c = smashGroup(row, [0, 0, 0])
    expect(c.cells).toHaveLength(31)
    expect(c.smash).toHaveLength(16)
    expect(Math.min(...c.smash.map(([x]) => x))).toBe(-8)
    expect(Math.max(...c.smash.map(([x]) => x))).toBe(7)
  })
})

describe('sealing, blueprints live (2026-11-27)', () => {
  const rail = arrangementFrom([{ at: [0, 0, 0], id: GRIDSTONE }, { at: [1, 0, 0], id: FERROVEIN }])!
  const signer = async (t: Parameters<Parameters<typeof makeBlueprint>[1]>[0]): Promise<RecordEvent> => ({ ...t, id: 'f'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) })

  it('a record over 98,304 bytes is refused when sealing, in plain words (DECK-0010 §5.2)', async () => {
    const big = { v: 2, name: 'Huge', blob: 'x'.repeat(100_000) }
    const made = await makeBlueprint({ arrangement: rail, shown: () => true, title: 'Big', prize: { type: 'sno', payload: big }, reveal: 'hidden', lock: 'standard' }, signer)
    expect('refused' in made && made.refused).toMatch(/Too big to seal: choose fewer prize pictures, or a smaller prize/)
  })

  it('LIVE, the sealed record is published; LOCAL keeps it; a refusal says so', async () => {
    const made = await makeBlueprint({ arrangement: rail, shown: () => true, title: 'Rail', prize: { type: 'sno', payload: { v: 2, name: 'Rail piece' } }, reveal: 'hidden', lock: 'standard' }, signer)
    if ('refused' in made) throw new Error(made.refused)
    const sentKinds: number[] = []
    const send = async (ev: { kind: number }): Promise<{ ok: boolean }> => { sentKinds.push(ev.kind); return { ok: true } }
    expect(await publishRecord(made.record, true, send)).toBe('sent')
    expect(sentKinds).toEqual([33343])
    expect(await publishRecord(made.record, false, send)).toBe('kept')
    expect(sentKinds).toEqual([33343])
    expect(await publishRecord(made.record, true, async () => ({ ok: false }))).toBe('failed')
  })

  it('a new capture, a new cage and MAKE ANOTHER start from the default settings: the prize name hidden again', () => {
    const T = useBlueprintTool
    T.getState().set({ reveal: 'render', views: new Set(['x', 'y']), showName: true, text: 'old', lock: 'location', height: 3 })
    T.getState().reset()
    expect(T.getState()).toMatchObject({ reveal: 'hidden', showName: false, text: '', lock: 'standard', height: 8 })
    expect([...T.getState().views]).toEqual(['iso'])
    T.getState().set({ showName: true, reveal: 'render' })
    T.getState().captured(rail, { lo: { x: 0n, y: 0n, z: 0n }, plane: 0 })
    expect(T.getState()).toMatchObject({ showName: false, reveal: 'hidden' })
    T.getState().set({ showName: true, cage: (() => { const c = new Uint16Array(16 ** 3); c[0] = GRIDSTONE; return c })() })
    expect(T.getState().takeCage({ lo: { x: 0n, y: 0n, z: 0n }, plane: 0 })).toBeNull()
    expect(T.getState().showName).toBe(false)
  })
})

describe('the gather and the smash set are apart (owner, 2026-11-27: "smash up to the box")', () => {
  const row = (n: number) => (x: number, y: number, z: number): number => (y === 0 && z === 0 && x >= 0 && x < n ? GRIDSTONE : 0)

  it('a bare 4-row struck at its end: nothing compiles and 2 blocks go (the 3 by 3 by 3 box)', () => {
    const g = smashGroup(row(4), [0, 0, 0], true)
    expect(g.arrangement).toBeNull()
    expect(g.smash.map(([x]) => x).sort()).toEqual([0, 1])
  })

  it('a 17-row struck in its middle: 16 go, never more than 16 along any axis', () => {
    const g = smashGroup(row(17), [8, 0, 0])
    expect(g.arrangement).toBeNull()
    expect(g.smash).toHaveLength(16)
  })

  it('a construction goes whole wherever it is struck, the box notwithstanding', () => {
    for (const x of [0, 15]) {
      const g = smashGroup(row(16), [x, 0, 0])
      expect(g.arrangement).not.toBeNull()
      expect(g.smash).toHaveLength(16)
    }
    // The bare 3-row struck at its end: past a 3-box round the hit on one side, and still whole.
    const b = smashGroup(row(3), [0, 0, 0], true)
    expect(b.arrangement).not.toBeNull()
    expect(b.smash.map(([x]) => x).sort()).toEqual([0, 1, 2])
  })
})

describe('a smash says what it did not try (review of #943)', () => {
  it('past the prize cap, "more may be waiting" instead of a silent cut', async () => {
    const { prizesOf } = await import('../smash')
    const rail = arrangementFrom([{ at: [0, 0, 0], id: GRIDSTONE }, { at: [1, 0, 0], id: FERROVEIN }])!
    const by = (pk: string) => async (t: Parameters<Parameters<typeof makeBlueprint>[1]>[0]): Promise<RecordEvent> => ({ ...t, id: pk.slice(0, 1).repeat(64), pubkey: pk, sig: 'c'.repeat(128) })
    const a = await makeBlueprint({ arrangement: rail, shown: () => true, title: 'One', prize: { type: 'sno', payload: { v: 2, name: 'A' } }, reveal: 'hidden', lock: 'standard' }, by('1'.repeat(64)))
    const b = await makeBlueprint({ arrangement: rail, shown: () => true, title: 'Two', prize: { type: 'sno', payload: { v: 2, name: 'B' } }, reveal: 'hidden', lock: 'standard' }, by('2'.repeat(64)))
    if ('refused' in a || 'refused' in b) throw new Error('refused')
    const key = (await keyOf(rail)).key
    const more = { left: false }
    const deps = { me: () => 'f'.repeat(64), follows: () => new Set<string>(), muted: () => new Set<string>() }
    const found = await prizesOf([a.record, b.record], a.lookup, key, deps, 1, { count: 0 }, more)
    expect(found).toHaveLength(1)
    expect(more.left).toBe(true)
    const all = { left: false }
    expect(await prizesOf([a.record, b.record], a.lookup, key, deps, 8, { count: 0 }, all)).toHaveLength(2)
    expect(all.left).toBe(false)
  })
})
