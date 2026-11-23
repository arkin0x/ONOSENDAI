/**
 * bySizeChip.test.tsx - BY SIZE on the move handles (owner, 2026-11-23: "move
 * the selection by units of the selection itself"): the handles' middle is a
 * chip that switches the store's stepBySize, lit while on, printing the step
 * a move takes on X, Y and Z in grid units either way, with X printed on it;
 * the eye keeps its own middle; the chip's box never changes and clears the
 * knobs.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type Host } from '../../test/elementRoot'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

const { mount, textOf } = await import('../../test/elementRoot')
const { MoveHandles, HANDLE_REACH_PX, stepLine } = await import('../shell/MoveHandles')
const { useWorkshop } = await import('../../store/useWorkshop')
const { newShard, TICKS_PER_UNIT } = await import('sno-core/shards')

const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')
const cls = (h: Host): string => String(h.props.className ?? '')
const chip = (all: Host[]): Host | undefined => all.find((h) => cls(h).split(/\s+/).includes('ws__bysize'))
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5))

/** The eight corners of a block `n` units on a side. */
function block(n: number) {
  const s = newShard('Gibson block')
  const vertices: Array<{ p: [number, number, number]; c: [number, number, number] }> = []
  for (const x of [0, n]) for (const y of [0, n]) for (const z of [0, n]) vertices.push({ p: [x, y, z], c: [1, 1, 1] })
  return { ...s, extent: 40, vertices }
}

beforeEach(() => {
  const s = block(16)
  useWorkshop.setState({ open: true, shards: [s], currentId: s.id, tool: 'select', selection: [0, 1, 2, 3, 4, 5, 6, 7], partSel: [], selectedFaces: [], facePick: [], past: [], future: [], eyeEdit: false, division: 1, stepBySize: false })
})
afterEach(() => {
  useWorkshop.setState({ open: false, stepBySize: false })
  vi.unstubAllGlobals()
})

describe('BY SIZE on the move handles', () => {
  it('is the handles\' middle, off, printing the grid step; a tap lights it and prints the held size', async () => {
    const m = await mount(<MoveHandles />)
    const c = (): Host => chip(m.all()) as Host
    expect(c()).toBeDefined()
    expect(cls(c())).toContain('ws__handle-hub')
    expect(c().props['aria-pressed']).toBe(false)
    expect(textOf(c())).toContain('BY SIZE')
    expect(m.all().filter((h) => h.type === 'kbd').map((h) => textOf(h))).toEqual(['X'])
    expect(textOf(m.all().find((h) => cls(h) === 'ws__bysize-step') as Host)).toBe('1 × 1 × 1')
    ;(c().props.onClick as () => void)()
    await tick()
    expect(useWorkshop.getState().stepBySize).toBe(true)
    expect(c().props['aria-pressed']).toBe(true)
    expect(cls(c())).toContain('is-on')
    expect(textOf(m.all().find((h) => cls(h) === 'ws__bysize-step') as Host)).toBe('16 × 16 × 16')
    ;(c().props.onClick as () => void)()
    await tick()
    expect(useWorkshop.getState().stepBySize).toBe(false)
    await m.unmount()
  })

  it('follows X from the keyboard (the store), and a flat selection steps by the grid across its plane', async () => {
    useWorkshop.setState({ selection: [0, 2, 4, 6] })
    const m = await mount(<MoveHandles />)
    useWorkshop.getState().setStepBySize(true)
    await tick()
    expect(chip(m.all())?.props['aria-pressed']).toBe(true)
    expect(textOf(m.all().find((h) => cls(h) === 'ws__bysize-step') as Host)).toBe('16 × 16 × 1')
    await m.unmount()
  })

  it('gives way to the eye in SET EYE', async () => {
    useWorkshop.setState({ eyeEdit: true, selection: [] })
    const m = await mount(<MoveHandles />)
    expect(chip(m.all())).toBeUndefined()
    expect(m.all().some((h) => cls(h).includes('ws__handle-hub--eye'))).toBe(true)
    await m.unmount()
  })

  it('prints the step from the store: grid units, fractions as the level prints them', () => {
    expect(stepLine((a) => [16, 16, 16][a] * TICKS_PER_UNIT)).toBe('16 × 16 × 16')
    expect(stepLine(() => TICKS_PER_UNIT / 2)).toBe('1/2 × 1/2 × 1/2')
  })

  it('keeps one box on and off, a 44px target that clears every knob', () => {
    const at = CSS.indexOf('\n.ws__handle-hub.ws__bysize {')
    expect(at).toBeGreaterThan(-1)
    const rule = CSS.slice(at, CSS.indexOf('}', at))
    const px = (k: string): number => Number(new RegExp(`\\n  ${k}: (-?\\d+)px;`).exec(rule)?.[1])
    expect(px('height')).toBe(44)
    const w = px('width')
    expect(px('left')).toBe(-w / 2)
    expect(px('top')).toBe(-22)
    // The lit rule changes colors only.
    const lit = CSS.slice(CSS.indexOf('.ws__handle-hub.ws__bysize.is-on {'), CSS.indexOf('}', CSS.indexOf('.ws__handle-hub.ws__bysize.is-on {')))
    expect(lit).not.toMatch(/width|height|padding|left|top/)
    // Its nearest corner to a knob's middle, along any direction, stays a knob's radius (22) away.
    for (let deg = 0; deg < 360; deg += 1) {
      const t = (deg * Math.PI) / 180
      const kx = Math.cos(t) * HANDLE_REACH_PX
      const ky = Math.sin(t) * HANDLE_REACH_PX
      const nx = Math.max(-w / 2, Math.min(w / 2, kx))
      const ny = Math.max(-22, Math.min(22, ky))
      expect(Math.hypot(kx - nx, ky - ny)).toBeGreaterThan(22)
    }
  })

  it('has no em dash in its source or its CSS', () => {
    const src = readFileSync(join(__dirname, '..', 'shell', 'MoveHandles.tsx'), 'utf8')
    expect(src).not.toContain('\u2014')
    expect(CSS.slice(CSS.indexOf('/* BY SIZE (shell/MoveHandles.tsx'))).not.toContain('\u2014')
  })
})
