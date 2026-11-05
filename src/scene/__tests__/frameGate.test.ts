/**
 * The idle frame cap (lib/frameGate, scene/frameDriver): when nothing moves the main
 * view draws at no more than 60 a second, and anything at all brings every frame
 * back on the next one. When unsure, it is not idle.
 */
import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameGate, WAKE_EVENTS, WAKE_HOLD_MS, sceneStamp } from '../../lib/frameGate'

vi.mock('@react-three/fiber', () => ({ advance: () => {}, useThree: () => ({}), useFrame: () => {} }))

import { viewBusy } from '../frameDriver'
import { useBuilder } from '../../store/useBuilder'
import { useCeremony } from '../../store/useCeremony'
import { useCyberspace } from '../../store/useCyberspace'
import { useDemo } from '../../store/useDemo'
import { useHyperspace } from '../../store/useHyperspace'
import { useOpenCeremony } from '../../store/useOpenCeremony'
import { useShards } from '../../store/useShards'
import { useTv } from '../../store/useTv'
import { useViewFly } from '../../lib/viewFly'

const frames = (hz: number, ms: number): number[] => Array.from({ length: Math.floor((ms * hz) / 1000) }, (_, i) => 5000 + (i * 1000) / hz)
/** How many of these display frames an idle gate draws. */
function idleDraws(hz: number, ms = 2000): number {
  const gate = new FrameGate()
  gate.wake(0)
  return frames(hz, ms).filter((t) => gate.shouldDraw(t, false)).length
}

describe('the rate', () => {
  it('holds a 144 Hz display to no more than 60 a second when idle', () => {
    const n = idleDraws(144)
    expect(n).toBeLessThanOrEqual(121)
    expect(n).toBeGreaterThan(90)
  })

  it('draws every frame of a 60 Hz display or slower: a phone sees nothing change', () => {
    expect(idleDraws(60)).toBe(frames(60, 2000).length)
    expect(idleDraws(30)).toBe(frames(30, 2000).length)
  })

  it('stays at or under 60 on the rates between', () => {
    for (const hz of [75, 90, 100, 120, 165, 240]) {
      expect(idleDraws(hz)).toBeLessThanOrEqual(121)
      expect(idleDraws(hz)).toBeGreaterThan(70)
    }
  })

  it('starts awake', () => {
    const gate = new FrameGate()
    for (const t of frames(144, WAKE_HOLD_MS - 10)) expect(gate.shouldDraw(t, false)).toBe(true)
  })
})

describe('waking', () => {
  const idleGateAt = (t: number): FrameGate => {
    const gate = new FrameGate()
    gate.wake(t - WAKE_HOLD_MS - 500)
    return gate
  }

  it('an input draws on the very next display frame, even one an idle gate would have skipped', () => {
    const gate = idleGateAt(10_000)
    expect(gate.shouldDraw(10_000, false)).toBe(true)
    // 7 ms on, inside the idle gap.
    expect(gate.shouldDraw(10_007, false)).toBe(false)
    gate.wake(10_010)
    expect(gate.shouldDraw(10_014, false)).toBe(true)
  })

  it('stays at every frame for the hold, then falls back', () => {
    const gate = idleGateAt(10_000)
    gate.wake(10_000)
    for (let t = 10_000; t < 10_000 + WAKE_HOLD_MS; t += 7) expect(gate.shouldDraw(t, false)).toBe(true)
    const after = 10_000 + WAKE_HOLD_MS
    // Back on the idle grid: a frame's gap after the last one drawn, and none between.
    expect(gate.shouldDraw(after, false)).toBe(false)
    expect(gate.shouldDraw(after + 20, false)).toBe(true)
    expect(gate.shouldDraw(after + 22, false)).toBe(false)
  })

  it('busy draws every frame, however long since anything else', () => {
    const gate = idleGateAt(10_000)
    for (let t = 10_000; t < 12_000; t += 7) expect(gate.shouldDraw(t, true)).toBe(true)
  })

  it('every way a person acts is heard', () => {
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'keyup', 'touchstart', 'touchmove', 'touchend', 'resize', 'focus']) {
      expect(WAKE_EVENTS).toContain(name)
    }
  })

  it('the driver wires them all, before the frame is decided, and draws through advance', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '../frameDriver.tsx'), 'utf8')
    expect(text).toMatch(/for \(const name of WAKE_EVENTS\) window\.addEventListener\(name, wake, \{ capture: true, passive: true \}\)/)
    expect(text).toMatch(/document\.addEventListener\('visibilitychange', wake\)/)
    expect(text).toMatch(/if \(!gate\.shouldDraw\(t, viewBusy\(\)\)\) return/)
    expect(text).toMatch(/advance\(elapsed\.current, false, state\)/)
    expect(text).toMatch(/if \(now !== stamp\) gate\.wake\(t\)/)
    expect(text).toMatch(/STORES\.map/)
  })

  it('the canvas leaves the drawing to the driver', () => {
    const scene = fs.readFileSync(path.resolve(__dirname, '../Scene.tsx'), 'utf8')
    expect(scene).toMatch(/frameloop="never"/)
    expect(scene).toMatch(/<FrameDriver \/>/)
  })
})

