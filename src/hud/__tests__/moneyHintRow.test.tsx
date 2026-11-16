/**
 * The deploy bar's money switch (arkinox, 2026-11-15: "money off by
 * default"), which covers NFT claim links too (owner ruling 2026-11-16):
 * shown whenever the bag holds cashu or an NFT claim link, with PUBLISH
 * CONTENTS on or off, and off for a player who never touched it. Neither
 * inside, no row. The contents line no longer offers cashu or NFTs among
 * what it tells.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BagControls } from '../DeployBar'
import { DEFAULT_BAG_SETTINGS, type BagSettings } from '../../lib/hidden'
import { SECTOR_HINT } from '../../lib/hint'

const bar = (bag: Partial<BagSettings>, claimable: boolean): string =>
  renderToStaticMarkup(<BagControls height={6} bag={{ ...DEFAULT_BAG_SETTINGS, hint: SECTOR_HINT, ...bag }} existing={0} claimable={claimable} />)

/** The money row's switch, as rendered. */
const moneySwitch = (html: string): string | undefined => html.match(/<button[^>]*id="deploy-money-hint"[^>]*>/)?.[0]

describe('the money switch', () => {
  it('shows, off, with contents on and cashu or an NFT inside', () => {
    const html = bar({ contents: true, money: false }, true)
    expect(html).toContain('Publish that money or NFTs are inside')
    expect(html).toContain('how many cashu tokens and NFTs')
    expect(moneySwitch(html)).toContain('aria-checked="false"')
  })

  it('shows with contents off too', () => {
    const html = bar({ contents: false, money: false }, true)
    expect(moneySwitch(html)).toContain('aria-checked="false"')
    expect(html).toContain('there is cashu or an NFT in this bag, without saying how many')
  })

  it('shows on when turned on', () => {
    expect(moneySwitch(bar({ contents: true, money: true }, true))).toContain('aria-checked="true"')
  })

  it('is not there without cashu or an NFT', () => {
    for (const contents of [true, false]) expect(bar({ contents }, false)).not.toContain('deploy-money-hint')
  })

  it('the contents line says money and NFTs stay secret, and lists neither', () => {
    const html = bar({ contents: true }, false)
    expect(html).toContain('Money and NFTs stay secret unless you publish them.')
    expect(html).toContain('how many shards, messages, keys and chests.')
    expect(html).not.toMatch(/chests and NFTs|cashu tokens/)
  })

  it('no em dashes in the copy', () => {
    expect(bar({ contents: true }, true)).not.toContain('—')
    expect(bar({ contents: false }, true)).not.toContain('—')
  })
})
