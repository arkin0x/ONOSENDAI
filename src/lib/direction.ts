/**
 * direction.ts: which way a thing is from where you are looking, as an arrow
 * and plain words (shared piece "Distance and direction": "Up and to the
 * left · 466 pm").
 *
 * Given the thing's offset in the camera's own frame (x to the right, y up,
 * looking down -z), the arrow is the turn on screen toward it, 0 degrees
 * straight up and clockwise from there, and the words say the same thing a
 * person would: ahead, behind you, to the left, up and to the right, below.
 *
 * Pure: the camera and the thing are passed in as numbers.
 */

/** An arrow's turn in degrees (0 up, clockwise) and the words for it. */
export interface Direction { deg: number; words: string }

/** Nearer than this share of a unit vector off centre counts as straight ahead or behind. */
const SIDE = 0.38

/**
 * The direction of an offset in camera space. `near` is how close counts as
 * right here, in the offset's own units.
 */
export function directionOf(offset: readonly [number, number, number], near = 1e-6): Direction {
  const [x, y, z] = offset
  const len = Math.hypot(x, y, z)
  if (!(len > near)) return { deg: 0, words: 'Right here' }
  const ux = x / len
  const uy = y / len
  const ahead = -z / len
  // On screen: straight up is 0, to the right is 90. A thing dead behind points down.
  const deg = Math.abs(ux) < 1e-9 && Math.abs(uy) < 1e-9 ? (ahead >= 0 ? 0 : 180) : ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360
  const side = ux > SIDE ? 'right' : ux < -SIDE ? 'left' : null
  const height = uy > SIDE ? 'up' : uy < -SIDE ? 'down' : null
  let words: string
  if (ahead < -0.5) words = side ? `Behind you to the ${side}` : height ? `Behind you and ${height === 'up' ? 'above' : 'below'}` : 'Behind you'
  else if (side && height) words = `${height === 'up' ? 'Up' : 'Down'} and to the ${side}`
  else if (side) words = `To the ${side}`
  else if (height) words = height === 'up' ? 'Above' : 'Below'
  else words = ahead >= 0 ? 'Ahead' : 'Behind you'
  // Straight ahead the arrow points up, as the words say, not at the small offset left over.
  if (words === 'Ahead') return { deg: 0, words }
  return { deg: Math.round(deg), words }
}
