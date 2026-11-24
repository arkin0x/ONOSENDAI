/**
 * terrain.test.ts - TERRAIN mode's rules (store/useTerrain.ts): SURVEY fills
 * a chunk, mining and placing change it and the inventory, both are refused
 * out of reach in plain words, and everything is kept on the device per
 * identity in IndexedDB: the op log survives a reload, folds into a layer at
 * FOLD_AT, and one identity never sees another's.
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

import { Quaternion, Vector3 } from 'three'
import { useCyberspace } from '../useCyberspace'
import { useBuilder } from '../useBuilder'
import { OUT_OF_REACH, enterTerrain, setTerrainSession, terrainSession, useTerrain } from '../useTerrain'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import { FOLD_AT, openTerrainDb, readKept } from '../../lib/terrain/terrainDb'
import { applyLayer } from '../../lib/terrain/layer'
import { generate } from '../../lib/terrain/generate'
import { EMPTY } from '../../lib/terrain/blocks'
import type { RayHit } from '../../lib/terrain/raycast'

/** A fresh identity for every test, so nothing one test kept is read by the next. */
let run = 0
let A = ''
let B = ''
const HEAD = { x: 0x1234567890abcdef12350n, y: 0xfedcba0987654321fed90n, z: 0x0f0f0f0f0f0f0f0f0f0f0n }
const T = () => useTerrain.getState()
const settle = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))

function as(pubkey: string): void {
  useCyberspace.setState({ identity: { pubkey, npub: '' }, position: { ...HEAD }, plane: 0 })
}

/** A hit on the block at cs offsets from the head chunk's corner, its top face toward the view's up. */
function hitAt(dx: number, dy: number, dz: number): RayHit {
  const s = terrainSession!
  return { cell: s.world.toView(dx, dy, dz), normal: [0, 1, 0], distance: 1 }
}

/** Solid cells of the head chunk, as cs offsets, the first `n`. */
function solidCells(n: number): Array<[number, number, number]> {
  const s = terrainSession!
  const out: Array<[number, number, number]> = []
  for (let y = 0; y < 32 && out.length < n; y++) for (let z = 0; z < 32 && out.length < n; z++) for (let x = 0; x < 32 && out.length < n; x++) {
    if (s.world.blockCs(x, y, z) !== EMPTY) out.push([x, y, z])
  }
  return out
}

async function openSurveyed(): Promise<string> {
  await T().enter()
  const key = chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))
  if (!T().surveyed.includes(key)) await T().survey(key)
  return key
}

/** Gone as a reload leaves it: no exit, nothing folded. */
function reload(): void {
  setTerrainSession(null)
  useTerrain.setState({ active: false, loading: false })
}

beforeEach(async () => {
  if (T().active) await T().exit()
  reload()
  run++
  A = run.toString(16).padStart(64, 'a')
  B = run.toString(16).padStart(64, 'b')
  as(A)
})

describe('entering', () => {
  it('opens from BUILD only', () => {
    useBuilder.setState({ active: false })
    expect(enterTerrain()).toBe(false)
    expect(T().active).toBe(false)
  })
})

describe('SURVEY', () => {
  it('fills the chunk with the ground everyone generates the same', async () => {
    await T().enter()
    const key = chunkKey(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0))
    const s = terrainSession!
    expect(s.world.slotByKey(key)?.blocks).toBeNull()
    await T().survey(key)
    const gen = generate(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0)).blocks
    expect(s.world.slotByKey(key)?.blocks).toEqual(gen)
    expect(T().surveyed).toContain(key)
  })
})

describe('mining and placing', () => {
  it('mining takes the block into the inventory and opens the cell; placing puts one back', async () => {
    await openSurveyed()
    const s = terrainSession!
    // A block with another under it, so the hole it leaves has a face to place on.
    const [x, y, z] = solidCells(4000).find(([cx, cy, cz]) => cy > 0 && s.world.blockCs(cx, cy - 1, cz) !== EMPTY)!
    const id = s.world.blockCs(x, y, z)
    expect(T().mine(hitAt(x, y, z))).toBe(true)
    expect(s.world.blockCs(x, y, z)).toBe(EMPTY)
    expect(T().inventory.counts[id]).toBe(1)
    expect(T().inventory.hotbar).toContain(id)
    expect(T().hint).toBe(1)
    // Placed on the face of a solid block below the hole: into the hole.
    T().selectSlot(T().inventory.hotbar.indexOf(id))
    // The face of the block below that looks into the hole (cs +y), in the view's frame.
    const up = s.world.toView(0, 1, 0)
    const hit: RayHit = { cell: s.world.toView(x, y - 1, z), normal: [Math.sign(up[0]), Math.sign(up[1]), Math.sign(up[2])], distance: 1 }
    s.body.y = 1000 // well away, so the body never stands in the way
    expect(T().place(hit)).toBe(true)
    expect(s.world.blockCs(x, y, z)).toBe(id)
    expect(T().inventory.counts[id]).toBeUndefined()
    expect(T().hint).toBe(2)
  })

  it('placing with nothing carried is refused, in words', async () => {
    await openSurveyed()
    const [[x, y, z]] = solidCells(1)
    expect(T().place(hitAt(x, y, z))).toBe(false)
    expect(T().message).toMatch(/mine a block first/)
  })

  it('out of reach of your chain, surveying, mining and placing are refused, in words, and nothing changes', async () => {
    await openSurveyed()
    const s = terrainSession!
    // The head stands at (16, 16, 16) of its chunk: the +x neighbour's box is 16 away (in reach), the -x one's 17 (out).
    expect(T().mine(hitAt(-5, 5, 5))).toBe(false)
    expect(T().message).toBe(OUT_OF_REACH)
    const west = s.world.slotAtCs(-5, 5, 5)!
    await T().survey(west.key)
    expect(west.surveyed).toBe(false)
    expect(T().message).toBe(OUT_OF_REACH)
    // The +x neighbour, the far side of it included, is in reach: the reach rule counts whole chunks (DECK-0009 §6.2).
    const east = s.world.slotAtCs(40, 5, 5)!
    await T().survey(east.key)
    expect(east.surveyed).toBe(true)
    let found: [number, number, number] | null = null
    for (let x = 63; x >= 32 && !found; x--) for (let y = 0; y < 32 && !found; y++) if (s.world.blockCs(x, y, 5) !== EMPTY) found = [x, y, 5]
    expect(found).not.toBeNull()
    expect(T().mine(hitAt(...found!))).toBe(true)
    // Placing out of reach: a carried block, a face in the -x neighbour, refused in the same words.
    T().selectSlot(T().inventory.hotbar.findIndex((h) => h !== 0))
    s.body.y = 1000
    expect(T().place({ cell: s.world.toView(-5, 5, 5), normal: s.world.toView(1, 0, 0) as [number, number, number], distance: 1 })).toBe(false)
    expect(T().message).toBe(OUT_OF_REACH)
  })
})

