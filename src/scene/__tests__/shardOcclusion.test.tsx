/**
 * shardOcclusion.test.tsx - a shard hidden behind blocks takes no tap, in
 * every mode, and in TERRAIN the block in front is mined instead (owner,
 * 2026-11-26: "i frequently click a shard when working in terrain mode - the
 * shard is completely obscured by many layers of blocks, yet I trigger it
 * accidentally").
 *
 * Driven on R3F's own click path (test/r3fRoot.ts) with the real blocks
 * layer (TerrainLayer: its TapOccluder and TERRAIN's marks) over a real
 * field of blocks: a slab three blocks thick across the view, the camera in
 * front of it, shards behind it and in front of it on the same line of sight.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, useRef, type RefObject } from 'react'
import { Matrix4, PerspectiveCamera, Ray, Raycaster, Vector2, Vector3, type Group } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { TapTarget } from '../TapTarget'
import { TerrainLayer, blockOcclusion, fieldMatrix } from '../TerrainLayer'
import { useCyberspace } from '../../store/useCyberspace'
import { setTerrainSession, useTerrain, type TerrainSession } from '../../store/useTerrain'
import { commitAnchor, commitScale } from '../../lib/renderFrame'
import { TerrainWorld } from '../../lib/terrain/world'
import { idx } from '../../lib/terrain/coords'
import { raycast } from '../../lib/terrain/raycast'
import { terrainInput } from '../../terrain/terrainInput'
import { terrainPointer } from '../../terrain/TerrainView'
import type { ViewAxes } from '../../lib/space'
import { sceneEvents } from '../sceneEvents'
import type { RayHit } from '../../lib/terrain/raycast'

// The chunks are meshed in a worker the tests have none of: never meshed, which the taps do not need.
vi.mock('../../lib/terrain/blocksClient', () => ({ meshChunkAsync: () => new Promise(() => {}) }))
vi.mock('../../store/terrainShare', async (real) => ({ ...(await real<object>()), sceneDraws: () => {}, aimAt: () => 'ground' }))

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
const ORIGIN = { x: 0x1000000n, y: 0x2000000n, z: 0x3000000n, plane: 0 }
// The anchor at the chunk's middle: the cell (16, 16, 16) is centred on render 0, so a cell d spans d - 16.5 to d - 15.5.
const ANCHOR = { x: ORIGIN.x + 16n, y: ORIGIN.y + 16n, z: ORIGIN.z + 16n, plane: 0 }
/** The slab: cells z 13 to 15, render z -3.5 to -0.5, across the whole chunk. The camera stands at z 10. */
const SLAB = [13, 15] as const
const FRONT_FACE = -0.5
const CENTRE = 400

function session(): TerrainSession {
  const world = new TerrainWorld(ORIGIN, AXES)
  const slot = world.slotAt(0, 0, 0, true)!
  const blocks = new Uint8Array(32 * 32 * 32)
  for (let x = 0; x < 32; x++) for (let y = 0; y < 32; y++) for (let z = SLAB[0]; z <= SLAB[1]; z++) blocks[idx(x, y, z)] = 1
  slot.blocks = blocks
  slot.own = blocks
  slot.surveyed = true
  // The identity on screen's own field, so turning TERRAIN on keeps it (store/useTerrain.ts syncTerrain makes a new one for anyone else).
  const owner = useCyberspace.getState().identity.pubkey || 'local'
  return { owner, plane: 0, world, pending: new Map(), layers: new Map(), surveyedKeys: new Set(), unreadable: new Set(), building: new Set(), nextSeq: 0, db: null } as unknown as TerrainSession
}

const taps = { buried: vi.fn(), exposed: vi.fn(), wide: vi.fn(), me: vi.fn() }

/** A 2-unit box at render (0, 0, z) and its tap target, as a world shard draws one. */
function Shard({ z, onTap, yields }: { z: number; onTap: () => void; yields?: boolean }): JSX.Element {
  const drawn = useRef<Group>(null)
  return createElement('group', { position: [0, 0, z] },
    createElement('group', { ref: drawn }, createElement('mesh', null, createElement('boxGeometry', { args: [2, 2, 2] }), createElement('meshBasicMaterial'))),
    createElement(TapTarget, { measure: drawn as RefObject<Group>, onTap, yields }))
}

