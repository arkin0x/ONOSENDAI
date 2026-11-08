/**
 * buildOccluders.test.tsx - in build mode the shards between the camera and
 * the build cursor dim (arkinox, 2026-11-08). The picking itself is
 * lib/__tests__/occluders.test.ts; this is the wiring: only with the Builder
 * on, never the ghost or the shard EDIT is moving, the dim reaching ShardMesh,
 * and the fade written onto the materials without a re-render between its
 * two ends.
 */
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const frames: Array<(state: unknown, delta: number) => void> = []
vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: (cb: (state: unknown, delta: number) => void) => { frames.push(cb) },
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined }),
}))
vi.mock('../TapTarget', async (real) => ({ ...(await real<object>()), TapTarget: () => null }))
vi.mock('../WorldLabel', async (real) => ({ ...(await real<object>()), WorldLabel: () => null }))
vi.mock('../ShardMesh', async () => {
  const { createElement } = await import('react')
  return { CUBE_EDGES: 'outline', ShardMesh: (props: object) => createElement('shardmesh', props) }
})

import { createElement, type RefObject } from 'react'
import { Group, LineBasicMaterial, Mesh, MeshBasicMaterial, BoxGeometry, type Object3D } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { mount, settled, type Host, type Mounted } from '../../test/elementRoot'
import { BuildOccluders, DIM, FADE_MS, dimsOccluders, fadeMaterial, useBuildDimmed } from '../BuildOccluders'
import { PlacedShard, type PlacedShardDraw } from '../WorldShards'
import { LookMark } from '../LookMark'
import { createDiscMaterial, SHARD_DOTS } from '../pointDisc'
import { occluderTargets, setDimmed, useBuildDim } from '../../store/useBuildDim'
import { useBuilder } from '../../store/useBuilder'
import { useCyberspace } from '../../store/useCyberspace'
import type { ViewAxes } from '../../lib/space'
import type { Look } from '../../lib/looks'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }

function cube(name: string): ShardModel {
  return { ...newShard(name), unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]] }
}

function draw(key: string): PlacedShardDraw {
  return { key, shard: cube(key), centre: [0, 0, 0], scale: 1, clip: { min: [-9, -9, -9], max: [9, 9, 9] }, pose: [1, 0, 0, 0, 1, 0, 0, 0, 1] as never }
}

const registered = (): string[] => [...occluderTargets()].map((t) => t.key).sort()
const meshProps = (m: Mounted): Record<string, unknown> => (m.all().find((h: Host) => h.type === 'shardmesh') as Host).props

afterEach(() => {
  setDimmed(new Set())
  frames.length = 0
})

describe('when the scene dims what blocks the cursor', () => {
  it('only with the Builder on (BUILD and DEPLOY alike), and never in WALK', () => {
    expect(dimsOccluders(false, false)).toBe(false)
    expect(dimsOccluders(true, true)).toBe(false)
    expect(dimsOccluders(false, true)).toBe(false)
    expect(dimsOccluders(true, false)).toBe(true)
  })

  it('the Builder off: nothing is dimmed, whatever was', async () => {
    useBuilder.setState({ active: false })
    setDimmed(new Set(['a', 'b']))
    const m = await mount(createElement(BuildOccluders, { axes: AXES }))
    expect(useBuildDim.getState().dimmed.size).toBe(0)
    expect(m.all().length).toBe(0)
    await m.unmount()
  })

  it('the Builder on but in WALK: nothing is dimmed either', async () => {
    useBuilder.setState({ active: true })
    useCyberspace.setState({ walking: true })
    setDimmed(new Set(['a']))
    const m = await mount(createElement(BuildOccluders, { axes: AXES }))
    expect(useBuildDim.getState().dimmed.size).toBe(0)
    await m.unmount()
    useCyberspace.setState({ walking: false })
    useBuilder.setState({ active: false })
  })

  it('turning the Builder off lets go of what it dimmed', async () => {
    useBuilder.setState({ active: true })
    const m = await mount(createElement(BuildOccluders, { axes: AXES }))
    setDimmed(new Set(['wall']))
    useBuilder.setState({ active: false })
    await settled()
    expect(useBuildDim.getState().dimmed.size).toBe(0)
    await m.unmount()
  })
})

