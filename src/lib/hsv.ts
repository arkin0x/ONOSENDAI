/**
 * hsv.ts — hue, saturation and brightness for the workshop's mixer.
 *
 * RGB is the store's form, three floats in 0..1. HSV is the mixer's: hue in
 * degrees 0..360, saturation and brightness in percent, since those are the
 * numbers a person drags.
 */

export type Rgb = [number, number, number]
export type Hsv = [number, number, number]

export function rgbToHsv([r, g, b]: Rgb): Hsv {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : (d / max) * 100, max * 100]
}

export function hsvToRgb([h, s, v]: Hsv): Rgb {
  const S = s / 100
  const V = v / 100
  const c = V * S
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = V - c
  const [r, g, b]: Rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [r + m, g + m, b + m]
}
