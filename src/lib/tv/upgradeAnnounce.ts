/**
 * upgradeAnnounce.ts: Cyberspace TV's UPGRADE ANNOUNCEMENT (arkinox,
 * 2026-11-11). When ONOSENDAI gets a new version, TV stops whatever it is
 * showing (a shot, a spot, a CYBERSPACE STATS board, an explainer) and
 * plays this at once, then picks up where it was:
 *
 *   1. COLOR BARS, UPGRADE ANNOUNCEMENT over them in the PLAY button's
 *      letters, held BARS_S.
 *   2. Blue arrows on dark blue, rising slowly, a box over them with the
 *      update's words printing out as a comment's quote does, a page at a
 *      time, and NEW! on a starburst floating in the top right corner.
 *   3. COLOR BARS again, WELCOME TO ONOSENDAI VERSION <x>, ENJOY! under it,
 *      held WELCOME_S.
 *
 * What it says comes in as an UpgradeAnnouncement: the words and a version,
 * nothing else, so whatever carries it later (a nostr event: its content and
 * a version tag) has the whole of it. How it arrives is not decided yet;
 * /tv?announce=test plays SAMPLE_ANNOUNCEMENT (store/useTvAnnounce).
 *
 * Everything here is pure: what it says, page by page, and when. The store
 * (store/useTvAnnounce) runs it; the tube's painter (scene/tvPainter) draws it.
 */

import { cleanText } from './text'
import { COMMENT_BASE_S } from './director'

/** What an announcement says: the words, and the version they announce. */
export interface UpgradeAnnouncement {
  /** The version, as it is written in WELCOME TO ONOSENDAI VERSION <x>. */
  version: string
  /** The update's words, as written. A blank line starts a new page; a long page is cut at words. */
  text: string
}

/**
 * How long the cut into it takes, ms: hud/TvSegments CUT_MS, as the spot's
 * AD_IN_MS is (lib/tv/hosakaAd), here so the store needs nothing from the
 * HUD. Its clock starts after it.
 */
export const ANNOUNCE_IN_MS = 700

/** How long the first screen holds, seconds: the bars and UPGRADE ANNOUNCEMENT. */
export const BARS_S = 3.5
/** How long the last screen holds, seconds: the bars, WELCOME TO ONOSENDAI VERSION <x> and ENJOY!. */
export const WELCOME_S = 4

/**
 * How the words print, seconds a character and before the first: a comment's
 * quote at its own pace (hud/TvSegments TYPE_S, TYPE_DELAY_S), here so the
 * store needs nothing from the HUD.
 */
export const ANNOUNCE_TYPE_S = 0.045
export const ANNOUNCE_TYPE_DELAY_S = 0.8

/**
 * How long a page holds once it has printed, seconds: the time a comment's
 * quote is given before its words count (lib/tv/director COMMENT_BASE_S).
 * The words are read as they print, at the pace above (about 22 characters a
 * second); this is for the last of them, and a second look.
 */
export const PAGE_READ_S = COMMENT_BASE_S

/** The most characters on one page: a few lines in the box at any size, a phone's included. */
export const PAGE_CHARS = 180
/** The most pages, and the most characters in all: a longer text is cut, with an ellipsis. */
export const MAX_PAGES = 6
export const MAX_CHARS = 900
/** The longest version written out. */
export const VERSION_MAX = 32

/** One page's time, seconds: printing `chars` characters, then PAGE_READ_S to read it. */
export function pageSeconds(chars: number): number {
  return ANNOUNCE_TYPE_DELAY_S + Math.max(0, chars) * ANNOUNCE_TYPE_S + PAGE_READ_S
}

/**
 * The words cut into pages: a blank line starts a new one, and a part longer
 * than PAGE_CHARS is cut at words, at the end of a sentence where one ends
 * past half way. Control characters go (lib/tv/text cleanText); at most
 * MAX_PAGES pages and MAX_CHARS characters.
 */
export function announcePages(text: string, pageChars: number = PAGE_CHARS): string[] {
  const parts = text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/).map((p) => cleanText(p)).filter((p) => p.length > 0)
  const pages: string[] = []
  let total = 0
  for (const part of parts) {
    for (const page of cutAtWords(part, pageChars)) {
      const chars = Array.from(page)
      if (pages.length >= MAX_PAGES || total >= MAX_CHARS) return endWithEllipsis(pages)
      const room = MAX_CHARS - total
      if (chars.length > room) {
        pages.push(`${chars.slice(0, room).join('').trimEnd()}…`)
        return pages
      }
      pages.push(page)
      total += chars.length
    }
  }
  return pages
}

/** The last page marked cut: an ellipsis in place of its last character where it is full. */
function endWithEllipsis(pages: string[]): string[] {
  if (pages.length === 0) return pages
  const last = pages[pages.length - 1]
  if (!last.endsWith('…')) pages[pages.length - 1] = `${last.replace(/[.!?,;:]$/u, '')}…`
  return pages
}

