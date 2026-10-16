/**
 * warmFonts.ts - fetch, while online, the fallback fonts the 3D text needs
 * for the world labels' own symbols, so the service worker keeps them for
 * offline (sw.js, FONT_CACHE).
 *
 * troika (drei's Text) fetches a font from a CDN for each character the
 * world font lacks, the first time a label shows one. A label first shown
 * offline would then not be drawn. These are the characters ONOSENDAI
 * itself puts in world labels (scene/: Cursor, Earth, WorldMessages,
 * ShardGhost, SecretRegions, ChatRoomBox and the rest); a name someone
 * typed can still hold others, which then need the network once.
 */

import { preloadFont } from 'troika-three-text'
import { WORLD_FONT } from '../lib/font'

export const LABEL_SYMBOLS = '·×—…₿▣⚷⚿'

/** The worker's cache for these fonts (sw.js FONT_CACHE). */
const FONT_CACHE = 'onosendai.fonts'

/**
 * Once per device: when the cache already holds fonts, they are not fetched
 * again, and a CDN that cannot be reached (captive wifi reporting online)
 * costs nothing but a failed fetch in troika's worker, which no caller here
 * can catch (review of #367).
 */
export async function warmLabelFonts(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine === false) return
  try {
    if (typeof caches !== 'undefined' && (await (await caches.open(FONT_CACHE)).keys()).length > 0) return
    preloadFont({ font: WORLD_FONT, characters: LABEL_SYMBOLS }, () => {})
  } catch {
    // A font that will not load now is fetched again when a label needs it.
  }
}
