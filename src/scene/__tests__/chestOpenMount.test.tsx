/**
 * chestOpenMount.test.tsx: the chest's resting mesh is mounted once, through
 * everything OPEN does (arkinox, 2026-11-18: "opening it makes the chest model
 * disappear for a few seconds"). LookBody is mounted, then driven through the
 * ceremony starting, the chest opening, loot appearing, the dim changing and the
 * ceremony ending, and a stand-in ShardMesh counts how often each model's mesh
 * was mounted and whether any frame drew nothing.
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

const mounts = new Map<string, number>()
vi.mock('../../lib/relay', () => ({ publishMany: vi.fn(async () => ({ ok: true })), query: vi.fn(async () => []), queryAny: vi.fn(async () => []), relaySet: () => ['wss://relay.test'] }))
vi.mock('@react-three/fiber', async (real) => ({ ...(await real<object>()), useFrame: () => undefined }))
vi.mock('../ChestLoot', async (real) => ({ ...(await real<object>()), ChestLoot: () => null }))
vi.mock('../ShardMesh', async () => {
  const { createElement, useEffect } = await import('react')
  return {
    ShardMesh: (props: { shard: { name: string } }) => {
      useEffect(() => { mounts.set(props.shard.name, (mounts.get(props.shard.name) ?? 0) + 1) }, [])
      return createElement('shardmesh', props)
    },
  }
})

import { createElement, useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import type { Look } from '../../lib/looks'
import type { LootObject } from '../../lib/lootObjects'
import type { Playing } from '../../store/useOpenCeremony'
import { mount, settled, type Host } from '../../test/elementRoot'
import { LookBody } from '../ChestLooks'

function model(name: string): ShardModel {
  return {
    id: name, name, unit: 0, extent: 8, mode: 'solid', up: false, spin: 0, updatedAt: 0,
    vertices: [{ p: [-1, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 3, 0], c: [0, 0, 1] }],
    faces: [[0, 1, 2]],
  }
}

interface State { opened: boolean; ceremony: Playing | undefined; loot: LootObject[]; dim: number }
let drive: (s: Partial<State>) => void = () => undefined
function Driver({ look }: { look: Look }): JSX.Element {
  const [s, set] = useState<State>({ opened: false, ceremony: undefined, loot: [], dim: 1 })
  drive = (next) => set((was) => ({ ...was, ...next }))
  return createElement(LookBody, { look, opened: s.opened, ceremony: s.ceremony, loot: s.loot, frame: {}, dim: s.dim, still: false })
}

/** The meshes on screen, by model name, and whether each is in a hidden group. */
function drawn(all: Host[]): Array<{ name: string; hidden: boolean }> {
  const out: Array<{ name: string; hidden: boolean }> = []
  const visit = (h: Host | string, hidden: boolean): void => {
    if (typeof h === 'string') return
    const here = hidden || h.props.visible === false
    if (h.type === 'shardmesh') out.push({ name: (h.props.shard as ShardModel).name, hidden: here })
    for (const c of h.children) visit(c, here)
  }
  for (const h of all.filter((x) => !all.some((p) => p.children.includes(x)))) visit(h, false)
  return out
}

async function step(next: Partial<State>): Promise<void> {
  drive(next)
  await settled()
}

describe('the resting mesh through OPEN', () => {
  it('a custom chest with one model: its mesh is mounted once and drawn at every step', async () => {
    mounts.clear()
    const look: Look = { name: 'custom', kind: 'chest', closed: model('Crate'), open: null }
    const m = await mount(createElement(Driver, { look }))
    const shown = (): boolean => drawn(m.all()).some((d) => d.name === 'Crate' && !d.hidden)
    expect(shown()).toBe(true)
    const steps: Array<Partial<State>> = [
      { ceremony: { kind: 'chest', at: performance.now(), calm: false }, opened: true },
      { loot: [{ id: 'x' } as unknown as LootObject] },
      { dim: 0.5 },
      { ceremony: undefined },
      { dim: 1 },
    ]
    for (const s of steps) {
      await step(s)
      expect(shown()).toBe(true)
    }
    expect(mounts.get('Crate')).toBe(1)
    await m.unmount()
  })

  it('a two-part look: the open model is mounted (hidden) from the start of OPEN, and shown as the ceremony ends, never mounted again', async () => {
    mounts.clear()
    const look: Look = { name: 'custom', kind: 'chest', closed: model('Crate'), open: model('Crate open') }
    const m = await mount(createElement(Driver, { look }))
    await step({ ceremony: { kind: 'chest', at: performance.now(), calm: true }, opened: true })
    // The crossfade draws both while the resting open look waits, hidden.
    const during = drawn(m.all())
    expect(during.some((d) => !d.hidden)).toBe(true)
    expect(during.some((d) => d.name === 'Crate open' && d.hidden)).toBe(true)
    const openMounts = mounts.get('Crate open') ?? 0
    await step({ ceremony: undefined })
    const after = drawn(m.all())
    expect(after.filter((d) => !d.hidden).map((d) => d.name)).toEqual(['Crate open'])
    // The resting open mesh was not mounted again at the end: only the crossfade's own went.
    expect(mounts.get('Crate open')).toBe(openMounts)
    await m.unmount()
  })
})