/** `text` cut into pieces of at most `max` characters, at spaces, and after a sentence where one ends past half way. */
function cutAtWords(text: string, max: number): string[] {
  const out: string[] = []
  let words = text.split(' ').filter((w) => w.length > 0)
  while (words.length > 0) {
    let len = 0
    let fits = 0
    let sentence = 0
    for (const w of words) {
      const add = Array.from(w).length + (fits > 0 ? 1 : 0)
      if (len + add > max) break
      len += add
      fits++
      if (/[.!?]["')\]]?$/u.test(w) && len >= max / 2) sentence = fits
    }
    if (fits === 0) {
      // One word longer than a page: cut it by characters.
      const chars = Array.from(words[0])
      out.push(chars.slice(0, max).join(''))
      words = [chars.slice(max).join(''), ...words.slice(1)].filter((w) => w.length > 0)
      continue
    }
    const take = fits < words.length && sentence > 0 ? sentence : fits
    out.push(words.slice(0, take).join(' '))
    words = words.slice(take)
  }
  return out
}

/** One stretch of the announcement, seconds after the cut into it. */
export type AnnounceScene =
  | { kind: 'title'; from: number; to: number }
  /** A page of the words: `page` of `pages`; printing from `typeFrom`; `screenFrom` is when the arrows screen began, for its motion. */
  | { kind: 'page'; from: number; to: number; page: number; pages: number; typeFrom: number; screenFrom: number }
  | { kind: 'welcome'; from: number; to: number }

/** An announcement as it plays: the version written out, its pages, and its scenes in order. */
export interface AnnouncePlan {
  version: string
  pages: string[]
  scenes: AnnounceScene[]
  /** Seconds, the cut into it not counted: to the last scene's end. */
  length: number
}

/** The version as it is written out: cleaned, in capitals, at most VERSION_MAX characters. */
export function versionWords(version: string): string {
  return cleanText(version, VERSION_MAX).toUpperCase()
}

/**
 * How an announcement plays: the bars, each page in turn, the bars again.
 * With no words, the bars and the welcome only. Null without a version.
 */
export function announcePlan(a: UpgradeAnnouncement): AnnouncePlan | null {
  const version = versionWords(typeof a.version === 'string' ? a.version : '')
  if (!version) return null
  const pages = announcePages(typeof a.text === 'string' ? a.text : '')
  const scenes: AnnounceScene[] = [{ kind: 'title', from: 0, to: BARS_S }]
  let at = BARS_S
  const screenFrom = at
  pages.forEach((page, i) => {
    const to = at + pageSeconds(Array.from(page).length)
    scenes.push({ kind: 'page', from: at, to, page: i, pages: pages.length, typeFrom: at + ANNOUNCE_TYPE_DELAY_S, screenFrom })
    at = to
  })
  scenes.push({ kind: 'welcome', from: at, to: at + WELCOME_S })
  return { version, pages, scenes, length: at + WELCOME_S }
}

/** The scene at `t` seconds after the cut into it: the first before it starts, the last once it is over. */
export function announceSceneAt(plan: AnnouncePlan, t: number): AnnounceScene {
  return plan.scenes.find((sc) => t < sc.to) ?? plan.scenes[plan.scenes.length - 1]
}

/** How long the whole of it takes on screen, ms, the cut into it included. */
export function announceMs(plan: AnnouncePlan): number {
  return ANNOUNCE_IN_MS + plan.length * 1000
}

/** Seconds after the cut into it that each screen begins (the bars, the arrows, the bars again): where the tube cuts. */
export function screenStarts(plan: AnnouncePlan): number[] {
  const out: number[] = []
  let last: AnnounceScene['kind'] | null = null
  for (const sc of plan.scenes) {
    if (sc.kind !== last) out.push(sc.from)
    last = sc.kind
  }
  return out
}

/** How many characters of a page have printed `t` seconds after the cut into it. */
export function charsShown(scene: Extract<AnnounceScene, { kind: 'page' }>, t: number): number {
  return Math.max(0, Math.floor((t - scene.typeFrom) / ANNOUNCE_TYPE_S))
}

/** The address that plays the sample, for a look at it: /tv?announce=test. */
export const ANNOUNCE_PARAM = 'announce'
export const ANNOUNCE_TEST = 'test'
/** How long after TV comes on the sample plays, ms: once the first shot is up, so the pause and the way back show. */
export const ANNOUNCE_TEST_MS = 6_000
/** The updates this week the sample puts on the ticker. */
export const SAMPLE_UPDATES = 7

/** Whether an address asks for the sample. */
export function announceTestAsked(search: string): boolean {
  try {
    return new URLSearchParams(search).get(ANNOUNCE_PARAM) === ANNOUNCE_TEST
  } catch {
    return false
  }
}

/** The sample: two pages, in plain words. */
export const SAMPLE_ANNOUNCEMENT: UpgradeAnnouncement = {
  version: 'TEST',
  text: [
    'This is a test of the upgrade announcement. When ONOSENDAI gets a new version, Cyberspace TV stops what it is showing and tells you what changed, right here.',
    'The words print out one page at a time. When they are done, TV picks up right where it left off. Nothing has changed today. This is only a test.',
  ].join('\n\n'),
}

/**
 * The app's own version (src/lib/version.ts, set at build time), or null for
 * a build that has none ("unversioned build", and the tests).
 */
export function appVersion(): string | null {
  const v = typeof __ONOSENDAI_VERSION__ === 'string' ? __ONOSENDAI_VERSION__ : ''
  return v && /\d/.test(v) && !/unversioned/i.test(v) ? v : null
}

/**
 * What the marquee says of ONOSENDAI itself: its version, and how many
 * updates came this week, the second only when there is a count and it is
 * more than none.
 */
export function releaseTicker(version: string | null, updatesThisWeek: number | null | undefined): string[] {
  const out: string[] = []
  const v = version ? versionWords(version) : ''
  if (v) out.push(`ONOSENDAI VERSION ${v}`)
  if (typeof updatesThisWeek === 'number' && Number.isFinite(updatesThisWeek) && updatesThisWeek >= 1) {
    const n = Math.floor(updatesThisWeek)
    out.push(`${n.toLocaleString('en-US')} UPDATE${n === 1 ? '' : 'S'} THIS WEEK`)
  }
  return out
}
