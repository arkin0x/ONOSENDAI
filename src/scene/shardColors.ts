/**
 * shardColors.ts: a shard's colors as the GPU wants them.
 *
 * A shard's colors are sRGB (DECK-0003 Appendix C: "Each is sRGB, eight bits a
 * channel"), kept in the model and on the wire as 0..1 of those eight bits.
 * three.js reads a vertex color as LINEAR light and encodes the frame to sRGB
 * on its way to the screen, so a vertex color handed over as it stands is
 * encoded once with nothing to undo it. That lifts every channel below full:
 * 25 reads as 88, so the palette's blue #1902ff drew as violet #5816ff beside
 * a chip and handle dots showing true blue (arkinox, 2026-10-31). The chip is
 * CSS and the dots go through `new Color(hex)`, which converts: only the
 * faces, lines and points that came through the attribute were wrong.
 *
 * Converted once, here, at the edge of the renderer, and nowhere else: the
 * model, the store, the wire and the chip all stay in sRGB, which is what the
 * spec says they are.
 */

/** One channel, sRGB to linear light: the same curve three's Color uses for a hex. */
function linearChannel(n: number): number {
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
}

/** Every eight-bit value, since nearly every color a shard holds is a palette entry. */
const BYTES = Float32Array.from({ length: 256 }, (_, i) => linearChannel(i / 255))

/**
 * A flat rgb array of sRGB channels as a new array of linear ones. The input
 * is left alone. A channel between two eight-bit values (the average of a
 * face's corners, say) takes the curve itself.
 */
export function linearColors(colors: ArrayLike<number>): Float32Array {
  const out = new Float32Array(colors.length)
  for (let i = 0; i < colors.length; i++) {
    const n = colors[i]
    const byte = Math.round(n * 255)
    out[i] = byte >= 0 && byte <= 255 && Math.abs(n * 255 - byte) < 1e-4 ? BYTES[byte] : linearChannel(n)
  }
  return out
}
