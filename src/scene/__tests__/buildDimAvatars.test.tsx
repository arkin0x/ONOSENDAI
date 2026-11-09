/**
 * buildDimAvatars.test.tsx - in build mode an avatar, yours or anyone's,
 * that stands between the camera and the build cursor dims as a shard does,
 * and a dimmed avatar, shard or look is tapped through (arkinox, 2026-11-09).
 * Outside the Builder an avatar is never see-through (DECK-0003 §3.3): it
 * never registers there, whatever the dimmed set says.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const frames: Array<(state: unknown, delta: number) => void> = []
vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: (cb: (state: unknown, delta: number) => void) => { frames.push(cb) },
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined }),
}))
vi.mock('../TapTarget', async (real) => {
  const { createElement } = await import('react')
  return { ...(await real<object>()), TapTarget: (props: object) => createElement('taptarget', props) }
})
vi.mock('../WorldLabel', async (real) => ({ ...(await real<object>()), WorldLabel: () => null }))
vi.mock('../ShardMesh', async () => {
  const { createElement } = await import('react')
  return { CUBE_EDGES: 'outline', ShardMesh: (props: object) => createElement('shardmesh', props) }
})
vi.mock('../AvatarShape', async () => {
  const { createElement } = await import('react')
  return { AvatarShape: (props: object) => createElement('avatarshape', props) }
})
// The avatar's shape, without asking any relay for it.
const avatarShard = { current: null as unknown }
vi.mock('../../store/useAvatars', async (real) => ({ ...(await real<object>()), useAvatarShard: () => avatarShard.current }))

import fs from 'node:fs'
import path from 'node:path'
import { createElement, useRef } from 'react'
import { Group } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { mount, settled, type Host, type Mounted } from '../../test/elementRoot'
import { BuildOccluders, DIM, useAvatarOccluder } from '../BuildOccluders'
import { Avatar } from '../Avatar'
import { PlacedShard, type PlacedShardDraw } from '../WorldShards'
import { LookMark } from '../LookMark'
import { occluderTargets, occludersMoved, registerOccluder, setDimmed, useBuildDim } from '../../store/useBuildDim'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import type { ViewAxes } from '../../lib/space'
import type { Look } from '../../lib/looks'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
const PK = 'a'.repeat(64)

function cube(name: string): ShardModel {
  return { ...newShard(name), unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}

const registered = (): string[] => [...occluderTargets()].map((t) => t.key).sort()
const host = (m: Mounted, type: string): Host => m.all().find((h: Host) => h.type === type) as Host

/**
 * Someone else's avatar as OtherAvatar wires it: its drawn group, the key and
 * dim from useAvatarOccluder, the dim to its shape and the key to its tap
 * target. OtherAvatar itself places its group through three's own objects
 * every commit, which this test renderer's plain records cannot stand in for;
 * that it wires these exactly so is checked from its source below.
 */
function Them({ name }: { name: string }): JSX.Element {
  const drawn = useRef<Group>(new Group())
  const { occluder, dim } = useAvatarOccluder(name, drawn)
  return createElement('group', null, createElement('avatarshape', { dim }), createElement('taptarget', { occluder }))
}
const other = (name = `${PK}:r1`): ReturnType<typeof createElement> => createElement(Them, { name })

afterEach(() => {
  setDimmed(new Set())
  useBuilder.setState({ active: false })
  useCyberspace.setState({ walking: false })
  frames.length = 0
  avatarShard.current = null
})

