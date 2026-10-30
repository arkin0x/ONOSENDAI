/**
 * chainEpoch.ts - which chain rules this build signs movement under, and
 * the small file every deploy serves to say which rules it requires.
 *
 * The owner's ruling of 2026-10-30, before the hop proof v2 cutover: a tab
 * opened before a deploy that changes the chain rules must not go on
 * publishing movement in the old format after it. So every build carries
 * CHAIN_EPOCH, and every deploy serves /version.json naming its build and
 * the lowest epoch it accepts (`minChainEpoch`, this same constant). A tab
 * whose own epoch is lower than the deployed one stops signing and sending
 * kind 3333 and asks for a RELOAD (lib/versionGate.ts). Everything else in
 * the tab keeps working.
 *
 * A PR that changes what a valid movement event looks like (the cutover)
 * bumps CHAIN_EPOCH by one, in the same PR. Nothing else does: a build
 * that only differs in its build id is a soft hint, never a block.
 *
 * Read by vite.config.ts at build time, so nothing here may touch the
 * browser.
 */

/** The chain rules this build signs movement under. Bumped only by a PR that changes them. */
export const CHAIN_EPOCH = 1

/** Where every deploy serves its version file, from the site root. */
export const VERSION_FILE = 'version.json'

/** What /version.json holds. */
export interface DeployedVersion {
  /** The deploy's build id: the commit it was built from. */
  build: string
  /** The lowest chain epoch the deploy accepts movement from. */
  minChainEpoch: number
}

/** The version file for a build of `build`, as the deploy serves it. */
export function versionFileOf(build: string, epoch: number = CHAIN_EPOCH): DeployedVersion {
  return { build, minChainEpoch: epoch }
}

/** The version file's contents read back, or null for anything that is not one. */
export function parseVersionFile(data: unknown): DeployedVersion | null {
  if (typeof data !== 'object' || data === null) return null
  const { build, minChainEpoch } = data as Record<string, unknown>
  if (typeof build !== 'string' || build === '') return null
  if (typeof minChainEpoch !== 'number' || !Number.isInteger(minChainEpoch) || minChainEpoch < 0) return null
  return { build, minChainEpoch }
}
