/**
 * terrain.test.ts - TERRAIN (store/useTerrain.ts): WALK with block tools.
 * Entering turns WALK on; SURVEY fills a chunk and touches no other; mining
 * and placing change it and the inventory, refused out of reach in plain
 * words; the loaded chunks follow you, so you can survey on for good; and
 * everything is kept per identity in IndexedDB by chunk coordinate: the op
 * log survives a reload, folds into a layer at FOLD_AT, reappears after you
 * leave and come back, and one identity never sees another's.
 */

import 'fake-indexeddb/auto'
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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

import { useCyberspace } from '../useCyberspace'
import { useWalk } from '../useWalk'
import { useTutorial } from '../useTutorial'
import { OUT_OF_REACH, airRefusal, setTerrainSession, syncTerrain, terrainSession, useTerrain } from '../useTerrain'
import { switchMode, currentPadMode, enterTerrainMode, leaveTerrain, pressSecond, backOf, watchLastRing } from '../padMode'
import { DEFAULT_MODES, modeRoles, resetModes, updateModes, useModes, type ModeId, type ModeSettings } from '../modeOrder'
import { chunkKey, chunkOf, CELLS } from '../../lib/terrain/coords'
import { COMPILER_ID, FOLD_AT, openTerrainDb, readKept, withCompiler } from '../../lib/terrain/terrainDb'
import { applyLayer } from '../../lib/terrain/layer'
import { generate } from '../../lib/terrain/generate'
import { groundWriteRevision } from '../../lib/terrain/groundRevision'
import { EMPTY } from '../../lib/terrain/blocks'
import type { RayHit } from '../../lib/terrain/raycast'
import type { Position } from '../../lib/space'

/** A fresh identity for every test, so nothing one test kept is read by the next. */
let run = 0
let A = ''
let B = ''
const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

function as(pubkey: string, at: Position = HEAD): void {
  useCyberspace.setState({ identity: { pubkey, npub: '' }, position: { ...at }, cursor: { ...at }, anchor: { ...at }, plane: 0, walking: false, spectate: null, exploreIndex: null, transit: null })
}

/** A hit on the block at cs offsets from the field's origin, its +y face out. */
function hitAt(dx: number, dy: number, dz: number): RayHit {
  return { cell: [dx, dy, dz], normal: [0, 1, 0], distance: 1 }
}

/** Solid cells of the chunk at chunk offset `c`, as cs offsets, the first `n`. */
function solidCells(n: number, c: [number, number, number] = [0, 0, 0]): Array<[number, number, number]> {
  const s = terrainSession!
  const out: Array<[number, number, number]> = []
  for (let y = 0; y < 32 && out.length < n; y++) for (let z = 0; z < 32 && out.length < n; z++) for (let x = 0; x < 32 && out.length < n; x++) {
    const p: [number, number, number] = [32 * c[0] + x, 32 * c[1] + y, 32 * c[2] + z]
    if (s.world.blockCs(...p) !== EMPTY) out.push(p)
  }
  return out
}

const headKey = (): string => chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))

async function openSurveyed(): Promise<string> {
  await T().enter()
  const key = headKey()
  if (!terrainSession!.world.slotByKey(key)?.surveyed) await T().survey(key)
  return key
}

/** Gone as a reload leaves it: no exit, nothing folded. */
function reload(): void {
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
  useCyberspace.setState({ walking: false })
}

beforeEach(async () => {
  if (T().active) await T().exit()
  reload()
  run++
  A = run.toString(16).padStart(64, 'a')
  B = run.toString(16).padStart(64, 'b')
  // WALK's gravity off in these tests: nothing falls, so no fall makes hops of its own.
  useWalk.setState({ gravity: false })
  as(A)
})

