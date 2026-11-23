/**
 * upgradeAnnounce.test.ts: the UPGRADE ANNOUNCEMENT's pages and timeline
 * (arkinox, 2026-11-11): bars, the words a page at a time, held long enough
 * to read, the bars again; and what the marquee says of the release.
 */
import { describe, expect, it } from 'vitest'
import {
  ANNOUNCE_IN_MS, ANNOUNCE_TYPE_DELAY_S, ANNOUNCE_TYPE_S, BARS_S, MAX_CHARS, MAX_PAGES, PAGE_CHARS, PAGE_READ_S, SAMPLE_ANNOUNCEMENT, WELCOME_S,
  announceMs, announcePages, announcePlan, announceSceneAt, announceTestAsked, charsShown, pageSeconds, releaseTicker, screenStarts, versionWords,
} from '../upgradeAnnounce'
import { CUT_MS, TYPE_DELAY_S, TYPE_S } from '../../../hud/TvSegments'
import { COMMENT_BASE_S } from '../director'

describe('the pages', () => {
  it('a blank line starts a new page', () => {
    expect(announcePages('One page.\n\nTwo page.')).toEqual(['One page.', 'Two page.'])
    expect(announcePages('One page.\r\n  \r\nTwo page.')).toEqual(['One page.', 'Two page.'])
  })

  it('a single line break is a space, and control characters go', () => {
    expect(announcePages('one\ntwo‮three')).toEqual(['one twothree'])
  })

  it('a long part is cut at words, never past PAGE_CHARS, nothing lost', () => {
    const words = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const pages = announcePages(words)
    expect(pages.length).toBeGreaterThan(1)
    for (const p of pages) expect(Array.from(p).length).toBeLessThanOrEqual(PAGE_CHARS)
    expect(pages.join(' ')).toBe(words)
  })

  it('cuts after a sentence where one ends past half way', () => {
    const first = `${'a '.repeat(50).trim()}.`
    const pages = announcePages(`${first} ${'b '.repeat(80).trim()}`, 120)
    expect(pages[0]).toBe(first)
  })

  it('a word longer than a page is cut by characters', () => {
    const pages = announcePages('x'.repeat(400))
    expect(pages.map((p) => p.length)).toEqual([180, 180, 40])
  })

  it('at most MAX_PAGES pages and MAX_CHARS characters, the cut marked', () => {
    const many = Array.from({ length: 20 }, (_, i) => `Page ${i}.`).join('\n\n')
    const pages = announcePages(many)
    expect(pages).toHaveLength(MAX_PAGES)
    expect(pages[MAX_PAGES - 1].endsWith('…')).toBe(true)
    const long = announcePages('word '.repeat(400))
    expect(long.join('').length).toBeLessThanOrEqual(MAX_CHARS + MAX_PAGES)
    expect(long[long.length - 1].endsWith('…')).toBe(true)
  })

  it('the sample is two pages', () => {
    expect(announcePages(SAMPLE_ANNOUNCEMENT.text)).toHaveLength(2)
  })
})

