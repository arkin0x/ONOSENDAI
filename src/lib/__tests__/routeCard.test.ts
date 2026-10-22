/**
 * routeCard.test.ts: /tv's and /workshop's pages are the built page with their own cards, and a
 * missing tag fails the build rather than shipping the home page's card.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROUTE_PAGES, TV_CARD, WORKSHOP_CARD, withCard } from '../routeCard'

const index = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8')

describe('withCard', () => {
  it('puts the TV card in the page and leaves everything else as it was', () => {
    expect(index).toContain('<meta property="og:image" content="https://onosendai.tech/og.png?v=2"')
    const tv = withCard(index, TV_CARD)
    expect(tv).toContain('<meta property="og:image" content="https://onosendai.tech/og-tv.jpg?v=4"')
    expect(tv).toContain('<meta property="og:url" content="https://onosendai.tech/tv"')
    expect(tv).toContain('<title>CYBERSPACE TV · ONOSENDAI</title>')
    expect(tv).not.toContain('https://onosendai.tech/og.png')
    // Same script, same everything else.
    expect(tv).toContain('<meta property="og:image:type" content="image/jpeg"')
    const strip = (h: string) => h.replace(/<title>[^<]*<\/title>/, '').replace(/<meta (name="description"|property="og:[^"]*") content="[^"]*"/g, '')
    expect(strip(tv)).toBe(strip(index))
  })

  it('puts the workshop card in the page, over the home page image', () => {
    const page = withCard(index, WORKSHOP_CARD)
    expect(page).toContain('<meta property="og:url" content="https://onosendai.tech/workshop"')
    expect(page).toContain('<title>SHARD WORKSHOP · ONOSENDAI</title>')
    // The home page's picture, read from index.html, so a new home card cannot leave this one behind.
    const tag = (prop: string) => new RegExp(`<meta property="${prop}" content="([^"]*)"`).exec(index)?.[1]
    expect(WORKSHOP_CARD.image).toBe(tag('og:image'))
    expect(WORKSHOP_CARD.imageType).toBe(tag('og:image:type'))
    expect(WORKSHOP_CARD.imageAlt).toBe(tag('og:image:alt'))
    expect(page).toContain(`<meta property="og:description" content="${WORKSHOP_CARD.description}"`)
    const strip = (h: string) => h.replace(/<title>[^<]*<\/title>/, '').replace(/<meta (name="description"|property="og:[^"]*") content="[^"]*"/g, '')
    expect(strip(page)).toBe(strip(index))
  })

  it('writes one page per route, each named for the address vercel.json serves it at', () => {
    expect(ROUTE_PAGES.map(([file]) => file)).toEqual(['tv.html', 'workshop.html'])
    const { rewrites } = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf8')) as { rewrites: Array<{ destination: string }> }
    for (const [file] of ROUTE_PAGES) expect(rewrites.some((r) => r.destination === `/${file}`)).toBe(true)
  })

  it('takes a `$` in the words as a `$`', () => {
    const tv = withCard(index, { ...TV_CARD, description: 'Tips from $1 and $2' })
    expect(tv).toContain('<meta name="description" content="Tips from $1 and $2" />')
  })

  it('fails loud when index.html loses a tag it expects', () => {
    expect(() => withCard(index.replace(/<meta property="og:image" [^>]*>/, ''), TV_CARD)).toThrow(/og:image/)
  })
})
