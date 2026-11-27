/**
 * heldGlow.test.tsx - the glow of a glowing block in hand on screen
 * (terrain/HeldGlow.tsx): the halo round the carried block and the tint at
 * the screen's edges in the block's colour, none for a block that does not
 * glow, and no breathing with reduced motion.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { mount, type Host } from '../../test/elementRoot'
import { HeldHalo, HeldVignette, useHeldGlow } from '../HeldGlow'

function Glow({ id }: { id: number }): ReactElement | null {
  const look = useHeldGlow(id)
  if (!look) return null
  return createElement('div', null, createElement(HeldVignette, { look }), createElement(HeldHalo, { look }))
}

const byClass = (all: Host[], name: string): Host | undefined => all.find((h) => String(h.props.className ?? '').split(' ').includes(name))

describe('the glow in hand', () => {
  it('draws the halo and the edge tint in Glowcore\'s cyan, at full strength, breathing while motion is allowed', async () => {
    const m = await mount(createElement(Glow, { id: 42 }))
    const all = m.all()
    const vignette = byClass(all, 'terrain-held-vignette')!
    expect((vignette.props.style as Record<string, string>)['--held-glow']).toBe('0, 229, 255')
    expect((vignette.props.style as Record<string, string>)['--held-glow-k']).toBe('1.000')
    expect(byClass(all, 'terrain-held-halo')).toBeTruthy()
    expect(byClass(all, 'terrain-held-halo__light')!.props.className).toContain('is-pulsing')
    await m.unmount()
  })

  it('draws nothing for a block that does not glow', async () => {
    const m = await mount(createElement(Glow, { id: 1 }))
    expect(m.all()).toHaveLength(0)
    await m.unmount()
  })

  it('never takes a tap, and holds still with reduced motion in the page\'s own rules too', () => {
    const css = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
    const rule = (sel: string): string => css.slice(css.indexOf(`${sel} {`), css.indexOf('}', css.indexOf(`${sel} {`)))
    expect(rule('.terrain-held-vignette')).toContain('pointer-events: none')
    expect(rule('.terrain-held-halo')).toContain('pointer-events: none')
    expect(rule('.terrain-held-halo')).toContain('plus-lighter')
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.terrain-held-halo__light\.is-pulsing \{ animation: none; \}/)
  })
})
