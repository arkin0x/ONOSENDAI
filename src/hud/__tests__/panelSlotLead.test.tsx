/**
 * A panel pinned to the top by a priority state opens there whatever its
 * saved fold, and the saved fold is left alone (arkinox, 2026-10-14).
 */
import { describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
// The hyperspace panel saved folded, before the layout store loads.
localStorage.setItem('onosendai:panel-layout', JSON.stringify({ collapsed: { hyperspace: true } }))

import { renderToStaticMarkup } from 'react-dom/server'
const { PanelSlot } = await import('../PanelSlot')
const { usePanelLayout } = await import('../../store/usePanelLayout')

const draw = (lead: boolean): string => renderToStaticMarkup(
  <PanelSlot id="hyperspace" lead={lead} lifting={false} onGrab={() => {}}><section className="panel" /></PanelSlot>,
)

describe('a panel pinned to the top', () => {
  it('is drawn open while pinned, though it is saved folded', () => {
    expect(usePanelLayout.getState().collapsed.hyperspace).toBe(true)
    expect(draw(true)).not.toContain('slot--collapsed')
  })
  it('is drawn folded again in its own place, the saved fold untouched', () => {
    expect(draw(false)).toContain('slot--collapsed')
    expect(usePanelLayout.getState().collapsed.hyperspace).toBe(true)
  })
})
