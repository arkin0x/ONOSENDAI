/**
 * heldItems.test.tsx: how the world draws an item you hold (arkinox,
 * 2026-11-06, which replaces the solid blue box of 2026-11-01).
 *
 *  - Made by you and held: its model at half opacity, in motion as ever,
 *    inside the note's blue box at half.
 *  - Taken from someone else: its model at half opacity, in motion, no box.
 *  - Not held (yours placed and not picked up included): the whole model in
 *    motion, its outline and its name, exactly as before.
 *  - Held with its model loading or missing: the box at half alone, no name.
 */
import { describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera, Euler, Vector3 } from 'three'

const frames: Array<(state: unknown) => void> = []
const model = vi.hoisted(() => ({
  loaded: null as unknown,
}))

vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: (cb: (state: unknown) => void) => { frames.push(cb) },
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {} }),
}))
vi.mock('../TapTarget', async (real) => ({ ...(await real<object>()), TapTarget: () => null }))
vi.mock('../WorldLabel', async (real) => {
  const { createElement } = await import('react')
  return { ...(await real<object>()), WorldLabel: (props: object) => createElement('worldlabel', props) }
})
// The model is a host element here, so a test reads what it is handed.
vi.mock('../ShardMesh', async () => {
  const { createElement } = await import('react')
  return { CUBE_EDGES: 'model-outline', ShardMesh: (props: object) => createElement('shardmesh', props) }
})
vi.mock('../../hooks/useItemModel', () => ({ useItemModel: () => model.loaded }))

import { createElement } from 'react'
import type { ItemAnimation } from '../../lib/itemModel'
import type { ViewAxes } from '../../lib/space'
import { mount, type Host, type Mounted } from '../../test/elementRoot'
import { HELD_OPACITY } from '../../lib/worldMarks'
import { TRANSLUCENT_ORDER } from '../shardFaces'
import { HeldItemMark, ItemMark } from '../WorldMessages'
import { useCyberspace } from '../../store/useCyberspace'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const AT: [number, number, number] = [0, 0, 0]
const MOTION: readonly ItemAnimation[] = ['bob', 'spin-y', 'spin-x']
const WEARS = { model: { address: '33331:aa:key' }, animation: MOTION }
/** A key a gibson long, at unit 0: the Silver Key's size. */
const LOADED = {
  shard: { unit: 0 },
  extent: { centre: [0, 0, 0], half: [0.5, 0.25, 0.1], aroundY: 0.5, aroundX: 0.27, radius: 0.57 },
}

const of = (m: Mounted, type: string): Host[] => m.all().filter((h) => h.type === type)
const outline = (m: Mounted): Host[] => of(m, 'lineSegments').filter((h) => h.props.geometry === 'model-outline')
/** The box's faces: the one mesh of the note's blue box. */
const boxFill = (m: Mounted): Host[] => of(m, 'mesh')

async function draw(el: Parameters<typeof mount>[0], loaded: unknown = LOADED): Promise<Mounted> {
  useCyberspace.setState({ scaleExp: 0 })
  model.loaded = loaded
  frames.length = 0
  return mount(el)
}

/**
 * Run every frame at `seconds` and read each group's lift and turns, as three
 * would have them: the records stand in for three's objects, given what a
 * frame writes.
 */
function poseAt(m: Mounted, seconds: number): string[] {
  const groups = of(m, 'group').map((h) => {
    const o = h as Host & { position?: Vector3; rotation?: Euler; scale?: Vector3 }
    o.position ??= new Vector3()
    o.rotation ??= new Euler()
    o.scale ??= new Vector3(1, 1, 1)
    return o as Host & { position: Vector3; rotation: Euler }
  })
  const camera = new PerspectiveCamera(50, 0.5, 0.01, 1000)
  camera.position.set(0, 0, 3)
  for (const f of frames) f({ clock: { elapsedTime: seconds }, camera, size: { width: 400, height: 800 } })
  return groups.map((g) => [g.position.y, g.rotation.y, g.rotation.x].map((n) => n.toFixed(6)).join(','))
}

