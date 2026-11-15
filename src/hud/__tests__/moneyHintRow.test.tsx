/**
 * The deploy bar's money switch (arkinox, 2026-11-15: "money off by
 * default"): shown whenever the bag holds cashu, with PUBLISH CONTENTS on or
 * off, and off for a player who never touched it. No cashu, no row. The
 * contents line no longer offers cashu among what it tells.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BagControls } from '../DeployBar'
import { DEFAULT_BAG_SETTINGS, type BagSettings } from '../../lib/hidden'
import { SECTOR_HINT } from '../../lib/hint'

const bar = (bag: Partial<BagSettings>, cashu: boolean): string =>
  renderToStaticMarkup(<BagControls height={6} bag={{ ...DEFAULT_BAG_SETTINGS, hint: SECTOR_HINT, ...bag }} existing={0} cashu={cashu} />)

/** The money row's switch, as rendered. */
const moneySwitch = (html: string): string | undefined => html.match(/<button[^>]*id="deploy-money-hint"[^>]*>/)?.[0]

describe('the money switch', () => {
  it('shows, off, with contents on and cashu inside', () => {
    const html = bar({ contents: true, money: false }, true)
    expect(html).toContain('Publish that money is inside')
    expect(moneySwitch(html)).toContain('aria-checked="false"')
  })

  it('shows with contents off too', () => {
    const html = bar({ contents: false, money: false }, true)
    expect(moneySwitch(html)).toContain('aria-checked="false"')
    expect(html).toContain('without saying how much')
  })

  it('shows on when turned on', () => {
    expect(moneySwitch(bar({ contents: true, money: true }, true))).toContain('aria-checked="true"')
  })

  it('is not there without cashu', () => {
    for (const contents of [true, false]) expect(bar({ contents }, false)).not.toContain('deploy-money-hint')
  })

  it('the contents line says money stays secret, and does not list cashu', () => {
    const html = bar({ contents: true }, false)
    expect(html).toContain('Money stays secret unless you publish it.')
    expect(html).not.toMatch(/cashu tokens and NFTs/)
  })

  it('no em dashes in the copy', () => {
    expect(bar({ contents: true }, true)).not.toContain('—')
    expect(bar({ contents: false }, true)).not.toContain('—')
  })
})
