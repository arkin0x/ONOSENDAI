/**
 * terrainMenu.test.ts - the open menu covers TERRAIN (owner, 2026-11-24: "a
 * lot of terrain ui is appearing over the menu. the block is meant to be in
 * the bottom right of the whole screen under all ui elements"):
 *
 * - on a phone, where the menu covers the scene, TERRAIN's controls go under
 *   it, as WALK's pad does (App `crowded`);
 * - the carried block is drawn under the menu and every control, and never
 *   takes a tap.
 *
 * The boxes themselves are measured at five sizes, the menu open and closed,
 * by scripts/terrain-layout.mjs.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8')
const APP = readFileSync(resolve(__dirname, '../../App.tsx'), 'utf8')

/** The declarations of the first rule whose selector is exactly `sel`. */
function rule(sel: string): string {
  const at = CSS.indexOf(`\n${sel} {`)
  expect(at, sel).toBeGreaterThan(-1)
  return CSS.slice(at, CSS.indexOf('}', at))
}

describe('with the menu open', () => {
  it('TERRAIN\'s controls hide under it on a phone, exactly where WALK\'s pad does', () => {
    expect(APP).toContain('const showPad = padOpen && !crowded')
    expect(APP).toContain('<TerrainView covered={crowded} />')
    expect(rule('.terrainview.is-covered')).toContain('visibility: hidden;')
  })

  it('the carried block is under the menu and every control, and takes no tap', () => {
    const held = rule('.terrain-held')
    expect(held).toContain('z-index: 0;')
    expect(held).toContain('pointer-events: none;')
    expect(rule('.hud')).toContain('z-index: 1;')
    // In the bottom right, partly off the bottom.
    expect(held).toContain('position: fixed;')
    expect(held).toMatch(/bottom: calc\(var\(--held\) \* -/)
  })
})
