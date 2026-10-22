/**
 * nftLink.ts - a nonfungible.cash claim link hidden in a message.
 *
 * An NFT hidden in cyberspace is a nonfungible.cash transfer link pasted into
 * a hidden message, in a bag or in a chest: a bearer thing, like a Cashu coin
 * in a chest, and the site decides who was first (arkinox, 2026-10-22). This
 * file finds such links in a message's text. Claiming happens on
 * nonfungible.cash, never here: nothing in this file claims, cancels or mints.
 *
 * The shape is the site's own, read from callebtc/cashu-nft at 4fe0efa
 * (portfolio_web/src/link.mjs `linkUrl`, `unb64url`; portfolio.py
 * `/claim/{link_id}`) and matched in the live bundle of 2026-10-15:
 *
 *   https://nonfungible.cash/claim/<id>#<key>
 *
 * `id` is 16 random bytes as 32 lowercase hex characters. `key` is 32 random
 * bytes as unpadded base64url, exactly 43 characters; the site refuses any
 * other length. A link may also need a password, which the link itself never
 * shows: only the site knows (its `protected` flag).
 *
 * The key is the part after `#`, which browsers never send to a server. It
 * is what makes the link claimable, so it is never drawn on a card, a row or
 * the scene, never logged, and only leaves this page inside the CLAIM link
 * (opened with noopener and noreferrer) or COPY LINK.
 */

/** The site, and the only origin a real link names (www has no certificate; http only redirects). */
export const NFT_SITE = 'https://nonfungible.cash'

export interface NftLink {
  /** The link's id: 32 lowercase hex characters. Public: the site's link page is named by it. */
  id: string
  /** The link's key, the 43 characters after `#`. Secret: whoever has it can claim. */
  key: string
  /** The whole link, rebuilt from the two parts above, so what opens is exactly what was checked. */
  url: string
}

/**
 * What may come right before a link: the start of the text, a space (a
 * zero-width one too), or a mark people put before a link: an opening
 * bracket or curly quote, a straight quote, `*`, `>`, `|`, `,`, `;`, `:`
 * (`link:https://...`), a backtick, or an en or em dash (written as escapes
 * here). Letters, digits and the URL marks `/`, `=`, `&`, `%`, `#`, `.`, `@`
 * and `?` are not allowed, so `xhttps://` and most links inside another
 * link's path or query (`/https://`, `=https://`) are not this link. A few
 * allowed marks can sit inside a URL (`;`, `,`), so
 * `https://a.example/?b=1;https://nonfungible.cash/...` is read as a link;
 * that is harmless for a card, because the card always rebuilds the link to
 * nonfungible.cash from its id and key and opens nothing else, but such a
 * link is not counted (countNftLinks). Written as a captured group rather
 * than a lookbehind, which older Safari cannot parse.
 */
const BEFORE = '(^|[\\s\\u200b(\\[{<"\'\\u201c\\u2018*>|,;:\\u0060\\u2013\\u2014])'

/**
 * The link itself. The scheme and host are read in any case, as browsers
 * read them (a phone may capitalize `Https`); the id and key are exact. The
 * key's last character is one of sixteen, since 32 bytes fill only 256 of
 * the 258 bits 43 base64 characters hold, and the site's encoder always
 * leaves the last two at zero.
 */
const anyCase = (word: string): string => word.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`).replace(/\./g, '\\.')
const LINK = String.raw`${anyCase('https')}://${anyCase('nonfungible.cash')}/claim/([0-9a-f]{32})#([A-Za-z0-9_-]{42}[AEIMQUYcgkosw048])`

/**
 * What may not come right after: more key characters (a key longer than 43
 * is not a key the site accepts), padding, or more of a fragment. Sentence
 * marks after a link (`.` `,` `!` `?` `)`) are fine.
 */
const AFTER = String.raw`(?![A-Za-z0-9_\-=+/%&#])`

const PATTERN = new RegExp(`${BEFORE}${LINK}${AFTER}`, 'g')

/** Every claim link in a text, in order, once each. A text with none gives an empty list. */
export function findNftLinks(text: string | null | undefined): NftLink[] {
  if (!text) return []
  const out: NftLink[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(PATTERN)) {
    const id = m[2], key = m[3]
    const url = nftClaimUrl(id, key)
    if (seen.has(url)) continue
    seen.add(url)
    out.push({ id, key, url })
  }
  return out
}

/** A character a URL may be written with (RFC 3986: unreserved, reserved but `[` and `]`, and `%`). */
const URL_CHAR = /[A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]/

/**
 * How many claim links a text carries for a bag's `nft` count (spec 7.7
 * Contents), each distinct link once. A link that stands inside another
 * URL's path or query is not counted: the URL characters right before it,
 * back to the first one a URL cannot hold, contain a `://` with no `#`
 * after it. So `https://a.example/?b=1;https://nonfungible.cash/...` counts
 * none, and `see;https://nonfungible.cash/...`, `[a page](https://nonfungible.cash/...)`
 * and two links joined by a comma (the second is in the first one's
 * fragment, not its path or query) count every link. Text with no scheme
 * before it (`a.example/?b=1;`) is not a URL here, and a character outside
 * RFC 3986 (`é`) ends one. One pass over the text, however many links.
 * Cards read every link findNftLinks finds, counted or not.
 */
