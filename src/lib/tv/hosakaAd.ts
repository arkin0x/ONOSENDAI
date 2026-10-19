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
 */

/** How often, ms of TV on: one after the first ten minutes, and every ten after. */
export const AD_EVERY_MS = 10 * 60_000

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
    { from: 8.9, to: 10.5, kind: 'card', lines: ['THAT JUMP YOUR RIG', "CAN'T CRUNCH?", 'HAND IT OFF.'], accent: 2, theme: 'night' },
    { from: 10.5, to: 12.1, kind: 'card', lines: ['YOUR CYBERDECK', 'TAPS OUT.', "HOSAKA DOESN'T."], accent: 2, theme: 'teal' },
    { from: 12.1, to: 13.7, kind: 'card', lines: ['PAY IN SATS.', 'PROOF BACK', 'IN MINUTES.'], accent: 0, theme: 'magenta' },
    { from: 13.7, to: 17, kind: 'end', lines: ['LOOK FOR OFFLOAD IN ONOSENDAI'], accent: 0, theme: 'night', mark: true },
  ],
}

/** Every spot, in the order the breaks play them. */
export const ADS: TvAd[] = [HOSAKA_1]

/** A spot by its id; the first if there is no such one (an old id after a release). */
export function adById(id: string): TvAd {
  return ADS.find((a) => a.id === id) ?? ADS[0]
}

/** The spot after `last`, round the list. */
export function nextAd(last: string | null): TvAd {
  const i = last === null ? -1 : ADS.findIndex((a) => a.id === last)
  return ADS[(i + 1) % ADS.length]
}
