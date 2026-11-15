/**
 * glowRows.test.tsx - POINT SIZE, GLOW, RADIUS and GLOW STRENGTH in the
 * SHARD sheet (owner rulings, 2026-11-15): always all four, greyed but in
 * place outside POINTS, RADIUS and GLOW STRENGTH greyed while GLOW is OFF,
 * setters writing `extra` through sno-core, one undo per drag, OFF then
 * LIGHT putting the last radius and strength back, and the pre-pick.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { mount, type Host } from '../../test/elementRoot'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { newShard, type ShardMode, type ShardModel } from 'sno-core/shards'
import { useWorkshop } from '../../store/useWorkshop'
import { GLOW_START } from '../../lib/pointGlow'
import { GLOW_NOTE, PointGlowRows } from '../glowRows'

const w = useWorkshop.getState
const SOURCES = ['glowRows.tsx', 'railRow.tsx', 'shardRows.tsx', join('sheets', 'ShardSheet.tsx')].map((f) => readFileSync(join(__dirname, '..', f), 'utf8')).join('\n')

function shard(mode: ShardMode, extra?: Record<string, unknown>, c: [number, number, number] = [1, 1, 1]): ShardModel {
  return { ...newShard('Forest'), mode, vertices: [{ p: [0, 0, 0], c }, { p: [1, 0, 0], c }], ...(extra ? { extra } : {}) }
}
function load(s: ShardModel): void {
  useWorkshop.setState({ shards: [s], currentId: s.id, past: [], future: [], glowLast: { ...GLOW_START }, color: [0, 0.9, 1] })
}
const extra = (): Record<string, unknown> | undefined => w().current()?.extra

/** Each row's group, by its accessible name, and whether it is greyed. */
function rows(html: string): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const m of html.matchAll(/<div class="workshop__row ws__railrow ?([^"]*)"[^>]*?(?:aria-label="([^"]+)")?[^>]*>\s*<span class="workshop__label ws__raillabel"[^>]*>([^<]+)</g)) out[m[3]] = m[1].includes('is-off')
  return out
}

