/**
 * compilerModel.ts - the Compiler's look: the owner's chosen "Compiler
 * (Breaker)", a techy hammer whose two vertical ring glows are orange
 * (owner, 2026-11-26). It is an original model made for the app and
 * approved for it, bundled as a built-in object, not one of the owner's
 * private kits. Its parts travel inside it (DECK-0003 §1.10 carried
 * objects), keyed under the zero pubkey, so it draws with no fetch; it is
 * loaded only when first drawn, to keep the first load small.
 */

import { fromPayload, type ShardModel } from 'sno-core/shards'
import { keepOwnTable } from '../carried'

/** The key its carried parts are filed under. */
export const COMPILER_AUTHOR = '0'.repeat(64)

let model: Promise<ShardModel | null> | null = null

/** The Compiler's model, read once. */
export function compilerModel(): Promise<ShardModel | null> {
  model ??= import('./compilerBreaker.sno.json').then((m) => {
    const s = fromPayload((m as { default: unknown }).default, 'compiler-breaker')
    return s ? keepOwnTable(s, COMPILER_AUTHOR) : null
  }).catch(() => null)
  return model
}
