/**
 * useLayers.ts - which optional scene layers are drawn, per device.
 *
 * Two layers can be turned off from the View panel (hud/ViewPanel.tsx): the
 * terrain dots (the terrain K field, scene/ShaderPointField.tsx) and the hX
 * concentric boxes (the nested aligned-subtree cells around the anchor,
 * scene/Rooms.tsx). Both default on, which is the look the scene has
 * always had. A third, walkAvatarHidden, hides your own avatar while WALK
 * puts the camera inside it (arkinox, 2026-10-13); it defaults off, so a
 * walk shows what sticks out of you until you say otherwise. A fourth,
 * walkLookSphere, is the ball in the bottom right that WALK looks around with
 * (hud/WalkLookSphere.tsx; arkinox, 2026-10-23); it defaults on. A fifth,
 * headlamp, shades the world's shards as if lit from the camera
 * (scene/headlamp.ts; arkinox, 2026-10-23); it defaults on, and off draws
 * them unlit, exactly as before. A sixth, spatialAudio, draws each
 * hidden sound in the world: its box with the music note and the blue rings
 * of its full-volume sphere, DECK-0007 `fade` (scene/AudioSpheres.tsx,
 * scene/WorldMessages.tsx). It was audioSpheres, the rings alone, on by
 * default (arkinox, 2026-11-01); since 2026-11-22 it is the Settings row
 * "Spatial Audio", off by default, and hides the boxes too (arkinox: "It
 * should be off by default, hiding the sound blocks and their spheres"). It
 * is drawing only: every sound still plays and fades as before
 * (scene/HiddenAudio.tsx never reads it). A seventh, glow, draws the halos round a POINTS object's points
 * (DECK-0003 §1.16; scene/PointBillboards.tsx) in the world and in games, for
 * slow phones; it defaults on, and the workshop's bench draws them either
 * way. These are view
 * preferences only: nothing about the proof, the movement, the cursor or the
 * chain reads them.
 *
 * One more is kept here as a device setting, though it is not a layer:
 * walkLimits, WALK's sync limit (arkinox, 2026-11-18: "maybe sync loss
 * warning should be a setting"), the Settings row "Pause fluid walk when
 * your chain falls behind" since 2026-11-22. On, the default, fluid WALK
 * switches itself off 21 events ahead of your chain and back on at 15
 * (store/fluidSwitch.ts fluidPauseCheck); the slowdown and the LOSING SYNC
 * warning it also turned on are parked (store/walkLimits.ts
 * SYNC_SLOWDOWN_ON). Off, fluid WALK runs as far ahead as you like. It
 * changes how the walk moves, never a proof, an event or the chain's rules.
 *
 * Kept in localStorage so the choice survives a reload on this device. Every
 * read and write is guarded: with storage blocked (private mode, an odd
 * embedding, tests under node) both layers read on and a toggle still works
 * for the visit.
 */

import { create } from 'zustand'

export type SceneLayer = 'dots' | 'boxes' | 'walkAvatarHidden' | 'walkLookSphere' | 'headlamp' | 'spatialAudio' | 'glow' | 'walkLimits'

export type SceneLayers = Record<SceneLayer, boolean>

export const LAYERS_KEY = 'onosendai:layers'

export const DEFAULT_LAYERS: SceneLayers = { dots: true, boxes: true, walkAvatarHidden: false, walkLookSphere: true, headlamp: true, spatialAudio: false, glow: true, walkLimits: true }

/**
 * Spatial Audio as stored: on only when the Spatial Audio switch itself was
 * turned on (a stored `spatialAudio: true`). The old Sound spheres flag,
 * `audioSpheres`, is not carried over. It was on by default, and every
 * toggle of any switch here saved every flag, so a stored `audioSpheres:
 * true` is what nearly every device that ever touched a switch has; it
 * cannot tell a player who chose the rings from one who never looked, and
 * the only way to have chosen it on was to turn it off and back on. Reading
 * it as a choice would keep the old look for almost everyone, so everyone
 * starts at the new default, off, and the next save drops the old flag.
 */
export function spatialAudioStored(p: Partial<Record<string, unknown>> | null | undefined): boolean {
  return p?.spatialAudio === true
}

/** The stored choice, or the defaults when there is none or it cannot be read. */
export function loadLayers(): SceneLayers {
  try {
    const raw = localStorage.getItem(LAYERS_KEY)
    if (!raw) return { ...DEFAULT_LAYERS }
    const p = JSON.parse(raw) as Partial<Record<SceneLayer, unknown>> | null
    return {
      // Only an explicit false turns a layer off; anything else is the default.
      dots: p?.dots !== false,
      boxes: p?.boxes !== false,
      // Off unless explicitly on.
      walkAvatarHidden: p?.walkAvatarHidden === true,
      // On unless explicitly off, like the layers.
      walkLookSphere: p?.walkLookSphere !== false,
      // On unless explicitly off, as the dots and boxes are.
      headlamp: p?.headlamp !== false,
      // Off unless explicitly on (spatialAudioStored).
      spatialAudio: spatialAudioStored(p),
      // On unless explicitly off.
      glow: p?.glow !== false,
      // WALK's sync limit: on unless explicitly off, as it always was.
      walkLimits: p?.walkLimits !== false,
    }
  } catch {
    return { ...DEFAULT_LAYERS }
  }
}

export function saveLayers(layers: SceneLayers): void {
  try { localStorage.setItem(LAYERS_KEY, JSON.stringify(layers)) } catch { /* storage blocked: kept in memory for this visit */ }
}

interface LayersState extends SceneLayers {
  setLayer: (layer: SceneLayer, on: boolean) => void
  toggleLayer: (layer: SceneLayer) => void
}

export const useLayers = create<LayersState>((set, get) => {
  const put = (layer: SceneLayer, on: boolean): void => {
    const next = { dots: get().dots, boxes: get().boxes, walkAvatarHidden: get().walkAvatarHidden, walkLookSphere: get().walkLookSphere, headlamp: get().headlamp, spatialAudio: get().spatialAudio, glow: get().glow, walkLimits: get().walkLimits, [layer]: on }
    set({ [layer]: on })
    saveLayers(next)
  }
  return {
    ...loadLayers(),
    setLayer: put,
    toggleLayer: (layer) => put(layer, !get()[layer]),
  }
})

// DEV window handle, the house pattern (__store, __shards): the browser captures flip a switch (points glow GLOW_OFF).
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __layers?: unknown }).__layers = useLayers
}
