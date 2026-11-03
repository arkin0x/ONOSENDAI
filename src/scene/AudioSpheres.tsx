/**
 * AudioSpheres.tsx: each hidden sound's full-volume sphere, in the world
 * (arkinox, 2026-11-01: a VIEW switch for the audio fade spheres, on by
 * default). Inside the sphere the sound plays at full volume; past it, it
 * fades to silence at its region's walls (DECK-0007 §4.1, `fade`). The same
 * blue rings as on audio being placed (AudioSphereGhost), quieter, around
 * every sound drawn in the scene: the ones you found and the ones you hid,
 * on the plane in view. The radius is the one the ears use
 * (lib/audioWorld hearSource: lib/audioItem fadeRadius), in scene units at
 * the zoom on screen.
 *
 * The Settings panel's "Sound spheres" switch turns them off (store/useLayers
 * audioSpheres). The rings on audio being placed stay either way: they are
 * what the FADE stepper sets.
 */

import { useMemo } from 'react'
import { fadeRadius, sourceLocal } from '../lib/audioItem'
import { GRID_RADIUS, itemCentre, type Position, type ViewAxes } from '../lib/space'
import { markShown } from '../lib/worldMarks'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { useMutes } from '../store/useMutes'
import { useShards, type WorldItem } from '../store/useShards'
import { FadeRings } from './AudioSphereGhost'

/** As far out as the notes are drawn (WorldMessages REACH): a sphere with no note in it would be a ring around nothing. */
const REACH = GRID_RADIUS * 8

/** The world's rings are dimmer than the ghost's, which is the one being worked on. */
const WORLD_OPACITY = 0.6

export interface AudioSphere {
  key: string
  /** The sound's cell centre in the scene. */
  centre: [number, number, number]
  /** The full-volume radius in scene units (gibsons / 2^scaleExp). */
  radius: number
}

/**
 * The spheres to draw: every sound among `items` on `plane`, where the notes
 * are drawn at this zoom (markShown), within reach, with a radius above zero.
 */
export function audioSpheres(items: readonly WorldItem[], plane: number, origin: Position, scaleExp: number, axes: ViewAxes): AudioSphere[] {
  if (!markShown('note', scaleExp)) return []
  const unit = 2 ** scaleExp
  const out: AudioSphere[] = []
  for (const w of items) {
    if (w.type !== 'audio' || !w.audio || w.plane !== plane) continue
    const centre = itemCentre(w.at, origin, scaleExp, axes)
    if (Math.hypot(...centre) > REACH) continue
    const radius = fadeRadius(w.audio.fade, sourceLocal(w.at, w.height), w.height) / unit
    if (radius > 0) out.push({ key: w.key, centre, radius })
  }
  return out
}

export function AudioSpheres({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const on = useLayers((s) => s.audioSpheres)
  const anchor = useCyberspace((s) => s.anchor)
  const plane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  const curated = useShards((s) => s.curated)
  const muted = useMutes((s) => s.muted)
  const spheres = useMemo(
    () => (on ? audioSpheres(useShards.getState().drawnItems(), plane, alignedOrigin(anchor, scaleExp), scaleExp, axes) : []),
    // mine, discovered, curated and muted are what drawnItems reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [on, anchor, plane, scaleExp, axes, mine, discovered, curated, muted],
  )
  if (spheres.length === 0) return null
  return (
    <>
      {spheres.map((s) => (
        <group key={s.key} position={s.centre} scale={s.radius}>
          <FadeRings opacity={WORLD_OPACITY} />
        </group>
      ))}
    </>
  )
}
