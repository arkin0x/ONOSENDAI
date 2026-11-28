/**
 * smashPreviewMesh.test.tsx - the smash preview as the scene draws it
 * (scene/SmashPreview.tsx), in a real R3F root (test/r3fRoot.ts): one mesh
 * for the whole set, in the outcome's colour, the HUD told its line, a pulse
 * that moves frame by frame (and holds still with reduced motion), and the
 * set worked out only once while the aim rests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
let reducedMotion = false
;(globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce') && reducedMotion, media: q, addEventListener: () => {}, removeEventListener: () => {} })

import { createElement } from 'react'
import { Color, type Mesh, type MeshBasicMaterial } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { SmashPreview } from '../SmashPreview'
import { setTerrainSession, useTerrain, type TerrainSession } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { useSmashHold } from '../../terrain/smashHold'
import { FERROVEIN, GLOWCORE, RUSTBAND } from '../../lib/blueprint/recipes'
import { PREVIEW_COMPILES, PREVIEW_DEBOUNCE_MS, PULSE_STEADY, useSmashPreview } from '../../lib/blueprint/smashPreview'

const HAMMER = new Map([['1,0,0', FERROVEIN], ['1,1,0', FERROVEIN], ['0,2,0', RUSTBAND], ['1,2,0', GLOWCORE], ['2,2,0', RUSTBAND]])
let reads = 0
const field = {
  plane: useCyberspace.getState().plane,
  version: 1,
  world: { blockCs: (x: number, y: number, z: number) => { reads++; return HAMMER.get(`${x},${y},${z}`) ?? 0 } },
} as unknown as TerrainSession

const rest = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

describe('the smash preview in the scene', () => {
  let root: R3fRoot
  beforeEach(async () => {
    // TERRAIN on first (it makes its own field), then the test's field in its place.
    useTerrain.setState({ active: true, sheet: false })
    await rest(0)
    setTerrainSession(field)
    // A bare-handed hold at the hammer's handle: shown at the hold's own block.
    useSmashHold.setState({ since: performance.now(), ms: 60_000, target: [1, 0, 0], bare: true, swingAt: null })
  })
  afterEach(async () => {
    await root?.unmount()
    useSmashHold.setState({ since: null, ms: 0, target: null, bare: false, swingAt: null })
    setTerrainSession(null)
    useTerrain.setState({ active: false })
    reducedMotion = false
  })

  const preview = (): Mesh => root.state().scene.getObjectByName('terrain-smash-preview') as Mesh

  it('the hammer: one mesh of its outer faces, mint, COMPILES on the HUD, worked out once while the aim rests', async () => {
    root = await r3fRoot()
    await root.render(createElement(SmashPreview))
    await root.frame()
    expect(preview().visible).toBe(false)
    await rest(PREVIEW_DEBOUNCE_MS + 20)
    await root.frame()
    const m = preview()
    expect(m.visible).toBe(true)
    // Five blocks, four faces shared between them: 22 faces, two triangles each, in one geometry.
    expect(m.geometry.getAttribute('position').count).toBe(22 * 6)
    expect((m.material as MeshBasicMaterial).color.getHex()).toBe(new Color(PREVIEW_COMPILES).getHex())
    expect(useSmashPreview.getState()).toEqual({ state: 'compiles', count: 5, cause: null })
    expect(root.state().scene.children.filter((c) => c.name === 'terrain-smash-preview')).toHaveLength(1)
    const after = reads
    for (let i = 0; i < 30; i++) await root.frame()
    expect(reads).toBe(after)
    // The pulse moves frame by frame.
    const a = (m.material as MeshBasicMaterial).opacity
    await root.frame(); await root.frame(); await root.frame()
    expect((m.material as MeshBasicMaterial).opacity).not.toBeCloseTo(a, 4)
    // The blocks change: worked out again.
    ;(field as { version: number }).version++
    await root.frame()
    await rest(PREVIEW_DEBOUNCE_MS + 20)
    await root.frame()
    expect(reads).toBeGreaterThan(after)
  })

  it('reduced motion: a steady highlight', async () => {
    reducedMotion = true
    root = await r3fRoot()
    await root.render(createElement(SmashPreview))
    await root.frame()
    await rest(PREVIEW_DEBOUNCE_MS + 20)
    for (let i = 0; i < 10; i++) {
      await root.frame()
      expect((preview().material as MeshBasicMaterial).opacity).toBe(PULSE_STEADY)
    }
  })

  it('the hold let go with a bare hand: gone, and the HUD told so; unmounted, its line is cleared', async () => {
    root = await r3fRoot()
    await root.render(createElement(SmashPreview))
    await root.frame()
    await rest(PREVIEW_DEBOUNCE_MS + 20)
    await root.frame()
    expect(preview().visible).toBe(true)
    useSmashHold.setState({ since: null, target: null })
    await root.frame()
    expect(preview().visible).toBe(false)
    expect(useSmashPreview.getState().state).toBeNull()
  })
})
