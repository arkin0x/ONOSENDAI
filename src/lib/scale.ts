/**
 * scale.ts — the physical size of one cell at a given scale.
 *
 * The spec puts 2^33 gibsons in a meter (§9.2, §9.7), so a gibson is about
 * 1.16e-10 m, roughly a hydrogen atom.
 */

/** Gibson size in meters: 2^-33. */
const GIBSON_METERS = 2 ** -33

const UNITS: Array<{ threshold: number; symbol: string; name: string; scale: number }> = [
  { threshold: 1e-9, symbol: 'pm', name: 'picometers', scale: 1e12 },
  { threshold: 1e-6, symbol: 'nm', name: 'nanometers', scale: 1e9 },
  { threshold: 1e-3, symbol: '\u03bcm', name: 'micrometers', scale: 1e6 },
  { threshold: 1e-2, symbol: 'mm', name: 'millimeters', scale: 1e3 },
  { threshold: 1e-1, symbol: 'cm', name: 'centimeters', scale: 1e2 },
  { threshold: 1e3, symbol: 'm', name: 'meters', scale: 1 },
  { threshold: 1e6, symbol: 'km', name: 'kilometers', scale: 1e-3 },
  { threshold: 1e9, symbol: 'Mm', name: 'megameters', scale: 1e-6 },
  { threshold: 1.496e11, symbol: 'AU', name: 'astronomical units', scale: 1 / 1.496e11 },
]

/** The unit a length in meters is best read in, and the figure in it to three significant digits. */
function inUnit(meters: number): { figure: number; unit: (typeof UNITS)[number] } {
  for (let i = 0; i < UNITS.length; i++) {
    const u = UNITS[i]
    if (meters < u.threshold || i === UNITS.length - 1) return { figure: parseFloat((meters * u.scale).toPrecision(3)), unit: u }
  }
  return { figure: meters, unit: UNITS[5] }
}

/**
 * A gibson count as a human distance.
 *
 * Takes a bigint because these are real cyberspace distances: a landmark can be
 * 10^25 gibsons away, which is past what a double holds exactly. The division to
 * meters happens in fixed point for that reason, and only then becomes a float.
 */
export function formatDistance(gibsons: bigint): string {
  if (gibsons === 0n) return '0'
  // 2^33 gibsons per meter, so this is exact rather than a rounding.
  const meters = Number((gibsons * 1_000_000n) >> 33n) / 1_000_000
  for (let i = 0; i < UNITS.length; i++) {
    const u = UNITS[i]
    if (meters < u.threshold || i === UNITS.length - 1) {
      return `${parseFloat((meters * u.scale).toPrecision(3))} ${u.symbol}`
    }
  }
  return `${meters} m`
}

/** One cell at this scale, as a short human string like "1.91 \u03bcm". */
export function formatCellSize(scaleExp: number): string {
  const { figure, unit } = inUnit(2 ** scaleExp * GIBSON_METERS)
  return `${figure} ${unit.symbol}`
}

/** The same, with the unit spelled out: "1.91 micrometers", "1 meter", "2 astronomical units". */
export function formatCellSizeLong(scaleExp: number): string {
  const { figure, unit } = inUnit(2 ** scaleExp * GIBSON_METERS)
  return `${figure} ${figure === 1 ? unit.name.replace(/s$/, '') : unit.name}`
}
