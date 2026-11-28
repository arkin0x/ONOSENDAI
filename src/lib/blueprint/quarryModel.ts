/**
 * quarryModel.ts - the Quarry Charge's look: the Tri-Pack (owner,
 * 2026-11-28), three charges strapped round a detonator mast, banded in
 * hazard orange and wired to the mast's lamp with lines of light, a ring of
 * light turning on the hub. Two models, the same metal in both:
 *
 * - at rest (quarryTriPack.sno.json): the toy a compile leaves, the
 *   pictures on its blueprint and its prize card, the charge in hand;
 * - armed (quarryTriPackArmed.sno.json): the charge burning in the world,
 *   its light hotter and more of it, the hub ring turning faster
 *   (scene/QuarryFx.tsx speeds it up again as the fuse runs out).
 *
 * Original models made for the app, bundled as built-in objects like the
 * Compiler (compilerModel.ts), never one of the owner's private kits. Their
 * parts travel inside them (DECK-0003 §1.10), keyed under the zero pubkey,
 * so they draw with no fetch; each is read only when first drawn.
 */

import { useEffect, useState } from 'react'
import type { ShardModel } from 'sno-core/shards'
import { fromPayload } from 'sno-core/shards'
import { keepOwnTable } from '../carried'

/** The key its carried parts are filed under. */
export const QUARRY_AUTHOR = '0'.repeat(64)

/** Which look the game's blueprint was drawn with: a card drawn with an older look is drawn again (gameBlueprint.ts). */
export const QUARRY_LOOK = 'tri-pack'

/** Where the detonator lamp stands in the model's own units: the top of the mast, on its axis. */
export const QUARRY_LAMP: readonly [number, number, number] = [0, 3.5, 0]
/** The model's box in its own units (both looks): the feet at y -3, the lamp at the top. */
export const QUARRY_BOX = { min: [-2.08, -3, -2.32], max: [2.08, 3.6, 1.61] } as const

const cache: { rest?: Promise<ShardModel | null>; armed?: Promise<ShardModel | null> } = {}
const ready: { rest: ShardModel | null; armed: ShardModel | null } = { rest: null, armed: null }

function load(which: 'rest' | 'armed'): Promise<ShardModel | null> {
  const p = cache[which] ??= (which === 'rest' ? import('./quarryTriPack.sno.json') : import('./quarryTriPackArmed.sno.json')).then((m) => {
    const s = fromPayload((m as { default: unknown }).default, which === 'rest' ? 'quarry-tri-pack' : 'quarry-tri-pack-armed')
    const kept = s ? keepOwnTable(s, QUARRY_AUTHOR) : null
    ready[which] = kept
    return kept
  }).catch(() => null)
  return p
}

/** The Quarry Charge at rest, read once. */
export const quarryModel = (): Promise<ShardModel | null> => load('rest')
/** The Quarry Charge armed, read once. */
export const quarryArmedModel = (): Promise<ShardModel | null> => load('armed')
/** A look already read, or null (it starts the read). */
export function quarryModelNow(which: 'rest' | 'armed' = 'rest'): ShardModel | null {
  if (!ready[which]) void load(which)
  return ready[which]
}

/** A look for a component: null until it is read, then the model; nothing is read while `on` is false. */
export function useQuarryModel(on = true, which: 'rest' | 'armed' = 'rest'): ShardModel | null {
  const [m, setM] = useState<ShardModel | null>(() => (on ? ready[which] : null))
  useEffect(() => {
    if (!on) return
    let live = true
    void load(which).then((x) => { if (live) setM(x) })
    return () => { live = false }
  }, [on, which])
  return on ? m : null
}
