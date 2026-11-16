/**
 * level.ts - a DRONE RUN level (level.json, with payloads/<piece>.json beside
 * it), read and checked. Pure. Two levels exist: the BUILT-IN FIELD, authored
 * in code (placeholderField.ts) and signed into the bundled fixture; and a
 * level the player imports on their own device as a zip (package.ts), which
 * never leaves it.
 *
 * Every coordinate is REGION-LOCAL: whole gibsons 0..255 on each axis from
 * the region's base (game.ts DRONE_RUN_BASE). +X right, +Y up, the run goes
 * toward -Z. Ground level is y 64.
 *
 *   {
 *     "format": "drone-run-level/1",
 *     "id": "<level id>", "name": "<name>",
 *     "groundY": 64,
 *     "entry": [x, y, z],                       // the player's feet at the start: inside zones.start
 *     "zones": { "start": { "lo": [x,y,z], "hi": [x,y,z] }, "finish": { ... } },   // boxes, both corners included
 *     "spawns": [ { "id": "<spawn id>", "at": [x, y, z] } ],
 *     "patrol": [[x, y, z], ...],                                                  // optional: where idle drones wander
 *     "routes": [ { "id": "<route id>", "points": [[x, y, z], ...] } ],             // optional
 *     "pieces": [ { "piece": "<name of payloads/<name>.json>", "at": [x, y, z] } ]
 *   }
 *
 * For example (made up): { "piece": "field-berm-a", "at": [64, 64, 186] }
 * stands payloads/field-berm-a.json with its origin at x 64, y 64, z 186.
 *
 * A piece stands with its origin at `at`, as a shard hidden at a coordinate
 * does (spec §7.6). A bag item carries a coordinate and nothing else, no
 * rotation (spec §7.6 References: `["a", address, hint, coord]`; an inline
 * item's only place is its `C`), so a piece turned another way is its own
 * payload with the turn baked into its vertices. Fields this file does not
 * know are kept out of the world and ignored here.
 */

/** The format this reads. */
export const LEVEL_FORMAT = 'drone-run-level/1'

/** A region-local point: whole gibsons from the region's base. */
export type Local = [number, number, number]

/** A box of region-local gibsons, both corners included. */
export interface LevelBox {
  lo: Local
  hi: Local
}

export interface LevelPiece {
  piece: string
  at: Local
}

export interface Level {
  format: typeof LEVEL_FORMAT
  id: string
  name: string
  groundY: number
  entry: Local
  zones: { start: LevelBox; finish: LevelBox }
  spawns: Array<{ id: string; at: Local }>
  /** Points idle drones wander between; empty when the level gives none. */
  patrol: Local[]
  routes: Array<{ id: string; points: Local[] }>
  pieces: LevelPiece[]
}

/** The region's side, in gibsons (height 8). */
const SIDE = 256

/** A piece's name: what its payload file is called, lowercase letters, digits and dashes. */
const PIECE_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

function local(raw: unknown, what: string): Local {
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every((v) => Number.isInteger(v) && v >= 0 && v < SIDE)) {
    throw new Error(`${what} is not a region-local point (three whole gibsons, 0 to ${SIDE - 1})`)
  }
  return [raw[0], raw[1], raw[2]]
}

function box(raw: unknown, what: string): LevelBox {
  const b = raw as { lo?: unknown; hi?: unknown } | null
  const lo = local(b?.lo, `${what}.lo`)
  const hi = local(b?.hi, `${what}.hi`)
  if (lo.some((v, i) => v > hi[i])) throw new Error(`${what}: lo is above hi`)
  return { lo, hi }
}

function word(raw: unknown, what: string): string {
  if (typeof raw !== 'string' || raw.trim() === '') throw new Error(`${what} is missing`)
  return raw
}

/** Whether `p` lies in `b`, both corners included. */
export function insideBox(b: LevelBox, p: Local): boolean {
  return p.every((v, i) => v >= b.lo[i] && v <= b.hi[i])
}

/** A level.json read and checked, or an error that says what is wrong. */
export function readLevel(raw: unknown): Level {
  const r = raw as Record<string, unknown> | null
  if (!r || typeof r !== 'object') throw new Error('a level is a JSON object')
  if (r.format !== LEVEL_FORMAT) throw new Error(`this reads ${LEVEL_FORMAT}, not ${String(r.format)}`)
  const zonesRaw = r.zones as Record<string, unknown> | undefined
  const zones = { start: box(zonesRaw?.start, 'zones.start'), finish: box(zonesRaw?.finish, 'zones.finish') }
  const entry = local(r.entry, 'entry')
  if (!insideBox(zones.start, entry)) throw new Error('the entry point is not inside the start zone')
  if (typeof r.groundY !== 'number' || !Number.isInteger(r.groundY) || r.groundY < 0 || r.groundY >= SIDE) throw new Error(`groundY is not a whole gibson inside the region (0 to ${SIDE - 1})`)
  if (zones.start.lo.every((v, i) => v <= zones.finish.hi[i]) && zones.finish.lo.every((v, i) => v <= zones.start.hi[i])) throw new Error('the start and finish zones overlap')
  if (!Array.isArray(r.pieces) || r.pieces.length === 0) throw new Error('a level places at least one piece')
  const pieces = r.pieces.map((p, i): LevelPiece => {
    const q = p as { piece?: unknown; at?: unknown } | null
    if (typeof q?.piece !== 'string' || !PIECE_NAME.test(q.piece)) throw new Error(`pieces[${i}].piece is not a piece name (lowercase letters, digits and dashes)`)
    return { piece: q.piece, at: local(q.at, `pieces[${i}].at`) }
  })
  const spawns = (Array.isArray(r.spawns) ? r.spawns : []).map((s, i) => {
    const q = s as { id?: unknown; at?: unknown } | null
    return { id: word(q?.id, `spawns[${i}].id`), at: local(q?.at, `spawns[${i}].at`) }
  })
  const patrol = (Array.isArray(r.patrol) ? r.patrol : []).map((p, i) => local(p, `patrol[${i}]`))
  const routes = (Array.isArray(r.routes) ? r.routes : []).map((s, i) => {
    const q = s as { id?: unknown; points?: unknown } | null
    if (!Array.isArray(q?.points)) throw new Error(`routes[${i}].points is not a list`)
    return { id: word(q?.id, `routes[${i}].id`), points: q.points.map((p, j) => local(p, `routes[${i}].points[${j}]`)) }
  })
  return { format: LEVEL_FORMAT, id: word(r.id, 'id'), name: word(r.name, 'name'), groundY: r.groundY, entry, zones, spawns, patrol, routes, pieces }
}

/** The pieces a level places, each name once, in the order first placed. */
export function pieceNames(level: Pick<Level, 'pieces'>): string[] {
  return [...new Set(level.pieces.map((p) => p.piece))]
}
