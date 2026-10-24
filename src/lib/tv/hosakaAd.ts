/**
 * hosakaAd.ts: Cyberspace TV's commercial break, for HOSAKA (arkinox,
 * 2026-10-19: "id like to add a "commercial" or ad for HOSAKA that plays
 * every 10 minutes. it can be brief. use the hosaka animation banner and
 * some text written in my voice that talks about "When your cyberdeck
 * doesn't have what it takes, HOSAKA can help." Riff on that. A subtitle
 * should say subtly "High-availability Offload Service for Advanced
 * Kinematic Actions". No cyberspace actions play in the bg while the hosaka
 * ad plays.").
 *
 * Cut as a TV spot ("its suppsed to be an ad. make it look line an ad"): the
 * banner opens it as big as the tube holds and plays once through ("i want
 * the banner to be bombastically huge. you can hide it after it plays, and
 * use the isolated logo file for the rest of the ad"), then one punchy card
 * at a time slams in over speed stripes, and an end card holds the mark, the
 * name's long form, and where to find it. A slogan, not a lecture ("we need
 * a marketing slogan for hosaka, not a technical explanation").
 *
 * The store (useTv) runs it between shots, every AD_EVERY_MS of TV; the
 * tube's painter (tvPainter) draws it. Everything it says is here.
 *
 * Every spot plays in the same family (cards over speed stripes, the same
 * themes and type), but not every sponsor has a banner or a mark: those are
 * drawn only where a scene sets them (arkinox, 2026-10-24: a house spot for
 * Cyberspace TV's own ad slot, CTV_ADVERTISE_1 below, has neither).
 */

/** How often, ms of TV on: one after the first five minutes, and every five after (2026-10-19: "play the hosaka ad every 5 minutes"; it was ten). */
export const AD_EVERY_MS = 5 * 60_000

/** How often in broadcast mode (lib/tv/broadcast), ms: the 24/7 stream (arkinox, 2026-10-21: "on the streamer, the hosaka ad can play every 15 minutes"). */
export const BROADCAST_AD_EVERY_MS = 15 * 60_000

/** How often a spot plays, ms: on the site, or on the stream. */
export function adEveryMs(broadcast: boolean): number {
  return broadcast ? BROADCAST_AD_EVERY_MS : AD_EVERY_MS
}

export const AD_SUBTITLE = 'High-availability Offload Service for Advanced Kinematic Actions'

/** A card's colours: the banner's teal, the mark's magenta, or the night between. */
export type AdTheme = 'teal' | 'magenta' | 'night'

export interface AdScene {
  /** Seconds into the break it comes in and goes. */
  from: number
  to: number
  kind: 'banner' | 'card' | 'end'
  lines: string[]
  /** Which line is the punch, in the accent colour; -1 for none. */
  accent: number
  theme: AdTheme
  /** The mark over the words. */
  mark?: boolean
  /** A picture of a button after the last line: the menu's, as the app draws it. */
  icon?: 'menu'
  /** The end card's quiet line, under the mark or the call: a sponsor's long name, an address, small print. Wrapped as given, not re-cased; omitted for none. */
  subtitle?: string
}

/**
 * One spot. Versioned, so more can be cut later ("lets version the ad so we
 * can make other hosaka ads later"): give a new one the next number, add it
 * to ADS, and the breaks take them in turn.
 */
export interface TvAd {
  /** Stable, versioned: `<sponsor>-<n>-<name>`. */
  id: string
  scenes: AdScene[]
}

/**
 * How long the cut into a break takes, ms: hud/TvSegments CUT_MS, here so
 * the store needs nothing from the HUD. A spot's clock starts after it.
 */
export const AD_IN_MS = 700

/** How long a spot runs, seconds: to its last scene's end. */
export function adLength(ad: TvAd): number {
  return ad.scenes[ad.scenes.length - 1].to
}

