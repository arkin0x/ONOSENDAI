/**
 * dna.ts: the tutorial tree, MOON BLOSSOM v2 (first-arrival tutorial design,
 * 2026-11-10, T6, open question 5; the owner's pick, 2026-11-11).
 *
 * The DNA is the owner's event template exactly as the owner will publish it
 * under their own npub (tutorial/moon-blossom-v2-event.json, kind 3350, the
 * free caps 2,048 / 2,048 / 32: 16 bits a seed). Its bud picture beside it
 * (public/tutorial/bud.png) is the tree on day 3.
 *
 * Once the owner publishes it, every new tutorial seed names that event, as
 * every seed of an original DNA names the owner's event once it is set
 * (lib/seeds/originalDnas.ts ORIGINAL_DNA_IDS): TUTORIAL_DNA_ID holds the
 * event id, empty until then. Until it is set, the player's SEED signs a copy
 * of the DNA under their own key, as it always has.
 *
 * The SEED composer offers the original DNAs and PASTE, not this tree, so the
 * plant step lines the seed up itself, through the same deploy SEED's PLANT
 * starts (tutorialSeedDraft, tutorial/director.ts), and the player plants it
 * with HIDE. Nothing in the Seeds client is changed.
 */

import { BASE_CAPS, type Caps } from 'sno-core/seeds'
import { originalDnaId, type OriginalDna } from '../lib/seeds/originalDnas'
import type { SeedDraft } from '../lib/seeds/plant'
import moonBlossom from './moon-blossom-v2-event.json'

/** The caps a DNA event's `caps` tag names, or the free caps when it names none (DECK-0008 §7). */
function capsOf(tags: readonly (readonly string[])[]): Caps {
  const t = tags.find((x) => x[0] === 'caps')
  if (!t) return BASE_CAPS
  const [v, s, g] = t.slice(1, 4).map(Number)
  return [v, s, g].every((n) => Number.isInteger(n) && n > 0) ? { vertices: v, symbols: s, generations: g } : BASE_CAPS
}

/** The name on a DNA's `dna` line. */
function dnaName(text: string): string {
  return /^dna[ \t]+(.+)$/m.exec(text)?.[1]?.trim() ?? 'tutorial tree'
}

/** The DNA the tutorial's seed grows. */
export const TUTORIAL_DNA: OriginalDna = { name: dnaName(moonBlossom.content), text: moonBlossom.content, caps: capsOf(moonBlossom.tags) }

/**
 * The owner's published event for the tutorial tree, by id, or empty while it
 * is unpublished. Set it once the owner publishes moon-blossom-v2-event.json.
 */
export const TUTORIAL_DNA_ID = ''

/** The owner's event id for the tutorial tree, or null while none is set (checked as an original DNA's is). */
export function tutorialDnaId(id: string = TUTORIAL_DNA_ID): string | null {
  return originalDnaId(TUTORIAL_DNA.name, { [TUTORIAL_DNA.name]: id })
}

/**
 * The seed the plant step lines up: the tutorial tree at scale 0, at the
 * owner's event and its own size limit once it is published (`owned`, the
 * caps the resolver read from it), otherwise at the DNA's own caps, for the
 * player's SEED to sign a copy of, as SEED's PLANT does (hud/SeedCompose).
 */
export function tutorialSeedDraft(id: string | null = tutorialDnaId(), owned?: Caps): SeedDraft {
  return { text: TUTORIAL_DNA.text, caps: id && owned ? owned : TUTORIAL_DNA.caps, scale: 0, title: '', ...(id ? { dnaId: id } : {}) }
}

/** Its picture as it starts to bud (day 3), for the step after planting. */
export const TUTORIAL_BUD_PICTURE = '/tutorial/bud.png'
