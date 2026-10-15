/**
 * itemPicture.test.ts: the picture an item wears (arkinox, 2026-10-10: at most
 * 32x32, a base64 data URI in a NIP-92 imeta tag). The fit math, the tag's
 * exact shape, the field parser, and the acceptance rules: only a data URI,
 * only up to 32 a side, only up to 8,192 characters, anything else ignored.
 */

import { describe, expect, it } from 'vitest'
import { MAX_PICTURE_SIDE, MAX_PICTURE_URI, fitWithin, fitsDim, imetaFields, imetaTag, isPictureUri, parseDim, pictureOf } from '../itemPicture'

/** A 1x1 PNG, the smallest real picture. */
export const DOT = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

describe('fitWithin: a size scaled into 32 by 32, never up', () => {
  it('scales a wide picture down until its longer side is 32', () => {
    expect(fitWithin(100, 50)).toEqual({ w: 32, h: 16 })
    expect(fitWithin(64, 20)).toEqual({ w: 32, h: 10 })
    expect(fitWithin(20, 64)).toEqual({ w: 10, h: 32 })
    expect(fitWithin(64, 64)).toEqual({ w: 32, h: 32 })
    expect(fitWithin(33, 33)).toEqual({ w: 32, h: 32 })
  })
  it('keeps a picture that already fits at its own size', () => {
    expect(fitWithin(10, 10)).toEqual({ w: 10, h: 10 })
    expect(fitWithin(32, 32)).toEqual({ w: 32, h: 32 })
    expect(fitWithin(1, 1)).toEqual({ w: 1, h: 1 })
    expect(fitWithin(32, 8)).toEqual({ w: 32, h: 8 })
  })
  it('never goes below one pixel a side, and a size with no area is one pixel', () => {
    expect(fitWithin(1000, 1)).toEqual({ w: 32, h: 1 })
    expect(fitWithin(0, 0)).toEqual({ w: 1, h: 1 })
    expect(fitWithin(NaN, 10)).toEqual({ w: 1, h: 1 })
  })
  it('takes another bound', () => {
    expect(fitWithin(100, 50, 16)).toEqual({ w: 16, h: 8 })
  })
})

