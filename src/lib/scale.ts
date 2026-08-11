/**
 * scale.ts — the physical size of one cell at a given scale.
 *
 * The spec puts 2^33 gibsons in a metre (§9.2, §9.7), so a gibson is about
 * 1.16e-10 m, roughly a hydrogen atom.
 */

/** Gibson size in metres: 2^-33. */
const GIBSON_METERS = 2 ** -33

const UNITS: Array<{ threshold: number; symbol: string; scale: number }> = [
  { threshold: 1e-9, symbol: 'pm', scale: 1e12 },
  { threshold: 1e-6, symbol: 'nm', scale: 1e9 },
  { threshold: 1e-3, symbol: '\u03bcm', scale: 1e6 },
  { threshold: 1e-2, symbol: 'mm', scale: 1e3 },
  { threshold: 1e-1, symbol: 'cm', scale: 1e2 },
  { threshold: 1e3, symbol: 'm', scale: 1 },
  { threshold: 1e6, symbol: 'km', scale: 1e-3 },
  { threshold: 1e9, symbol: 'Mm', scale: 1e-6 },
  { threshold: 1.496e11, symbol: 'AU', scale: 1 / 1.496e11 },
]

/** One cell at this scale, as a short human string like "1.91 \u03bcm". */
export function formatCellSize(scaleExp: number): string {
  const meters = 2 ** scaleExp * GIBSON_METERS
  for (let i = 0; i < UNITS.length; i++) {
    const u = UNITS[i]
    if (meters < u.threshold || i === UNITS.length - 1) {
      return `${parseFloat((meters * u.scale).toPrecision(3))} ${u.symbol}`
    }
  }
  return `${meters} m`
}
