/**
 * captionTokens.ts: the little a tour caption may carry besides plain text
 * (arkinox, 2026-10-15).
 *
 * An icon is written `{icon:name}` in script.ts and drawn as that icon,
 * inline at text size (DemoCoach maps the name to a lucide component). Only
 * the names in CAPTION_ICON_WORDS are icons; any other `{icon:...}` stays
 * text as written, and nothing in a caption is ever read as HTML.
 *
 * SPEAK reads an icon as its word and an exponent as words: "2^X" is "two to
 * the X", where a voice would otherwise say "2 caret X".
 */

/** The icons a caption may draw, and the word SPEAK reads for each. */
export const CAPTION_ICON_WORDS: Readonly<Record<string, string>> = {
  plus: 'plus',
  minus: 'minus',
}

const ICON_TOKEN = /\{icon:([a-z-]+)\}/g

/**
 * Whether `name` is a caption icon: an own key of CAPTION_ICON_WORDS only.
 * `in` also matched Object.prototype, so `{icon:constructor}` drew Object
 * as a component and SPEAK read out its source (review of #363).
 */
export function isCaptionIcon(name: string): boolean {
  return Object.hasOwn(CAPTION_ICON_WORDS, name)
}

export type CaptionPart = { text: string } | { icon: string }

/** A caption as text runs and whitelisted icons, in order. */
export function splitCaption(caption: string): CaptionPart[] {
  const parts: CaptionPart[] = []
  let at = 0
  for (const m of caption.matchAll(ICON_TOKEN)) {
    const name = m[1]
    if (!isCaptionIcon(name)) continue
    const i = m.index ?? 0
    if (i > at) parts.push({ text: caption.slice(at, i) })
    parts.push({ icon: name })
    at = i + m[0].length
  }
  if (at < caption.length) parts.push({ text: caption.slice(at) })
  return parts
}

/** "2^X" as words: "two to the X"; 0 as "zero", which some voices read as "oh". */
function exponentWords(text: string): string {
  return text.replace(/\b2\^([0-9]+|[A-Za-z]+)\b/g, (_m, e: string) => `two to the ${e === '0' ? 'zero' : e}`)
}

/** What SPEAK reads for a caption (or a title): icons as their words, exponents as words. */
export function spokenText(text: string): string {
  const words = text.replace(ICON_TOKEN, (m, name: string) => (isCaptionIcon(name) ? CAPTION_ICON_WORDS[name] : m))
  return exponentWords(words)
}

/** A caption as captions.md shows it: an icon as "[plus icon]". */
export function markdownCaption(caption: string): string {
  return caption.replace(ICON_TOKEN, (m, name: string) => (isCaptionIcon(name) ? `[${CAPTION_ICON_WORDS[name]} icon]` : m))
}
