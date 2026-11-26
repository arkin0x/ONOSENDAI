/**
 * letterRing.test.tsx: the glyph ring round every letter in the world
 * (owner, 2026-11-26: "make the glyph ring's glyphs randomly change to
 * different characters. keep the ring spin effect"), drawn for a hall of
 * letters: every letter in the same few instanced draws, a few glyphs
 * changed each frame and never more than the cap, the same changes under the
 * same seed, and, with reduced motion, a ring that neither turns nor changes.
 *
 * Run in a real R3F root (test/r3fRoot.ts): real three objects and frames.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import type { InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Mesh, ShaderMaterial } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'

vi.mock('@react-three/drei', async () => {
  const { createElement: h, forwardRef } = await import('react')
  return { Text: forwardRef((props: { position?: unknown }, ref) => h('group', { name: 'text', ref, position: props.position })) }
})

import { LetterField, putLetter, dropLetter } from '../LetterField'
import { GLYPHS } from '../../lib/decode'
import { MAX_CHANGES_PER_FRAME, RING_GLYPHS, RING_HIDE_PX, RING_THIN_PX, ringStart } from '../../lib/glyphRing'
import { atlasIndex } from '../glyphAtlas'

;(globalThis as { window?: unknown }).window ??= globalThis

const N = 30
let r: R3fRoot | null = null
beforeEach(() => {
  delete (globalThis as { matchMedia?: unknown }).matchMedia
  for (let i = 0; i < N; i++) putLetter({ key: `m${i}`, centre: [i * 2 - N, 0, 0], width: 1, colour: '#ffcf6b', initial: atlasIndex('M'), broken: i % 3 === 0 })
})
afterEach(async () => {
  await r?.unmount()
  r = null
  for (let i = 0; i < N; i++) dropLetter(`m${i}`)
  vi.restoreAllMocks()
})

function find<T>(root: R3fRoot, name: string): T {
  let out: T | undefined
  root.state().scene.traverse((o) => { if (o.name === name) out = o as unknown as T })
  expect(out, name).toBeDefined()
  return out!
}
const glyphsOf = (root: R3fRoot): number[] => Array.from((find<Mesh>(root, 'letter-rings').geometry.getAttribute('aGlyph') as InstancedBufferAttribute).array as Float32Array)

/** Mount the field, then run `frames` frames, the glyphs after each. */
async function run(frames: number): Promise<number[][]> {
  r = await r3fRoot()
  await r.render(createElement(LetterField))
  const out = [glyphsOf(r)]
  for (let f = 0; f < frames; f++) { await r.frame(); out.push(glyphsOf(r)) }
  return out
}
const changed = (a: number[], b: number[]): number => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0)

describe('the letters and their rings', () => {
  it('draws every letter in the same few instanced meshes, and every ring in one', async () => {
    await run(1)
    expect(find<InstancedMesh>(r!, 'letter-paper').count).toBe(N)
    expect(find<InstancedMesh>(r!, 'letter-folds').count).toBe(N)
    expect(find<InstancedMesh>(r!, 'letter-seal').count).toBe(N - 10)
    expect(find<InstancedMesh>(r!, 'letter-seal-broken').count).toBe(10)
    expect(find<InstancedMesh>(r!, 'letter-initial').count).toBe(N - 10)
    expect((find<Mesh>(r!, 'letter-rings').geometry as InstancedBufferGeometry).instanceCount).toBe(N * RING_GLYPHS)
    let meshes = 0
    r!.state().scene.traverse((o) => { if ((o as Mesh).isMesh) meshes++ })
    expect(meshes).toBe(6)
  })

  it('starts each ring from its message, with cipher glyphs', async () => {
    const [first] = await run(0)
    expect(first.slice(0, RING_GLYPHS)).toEqual(ringStart('m0'))
    for (const g of first.slice(0, N * RING_GLYPHS)) expect(g).toBeLessThan(GLYPHS.length)
  })

  it('changes a few glyphs every frame at random, never more than the cap, and turns', async () => {
    const frames = await run(20)
    let total = 0
    for (let f = 1; f < frames.length; f++) {
      const n = changed(frames[f - 1], frames[f])
      expect(n).toBeLessThanOrEqual(MAX_CHANGES_PER_FRAME)
      total += n
    }
    expect(total).toBeGreaterThan(20)
    for (const g of frames[frames.length - 1].slice(0, N * RING_GLYPHS)) { expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThan(GLYPHS.length) }
    expect(find<Mesh>(r!, 'letter-rings').material as ShaderMaterial).toBeDefined()
    expect(((find<Mesh>(r!, 'letter-rings').material as ShaderMaterial).uniforms.uTurn.value as number)).toBeGreaterThan(0)
  })

  it('makes the same changes under the same seed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const one = await run(8)
    await r!.unmount()
    r = null
    const two = await run(8)
    expect(two).toEqual(one)
  })

  it('with reduced motion the ring holds still: no turn, no glyph changes', async () => {
    ;(globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} })
    const frames = await run(15)
    for (let f = 1; f < frames.length; f++) expect(changed(frames[f - 1], frames[f])).toBe(0)
    expect((find<Mesh>(r!, 'letter-rings').material as ShaderMaterial).uniforms.uTurn.value).toBe(0)
  })

  it('thins its ring far off and hides it below a fingertip, in the shader, from the same numbers as the rule', async () => {
    await run(0)
    const shader = (find<Mesh>(r!, 'letter-rings').material as ShaderMaterial).vertexShader
    expect(shader).toContain(`px < ${RING_HIDE_PX.toFixed(1)}`)
    expect(shader).toContain(`px < ${RING_THIN_PX.toFixed(1)}`)
  })
})