/** Whether the model moves: some group lifts or turns between two moments. */
function moves(m: Mounted): { lifts: boolean; turns: boolean } {
  const a = poseAt(m, 0.3).map((p) => p.split(','))
  const b = poseAt(m, 1.1).map((p) => p.split(','))
  return {
    lifts: a.some((p, i) => p[0] !== b[i][0]),
    turns: a.some((p, i) => p[1] !== b[i][1] || p[2] !== b[i][2]),
  }
}

describe('an item you made and hold', () => {
  it('is its model at half, in motion, inside the blue box at half, with no name and no outline of its own', async () => {
    const m = await draw(createElement(HeldItemMark, { id: 'k', own: true, at: AT, wears: WEARS, axes: AXES }))
    const [mesh] = of(m, 'shardmesh')
    expect(mesh.props.dim).toBe(HELD_OPACITY)
    expect(HELD_OPACITY).toBe(0.5)
    // The note's blue box, at half and never solid, drawn after the opaque faces.
    expect(boxFill(m)).toHaveLength(1)
    expect(boxFill(m)[0].props.renderOrder).toBe(TRANSLUCENT_ORDER)
    const faces = of(m, 'meshBasicMaterial')
    expect(faces).toHaveLength(1)
    expect(faces[0].props.opacity).toBe(HELD_OPACITY)
    expect(faces[0].props.depthWrite).toBe(false)
    expect(outline(m)).toHaveLength(0)
    expect(of(m, 'worldlabel')).toHaveLength(0)
    expect(moves(m)).toEqual({ lifts: true, turns: true })
    await m.unmount()
  })

  it('while its model loads, or has none, is the box at half alone, with no name', async () => {
    const m = await draw(createElement(HeldItemMark, { id: 'k', own: true, at: AT, wears: WEARS, axes: AXES }), null)
    expect(of(m, 'shardmesh')).toHaveLength(0)
    expect(of(m, 'meshBasicMaterial').map((h) => h.props.opacity)).toEqual([HELD_OPACITY])
    expect(of(m, 'worldlabel')).toHaveLength(0)
    await m.unmount()
  })
})

describe('an item taken from someone else', () => {
  it('is its model at half, in motion, with no box at all and no name', async () => {
    const m = await draw(createElement(HeldItemMark, { id: 'k', own: false, at: AT, wears: WEARS, axes: AXES }))
    expect(of(m, 'shardmesh')[0].props.dim).toBe(HELD_OPACITY)
    expect(boxFill(m)).toHaveLength(0)
    expect(of(m, 'lineBasicMaterial')).toHaveLength(0)
    expect(of(m, 'worldlabel')).toHaveLength(0)
    expect(moves(m)).toEqual({ lifts: true, turns: true })
    await m.unmount()
  })

  it('while its model loads, or has none, is marked by the box at half until the model comes', async () => {
    const m = await draw(createElement(HeldItemMark, { id: 'k', own: false, at: AT, wears: WEARS, axes: AXES }), null)
    expect(of(m, 'meshBasicMaterial').map((h) => h.props.opacity)).toEqual([HELD_OPACITY])
    expect(of(m, 'worldlabel')).toHaveLength(0)
    await m.unmount()
  })
})

describe('an item not held, yours placed and not picked up included', () => {
  it('is its whole model in motion (bob and both spins), its outline and its name, as before', async () => {
    const m = await draw(createElement(ItemMark, { id: 'k', text: '⚷ Silver Key', sub: '— you', at: AT, wears: WEARS, axes: AXES }))
    const [mesh] = of(m, 'shardmesh')
    // Full: no share of its opacity taken off (ShardMesh's dim defaults to 1).
    expect(mesh.props.dim ?? 1).toBe(1)
    expect(boxFill(m)).toHaveLength(0)
    expect(outline(m)).toHaveLength(1)
    expect(of(m, 'worldlabel').map((h) => h.props.text)).toEqual(['⚷ Silver Key'])
    expect(moves(m)).toEqual({ lifts: true, turns: true })
    await m.unmount()
  })

  it('moves only as its tags say: a key with no motion stands still', async () => {
    const m = await draw(createElement(ItemMark, { id: 'k', text: '⚷ Silver Key', sub: '— you', at: AT, wears: { ...WEARS, animation: [] }, axes: AXES }))
    expect(moves(m)).toEqual({ lifts: false, turns: false })
    await m.unmount()
  })
})
