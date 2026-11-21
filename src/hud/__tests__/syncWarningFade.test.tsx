/**
 * syncWarningFade.test.tsx - the LOSING SYNC warning fades in with fluid
 * WALK's slowdown (arkinox, 2026-11-17: "fade in the sync warning relative
 * to the slowdown amount with 14=0% and 20=100% opacity"): its opacity by
 * the events ahead, hidden while not walking, and the same box (fixed, no
 * space taken) at every opacity.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const st = vi.hoisted(() => ({ walking: true, ahead: 0 }))
vi.mock('../../store/useCyberspace', () => ({
  useCyberspace: (sel: (s: { walking: boolean }) => unknown) => sel({ walking: st.walking }),
}))
vi.mock('../../store/walkAhead', () => ({ useEventsAhead: () => st.ahead }))

import { SyncWarning } from '../SyncWarning'

function draw(ahead: number, walking = true): string {
  st.ahead = ahead
  st.walking = walking
  return renderToStaticMarkup(<SyncWarning />)
}

const opacityOf = (html: string): number => Number(/opacity:\s*([\d.]+)/.exec(html)![1])

describe('the LOSING SYNC warning', () => {
  it('is hidden at 14 events ahead and fewer', () => {
    for (const n of [0, 5, 14]) {
      const html = draw(n)
      expect(opacityOf(html)).toBe(0)
      expect(html).not.toContain('is-on')
      expect(html).toContain('aria-hidden="true"')
    }
  })

  it('fades in from 15: half shown at 17, fully at 20 and past', () => {
    expect(opacityOf(draw(15))).toBeCloseTo(1 / 6, 6)
    expect(opacityOf(draw(17))).toBeCloseTo(0.5, 6)
    expect(opacityOf(draw(20))).toBe(1)
    expect(opacityOf(draw(26))).toBe(1)
    const html = draw(17)
    expect(html).toContain('is-on')
    expect(html).toContain('aria-hidden="false"')
    expect(html).toContain('PROOF CHAIN 17 BEHIND')
  })

  it('is hidden out of WALK, however far ahead', () => {
    expect(opacityOf(draw(20, false))).toBe(0)
  })

  it('is the same box at every opacity: only the opacity changes', () => {
    // The line under it takes a tap only once the box is half shown (is-tappable, disabled, its aria-hidden).
    const strip = (html: string): string => html.replace(/ style="[^"]*"/, '').replace(/ is-on/, '').replace(/ is-tappable/, '').replace(/ aria-hidden="\w+"/g, '').replace(/\d+ BEHIND/, 'N BEHIND').replace(/ disabled=""/, '')
    const base = strip(draw(3))
    for (const n of [15, 17, 20]) expect(strip(draw(n))).toBe(base)
  })
})
