/**
 * dna.ts: the tutorial tree's DNA (first-arrival tutorial design, 2026-11-10,
 * T6, open question 5).
 *
 * The tutorial tree is the owner's creative call, being designed now. Until
 * it lands this is a placeholder, the oak from the spec's vectors (one of the
 * Seed Garden's starters, lib/seeds/starterDnas.ts), so the seed step can be
 * built and tried. The real tree replaces this one constant, and the bud
 * picture beside it (public/tutorial/bud.png).
 *
 * The SEED composer in BUILD offers the starters by name (hud/SeedCompose),
 * so the plant step names this DNA for the player to pick. A DNA of the
 * owner's that is not a starter needs the composer to offer it too: a
 * question for the Seeds client, not something this tutorial edits.
 */

import { STARTER_DNAS, type StarterDna } from '../lib/seeds/starterDnas'

const oak = STARTER_DNAS.find((d) => d.name === 'oak')
if (!oak) throw new Error('The oak starter is missing.')

/** The DNA the tutorial's seed grows. */
export const TUTORIAL_DNA: StarterDna = oak

/** Its picture as it starts to bud, for the step after planting. */
export const TUTORIAL_BUD_PICTURE = '/tutorial/bud.png'
