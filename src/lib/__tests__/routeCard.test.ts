/**
 * routeCard.test.ts: /tv's page is the built page with its own card, and a
 * missing tag fails the build rather than shipping the home page's card.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TV_CARD, withCard } from '../routeCard'

const index = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')

describe('withCard', () => {
  it('puts the TV card in the page and leaves everything else as it was', () => {
    const tv = withCard(index, TV_CARD)
    expect(tv).toContain('<meta property="og:image" content="https://onosendai.tech/og-tv.jpg?v=2"')
    expect(tv).toContain('<meta property="og:url" content="https://onosendai.tech/tv"')
    expect(tv).toContain('<title>CYBERSPACE TV · ONOSENDAI</title>')
    expect(tv).not.toContain('https://onosendai.tech/og.png')
    // Same script, same everything else.
    expect(tv).toContain('<meta property="og:image:type" content="image/jpeg"')
    const strip = (h: string) => h.replace(/<title>[^<]*<\/title>/, '').replace(/<meta (name="description"|property="og:[^"]*") content="[^"]*"/g, '')
    expect(strip(tv)).toBe(strip(index))
  })

  it('takes a `$` in the words as a `$`', () => {
    const tv = withCard(index, { ...TV_CARD, description: 'Tips from $1 and $2' })
    expect(tv).toContain('<meta name="description" content="Tips from $1 and $2" />')
  })

  it('fails loud when index.html loses a tag it expects', () => {
    expect(() => withCard(index.replace(/<meta property="og:image" [^>]*>/, ''), TV_CARD)).toThrow(/og:image/)
  })
})