describe('what a picture may be', () => {
  it('is a raster data URI in base64, under the length cap', () => {
    expect(isPictureUri(DOT)).toBe(true)
    expect(isPictureUri('data:image/jpeg;base64,/9j/4AAQ')).toBe(true)
    expect(isPictureUri('data:image/webp;base64,UklGRg==')).toBe(true)
    expect(isPictureUri('data:image/gif;base64,R0lGODlh')).toBe(true)
  })
  it('is never an address, a document, or anything outside the base64 alphabet', () => {
    expect(isPictureUri('https://example.com/a.png')).toBe(false)
    expect(isPictureUri('http://example.com/a.png')).toBe(false)
    expect(isPictureUri('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false)
    expect(isPictureUri('data:image/png,rawbytes')).toBe(false)
    expect(isPictureUri('data:text/html;base64,PGh0bWw+')).toBe(false)
    expect(isPictureUri('data:image/png;base64,abc"onerror="x')).toBe(false)
    expect(isPictureUri('')).toBe(false)
  })
  it('is at most 8,192 characters as a whole', () => {
    const head = 'data:image/png;base64,'
    const atCap = head + 'A'.repeat(MAX_PICTURE_URI - head.length)
    expect(atCap.length).toBe(MAX_PICTURE_URI)
    expect(isPictureUri(atCap)).toBe(true)
    expect(isPictureUri(atCap + 'A')).toBe(false)
  })
  it('is at most 32 a side, in whole pixels', () => {
    expect(fitsDim({ w: 32, h: 32 })).toBe(true)
    expect(fitsDim({ w: 1, h: 32 })).toBe(true)
    expect(fitsDim({ w: 33, h: 1 })).toBe(false)
    expect(fitsDim({ w: 0, h: 1 })).toBe(false)
    expect(fitsDim({ w: 1.5, h: 1 })).toBe(false)
    expect(MAX_PICTURE_SIDE).toBe(32)
  })
})

describe('imeta fields', () => {
  it('splits each entry at its first space, the first of a key winning', () => {
    expect(imetaFields(['imeta', `url ${DOT}`, 'm image/png', 'dim 1x1', 'alt a red dot, one pixel'])).toEqual({ url: DOT, m: 'image/png', dim: '1x1', alt: 'a red dot, one pixel' })
    expect(imetaFields(['imeta', 'dim 1x1', 'dim 9x9'])).toEqual({ dim: '1x1' })
  })
  it('passes over an entry that is not "key value"', () => {
    expect(imetaFields(['imeta', 'url', ' x', 'dim ', 'ok 1'])).toEqual({ ok: '1' })
    expect(imetaFields(['imeta'])).toEqual({})
  })
  it('reads a dim as whole pixels, or not at all', () => {
    expect(parseDim('32x16')).toEqual({ w: 32, h: 16 })
    expect(parseDim('1x1')).toEqual({ w: 1, h: 1 })
    expect(parseDim('0x1')).toBeNull()
    expect(parseDim('32x')).toBeNull()
    expect(parseDim('32 x 16')).toBeNull()
    expect(parseDim('32X16')).toBeNull()
    expect(parseDim(undefined)).toBeNull()
  })
})

describe('the imeta tag an item carries', () => {
  it('has the shape NIP-92 asks for: url first, then the mime and the size', () => {
    expect(imetaTag(DOT, { w: 1, h: 1 })).toEqual(['imeta', `url ${DOT}`, 'm image/png', 'dim 1x1'])
    expect(imetaTag('data:image/jpeg;base64,/9j/4AAQ', { w: 32, h: 16 })).toEqual(['imeta', 'url data:image/jpeg;base64,/9j/4AAQ', 'm image/jpeg', 'dim 32x16'])
  })
  it('is not written for a picture no reader would accept back', () => {
    expect(imetaTag('https://example.com/a.png', { w: 1, h: 1 })).toBeNull()
    expect(imetaTag(DOT, { w: 64, h: 64 })).toBeNull()
    expect(imetaTag('data:image/png;base64,' + 'A'.repeat(MAX_PICTURE_URI), { w: 1, h: 1 })).toBeNull()
  })
})

describe('pictureOf: the picture an item\'s tags carry', () => {
  const good = ['imeta', `url ${DOT}`, 'm image/png', 'dim 1x1']

  it('reads the data URI and its size out of a good tag, among other tags', () => {
    expect(pictureOf([['title', 'Wind Key'], good, ['-']])).toEqual({ image: DOT, dim: { w: 1, h: 1 } })
  })
  it('ignores an http(s) url: a reader must fetch nothing', () => {
    expect(pictureOf([['imeta', 'url https://example.com/a.png', 'm image/png', 'dim 1x1']])).toBeNull()
    expect(pictureOf([['imeta', 'url http://example.com/a.png', 'm image/png', 'dim 1x1']])).toBeNull()
  })
  it('ignores a dim over 32 a side, or a missing or malformed one', () => {
    expect(pictureOf([['imeta', `url ${DOT}`, 'm image/png', 'dim 64x64']])).toBeNull()
    expect(pictureOf([['imeta', `url ${DOT}`, 'm image/png', 'dim 33x1']])).toBeNull()
    expect(pictureOf([['imeta', `url ${DOT}`, 'm image/png']])).toBeNull()
    expect(pictureOf([['imeta', `url ${DOT}`, 'dim one by one']])).toBeNull()
  })
  it('ignores a data URI over 8,192 characters', () => {
    const long = 'data:image/png;base64,' + 'A'.repeat(MAX_PICTURE_URI)
    expect(pictureOf([['imeta', `url ${long}`, 'm image/png', 'dim 1x1']])).toBeNull()
  })
  it('ignores a tag with no url, a tag that is not strings, and no tags at all', () => {
    expect(pictureOf([['imeta', 'm image/png', 'dim 1x1']])).toBeNull()
    expect(pictureOf([['imeta', `url ${DOT}`, 7 as unknown as string, 'dim 1x1']])).toBeNull()
    expect(pictureOf(['imeta'])).toBeNull()
    expect(pictureOf([])).toBeNull()
  })
  it('takes the first acceptable tag when there are several', () => {
    const second = ['imeta', 'url data:image/gif;base64,R0lGODlh', 'm image/gif', 'dim 2x2']
    expect(pictureOf([['imeta', 'url https://example.com/a.png', 'dim 1x1'], good, second])).toEqual({ image: DOT, dim: { w: 1, h: 1 } })
  })
  it('does not need the mime field: the data URI carries its own', () => {
    expect(pictureOf([['imeta', `url ${DOT}`, 'dim 1x1']])).toEqual({ image: DOT, dim: { w: 1, h: 1 } })
  })
})