/** HOSAKA spot 1: "When your cyberdeck doesn't have what it takes, HOSAKA can help." (2026-10-19). */
export const HOSAKA_1: TvAd = {
  id: 'hosaka-1-cyberdeck',
  scenes: [
    { from: 0, to: 5, kind: 'banner', lines: [], accent: -1, theme: 'night' },
    { from: 5, to: 7, kind: 'card', lines: ['WHEN YOUR', 'CYBERDECK', "DOESN'T HAVE", 'WHAT IT TAKES...'], accent: 1, theme: 'teal' },
    { from: 7, to: 8.9, kind: 'card', lines: ['HOSAKA', 'CAN HELP.'], accent: 0, theme: 'magenta', mark: true },
    // The three-line cards and the end card are held long enough to read
    // through (2026-10-19: "the last few screens of text disappeared before i
    // could read them fully, so slow those down a bit").
    { from: 8.9, to: 11.5, kind: 'card', lines: ['THAT JUMP YOUR RIG', "CAN'T CRUNCH?", 'HAND IT OFF.'], accent: 2, theme: 'night' },
    { from: 11.5, to: 14.1, kind: 'card', lines: ['YOUR CYBERDECK', 'TAPS OUT.', "HOSAKA DOESN'T."], accent: 2, theme: 'teal' },
    { from: 14.1, to: 16.7, kind: 'card', lines: ['PAY IN SATS.', 'PROOF BACK', 'IN MINUTES.'], accent: 0, theme: 'magenta' },
    // Where to find it, and the button to press (2026-10-19: "See the Cloud
    // Compute panel in the ONOSENDAI menu <menu button for visually for
    // reference>").
    { from: 16.7, to: 21.2, kind: 'end', lines: ['SEE THE CLOUD COMPUTE PANEL', 'IN THE ONOSENDAI MENU'], accent: 0, theme: 'night', mark: true, icon: 'menu', subtitle: AD_SUBTITLE.toUpperCase() },
  ],
}

/**
 * Cyberspace TV's own spot, for the ad slot itself (arkinox, 2026-10-24:
 * "add a hosaka-style spot that says you can advertise on cyberspace tv by
 * emailing aflutter_conjoined788@simplelogin.com"). Same family as HOSAKA's
 * (cards over speed stripes), but no banner and no mark: there is no
 * sponsor's logo to show, so it goes straight to the cards.
 */
export const CTV_ADVERTISE_1: TvAd = {
  id: 'ctv-1-advertise-here',
  scenes: [
    { from: 0, to: 2.6, kind: 'card', lines: ['THIS SPOT', 'IS OPEN.'], accent: 1, theme: 'teal' },
    { from: 2.6, to: 5.2, kind: 'card', lines: ['ADVERTISE ON', 'CYBERSPACE TV.'], accent: 1, theme: 'magenta' },
    // The end card's own type is already small (unlike a card's), so the
    // address sets fine in the call itself: it is the whole point of the
    // spot, not a quiet line under it.
    { from: 5.2, to: 9.7, kind: 'end', lines: ['EMAIL TO CLAIM IT:', 'aflutter_conjoined788@simplelogin.com'], accent: 1, theme: 'night' },
  ],
}

/** Every spot, in the order the breaks play them. */
export const ADS: TvAd[] = [HOSAKA_1, CTV_ADVERTISE_1]

/** A spot by its id; the first if there is no such one (an old id after a release). */
export function adById(id: string): TvAd {
  return ADS.find((a) => a.id === id) ?? ADS[0]
}

/**
 * The end card's last line on the stream, where the viewer is not in the
 * app and needs the address (arkinox, 2026-10-21: "change onosendai to
 * ONOSENDAI.TECH on the end text"). The site keeps its own words.
 */
const BROADCAST_END_LINE: Record<string, string> = { 'IN THE ONOSENDAI MENU': 'IN THE ONOSENDAI.TECH MENU' }

const forStream = new WeakMap<TvAd, TvAd>()

/** A spot as the stream plays it: the end card names ONOSENDAI.TECH. Made once per spot. */
export function broadcastCut(ad: TvAd): TvAd {
  let cut = forStream.get(ad)
  if (!cut) {
    cut = { ...ad, scenes: ad.scenes.map((sc) => (sc.kind === 'end' ? { ...sc, lines: sc.lines.map((l) => BROADCAST_END_LINE[l] ?? l) } : sc)) }
    forStream.set(ad, cut)
  }
  return cut
}

/** A spot by its id, as the site or the stream plays it. */
export function adFor(id: string, broadcast: boolean): TvAd {
  const ad = adById(id)
  return broadcast ? broadcastCut(ad) : ad
}

/** The spot after `last`, round the list. */
export function nextAd(last: string | null): TvAd {
  const i = last === null ? -1 : ADS.findIndex((a) => a.id === last)
  return ADS[(i + 1) % ADS.length]
}
