/**
 * bySizeKeys.test.tsx - BY SIZE on the bench's keys (owner, 2026-11-23,
 * item 8): X switches it, and with it on the move keys step what is held by
 * its own size; the handles' drag snaps in the same steps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PerspectiveCamera } from 'three'

const camera = new PerspectiveCamera(50, 375 / 812, 0.1, 1000)
camera.position.set(10, 9, 12)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld()

vi.mock('@react-three/fiber', async (real) => ({
  ...(await real<object>()),
  useFrame: () => undefined,
  useThree: (pick: (s: unknown) => unknown) => pick({ gl: {}, invalidate: () => undefined, controls: null, camera, size: { width: 375, height: 812 } }),
}))

const { createElement } = await import('react')
const { mount } = await import('../../test/elementRoot')
const { Keys } = await import('../Bench')
const { useWorkshop } = await import('../../store/useWorkshop')
const { handleSteps } = await import('../benchAxes')
const { newShard, ticksOf, TICKS_PER_UNIT: T } = await import('sno-core/shards')

const listeners = new Set<(e: unknown) => void>()
const press = (code: string): void => {
  const e = { code, key: code, target: null, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: () => {} }
  for (const f of [...listeners]) f(e)
}

/** A block 16 units every way, every corner held. */
function block() {
  const corners: Array<[number, number, number]> = []
  for (const x of [0, 16]) for (const y of [0, 16]) for (const z of [0, 16]) corners.push([x * T, y * T, z * T])
  return { ...newShard('Mountain'), extent: 64, vertices: corners.map((p) => ({ p: [p[0] / T, p[1] / T, p[2] / T] as [number, number, number], c: [1, 1, 1] as [number, number, number] })) }
}

let m: { unmount: () => Promise<void> | void } | null = null
beforeEach(async () => {
  listeners.clear()
  vi.stubGlobal('window', { addEventListener: (t: string, f: (e: unknown) => void) => { if (t === 'keydown') listeners.add(f) }, removeEventListener: (t: string, f: (e: unknown) => void) => { if (t === 'keydown') listeners.delete(f) }, innerWidth: 375, innerHeight: 812 })
  const s = block()
  useWorkshop.setState({ open: true, shards: [s], currentId: s.id, tool: 'select', selection: s.vertices.map((_, i) => i), partSel: [], selectedFaces: [], facePick: [], past: [], future: [], eyeEdit: false, division: 1, notice: null, stepBySize: false })
  m = await mount(createElement(Keys))
})
afterEach(async () => { await m?.unmount(); m = null; vi.unstubAllGlobals() })

const xs = (): number[] => useWorkshop.getState().current()!.vertices.map((v) => ticksOf(v)[0])

describe('BY SIZE keys', () => {
  it('X switches BY SIZE; a move key then steps the whole 16-gibson block by 16', () => {
    const start = Math.min(...xs())
    press('KeyD')
    const snapStep = Math.min(...xs()) - start
    expect(Math.abs(snapStep)).toBe(useWorkshop.getState().step())
    press('KeyX')
    expect(useWorkshop.getState().stepBySize).toBe(true)
    const at = Math.min(...xs())
    press('KeyD')
    expect(Math.abs(Math.min(...xs()) - at)).toBe(16 * T)
    press('KeyX')
    expect(useWorkshop.getState().stepBySize).toBe(false)
  })

  it('a held X and SET EYE leave the switch alone', () => {
    const listenersCopy = [...listeners]
    for (const f of listenersCopy) f({ code: 'KeyX', key: 'x', repeat: true, target: null, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, preventDefault: () => {} })
    expect(useWorkshop.getState().stepBySize).toBe(false)
    useWorkshop.setState({ eyeEdit: true })
    press('KeyX')
    expect(useWorkshop.getState().stepBySize).toBe(false)
    useWorkshop.setState({ eyeEdit: false })
  })

  it('LOOK leaves the switch alone', () => {
    useWorkshop.setState({ tool: 'view' })
    press('KeyX')
    expect(useWorkshop.getState().stepBySize).toBe(false)
  })

  it('a handle drag snaps in steps of the size: 20 units of drag is one 16-unit step, 25 is two', () => {
    const perUnit: [number, number] = [10, 0]
    expect(handleSteps(200, 0, perUnit, T, 16 * T)).toBe(1)
    expect(handleSteps(250, 0, perUnit, T, 16 * T)).toBe(2)
    expect(handleSteps(70, 0, perUnit, T, 16 * T)).toBe(0)
  })
})
