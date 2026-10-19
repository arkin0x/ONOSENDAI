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
 * The store (useTv) runs it between shots, every AD_EVERY_MS of TV; the
 * tube's painter (tvPainter) lays it out. Everything it says is here, so the
 * words can change without touching either.
 */

/** How long the break runs, seconds. */
export const AD_S = 14
/** How often, ms of TV on: one after the first ten minutes, and every ten after. */
export const AD_EVERY_MS = 10 * 60_000

export const AD_SUBTITLE = 'High-availability Offload Service for Advanced Kinematic Actions'

/** Each line, the second it comes up, and how it is set. */
export interface AdLine { at: number; text: string; look: 'lead' | 'hero' | 'riff' | 'call' }

export const AD_LINES: AdLine[] = [
  { at: 0.5, text: "WHEN YOUR CYBERDECK DOESN'T HAVE WHAT IT TAKES,", look: 'lead' },
  { at: 2.5, text: 'HOSAKA CAN HELP.', look: 'hero' },
  { at: 4.5, text: "That jump your rig can't crunch? Hand it off.", look: 'riff' },
  { at: 6.5, text: 'One move instead of hundreds of tiny ones.', look: 'riff' },
  { at: 8.5, text: 'Pay in sats over Lightning. Proof back in minutes.', look: 'riff' },
  { at: 11, text: 'LOOK FOR OFFLOAD IN ONOSENDAI', look: 'call' },
]