describe('TERRAIN is WALK with block tools', () => {
  it('entering turns WALK on, at a gibson\'s zoom; leaving turns it off and gives the zoom back', async () => {
    useCyberspace.setState({ scaleExp: 3 })
    await T().enter()
    expect(T().active).toBe(true)
    expect(useCyberspace.getState().walking).toBe(true)
    expect(useCyberspace.getState().scaleExp).toBe(0)
    expect(currentPadMode()).toBe('terrain')
    await T().exit()
    expect(useCyberspace.getState().walking).toBe(false)
    expect(useCyberspace.getState().scaleExp).toBe(3)
  })

  it('is a mode of the pad: in from HOP and back out to HOP', async () => {
    expect(enterTerrainMode()).toBe(true)
    await settle(50)
    expect(currentPadMode()).toBe('terrain')
    leaveTerrain()
    expect(currentPadMode()).toBe('hop')
    switchMode('terrain')
    await settle(50)
    expect(currentPadMode()).toBe('terrain')
    switchMode('hop')
    expect(currentPadMode()).toBe('hop')
  })

  it('stays shut in the teaching list (the tour here): not by its key or the build bar either', async () => {
    useTutorial.setState({ active: true })
    try {
      expect(enterTerrainMode()).toBe(false)
      await settle(20)
      expect(T().active).toBe(false)
      expect(currentPadMode()).toBe('hop')
    } finally {
      useTutorial.setState({ active: false })
    }
  })

  it('from WALK the walk goes on: WALK is never left on the way in', async () => {
    switchMode('walk')
    expect(useCyberspace.getState().walking).toBe(true)
    let left = false
    const off = useCyberspace.subscribe((c, p) => { if (p.walking && !c.walking) left = true })
    try {
      expect(enterTerrainMode()).toBe(true)
      await settle(50)
      expect(currentPadMode()).toBe('terrain')
      expect(left).toBe(false)
    } finally {
      off()
    }
  })

  it('WALK ending (its button, X) ends TERRAIN', async () => {
    await T().enter()
    useWalk.getState().exit()
    await settle()
    expect(T().active).toBe(false)
  })

  it('a change of identity ends it', async () => {
    await T().enter()
    useCyberspace.setState({ identity: { pubkey: B, npub: '' } })
    await settle()
    expect(T().active).toBe(false)
  })
})

describe('SURVEY', () => {
  it('fills the chunk with the ground everyone generates the same', async () => {
    await T().enter()
    const key = headKey()
    const s = terrainSession!
    expect(s.world.slotByKey(key)?.blocks).toBeNull()
    await T().survey(key)
    expect(s.world.slotByKey(key)?.blocks?.length).toBe(CELLS)
    expect(T().message).toBe("Terrain revealed from cyberspace's structure.")
  })

  it('surveying a neighbour leaves every block of this chunk unchanged, as stored and as held', async () => {
    const key = await openSurveyed()
    const s = terrainSession!
    const [c] = solidCells(1)
    T().mine(hitAt(...c))
    const before = s.world.slotByKey(key)!.blocks!.slice()
    const version = s.world.slotByKey(key)!.version
    // The head stands at (16, 16, 16): every neighbour 16 away along one axis is in reach.
    for (const [ax, ay, az] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const n = s.world.slotAt(ax, ay, az)!
      // -x, -y, -z are 17 away from (16, 16, 16) and out of reach; walk the head to the near side to reach them.
      const head = { x: HEAD.x + BigInt(ax < 0 ? -16 : 0), y: HEAD.y + BigInt(ay < 0 ? -16 : 0), z: HEAD.z + BigInt(az < 0 ? -16 : 0) }
      useCyberspace.setState({ cursor: head, position: head })
      await T().survey(n.key)
      expect(n.surveyed).toBe(true)
      useCyberspace.setState({ cursor: { ...HEAD }, position: { ...HEAD } })
    }
    expect(s.world.slotByKey(key)!.blocks).toEqual(before)
    expect(s.world.slotByKey(key)!.version).toBe(version)
    await T().exit()
    await settle()
    const db = await openTerrainDb()
    const kept = await readKept(db, A, [key])
    db.close()
    // Surveyed fresh, so at the revision new surveys write.
    const gen = generate(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0), null, groundWriteRevision()).blocks
    expect(applyLayer(gen, kept.layers[0].layer, groundWriteRevision())).toEqual(before)
  })

  it('follows you: walk on across chunks and the chunks round you are always there to survey', async () => {
    await T().enter()
    const s = terrainSession!
    for (let step = 1; step <= 4; step++) {
      const at = { ...HEAD, x: HEAD.x + BigInt(32 * step) }
      useCyberspace.setState({ cursor: at, position: at })
      await syncTerrain()
      const here = chunkKey(chunkOf(at.x, at.y, at.z, 0))
      expect(s.world.slotByKey(here)).not.toBeNull()
      await T().survey(here)
      expect(s.world.slotByKey(here)?.surveyed).toBe(true)
    }
  })
})

