/**
 * olderReaders.ts: a stored model that a tab on an older sno-core reads the
 * same as this one does (review of #555, 2026-11-23).
 *
 * sno-core up to 0.1.33 recognised a model from the short time when stored
 * models kept total ticks in `p` by a whole-unit coordinate above 64 with no
 * `t`. GRID SIZE now runs to 4,096 (DECK-0003 §1.8), so a real model can have
 * exactly that, and a stale tab of the old bundle reading this device's
 * storage would shrink it 120 times and save it shrunk on its next edit.
 *
 * The old test only fires where `t` is absent. So a vertex further out than 64
 * units is stored with an explicit `t: [0, 0, 0]`, which means the same
 * position to every version (sno-core reads `t ?? [0, 0, 0]`), and the old
 * test passes it by. Applied where a model is written to storage, never to the
 * model in memory, and only to vertices that need it, so a shard within 64
 * units is stored byte for byte as before.
 */
import type { ShardModel, ShardVertex } from 'sno-core/shards'

/** The bound an older sno-core reads stored models by (its MAX_EXTENT, 64 until 0.1.34). */
const OLDER_BOUND = 64

const exposed = (v: ShardVertex): boolean => v.t === undefined && v.p.some((c) => Math.abs(c) > OLDER_BOUND)

/** `m` as it is stored: unchanged unless a whole-unit vertex lies past 64 units, which then carries `t: [0, 0, 0]`. */
export function forOlderReaders(m: ShardModel): ShardModel {
  if (!Array.isArray(m?.vertices) || !m.vertices.some(exposed)) return m
  return { ...m, vertices: m.vertices.map((v) => (exposed(v) ? { ...v, t: [0, 0, 0] } : v)) }
}
