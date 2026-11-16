/**
 * buildLessGlow.test.tsx: BUILD without the glow (owner, 2026-11-16: "can we
 * reduce the glowiness in build mode? its hard to line up what we are
 * placing. originally the glow was to make what we placed distinct from the
 * rest but i think that was a mistake with all the other glowing stuff").
 *
 * The world's bloom reads any texel whose alpha is above zero as light, and
 * the world's faces write alpha 0 so it skips them (worldBloom.tsx). What
 * washed the courtyard was everything BUILD laid over the faces writing
 * alpha: the placing ghost (ordinary blending at 0.45), the deploy box's grid
 * walls and its ZOOM OUT walls. Each of these now keeps the alpha under it
 * (blendSrcAlpha Zero, blendDstAlpha One), so it can never bloom and never
 * takes the tag off a face it covers.
 *
 * - The ghost: its own vertex colours, no tint, at GHOST_OPACITY, its faces
 *   blended as a see-through face, its dots and lines kept out of the bloom,
 *   and thin crisp edges (GHOST_EDGES), its placed parts the same.
 * - Other ghosts (the chest and door ceremonies) keep what they had.
 * - The world around: a shard in BUILD is drawn tagged, as anywhere; the
 *   rooms' grids keep the alpha under them (the green box's grid and walls:
 *   deployBoxNoBloom.test.tsx); the bloom's own numbers do not read BUILD.
 *
 * Mounted for real (elementRoot.ts): only the canvas is stood in for.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: () => undefined,
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined }),
}))
vi.mock('../WorldLabel', async (real) => ({ ...(await real<object>()), WorldLabel: () => null }))

import { createElement } from 'react'
import { newShard, type ShardModel } from 'sno-core/shards'
import type { Placed } from 'sno-core/parts'
import { OneFactor, ZeroFactor, type Material } from 'three'
import { mount, type Host } from '../../test/elementRoot'
import type { Position, ViewAxes } from '../../lib/space'
import { BUILD } from '../../lib/palette'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { GHOST_EDGES, ShardMesh } from '../ShardMesh'
import { ShardGhost } from '../ShardGhost'
import { roomGridPool } from '../DoorRooms'
import { GHOST_OPACITY, NO_BLOOM_BLEND, SEE_THROUGH_BLEND, TAG_BLEND, TRANSLUCENT_ORDER } from '../shardFaces'

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
const CURSOR: Position = { x: (1n << 60n) + 5n, y: (1n << 60n) + 5n, z: (1n << 60n) + 5n }

/** A corner of a box: three faces meeting at right angles, in three colours, so it has edges to draw. */
function corner(name: string): ShardModel {
  return {
    ...newShard(name), unit: 0, mode: 'solid',
    vertices: [
      { p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [0, 1, 0] }, { p: [0, 1, 0], c: [0, 0, 1] }, { p: [0, 0, 1], c: [1, 1, 0] },
    ],
    faces: [[0, 1, 2], [0, 2, 3], [0, 3, 1]],
  }
}

/** A shard that places one part, already resolved (`nested`), so nothing is fetched. */
function withPart(): { shard: ShardModel; nested: Placed[] } {
  const part = { ref: 0, at: [0, 0, 0] as [number, number, number], turn: [0, 0, 0] as [number, number, number], step: 0 }
  const ref: ['a', string] = ['a', `33331:${'ab'.repeat(32)}:part`]
  const shard: ShardModel = { ...corner('Courtyard'), refs: [ref], parts: [part] }
  return { shard, nested: [{ part, ref, model: corner('Tower'), children: [] } as unknown as Placed] }
}

const ofType = (all: Host[], type: string): Host[] => all.filter((h) => h.type === type)
/** Keeps the alpha under it: whatever it is drawn over, it adds no alpha, so the bloom never reads it as light. */
function keepsAlpha(p: Record<string, unknown> | Material): void {
  expect((p as Record<string, unknown>).blendSrcAlpha).toBe(ZeroFactor)
  expect((p as Record<string, unknown>).blendDstAlpha).toBe(OneFactor)
}
/** Every material a host tree carries, as a `material` prop object (points, a grid wall) or a JSX material host's props. */
function materialObjects(all: Host[]): Material[] {
  return all.flatMap((h) => (h.props.material && typeof h.props.material === 'object' ? [h.props.material as Material] : []))
}

afterEach(() => {
  useShards.setState({ pending: null })
})

