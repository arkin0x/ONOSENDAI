/**
 * AudioSpheres.tsx: each hidden sound's full-volume sphere, in the world
 * (arkinox, 2026-11-01: a VIEW switch for the audio fade spheres, on by
 * default). Inside the sphere the sound plays at full volume; past it, it
 * fades to silence at its region's walls (DECK-0007 §4.1, `fade`). The same
 * blue rings as on audio being placed (AudioSphereGhost), quieter, around
 * every sound you can hear: the same list HiddenAudio plays from (useShards
 * heardAudio, AUTOPLAY on), so a sound kept in an opened chest, which is
 * heard at the chest but not drawn on its own, has its sphere too (review
 * of #584). The ones you found and the ones you hid, on the plane in view,
 * at the zooms the notes are drawn at. The radius is the one the ears use
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

/** As far out as the notes are drawn (WorldMessages REACH). */
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

/**
 * The spheres the world draws now: none with the Sound spheres switch off;
 * otherwise one for every sound HiddenAudio would play (heardAudio, with
 * AUTOPLAY on, as it filters them), chest-held audio included.
 */
export function worldSpheres(on: boolean, anchor: Position, plane: number, scaleExp: number, axes: ViewAxes): AudioSphere[] {
  if (!on) return []
  const heard = useShards.getState().heardAudio().filter((w) => w.audio?.autoplay)
  return audioSpheres(heard, plane, alignedOrigin(anchor, scaleExp), scaleExp, axes)
}

export function AudioSpheres({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const on = useLayers((s) => s.audioSpheres)
  const anchor = useCyberspace((s) => s.anchor)
  const plane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const me = useCyberspace((s) => s.identity.pubkey)
  const mine = useShards((s) => s.mine)
  const discovered = useShards((s) => s.discovered)
  const curated = useShards((s) => s.curated)
  const muted = useMutes((s) => s.muted)
  const spheres = useMemo(
    () => worldSpheres(on, anchor, plane, scaleExp, axes),
    // mine, discovered, curated, muted and who you are are what heardAudio
    // reads, as HiddenAudio keys its own list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [on, anchor, plane, scaleExp, axes, mine, discovered, curated, muted, me],
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