describe('what counts as the view changing', () => {
  const matrix = (): { elements: number[] } => ({ elements: Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0)) })
  const scene = (): { root: Record<string, never>; camera: { matrixWorld: { elements: number[] } } ; mesh: Record<string, unknown>; shader: Record<string, unknown>; ambient: Record<string, unknown> } => {
    const mesh = { visible: true, matrixWorld: matrix(), material: { opacity: 1, version: 3 }, geometry: { attributes: { position: { version: 1 } } } }
    const shader = { matrixWorld: matrix(), material: { uniforms: { uTime: { value: 1.5 } } } }
    const ambient = { matrixWorld: matrix(), material: { userData: { ambient: true }, uniforms: { uTime: { value: 1.5 } } } }
    return { root: { children: [mesh, shader, ambient], matrixWorld: matrix() } as never, camera: { matrixWorld: matrix() }, mesh, shader, ambient }
  }
  const changes = (act: (s: ReturnType<typeof scene>) => void): boolean => {
    const s = scene()
    const before = sceneStamp(s.root as never, s.camera as never)
    act(s)
    return sceneStamp(s.root as never, s.camera as never) !== before
  }
  const m = (o: Record<string, unknown>): { opacity: number; version: number; uniforms: Record<string, { value: number }> } => o.material as never
  const place = (o: Record<string, unknown>): number[] => (o.matrixWorld as { elements: number[] }).elements

  it('nothing changed, the same stamp', () => {
    expect(changes(() => {})).toBe(false)
  })

  it('the camera moving or turning', () => {
    expect(changes((s) => { s.camera.matrixWorld.elements[12] += 0.001 })).toBe(true)
    expect(changes((s) => { s.camera.matrixWorld.elements[1] += 0.001 })).toBe(true)
  })

  it('anything moving or spinning', () => {
    expect(changes((s) => { place(s.mesh)[14] += 0.001 })).toBe(true)
    expect(changes((s) => { place(s.mesh)[0] -= 0.001 })).toBe(true)
  })

  it('a fade, a new material, new vertices, something shown or hidden', () => {
    expect(changes((s) => { m(s.mesh).opacity = 0.9 })).toBe(true)
    expect(changes((s) => { m(s.mesh).version++ })).toBe(true)
    expect(changes((s) => { (s.mesh.geometry as { attributes: { position: { version: number } } }).attributes.position.version++ })).toBe(true)
    expect(changes((s) => { s.mesh.visible = false })).toBe(true)
  })

  it('something added or taken away', () => {
    expect(changes((s) => { (s.root as unknown as { children: unknown[] }).children.pop() })).toBe(true)
  })

  it('any shader\'s time, so a new effect is awake without having to say so', () => {
    expect(changes((s) => { m(s.shader).uniforms.uTime.value += 0.016 })).toBe(true)
  })

  it('but not one marked ambient, the terrain\'s slow pulse', () => {
    expect(changes((s) => { m(s.ambient).uniforms.uTime.value += 0.016 })).toBe(false)
    const field = fs.readFileSync(path.resolve(__dirname, '../ShaderPointField.tsx'), 'utf8')
    expect(field).toMatch(/userData: \{ ambient: true \}/)
  })

  it('only the terrain is marked ambient', () => {
    const dir = path.resolve(__dirname, '..')
    const marked = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && /ambient: true/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    expect(marked).toEqual(['ShaderPointField.tsx'])
  })
})

describe('a shard that was found once', () => {
  it('does not keep the view awake for good: its birth stays listed long after its decode', () => {
    useCeremony.setState({ births: { a: 1 } } as never)
    expect(viewBusy()).toBe(false)
    useCeremony.setState({ births: {} } as never)
  })
})

describe('modes that are never idle', () => {
  beforeEach(() => {
    useCyberspace.setState({ walking: false, transit: null })
    useTv.setState({ on: false } as never)
    useDemo.setState({ active: false } as never)
    useBuilder.setState({ active: false } as never)
    useShards.setState({ pending: null } as never)
    useHyperspace.setState({ viewOwned: false, scrubHeight: null, viewedStop: null, destination: null } as never)
    useCeremony.setState({ births: {} } as never)
    useOpenCeremony.setState({ playing: {} } as never)
    useViewFly.setState({ button: 0, touch: 0 })
  })

  it('standing still with nothing going on is idle', () => {
    expect(viewBusy()).toBe(false)
  })

  const modes: Array<[string, () => void]> = [
    ['walking', () => useCyberspace.setState({ walking: true })],
    ['riding', () => useCyberspace.setState({ transit: {} as never })],
    ['TV', () => useTv.setState({ on: true } as never)],
    ['the tour', () => useDemo.setState({ active: true } as never)],
    ['building', () => useBuilder.setState({ active: true } as never)],
    ['placing a shard', () => useShards.setState({ pending: {} } as never)],
    ['a hyperspace view', () => useHyperspace.setState({ viewOwned: true } as never)],
    ['scrubbing the line', () => useHyperspace.setState({ scrubHeight: 5 } as never)],
    ['a stop in view', () => useHyperspace.setState({ viewedStop: 5 } as never)],
    ['a destination set', () => useHyperspace.setState({ destination: 5 } as never)],
    ['VIEW flying on a button', () => useViewFly.setState({ button: 1 })],
    ['VIEW flying on two fingers', () => useViewFly.setState({ touch: 1 })],
    ['a chest or door ceremony', () => useOpenCeremony.setState({ playing: { a: { kind: 'x', at: 0, calm: false } } } as never)],
  ]
  for (const [name, enter] of modes) {
    it(name, () => {
      enter()
      expect(viewBusy()).toBe(true)
    })
  }
})