/**
 * A wide shard whose box reaches in front of the blocks but whose faces on
 * the line of sight lie behind them: a post off to the side, in front, and a
 * panel behind the slab. R3F meets its box first; what it draws is hidden.
 */
function WideShard({ onTap }: { onTap: () => void }): JSX.Element {
  const drawn = useRef<Group>(null)
  return createElement('group', null,
    createElement('group', { ref: drawn },
      createElement('mesh', { position: [3, 0, 4] }, createElement('boxGeometry', { args: [0.5, 0.5, 0.5] }), createElement('meshBasicMaterial')),
      createElement('mesh', { position: [0, 0, -8] }, createElement('boxGeometry', { args: [4, 4, 0.5] }), createElement('meshBasicMaterial'))),
    createElement(TapTarget, { measure: drawn as RefObject<Group>, onTap }))
}

let r: R3fRoot
let field: TerrainSession

/** The blocks of the field on screen. */
function fieldBlocks(): Uint8Array {
  return field.world.slotAt(0, 0, 0)!.blocks!
}

async function mount(...children: JSX.Element[]): Promise<void> {
  r = await r3fRoot()
  await r.render(createElement('group', null, createElement(TerrainLayer, { axes: AXES }), ...children))
  await r.frame()
}

beforeEach(() => {
  for (const f of Object.values(taps)) f.mockClear()
  useCyberspace.setState({ anchor: ANCHOR, position: ANCHOR, cursor: ANCHOR, scaleExp: 0, plane: 0, walking: false })
  commitAnchor(ANCHOR)
  commitScale(0)
  field = session()
  setTerrainSession(field)
  terrainInput.action = null
  terrainInput.hover = null
  terrainInput.swallowTap = false
})

afterEach(async () => {
  await r?.unmount()
  setTerrainSession(null)
  useTerrain.setState({ active: false })
})

describe('the blocks layer as a field', () => {
  it("puts the slab's near face where the test says it is", () => {
    const at = new Vector3(0, 0, SLAB[1] + 1).applyMatrix4(fieldMatrix(session(), AXES, 0, new Matrix4()))
    expect(at.z).toBeCloseTo(FRONT_FACE)
  })
})

describe('blockOcclusion: how far along a ray the first block that hides what is behind it lies', () => {
  const ray = (z: number): Ray => new Ray(new Vector3(0, 0, z), new Vector3(0, 0, -1))

  it('is the slab\'s near face, from in front of it', () => {
    expect(blockOcclusion(session(), AXES, ray(10))).toBeCloseTo(10 - FRONT_FACE)
  })

  it('is nothing looking away from the blocks, on another plane, or zoomed past where blocks are drawn', () => {
    const s = session()
    expect(blockOcclusion(s, AXES, new Ray(new Vector3(0, 0, 10), new Vector3(0, 0, 1)))).toBeNull()
    useCyberspace.setState({ plane: 1 })
    expect(blockOcclusion(s, AXES, ray(10))).toBeNull()
    useCyberspace.setState({ plane: 0 })
    commitScale(7)
    expect(blockOcclusion(s, AXES, ray(10))).toBeNull()
  })

  it('from inside the slab, is not the mass the eye stands in (nothing of it is seen from within)', () => {
    expect(blockOcclusion(session(), AXES, ray(-2))).toBeNull()
  })

  it('still hides from far off, zoomed out (the walk reaches from where the ray enters the blocks, not from the eye)', () => {
    commitScale(4)
    const s = session()
    const face = new Vector3(16, 16, SLAB[1] + 1).applyMatrix4(fieldMatrix(s, AXES, 4, new Matrix4()))
    const far = new Ray(new Vector3(face.x, face.y, face.z + 70), new Vector3(0, 0, -1))
    expect(blockOcclusion(s, AXES, far)).toBeCloseTo(70)
  })

  it('is nothing with no blocks held', () => {
    expect(blockOcclusion(null, AXES, ray(10))).toBeNull()
  })
})

