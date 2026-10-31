/**
 * chainStoreVersion.ts - which store this build keeps the chain in, and the
 * one line that takes it back.
 *
 * | version | where the chain lives |
 * |---|---|
 * | 1 | the old stores: the whole chain as one record in `onosendai:chains`, and in localStorage whenever it fits |
 * | 2 | `onosendai:events`: one row per action (lib/eventDb/chainRows.ts). The old stores stay frozen, as a backup |
 *
 * Going back is a deploy of this constant set to 1, not a revert of the code.
 * It reaches builds already running too, with no app update: the deploy's
 * /version.json carries this number as `chainStore` (lib/chainRulesEpoch.ts),
 * and a build that sees anything but 2 there stops using the rows at once, and
 * remembers that across loads (lib/chainStore.ts). A chain is only moved after
 * the deploy has said yes.
 *
 * A build on version 1 reads the rows too, takes the chain from them when they
 * are further on (the moves made on version 2 are only there), and from then
 * on saves whole to the old stores again. A later build on version 2 finds
 * what was saved meanwhile by the old stores' mark, and folds it into the rows.
 * Nothing is lost in either direction, and neither store is ever cleared.
 *
 * A plain revert to a build from before the rows also loses nothing, but it
 * cannot see the rows: moves never published wait there until a build that
 * can read them is back. That is why this constant is the way back.
 */
export const CHAIN_STORE_VERSION: 1 | 2 = 2

/**
 * Whether WebKit (Safari, and every browser on an iPhone) may keep chains in
 * rows. Not until a real iPhone has passed: nothing here can test one. iPhones
 * lose nothing meanwhile, because they stay on the old stores. Lifting this is
 * its own PR, which the owner merges. One device can try it first, by opening
 * the app with ?chainstore=trial (lib/chainStore.ts).
 */
export const CHAIN_ROWS_ON_WEBKIT: boolean = false
