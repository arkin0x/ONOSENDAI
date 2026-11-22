/**
 * keyCube.test.tsx: a key with no model of its own is a real 1-gibson cube
 * in the world, exactly like a message's box (owner, 2026-11-22, after
 * #870). A key that wears a model draws as before; coins and Cyberspace TV's
 * finds keep their screen-sized marks; a held key keeps its half box.
 *
 * Mounted as the scene mounts it (WorldMessages, items from the store) in a
 * real R3F root (test/r3fRoot.ts): real three objects, frames, camera and
 * taps, so sizes are measured in the world, as drawn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const hooks = vi.hoisted(() => ({ model: null as unknown, modelMarks: [] as Array<Record<string, unknown>> }))

vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
// Words are troika's, which fetches a font: a plain group stands in, so the label's own frame still runs.
vi.mock('@react-three/drei', async () => {
  const { createElement: h, forwardRef } = await import('react')
  return { Text: forwardRef((_props, ref) => h('group', { name: 'text', ref })) }
})
// The mint is never asked: a coin here is one not yet spent.
vi.mock('../../hud/useCashu', () => ({ useCashu: () => ({ state: 'unspent' }) }))
vi.mock('../../hooks/useItemModel', () => ({ useItemModel: (ref: unknown) => (ref ? hooks.model : null) }))
// A model, once in hand, is handed to ItemModelMark: a stand-in records what it is given.
vi.mock('../ItemModel', async (real) => ({
  ...(await real<object>()),
  ItemModelMark: (props: Record<string, unknown>) => { hooks.modelMarks.push(props); return null },
}))

import { createElement } from 'react'
import { act } from '@react-three/fiber'
import { Box3, Vector3, type Camera, type LineSegments, type Material, type Object3D, type PerspectiveCamera } from 'three'
import type { NostrEvent } from '../../lib/events'
import type { KeyItem } from '../../lib/hidden'
import type { ViewAxes } from '../../lib/space'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { useInventory } from '../../store/useInventory'
import { useShards, type WorldItem } from '../../store/useShards'
import { ItemMark, keyBoxSide, noteBoxSide, NOTE_EDGE_PX, WorldMessages } from '../WorldMessages'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const HERE = { x: 1n << 40n, y: 1n << 40n, z: 1n << 40n }
const OTHER = 'b'.repeat(64)
const MODEL = { address: `33331:${'e'.repeat(64)}:key` }
const TOKEN = `cashuBo2FteCJodHRwczovL21pbnQubWluaWJpdHMuY2FzaCIsInVuaXQiOiJzYXQiLCJwcm9v${'A'.repeat(1800)}`

let r: R3fRoot | null = null
afterEach(async () => {
  await r?.unmount()
  r = null
})
beforeEach(() => {
  hooks.model = null
  hooks.modelMarks.length = 0
  // The deploy cleared first: ending one moves the view (the store's BUILD focus), so the view is set after.
  useShards.setState({ pending: null, selectedSecret: null, mine: [], discovered: {}, curated: null } as never)
  useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0, focus: null })
  useInventory.setState({ owner: useCyberspace.getState().identity.pubkey, items: {}, storage: 'memory' })
})

function keyItem(model = false): KeyItem {
  return { name: 'Brass Key', about: '', itemPubkey: 'c'.repeat(64), secretHex: 'd'.repeat(64), ...(model ? { model: MODEL } : {}) }
}

/** A key lying in the world, hidden by someone else, not held. */
function worldKey(id: string, model = false): WorldItem {
  const event = { id, pubkey: OTHER, kind: 3340, created_at: 1, content: '', tags: [], sig: '' } as NostrEvent
  return { key: id, type: 'key', at: HERE, plane: 0, height: 0, mine: false, author: OTHER, keyItem: keyItem(model), event, lineage: id }
}

function worldMessage(id: string, text: string): WorldItem {
  return { key: id, type: 'message', at: HERE, plane: 0, height: 0, mine: false, author: OTHER, text }
}

/** Every object three would draw: it and every parent visible, with a material. */
function drawn(scene: Object3D): Array<Object3D & { material: Material }> {
  const out: Array<Object3D & { material: Material }> = []
  scene.traverse((o) => {
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return
    if ((o as { material?: unknown }).material) out.push(o as Object3D & { material: Material })
  })
  return out
}

