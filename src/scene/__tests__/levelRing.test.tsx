/**
 * levelRing.test.tsx: the ring of level bars round a hidden sound's box
 * (direction 7, Voice line): still and short while quiet, moving while it
 * plays from its card or where it is hidden, and still (raised) with reduced
 * motion. Run in a real R3F root (test/r3fRoot.ts): real three objects and frames.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { Matrix4, Vector3, type InstancedMesh } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { LevelRing, LEVEL_BARS, LEVEL_REST, stillLevel } from '../LevelRing'
import { cardKey, useHiddenAudio, worldKey } from '../../store/useHiddenAudio'

;(globalThis as { window?: unknown }).window ??= globalThis

let r: R3fRoot | null = null
beforeEach(() => {
  delete (globalThis as { matchMedia?: unknown }).matchMedia
  useHiddenAudio.setState({ entries: {} })
})
afterEach(async () => { await r?.unmount(); r = null; useHiddenAudio.setState({ entries: {} }) })

function bars(root: R3fRoot): InstancedMesh {
  let out: InstancedMesh | undefined
  root.state().scene.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) out = o as InstancedMesh })
  return out!
}
const lengths = (mesh: InstancedMesh): number[] => Array.from({ length: LEVEL_BARS }, (_, i) => { const m = new Matrix4(); mesh.getMatrixAt(i, m); return new Vector3().setFromMatrixScale(m).y })
const playing = (key: string): void => useHiddenAudio.setState({ entries: { [key]: { phase: 'playing', title: 'x', mode: key.startsWith('card') ? 'card' : 'world', itemKey: 's1' } } })

async function frames(n: number): Promise<number[][]> {
  const out: number[][] = []
  for (let f = 0; f < n; f++) { await r!.frame(); await new Promise((res) => setTimeout(res, 20)); out.push(lengths(bars(r!))) }
  return out
}

describe('the level ring', () => {
  it('rests short and still while the sound is quiet', async () => {
    r = await r3fRoot()
    await r.render(createElement(LevelRing, { id: 's1', at: [0, 0, 0] }))
    const seen = await frames(4)
    for (const f of seen) for (const l of f) expect(l).toBeCloseTo(LEVEL_REST, 6)
  })

  for (const key of [worldKey('s1'), cardKey('s1')]) {
    it(`moves while it plays (${key.split(':')[0]})`, async () => {
      playing(key)
      r = await r3fRoot()
      await r.render(createElement(LevelRing, { id: 's1', at: [0, 0, 0] }))
      const seen = await frames(5)
      expect(seen.some((f, i) => i > 0 && f.some((l, b) => Math.abs(l - seen[i - 1][b]) > 1e-4))).toBe(true)
      expect(Math.max(...seen.flat())).toBeGreaterThan(LEVEL_REST)
    })
  }

  it('with reduced motion stands still, raised while it plays', async () => {
    ;(globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce'), addEventListener: () => {}, removeEventListener: () => {} })
    playing(worldKey('s1'))
    r = await r3fRoot()
    await r.render(createElement(LevelRing, { id: 's1', at: [0, 0, 0] }))
    const seen = await frames(4)
    for (const f of seen) for (const l of f) expect(l).toBeCloseTo(stillLevel(true), 6)
  })
})
