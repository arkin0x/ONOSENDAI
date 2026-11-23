/**
 * deployBoxNoBloom.test.tsx: BUILD's green region box never washes what is
 * being lined up (owner, 2026-11-16: "can we reduce the glowiness in build
 * mode? its hard to line up what we are placing").
 *
 * Its grid walls and its ZOOM OUT walls blended ordinarily: each wrote alpha
 * over the shard faces it covered, the faces lost their bloom tag
 * (worldBloom.tsx) and a castle courtyard inside the box bloomed white-green.
 * Now both keep the alpha under them (shardFaces.ts NO_BLOOM_BLEND), so no
 * face they cover loses its tag and they never glow themselves; the outline
 * stays a thin line round the region.
 *
 * DeployRegionBox runs in a real R3F root (test/r3fRoot.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { OneFactor, ZeroFactor, type Material, type Mesh, type Object3D } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import type { Position, ViewAxes } from '../../lib/space'
import { useCyberspace } from '../../store/useCyberspace'
import { useShards } from '../../store/useShards'
import { useWorkshop } from '../../store/useWorkshop'
import { DeployRegionBox } from '../DeployRegionBox'

vi.mock('../WorldLabel', async (real) => ({ ...(await real<object>()), WorldLabel: () => null }))

const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: 1 } } as ViewAxes
const CURSOR: Position = { x: (1n << 60n) + 5n, y: (1n << 60n) + 5n, z: (1n << 60n) + 5n }
const model: ShardModel = { ...newShard('Courtyard'), unit: 0, mode: 'solid', vertices: [{ p: [0, 0, 0], c: [1, 1, 1] }, { p: [1, 0, 0], c: [1, 1, 1] }, { p: [0, 1, 0], c: [1, 1, 1] }], faces: [[0, 1, 2]] }

let r: R3fRoot | null = null
afterEach(async () => {
  await r?.unmount()
  r = null
  useShards.setState({ pending: null })
})

function drawn(root: Object3D): { fills: Material[]; lines: Material[] } {
  const fills: Material[] = []
  const lines: Material[] = []
  root.traverse((o) => {
    const m = (o as Mesh).material as Material | undefined
    if (!m) return
    if ((o as { isLineSegments?: boolean }).isLineSegments) lines.push(m)
    else if ((o as { isMesh?: boolean }).isMesh) fills.push(m)
  })
  return { fills, lines }
}

describe('the green deploy box in BUILD', () => {
  it('its grid walls and ZOOM OUT walls keep the alpha under them; its outline is still drawn', async () => {
    useWorkshop.setState({ shards: [model] })
    useCyberspace.setState({ cursor: CURSOR, anchor: CURSOR, scaleExp: 0 })
    useShards.getState().startDeployShard(model.id)
    // Height 8 at 2^0: 256 cells, clipped about the cursor, with ZOOM OUT walls on its cut faces.
    useShards.setState({ deployHeightAuto: false, deployHeight: 8 })
    r = await r3fRoot()
    await r.render(createElement(DeployRegionBox, { axes: AXES }))
    const { fills, lines } = drawn(r.state().scene)
    // The grid on the walls, and at least one ZOOM OUT wall.
    expect(fills.length).toBeGreaterThanOrEqual(2)
    for (const m of fills) {
      expect(m.blendSrcAlpha).toBe(ZeroFactor)
      expect(m.blendDstAlpha).toBe(OneFactor)
    }
    expect(lines.length).toBeGreaterThanOrEqual(1)
  })
})