describe('mining and placing', () => {
  it('mining with the Compiler in hand keeps the Compiler: the held hammer stays (owner, 2026-11-27)', async () => {
    await openSurveyed()
    const s = terrainSession!
    useTerrain.setState({ inventory: withCompiler(T().inventory, 'made') })
    T().selectSlot(0)
    const [x, y, z] = solidCells(4000).find(([cx, cy, cz]) => cy > 0 && !(cx === 16 && cy === 16 && cz === 16))!
    expect(T().mine(hitAt(x, y, z))).toBe(true)
    const inv = T().inventory
    // TerrainView mounts the held Compiler while inventory.compiler is set, and shows it while slot 1 holds it.
    expect(inv.compiler).toBe('made')
    expect(inv.hotbar[0]).toBe(COMPILER_ID)
    expect(inv.slot).toBe(0)
    expect(Object.values(inv.counts).reduce((n, c) => n + c, 0)).toBeGreaterThan(0)
    void s
  })

  it('mining takes the block into the inventory and opens the cell; placing puts one back', async () => {
    await openSurveyed()
    const s = terrainSession!
    const [x, y, z] = solidCells(4000).find(([cx, cy, cz]) => cy > 0 && s.world.blockCs(cx, cy - 1, cz) !== EMPTY && !(cx === 16 && cy === 16 && cz === 16))!
    const id = s.world.blockCs(x, y, z)
    expect(T().mine(hitAt(x, y, z))).toBe(true)
    expect(s.world.blockCs(x, y, z)).toBe(EMPTY)
    expect(T().inventory.counts[id]).toBe(1)
    T().selectSlot(T().inventory.hotbar.indexOf(id))
    expect(T().place({ cell: [x, y - 1, z], normal: [0, 1, 0], distance: 1 })).toBe(true)
    expect(s.world.blockCs(x, y, z)).toBe(id)
    expect(T().inventory.counts[id]).toBeUndefined()
    expect(T().hint).toBe(2)
  })

  it('Tidewater and Magmaflow mine into the inventory and place back like any block (owner, 2026-11-28)', async () => {
    await openSurveyed()
    const s = terrainSession!
    const [x, y, z] = solidCells(4000).find(([cx, cy, cz]) => cy > 0 && s.world.blockCs(cx, cy - 1, cz) !== EMPTY && !(cx === 16 && cy === 16 && cz === 16))!
    expect(T().mine(hitAt(x, y, z))).toBe(true)
    for (const liquid of [11, 12]) {
      T().carry(liquid)
      T().selectSlot(T().inventory.hotbar.indexOf(liquid))
      expect(T().place({ cell: [x, y - 1, z], normal: [0, 1, 0], distance: 1 })).toBe(true)
      expect(s.world.blockCs(x, y, z)).toBe(liquid)
      expect(T().inventory.counts[liquid]).toBeUndefined()
      expect(T().mine(hitAt(x, y, z))).toBe(true)
      expect(s.world.blockCs(x, y, z)).toBe(EMPTY)
      expect(T().inventory.counts[liquid]).toBe(1)
    }
  })

  it('placing with nothing carried is refused, in words; never where you stand', async () => {
    await openSurveyed()
    const [c] = solidCells(1)
    expect(T().place(hitAt(...c))).toBe(false)
    expect(T().message).toMatch(/mine a block first/)
  })

  it('out of reach of where the walk has taken you, surveying, mining and placing are refused, in words', async () => {
    await openSurveyed()
    const s = terrainSession!
    // The head at (16, 16, 16): the -x neighbour's box is 17 away.
    expect(T().mine(hitAt(-5, 5, 5))).toBe(false)
    expect(T().message).toBe(OUT_OF_REACH)
    const west = s.world.slotAt(-1, 0, 0)!
    await T().survey(west.key)
    expect(west.surveyed).toBe(false)
    expect(T().message).toBe(OUT_OF_REACH)
    expect(T().place({ cell: [-5, 5, 5], normal: [1, 0, 0], distance: 1 })).toBe(false)
  })
})

