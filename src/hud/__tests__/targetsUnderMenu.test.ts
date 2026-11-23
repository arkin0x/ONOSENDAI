/**
 * targetsUnderMenu.test.ts - the target markers draw under the menu's panels,
 * never over them (owner, 2026-11-23: "can we make these target markers not
 * go over the menus?"), and never take a tap.
 *
 * Read from the stylesheet's own text: the markers' layer is rendered before
 * the HUD (App.tsx), so a z-index no higher than the HUD's puts every panel
 * over every marker; it was 2, over the HUD's 1.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')
const APP = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8')

/** The declarations of the first rule whose selector is exactly `sel`. */
function rule(sel: string): string {
  const at = CSS.search(new RegExp(`(^|\\n)${sel.replace('.', '\\.')} \\{`))
  expect(at, sel).toBeGreaterThanOrEqual(0)
  const open = CSS.indexOf('{', at)
  return CSS.slice(open + 1, CSS.indexOf('}', open))
}

function zIndex(sel: string): number {
  const m = /z-index:\s*(-?\d+)/.exec(rule(sel))
  expect(m, `${sel} z-index`).not.toBeNull()
  return Number(m![1])
}

describe('the target markers and the menu', () => {
  it('draws the markers under the panels', () => {
    expect(zIndex('.targets')).toBeLessThan(zIndex('.hud'))
    // Rendered before the HUD, so even an equal z-index would leave the panels on top.
    expect(APP.indexOf('<TargetsHere />')).toBeLessThan(APP.indexOf('<Hud menuOpen'))
  })

  it('never takes a tap', () => {
    expect(rule('.targets')).toMatch(/pointer-events:\s*none/)
    // No rule for a marker or any part of one gives taps back: .target,
    // .target__*, .target--*, and anything under the .targets layer. The
    // TARGETS panel's own rows (.targets__row and the like) are not markers.
    expect(CSS).not.toMatch(/\.target(__[a-z-]+|--[a-z-]+)?[\s,:[{][^{}]*\{[^}]*pointer-events:\s*auto/)
    expect(CSS).not.toMatch(/\.targets[\s,:[{][^{}]*\{[^}]*pointer-events:\s*auto/)
  })
})
