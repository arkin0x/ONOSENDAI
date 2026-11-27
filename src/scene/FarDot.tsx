/**
 * FarDot.tsx: the dot a chest, a door or an item's model is drawn as once,
 * at its true size, it is too small on screen to be anything (lib/markerSize
 * FAR_DOT_PX; arkinox, 2026-11-26: "doors and chests are not scaling with the
 * view zoom? getting way too big").
 *
 * The thing itself is drawn at its true size at every distance, never larger;
 * this stands in its place, FAR_DOT_PX across, only while the thing would be
 * smaller than that, so it is never larger on screen than the thing was the
 * moment before it took over. It is the terrain's disc (scene/pointDisc.ts),
 * round and lit by the headlamp and the fog as the faces around it are, and
 * it writes no depth: a block in front of it still hides it.
 *
 * The caller decides each frame which shows (lib/markerSize farDotShown) and
 * sets this object's `visible`; it starts hidden.
 */

import { useEffect, useMemo, type RefObject } from 'react'
import { BufferAttribute, BufferGeometry, Color, Vector2, type Points, type WebGLRenderer } from 'three'
import { FAR_DOT_PX } from '../lib/markerSize'
import { createDiscMaterial, sizeDisc, withDiscColors, type DiscProfile } from './pointDisc'
import { GHOST_OPACITY } from './shardFaces'

/** The canvas's CSS size, read into one vector for every dot. */
const canvasSize = new Vector2()

/** A disc FAR_DOT_PX across at any distance: no world size, floor and ceiling the same. */
export const FAR_DOT: DiscProfile = { size: 0, minPx: FAR_DOT_PX, maxPx: FAR_DOT_PX, glow: 0.6 }

export function FarDot({ dotRef, color, opacity = 1 }: { dotRef: RefObject<Points>; color: string; opacity?: number }): JSX.Element {
  const geometry = useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3))
    const c = new Color(color)
    return withDiscColors(g, new BufferAttribute(new Float32Array([c.r, c.g, c.b]), 3))
  }, [color])
  const material = useMemo(() => {
    const m = createDiscMaterial(FAR_DOT, opacity, true)
    // A fade (WorldShards breatheMaterial: a TAKE's vanish, a ceremony's) reads a disc's opacity as a ghost's share; this
    // makes its b times the dot's own opacity, so the dot fades with the thing it stands for from the first step.
    m.userData.baseOpacity = opacity * GHOST_OPACITY
    return m
  }, [opacity])
  // Sized to the canvas only when it is drawn: a hidden dot costs nothing a frame.
  const fit = useMemo(() => (renderer: WebGLRenderer) => { sizeDisc(material, renderer.getPixelRatio(), renderer.getSize(canvasSize).y) }, [material])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return <points ref={dotRef} geometry={geometry} material={material} visible={false} frustumCulled={false} name="far-dot" onBeforeRender={fit} />
}
