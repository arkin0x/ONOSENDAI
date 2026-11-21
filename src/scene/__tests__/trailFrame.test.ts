/**
 * trailFrame.test.ts: a landing shifts the trail; it does not lay the whole
 * chain out again (owner's phone walk of 2026-11-21: on a 2,600-action chain
 * every landing and every publish-status change worked out every position's
 * place from its BigInt coordinates, a long task per step).
 *
 * What would go wrong silently: a vertex drawn anywhere else than it was,
 * after any number of landings, at any zoom or turn of the view.
 */
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const calls = vi.hoisted(() => ({ placeCentre: 0 }))
vi.mock('../../lib/space', async (real) => {
  const actual = await real<typeof import('../../lib/space')>()
  return { ...actual, placeCentre: (...a: Parameters<typeof actual.placeCentre>) => { calls.placeCentre++; return actual.placeCentre(...a) } }
})

import { CONTINUOUS_SCALE_MIN, placeCentre, viewAxes, type Position, type ViewAxes } from '../../lib/space'
import { alignedOrigin } from '../../store/useCyberspace'
import { TRAIL_FRAME_MAX_CELLS, frameCentre, trailFrame, trailShift } from '../PathTrail'
import { Quaternion } from 'three'

const BASE = 1n << 84n
const at = (x: bigint, y: bigint, z: bigint): Position => ({ x: BASE + x, y: BASE + y, z: BASE + z })
const AXES: ViewAxes[] = [viewAxes(new Quaternion()), viewAxes(new Quaternion().setFromAxisAngle({ x: 0, y: 1, z: 0 } as never, Math.PI / 2)), viewAxes(new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0 } as never, Math.PI))]

/** A walk of `n` steps, each a gibson or a few along some axis, as WALK lands them. */
function walk(n: number, seed: number): Position[] {
  const out: Position[] = [at(0n, 0n, 0n)]
  let s = seed
  for (let i = 1; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const p = out[i - 1]
    const d = BigInt((s % 7) - 3)
    out.push(s % 3 === 0 ? { ...p, x: p.x + d } : s % 3 === 1 ? { ...p, y: p.y + d } : { ...p, z: p.z + d })
  }
  return out
}

describe('the trail laid out in a frame and shifted', () => {
  for (const scaleExp of [0, 3, 12]) {
    for (const [i, axes] of AXES.entries()) {
      it(`places every vertex exactly where placeCentre does, after every landing (zoom ${scaleExp}, view ${i})`, () => {
        const path = walk(300, 7 + scaleExp + i)
        let frame = trailFrame(null, alignedOrigin(path[0], scaleExp), scaleExp, axes)
        for (let k = 0; k < path.length; k += 7) {
          const origin = alignedOrigin(path[k], scaleExp)
          frame = trailFrame(frame, origin, scaleExp, axes)
          const shift = trailShift(frame, origin)
          for (const p of path.slice(0, k + 1)) {
            const c = frameCentre(frame, p)
            const want = placeCentre(p, origin, scaleExp, axes)
            // As the geometry stores them, then shifted as the group draws them.
            // -0 and 0 draw the same point: compared as numbers.
            for (let a = 0; a < 3; a++) expect(Math.fround(c[a]) + shift[a] + 0).toBe(Math.fround(want[a]) + 0)
          }
        }
      })
    }
  }

  it('keeps one frame across a walk, working out each position once', () => {
    const path = walk(500, 3)
    const axes = AXES[0]
    let frame = trailFrame(null, alignedOrigin(path[0], 0), 0, axes)
    const first = frame
    calls.placeCentre = 0
    for (let k = 0; k < path.length; k++) {
      frame = trailFrame(frame, alignedOrigin(path[k], 0), 0, axes)
      // Every landing lays out the whole trail so far, as PathTrail's rebuild does.
      for (const p of path.slice(0, k + 1)) frameCentre(frame, p)
    }
    expect(frame).toBe(first)
    expect(calls.placeCentre).toBe(path.length)
  })

  it('starts a new frame for another zoom, another view, a far jump, or the continuous range', () => {
    const o = alignedOrigin(at(0n, 0n, 0n), 0)
    const f = trailFrame(null, o, 0, AXES[0])
    expect(trailFrame(f, o, 1, AXES[0])).not.toBe(f)
    expect(trailFrame(f, o, 0, AXES[1])).not.toBe(f)
    expect(trailFrame(f, alignedOrigin(at(BigInt(TRAIL_FRAME_MAX_CELLS) + 1n, 0n, 0n), 0), 0, AXES[0])).not.toBe(f)
    expect(trailFrame(f, alignedOrigin(at(BigInt(TRAIL_FRAME_MAX_CELLS), 0n, 0n), 0), 0, AXES[0])).toBe(f)
    const c = trailFrame(null, alignedOrigin(at(0n, 0n, 0n), CONTINUOUS_SCALE_MIN), CONTINUOUS_SCALE_MIN, AXES[0])
    expect(trailFrame(c, c.ref, CONTINUOUS_SCALE_MIN, AXES[0])).not.toBe(c)
  })
})

vi.mock('@react-three/fiber', async (real) => ({ ...(await real<object>()), useFrame: () => undefined }))

describe('PathTrail on a walk', () => {
  it('works out only the new position at each landing, and draws the trail shifted to the new origin', async () => {
    const { createElement } = await import('react')
    const { mount } = await import('../../test/elementRoot')
    const { useCyberspace } = await import('../../store/useCyberspace')
    const { PathTrail } = await import('../PathTrail')
    const path = walk(400, 11)
    const axes = AXES[0]
    const land = (k: number): void => useCyberspace.setState({ positionHistory: path.slice(0, k + 1), anchor: path[k], position: path[k], showTrail: true, spectate: null, focus: null, exploreIndex: null })
    land(300)
    const m = await mount(createElement(PathTrail, { axes, scaleExp: 0 }))
    const group = () => m.all().find((h) => h.type === 'group')!
    calls.placeCentre = 0
    for (let k = 301; k <= 320; k++) {
      land(k)
      await new Promise((r) => setTimeout(r, 1))
      const want = trailShift(trailFrame(null, alignedOrigin(path[300], 0), 0, axes), alignedOrigin(path[k], 0))
      expect((group().props.position as number[]).map((v) => v + 0)).toEqual(want)
    }
    // One new position a landing, not the whole trail again.
    expect(calls.placeCentre).toBe(20)
    await m.unmount()
  })
})
