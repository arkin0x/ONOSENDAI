/**
 * regionChipReserve.test.tsx - the REGION chip's reserve link (arkinox,
 * 2026-11-13): the relay's speakeasy landing page with its create tool
 * prefilled, ?region=<hex>, opening in a new tab. Rendered to a string, with
 * region mode's store standing in for one that is on.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../store/useRegion', () => ({
  useRegion: (pick: (s: { active: boolean; prefix: string | null }) => unknown) => pick({ active: true, prefix: '56db6db6db6db6db6db6dbad' }),
}))

import { RegionChip, reserveUrl } from '../RegionChip'

describe('the REGION chip reserve link', () => {
  it('opens the speakeasy landing page with the region, in a new tab', () => {
    const html = renderToStaticMarkup(<RegionChip />)
    const link = html.match(/<a [^>]*regionchip__reserve[^>]*>/)?.[0] ?? ''
    expect(link).toContain('href="https://relay.onosendai.tech/speakeasy?region=56db6db6db6db6db6db6dbad"')
    expect(link).toContain('target="_blank"')
    expect(link).toContain('rel="noreferrer"')
    expect(html).toContain('Reserve this region for a private speakeasy')
  })

  it('carries the bare hex, not the /C/ form', () => {
    expect(reserveUrl('a')).toBe('https://relay.onosendai.tech/speakeasy?region=a')
  })
})
