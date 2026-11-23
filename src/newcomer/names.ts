/**
 * names.ts: the plain names a newcomer sees, in one place (new-user feedback,
 * 2026-11-21: "the names of some of the buttons, like 'commit' to move, were
 * weird"; onboarding write-up, the table of plain alternatives).
 *
 * Only the newcomer view uses these (newcomer/useNewcomer.ts). Experienced
 * players, and anyone who finished or skipped the tour, keep today's names:
 * every caller passes today's word through `say`, which hands it back
 * unchanged outside the newcomer view.
 *
 * To change a name, change it here: the pad, the HYPERSPACE panel, the
 * Identity panel and the tour's captions all read this table. The PR that
 * added it lists every row for the owner's approval.
 */

/** Today's word on a button or a label, and what a newcomer sees instead. */
export const NEWCOMER_NAMES: Readonly<Record<string, string>> = {
  // The pad's commit slot (hud/TouchControls.tsx, store/useOffer.ts ACTION_LABEL).
  COMMIT: 'GO',
  'HOP TO BOUNDARY': 'GO',
  SIDESTEP: 'GO',
  OFFLOAD: 'NEEDS HOSAKA',
  // The slot beside it.
  RECALL: 'BACK TO ME',
  // The publishing switch under them, and the Identity panel's tag.
  LOCAL: 'ON THIS DEVICE',
  LIVE: 'ONLINE',
  // The mode button's ring (store/padMode.ts).
  HOP: 'MOVE',
  VIEW: 'LOOK AROUND',
  BUILD: 'BUILD',
  SCAN: 'FIND HIDDEN',
  // The HYPERSPACE panel (hud/HyperspacePanel.tsx).
  BOARD: 'GET ON',
  BOARDING: 'GETTING ON',
  'Nearest station': 'Your nearest stop',
  'Est. time': 'Trip time',
}

/**
 * What a newcomer does not see at all, for the PR's table and the tests:
 * movement proof terms and the work figures behind a trip.
 */
export const HIDDEN_FOR_NEWCOMERS: readonly string[] = [
  'Expected work (PAIRS) and Ride length in HYPERSPACE: the trip time says it',
  'Distance (2^79) under the nearest stop',
  'The cursor box label in the scene (h, k, cantor ops)',
  'The hX box labels in the scene (ops to leave)',
  'The ROUTE list over the menu button (HOP 2^5, this machine)',
  'The Movement proof, Proof chain, Cloud compute, Scale, Position, View, Legend, Derezz and Relays panels',
]

/** Today's word, or its plain name in the newcomer view. Words not in the table come back as they are. */
export function say(word: string, newcomer: boolean): string {
  if (!newcomer) return word
  return NEWCOMER_NAMES[word] ?? word
}

/**
 * The button words a tour caption may name, swapped whole in the newcomer
 * view: "Tap COMMIT to move into the box." reads "Tap GO to move into the
 * box." Capitals only, whole words only, so "HOPs" or "commit" in a sentence
 * stay as written (a step whose sentence needs more has its own line in
 * NEWCOMER_CAPTIONS).
 */
const CAPTION_WORDS = ['COMMIT', 'RECALL', 'BOARD', 'HOP', 'LOCAL', 'LIVE', 'SCAN']
const CAPTION_RE = new RegExp(`\\b(${CAPTION_WORDS.join('|')})\\b`, 'g')

/** A caption, hint or note with the button words a newcomer sees. Unchanged outside the newcomer view. */
export function plainText(text: string, newcomer: boolean): string
export function plainText(text: string | undefined, newcomer: boolean): string | undefined
export function plainText(text: string | undefined, newcomer: boolean): string | undefined {
  if (!newcomer || text === undefined) return text
  return text.replace(CAPTION_RE, (w) => NEWCOMER_NAMES[w] ?? w)
}

/**
 * Tour lines a newcomer reads in place of the step's own, by step id, where
 * swapping a button word is not enough (the course step's "HOPs").
 */
export const NEWCOMER_CAPTIONS: Readonly<Record<string, { title?: string; caption?: string; hint?: string }>> = {
  'to-course': {
    caption: 'GO moves you a jump at a time, but running and jumping is more fun! See the platform course? Use the arrows to move your cursor onto the target above it.',
    hint: "The arrows move your cursor. When it's on the target, tap GO.",
  },
  'earth-board': { title: 'Get on' },
}
