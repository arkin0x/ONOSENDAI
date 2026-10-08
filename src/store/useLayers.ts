/**
 * useLayers.ts - which optional scene layers are drawn, per device.
 *
 * Two layers can be turned off from the bottom of the Movement Proof panel:
 * the gibson dot grid (the terrain K field, scene/ShaderPointField.tsx) and
 * the hX concentric boxes (the nested aligned-subtree cells around the
 * anchor, scene/Rooms.tsx). Both default on, which is the look the scene has
 * always had. This is a view preference only: nothing about the proof, the
 * movement, the cursor or the chain reads it.
 *
 * Kept in localStorage so the choice survives a reload on this device. Every
 * read and write is guarded: with storage blocked (private mode, an odd
 * embedding, tests under node) both layers read on and a toggle still works
 * for the visit.
 */

import { create } from 'zustand'

export type SceneLayer = 'dots' | 'boxes'

export type SceneLayers = Record<SceneLayer, boolean>

export const LAYERS_KEY = 'onosendai:layers'

export const DEFAULT_LAYERS: SceneLayers = { dots: true, boxes: true }

/** The stored choice, or both on when there is none or it cannot be read. */
export function loadLayers(): SceneLayers {
  try {
    const raw = localStorage.getItem(LAYERS_KEY)
    if (!raw) return { ...DEFAULT_LAYERS }
    const p = JSON.parse(raw) as Partial<Record<SceneLayer, unknown>> | null
    return {
      // Only an explicit false turns a layer off; anything else is the default.
      dots: p?.dots !== false,
      boxes: p?.boxes !== false,
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
    const next = { dots: get().dots, boxes: get().boxes, [layer]: on }
    set({ [layer]: on })
    saveLayers(next)
  }
  return {
    ...loadLayers(),
    setLayer: put,
    toggleLayer: (layer) => put(layer, !get()[layer]),
  }
})
