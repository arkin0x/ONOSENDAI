/**
 * softPick.test.tsx: a shard that is only fog, glow or points can be tapped
 * (arkinox, 2026-11-22: "I can't tap on a shard when it's only fog"), and is
 * seen while it is being placed ("the fog shard is invisible while I'm trying
 * to place it in BUILD").
 *
 * The real ShardMesh is mounted in R3F with no WebGL (test/r3fRoot.ts), each
 * shard in its own group with its TapTarget as WorldShards draws it, and
 * tapped through R3F's own click path, as a finger taps:
 *
 * - A fog shard (POINTS, point size 0, a FOG glow), a glow shard (POINTS at
 *   opacity 0, a LIGHT glow) and a cloud of dots each take a tap on what they
 *   draw; a fog only within its halos, never in the empty corners of its box.
 * - A solid shard in front of the fog, or standing in the front of it, wins
 *   the tap; a wall behind the fog does not.
 * - The pick volume is never drawn and writes neither depth nor colour.
 * - The placing ghost of a fog, a glow or a dot cloud is outlined over
 *   everything (depthTest off for the outline only), its glow drawn whatever
 *   the Settings switch says; a solid ghost is not outlined.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

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
vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))

import { createElement, useRef, type RefObject } from 'react'
import { Box3, Mesh, Vector3, type Group, type LineBasicMaterial, type LineSegments, type MeshBasicMaterial, type Object3D } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { ShardMesh } from '../ShardMesh'
import { TapTarget } from '../TapTarget'
import { GhostGlow, GlowWorldCanvas } from '../PointBillboards'
import { PICK_MATERIAL, SOFT_OUTLINE_ORDER, pickBox, softModel } from '../softPick'
import { useLayers } from '../../store/useLayers'

const SIZE = 800

/** Two points two units apart on x, in POINTS mode, with `extra` (point size, glow) and `opacity`. */
function points(name: string, extra: ShardModel['extra'], opacity?: number): ShardModel {
  return { ...newShard(name), unit: 0, mode: 'points', vertices: [{ p: [-1, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }], faces: [], ...(extra ? { extra } : {}), ...(opacity !== undefined ? { opacity } : {}) }
}

/** A fog: no points drawn, a FOG glow two units round each (240 ticks). */
const fog = (): ShardModel => points('Fog', { pointsize: 0, glow: ['fog', 240, 60] })
/** A glow and nothing else: opacity 0, so no point of its own, and a LIGHT glow. */
const glowOnly = (): ShardModel => points('Glow', { glow: ['light', 240, 60] }, 0)
/** A cloud of the client's own dots, two more points to give it height. */
function dots(): ShardModel {
  const s = points('Dots', undefined)
  return { ...s, vertices: [...s.vertices, { p: [0, 1, 0], c: [1, 1, 1] }, { p: [0, -1, 0], c: [1, 1, 1] }] }
}

/** A solid cube `side` units across, centred on its origin. */
function cube(side: number): ShardModel {
  const h = side / 2
  const vertices: ShardModel['vertices'] = []
  for (const x of [-h, h]) for (const y of [-h, h]) for (const z of [-h, h]) vertices.push({ p: [x, y, z], c: [1, 0, 0] })
  const faces: [number, number, number][] = [[0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3], [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6]]
  return { ...newShard('Cube'), unit: 0, mode: 'solid', vertices, faces }
}

/** One shard as the world draws it: at `z`, its drawn group measured by its own TapTarget. */
function Placed({ shard, z, onTap }: { shard: ShardModel; z: number; onTap: () => void }): JSX.Element {
  const drawn = useRef<Group>(null)
  return createElement('group', { position: [0, 0, z] },
    createElement('group', { ref: drawn }, createElement(ShardMesh, { shard, world: true })),
    createElement(TapTarget, { measure: drawn as RefObject<Group>, onTap }))
}

let r: R3fRoot | null = null
afterEach(async () => { await r?.unmount(); r = null })

/** Mount `things`, each a shard at a depth with a tap counter; the camera at z = 10 looking down -z. */
async function scene(things: Array<{ shard: ShardModel; z: number; onTap: () => void }>): Promise<R3fRoot> {
  r = await r3fRoot({ width: SIZE, height: SIZE })
  await r.render(createElement('group', null, ...things.map((t, i) => createElement(Placed, { key: i, ...t }))))
  return r
}

/** Where a world point is on screen, CSS pixels. */
function onScreen(root: R3fRoot, p: [number, number, number]): [number, number] {
  const v = new Vector3(...p).project(root.state().camera)
  return [((v.x + 1) / 2) * SIZE, ((1 - v.y) / 2) * SIZE]
}

function find(root: Object3D, name: string): Object3D[] {
  const out: Object3D[] = []
  root.traverse((o) => { if (o.name === name) out.push(o) })
  return out
}

describe('a shard that is only fog, glow or points, tapped', () => {
  it('a fog takes a tap on its fog, between its points where nothing else is drawn', async () => {
    const tapped = vi.fn()
    const root = await scene([{ shard: fog(), z: -6, onTap: tapped }])
    await root.tap(...onScreen(root, [0, 0, -6]))
    expect(tapped).toHaveBeenCalledTimes(1)
  })

  it('a fog takes no tap in the empty corner of its box, outside every halo', async () => {
    const tapped = vi.fn()
    const root = await scene([{ shard: fog(), z: -6, onTap: tapped }])
    // Inside the box (points widened by the 2-unit radius), 2.5 units from the nearer point.
    await root.tap(...onScreen(root, [2.8, 1.8, -6]))
    expect(tapped).not.toHaveBeenCalled()
  })

  it('a glow with nothing of its own drawn (opacity 0) takes a tap on its glow', async () => {
    const tapped = vi.fn()
    const root = await scene([{ shard: glowOnly(), z: -6, onTap: tapped }])
    await root.tap(...onScreen(root, [0, 0, -6]))
    expect(tapped).toHaveBeenCalledTimes(1)
  })

  it('a cloud of dots takes a tap between its dots', async () => {
    const tapped = vi.fn()
    // Close enough that it is large on screen, where a tap must land on what it draws.
    const root = await scene([{ shard: dots(), z: 6, onTap: tapped }])
    await root.tap(...onScreen(root, [0.5, 0.5, 6]))
    expect(tapped).toHaveBeenCalledTimes(1)
  })

  it('a solid shard in front of the fog wins the tap', async () => {
    const fogTap = vi.fn()
    const solidTap = vi.fn()
    const root = await scene([{ shard: fog(), z: -6, onTap: fogTap }, { shard: cube(1), z: -2, onTap: solidTap }])
    await root.tap(...onScreen(root, [0, 0, -2]))
    expect(solidTap).toHaveBeenCalledTimes(1)
    expect(fogTap).not.toHaveBeenCalled()
  })

  it('a solid shard standing in the front of the fog wins the tap, though the fog\'s box is nearer', async () => {
    const fogTap = vi.fn()
    const solidTap = vi.fn()
    // Its front face at z = -5.5: inside the fog's halos (they reach z = -4), in front of its points (z = -6).
    const root = await scene([{ shard: fog(), z: -6, onTap: fogTap }, { shard: cube(1), z: -6, onTap: solidTap }])
    await root.tap(...onScreen(root, [0, 0, -5.5]))
    expect(solidTap).toHaveBeenCalledTimes(1)
    expect(fogTap).not.toHaveBeenCalled()
  })

  it('a wall behind the fog does not take its tap', async () => {
    const fogTap = vi.fn()
    const wallTap = vi.fn()
    const root = await scene([{ shard: fog(), z: -6, onTap: fogTap }, { shard: cube(1), z: -9, onTap: wallTap }])
    await root.tap(...onScreen(root, [0, 0, -6]))
    expect(fogTap).toHaveBeenCalledTimes(1)
    expect(wallTap).not.toHaveBeenCalled()
  })

  it('the pick volume is never drawn and writes neither depth nor colour; a solid shard has none', async () => {
    const root = await scene([{ shard: fog(), z: -6, onTap: () => undefined }, { shard: glowOnly(), z: -12, onTap: () => undefined }, { shard: cube(1), z: -2, onTap: () => undefined }])
    const picks = find(root.state().scene, 'shard-pick') as Mesh[]
    expect(picks).toHaveLength(2)
    for (const p of picks) {
      expect(p.visible).toBe(false)
      const m = p.material as MeshBasicMaterial
      expect(m).toBe(PICK_MATERIAL)
      expect(m.depthWrite).toBe(false)
      expect(m.colorWrite).toBe(false)
    }
  })

  it('the pick volume\'s box is the points widened by the glow\'s radius', () => {
    const box = pickBox([-1, 0, 0, 1, 0, 0], 2)!
    expect(box.min.toArray()).toEqual([-3, -2, -2])
    expect(box.max.toArray()).toEqual([3, 2, 2])
  })
})

describe('the placing ghost of a shard that is only fog, glow or points', () => {
  /** The ghost as ShardGhost draws it, in the world's canvas. */
  async function ghost(shard: ShardModel): Promise<R3fRoot> {
    r = await r3fRoot({ width: SIZE, height: SIZE })
    await r.render(createElement(GlowWorldCanvas, null, createElement(GhostGlow, { always: softModel(shard) }, createElement(ShardMesh, { shard, ghost: true, headlamp: true, world: true, noBloom: true, edges: true }))))
    return r
  }

  it('a fog, a glow and a dot cloud are each outlined over everything, the outline\'s depth test off', async () => {
    for (const shard of [fog(), glowOnly(), dots()]) {
      const root = await ghost(shard)
      const lines = find(root.state().scene, 'soft-outline') as LineSegments[]
      expect(lines).toHaveLength(1)
      const m = lines[0].material as LineBasicMaterial
      expect(m.depthTest).toBe(false)
      expect(m.depthWrite).toBe(false)
      expect(lines[0].renderOrder).toBe(SOFT_OUTLINE_ORDER)
      // The pick box's twelve edges, round the halos.
      lines[0].geometry.computeBoundingBox()
      expect(lines[0].geometry.getAttribute('position').count).toBe(24)
      await root.unmount(); r = null
    }
  })

  it('its glow is drawn with the Settings switch off, and a solid ghost is not outlined', async () => {
    useLayers.setState({ glow: false })
    try {
      const root = await ghost(fog())
      expect(find(root.state().scene, 'glow-halos')).toHaveLength(1)
      await root.unmount(); r = null
      const solid = await ghost(cube(1))
      expect(find(solid.state().scene, 'soft-outline')).toHaveLength(0)
    } finally {
      useLayers.setState({ glow: true })
    }
  })

  it('a solid shard in front of the ghost leaves its outline drawn: nothing it draws is tested against depth', async () => {
    r = await r3fRoot({ width: SIZE, height: SIZE })
    await r.render(createElement(GlowWorldCanvas, null,
      createElement('group', { position: [0, 0, -2] }, createElement(ShardMesh, { shard: cube(3), world: true })),
      createElement('group', { position: [0, 0, -6] }, createElement(GhostGlow, { always: true }, createElement(ShardMesh, { shard: fog(), ghost: true, headlamp: true, world: true, noBloom: true, edges: true })))))
    const outline = find(r.state().scene, 'soft-outline')[0] as LineSegments
    expect(outline).toBeDefined()
    expect((outline.material as LineBasicMaterial).depthTest).toBe(false)
    // The cube does stand between: its box covers the fog's middle on the line of sight.
    const cubeBox = new Box3().setFromObject(find(r.state().scene, 'shard-faces')[0])
    expect(cubeBox.containsPoint(new Vector3(0, 0, -2))).toBe(true)
    // Drawn last, after the cube's faces.
    expect(outline.renderOrder).toBeGreaterThan((find(r.state().scene, 'shard-faces')[0] as Mesh).renderOrder)
  })
})