export function countNftLinks(text: string | null | undefined): number {
  if (!text) return 0
  const seen = new Set<string>()
  // The run of URL characters before position `i`: where its last `://` is (-1 for none), and whether a `#` came after that.
  let i = 0, scheme = -1, fragment = false
  for (const m of text.matchAll(PATTERN)) {
    const at = m.index! + m[1].length
    for (; i < at; i++) {
      const c = text[i]
      if (!URL_CHAR.test(c)) { scheme = -1; fragment = false }
      else if (c === ':' && text[i + 1] === '/' && text[i + 2] === '/') { scheme = i; fragment = false }
      else if (c === '#') fragment = true
    }
    if (scheme === -1 || fragment) seen.add(`${m[2]}#${m[3]}`)
  }
  return seen.size
}

/** Whether a text carries a claim link. */
export function hasNftLink(text: string | null | undefined): boolean {
  return findNftLinks(text).length > 0
}

/** The link the site makes from an id and a key. */
export function nftClaimUrl(id: string, key: string): string {
  return `${NFT_SITE}/claim/${id}#${key}`
}

/** A text with every claim link in it replaced by `by`, and nothing else changed. */
export function replaceNftLinks(text: string, by: string): string {
  return text.replace(PATTERN, (_whole, before: string) => `${before}${by}`)
}

/**
 * A text with every claim link's key replaced by `mask`, each link written
 * as the site writes it, so the id stays readable and the key does not. By
 * the pattern, never by the canonical link: a link written in another case
 * (`Https://NonFungible.Cash/...`) is masked too (review of #440).
 */
export function maskNftKeys(text: string, mask: string): string {
  return text.replace(PATTERN, (_whole, before: string, id: string) => `${before}${NFT_SITE}/claim/${id}#${mask}`)
}

/**
 * What a message says once its links are taken out, tidied as a Cashu
 * token's words are (lib/cashu textWithoutToken): line breaks kept, the
 * spaces a link leaves behind closed up.
 */
export function textWithoutNftLinks(text: string | null | undefined): string {
  if (!text) return ''
  return replaceNftLinks(text, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** What a row, a preview or the scene calls a link in place of its text. */
export const NFT_WORDS = 'NFT link'

// ---------------------------------------------------------------------------
// Whether a link has been claimed.
//
// The site answers this in public, without claiming and without any curve
// arithmetic on the reader's side: GET /api/links/<id> returns the link's
// title, whether it needs a password, the picture's hash `h`, and `status`
// ("open", "claimed", or "void" once the sender canceled), worked out on the
// server from the mint's spent state (portfolio_links.py `Links.get`).
//
// But the site sends no CORS headers (checked 2026-10-22, on 200s and 404s,
// against an Origin of https://www.onosendai.tech), so a browser on
// onosendai.tech cannot read the answer. A request it cannot read would
// still tell the site the reader's address and which link they opened, for
// nothing. So no request is made: NFT_LINK_API is null and every card reads
// CHECK ON SITE. Pointing it at a same-origin path that forwards to the site
// (or at the site, should it ever allow other origins) turns the check on;
// that is the owner's decision, not this file's.
// ---------------------------------------------------------------------------

/**
 * Where to ask about a link, as a base that `/<id>` is added to, or null to
 * never ask. The answer has the shape of the site's /api/links/<id>.
 */
export const NFT_LINK_API: string | null = null

export type NftLinkState = 'unclaimed' | 'claimed' | 'cancelled' | 'missing' | 'unknown'

/** What the site says about a link. Every field but `state` is null when it did not say. */
export interface NftLinkInfo {
  state: NftLinkState
  /** The NFT's title, as text, at most 80 characters (the site's own cap). */
  title: string | null
  /** True when claiming asks for a password; null when not known. */
  password: boolean | null
  /** The picture's hash, 64 hex, which names its file on the site; loaded only when the player taps. */
  picture: string | null
}

export const UNKNOWN_LINK: NftLinkInfo = { state: 'unknown', title: null, password: null, picture: null }

/** The site's answer to /api/links/<id>, read into an NftLinkInfo; anything odd is unknown. */
export function readNftLinkAnswer(body: unknown): NftLinkInfo {
  if (!body || typeof body !== 'object') return UNKNOWN_LINK
  const b = body as { status?: unknown; title?: unknown; protected?: unknown; h?: unknown }
  const state: NftLinkState = b.status === 'open' ? 'unclaimed' : b.status === 'claimed' ? 'claimed' : b.status === 'void' ? 'cancelled' : 'unknown'
  if (state === 'unknown') return UNKNOWN_LINK
  const title = typeof b.title === 'string' ? b.title.trim().replace(/\s+/g, ' ').slice(0, 80) || null : null
  const password = typeof b.protected === 'boolean' ? b.protected : null
  const picture = typeof b.h === 'string' && /^[0-9a-f]{64}$/.test(b.h) ? b.h : null
  return { state, title, password, picture }
}

/**
 * Ask `api` about a link by its id. Only the id travels, never the key:
 * the key is what claims. A 404 is a link the site does not have (`missing`);
 * a site that cannot be reached, or answers oddly, is `unknown`.
 */
export async function checkNftLink(id: string, api: string, fetchFn: typeof fetch = fetch): Promise<NftLinkInfo> {
  if (!/^[0-9a-f]{32}$/.test(id)) return UNKNOWN_LINK
  try {
    // A site that never answers is unknown after ten seconds, not CHECKING for the session.
    const signal = typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(10_000) : undefined
    const r = await fetchFn(`${api.replace(/\/+$/, '')}/${id}`, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal })
    if (r.status === 404) return { ...UNKNOWN_LINK, state: 'missing' }
    if (!r.ok) return UNKNOWN_LINK
    return readNftLinkAnswer(await r.json())
  } catch {
    return UNKNOWN_LINK
  }
}

/** The picture's file on the site, by its hash. Never loaded until the player taps. */
export function nftPictureUrl(h: string): string {
  return `${NFT_SITE}/api/images/${h}`
}
