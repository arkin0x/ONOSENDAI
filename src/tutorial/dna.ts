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

/**
 * The DNA the tutorial's seed grows: a starter, so the composer offers it by
 * name (a test holds it among STARTER_DNAS, and fails loudly if the owner's
 * tree goes in before the composer offers it).
 */
export const TUTORIAL_DNA: StarterDna = STARTER_DNAS.find((d) => d.name === 'oak') ?? STARTER_DNAS[0]

/** Its picture as it starts to bud, for the step after planting. */
export const TUTORIAL_BUD_PICTURE = '/tutorial/bud.png'
