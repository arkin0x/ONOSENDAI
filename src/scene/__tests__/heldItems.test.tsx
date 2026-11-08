/**
 * heldItems.test.tsx: how the world draws an item you hold (arkinox,
 * 2026-11-06, which replaces the solid blue box of 2026-11-01).
 *
 *  - Made by you and held: its model at half opacity, in motion as ever,
 *    inside the note's blue box at half, the box the model's own: the size
 *    of the outline the placement preview draws, cut at its region the same
 *    way, in the model's frame (2026-11-08).
 *  - Taken from someone else: its model at half opacity, in motion, no box.
 *  - Not held (yours placed and not picked up included): the whole model in
 *    motion, its outline and its name, exactly as before.
 *  - Held with its model loading or missing: the fixed box at half alone, no name.
 */
import { describe, expect, it, vi } from 'vitest'
import { LineBasicMaterial, MeshBasicMaterial, PerspectiveCamera, Euler, Vector3 } from 'three'

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
import { HeldItemMark, ItemMark, placedBoxProps, placedBoxSide } from '../WorldMessages'
import { VANISH_MS } from '../../lib/ceremony'
import type { Box } from '../../lib/clip'
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
/** The group that places and sizes the note's blue box: the one holding its faces. */
const boxGroup = (m: Mounted): Host => of(m, 'group').find((g) => g.children.some((c) => typeof c !== 'string' && c.type === 'mesh'))!
/** Where the box sits and how big it is: the outline's, or the blue box's. */
const placeOf = (h: Host): { position: unknown; scale: unknown } => ({ position: h.props.position, scale: h.props.scale })
/** The chain of elements from the root down to `target`. */
function pathTo(m: Mounted, target: Host): Host[] {
  const find = (h: Host, trail: Host[]): Host[] | null => {
    if (h === target) return [...trail, h]
    for (const c of h.children) if (typeof c !== 'string') { const r = find(c, [...trail, h]); if (r) return r }
    return null
  }
  for (const root of m.all()) { const r = find(root, []); if (r) return r }
  return []
}
/** A region narrower than the key's box in x: the box is cut at its walls. */
const NARROW: Box = { min: [-0.3, -4, -4], max: [0.3, 4, 4] }

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

  it('stands in the model\u2019s own box, the outline the placement preview draws, not the fixed box (2026-11-08)', async () => {
    for (const region of [null, NARROW]) {
      const preview = await draw(createElement(ItemMark, { id: 'k', text: '⚷ Silver Key', sub: 'by you', at: AT, wears: WEARS, region, axes: AXES }))
      const want = placeOf(outline(preview)[0])
      await preview.unmount()
      const m = await draw(createElement(HeldItemMark, { id: 'k', own: true, at: AT, wears: WEARS, region, axes: AXES }))
      const box = boxGroup(m)
      expect(placeOf(box)).toEqual(want)
      expect(box.props.scale).not.toBe(placedBoxSide(0))
      // One box, its faces under its edges, see-through and drawn after the opaque faces.
      expect(boxFill(m)).toHaveLength(1)
      expect(of(m, 'lineBasicMaterial').map((h) => h.props.opacity)).toEqual([HELD_OPACITY])
      expect(of(m, 'meshBasicMaterial')[0].props.polygonOffset).toBe(true)
      expect(of(m, 'lineSegments').every((h) => h.props.renderOrder === TRANSLUCENT_ORDER)).toBe(true)
      // In the model's frame (under the view's turn) and still: not inside the groups that bob and turn.
      const trail = pathTo(m, box)
      expect(trail.some((h) => h.props.matrixAutoUpdate === false)).toBe(true)
      const motion = pathTo(m, of(m, 'shardmesh')[0])
      const still = motion.slice(0, motion.findIndex((h) => h.type === 'shardmesh') - 4)
      expect(trail.slice(0, -1)).toEqual(still)
      await m.unmount()
    }
  })

  it('cut at a narrow region, its box is the cut one, smaller than the whole', async () => {
    const whole = await draw(createElement(HeldItemMark, { id: 'k', own: true, at: AT, wears: WEARS, region: null, axes: AXES }))
    const wide = boxGroup(whole).props.scale as number[]
    await whole.unmount()
    const cut = await draw(createElement(HeldItemMark, { id: 'k', own: true, at: AT, wears: WEARS, region: NARROW, axes: AXES }))
    const narrow = boxGroup(cut).props.scale as number[]
    expect(narrow[0]).toBeLessThan(wide[0])
    await cut.unmount()
  })

  it('under TAKE, the model\u2019s box fades in from nothing to its half', async () => {
    let now = 1000
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
    const m = await draw(createElement(HeldItemMark, { id: 'k', own: true, at: AT, wears: WEARS, axes: AXES, appear: { at: 1000, calm: false } }))
    expect(of(m, 'meshBasicMaterial')[0].props.opacity).toBe(0)
    expect(placeOf(boxGroup(m)).scale).not.toBe(placedBoxSide(0))
    now = 1000 + VANISH_MS * 2
    const fill = Object.assign(boxFill(m)[0], { material: new MeshBasicMaterial(placedBoxProps(0)), renderOrder: TRANSLUCENT_ORDER })
    const edges = Object.assign(of(m, 'lineSegments')[0], { material: new LineBasicMaterial(placedBoxProps(0)), renderOrder: TRANSLUCENT_ORDER })
    // Every frame, the model's and the box's, as three would run them.
    poseAt(m, 0)
    for (const o of [fill, edges]) {
      expect(o.material.opacity).toBeCloseTo(HELD_OPACITY, 9)
      expect(o.material.depthWrite).toBe(false)
      expect(o.renderOrder).toBe(TRANSLUCENT_ORDER)
    }
    clock.mockRestore()
    await m.unmount()
  })

  it('while its model loads, or has none, is the fixed box at half alone, with no name', async () => {
    const m = await draw(createElement(HeldItemMark, { id: 'k', own: true, at: AT, wears: WEARS, axes: AXES }), null)
    expect(boxGroup(m).props.scale).toBe(placedBoxSide(0))
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
    expect(boxGroup(m).props.scale).toBe(placedBoxSide(0))
    expect(of(m, 'meshBasicMaterial').map((h) => h.props.opacity)).toEqual([HELD_OPACITY])
    expect(of(m, 'worldlabel')).toHaveLength(0)
    await m.unmount()
  })
})

describe('an item not held, yours placed and not picked up included', () => {
  it('is its whole model in motion (bob and both spins), its outline and its name, as before', async () => {
    const m = await draw(createElement(ItemMark, { id: 'k', text: '⚷ Silver Key', sub: 'by you', at: AT, wears: WEARS, axes: AXES }))
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
    const m = await draw(createElement(ItemMark, { id: 'k', text: '⚷ Silver Key', sub: 'by you', at: AT, wears: { ...WEARS, animation: [] }, axes: AXES }))
    expect(moves(m)).toEqual({ lifts: false, turns: false })
    await m.unmount()
  })
})