describe('the four rows', () => {
  it('are all present in every mode, under labels POINT SIZE, GLOW, RADIUS and GLOW STRENGTH, with the gray line', () => {
    for (const mode of ['solid', 'points', 'lines'] as const) {
      load(shard(mode))
      const html = renderToStaticMarkup(<PointGlowRows />)
      expect(Object.keys(rows(html))).toEqual(['POINT SIZE', 'GLOW', 'RADIUS', 'GLOW STRENGTH'])
      expect(html).toContain(GLOW_NOTE)
    }
  })

  it('in POINTS with GLOW OFF: POINT SIZE and GLOW live, RADIUS and GLOW STRENGTH greyed', () => {
    load(shard('points'))
    const html = renderToStaticMarkup(<PointGlowRows />)
    expect(rows(html)).toEqual({ 'POINT SIZE': false, GLOW: false, RADIUS: true, 'GLOW STRENGTH': true })
    expect(html).toContain('aria-pressed="true" title="No glow"')
  })

  it('in POINTS with a glow: all four live, the style pressed, the values shown', () => {
    load(shard('points', { pointsize: 36, glow: ['fog', 240, 35] }))
    const html = renderToStaticMarkup(<PointGlowRows />)
    expect(rows(html)).toEqual({ 'POINT SIZE': false, GLOW: false, RADIUS: false, 'GLOW STRENGTH': false })
    expect(html).toMatch(/is-on[^"]*" aria-pressed="true"[^>]*>(<svg[\s\S]*?<\/svg>)FOG</)
    expect(html).toContain('aria-valuenow="36"')
    expect(html).toContain('aria-valuetext="0.3 gibsons"')
    expect(html).toContain('aria-valuenow="240"')
    expect(html).toContain('aria-valuetext="2 gibsons"')
    expect(html).toContain('aria-valuenow="35"')
    expect(html).toContain('aria-valuetext="35%"')
    expect(html).toContain('lucide-cloud-fog')
    expect(html).toContain('lucide-sun')
  })

  it('in SOLID and LINES: all four greyed and disabled, values kept', () => {
    for (const mode of ['solid', 'lines'] as const) {
      load(shard(mode, { pointsize: 36, glow: ['light', 120, 40] }))
      const html = renderToStaticMarkup(<PointGlowRows />)
      expect(rows(html)).toEqual({ 'POINT SIZE': true, GLOW: true, RADIUS: true, 'GLOW STRENGTH': true })
      expect(html).toContain('aria-valuenow="36"')
      expect(html).toContain('aria-valuenow="40"')
      // Every button greyed, every rail out of the tab order.
      expect(html).not.toMatch(/<button(?![^>]*disabled)[^>]*>/)
      expect(html).not.toContain('tabindex="0"')
    }
  })

  it('shows AUTO with no point size, and gibsons at a larger unit', () => {
    load(shard('points'))
    expect(renderToStaticMarkup(<PointGlowRows />)).toContain('aria-valuetext="AUTO"')
    load({ ...shard('points', { pointsize: 120 }), unit: 10 })
    const html = renderToStaticMarkup(<PointGlowRows />)
    expect(html).toContain('aria-valuetext="1.02K gibsons"')
    expect(html).toContain('ws__gibsons-word">GIBSONS<')
  })

  it('outlines the suggested style while OFF: LIGHT for bright points, FOG for dark', () => {
    load(shard('points', undefined, [1, 0.95, 0.6]))
    expect(renderToStaticMarkup(<PointGlowRows />)).toMatch(/is-suggested"[^>]*>(<svg[\s\S]*?<\/svg>)LIGHT</)
    load(shard('points', undefined, [0.15, 0.2, 0.15]))
    expect(renderToStaticMarkup(<PointGlowRows />)).toMatch(/is-suggested"[^>]*>(<svg[\s\S]*?<\/svg>)FOG</)
  })

  it('never says glow opacity', () => {
    expect(SOURCES.toLowerCase()).not.toContain('glow opacity')
    expect(readFileSync(join(__dirname, '..', '..', 'lib', 'pointGlow.ts'), 'utf8').toLowerCase()).not.toContain('glow opacity')
  })
})

describe('the setters', () => {
  beforeEach(() => load(shard('points')))

  it('setPointSize writes whole ticks into extra, 0 included, and undefined removes it', () => {
    w().setPointSize(48)
    expect(extra()).toEqual({ pointsize: 48 })
    w().setPointSize(0)
    expect(extra()).toEqual({ pointsize: 0 })
    w().setPointSize(undefined)
    expect(extra()).toBeUndefined()
    expect(w().past.length).toBe(3)
    // Already so: no edit.
    w().setPointSize(undefined)
    expect(w().past.length).toBe(3)
  })

  it('setGlow from OFF starts at 1 unit and 40%, the style asked, and OFF removes it', () => {
    w().setGlow({ style: 'fog' })
    expect(extra()).toEqual({ glow: ['fog', 120, 40] })
    w().setGlow({ radius: 300 })
    w().setGlow({ strength: 65 })
    expect(extra()).toEqual({ glow: ['fog', 300, 65] })
    w().setGlow(null)
    expect(extra()).toBeUndefined()
  })

  it('OFF then LIGHT puts the last radius and strength back', () => {
    w().setGlow({ style: 'fog', radius: 480, strength: 22 })
    w().setGlow(null)
    w().setGlow({ style: 'light' })
    expect(extra()).toEqual({ glow: ['light', 480, 22] })
  })

  it('with no style, pre-picks from the points: LIGHT for bright, FOG for dark', () => {
    w().setGlow({})
    expect(extra()).toEqual({ glow: ['light', 120, 40] })
    load(shard('points', undefined, [0.1, 0.12, 0.1]))
    w().setGlow({})
    expect(extra()).toEqual({ glow: ['fog', 120, 40] })
  })

  it('keeps other extra fields, and never writes a malformed glow', () => {
    load(shard('points', { anim: [['turn', 1, 60]] }))
    w().setGlow({ style: 'light' })
    w().setPointSize(24)
    expect(extra()).toEqual({ anim: [['turn', 1, 60]], glow: ['light', 120, 40], pointsize: 24 })
    w().setGlow(null)
    w().setPointSize(undefined)
    expect(extra()).toEqual({ anim: [['turn', 1, 60]] })
  })
})

describe('a drag', () => {
  /** The slider named `name`, with a rail 100 px wide at x 0. */
  function slider(all: Host[], name: string): Host {
    const h = all.find((x) => x.props.role === 'slider' && x.props['aria-label'] === name)!
    Object.assign(h, { getBoundingClientRect: () => ({ left: 0, width: 100 }) })
    return h
  }
  const target = { setPointerCapture: () => {}, focus: () => {} }
  const ev = (x: number) => ({ clientX: x, pointerId: 1, currentTarget: target, preventDefault: () => {}, stopPropagation: () => {} })

  it('updates the model on every step and undoes in one step', async () => {
    load(shard('points', { glow: ['light', 120, 40] }))
    const m = await mount(<PointGlowRows />)
    for (const [name, check] of [
      ['Point size', () => typeof extra()?.pointsize === 'number'],
      ['Glow radius', () => (extra()?.glow as unknown[])[1] !== 120],
      ['Glow strength', () => (extra()?.glow as unknown[])[2] !== 40],
    ] as const) {
      const before = w().current()
      const past = w().past.length
      const s = slider(m.all(), name)
      ;(s.props.onPointerDown as (e: unknown) => void)(ev(30))
      expect(check()).toBe(true)
      ;(s.props.onPointerMove as (e: unknown) => void)(ev(50))
      ;(s.props.onPointerMove as (e: unknown) => void)(ev(70))
      expect(w().past.length).toBeGreaterThan(past + 1)
      ;(s.props.onPointerUp as () => void)()
      expect(w().past.length).toBe(past + 1)
      expect(w().past[w().past.length - 1]).toBe(before)
    }
    w().undo()
    w().undo()
    w().undo()
    expect(extra()).toEqual({ glow: ['light', 120, 40] })
    await m.unmount()
  })

  it('in SOLID does nothing', async () => {
    load(shard('solid'))
    const m = await mount(<PointGlowRows />)
    ;(slider(m.all(), 'Point size').props.onPointerDown as (e: unknown) => void)(ev(50))
    expect(extra()).toBeUndefined()
    expect(w().past.length).toBe(0)
    await m.unmount()
  })
})