describe('raycast skipping the block it starts in', () => {
  // A column of solid cells z 0 to 2, then open, then solid again at z 5.
  const solid = (_i: number, _j: number, k: number): boolean => (k >= 0 && k <= 2) || k === 5
  it("the cursor's way takes the block it starts in, at distance 0", () => {
    expect(raycast([0, 0, 1], [0, 0, 1], 10, solid)?.distance).toBe(0)
  })
  it('skipping walks out of it and takes the next block after open space', () => {
    const hit = raycast([0, 0, 1], [0, 0, 1], 10, solid, 'skip') as RayHit
    expect(hit.cell).toEqual([0, 0, 5])
    expect(hit.distance).toBeCloseTo(3.5)
  })
  it('reaches as far as it is asked, past the cursor\'s 64 steps', () => {
    const far = (_i: number, _j: number, k: number): boolean => k === 200
    expect(raycast([0, 0, 0], [1, 1, 1], 400, far)?.cell[2]).toBe(200)
  })
})

describe.each([
  ['HOP', { walking: false }, false],
  ['WALK', { walking: true }, false],
  ['TERRAIN', { walking: true }, true],
] as const)('in %s', (_mode, view, terrain) => {
  beforeEach(() => {
    useCyberspace.setState(view)
    useTerrain.setState({ active: terrain, sheet: false })
  })

  it('a shard behind the blocks takes no tap', async () => {
    await mount(createElement(Shard, { z: -8, onTap: taps.buried }))
    await r.tap(CENTRE, CENTRE)
    expect(taps.buried).not.toHaveBeenCalled()
  })

  it('a shard in front of the blocks takes the tap', async () => {
    await mount(createElement(Shard, { z: 4, onTap: taps.exposed }), createElement(Shard, { z: -8, onTap: taps.buried }))
    await r.tap(CENTRE, CENTRE)
    expect(taps.exposed).toHaveBeenCalledTimes(1)
    expect(taps.buried).not.toHaveBeenCalled()
  })

  it('a wide shard whose box is met before the blocks, but whose faces there are behind them, takes no tap', async () => {
    await mount(createElement(WideShard, { onTap: taps.wide }))
    await r.tap(CENTRE, CENTRE)
    expect(taps.wide).not.toHaveBeenCalled()
  })
})

/** A coin's or a message's mark: a fixed fingertip target at render (0, 0, z). */
function Mark({ z, onTap }: { z: number; onTap: () => void }): JSX.Element {
  return createElement(TapTarget, { px: 28, at: [0, 0, z], onTap })
}

describe('a mark (a coin, a message) behind the blocks', () => {
  it('does not take the tap from a shard in front of the blocks', async () => {
    const mark = vi.fn()
    await mount(createElement(Shard, { z: 4, onTap: taps.exposed }), createElement(Mark, { z: -8, onTap: mark }))
    await r.tap(CENTRE, CENTRE)
    expect(taps.exposed).toHaveBeenCalledTimes(1)
    expect(mark).not.toHaveBeenCalled()
  })
})

describe('a shard flush in front of the blocks, the camera backing off during the tap', () => {
  it('still opens: the blocks met at the press are measured again from where the eye is at the click', async () => {
    await mount(createElement(Shard, { z: 0.6, onTap: taps.exposed }))
    await r.pointer('pointerdown', CENTRE, CENTRE)
    r.state().camera.position.set(0, 0, 13)
    r.state().camera.updateMatrixWorld()
    await r.frame()
    await r.pointer('pointerup', CENTRE, CENTRE)
    await r.pointer('click', CENTRE, CENTRE)
    expect(taps.exposed).toHaveBeenCalledTimes(1)
  })
})

