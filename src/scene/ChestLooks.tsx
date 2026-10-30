/**
 * ChestLooks.tsx: every chest and door in the world, as the look it wears
 * (lib/looks.ts; chest and door design, D2, R14).
 *
 * A chest is the treasure chest, a door the door slab, each closed until
 * this identity opens it with OPEN and open from then on (R14), a reload
 * included: opened by hand on this device is open, whether a key or a
 * signer opened it (store/useOpenedChests), as WALK's walls have it. Drawn at the zooms
 * a key's cube is (lib/worldMarks.ts markShown), labelled with its name and
 * who left it as a key is, and a tap opens its card, where OPEN is.
 */

import { useEffect, useMemo } from 'react'
import { ACCENT } from '../lib/palette'
import { GRID_RADIUS, itemCentre, type ViewAxes } from '../lib/space'
import { drawnLook, lookOf, type Look } from '../lib/looks'
import { markShown } from '../lib/worldMarks'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { openedByHand, openedKey, useOpenedChests } from '../store/useOpenedChests'
import { useShards } from '../store/useShards'
import { useMutes } from '../store/useMutes'
import { setDrawnLooks, useOpenCeremony } from '../store/useOpenCeremony'
import { ChestCeremony } from './ChestCeremony'
import { LookMark } from './LookMark'
import { NOTE, NOTE_EDGE_PX, author, itemMarkText } from './WorldMessages'

const REACH = GRID_RADIUS * 8

/** One chest or door as the scene draws it. */
export interface PlacedLook {
  key: string
  look: Look
  opened: boolean
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
      out.push({ key: w.key, look, opened: !!opened[openedKey(me, w.key)] || openedByHand(me, w.key), text: itemMarkText(w), sub: author({ author: w.author ?? '', mine: w.mine }), centre })
    }
    return out
    // mine, discovered, curated and muted are what worldItems reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, anchorPlane, scaleExp, axes, me, mine, discovered, curated, muted, opened])

  // OPEN asks whether a chest is drawn, to know whether its ceremony can be seen (store/useOpenCeremony).
  useEffect(() => { setDrawnLooks(placed.map((w) => w.key)) }, [placed])
  useEffect(() => () => setDrawnLooks([]), [])

  if (placed.length === 0) return null
  return (
    <>
      {placed.map((w) => {
        const ceremony = playing[openedKey(me, w.key)]
        return (
          <LookMark
            key={w.key}
            look={w.look}
            model={drawnLook(w.look, w.opened)}
            at={w.centre}
            axes={axes}
            minPx={NOTE_EDGE_PX}
            label={{ text: w.text, color: NOTE, sub: w.sub, subColor: ACCENT }}
            onTap={() => useShards.getState().selectSecret(w.key)}
          >
            {ceremony && w.opened ? () => <ChestCeremony look={w.look} at={ceremony.at} calm={ceremony.calm} /> : undefined}
          </LookMark>
        )
      })}
    </>
  )
}
