/**
 * audioWorld.ts: hearing hidden audio where it is hidden (DECK-0007 §4, §5;
 * arkinox's rulings of 2026-10-23), as arithmetic the scene feeds.
 *
 * The CAMERA is the ears (D3): in WALK mode that is the avatar's eyes, and
 * in an orbiting view the camera itself, so zooming out takes the ear away.
 * The scene is drawn in rebased units, one unit to 2^scaleExp gibsons along
 * each view axis (lib/space itemCentre), so the camera's offset from a source
 * in the scene is turned back into gibsons on the cyberspace axes, in the
 * source's region frame (lib/audioItem), and the fade is measured there. So
 * the sphere and the fade stay the same size in gibsons at every zoom.
 *
 * planWorld is one tick of the world's sound: which sources start, which
 * stop, and how loud each one is. Loops sound while they are heard; a
 * one-shot starts on its trigger (lib/audioTrigger) and plays to its end at
 * the loudness of where you are; nothing without autoplay sounds here at all.
 */

import { audioGain, fadeRadius, insideRegion, sourceLocal, type AudioItem, type Local } from './audioItem'
import { hasTrigger, stepTrigger, TRIGGER_START, type TriggerState } from './audioTrigger'
import type { Position, ViewAxes } from './space'

/**
 * Where a scene point is in a source's region frame, in gibsons: the source's
 * own point there, plus the scene offset turned back onto the cyberspace axes
 * (each view axis is one cyberspace axis, possibly flipped) and scaled by
 * 2^scaleExp.
 */
export function listenerLocal(scene: readonly [number, number, number], sourceScene: readonly [number, number, number], source: Local, axes: ViewAxes, scaleExp: number): Local {
  const out: [number, number, number] = [source[0], source[1], source[2]]
  const unit = 2 ** scaleExp
  const index = { x: 0, y: 1, z: 2 } as const
  ;[axes.right, axes.up, axes.out].forEach((a, i) => {
    out[index[a.axis]] += (scene[i] - sourceScene[i]) * a.dir * unit
  })
  return out
}

/** What a listener hears of one source: how loud (§4.2), and whether it stands in the sphere (§5.2). */
export interface Heard {
  gain: number
  inSphere: boolean
}

/** How one source sounds at a listener, its walk-only gate applied: outside first person it is not heard at all (§4.5). */
export function hearSource(a: Pick<AudioItem, 'fade' | 'walkOnly'>, at: Position, height: number, listener: Local, walking: boolean): Heard {
  const source = sourceLocal(at, height)
  const side = 2 ** height
  const r = fadeRadius(a.fade, source, height)
  if (a.walkOnly && !walking) return { gain: 0, inSphere: false }
  const inside = insideRegion(listener, side)
  const d = Math.hypot(listener[0] - source[0], listener[1] - source[1], listener[2] - source[2])
  return { gain: audioGain(source, listener, side, r), inSphere: inside && d <= r }
}

/** One source in the world this tick. */
export interface WorldSource {
  key: string
  /** What its trigger record is kept by: the item's lineage id. */
  lineage: string
  audio: Pick<AudioItem, 'autoplay' | 'loop' | 'retrigger' | 'walkOnly'>
  heard: Heard
}

/** What carries from one tick to the next. */
export interface WorldMemory {
  triggers: Map<string, TriggerState>
  /** When a loop last went silent, ms, while it still plays. */
  quietSince: Map<string, number>
}

export function freshMemory(): WorldMemory {
  return { triggers: new Map(), quietSince: new Map() }
}

/** How long a loop may be silent before its voice is let go, ms: walking along a wall does not restart it. */
export const QUIET_MS = 2000

export interface WorldPlan {
  /** Start these now; a one-shot marked `fired` is the once-trigger that just fired. */
  start: Array<{ key: string; oneShot: boolean; lineage: string }>
  stop: string[]
  /** How loud every source that plays, or starts, should be. */
  gains: Map<string, number>
}

/**
 * One tick. `playing` is every source with a voice (starting, waiting for a
 * tap, or sounding); `fired` reads this device's once-trigger record.
 * Sources not in `sources` any more (gone from the world, muted, another
 * plane, TV turned on) stop.
 */
export function planWorld(sources: readonly WorldSource[], playing: ReadonlySet<string>, fired: (lineage: string) => boolean, now: number, memory: WorldMemory): WorldPlan {
  const plan: WorldPlan = { start: [], stop: [], gains: new Map() }
  const present = new Set<string>()
  for (const s of sources) {
    if (!s.audio.autoplay) continue
    present.add(s.key)
    const g = s.heard.gain
    if (s.audio.loop) {
      if (g > 0) memory.quietSince.delete(s.key)
      if (playing.has(s.key)) {
        if (g > 0) plan.gains.set(s.key, g)
        else {
          const since = memory.quietSince.get(s.key) ?? now
          memory.quietSince.set(s.key, since)
          if (now - since >= QUIET_MS) { plan.stop.push(s.key); memory.quietSince.delete(s.key) } else plan.gains.set(s.key, 0)
        }
      } else if (g > 0) {
        plan.start.push({ key: s.key, oneShot: false, lineage: s.lineage })
        plan.gains.set(s.key, g)
      }
      continue
    }
    if (!hasTrigger(s.audio)) continue
    const step = stepTrigger(s.audio, memory.triggers.get(s.key) ?? TRIGGER_START, { inSphere: s.heard.inSphere, walking: true, fired: fired(s.lineage) })
    memory.triggers.set(s.key, step.state)
    if (playing.has(s.key)) plan.gains.set(s.key, g)
    else if (step.fire) {
      plan.start.push({ key: s.key, oneShot: true, lineage: s.lineage })
      plan.gains.set(s.key, g)
    }
  }
  for (const key of playing) if (!present.has(key)) plan.stop.push(key)
  for (const key of [...memory.triggers.keys()]) if (!present.has(key)) memory.triggers.delete(key)
  for (const key of [...memory.quietSince.keys()]) if (!present.has(key)) memory.quietSince.delete(key)
  return plan
}

/**
 * How far Cyberspace TV's music steps down while hidden audio is heard
 * (arkinox, 2026-10-23: TV ducking): to this share of its own volume, so the
 * found sound is not drowned and the music does not stop.
 */
export const DUCKED = 0.3

/** Whether TV's music should step down: some hidden audio sounds louder than a whisper. */
export function shouldDuck(gains: Iterable<number>, cardPlaying: boolean): boolean {
  if (cardPlaying) return true
  for (const g of gains) if (g > 0.05) return true
  return false
}
