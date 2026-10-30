/**
 * ChestLoot.tsx: what floats out of an opened chest and hovers over it
 * (lib/lootObjects.ts says which; arkinox, 2026-10-30: "3D objects float out
 * of the chest corresponding to the contents").
 *
 * Drawn in the chest's own frame (LookMark), so the loot is the chest's size
 * and turn at any zoom. Each object is scaled to fit inside the chest
 * (LOOT_SIDE, its longest side), rises out of the mouth one after another
 * as the lid comes up, and hovers in a row above the chest, bobbing and
 * turning slowly. A reload shows it hovering, with no rise. On the calm path
 * (reduced motion) nothing rises, bobs or turns: the loot fades in where it
 * hovers and holds still.
 *
 * What each is: the scroll for messages, the generic item or the item's own
 * model (fetched as an item's model is, the generic item while it loads),
 * the object itself, a small treasure chest for a chest. What is held is
 * not here at all (lootOf), so TAKE in the card takes it off the chest. A
 * tap on any of it is a tap on the chest (LookMark's target measures the
 * whole frame), which opens the card where TAKE is.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { ShardModel } from 'sno-core/shards'
import { CALM_FADE_MS, riseShare } from '../lib/ceremony'
import { builtInLook } from '../lib/looks'
import { lootModels } from '../lib/lootModels'
import type { LootObject } from '../lib/lootObjects'
import { measureModel, useItemModel } from '../hooks/useItemModel'
import type { ModelExtent } from '../lib/itemModel'
import { lookBounds } from './LookMark'
import { MOUTH_Y } from './ChestCeremony'
import { ShardMesh } from './ShardMesh'
import { breatheMaterial } from './WorldShards'

/** The longest side of a loot object, in the chest's units: about the chest's mouth, so it reads at a glance and could have fitted inside. */
export const LOOT_SIDE = 0.46
/** How high the row hovers: its middle, above the chest's base, clear of the open lid's top (1.4). */
export const HOVER_Y = 1.72
/** How far forward of the chest's middle (toward its lock plate, +Z) the row hovers, clear of the lid leaning back. */
export const HOVER_Z = 0.22
/** How far apart along the row. */
export const LOOT_GAP = 0.58
/** The bob's reach, and its period; the slow turn. */
const BOB = 0.035
const BOB_S = 2.6
const TURN_RAD_S = 0.55
/** How far a scroll sways each way, radians: never end on. */
const SCROLL_SWAY = 0.5

/** Where object `i` of `n` hovers, in the chest's units: a row across X, a gentle arc toward the viewer. */
export function hoverAt(i: number, n: number): [number, number, number] {
  const x = (i - (n - 1) / 2) * LOOT_GAP
  return [x, HOVER_Y - Math.abs(x) * 0.12, HOVER_Z]
}

interface Props {
  loot: LootObject[]
  /** The ceremony, when one plays: when it began and whether on the calm path. Absent: hovering already. */
  ceremony?: { at: number; calm: boolean }
  /** The viewer asked for less motion: hovering loot holds still. */
  still: boolean
}

export function ChestLoot({ loot, ceremony, still }: Props): JSX.Element {
  return (
    <>
      {loot.map((o, i) => <Loot key={o.key} o={o} i={i} n={loot.length} ceremony={ceremony} still={still} />)}
    </>
  )
}

/** The model a loot object is drawn as, and its reach when already known: its own, the item's while it loads or if it never does, the scroll, a small chest. */
function useLootModel(o: LootObject): { model: ShardModel; extent: ModelExtent | null } {
  const fetched = useItemModel(o.kind === 'item' ? o.model : null)
  if (o.kind === 'shard' && o.shard) return { model: o.shard, extent: null }
  if (o.kind === 'item') return fetched ? { model: fetched.shard, extent: fetched.extent } : { model: lootModels().item, extent: null }
  if (o.kind === 'chest') return { model: builtInLook('treasure').closed, extent: null }
  return { model: lootModels().scroll, extent: null }
}

/** A reach from a model's own points, about its centre. */
function ownExtent(model: ShardModel): ModelExtent | null {
  const b = lookBounds(model)
  if (!(b.longest > 0)) return null
  return {
    centre: [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2) as [number, number, number],
    half: [0, 1, 2].map((k) => (b.max[k] - b.min[k]) / 2) as [number, number, number],
    aroundY: 0, aroundX: 0, radius: 0,
  }
}