/** The one line drawing in the scene: the item's mark. */
function markEdges(scene: Object3D): LineSegments {
  const lines = drawn(scene).filter((o) => o.type === 'LineSegments') as unknown as LineSegments[]
  expect(lines).toHaveLength(1)
  return lines[0]
}

/** The mark's box in the world, from its drawn geometry. */
function worldBox(edges: LineSegments): Box3 {
  edges.updateWorldMatrix(true, false)
  return new Box3().setFromObject(edges)
}

/** Its width on screen, CSS pixels, from its eight drawn corners. */
function screenWidth(edges: LineSegments, camera: Camera, width: number): number {
  const b = worldBox(edges)
  const xs: number[] = []
  for (let i = 0; i < 8; i++) {
    const v = new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera)
    xs.push(((v.x + 1) / 2) * width)
  }
  return Math.max(...xs) - Math.min(...xs)
}

/** The camera `back` units out from the mark's centre (and a little up), looking at it. */
async function lookFrom(root: R3fRoot, centre: Vector3, back: number): Promise<Camera> {
  const camera = root.state().camera
  camera.position.set(centre.x + back * 0.2, centre.y + back * 0.3, centre.z + back)
  camera.lookAt(centre)
  camera.updateMatrixWorld()
  await root.frame()
  return camera
}

async function scene(items: WorldItem[]): Promise<R3fRoot> {
  useShards.setState({ drawnItems: () => items } as never)
  const root = await r3fRoot()
  await root.render(createElement(WorldMessages, { axes: AXES }))
  return root
}

/** The mark's world edge and its screen widths from near to far; a cube's box is checked to be one. */
async function measure(root: R3fRoot, backs: number[], cube = true): Promise<{ edges: number[]; widths: number[]; centre: Vector3 }> {
  const lines = markEdges(root.state().scene)
  const centre = worldBox(lines).getCenter(new Vector3())
  const edges: number[] = []
  const widths: number[] = []
  for (const back of backs) {
    const camera = await lookFrom(root, centre, back)
    const size = worldBox(lines).getSize(new Vector3())
    if (cube) {
      expect(size.x).toBeCloseTo(size.y, 6)
      expect(size.y).toBeCloseTo(size.z, 6)
    }
    edges.push(Math.max(size.x, size.y, size.z))
    widths.push(screenWidth(lines, camera, root.state().size.width))
  }
  return { edges, widths, centre }
}

const BACKS = [2.5, 8, 30, 120]