describe('your own avatar, which takes a tap only when nothing else wants it', () => {
  it('outside TERRAIN, a shard the blocks hide behind it wants nothing either: it takes the tap', async () => {
    await mount(createElement(Shard, { z: 4, onTap: taps.me, yields: true }), createElement(Shard, { z: -8, onTap: taps.buried }))
    await r.tap(CENTRE, CENTRE)
    expect(taps.me).toHaveBeenCalledTimes(1)
    expect(taps.buried).not.toHaveBeenCalled()
  })

  it('outside TERRAIN, blocks behind it want nothing: it takes the tap', async () => {
    await mount(createElement(Shard, { z: 4, onTap: taps.me, yields: true }))
    await r.tap(CENTRE, CENTRE)
    expect(taps.me).toHaveBeenCalledTimes(1)
  })

  it('in TERRAIN, a tap there mines the block behind it: it gives the tap way', async () => {
    useTerrain.setState({ active: true, sheet: false })
    await mount(createElement(Shard, { z: 4, onTap: taps.me, yields: true }))
    await r.tap(CENTRE, CENTRE)
    expect(taps.me).not.toHaveBeenCalled()
  })
})

/** A stand-in for the scene's canvas, the size of the R3F root, for TERRAIN's own pointer. */
class FakeCanvas extends EventTarget {
  tagName = 'CANVAS'
  closest(): null { return null }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } { return { left: 0, top: 0, width: 800, height: 800 } }
}

function touch(on: EventTarget, type: string, x: number, y: number, pointerType = 'touch'): void {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(e, { pointerId: 1, pointerType, button: 0, clientX: x, clientY: y, movementX: 0, movementY: 0 })
  on.dispatchEvent(e)
}

describe('in TERRAIN, a tap (touch) on blocks with a shard buried behind them', () => {
  let mined: ReturnType<typeof vi.fn>
  let canvas: FakeCanvas
  let stop: () => void
  beforeEach(() => {
    mined = vi.fn(() => true)
    useCyberspace.setState({ walking: true })
    useTerrain.setState({ active: true, sheet: false, mine: mined as never })
    canvas = new FakeCanvas()
    stop = terrainPointer(canvas)
  })
  afterEach(() => { stop() })

  /** Mounted with the camera within TERRAIN's reach of the slab (CURSOR_REACH, 5 blocks): 4.5 from its face. */
  async function mountNear(...children: JSX.Element[]): Promise<void> {
    await mount(...children)
    r.state().camera.position.set(0, 0, 4)
    r.state().camera.updateMatrixWorld()
    await r.frame()
  }

  /** A finger's tap as the app hears it: TERRAIN's pointer on the window, then R3F's on the canvas, then a frame. */
  async function tapBoth(): Promise<void> {
    touch(canvas, 'pointerdown', CENTRE, CENTRE)
    await r.pointer('pointerdown', CENTRE, CENTRE)
    touch(canvas, 'pointerup', CENTRE, CENTRE)
    await r.pointer('pointerup', CENTRE, CENTRE)
    await r.pointer('click', CENTRE, CENTRE)
    await r.frame()
  }

  it('mines the block in front and never opens the shard', async () => {
    await mountNear(createElement(Shard, { z: -8, onTap: taps.buried }))
    await tapBoth()
    expect(taps.buried).not.toHaveBeenCalled()
    expect(mined).toHaveBeenCalledTimes(1)
    const hit = mined.mock.calls[0][0] as RayHit
    expect(hit.cell[2]).toBe(SLAB[1])
  })

  it('a shard in front of the blocks opens, and the block behind it is not mined', async () => {
    await mountNear(createElement(Shard, { z: 1.5, onTap: taps.exposed }))
    await tapBoth()
    expect(taps.exposed).toHaveBeenCalledTimes(1)
    expect(mined).toHaveBeenCalledTimes(1)
    expect(mined.mock.calls[0][0]).toBeNull()
  })

  it('the mouse captured: the press that mines the last block in front does not open the shard behind it at the click', async () => {
    await mountNear(createElement(Shard, { z: -8, onTap: taps.buried }))
    // The press (mined at the press with the mouse captured), the block gone before the release and the click.
    await r.pointer('pointerdown', CENTRE, CENTRE)
    const blocks = fieldBlocks()
    blocks.fill(0)
    await r.frame()
    await r.pointer('pointerup', CENTRE, CENTRE)
    await r.pointer('click', CENTRE, CENTRE)
    expect(taps.buried).not.toHaveBeenCalled()
    // And the next tap, with no blocks left in front, opens it.
    await r.tap(CENTRE, CENTRE)
    expect(taps.buried).toHaveBeenCalledTimes(1)
  })

  it('the click that captures the mouse again does nothing else: a shard in plain view stays shut', async () => {
    await mount(createElement(Shard, { z: 4, onTap: taps.exposed }))
    terrainInput.swallowTap = true
    await r.tap(CENTRE, CENTRE)
    expect(taps.exposed).not.toHaveBeenCalled()
  })
})

