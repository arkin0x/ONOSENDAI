/**
 * chainRulesEpoch.ts - which chain rules this build signs movement under, and
 * the small file every deploy serves to say which rules it requires.
 *
 * The owner's ruling of 2026-10-30, before the hop proof v2 cutover: a tab
 * opened before a deploy that changes the chain rules must not go on
 * publishing movement in the old format after it. So every build carries
 * CHAIN_RULES_EPOCH, and every deploy serves /version.json naming its build and
 * the lowest epoch it accepts (`minChainEpoch`, this same constant). A tab
 * whose own epoch is lower than the deployed one stops signing and sending
 * kind 3333 and asks for a RELOAD (lib/versionGate.ts). Everything else in
 * the tab keeps working.
 *
 * A PR that changes what a valid movement event looks like (the cutover)
 * bumps CHAIN_RULES_EPOCH by one, in the same PR. Nothing else does: a build
 * that only differs in its build id is a soft hint, never a block.
 *
 * Not the store's `chainEpoch` (store/useCyberspace.ts), which counts
 * respawns on this page to retire stale relay looks; nothing links the two.
 * The file's field keeps the name `minChainEpoch`, the shape the owner set.
 *
 * Read by vite.config.ts at build time, so nothing here may touch the
 * browser.
 */

/**
 * The chain rules this build signs movement under. Bumped only by a PR that
 * changes them.
 *
 * | epoch | chain rules | from |
 * |---|---|---|
 * | 1 | hops carry the version 1 proof hash | the version gate (#530) |
 * | 2 | hop proof version 2, residue openings: every hop carries `proof` (the seal), `mn` and `mp` (spec 5.9 to 5.13, revision 2026-10-08-residue-openings) | the hop proof v2 cutover (ono-1) |
 *
 * CUTOVER CHECKLIST, for the PR that bumps this (hop proof v2 first):
 *
 * 1. Signed but unsent events. A stale tab keeps whatever it signed and had
 *    not sent (LOCAL, offline, queued, a held chain) in its saved chain, and
 *    the reloaded build loads and would publish them. Those may be in the
 *    old format: the new build must inspect each unpublished event's format
 *    and decide (publish, drop, or re-sign), never send it blind.
 * 2. Kept HOSAKA jobs. A paid job kept in the Cloud compute panel resumes
 *    after the reload; its proof may be in the old format too, so RESUME
 *    must check that before it signs.
 * 3. The stale window. A tab learns of the bump at its next look: at most
 *    PRE_MOVE_MAX_AGE_MS (60 s) of a cached "ok" before a move, plus any move
 *    whose look timed out (it goes ahead; the late answer still blocks the
 *    next one and holds the publisher). Expect a minute or so of old-format
 *    moves from tabs that were moving at the instant of the deploy.
 * 4. What the gate does not reach:
 *    - tabs opened before this gate first deployed: they have no gate at all
 *      and keep the old format until they reload;
 *    - cyberspace-mcp agents and any other client: their own release;
 *    - the TV stream: it signs nothing, but it reloads when it learns of a
 *      block (lib/versionGate.ts, reloadBroadcast) so it verifies by the new
 *      rules. Check it came back after the deploy.
 *
 * How the bump to 2 (hop proof v2) answers it:
 *
 * 1. lib/staleFormat.ts, from store/useCyberspace.ts whenever the chain in
 *    hand changes, and lib/publisher.ts before every send: an unsent hop in
 *    the old format (no `mn`, no `mp`) is never published. The chain is cut
 *    back to the event before it, which drops every unsent event after it
 *    too, since each is bound to it. One such hop alone at the head, within
 *    this machine's ceiling, is put back on the cursor to be proved again in
 *    the new format with one COMMIT; anything else is dropped with a notice.
 *    Never re-proved without the player: a commit opens the publisher's
 *    release gate, which only a deliberate action may do.
 * 2. lib/cloud.ts straddlingV1Hop: a kept hop job that comes back in the old
 *    hop_n shape is refused unsigned and its record dropped (decision D-A,
 *    recommended default; HOSAKA refunds it). A version 2 result is checked
 *    at Level 1 like any other.
 * 3 and 4 stand as written. cyberspace-mcp and cyberspace-cli are their own
 *    releases (mcp-1, cli-2).
 */
export const CHAIN_RULES_EPOCH = 2

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
export function versionFileOf(build: string, epoch: number = CHAIN_RULES_EPOCH): DeployedVersion {
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
