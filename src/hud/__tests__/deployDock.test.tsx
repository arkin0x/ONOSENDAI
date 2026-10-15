/**
 * The deploy bar docked in the lower left (arkinox, 2026-10-12): at the top of
 * the screen it covered the model being placed. It docks where the route
 * overlay docks, from the same rules, and each row's green note moves to its
 * own line under the row's controls so the controls get the docked width.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DeployRow, deployBarClass } from '../DeployBar'

const BAR = readFileSync(join(__dirname, '..', 'DeployBar.tsx'), 'utf8')
const APP = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8')
const CSS = readFileSync(join(__dirname, '..', '..', 'styles.css'), 'utf8')

/** The declarations of the first rule whose selector list is exactly `selector`. */
function rule(selector: string): string {
  const start = CSS.indexOf(`\n${selector} {`)
  expect(start, selector).toBeGreaterThan(-1)
  return CSS.slice(start, CSS.indexOf('}', start))
}

describe('deployBarClass', () => {
  it('stops short of the controls only while the pad is on screen', () => {
    expect(deployBarClass(true)).toBe('deploybar deploybar--pad')
    expect(deployBarClass(false)).toBe('deploybar')
  })
})

describe('DeployRow', () => {
  it('puts the green note on its own line after the row, not inside it', () => {
    const html = renderToStaticMarkup(
      <DeployRow kind="step" label="STEP" hint="116 pm"><button>+</button></DeployRow>,
    )
    const row = html.indexOf('deploybar__row deploybar__row--step')
    const rowEnd = html.indexOf('</div>', row)
    const hint = html.indexOf('deploybar__hint')
    expect(row).toBeGreaterThan(-1)
    // The row closes before the note opens: the note is the row's next sibling.
    expect(hint).toBeGreaterThan(rowEnd)
    expect(html.slice(row, rowEnd)).toContain('STEP')
    expect(html.slice(row, rowEnd)).toContain('<button>+</button>')
    expect(html.slice(row, rowEnd)).not.toContain('116 pm')
    expect(html.slice(hint)).toContain('116 pm')
  })

  it('draws no note line when the row has none', () => {
    const html = renderToStaticMarkup(<DeployRow kind="turn" label="TURN" hint={null}><button>RESET</button></DeployRow>)
    expect(html).not.toContain('deploybar__hint')
  })

  it('keeps the tooltip on the note', () => {
    const html = renderToStaticMarkup(<DeployRow kind="height" label="HIDE AT HEIGHT" hint="found within 29.8 nm" hintTitle="Raised because">x</DeployRow>)
    expect(html).toMatch(/deploybar__hint[^>]*title="Raised because"/)
  })
})

describe('the deploy bar source', () => {
  it('has no note left inline in a row: every one goes through DeployRow', () => {
    expect(BAR).not.toContain('<span className="deploybar__radius"')
    for (const kind of ['step', 'height', 'link', 'unit', 'turn', 'snap', 'spin']) {
      expect(BAR).toContain(`kind="${kind}"`)
    }
  })

  it('is told by App whether the pad is on screen, and the route overlay steps out of the corner while placing', () => {
    expect(APP).toMatch(/<DeployBar pad=\{showPad && !offerUp && !modalUp\} \/>/)
    expect(APP).toMatch(/showPad && !offerUp && !deploying && <RouteOverlay \/>/)
  })
})

describe('the dock rules', () => {
  it('are the route overlay\'s, shared rather than copied', () => {
    const dock = rule('.routeov,\n.deploybar')
    expect(dock).toContain('left: var(--menu-left)')
    expect(dock).toContain('bottom: calc(var(--menu-bottom) + var(--menu-size) + var(--routeov-gap))')
    expect(dock).toContain('max-height: 35dvh')
    expect(rule('.routeov,\n.deploybar--pad')).toContain('right: calc(var(--controls-right) + var(--controls-width) + var(--routeov-gap))')
    expect(CSS).toContain('.app:has(.hosaka-pulse) .routeov,\n.app:has(.hosaka-pulse) .deploybar {')
  })

  it('leaves no top placement or old height cap on the bar', () => {
    const base = rule('.deploybar')
    expect(base).not.toMatch(/\btop:/)
    expect(base).toContain('right: var(--controls-right)')
    expect(CSS).not.toMatch(/\.deploybar \{\s*left: 332px/)
    expect(CSS).not.toMatch(/\.deploybar \{\s*max-height: 30vh/)
  })
})
