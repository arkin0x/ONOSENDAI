/**
 * HiddenAudio.tsx: hidden audio sounding where it is hidden (DECK-0007 §4,
 * §5; arkinox's rulings of 2026-10-23, step 2).
 *
 * Draws nothing. Every frame three's listener is moved to the camera (the
 * camera is the ears, D3) and each sounding source is placed at its item in
 * the scene, so the panner turns it as the view turns. Ten times a second
 * the world is planned (lib/audioWorld planWorld): every found item with
 * AUTOPLAY on the plane in view is heard at the camera, in its own region's
 * gibsons whatever the zoom; loops start when heard and let go after a
 * while silent; one-shots start on their trigger and play to their end. A
 * file is fetched only when its item is first heard (lib/audioFile caches
 * it), so nothing is fetched for a source the camera never reaches.
 *
 * Mounted with the rest of today's scene, so TV, which draws the tape
 * instead, stops every source (they are no longer in the plan), and muted
 * or blocked items are never in the world to begin with (useShards
 * worldItems); one muted while it plays stops at once (useHiddenAudio
 * stopMutedVoices), and is not started again. TV's own music is stepped down while any of it is heard
 * (useTvMusic duckMusic).
 */

import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { itemCentre, type ViewAxes } from '../lib/space'
import { sourceLocal } from '../lib/audioItem'
import { markFired, triggerFired } from '../lib/audioTrigger'
import { freshMemory, hearSource, listenerLocal, planWorld, shouldDuck, type WorldSource } from '../lib/audioWorld'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { muteSubject, useShards, type WorldItem } from '../store/useShards'
import { useMutes } from '../store/useMutes'
import { audioListener, moveListener, placeWorld, setWorldDuck, setWorldGain, startWorld, stopWorld, worldFailed, worldPending, worldVoices } from '../store/useHiddenAudio'

/** How often the world is planned, ms: often enough that a step into a sphere sounds at once. */
const PLAN_MS = 100

export function HiddenAudio({ axes }: { axes: ViewAxes }): null {
  const memory = useRef(freshMemory())
  const last = useRef(0)
  const placed = useRef(new Map<string, [number, number, number]>())
  // The world's audio items, rebuilt only when what they are read from changes (finds, your own, curation, the mute list).
  const cache = useRef<{ from: unknown[]; items: WorldItem[] }>({ from: [], items: [] })

  // Leaving the scene (TV on, the app closing) stops every world voice, and the music steps back up.
  useEffect(() => () => {
    for (const key of worldVoices()) stopWorld(key)
    setWorldDuck(false)
  }, [])

  useFrame(({ camera }) => {
    if (audioListener() === null) return
    moveListener(camera)
    for (const [key, at] of placed.current) placeWorld(key, at)
    const now = performance.now()
    if (now - last.current < PLAN_MS) return
    last.current = now

    const cs = useCyberspace.getState()
    const origin = alignedOrigin(cs.anchor, cs.scaleExp)
    const cam: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z]
    const sources: WorldSource[] = []
    const items = new Map<string, WorldItem>()
    placed.current.clear()
    const sh = useShards.getState()
    const from = [sh.mine, sh.discovered, sh.curated, useMutes.getState().muted, cs.identity.pubkey]
    if (from.some((v, i) => v !== cache.current.from[i])) cache.current = { from, items: sh.worldItems().filter((w) => w.type === 'audio') }
    for (const w of cache.current.items) {
      // One that failed waits out its pause (useHiddenAudio worldFailed), so a dead URL is not fetched every tick.
      if (w.type !== 'audio' || !w.audio?.autoplay || w.plane !== cs.anchorPlane || worldFailed(w.key, now)) continue
      const scene = itemCentre(w.at, origin, cs.scaleExp, axes)
      const listener = listenerLocal(cam, scene, sourceLocal(w.at, w.height), axes, cs.scaleExp)
      sources.push({ key: w.key, lineage: w.lineage ?? w.key, audio: w.audio, heard: hearSource(w.audio, w.at, w.height, listener, cs.walking) })
      items.set(w.key, w)
      placed.current.set(w.key, scene)
    }
    const plan = planWorld(sources, worldVoices(), triggerFired, now, memory.current, worldPending())
    for (const key of plan.stop) stopWorld(key)
    for (const s of plan.start) {
      const w = items.get(s.key)
      if (!w?.audio) continue
      // A once-trigger is marked as it really sounds (startWorld onStarted), not before.
      const onStarted = s.oneShot && w.audio.retrigger === 'once' ? () => markFired(s.lineage) : undefined
      void startWorld(s.key, w.audio, onStarted, muteSubject(w))
    }
    for (const [key, g] of plan.gains) setWorldGain(key, g)
    setWorldDuck(shouldDuck(plan.gains.values(), false))
  })

  return null
}