/**
 * How a loot object is fitted: scaled so its longest side is LOOT_SIDE, its
 * middle on the point it hovers at. Measured with the objects it places, as
 * an item's model is (hooks/useItemModel measureModel), so a one-part wrapper
 * (an object placed from the feed) is fitted by its part, not drawn at its
 * true size for want of points of its own (review of #534). Null while that
 * is measured, and then it is not drawn.
 */
export function lootFit(e: ModelExtent | null): { k: number; centre: [number, number, number] } | null {
  if (!e) return null
  const longest = 2 * Math.max(e.half[0], e.half[1], e.half[2])
  if (!(longest > 0)) return null
  return { k: LOOT_SIDE / longest, centre: [-e.centre[0], -e.centre[1], -e.centre[2]] }
}

function useFit(model: ShardModel, known: ModelExtent | null): { k: number; centre: [number, number, number] } | null {
  const placesOthers = (model.parts?.length ?? 0) > 0
  const own = useMemo(() => (known || placesOthers ? null : ownExtent(model)), [model, known, placesOthers])
  const [measured, setMeasured] = useState<{ model: ShardModel; extent: ModelExtent | null } | null>(null)
  useEffect(() => {
    if (known || !placesOthers) return
    let live = true
    void measureModel(model).then((extent) => { if (live) setMeasured({ model, extent }) })
    return () => { live = false }
  }, [model, known, placesOthers])
  return useMemo(() => lootFit(known ?? own ?? (measured?.model === model ? measured.extent : null)), [known, own, measured, model])
}

function Loot({ o, i, n, ceremony, still }: { o: LootObject; i: number; n: number; ceremony?: Props['ceremony']; still: boolean }): JSX.Element | null {
  const { model, extent } = useLootModel(o)
  const fit = useFit(model, extent)
  const home = useMemo(() => hoverAt(i, n), [i, n])
  const g = useRef<Group>(null)
  const spin = useRef<Group>(null)
  const phase = useMemo(() => (i * 0.618) % 1, [i])
  const calm = !!ceremony?.calm
  const fading = useRef<Group>(null)
  useFrame((state) => {
    const group = g.current
    if (!group) return
    const now = performance.now()
    const t = state.clock.elapsedTime
    const resting = still || calm
    const bob = resting ? 0 : BOB * Math.sin(((t / BOB_S) + phase) * Math.PI * 2)
    if (ceremony && !calm) {
      // Out of the mouth, growing from half size as it clears the rim.
      const r = riseShare(i, now - ceremony.at)
      group.position.set(home[0] * r, MOUTH_Y - 0.15 + (home[1] - MOUTH_Y + 0.15) * r + bob * r, home[2] * r)
      group.scale.setScalar(Math.max(1e-4, r < 0.02 ? 0 : 0.5 + 0.5 * r))
      group.visible = r > 0
    } else {
      group.position.set(home[0], home[1] + bob, home[2])
      group.scale.setScalar(1)
      group.visible = true
    }
    // A scroll sways and keeps its length to the viewer: turned whole, it was a dot end on.
    if (spin.current) spin.current.rotation.y = resting ? 0 : o.kind === 'scroll' ? SCROLL_SWAY * Math.sin(t * TURN_RAD_S + phase * Math.PI * 2) : t * TURN_RAD_S + phase * Math.PI * 2
    if (ceremony && calm && fading.current) {
      const share = Math.min(1, Math.max(0, (now - ceremony.at) / CALM_FADE_MS))
      fading.current.traverse((obj) => {
        const m = (obj as { material?: import('three').Material | import('three').Material[] }).material
        if (!m) return
        for (const one of Array.isArray(m) ? m : [m]) breatheMaterial(one, share)
      })
    }
  })
  if (!fit) return null
  return (
    <group ref={g} position={home}>
      <group ref={spin}>
        <group ref={fading} scale={fit.k}>
          <group position={fit.centre}>
            {/* A ghost only while it fades in on the calm path: its opacity is real then. */}
            <ShardMesh shard={model} world ghost={calm && !!ceremony} />
          </group>
        </group>
      </group>
    </group>
  )
}
