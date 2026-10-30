/**
 * ChestLooks.tsx: every chest and door in the world, as the look it wears
 * (lib/looks.ts; chest and door design, D2, R14).
 *
 * A chest is the treasure chest, a door the door slab, each closed until
 * this identity opens it with OPEN and open from then on (R14), a reload
 * included (store/useOpenedChests restores it silently). Drawn at the zooms
 * a key's cube is (lib/worldMarks.ts markShown), labelled with its name and
 * who left it as a key is, and a tap opens its card, where OPEN is.
 */

import { useEffect, useMemo } from 'react'
import { ACCENT } from '../lib/palette'
import { GRID_RADIUS, itemCentre, type ViewAxes } from '../lib/space'
import { drawnLook, lookOf, type Look } from '../lib/looks'
import { markShown } from '../lib/worldMarks'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { openedKey, useOpenedChests } from '../store/useOpenedChests'
import { useShards } from '../store/useShards'
import { useMutes } from '../store/useMutes'
import { setDrawnLooks, useOpenCeremony } from '../store/useOpenCeremony'
import { ChestCeremony } from './ChestCeremony'
import { ChestLoot, HOVER_Y, LOOT_SIDE } from './ChestLoot'
import { ShardMesh } from './ShardMesh'
import { chestLoot, type LootObject } from '../lib/lootObjects'
import { holdsEntry } from '../lib/inventory'
import { hidesThing } from '../lib/muteList'
import { useInventory } from '../store/useInventory'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { LookMark } from './LookMark'
import { NOTE, NOTE_EDGE_PX, author, itemMarkText } from './WorldMessages'

const REACH = GRID_RADIUS * 8
/** The top of the loot hovering over an opened chest, which its label stands above. */
const LOOT_TOP = HOVER_Y + LOOT_SIDE

/** One chest or door as the scene draws it. */
export interface PlacedLook {
  key: string
  look: Look
  opened: boolean
  /** What floats over it once opened: what is inside and not yet held. */
  loot: LootObject[]
  text: string
  sub: string
  centre: [number, number, number]
}

export function ChestLooks({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const me = useCyberspace((s) => s.identity.pubkey)
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  const curated = useShards((s) => s.curated)
  const muted = useMutes((s) => s.muted)
  const opened = useOpenedChests((s) => s.opened)
  const playing = useOpenCeremony((s) => s.playing)
  const items = useInventory((s) => s.items)
  // Whose ITEMS these are, and whether they are read: until then no loot, or
  // what you hold would float out for a moment after an identity switch.
  const itemsReady = useInventory((s) => s.owner === me && s.storage !== 'loading')
  const still = useReducedMotion()

  const placed = useMemo<PlacedLook[]>(() => {
    if (!markShown('note', scaleExp)) return []
    const origin = alignedOrigin(anchor, scaleExp)
    const out: PlacedLook[] = []
    for (const w of useShards.getState().drawnItems()) {
      if (w.type !== 'chest' || !w.chest || w.plane !== anchorPlane) continue
      const look = lookOf(w)
      if (!look) continue
      const centre = itemCentre(w.at, origin, scaleExp, axes)
      if (Math.hypot(...centre) > REACH) continue
      const inside = opened[openedKey(me, w.key)]
      // What the mute list hides is not drawn coming out, as it is not listed (ItemRows ChestBlock).
      const shown = inside?.filter((e) => !hidesThing(muted, { authors: [w.author ?? '', e.event.pubkey], ids: [e.id] }, me))
      const loot = chestLoot({ look: look.name, entries: shown, held: (e) => holdsEntry(items, e), chest: { at: w.at, plane: w.plane, height: w.height }, itemsReady })
      out.push({ key: w.key, look, opened: !!inside, loot, text: itemMarkText(w), sub: author({ author: w.author ?? '', mine: w.mine }), centre })
    }
    return out
    // mine, discovered, curated and muted are what worldItems reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, me, mine, discovered, curated, muted, opened, items, itemsReady])

  // OPEN asks whether a chest is drawn, to know whether its ceremony can be seen (store/useOpenCeremony).
  useEffect(() => { setDrawnLooks(placed.map((w) => w.key)) }, [placed])
  useEffect(() => () => setDrawnLooks([]), [])

  if (placed.length === 0) return null
  return (
    <>
      {placed.map((w) => {
        const ceremony = w.opened ? playing[openedKey(me, w.key)] : undefined
        const model = drawnLook(w.look, w.opened)
        const loot = w.loot.length > 0
        return (
          <LookMark
            key={w.key}
            look={w.look}
            model={model}
            at={w.centre}
            axes={axes}
            minPx={NOTE_EDGE_PX}
            label={{ text: w.text, color: NOTE, sub: w.sub, subColor: ACCENT }}
            onTap={() => useShards.getState().selectSecret(w.key)}
            clearTop={loot ? LOOT_TOP : 0}
          >
            {ceremony || loot
              ? () => (
                <>
                  {ceremony ? <ChestCeremony look={w.look} at={ceremony.at} calm={ceremony.calm} /> : model && <ShardMesh shard={model} world />}
                  {loot && <ChestLoot loot={w.loot} ceremony={ceremony} still={still} />}
                </>
              )
              : undefined}
          </LookMark>
        )
      })}
    </>
  )
}
