/** troika-three-text ships no types; this is the one call the app makes directly (warmFonts.ts). */
declare module 'troika-three-text' {
  export function preloadFont(options: { font?: string; characters: string | string[]; sdfGlyphSize?: number }, callback: () => void): void
}
