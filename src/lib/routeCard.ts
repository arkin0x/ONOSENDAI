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
  imageType: string
  imageAlt: string
}

/** Cyberspace TV's card (tools/og-tv-card.html renders public/og-tv.jpg). */
export const TV_CARD: RouteCard = {
  url: 'https://onosendai.tech/tv',
  title: 'CYBERSPACE TV · ONOSENDAI',
  description: 'Everything that ever happened in cyberspace, played back as a broadcast: every move, every hidden bag, every new object, from a random moment since v2 began.',
  // A JPEG: the grain makes a PNG of 800 KB, more than some chat apps
  // fetch for a preview (review of #376).
  // Versioned: previews are cached by the image's address, so a new card
  // needs a new one (2: "Always On. Everywhere. ™", 2026-10-19; 3: the
  // Cyberspace TV logo's bright grids, 2026-10-21; 4: the ™ on the ONOSENDAI
  // wordmark, 2026-10-21).
  image: 'https://onosendai.tech/og-tv.jpg?v=4',
  imageType: 'image/jpeg',
  imageAlt: 'CYBERSPACE サイバースペース TV and the ONOSENDAI wordmark on a curved CRT screen, between a glowing teal, blue and purple grid floor and ceiling.',
}

/**
 * The shard workshop's card (lib/workshopRoute.ts): its own words over the
 * home page's image, so a link to /workshop says what it opens without a
 * second picture to keep current.
 */
export const WORKSHOP_CARD: RouteCard = {
  url: 'https://onosendai.tech/workshop',
  title: 'SHARD WORKSHOP · ONOSENDAI',
  description: 'Make a 3D object in your browser: stamp shapes, color the points, then deploy it to hide it in cyberspace at a place you choose.',
  image: 'https://onosendai.tech/og.png?v=2',
  imageType: 'image/png',
  imageAlt: 'The ONOSENDAI wordmark and its yellow mark beside a scene from the app: the violet ring of the Black Sun, a cyan hyperjump beam with an avatar inside it, and a neon structure beyond.',
}

/** Each route's own page, written by the build beside index.html (vite.config.ts) and served by vercel.json. */
export const ROUTE_PAGES: ReadonlyArray<readonly [fileName: string, card: RouteCard]> = [
  ['tv.html', TV_CARD],
  ['workshop.html', WORKSHOP_CARD],
]

const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

/**
 * `html` with `card`'s title, description and Open Graph tags in place of
 * its own. Throws when a tag it expects is not there, so a change to
 * index.html cannot quietly ship a route with the home page's card.
 */
export function withCard(html: string, card: RouteCard): string {
  // Replaced through functions, so a `$` in a card's words is just a `$`
  // (a replacement string would read `$1` as the match: review of #376).
  const attr = (name: string, value: string): [RegExp, (m: string, open: string, close: string) => string] =>
    [new RegExp(`(<meta ${name} content=")[^"]*(")`), (_m, open, close) => `${open}${escape(value)}${close}`]
  const swaps: Array<[RegExp, (...args: string[]) => string]> = [
    [/<title>[^<]*<\/title>/, () => `<title>${escape(card.title)}</title>`],
    attr('name="description"', card.description),
    attr('property="og:url"', card.url),
    attr('property="og:title"', card.title),
    attr('property="og:description"', card.description),
    attr('property="og:image"', card.image),
    attr('property="og:image:type"', card.imageType),
    attr('property="og:image:alt"', card.imageAlt),
  ]
  let out = html
  for (const [find, put] of swaps) {
    if (!find.test(out)) throw new Error(`routeCard: index.html has no ${find.source}`)
    out = out.replace(find, put as (substring: string, ...args: string[]) => string)
  }
  return out
}
