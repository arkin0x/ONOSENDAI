/**
 * workshopSchema.ts - how this build saves shards, and the number a deploy
 * uses to stop older tabs from saving them.
 *
 * A tab opened before a deploy keeps running its old bundle. When the deploy
 * changes how a shard is stored or published, the old bundle may read the new
 * form wrongly and save it back damaged. The case that made this gate: GRID
 * SIZE to 4,096 (#555). A tab of the bundle before it read a model with a
 * vertex past 64 units as the old tick format, shrank it 120 times, and saved
 * it shrunk on its next edit (store/olderReaders.ts).
 *
 * So every build carries WORKSHOP_SCHEMA, and every deploy serves
 * /version.json with `minWorkshopSchema`, this same constant
 * (lib/chainRulesEpoch.ts). A tab whose own number is lower stops saving
 * shards, importing them and hiding or publishing anything that carries one,
 * and asks for a RELOAD (lib/versionGate.ts, store/workshopStorage.ts). Its
 * unsaved changes are held across that reload and come back after it.
 *
 * | schema | how shards are saved | from |
 * |---|---|---|
 * | 1 | GRID SIZE up to 64 units; an older sno-core reads every stored model the same | before #555 |
 * | 2 | GRID SIZE up to 4,096 units (DECK-0003 §1.8); a vertex past 64 units is stored with an explicit `t` | #555 |
 *
 * A PR that changes how a shard is stored or published, so that a build
 * before it would read the new form wrongly, bumps this by one in the same
 * PR. Nothing else does.
 *
 * What the gate does not reach: tabs of a build from before this gate, which
 * do not read `minWorkshopSchema` at all (every build before this one,
 * including the #555 build's first deploy), and other clients.
 *
 * Read by vite.config.ts at build time, so nothing here may touch the browser.
 */
export const WORKSHOP_SCHEMA = 2
