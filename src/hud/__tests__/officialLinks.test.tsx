/**
 * The Official panel's last two rows are arkinox's X account, then his nostr
 * profile under it, each with its mark (arkinox, 2026-11-21: "lets add my X
 * profile to the onosendai menu official links, as well as my nostr profile
 * under that. put an appropriate icon for each").
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { ARKINOX_PUBKEY, LinksPanel, OFFICIAL, openProfileHere } from '../LinksPanel'
import { useProfileView } from '../../store/useProfileView'

// The npub in the cyberspace repo's AUTHOR file.
const NPUB = 'npub1arkn0xxxll4llgy9qxkrncn3vc4l69s0dz8ef3zadykcwe7ax3dqrrh43w'

describe('Official links: arkinox on X and nostr', () => {
  const html = renderToStaticMarkup(<LinksPanel />)
  const links = [...html.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">([\s\S]*?)<\/a>/g)]

  it('ends with X, then nostr under it, every row opening in a new tab', () => {
    expect(links).toHaveLength(OFFICIAL.length)
    expect(links.slice(-2).map((m) => m[1])).toEqual([
      'https://x.com/arkinoxreturns',
      `https://njump.me/${NPUB}`,
    ])
    expect(links.at(-3)?.[1]).toBe('https://www.youtube.com/@onosendaitv')
  })

  it('gives each of the two its labelled mark before the name', () => {
    const [x, nostr] = links.slice(-2).map((m) => m[2])
    expect(x).toMatch(/^<svg[^>]*aria-label="X logo"[\s\S]*<\/svg>arkinox on X$/)
    expect(nostr).toMatch(/^<svg[^>]*aria-label="nostr logo"[\s\S]*<\/svg>arkinox on nostr$/)
    expect(links.slice(0, -2).every((m) => !m[2].includes('<svg'))).toBe(true)
  })

  it('opens the nostr profile in the app on a plain tap, and keeps the link otherwise', () => {
    let prevented = 0
    const click = (over: Partial<Parameters<typeof openProfileHere>[0]> = {}) =>
      openProfileHere({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: () => { prevented++ }, ...over }, ARKINOX_PUBKEY)
    useProfileView.getState().close()
    click({ metaKey: true })
    click({ button: 1 })
    expect(prevented).toBe(0)
    expect(useProfileView.getState().pubkey).toBeNull()
    click()
    expect(prevented).toBe(1)
    expect(useProfileView.getState().pubkey).toBe(ARKINOX_PUBKEY)
  })

  it('names no em dash', () => {
    expect(readFileSync('src/hud/LinksPanel.tsx', 'utf8')).not.toContain('—')
    expect(readFileSync('src/hud/BrandMarks.tsx', 'utf8')).not.toContain('—')
  })
})
