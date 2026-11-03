/**
 * ItemVanish.tsx: an item going out of the world after TAKE (arkinox,
 * 2026-11-01: "have it disappear over 4 seconds with sparkles"; lib/ceremony
 * has the timeline, store/useOpenCeremony who is playing).
 *
 * Its model and name fade over the blue box that stays (WorldMessages), the
 * model's own cut at its region's walls kept (ItemModelMark), with the chest's
 * gold glints round it (ChestCeremony Twinkles): points, so the scene's bloom
 * sees them, one draw call and no meshes, so nothing is asked of the budget.
 * The sparkles keep within the region too. On the calm path (reduced motion)
 * it is a short plain fade with no sparkles. A frame writes numbers and
 * allocates nothing. Nothing here is kept: a reload draws the box.
 *
 * The box fades in under the item as it goes (WorldMessages PlacedBox
 * `appear`), see-through until the end, so it hides nothing that is fading;
 * a name with no model stands just above the box (`clear`), never inside it.
 */

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group, PerspectiveCamera } from 'three'
import { hash01 } from '../lib/decode'
import { vanishOpacity, vanishSparkle } from '../lib/ceremony'
import type { Box } from '../lib/clip'
import { itemBoxSize, trueScale, type ItemAnimation, type ItemModelRef } from '../lib/itemModel'
import { MARK_RECEDE_FLOOR, recedeShare } from '../lib/markerSize'
import type { ViewAxes } from '../lib/space'
import { useItemModel } from '../hooks/useItemModel'
import { useCyberspace } from '../store/useCyberspace'
import type { Vanishing } from '../store/useOpenCeremony'
import { fadeAll, Twinkles } from './ChestCeremony'
import { headlampUniforms } from './headlamp'
import { ItemModelMark } from './ItemModel'
import { LABEL_PRIORITY, WorldLabel } from './WorldLabel'

/** How many sparkles, and how far they reach on screen from the item at the least, CSS pixels. */
const SPARKLES = 36
const REACH_PX = 40
/** How far they drift up over the fade, in shares of their reach. */
const DRIFT = 0.5
const NO_MOTION: readonly ItemAnimation[] = []

let unitBall: Float32Array | null = null
/** One set of sparkle places in a ball of radius 1, the same for every item. */
function sparklePlaces(): Float32Array {
  if (unitBall) return unitBall
  const out = new Float32Array(SPARKLES * 3)
  for (let i = 0; i < SPARKLES; i++) {
    const r = Math.cbrt(hash01(i, 23))
    const y = hash01(i, 29) * 2 - 1
    const round = Math.sqrt(1 - y * y)
    const a = hash01(i, 31) * Math.PI * 2
    out[i * 3] = r * round * Math.cos(a)
    out[i * 3 + 1] = r * y
    out[i * 3 + 2] = r * round * Math.sin(a)
  }
  return (unitBall = out)
}

/** The room the sparkles have, about the place, in gibsons: to the nearest wall of its region. */
export function wallRoom(region: Box | null | undefined): number {
  if (!region) return Infinity
  let room = Infinity
  for (let k = 0; k < 3; k++) room = Math.min(room, -region.min[k], region.max[k])
  return Math.max(0, room)
}

export function ItemVanish({ id, label, at, wears, region, axes, minPx, play, clear }: {
  id: string
  label: { text: string; color: string; sub: string; subColor: string }
  at: [number, number, number]
  wears?: { model: ItemModelRef; animation: readonly ItemAnimation[] }
  region: Box | null
  axes: ViewAxes
  /** The smallest its model's box is drawn, as the mark it was (WorldMessages ItemMark). */
  minPx: number
  play: Vanishing
  /**
   * The blue box it fades out over (WorldMessages PlacedBox): an item with no
   * model has its name lifted clear above it, never inside it.
   */
  clear?: { trueSide: number; minPx: number }
}): JSX.Element {
  const model = useItemModel(wears?.model)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const root = useRef<Group>(null)
  const sparkles = useRef<Group>(null)
  const fade = useRef(1)
  const animation = wears?.animation ?? NO_MOTION
  const halfGibsons = useMemo(() => (model ? Math.max(...itemBoxSize(model.extent, model.shard.unit, animation).gibsons) / 2 : 0), [model, animation])
  const room = useMemo(() => wallRoom(region), [region])
  useFrame((state) => {
    const t = performance.now() - play.at
    fade.current = vanishOpacity(t, play.calm)
    fadeAll(root.current, fade.current)
    const g = sparkles.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    const depth = cam.position.distanceTo(g.position)
    const perPx = (2 * Math.tan((cam.fov * Math.PI) / 360) * depth) / state.size.height
    const perGibson = trueScale(0, scaleExp)
    const onScreen = perPx * REACH_PX * recedeShare(depth, headlampUniforms.uHeadlampReach.value, MARK_RECEDE_FLOOR)
    const reach = Math.max(1e-9, Math.min(Math.max(onScreen, halfGibsons * perGibson), room * perGibson))
    g.scale.setScalar(reach / (1 + DRIFT))
    g.position.set(at[0], at[1] + (reach / (1 + DRIFT)) * DRIFT * (1 - fade.current), at[2])
  }, LABEL_PRIORITY)
  return (
    <>
      <group ref={root}>
        {model
          ? <ItemModelMark id={id} model={model} animation={animation} at={at} region={region} axes={axes} minPx={minPx} label={label} vanish={fade} />
          : <WorldLabel text={label.text} color={label.color} at={at} align="center" px={13} sub={label.sub} subColor={label.subColor} fade={fade} clear={clear} recede="name" />}
      </group>
      {!play.calm && (
        <group ref={sparkles} position={at}>
          <Twinkles positions={sparklePlaces()} at={play.at} level={vanishSparkle} />
        </group>
      )}
    </>
  )
}