describe("someone else's avatar", () => {
  it('outside the Builder never registers and is never dimmed, whatever the dimmed set holds', async () => {
    const m = await mount(other())
    expect(registered()).toEqual([])
    setDimmed(new Set([`avatar:${PK}`, 'avatar:you']))
    await settled()
    expect(host(m, 'avatarshape').props.dim).toBe(1)
    expect(host(m, 'taptarget').props.occluder).toBeUndefined()
    await m.unmount()
  })

  it('with the Builder on, registers, draws at DIM while it blocks, and its tap target carries the same key', async () => {
    useBuilder.setState({ active: true })
    const m = await mount(other())
    const keys = registered()
    expect(keys.length).toBe(1)
    expect(keys[0].startsWith(`avatar:${PK}:`)).toBe(true)
    expect(host(m, 'taptarget').props.occluder).toBe(keys[0])
    expect(host(m, 'avatarshape').props.dim).toBe(1)
    setDimmed(new Set(keys))
    await settled()
    expect(host(m, 'avatarshape').props.dim).toBe(DIM)
    await m.unmount()
    expect(registered()).toEqual([])
  })

  it('the Builder closing lets it go at once: unregistered, opaque, and its taps its own again', async () => {
    useBuilder.setState({ active: true })
    const m = await mount(other())
    setDimmed(new Set(registered()))
    await settled()
    expect(host(m, 'avatarshape').props.dim).toBe(DIM)
    useBuilder.setState({ active: false })
    await settled()
    expect(registered()).toEqual([])
    expect(host(m, 'avatarshape').props.dim).toBe(1)
    expect(host(m, 'taptarget').props.occluder).toBeUndefined()
    await m.unmount()
  })

  it('in WALK, Builder or not, never registers', async () => {
    useBuilder.setState({ active: true })
    useCyberspace.setState({ walking: true })
    const m = await mount(other())
    expect(registered()).toEqual([])
    await m.unmount()
  })

  it('OtherAvatar wires it so: keyed by pubkey and its own drawing, dim to the shape, key to the tap target', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'OtherAvatar.tsx'), 'utf8')
    expect(src).toMatch(/useAvatarOccluder\(`\$\{pubkey\}:\$\{id\}`, drawn\)/)
    expect(src).toMatch(/const id = useId\(\)/)
    expect(src).toMatch(/<AvatarShape [^>]*dim=\{dim\}/)
    expect(src).toMatch(/<TapTarget [^>]*occluder=\{occluder\}/)
  })
})

describe('your own avatar', () => {
  it('outside the Builder never registers', async () => {
    const m = await mount(createElement(Avatar))
    expect(registered()).toEqual([])
    expect(host(m, 'avatarshape').props.dim).toBe(1)
    await m.unmount()
  })

  it("with the Builder on, registers as 'avatar:you', dims, and its yielding tap target carries the key", async () => {
    useBuilder.setState({ active: true })
    const m = await mount(createElement(Avatar))
    expect(registered()).toEqual(['avatar:you'])
    const tap = host(m, 'taptarget')
    expect(tap.props.occluder).toBe('avatar:you')
    expect(tap.props.yields).toBe(true)
    setDimmed(new Set(['avatar:you']))
    await settled()
    expect(host(m, 'avatarshape').props.dim).toBe(DIM)
    useBuilder.setState({ active: false })
    await settled()
    expect(registered()).toEqual([])
    expect(host(m, 'avatarshape').props.dim).toBe(1)
    await m.unmount()
  })
})

describe('AvatarShape: the build dim is the only thing that sees through an avatar', () => {
  it('a shard avatar keeps ignoreOpacity, at full by default and at the dim it is handed', async () => {
    const { AvatarShape } = await vi.importActual<typeof import('../AvatarShape')>('../AvatarShape')
    // A shard far larger than the marker, so it is drawn as itself at this zoom.
    const big = { ...cube('me'), opacity: 0.1, vertices: [{ p: [-60, -60, -60], c: [1, 1, 1] }, { p: [60, -60, -60], c: [1, 1, 1] }, { p: [0, 60, 60], c: [1, 1, 1] }] } as ShardModel
    avatarShard.current = big
    useCyberspace.setState({ scaleExp: 0 })
    const plain = await mount(createElement(AvatarShape, { pubkey: PK, color: '#fff' }))
    const mesh = host(plain, 'shardmesh')
    expect(mesh).toBeTruthy()
    expect(mesh.props.ignoreOpacity).toBe(true)
    expect(mesh.props.dim).toBe(1)
    await plain.unmount()
    const dimmed = await mount(createElement(AvatarShape, { pubkey: PK, color: '#fff', dim: DIM }))
    expect(host(dimmed, 'shardmesh').props.ignoreOpacity).toBe(true)
    expect(host(dimmed, 'shardmesh').props.dim).toBe(DIM)
    await dimmed.unmount()
  })
})