describe('which way is up', () => {
  it('in a view turned on its side, TERRAIN still stands on cyberspace +Y, so the body falls along -Y', async () => {
    const before = useCyberspace.getState().view
    useCyberspace.setState({ view: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2) })
    try {
      expect(useCyberspace.getState().axes().up.axis).not.toBe('y')
      await T().enter()
      const s = terrainSession!
      expect(s.world.axes.up).toEqual({ axis: 'y', dir: 1 })
      // The view's +Y (up on screen) is cyberspace +Y.
      expect(s.world.toView(0, 1, 0).map((v) => v + 0)).toEqual([0, 1, 0])
    } finally {
      await T().exit()
      useCyberspace.setState({ view: before })
    }
  })
})

describe('opening and closing', () => {
  it('opens from BUILD at your own head', async () => {
    useBuilder.setState({ active: true })
    expect(enterTerrain()).toBe(true)
    expect(T().active).toBe(true)
    await settle(50)
  })

  it('closes when BUILD ends, and when the identity changes', async () => {
    useBuilder.setState({ active: true })
    await T().enter()
    useBuilder.setState({ active: false })
    await settle()
    expect(T().active).toBe(false)
    expect(terrainSession).toBeNull()
    useBuilder.setState({ active: true })
    await T().enter()
    as(B)
    await settle()
    expect(T().active).toBe(false)
  })

  it('a leave while it is still loading keeps what was saved', async () => {
    await openSurveyed()
    const [c] = solidCells(1)
    T().mine(hitAt(...c))
    const inv = T().inventory
    await T().exit()
    await settle()
    // Leave at once, before what was kept is read.
    const opening = T().enter()
    await T().exit()
    await opening
    await settle()
    await openSurveyed()
    expect(T().inventory).toEqual(inv)
  })
})

describe('kept on the device, per identity', () => {
  it('the op log survives a reload, and the inventory with it', async () => {
    await openSurveyed()
    const cells = solidCells(3)
    for (const c of cells) T().mine(hitAt(...c))
    const inv = T().inventory
    await settle()
    reload()
    await openSurveyed()
    for (const c of cells) expect(terrainSession!.world.blockCs(...c)).toBe(EMPTY)
    expect(T().inventory).toEqual(inv)
  })

  it('leaving folds the log into a layer, the diff from the generated ground, and the changes stand', async () => {
    const key = await openSurveyed()
    const cells = solidCells(4)
    for (const c of cells) T().mine(hitAt(...c))
    const blocks = terrainSession!.world.slotByKey(key)!.blocks!.slice()
    await T().exit()
    await settle()
    const db = await openTerrainDb()
    const kept = await readKept(db, A, [key])
    db.close()
    expect(kept.ops.filter((o) => o.chunk === key)).toHaveLength(0)
    const layer = kept.layers.find((l) => l.chunk === key)!.layer
    expect(layer.form).toBe('diff')
    expect(applyLayer(generate(chunkOf(HEAD.x, HEAD.y, HEAD.z, 0)).blocks, layer)).toEqual(blocks)
    await openSurveyed()
    expect(terrainSession!.world.slotByKey(key)!.blocks).toEqual(blocks)
  })

  it('folds a chunk\'s log once it holds FOLD_AT changes', async () => {
    const key = await openSurveyed()
    for (const c of solidCells(FOLD_AT)) T().mine(hitAt(...c))
    await settle(80)
    expect(terrainSession!.pending.get(key)).toBeUndefined()
    const db = await openTerrainDb()
    const kept = await readKept(db, A, [key])
    db.close()
    expect(kept.ops.filter((o) => o.chunk === key)).toHaveLength(0)
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
    expect(T().surveyed).toEqual([])
    expect(T().inventory.counts).toEqual({})
    await T().survey(terrainSession!.world.slotAtCs(...c)!.key)
    expect(terrainSession!.world.blockCs(...c)).toBe(id)
    await T().exit()
    as(A)
    await openSurveyed()
    expect(terrainSession!.world.blockCs(...c)).toBe(EMPTY)
  })
})