describe('a shard in a pool (owner, 2026-11-28: liquids can be aimed at and mined)', () => {
  const TIDEWATER = 11
  /** The slab made Tidewater, a shard standing in it. */
  function flood(): void {
    const blocks = fieldBlocks()
    for (let i = 0; i < blocks.length; i++) if (blocks[i]) blocks[i] = TIDEWATER
  }
  const ray = (z: number): Ray => new Ray(new Vector3(0, 0, z), new Vector3(0, 0, -1))

  it('blockOcclusion: in TERRAIN the water hides what is in it, as the cursor takes it; elsewhere it hides nothing', () => {
    flood()
    useTerrain.setState({ active: true, sheet: false })
    expect(blockOcclusion(field, AXES, ray(10))).toBeCloseTo(10 - FRONT_FACE)
    useTerrain.setState({ active: false })
    expect(blockOcclusion(field, AXES, ray(10))).toBeNull()
  })

  it('outside TERRAIN, a shard in the water takes the tap', async () => {
    useCyberspace.setState({ walking: true })
    await mount(createElement(Shard, { z: -2, onTap: taps.buried }))
    flood()
    await r.frame()
    await r.tap(CENTRE, CENTRE)
    expect(taps.buried).toHaveBeenCalledTimes(1)
  })

  describe('in TERRAIN, a tap (touch)', () => {
    let mined: ReturnType<typeof vi.fn>
    let canvas: FakeCanvas
    let stop: () => void
    beforeEach(() => {
      mined = vi.fn(() => true)
      useCyberspace.setState({ walking: true })
      useTerrain.setState({ active: true, sheet: false, mine: mined as never })
      canvas = new FakeCanvas()
      stop = terrainPointer(canvas)
    })
    afterEach(() => { stop() })

    it('mines the water in front and never also opens the shard in it: the nearest thing takes the tap', async () => {
      await mount(createElement(Shard, { z: -2, onTap: taps.buried }))
      flood()
      r.state().camera.position.set(0, 0, 4)
      r.state().camera.updateMatrixWorld()
      await r.frame()
      touch(canvas, 'pointerdown', CENTRE, CENTRE)
      await r.pointer('pointerdown', CENTRE, CENTRE)
      touch(canvas, 'pointerup', CENTRE, CENTRE)
      await r.pointer('pointerup', CENTRE, CENTRE)
      await r.pointer('click', CENTRE, CENTRE)
      await r.frame()
      expect(taps.buried).not.toHaveBeenCalled()
      expect(mined).toHaveBeenCalledTimes(1)
      expect((mined.mock.calls[0][0] as RayHit).cell[2]).toBe(SLAB[1])
    })
  })
})

describe("the scene's pointer while the mouse is captured", () => {
  /** R3F's compute, given an event at the canvas's top left corner, with the mouse captured by `locked` or not. */
  function pointerAt(locked: unknown, canvas: unknown): Vector2 {
    const state = { pointer: new Vector2(), raycaster: new Raycaster(), camera: new PerspectiveCamera(), size: { width: 800, height: 800 }, gl: { domElement: canvas } }
    const was = (globalThis as { document?: unknown }).document
    ;(globalThis as { document?: unknown }).document = { pointerLockElement: locked }
    try {
      sceneEvents({ getState: () => state } as never).compute?.({ offsetX: 0, offsetY: 0 } as never, state as never)
    } finally {
      ;(globalThis as { document?: unknown }).document = was
    }
    return state.pointer
  }

  it('is cast from the cross at the centre, not where the pointer stood when it was captured', () => {
    const canvas = {}
    expect(pointerAt(canvas, canvas).toArray()).toEqual([0, 0])
  })

  it('is where the pointer is otherwise', () => {
    expect(pointerAt(null, {}).toArray()).toEqual([-1, 1])
  })
})
