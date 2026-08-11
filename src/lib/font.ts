/**
 * font.ts — the typeface for text drawn inside the world.
 *
 * Monaspace Krypton, from GitHub's Monaspace family. Served from public/ rather
 * than imported, because troika (which drei's Text uses) loads fonts by URL and
 * reads TTF/OTF/WOFF but not WOFF2.
 *
 * Use this for every in-world label, so the 3D text stays one voice.
 */
export const WORLD_FONT = '/fonts/MonaspaceKrypton-Regular.woff'