describe('a key with no model of its own', () => {
  it('is sized one gibson, as a message’s box is; a key that wears a model is not', () => {
    for (const scaleExp of [0, 1, 2, 5]) expect(keyBoxSide(undefined, scaleExp)).toBe(noteBoxSide(scaleExp))
    expect(keyBoxSide({ model: MODEL, animation: [] }, 0)).toBeUndefined()
  })

  it('draws one gibson across in the world at 2^0 and 2^1, near or far, the same cube as a message’s box in the same place', async () => {
    for (const scaleExp of [0, 1]) {
      useCyberspace.setState({ scaleExp })
      r = await scene([worldKey('1'.repeat(64))])
      const key = await measure(r, BACKS)
      for (const e of key.edges) expect(e).toBeCloseTo(noteBoxSide(scaleExp), 6)
      // Nearer is larger on screen, farther smaller: a thing in the place.
      for (let i = 1; i < key.widths.length; i++) expect(key.widths[i]).toBeLessThan(key.widths[i - 1])
      const keyBox = worldBox(markEdges(r.state().scene))
      const keyMaterial = markEdges(r.state().scene).material as Material & { customProgramCacheKey: () => string }
      await r.unmount()

      r = await scene([worldMessage('2'.repeat(64), 'hello')])
      const note = await measure(r, BACKS)
      const noteBox = worldBox(markEdges(r.state().scene))
      const noteMaterial = markEdges(r.state().scene).material as Material & { customProgramCacheKey: () => string }
      expect(keyBox.min.distanceTo(noteBox.min)).toBeLessThan(1e-6)
      expect(keyBox.max.distanceTo(noteBox.max)).toBeLessThan(1e-6)
      for (let i = 0; i < BACKS.length; i++) expect(key.widths[i]).toBeCloseTo(note.widths[i], 6)
      // The same light: see-through, no depth written, its edges pulled a hair toward the eye.
      for (const m of [keyMaterial, noteMaterial]) {
        expect(m.transparent).toBe(true)
        expect(m.depthWrite).toBe(false)
        expect(m.depthTest).toBe(true)
      }
      expect(keyMaterial.customProgramCacheKey()).toBe(noteMaterial.customProgramCacheKey())
      await r.unmount()
      r = null
    }
  })

  it('follows the scale as it changes, still one gibson', async () => {
    r = await scene([worldKey('1'.repeat(64))])
    expect((await measure(r, [10])).edges[0]).toBeCloseTo(1, 6)
    useCyberspace.setState({ scaleExp: 1 })
    await r.render(createElement(WorldMessages, { axes: AXES }))
    expect((await measure(r, [10])).edges[0]).toBeCloseTo(0.5, 6)
  })

  it('hangs its name and its credit line just under the cube on screen, clear of its lowest corner, near or far', async () => {
    r = await scene([worldKey('1'.repeat(64))])
    const scene3 = r.state().scene
    const size = r.state().size
    const lines = markEdges(scene3)
    const centre = worldBox(lines).getCenter(new Vector3())
    const texts: Object3D[] = []
    scene3.traverse((o) => { if (o.name === 'text') texts.push(o) })
    // The name and, under it, who left it.
    expect(texts).toHaveLength(2)
    for (const back of [1.5, 2.5, 8, 20, 40]) {
      const camera = await lookFrom(r, centre, back)
      const b = worldBox(lines)
      let lowest = -Infinity
      for (let i = 0; i < 8; i++) {
        const v = new Vector3(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(camera)
        lowest = Math.max(lowest, ((1 - v.y) / 2) * size.height)
      }
      for (const text of texts) {
        // Its centre on screen, less half a line (one local unit of the label is one of its pixels; the credit line is smaller).
        const at = text.getWorldPosition(new Vector3()).project(camera)
        const y = ((1 - at.y) / 2) * size.height
        const label = texts[0].parent!.parent!.parent!
        const depth = camera.position.distanceTo(label.getWorldPosition(new Vector3()))
        const unitPx = (label.scale.x * size.height) / (2 * Math.tan(((camera as PerspectiveCamera).fov * Math.PI) / 360) * depth)
        expect(y - unitPx / 2).toBeGreaterThanOrEqual(lowest)
      }
    }
  })

  it('takes a tap anywhere over the cube up close, and a fingertip’s worth off it far away', async () => {
    const id = '1'.repeat(64)
    r = await scene([worldKey(id)])
    const lines = markEdges(r.state().scene)
    const centre = worldBox(lines).getCenter(new Vector3())
    const camera = r.state().camera
    const tapAt = async (dx: number): Promise<void> => {
      const v = centre.clone().project(camera)
      const { width, height } = r!.state().size
      await r!.tap(((v.x + 1) / 2) * width + dx, ((1 - v.y) / 2) * height)
    }
    // Straight on, 2 units out: the cube is hundreds of pixels across; 150 px off its middle is still on it.
    camera.position.set(centre.x, centre.y, centre.z + 2); camera.lookAt(centre); camera.updateMatrixWorld()
    await r.frame()
    await tapAt(150)
    expect(useShards.getState().selectedSecret).toBe(id)
    useShards.setState({ selectedSecret: null } as never)
    // Far off: a few pixels of cube, and a tap 15 px off it still opens it.
    camera.position.set(centre.x, centre.y, centre.z + 150); camera.lookAt(centre); camera.updateMatrixWorld()
    await r.frame()
    await tapAt(15)
    expect(useShards.getState().selectedSecret).toBe(id)
  })

  it('being moved, keeps its one-gibson cube, faint', async () => {
    const id = '1'.repeat(64)
    const w = worldKey(id)
    r = await scene([w])
    const still = await measure(r, [10])
    const opaque = (markEdges(r.state().scene).material as Material).opacity
    // Aiming a deploy brings the view to you (the store's BUILD focus); this view stays where the key is.
    await act(async () => {
      useShards.setState({ pending: { type: 'key', key: w.keyItem, move: { eventId: id } } } as never)
      useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0 })
    })
    const moving = await measure(r, [10])
    expect(moving.edges[0]).toBeCloseTo(still.edges[0], 6)
    expect((markEdges(r.state().scene).material as Material).opacity).toBeLessThan(opaque)
  })
})

