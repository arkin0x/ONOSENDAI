/**
 * text.test.ts: words from other people reach TV's ticker and desk without
 * anything invisible, and are never cut through a character.
 */
import { describe, expect, it } from 'vitest'
import { cleanText, tvName } from '../text'

describe('cleanText', () => {
  it('takes out a right-to-left override and other control and format characters', () => {
    expect(cleanText('ab‮cd\u0007e​f')).toBe('abcdef')
  })

  it('reads line breaks and tabs as a space, not as nothing', () => {
    expect(cleanText('line one.\n\nLine two\tand\r\nthree')).toBe('line one. Line two and three')
  })

  it('keeps a regional flag whole', () => {
    const scotland = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}'
    expect(cleanText(scotland)).toBe(scotland)
  })

  it('keeps an emoji built with a zero-width joiner whole', () => {
    expect(cleanText('👩‍💻')).toBe('👩‍💻')
  })

  it('cuts by whole characters, never through an emoji', () => {
    const cut = cleanText('a😀😀😀😀😀😀😀😀', 4)
    expect(cut).toBe('a😀😀😀…')
    // No half of a surrogate pair left behind.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(cut)).toBe(false)
  })
})

describe('tvName', () => {
  it('cleans a profile name, and falls back to the npub when nothing is left', () => {
    expect(tvName('e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a', '‮arkinox')).toBe('ARKINOX')
    expect(tvName('e8ed3798c6ffebffa08501ac39e271662bfd160f688f94c45d692d8767dd345a', '‮')).toMatch(/^NPUB1|^npub1/)
  })
})
