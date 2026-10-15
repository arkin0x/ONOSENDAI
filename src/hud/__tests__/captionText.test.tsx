/**
 * captionText.test.tsx - icons inside tour captions, and what SPEAK reads
 * (arkinox, 2026-10-15: the "Scaling up and down" step).
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CAPTION_ICON_WORDS, markdownCaption, splitCaption, spokenText } from '../../demo/captionTokens'
import { DEMO_SCRIPT } from '../../demo/script'
import { CaptionText } from '../DemoCoach'

const cube = DEMO_SCRIPT.steps.find((s) => s.id === 'cube')!

describe('the scaling step', () => {
  it('reads as arkinox wrote it, at 2^84', () => {
    expect(cube.title).toBe('Scaling up and down')
    expect(cube.caption).toBe('The {icon:plus} and {icon:minus} buttons change your zoom by powers of 2. The 2^X button shows your zoom and resets it to 2^0, where 1 cell is 1 gibson. Each zoom out increases the gibsons per cell: 2, 4, 8, 16, etc. The globe button zooms to Earth scale and the cube button zooms all the way out to cyberspace scale.')
    expect(cube.scene.scale).toBe(84)
  })

  it('draws the plus and minus icons inline, one svg each, and nothing else as markup', () => {
    const html = renderToStaticMarkup(<CaptionText caption={cube.caption} />)
    expect(html.match(/<svg/g)).toHaveLength(2)
    expect(html).toContain('lucide-square-plus')
    expect(html).toContain('lucide-square-minus')
    expect(html).not.toContain('{icon:')
  })
})

describe('caption tokens', () => {
  it('only whitelisted icons become icons; any other token and any markup stay text', () => {
    expect(splitCaption('a {icon:plus} b {icon:script} c')).toEqual([{ text: 'a ' }, { icon: 'plus' }, { text: ' b {icon:script} c' }])
    const html = renderToStaticMarkup(<CaptionText caption={'<img src=x onerror=alert(1)> {icon:nope}'} />)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<svg')
  })

  it('every icon a caption may draw has a word for SPEAK and a mark for captions.md', () => {
    for (const [name, word] of Object.entries(CAPTION_ICON_WORDS)) {
      expect(spokenText(`{icon:${name}}`)).toBe(word)
      expect(markdownCaption(`{icon:${name}}`)).toBe(`[${word} icon]`)
      expect(renderToStaticMarkup(<CaptionText caption={`{icon:${name}}`} />)).toContain('<svg')
    }
  })
})

describe('what SPEAK reads', () => {
  it('reads the icons as words and the exponents as words', () => {
    const said = spokenText(cube.caption)
    expect(said).toMatch(/^The plus and minus buttons change your zoom by powers of 2\. The two to the X button shows your zoom and resets it to two to the zero, where 1 cell is 1 gibson\./)
    expect(spokenText('At 2^34 gibsons, 2^h leaves, (2^85)')).toBe('At two to the 34 gibsons, two to the h leaves, (two to the 85)')
  })

  it('leaves no caret and no icon token in anything the tour says', () => {
    for (const s of DEMO_SCRIPT.steps) {
      for (const text of [s.title, s.caption, s.captionNew, s.captionWaiting, s.captionReturning].filter((t): t is string => !!t)) {
        const said = spokenText(text)
        expect(said, s.id).not.toMatch(/\^/)
        expect(said, s.id).not.toMatch(/\{icon:/)
      }
    }
  })
})