describe('movers: an avatar that glides or turns is looked at again (occludersMoved)', () => {
  it('a first look, a real move and a turn count; standing still and a drift too small to see do not', () => {
    const g = new Group()
    g.updateMatrixWorld(true)
    const off = registerOccluder('mover', g, true)
    expect(occludersMoved()).toBe(true)
    expect(occludersMoved()).toBe(false)
    g.position.set(0.5, 0, 0)
    g.updateMatrixWorld(true)
    expect(occludersMoved()).toBe(true)
    expect(occludersMoved()).toBe(false)
    g.position.x += 1e-9
    g.updateMatrixWorld(true)
    expect(occludersMoved()).toBe(false)
    g.rotation.y = 0.3
    g.updateMatrixWorld(true)
    expect(occludersMoved()).toBe(true)
    off()
    g.position.set(5, 5, 5)
    g.updateMatrixWorld(true)
    expect(occludersMoved()).toBe(false)
  })

  it('a shard (not a mover) is never watched', () => {
    const g = new Group()
    const off = registerOccluder('still', g)
    g.position.set(3, 0, 0)
    g.updateMatrixWorld(true)
    expect(occludersMoved()).toBe(false)
    off()
  })

  it('re-registered under the same key, only the newest is watched', () => {
    const a = new Group()
    const b = new Group()
    const offA = registerOccluder('k', a, true)
    const offB = registerOccluder('k', b, true)
    occludersMoved()
    a.position.set(1, 0, 0)
    a.updateMatrixWorld(true)
    expect(occludersMoved()).toBe(false)
    offA()
    b.position.set(1, 0, 0)
    b.updateMatrixWorld(true)
    expect(occludersMoved()).toBe(true)
    offB()
  })
})

describe('nothing left behind', () => {
  it('BuildOccluders unmounted while on leaves nothing dimmed', async () => {
    useBuilder.setState({ active: true })
    const m = await mount(createElement(BuildOccluders, { axes: AXES }))
    setDimmed(new Set(['wall', 'avatar:you']))
    await m.unmount()
    expect(useBuildDim.getState().dimmed.size).toBe(0)
  })
})

describe('shards and looks hand their key to their tap target', () => {
  const draw = (key: string): PlacedShardDraw => ({ key, shard: cube(key), centre: [0, 0, 0], scale: 1, clip: { min: [-9, -9, -9], max: [9, 9, 9] }, pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] as never })

  it('a world shard', async () => {
    const m = await mount(createElement(PlacedShard, { w: draw('s1'), birth: undefined, occludes: true }))
    expect(host(m, 'taptarget').props.occluder).toBe('s1')
    await m.unmount()
  })

  it('a shard that never dims (Cyberspace TV, no `occludes`) hands none', async () => {
    const m = await mount(createElement(PlacedShard, { w: draw('s2'), birth: undefined }))
    expect(host(m, 'taptarget').props.occluder).toBeUndefined()
    await m.unmount()
  })

  it('a chest or door look', async () => {
    const model = cube('chest')
    const look = { name: 'chest', kind: 'chest', closed: model } as unknown as Look
    const m = await mount(createElement(LookMark, { look, model, at: [0, 0, 0], axes: AXES, minPx: 10, occluder: 'look:c1', onTap: () => undefined }))
    expect(host(m, 'taptarget').props.occluder).toBe('look:c1')
    await m.unmount()
  })
})