describe('what keeps its look', () => {
  it('a key that wears a model draws its model, as before, and no world cube', async () => {
    hooks.model = { shard: { unit: 0 }, extent: { centre: [0, 0, 0], half: [0.5, 0.25, 0.1], aroundY: 0.5, aroundX: 0.27, radius: 0.57 } }
    r = await scene([worldKey('1'.repeat(64), true)])
    await r.frame()
    expect(hooks.modelMarks.length).toBeGreaterThan(0)
    expect(hooks.modelMarks.at(-1)!.minPx).toBe(NOTE_EDGE_PX)
    expect(drawn(r.state().scene).filter((o) => o.type === 'LineSegments')).toHaveLength(0)
  })

  it('a key that wears a model, while it loads, is the cube sized on screen, as before', async () => {
    r = await scene([worldKey('1'.repeat(64), true)])
    const { edges, widths } = await measure(r, BACKS)
    // Held to one size on screen (within the headlamp's reach), so its size in the world changes with distance.
    expect(widths[1]).toBeCloseTo(widths[0], 3)
    expect(edges[1]).toBeGreaterThan(edges[0])
    expect(edges.some((e) => Math.abs(e - 1) < 1e-3)).toBe(false)
  })

  it('a coin keeps its screen-sized diamond', async () => {
    r = await scene([worldMessage('3'.repeat(64), TOKEN)])
    const { edges, widths } = await measure(r, BACKS.slice(0, 2), false)
    // It turns, so its outline's width wobbles a little frame to frame; its size on screen holds while it stands three times as far.
    expect(Math.abs(widths[1] - widths[0]) / widths[0]).toBeLessThan(0.05)
    expect(edges[1]).toBeGreaterThan(edges[0] * 2)
  })

  it('a Cyberspace TV find (ItemMark, as TvFinds draws it, no side) keeps its screen-sized cube', async () => {
    r = await r3fRoot()
    await r.render(createElement(ItemMark, { text: '⚷ Brass Key', sub: 'tv', at: [0, 0, 0], axes: AXES }))
    const { edges, widths } = await measure(r, BACKS.slice(0, 2))
    expect(widths[1]).toBeCloseTo(widths[0], 3)
    expect(edges[1]).toBeGreaterThan(edges[0])
  })

  /** Holds `w` in ITEMS. */
  function hold(w: WorldItem): void {
    const me = useCyberspace.getState().identity.pubkey
    useInventory.setState({ owner: me, items: { [w.key]: { rowKey: `${me}/${w.key}`, owner: me, id: w.key, type: 'key', name: 'Brass Key', event: w.event as NostrEvent, author: OTHER, verified: true, source: 'found', place: null, from: null, at: 1, key: w.keyItem } }, storage: 'memory' } as never)
  }

  it('a held key with no model keeps its half box, and its tap stays a fingertip', async () => {
    const w = worldKey('1'.repeat(64))
    hold(w)
    r = await scene([w])
    // The half box (PlacedBox): its faces and edges, half a gibson on a side at 2^0, at half; no one-gibson cube.
    const faces = drawn(r.state().scene).filter((o) => o.type === 'Mesh')
    expect(faces).toHaveLength(1)
    const size = (await measure(r, [10, 40])).edges
    for (const e of size) expect(e).toBeCloseTo(0.5, 6)
    // Up close, 2 units out: a tap 150 px off its middle is past the half box and past a fingertip, and opens nothing.
    const centre = worldBox(markEdges(r.state().scene)).getCenter(new Vector3())
    const camera = r.state().camera
    camera.position.set(centre.x, centre.y, centre.z + 2); camera.lookAt(centre); camera.updateMatrixWorld()
    await r.frame()
    const v = centre.clone().project(camera)
    const { width, height } = r.state().size
    await r.tap(((v.x + 1) / 2) * width + 150, ((1 - v.y) / 2) * height)
    expect(useShards.getState().selectedSecret).toBeNull()
    // On it, it opens.
    await r.tap(((v.x + 1) / 2) * width, ((1 - v.y) / 2) * height)
    expect(useShards.getState().selectedSecret).toBe(w.key)
  })

  it('a held key with no model, being moved, keeps its half box, faint', async () => {
    const id = '1'.repeat(64)
    const w = worldKey(id)
    hold(w)
    r = await scene([w])
    await act(async () => {
      useShards.setState({ pending: { type: 'key', key: w.keyItem, move: { eventId: id } } } as never)
      useCyberspace.setState({ anchor: HERE, anchorPlane: 0, scaleExp: 0 })
    })
    for (const e of (await measure(r, [10])).edges) expect(e).toBeCloseTo(0.5, 6)
  })
})
