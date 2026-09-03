/**
 * decode.ts — the look of a key opening a bag.
 *
 * Pure helpers behind the find ceremony. A found item does not simply appear:
 * a message resolves out of scrambled glyphs, a shard's vertices settle out of
 * noise into their places, and both take about a second and a half, long
 * enough to be read as an event and short enough not to be waited on. Every
 * random choice is a hash of a seed, so a replay looks the same and tests can
 * pin the behaviour down.
 */

/** Katakana from the wordmark, hex, and block glyphs: what ciphertext looks like when it is still ciphertext. */
export const GLYPHS = 'オノセンダイアウエカキクケコサシスタチツテトナニヌネハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF░▒▓'

/** How long a shard takes to settle, and a text to resolve, in ms. */
export const SHARD_DECODE_MS = 1800
export const TEXT_DECODE_MS = 1400
/** How long the KEY FOUND chip stays up. */
export const CHIP_MS = 5000

/** A deterministic value in [0, 1) for an index under a seed. */
export function hash01(i: number, seed: number): number {
  let h = (i * 0x9e3779b1) ^ (seed * 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

/** A seed from a string key, so every item scrambles its own way. */
export function seedOf(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619)
  return h >>> 0
}

export function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t))
  return 1 - (1 - u) ** 3
}

/**
 * The text at progress t in [0, 1]: each character resolves at its own moment
 * (a hash of its index, not left to right, so it reads as decryption rather
 * than typing) and shows a changing glyph until then. Whitespace stays put so
 * the shape of the message is visible before its words are.
 */
export function decodeText(target: string, t: number, seed: number, frame: number): string {
  const p = Math.min(1, Math.max(0, t))
  let out = ''
  for (let i = 0; i < target.length; i++) {
    const ch = target[i]
    if (/\s/.test(ch)) { out += ch; continue }
    const threshold = 0.1 + 0.8 * hash01(i, seed)
    if (p >= threshold) { out += ch; continue }
    out += GLYPHS[Math.floor(hash01(i * 31 + frame * 7, seed) * GLYPHS.length)]
  }
  return out
}

/** Symmetric per-vertex noise in [-extent, extent] on each axis. */
export function scrambleOffset(i: number, seed: number, extent: number): [number, number, number] {
  return [
    (hash01(i * 3, seed) * 2 - 1) * extent,
    (hash01(i * 3 + 1, seed) * 2 - 1) * extent,
    (hash01(i * 3 + 2, seed) * 2 - 1) * extent,
  ]
}
