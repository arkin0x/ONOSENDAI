/**
 * blocks.ts - the blocks TERRAIN knows: DECK-0009's initial registry (§2.3,
 * draft of 2026-11-24), which is the 3D previews' placeholder block set
 * (craft-design/previews/terrain-viewer.html): their ids, names and colours.
 * The pictures are the previews' 16 by 16 tiles (tiles.ts). Names are our
 * own: never another block game's.
 *
 * One block is one gibson (arkinox, 2026-11-24). Ids: 0 open space, 1 to 63
 * natural, 64 to 191 made and placed, 192 to 254 special, 255 the extension
 * marker (never placed). An id this client has no kind for (a later
 * revision's) draws as a neutral block that says it is unknown (DECK §2.3).
 */

export const EMPTY = 0

/** One kind of block, as the screen knows it. */
export interface BlockKind {
  /** Its DECK id. */
  id: number
  /** Its place in KINDS, and its tile row (tiles.ts). */
  index: number
  name: string
  /** The previews' base colour: the face. */
  color: string
  /** The previews' accent colour: veins, edges, glow. */
  edge: string
  /** Glows by itself. */
  glow?: boolean
  /** Seen through: drawn in the scene's see-through pass, and a block behind it shows. */
  clear?: boolean
  /** Walked through, not on: WALK's walls leave it out (a liquid). */
  passable?: boolean
}

export const KINDS: readonly BlockKind[] = [
  { id: 1, index: 0, name: 'Gridstone', color: '#555e60', edge: '#80898c' },
  { id: 2, index: 1, name: 'Umberslate', color: '#1d3547', edge: '#6f8ea0' },
  { id: 3, index: 2, name: 'Driftsilt', color: '#946100', edge: '#cc8f00' },
  { id: 4, index: 3, name: 'Mossveil', color: '#00ba67', edge: '#00f39e' },
  { id: 5, index: 4, name: 'Rustband', color: '#943300', edge: '#f47000' },
  { id: 6, index: 5, name: 'Frostshale', color: '#c8f5ff', edge: '#5d6769' },
  { id: 7, index: 6, name: 'Cinderrock', color: '#1a0f24', edge: '#ff3300' },
  { id: 8, index: 7, name: 'Prismite', color: '#a24bff', edge: '#e1bcff', glow: true },
  { id: 40, index: 8, name: 'Ferrovein', color: '#555e60', edge: '#e7a800' },
  { id: 41, index: 9, name: 'Cobaltine', color: '#1d3547', edge: '#5a9bff' },
  { id: 42, index: 10, name: 'Glowcore', color: '#15191a', edge: '#00e5ff', glow: true },
  { id: 43, index: 11, name: 'Gibsonite', color: '#4b0058', edge: '#ff00ff', glow: true },
  { id: 192, index: 12, name: 'Relic shard', color: '#5c0010', edge: '#ff3b6b', glow: true },
  // Revision 2 (owner, 2026-11-24: "lets ship it"): eleven more, our own names, the same 16 by 16 tile style.
  { id: 9, index: 13, name: 'Basaltine', color: '#22232b', edge: '#5b6070' },
  { id: 10, index: 14, name: 'Rimeglass', color: '#a9e8ff', edge: '#e6fbff', clear: true },
  { id: 11, index: 15, name: 'Tidewater', color: '#1d5fd6', edge: '#6fb4ff', clear: true, passable: true },
  { id: 12, index: 16, name: 'Magmaflow', color: '#ff5a00', edge: '#ffd040', glow: true, passable: true },
  { id: 13, index: 17, name: 'Lumenwood', color: '#4a3020', edge: '#7dffcf', glow: true },
  { id: 14, index: 18, name: 'Canopy glass', color: '#1fa860', edge: '#9dffc8', clear: true },
  { id: 193, index: 19, name: 'Voidpearl', color: '#0a0614', edge: '#b48cff', glow: true },
  { id: 194, index: 20, name: 'Auroric', color: '#103040', edge: '#6dffd8', glow: true },
  { id: 195, index: 21, name: 'Chronite', color: '#202836', edge: '#ffe08a', glow: true },
  { id: 196, index: 22, name: 'Singularity core', color: '#000000', edge: '#ffffff', glow: true },
  { id: 197, index: 23, name: 'Genesis shard', color: '#fff4d6', edge: '#ffc23a', glow: true },
]

/** A block this client has no kind for (a later revision's id): a neutral look that says it is unknown (DECK §2.3). */
export const UNKNOWN_KIND: BlockKind = { id: 255, index: KINDS.length, name: 'Unknown block', color: '#3a3f4a', edge: '#9aa3b5' }

/** Every known id, to its kind. */
export const DECK_TO_KIND: Readonly<Record<number, BlockKind>> = Object.fromEntries(KINDS.map((k) => [k.id, k]))

/** The kind a block id shows as: null for open space, the unknown kind for an id no kind covers. */
export function blockKind(id: number): BlockKind | null {
  if (id === EMPTY) return null
  return DECK_TO_KIND[id] ?? UNKNOWN_KIND
}

/** The kind's name, as the screen says it. */
export function blockName(id: number): string {
  return blockKind(id)?.name ?? 'Open space'
}

/** The id a block of this id is carried and placed as: its own for a known kind, 255 (never placed) for an unknown one. */
export function kindId(id: number): number {
  return blockKind(id)?.id ?? EMPTY
}

/** Whether a cell with this id stops a walker and holds its faces (a liquid does neither). */
export function solid(id: number): boolean {
  return id !== EMPTY && !DECK_TO_KIND[id]?.passable
}

/** Whether a cell with this id is a liquid (Tidewater, Magmaflow): a block there, but walked through. */
export function liquid(id: number): boolean {
  return !!DECK_TO_KIND[id]?.passable
}

/** Whether a cell with this id is seen through (drawn in the see-through pass). */
export function clear(id: number): boolean {
  return !!DECK_TO_KIND[id]?.clear
}

/** For the mesher: 1 for every id drawn in the see-through pass. */
export function seeThroughTable(): Uint8Array {
  const t = new Uint8Array(256)
  for (const k of KINDS) if (k.clear) t[k.id] = 1
  return t
}

/** For the mesher: 1 for every id that is seen through or walked through (a block behind shows). */
export function clearTable(): Uint8Array {
  const t = new Uint8Array(256)
  for (const k of KINDS) if (k.clear || k.passable) t[k.id] = 1
  return t
}

/** The tile row of every id 0 to 255, for the mesher: the kind's index, 255 for open space. */
export function tileTable(): Uint8Array {
  const t = new Uint8Array(256).fill(UNKNOWN_KIND.index)
  t[EMPTY] = 255
  for (const [id, k] of Object.entries(DECK_TO_KIND)) t[Number(id)] = k.index
  return t
}
