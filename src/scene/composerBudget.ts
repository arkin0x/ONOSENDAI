/**
 * composerBudget.ts: what the main view's composer may spend on multisampling.
 *
 * Every frame is drawn into one multisampled buffer: half-float colour (8 bytes
 * a sample) with depth and stencil (4 bytes a sample), then resolved. The
 * library's default of 8 samples at 3840x2160 asks for about 860 MB, and every
 * frame resolves it. The bloom over everything blurs most of what the last
 * samples add, so they cost far more than they show. More pixels make each
 * sample matter less, so the count falls as the pixels rise.
 *
 * A number here is what the page asks WebGL for. The driver may keep more.
 */

/** Past this many pixels the picture is fine enough for two samples. */
export const HIGH_RES_PIXELS = 5_000_000
export const SAMPLES = 4
export const SAMPLES_HIGH_RES = 2

/** Bytes per pixel per sample, in the multisampled buffer: RGBA16F, then DEPTH24_STENCIL8. */
const COLOUR_B = 8
const DEPTH_STENCIL_B = 4

/** The samples for a canvas of this many device pixels. */
export function composerSamples(pixels: number): number {
  return pixels > HIGH_RES_PIXELS ? SAMPLES_HIGH_RES : SAMPLES
}

/** What the scene's buffer asks for, in bytes: the multisampled colour, depth and stencil, and the resolved colour. */
export function composerBytes(pixels: number, samples: number): number {
  return pixels * samples * (COLOUR_B + DEPTH_STENCIL_B) + pixels * COLOUR_B
}

/**
 * The device pixels of the screen this page opened on, at the ratio the canvas
 * draws at (Scene.tsx: 1 to 2). Read once: a new sample count makes a new
 * composer, and dragging the window across monitors should not.
 */
export function screenPixels(view: { screen: { width: number; height: number }; devicePixelRatio: number }): number {
  const ratio = Math.min(2, Math.max(1, view.devicePixelRatio))
  return view.screen.width * view.screen.height * ratio * ratio
}
