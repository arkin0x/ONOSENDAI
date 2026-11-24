/**
 * readBlockFile.ts: one picked or dropped block file, read into a build
 * (lib/blocks/blockGrid.ts). The import's door for .schem, .litematic and
 * structure .nbt files; the workshop's IMPORT sends them here by their
 * ending (isBlockFile), and reads every other 3D file as it always has.
 */

import { BlockImportError, type BlockGrid } from './blockGrid'
import { decodeGrid, type Clock } from './formats'
import { readNbtRoot } from './nbtRead'

/** The endings of the block files import reads. */
export const BLOCK_EXTENSIONS = ['.schem', '.litematic', '.nbt'] as const

/** What a file picker should offer for them. */
export const BLOCK_ACCEPT = BLOCK_EXTENSIONS.join(',')

/** Whether a file is a block build, by its name. */
export function isBlockFile(name: string): boolean {
  const n = name.toLowerCase()
  return BLOCK_EXTENSIONS.some((e) => n.endsWith(e))
}

/** Whether a file is the old MCEdit format, which import does not read (design 4.1). */
export function isOldSchematic(name: string): boolean {
  return /\.schematic$/i.test(name)
}

/** A block file's bytes as a build, or a BlockImportError with a sentence for the person. */
export async function readBlockFile(name: string, bytes: Uint8Array, clock?: Clock): Promise<BlockGrid> {
  if (bytes.length === 0) throw new BlockImportError('That file is empty.')
  const root = await readNbtRoot(bytes)
  return decodeGrid(root, name, clock)
}