describe('placing in open air (the ghost at arm\'s length)', () => {
  /** An open cell in the chunk you stand in with open space on all six sides, clear of your body. */
  function floatingCell(): [number, number, number] {
    const s = terrainSession!
    const open = (x: number, y: number, z: number): boolean => s.world.blockCs(x, y, z) === EMPTY
    for (let y = 30; y > 1; y--) for (let z = 2; z < 30; z++) for (let x = 2; x < 30; x++) {
      if (x === 16 && z === 16) continue
      if (open(x, y, z) && open(x - 1, y, z) && open(x + 1, y, z) && open(x, y - 1, z) && open(x, y + 1, z) && open(x, y, z - 1) && open(x, y, z + 1)) return [x, y, z]
    }
    throw new Error('no open air in the chunk')
  }

  /** Carry one block of the first kind mined, chosen. */
  function carryOne(): number {
    const s = terrainSession!
    const [c] = solidCells(1)
    const id = s.world.blockCs(...c)
    expect(T().mine(hitAt(...c))).toBe(true)
    T().selectSlot(T().inventory.hotbar.indexOf(id))
    return id
  }

  it('with no block hit, PLACE fills the ghost\'s cell, touching nothing, and keeps it as any placed block (the log, the inventory)', async () => {
    const key = await openSurveyed()
    const s = terrainSession!
    const id = carryOne()
    const cell = floatingCell()
    const waitingBefore = s.pending.get(key)?.length ?? 0
    expect(T().place(null, { cell, eye: [16, 17, 16] })).toBe(true)
    expect(s.world.blockCs(...cell)).toBe(id)
    expect(T().inventory.counts[id]).toBeUndefined()
    expect(T().tally.placed).toBeGreaterThan(0)
    // One change waiting in your layer, as a block placed on a face would be.
    expect((s.pending.get(key)?.length ?? 0)).toBe(waitingBefore + 1)
    // Kept on the device: back after a reload.
    await settle()
    reload()
    await openSurveyed()
    await settle()
    expect(terrainSession!.world.blockCs(...cell)).toBe(id)
  })

  it('a hit always comes first: the block goes on the face, not in the ghost\'s cell', async () => {
    await openSurveyed()
    const s = terrainSession!
    const [x, y, z] = solidCells(4000).find(([cx, cy, cz]) => cy > 0 && s.world.blockCs(cx, cy - 1, cz) !== EMPTY && !(cx === 16 && cy === 16 && cz === 16))!
    const id = s.world.blockCs(x, y, z)
    expect(T().mine(hitAt(x, y, z))).toBe(true)
    T().selectSlot(T().inventory.hotbar.indexOf(id))
    const air = floatingCell()
    expect(T().place({ cell: [x, y - 1, z], normal: [0, 1, 0], distance: 1 }, { cell: air, eye: null })).toBe(true)
    expect(s.world.blockCs(x, y, z)).toBe(id)
    expect(s.world.blockCs(...air)).toBe(EMPTY)
  })

  it('never into a block ("Something\'s already there") nor inside your body ("Too close to you"); nothing is spent', async () => {
    await openSurveyed()
    const id = carryOne()
    const [solid] = solidCells(1)
    expect(T().place(null, { cell: solid, eye: null })).toBe(false)
    expect(T().message).toBe("Something's already there")
    // Your body: the walk's gibson (16, 16, 16 here) and the cells up to the eye.
    expect(T().place(null, { cell: [16, 17, 16], eye: [16, 17.4, 16] })).toBe(false)
    expect(T().message).toBe('Too close to you')
    expect(T().place(null, { cell: [16, 16, 16], eye: null })).toBe(false)
    expect(T().message).toBe('Too close to you')
    expect(T().inventory.counts[id]).toBe(1)
  })

  it('out of reach of your avatar, refused in words as on a face', async () => {
    await openSurveyed()
    carryOne()
    expect(T().place(null, { cell: [-5, 5, 5], eye: null })).toBe(false)
    expect(T().message).toBe(OUT_OF_REACH)
  })

  it('the ghost reads refused for the same reasons, and asks only (nothing is surveyed or changed)', async () => {
    await openSurveyed()
    const s = terrainSession!
    const cell = floatingCell()
    expect(airRefusal(s, { cell, eye: null })).toBeNull()
    expect(airRefusal(s, { cell: solidCells(1)[0], eye: null })).toBe("Something's already there")
    expect(airRefusal(s, { cell: [16, 16, 16], eye: null })).toBe('Too close to you')
    expect(airRefusal(s, { cell: [-5, 5, 5], eye: null })).toBe(OUT_OF_REACH)
    const west = s.world.slotAt(-1, 0, 0)!
    expect(west.own ?? null).toBeNull()
    expect(s.world.blockCs(...cell)).toBe(EMPTY)
  })
})

