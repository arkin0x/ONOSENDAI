/**
 * lookFrame.test.tsx: how a custom look is drawn (review of #543). A stranger's
 * small look places objects that can resolve to thousands of nodes, so it is
 * charged to the scene's budget like any stranger's shard. Its cut and stance
 * are the same objects across WALK steps, because ShardMesh keys its geometry on
 * the clip's identity: a fresh box each step was the 2026-10-23 freeze. A hostile
 * `up` cannot skip the cut. Every mesh, the loot and ceremony branch's too, gets
 * the frame.
 */
import { describe, expect, it, vi } from 'vitest'

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
vi.mock('@react-three/fiber', async (real) => ({ ...(await real<object>()), useFrame: () => undefined }))
vi.mock('../TapTarget', async (real) => ({ ...(await real<object>()), TapTarget: () => null }))
vi.mock('../WorldLabel', async (real) => ({ ...(await real<object>()), WorldLabel: () => null }))
vi.mock('../ShardMesh', async () => {
  const { createElement } = await import('react')
  return { ShardMesh: (props: object) => createElement('shardmesh', props) }
})

import { createElement } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { builtInLook, lookOf, lookTags, posedLook } from '../../lib/looks'
import type { Position, ViewAxes } from '../../lib/space'
import { mount } from '../../test/elementRoot'
import { LookMark, type LookFrame } from '../LookMark'
import { lookFrame, type KeptLookFrames } from '../ChestLooks'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const STRANGER = 'b'.repeat(64)
const at: Position = { x: (1n << 40n) + 5n, y: 1n << 39n, z: 1n << 38n }
const panel = (over: Partial<ShardModel> = {}): ShardModel => ({ id: 'p', name: 'Panel', unit: 0, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0, vertices: [{ p: [-1, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 3, 0], c: [0, 0, 1] }], faces: [[0, 1, 2]], ...over })
const w = { key: 'k'.repeat(64), at, height: 4, plane: 0 as const, author: STRANGER }
const tagged = (m: ShardModel) => lookOf({ type: 'chest', event: { tags: lookTags(posedLook(m, { unit: m.unit, turn: [0, 0, 0], constrain: 'all' }), null), pubkey: STRANGER, sig: 'f'.repeat(128) } })!

describe('a custom look’s frame', () => {
  it('charges a stranger’s look to the scene’s budget, keyed apart from any shard', () => {
    const look = tagged(panel())
    const f = lookFrame(w, look, look.closed, [1, 2, 3], 0, AXES, new Map())
    expect(f.budget).toEqual({ key: `look:${w.key}`, trusted: false, centre: [1, 2, 3], scale: 1 })
  })

  it('a built-in places nothing: no cut, no stance, no budget', () => {
    const look = builtInLook('treasure')
    expect(lookFrame(w, look, look.closed, [0, 0, 0], 0, AXES, new Map())).toEqual({})
  })

  it('keeps the same clip across WALK steps, so nothing is cut again', () => {
    const look = tagged(panel())
    const kept: KeptLookFrames = new Map()
    const a = lookFrame(w, look, look.closed, [1, 0, 0], 0, AXES, kept)
    const b = lookFrame(w, look, look.closed, [9, 0, 0], 0, AXES, kept)
    expect(a.clip).toBeDefined()
    expect(b.clip).toBe(a.clip)
    // Another region is another box.
    expect(lookFrame({ ...w, height: 5 }, look, look.closed, [9, 0, 0], 0, AXES, kept).clip).not.toBe(a.clip)
  })

  it('a look standing by its payload keeps its pose steady, and is cut all the same', () => {
    const look = tagged(panel({ up: true, spin: 90 }))
    const standing = { ...look.closed, up: true, spin: 90 }
    const kept: KeptLookFrames = new Map()
    const a = lookFrame(w, look, standing, [0, 0, 0], 0, AXES, kept)
    const b = lookFrame(w, look, standing, [5, 0, 0], 0, AXES, kept)
    expect(a.pose).toBeDefined()
    expect(a.clip).toBeDefined()
    expect(b.pose).toBe(a.pose)
    expect(b.clip).toBe(a.clip)
  })

  it('reads the unit of what is drawn, an open look of another unit included', () => {
    const look = tagged(panel())
    const f = lookFrame(w, look, { ...look.closed, unit: 3 }, [0, 0, 0], 1, AXES, new Map())
    expect(f.budget?.scale).toBe(4)
  })
})

describe('LookMark', () => {
  const frame: LookFrame = { clip: { min: [0, 0, 0], max: [1, 1, 1] }, budget: { key: 'look:x', trusted: false, centre: [0, 0, 0], scale: 1 } }
  const look = tagged(panel())
  const label = { text: 't', color: '#fff', sub: 's', subColor: '#fff' }
  const meshes = (m: Awaited<ReturnType<typeof mount>>) => m.all().filter((h) => h.type === 'shardmesh')

  it('draws the model with the frame: cut, budget and all', async () => {
    const m = await mount(createElement(LookMark, { look, model: look.closed, at: [0, 0, 0], axes: AXES, minPx: 8, label, frame }))
    expect(meshes(m)).toHaveLength(1)
    expect(meshes(m)[0].props.budget).toBe(frame.budget)
    expect(meshes(m)[0].props.clip).toBe(frame.clip)
    await m.unmount()
  })

  it('hands the frame to what draws in its place, the loot and ceremony branch', async () => {
    const seen: unknown[] = []
    const m = await mount(createElement(LookMark, { look, model: look.closed, at: [0, 0, 0], axes: AXES, minPx: 8, label, frame }, ((f: LookFrame) => { seen.push(f.budget, f.clip); return null }) as never))
    expect(seen).toEqual([frame.budget, frame.clip])
    await m.unmount()
  })
})
