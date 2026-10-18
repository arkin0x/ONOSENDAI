/**
 * routeCard.ts: a route's own link preview, cut from the built page.
 *
 * The app is one page, so every address shares index.html and its card. A
 * link to onosendai.tech/tv should show Cyberspace TV's card instead
 * (arkinox, 2026-10-18: "a cool opengraph card just for the /tv route"), and
 * a link preview is read by crawlers that run no script, so the tags have to
 * be in the HTML served at that address. The build writes tv.html: the same
 * built page, script and all, with only the title, the description and the
 * card's tags changed (vite.config.ts), and vercel.json serves it at /tv.
 * One source: index.html is never copied by hand.
 */

export interface RouteCard {
  url: string
  title: string
  description: string
  image: string
  imageAlt: string
}

/** Cyberspace TV's card (tools/og-tv-card.html renders public/og-tv.png). */
export const TV_CARD: RouteCard = {
  url: 'https://onosendai.tech/tv',
  title: 'CYBERSPACE TV · ONOSENDAI',
  description: 'Everything that ever happened in cyberspace, played back as a broadcast: every move, every hidden bag, every new object, from a random moment since v2 began.',
  image: 'https://onosendai.tech/og-tv.png',
  imageAlt: 'CYBERSPACE TV and the ONOSENDAI wordmark on a curved CRT screen over a lime grid falling away at a steep angle.',
}

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * `html` with `card`'s title, description and Open Graph tags in place of
 * its own. Throws when a tag it expects is not there, so a change to
 * index.html cannot quietly ship a route with the home page's card.
 */
export function withCard(html: string, card: RouteCard): string {
  const swaps: Array<[RegExp, string]> = [
    [/<title>[^<]*<\/title>/, `<title>${escape(card.title)}</title>`],
    [/(<meta name="description" content=")[^"]*(")/, `$1${escape(card.description)}$2`],
    [/(<meta property="og:url" content=")[^"]*(")/, `$1${escape(card.url)}$2`],
    [/(<meta property="og:title" content=")[^"]*(")/, `$1${escape(card.title)}$2`],
    [/(<meta property="og:description" content=")[^"]*(")/, `$1${escape(card.description)}$2`],
    [/(<meta property="og:image" content=")[^"]*(")/, `$1${escape(card.image)}$2`],
    [/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${escape(card.imageAlt)}$2`],
  ]
  let out = html
  for (const [find, put] of swaps) {
    if (!find.test(out)) throw new Error(`routeCard: index.html has no ${find.source}`)
    out = out.replace(find, put)
  }
  return out
}