describe('kept on the device, per identity, by chunk coordinate', () => {
  it('the op log survives a reload, and the inventory with it', async () => {
    await openSurveyed()
    const cells = solidCells(3)
    for (const c of cells) T().mine(hitAt(...c))
    const inv = T().inventory
    await settle()
    reload()
    await openSurveyed()
    await settle()
    for (const c of cells) expect(terrainSession!.world.blockCs(...c)).toBe(EMPTY)
    expect(T().inventory).toEqual(inv)
  })

  it('reappears after you leave, go far away and come back, in any mode', async () => {
    const key = await openSurveyed()
    const [c] = solidCells(1)
    T().mine(hitAt(...c))
    await T().exit()
    // Far away: the chunk is let go.
    const far = { ...HEAD, x: HEAD.x + 32n * 50n }
    useCyberspace.setState({ position: far, cursor: far })
    await syncTerrain()
    expect(terrainSession!.world.slotByKey(key)).toBeNull()
    // Back, outside TERRAIN: drawn again, with the change.
    useCyberspace.setState({ position: { ...HEAD }, cursor: { ...HEAD } })
    await syncTerrain()
    await settle()
    expect(terrainSession!.world.slotByKey(key)?.blocks).not.toBeNull()
    const off = c
    expect(terrainSession!.world.blockCs(...off)).toBe(EMPTY)
  })

  it('folds a chunk\'s log once it holds FOLD_AT changes', async () => {
    const key = await openSurveyed()
    for (const c of solidCells(FOLD_AT)) T().mine(hitAt(...c))
    await settle(80)
    expect(terrainSession!.pending.get(key)).toBeUndefined()
    const db = await openTerrainDb()
    const kept = await readKept(db, A, [key])
    db.close()
    expect(kept.ops).toHaveLength(0)
    expect(kept.layers.some((l) => l.chunk === key)).toBe(true)
  })

  it('another identity sees none of it, and switching back finds it all', async () => {
    await openSurveyed()
    const [c] = solidCells(1)
    const id = terrainSession!.world.blockCs(...c)
    T().mine(hitAt(...c))
    await T().exit()
    await settle()
    as(B)
    await T().enter()
    await settle()
    expect(T().inventory.counts).toEqual({})
    expect(terrainSession!.world.slotByKey(headKey())?.surveyed).toBe(false)
    await T().survey(headKey())
    expect(terrainSession!.world.blockCs(...c)).toBe(id)
    await T().exit()
    as(A)
    await syncTerrain()
    await settle()
    expect(terrainSession!.world.blockCs(...c)).toBe(EMPTY)
  })
})

describe('TERRAIN as the second button', () => {
  // Owner, 2026-11-24: "when I put terrain as the second mode and press it, the main mode button turns to hop even
  // when it wasnt hop before. it should remain what it was before."
  for (const start of ['walk', 'view', 'build'] as const) {
    it(`with the ring on ${start.toUpperCase()}: in and out by the second button, EXIT, T or Esc, back to ${start.toUpperCase()}, the ring's place kept`, async () => {
      // TERRAIN in the Toggle Mode slot, `start` the Default Mode, the rest of the ring after it.
      const order: ModeId[] = ['terrain', start, ...DEFAULT_MODES.order.filter((m) => m !== start && m !== 'terrain')]
      updateModes((): ModeSettings => ({ order, off: [] }))
      const stop = watchLastRing()
      try {
        expect(modeRoles().second).toBe('terrain')
        switchMode(start)
        await settle(50)
        expect(currentPadMode()).toBe(start)
        useModes.setState({ back: null, lastRing: start })
        // In by the second button: the way back, and the last ring mode, stay the mode it was pressed from.
        pressSecond()
        await settle(50)
        expect(currentPadMode()).toBe('terrain')
        expect(backOf('terrain')).toBe(start)
        expect(useModes.getState().lastRing).toBe(start)
        // Out by the lit second button.
        pressSecond()
        await settle(50)
        expect(currentPadMode()).toBe(start)
        // In again, out by EXIT, T or Esc (all leaveTerrain).
        pressSecond()
        await settle(50)
        expect(currentPadMode()).toBe('terrain')
        leaveTerrain()
        await settle(50)
        expect(currentPadMode()).toBe(start)
        expect(useModes.getState().lastRing).toBe(start)
      } finally {
        stop()
        switchMode('hop')
        resetModes()
      }
    })
  }
})
