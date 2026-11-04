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

/** What the scene's buffer asks for, in bytes: the multisampled colour, depth and stencil, and the resolved colour, depth and stencil. */
export function composerBytes(pixels: number, samples: number): number {
  return pixels * samples * (COLOUR_B + DEPTH_STENCIL_B) + pixels * (COLOUR_B + DEPTH_STENCIL_B)
}

/**
 * The device pixels of the canvas this page opened with, at the ratio it draws at
 * (Scene.tsx: 1 to 2). From the window and not the screen: browser zoom raises the
 * ratio and leaves `screen` alone, so 1440p at 125% read as 5.8 MP with the same
 * canvas pixels as ever, where the window shrinks as the ratio rises and the two
 * cancel. Read once: a new sample count makes a new composer, and resizing or
 * dragging the window across monitors should not.
 */
export function canvasPixels(view: { innerWidth: number; innerHeight: number; devicePixelRatio: number }): number {
  const ratio = Math.min(2, Math.max(1, view.devicePixelRatio))
  return view.innerWidth * view.innerHeight * ratio * ratio
}