describe('the timeline', () => {
  it('types at the quote\'s own pace, and the cut is the HUD\'s', () => {
    expect(ANNOUNCE_TYPE_S).toBe(TYPE_S)
    expect(ANNOUNCE_TYPE_DELAY_S).toBe(TYPE_DELAY_S)
    expect(ANNOUNCE_IN_MS).toBe(CUT_MS)
    expect(PAGE_READ_S).toBe(COMMENT_BASE_S)
  })

  it('a page is its printing and then PAGE_READ_S to read it', () => {
    expect(pageSeconds(0)).toBeCloseTo(ANNOUNCE_TYPE_DELAY_S + PAGE_READ_S)
    expect(pageSeconds(100)).toBeCloseTo(ANNOUNCE_TYPE_DELAY_S + 100 * ANNOUNCE_TYPE_S + PAGE_READ_S)
  })

  it('bars, each page, the bars again, end to end', () => {
    const plan = announcePlan({ version: '2.1', text: 'First page.\n\nSecond page, a little longer.' })!
    expect(plan.version).toBe('2.1')
    expect(plan.scenes.map((s) => s.kind)).toEqual(['title', 'page', 'page', 'welcome'])
    expect(plan.scenes[0]).toMatchObject({ from: 0, to: BARS_S })
    const [, p1, p2, w] = plan.scenes
    expect(p1.from).toBe(BARS_S)
    expect(p1.to - p1.from).toBeCloseTo(pageSeconds('First page.'.length))
    expect(p2.from).toBe(p1.to)
    expect(p2.to - p2.from).toBeCloseTo(pageSeconds('Second page, a little longer.'.length))
    expect(w.from).toBe(p2.to)
    expect(w.to - w.from).toBeCloseTo(WELCOME_S)
    expect(plan.length).toBe(w.to)
    expect(announceMs(plan)).toBeCloseTo(ANNOUNCE_IN_MS + plan.length * 1000)
    // Both pages belong to one arrows screen, which keeps moving across them.
    expect(p1.kind === 'page' && p2.kind === 'page' && p1.screenFrom === p2.screenFrom).toBe(true)
    expect(screenStarts(plan)).toEqual([0, BARS_S, w.from])
  })

  it('every page has printed in full before its hold, and holds PAGE_READ_S after', () => {
    const plan = announcePlan(SAMPLE_ANNOUNCEMENT)!
    for (const sc of plan.scenes) {
      if (sc.kind !== 'page') continue
      const chars = Array.from(plan.pages[sc.page]).length
      const done = sc.typeFrom + chars * ANNOUNCE_TYPE_S
      expect(charsShown(sc, done + 1e-6)).toBeGreaterThanOrEqual(chars)
      expect(charsShown(sc, sc.typeFrom - 0.1)).toBe(0)
      expect(sc.to - done).toBeCloseTo(PAGE_READ_S)
    }
  })

  it('the sample runs about half a minute', () => {
    const plan = announcePlan(SAMPLE_ANNOUNCEMENT)!
    expect(plan.length).toBeGreaterThan(20)
    expect(plan.length).toBeLessThan(40)
  })

  it('finds the scene at a time, the first before it starts and the last once it is over', () => {
    const plan = announcePlan({ version: 'x', text: 'Hello.' })!
    expect(announceSceneAt(plan, -1).kind).toBe('title')
    expect(announceSceneAt(plan, BARS_S - 0.01).kind).toBe('title')
    expect(announceSceneAt(plan, BARS_S + 0.01).kind).toBe('page')
    expect(announceSceneAt(plan, plan.length + 5).kind).toBe('welcome')
  })

  it('no words: the bars and the welcome only; no version: nothing', () => {
    expect(announcePlan({ version: '2.1', text: '  ' })!.scenes.map((s) => s.kind)).toEqual(['title', 'welcome'])
    expect(announcePlan({ version: ' ‎ ', text: 'words' })).toBeNull()
  })

  it('the version is cleaned and in capitals', () => {
    expect(versionWords('2.1-beta‮')).toBe('2.1-BETA')
    expect(versionWords('9'.repeat(50)).length).toBeLessThanOrEqual(33)
  })
})

describe('the test address', () => {
  it('is ?announce=test, and only that', () => {
    expect(announceTestAsked('?announce=test')).toBe(true)
    expect(announceTestAsked('?broadcast=1&text=large&announce=test')).toBe(true)
    expect(announceTestAsked('?announce=1')).toBe(false)
    expect(announceTestAsked('')).toBe(false)
  })
})

describe('the marquee\'s release words', () => {
  it('the version, and the updates this week only when more than none', () => {
    expect(releaseTicker('2.20261111.3.656', 7)).toEqual(['ONOSENDAI VERSION 2.20261111.3.656', '7 UPDATES THIS WEEK'])
    expect(releaseTicker('2.1', 1)).toEqual(['ONOSENDAI VERSION 2.1', '1 UPDATE THIS WEEK'])
    expect(releaseTicker('2.1', 0)).toEqual(['ONOSENDAI VERSION 2.1'])
    expect(releaseTicker('2.1', null)).toEqual(['ONOSENDAI VERSION 2.1'])
    expect(releaseTicker(null, 3)).toEqual(['3 UPDATES THIS WEEK'])
    expect(releaseTicker(null, undefined)).toEqual([])
  })
})
