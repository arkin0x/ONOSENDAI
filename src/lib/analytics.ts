/**
 * analytics.ts: Vercel Web Analytics, page views only, with every address cut
 * down to a coarse route before it leaves the browser (arkinox, 2026-11-13:
 * "add the vercel analytics package to onosendai so I can have better
 * analytics").
 *
 * What Vercel's collector sends by itself is the whole address,
 * location.href, query and hash included. Here an address can say where a
 * player is (/C/<hex>), and its query carries the app's switches (?mode=,
 * ?tutorial=, ?games=, ?announce=, ?broadcast=, ?diag=, ...). None of that
 * may go out, so beforeSend (analyticsBeforeSend) puts in place of each
 * address only its origin and one of the known routes (ROUTES): any /C/
 * address is /C/:region, an address the app does not serve is /other, and
 * the query and the hash are dropped, always. Custom events are dropped too:
 * the app sends none, and none may carry a key, a pubkey, a coordinate or an
 * id.
 *
 * Not on the 24/7 stream (/tv?broadcast=1, lib/tv/broadcast): it would count
 * one viewer forever. Not in development or tests: only a production build
 * injects the script (startAnalytics).
 *
 * The first page view names the route the page landed on (tutorial/gate
 * landedPath) when an early rewrite has since put / in its place: /tutorial
 * goes back to / before anything draws, and the owner sends /tutorial links.
 *
 * Page views after the first are the collector's own: it counts a
 * history.pushState to another path and a back or forward (popstate), so
 * opening TV, the tour or a /C/ link counts, while moving between /C/
 * addresses (a replaceState) does not count each hop.
 *
 * The data shows only once Web Analytics is enabled for the project in the
 * Vercel dashboard.
 */
import type { BeforeSend, BeforeSendEvent, inject } from '@vercel/analytics'

/** inject's options (the package names the type but does not export it). */
type InjectProps = NonNullable<Parameters<typeof inject>[0]>

/** The routes the app serves, each as it is reported (vercel.json rewrites; the built tv.html and workshop.html). */
const ROUTES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/(index\.html)?$/i, '/'],
  [/^\/c(\/.*)?$/i, '/C/:region'],
  [/^\/tv(\/|\.html)?$/i, '/tv'],
  [/^\/demo(\/.*)?$/i, '/demo'],
  [/^\/workshop(\/|\.html)?$/i, '/workshop'],
  [/^\/tutorial\/?$/i, '/tutorial'],
]

/** What an address the app does not serve is reported as. */
export const OTHER_ROUTE = '/other'

/** The coarse route a path is reported as: one of ROUTES, or OTHER_ROUTE. */
export function coarseRoute(pathname: string): string {
  for (const [re, route] of ROUTES) if (re.test(pathname)) return route
  return OTHER_ROUTE
}

/**
 * The address reported in place of `url`: its origin and its coarse route,
 * with no query and no hash. Null when `url` is not an http(s) address, so
 * nothing is sent.
 */
export function scrubAnalyticsUrl(url: string, landed?: string): string | null {
  let u: URL
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  let route = coarseRoute(u.pathname)
  if (landed !== undefined && route === '/') route = coarseRoute(landed)
  return `${u.origin}${route}`
}

/**
 * The beforeSend Vercel's collector runs on each event: page views go out
 * scrubbed (scrubAnalyticsUrl), everything else and anything on the stream
 * goes nowhere. The first page view may name `landed` (see the file's note).
 */
export function analyticsBeforeSend(opts: { broadcast: () => boolean; landed?: string }): BeforeSend {
  let landed = opts.landed
  return (event: BeforeSendEvent): BeforeSendEvent | null => {
    if (opts.broadcast() || event.type !== 'pageview') return null
    const url = scrubAnalyticsUrl(event.url, landed)
    landed = undefined
    return url === null ? null : { type: 'pageview', url }
  }
}

/** What startAnalytics needs, passed in so a test can check it without a browser or a build. */
export interface AnalyticsDeps {
  /** Whether this is a production build (import.meta.env.PROD). */
  prod: boolean
  /** Whether this page is the 24/7 stream (lib/tv/broadcast isBroadcast). */
  broadcast: () => boolean
  /** The path the page landed on (tutorial/gate landedPath). */
  landed: string
  /** @vercel/analytics inject. */
  inject: (props: InjectProps) => void
}

/** Injects the collector with the scrubber, unless this is not a production build or is the stream. Whether it did. */
export function startAnalytics(deps: AnalyticsDeps): boolean {
  if (!deps.prod || deps.broadcast()) return false
  deps.inject({ mode: 'production', beforeSend: analyticsBeforeSend({ broadcast: deps.broadcast, landed: deps.landed }) })
  return true
}
