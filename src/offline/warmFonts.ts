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

export function warmLabelFonts(): void {
  if (typeof navigator === 'undefined' || navigator.onLine === false) return
  try {
    preloadFont({ font: WORLD_FONT, characters: LABEL_SYMBOLS }, () => {})
  } catch {
    // A font that will not load now is fetched again when a label needs it.
  }
}