describe('which shards may dim', () => {
  it('a world shard registers, and draws at DIM while it blocks', async () => {
    const m = await mount(createElement(PlacedShard, { w: draw('s1'), birth: undefined, occludes: true }))
    expect(registered()).toEqual(['s1'])
    expect(meshProps(m).dim).toBe(1)
    setDimmed(new Set(['s1']))
    await settled()
    expect(meshProps(m).dim).toBe(DIM)
    await m.unmount()
    expect(registered()).toEqual([])
  })

  it('the shard EDIT is moving never registers and never dims', async () => {
    setDimmed(new Set(['s2']))
    const m = await mount(createElement(PlacedShard, { w: draw('s2'), birth: undefined, moving: true, occludes: true }))
    expect(registered()).toEqual([])
    expect(meshProps(m).dim).toBe(1)
    expect(meshProps(m).ghost).toBe(true)
    await m.unmount()
  })

  it('a shard drawn without `occludes` (Cyberspace TV) never registers', async () => {
    const m = await mount(createElement(PlacedShard, { w: draw('tv'), birth: undefined, tappable: false }))
    expect(registered()).toEqual([])
    await m.unmount()
  })

  it('a chest or door look registers under its own key and passes the dim to its model', async () => {
    const model = cube('chest')
    const look = { name: 'chest', kind: 'chest', closed: model } as unknown as Look
    const m = await mount(createElement(LookMark, { look, model, at: [0, 0, 0], axes: AXES, minPx: 10, occluder: 'look:c1' }))
    expect(registered()).toEqual(['look:c1'])
    setDimmed(new Set(['look:c1']))
    await settled()
    expect(meshProps(m).dim).toBe(DIM)
    await m.unmount()
  })

  it('the ghost of what is being placed and the cursor never register', () => {
    // Neither is ever handed to the registry: only WorldShards and LookMark are.
    for (const f of ['ShardGhost.tsx', 'Cursor.tsx', 'DeployRegionBox.tsx']) {
      const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
      expect(src).not.toMatch(/useBuildDimmed|registerOccluder|occludes/)
    }
  })
})

describe('the fade', () => {
  /** A shard's drawn group as ShardMesh leaves it: a face with its share, and the points' disc. */
  function drawnGroup(share: number): { group: Group; face: MeshBasicMaterial; dots: ReturnType<typeof createDiscMaterial> } {
    const group = new Group()
    const face = new MeshBasicMaterial({ transparent: true, opacity: share })
    face.userData.share = share
    group.add(new Mesh(new BoxGeometry(1, 1, 1), face))
    const dots = createDiscMaterial(SHARD_DOTS, share * 0.55, false)
    const pts = new Mesh(new BoxGeometry(1, 1, 1), dots)
    group.add(pts)
    return { group, face, dots }
  }

  function Probe({ k, group }: { k: string; group: RefObject<Object3D> }): JSX.Element {
    const dim = useBuildDimmed(k, group)
    return createElement('probe', { dim })
  }

  const tick = (ms: number): void => { frames[frames.length - 1]({}, ms / 1000) }
  const dimOf = (m: Mounted): unknown => (m.all().find((h: Host) => h.type === 'probe') as Host).props.dim

  it('dims over FADE_MS on the materials, and back, with the dim prop changing only at the ends', async () => {
    const d = drawnGroup(1)
    const ref = { current: d.group }
    const m = await mount(createElement(Probe, { k: 'f1', group: ref }))
    expect(dimOf(m)).toBe(1)
    setDimmed(new Set(['f1']))
    await settled()
    expect(dimOf(m)).toBe(DIM)
    // ShardMesh now draws it at DIM: its share and the disc's opacity say so.
    d.face.userData.share = DIM
    d.face.opacity = DIM
    const dots = createDiscMaterial(SHARD_DOTS, DIM * 0.55, false)
    ;(d.group.children[1] as Mesh).material = dots
    tick(0)
    // The first step starts from where it was: full.
    expect(d.face.opacity).toBeCloseTo(1)
    tick(FADE_MS / 2)
    expect(d.face.opacity).toBeCloseTo(0.6)
    expect(dots.uniforms.uOpacity.value).toBeCloseTo(0.6 * 0.55)
    tick(FADE_MS)
    expect(d.face.opacity).toBeCloseTo(DIM)
    // Stopped blocking: still drawn see-through while it fades back.
    setDimmed(new Set())
    await settled()
    expect(dimOf(m)).toBe(DIM)
    tick(FADE_MS / 2)
    expect(d.face.opacity).toBeCloseTo(0.6)
    tick(FADE_MS)
    expect(d.face.opacity).toBeCloseTo(1)
    await settled()
    // Back at full: drawn opaque again, where the fade left it.
    expect(dimOf(m)).toBe(1)
    await m.unmount()
  })

  it('a shard that stops blocking before it was ever drawn dim is let go', async () => {
    const d = drawnGroup(1)
    const m = await mount(createElement(Probe, { k: 'f2', group: { current: d.group } }))
    setDimmed(new Set(['f2']))
    await settled()
    setDimmed(new Set())
    await settled()
    tick(16)
    await settled()
    expect(dimOf(m)).toBe(1)
    await m.unmount()
  })
})

describe('fadeMaterial', () => {
  it('scales a face or line by its own share, never past opaque', () => {
    const m = new LineBasicMaterial({ transparent: true })
    m.userData.share = 0.1
    fadeMaterial(m, 3)
    expect(m.opacity).toBeCloseTo(0.3)
    fadeMaterial(m, 50)
    expect(m.opacity).toBe(1)
  })

  it('scales the disc from the opacity it was made with, each time', () => {
    const d = createDiscMaterial(SHARD_DOTS, 0.11, false)
    fadeMaterial(d, 2)
    fadeMaterial(d, 3)
    expect(d.uniforms.uOpacity.value).toBeCloseTo(0.33)
  })

  it('leaves a material with no share alone (a placeholder cube)', () => {
    const m = new LineBasicMaterial({ transparent: true, opacity: 0.8 })
    fadeMaterial(m, 5)
    expect(m.opacity).toBe(0.8)
  })
})
