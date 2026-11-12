/**
 * dna.ts: the tutorial tree, MOON BLOSSOM v2 (first-arrival tutorial design,
 * 2026-11-10, T6, open question 5; the owner's pick, 2026-11-11).
 *
 * The DNA is the owner's event template exactly as the owner published it
 * under their own npub (tutorial/moon-blossom-v2-event.json, kind 3350, the
 * free caps 2,048 / 2,048 / 32: 16 bits a seed). Its bud picture beside it
 * (public/tutorial/bud.png) is the tree on day 3.
 *
 * Every new tutorial seed names that published event, as every seed of a
 * DNA SEED lists names the owner's event once it is set
 * (lib/seeds/seedDnas.ts SEED_DNA_IDS): TUTORIAL_DNA_ID holds the
 * event id. Were it empty, the player's SEED would sign a copy of the DNA
 * under their own key instead.
 *
 * The SEED composer offers the DNAs it lists and PASTE, not this tree, so the
 * plant step lines the seed up itself, through the same deploy SEED's PLANT
 * starts (tutorialSeedDraft, tutorial/director.ts), and the player plants it
 * with HIDE. Nothing in the Seeds client is changed.
 */

import { BASE_CAPS, capsFromTags, type Caps } from 'sno-core/seeds'
import type { OriginalDna } from '../lib/seeds/originalDnas'
import { readDnaText, type SeedDraft } from '../lib/seeds/plant'
import type { NostrEvent } from '../lib/events'
import moonBlossom from './moon-blossom-v2-event.json'
import moonBlossomPublished from './moon-blossom-v2-published.json'

/** Its name, as the engine reads the `dna` line (a test holds that the engine accepts the text). */
const read = readDnaText(moonBlossom.content)

/**
 * The DNA the tutorial's seed grows: the template's text, and the caps its
 * `caps` tag names as sno-core reads them (the free caps if it named none
 * or one the engine refuses; a test holds them at 2,048 / 2,048 / 32).
 */
export const TUTORIAL_DNA: OriginalDna = { name: read.ok ? read.name : 'moon blossom', text: moonBlossom.content, caps: capsFromTags(moonBlossom.tags) ?? BASE_CAPS }

/**
 * The owner's published event for the tutorial tree, by id: MOON BLOSSOM v2,
 * kind 3350, moon-blossom-v2-event.json byte for byte (published 2026-11-11).
 * Empty would mean unpublished.
 */
export const TUTORIAL_DNA_ID = '75156b56dda84154f42581a097dd14691c60550088cafa9a8639db9c305de264'

/**
 * The owner's published event itself, signed, as the relays hold it
 * (moon-blossom-v2-published.json; its id is TUTORIAL_DNA_ID). It ships with
 * the app and is staged in the welcome chest (tutorial/stage.ts); the plant
 * step plants the copy the player took from there, noted on this device
 * (lib/seeds/seedSources dnaResolver, which checks its signature) before
 * resolving the id, so no relay is needed for it.
 */
export const TUTORIAL_DNA_EVENT: NostrEvent = moonBlossomPublished

/** The owner's event id for the tutorial tree, or null while none is set (64 lowercase hex, as an original DNA's is checked). */
export function tutorialDnaId(id: string = TUTORIAL_DNA_ID): string | null {
  return /^[0-9a-f]{64}$/.test(id) ? id : null
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