describe('the placing ghost: as it will land, see-through, crisp, never glowing', () => {
  it('ShardGhost draws the shard in the world, without bloom and with edges', async () => {
    const model = corner('Courtyard')
    useWorkshop.setState({ shards: [model] })
    useCyberspace.setState({ cursor: CURSOR, anchor: CURSOR, scaleExp: 0 })
    useShards.getState().startDeployShard(model.id)
    const m = await mount(createElement(ShardGhost, { axes: AXES }))
    const faces = ofType(m.all(), 'meshBasicMaterial')
    expect(faces.length).toBeGreaterThanOrEqual(1)
    for (const f of faces) {
      // True colours: the vertices' own, no tint laid over them.
      expect(f.props.vertexColors).toBe(true)
      expect(f.props.color).toBeUndefined()
      expect(f.props.opacity).toBeCloseTo(GHOST_OPACITY, 9)
      expect(f.props).toMatchObject(SEE_THROUGH_BLEND)
      keepsAlpha(f.props)
    }
    expect(m.all().some((h) => h.props.name === 'ghost-edges')).toBe(true)
    await m.unmount()
  })

  it('faces, dots, edges and placed parts all keep the alpha under them; it is drawn after the opaque world', async () => {
    const { shard, nested } = withPart()
    const m = await mount(createElement(ShardMesh, { shard, nested, ghost: true, world: true, noBloom: true, edges: true }))
    const all = m.all()
    const faces = ofType(all, 'meshBasicMaterial')
    // The courtyard's faces and its tower's.
    expect(faces.length).toBeGreaterThanOrEqual(2)
    for (const f of faces) {
      expect(f.props.opacity).toBeCloseTo(GHOST_OPACITY, 9)
      keepsAlpha(f.props)
      // Its own depth, so it hides what is behind it as the placed thing will: crisp to line up with.
      expect(f.props.depthWrite).not.toBe(false)
    }
    for (const mesh of ofType(all, 'mesh').filter((h) => h.props.name === 'shard-faces')) expect(mesh.props.renderOrder).toBe(TRANSLUCENT_ORDER)
    // Edges on the courtyard and on the tower: thin white lines, see-through, no bloom.
    const edges = all.filter((h) => h.props.name === 'ghost-edges')
    expect(edges.length).toBeGreaterThanOrEqual(2)
    for (const e of edges) {
      const mat = e.children.find((c): c is Host => typeof c !== 'string' && c.type === 'lineBasicMaterial')!
      expect(mat.props.color).toBe(BUILD)
      expect(mat.props.opacity).toBeCloseTo(GHOST_EDGES.opacity, 9)
      expect(mat.props.opacity).toBeLessThan(1)
      expect(mat.props).toMatchObject(NO_BLOOM_BLEND)
    }
    // The vertex dots, a material object handed to <points>.
    const dots = materialObjects(ofType(all, 'points'))
    expect(dots.length).toBeGreaterThanOrEqual(1)
    for (const d of dots) keepsAlpha(d)
    await m.unmount()
  })

  it('a ghost that is not BUILD’s (a chest or door ceremony) keeps its ordinary blending and has no edges', async () => {
    const m = await mount(createElement(ShardMesh, { shard: corner('Slab'), ghost: true, world: true }))
    for (const f of ofType(m.all(), 'meshBasicMaterial')) {
      expect(f.props).not.toHaveProperty('blendDstAlpha')
      expect(f.props.opacity).toBeCloseTo(GHOST_OPACITY, 9)
    }
    expect(m.all().some((h) => h.props.name === 'ghost-edges')).toBe(false)
    await m.unmount()
  })
})

describe('BUILD leaves the world its normal look', () => {
  it('a shard standing in the world is drawn tagged and opaque, as outside BUILD', async () => {
    const m = await mount(createElement(ShardMesh, { shard: corner('Wall'), world: true }))
    for (const f of ofType(m.all(), 'meshBasicMaterial')) {
      expect(f.props.opacity).toBe(1)
      expect(f.props).toMatchObject(TAG_BLEND)
    }
    await m.unmount()
  })

  it('the rooms’ grids in BUILD keep the alpha under them too', () => {
    const g = roomGridPool.take()
    keepsAlpha(g)
    roomGridPool.give(g)
  })

  it('the bloom itself has no BUILD setting: the same pass and numbers in every mode', () => {
    const bloom = readFileSync(join(__dirname, '..', 'worldBloom.tsx'), 'utf8')
    expect(bloom).not.toMatch(/useBuilder|useShards|padMode/)
    expect(bloom).toContain('intensity={2.6} luminanceThreshold={0.001}')
  })
})
