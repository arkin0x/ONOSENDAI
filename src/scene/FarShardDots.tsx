/**
 * FarShardDots.tsx: the world shards too small on screen to draw, one dot
 * each, in one points draw (scene/farCull.ts). Also the one place the size
 * cull runs, once a frame, for every world shard.
 *
 * Mounted beside WorldShards and WorldSeeds in the scene's root group, so a
 * shard's positioned group and its dot share a frame: the dot is drawn at the
 * group's position. The dots' colours and count are written again only when
 * the set of hidden shards changes; their places are checked each frame (a
 * landing moves every shard) and sent to the GPU only when one moved. The
 * buffers grow by doubling and are never made smaller; nothing else is
 * allocated in a frame.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Vector2, type PerspectiveCamera, type Points, type WebGLRenderer } from 'three'
import { projScaleOf } from '../lib/markerSize'
import { FOV } from './camera'
import { createDiscMaterial, sizeDisc, withDiscColors, type DiscProfile } from './pointDisc'
import { DOTS_ORDER } from './shardFaces'
import { HIDE_BELOW_PX, farCull, type FarCull } from './farCull'

/** A dot as wide as the shard was when it was hidden (twice HIDE_BELOW_PX), at any distance. */
export const FAR_SHARD_DOT: DiscProfile = { size: 0, minPx: 2 * HIDE_BELOW_PX, maxPx: 2 * HIDE_BELOW_PX, glow: 0.6 }

/** The first number of dots the buffers hold. */
const FIRST_CAPACITY = 64

/** The canvas's CSS size, read into one vector. */
const canvasSize = new Vector2()

/** The dots' buffers: a geometry and the arrays under it, with room for `capacity` dots. */
export interface DotBuffers {
  geometry: BufferGeometry
  positions: Float32Array
  colors: Float32Array
  capacity: number
}

export function dotBuffers(capacity: number): DotBuffers {
  const positions = new Float32Array(capacity * 3)
  const colors = new Float32Array(capacity * 3)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage))
  withDiscColors(geometry, new BufferAttribute(colors, 3).setUsage(DynamicDrawUsage))
  geometry.setDrawRange(0, 0)
  return { geometry, positions, colors, capacity }
}

/**
 * The dots for `cull`'s hidden shards written into `buf`: colours and count
 * when `changed` (the set changed), places always, each attribute marked for
 * upload only when something in it changed. Returns the buffers to draw,
 * new ones (the old disposed) when the set outgrew them.
 */
export function writeDots(cull: FarCull, buf: DotBuffers, changed: boolean): DotBuffers {
  const dots = cull.dots
  const n = cull.dotCount
  if (n > buf.capacity) {
    let capacity = buf.capacity
    while (capacity < n) capacity *= 2
    buf.geometry.dispose()
    buf = dotBuffers(capacity)
    changed = true
  }
  const pos = buf.positions
  let moved = changed
  for (let i = 0; i < n; i++) {
    const p = dots[i]!.at!.position
    const j = i * 3
    if (pos[j] !== Math.fround(p.x) || pos[j + 1] !== Math.fround(p.y) || pos[j + 2] !== Math.fround(p.z)) {
      pos[j] = p.x; pos[j + 1] = p.y; pos[j + 2] = p.z
      moved = true
    }
  }
  if (moved) buf.geometry.getAttribute('position').needsUpdate = true
  if (changed) {
    const col = buf.colors
    for (let i = 0; i < n; i++) {
      const e = dots[i]!
      col[i * 3] = e.r; col[i * 3 + 1] = e.g; col[i * 3 + 2] = e.b
    }
    buf.geometry.getAttribute('aColor').needsUpdate = true
    buf.geometry.setDrawRange(0, n)
  }
  return buf
}

/** A dot takes no taps: the shard it replaces is too small to aim at (TapTarget MIN_VISIBLE_PX). */
function noRaycast(): void {}

export function FarShardDots(): JSX.Element {
  const points = useRef<Points>(null)
  const buf = useRef<DotBuffers | null>(null)
  buf.current ??= dotBuffers(FIRST_CAPACITY)
  const material = useMemo(() => createDiscMaterial(FAR_SHARD_DOT, 1, true), [])
  const fit = useMemo(() => (renderer: WebGLRenderer) => { sizeDisc(material, renderer.getPixelRatio(), renderer.getSize(canvasSize).y) }, [material])

  useFrame((state) => {
    const cam = state.camera as PerspectiveCamera
    const changed = farCull.frame(cam.position, projScaleOf(state.size.height, cam.fov ?? FOV), performance.now())
    const was = buf.current!
    const now = writeDots(farCull, was, changed)
    buf.current = now
    const p = points.current
    if (!p) return
    if (p.geometry !== now.geometry) p.geometry = now.geometry
    const any = farCull.dotCount > 0
    if (p.visible !== any) p.visible = any
  })

  // Gone: every shard shown again, and the buffers freed.
  useEffect(() => () => { farCull.restore(); buf.current?.geometry.dispose() }, [])
  useEffect(() => () => material.dispose(), [material])

  return <points ref={points} name="far-shard-dots" geometry={buf.current.geometry} material={material} visible={false} frustumCulled={false} renderOrder={DOTS_ORDER} raycast={noRaycast} onBeforeRender={fit} />
}
