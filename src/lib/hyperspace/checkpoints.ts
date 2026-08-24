/**
 * checkpoints.ts: block hashes this build KNOWS, independent of any server.
 *
 * The header blobs prove their own work, but proof of work alone only shows
 * that someone spent energy: a fabricated low-difficulty chain could satisfy
 * every structural rule. Pinning known mainnet block hashes into the source
 * makes that impossible past the pinned heights: a blob whose reconstruction
 * disagrees with an embedded checkpoint is discarded no matter what the
 * manifest says, so a compromised manifest host cannot substitute a chain.
 *
 * The manifest carries its own checkpoint list (the last block of each blob);
 * those are always enforced. Entries below are the second, stronger opinion,
 * verified wherever their height lands inside a blob.
 */

export interface Checkpoint {
  height: number
  /** Display-order (byte-reversed sha256d) block hash, 64 lowercase hex. */
  blockHash: string
}

/** The mainnet genesis block. */
export const GENESIS_HASH = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'

export const EMBEDDED_CHECKPOINTS: Checkpoint[] = [
  { height: 0, blockHash: GENESIS_HASH },
  // TODO(headers-v1 packager): append the final-block hash of each published
  // blob here once the packager publishes the release, e.g.
  // { height: 49999, blockHash: '...' },
  // { height: 99999, blockHash: '...' },
]
