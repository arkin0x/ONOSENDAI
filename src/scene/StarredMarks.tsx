/**
 * StarredMarks.tsx - your Starred Places, standing in the scene.
 *
 * arkinox, 2026-10-07: "I want to see a star in the actual scene if a starred
 * place is in view ... the same technique as the bitcoin B for cashu messages,
 * but a starred place doesn't need the spinning cube, just a small glowing
 * star." So each place is drawn the way a coin is (WorldMessages.tsx): placed
 * with itemCentre against the anchor's aligned origin, culled past the same
 * reach, held to a constant size on screen at any zoom, with a fixed-size
 * TapTarget over it that wins over a shard's box (TapTarget.tsx). What stands
 * there is a small filled star with a soft glow behind it, both facing you,
 * breathing slowly (a gentle pulse and a little twinkle of the glow, each star
 * at its own phase so a field of them does not throb in step). Under
 * prefers-reduced-motion the star holds still.
 *
 * Under it, its nickname or the name it was starred under, as a small label in
 * the star's yellow; a place known only by its shortened axes stays a bare
 * star (lib/starred.ts sceneLabel). A tap opens the place's card
 * (StarredPlaceCard.tsx), as a tap on a coin opens the coin.
 *
 * Only the plane being looked at: a place in ideaspace is not drawn while you
 * look at dataspace, as with every hidden item.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import { AdditiveBlending, BufferGeometry, CanvasTexture, Float32BufferAttribute, Shape, ShapeGeometry, type Group, type Mesh, type MeshBasicMaterial, type PerspectiveCamera } from 'three'
import { GRID_RADIUS, type ViewAxes } from '../lib/space'
import { placedStars, sceneLabel } from '../lib/starred'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { useStarred } from '../store/useStarred'
import { WorldLabel } from './WorldLabel'
import { TapTarget } from './TapTarget'

/** The reach the hidden messages are drawn to, in cells. The pin reads it
 * to know whether a star stands under it (EarthPin.tsx starNamesPin). */
export const STAR_REACH = GRID_RADIUS * 8
/** The star's yellow: the chip's, lit. */
export const STAR_YELLOW = '#ffd84d'
/** How wide the star stands, in CSS pixels: small, under the coin's 51. */
const STAR_PX = 20
/** The glow behind it, as a multiple of the star. */
const GLOW = 2.6
/**
 * How opaque the glow is. It draws additively and outside tone mapping, so
 * the scene's bloom picks it up too, and at 0.55 still (0.4 to 0.65 breathing)
 * it swamped the star's points and the label under it: "Can you back it off
 * 50%?" (arkinox, 2026-10-08). Each is half of what it was. Still, under
 * prefers-reduced-motion, it holds at GLOW_REST; otherwise it breathes from
 * GLOW_BASE to GLOW_BASE + GLOW_SWING.
 */
export const GLOW_REST = 0.275
export const GLOW_BASE = 0.2
export const GLOW_SWING = 0.125
/** A fingertip over the mark, as for a coin. */
const TAP_PX = 44

/** A five-pointed star one unit across, point up. */
function starShape(): Shape {
  const s = new Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.21
    const a = Math.PI / 2 + (i * Math.PI) / 5
    const x = Math.cos(a) * r
    const y = Math.sin(a) * r
    if (i === 0) s.moveTo(x, y)
    else s.lineTo(x, y)
  }
  s.closePath()
  return s
}

// Shared by every star: one fill, one outline, one glow texture.
let shared: { fill: ShapeGeometry; edge: BufferGeometry; glow: CanvasTexture | null } | null = null
function sharedGeometry(): NonNullable<typeof shared> {
  if (shared) return shared
  const shape = starShape()
  const pts = shape.getPoints()
  const edge = new BufferGeometry()
  edge.setAttribute('position', new Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, 0.001]), 3))
  let glow: CanvasTexture | null = null
  try {
    const c = document.createElement('canvas')
    c.width = c.height = 64
    const g = c.getContext('2d')
    if (g) {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      grad.addColorStop(0, 'rgba(255, 216, 77, 0.9)')
      grad.addColorStop(0.35, 'rgba(255, 216, 77, 0.35)')
      grad.addColorStop(1, 'rgba(255, 216, 77, 0)')
      g.fillStyle = grad
      g.fillRect(0, 0, 64, 64)
      glow = new CanvasTexture(c)
    }
  } catch { /* no canvas: the star goes without its glow */ }
  shared = { fill: new ShapeGeometry(shape), edge, glow }
  return shared
}

/** Whether the person asked for less motion, kept current. */
function useReducedMotion(): boolean {
  const query = useMemo(() => { try { return window.matchMedia('(prefers-reduced-motion: reduce)') } catch { return null } }, [])
  const [reduced, setReduced] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const on = (): void => setReduced(query.matches)
    query.addEventListener?.('change', on)
    return () => query.removeEventListener?.('change', on)
  }, [query])
  return reduced
}

function phaseOf(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return ((h >>> 0) % 628) / 100
}

function StarMark({ at, phase, still }: { at: [number, number, number]; phase: number; still: boolean }): JSX.Element {
  const group = useRef<Group>(null)
  const glow = useRef<Mesh>(null)
  const geo = sharedGeometry()

  useFrame((state) => {
    const g = group.current
    if (!g) return
    const cam = state.camera as PerspectiveCamera
    const perPixel = (2 * Math.tan((cam.fov * Math.PI) / 360)) / state.size.height
    const t = state.clock.elapsedTime
    const pulse = still ? 1 : 1 + 0.07 * Math.sin(t * 2.2 + phase)
    g.scale.setScalar(Math.max(1e-5, cam.position.distanceTo(g.position) * perPixel * STAR_PX * pulse))
    const halo = glow.current
    if (halo) {
      const m = halo.material as MeshBasicMaterial
      m.opacity = still ? GLOW_REST : GLOW_BASE + GLOW_SWING * (0.5 + 0.5 * Math.sin(t * 1.6 + phase * 1.7))
      halo.rotation.z = still ? 0 : 0.12 * Math.sin(t * 0.9 + phase)
    }
  })

  return (
    <group ref={group} position={at}>
      <Billboard>
        {geo.glow && (
          <mesh ref={glow} scale={GLOW} renderOrder={1}>
            <planeGeometry args={[1, 1]} />
            <meshBasicMaterial map={geo.glow} transparent opacity={GLOW_REST} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
        <mesh geometry={geo.fill} renderOrder={2}>
          <meshBasicMaterial color={STAR_YELLOW} transparent opacity={0.95} depthWrite={false} toneMapped={false} />
        </mesh>
        <lineLoop geometry={geo.edge} renderOrder={3}>
          <lineBasicMaterial color="#fff3c0" transparent opacity={0.9} depthWrite={false} toneMapped={false} />
        </lineLoop>
      </Billboard>
    </group>
  )
}

export function StarredMarks({ axes }: { axes: ViewAxes }): JSX.Element | null {
  const places = useStarred((s) => s.places)
  const anchor = useCyberspace((s) => s.anchor)
  const anchorPlane = useCyberspace((s) => s.anchorPlane)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const still = useReducedMotion()

  const placed = useMemo(
    () => placedStars(places, alignedOrigin(anchor, scaleExp), anchorPlane, scaleExp, axes, STAR_REACH),
    [places, anchor, anchorPlane, scaleExp, axes],
  )

  if (placed.length === 0) return null
  return (
    <>
      {placed.map(({ place, at }) => {
        const key = `${place.plane}:${place.input}`
        const words = sceneLabel(place)
        return (
          <group key={key}>
            <StarMark at={at} phase={phaseOf(key)} still={still} />
            {words && <WorldLabel text={words} color={STAR_YELLOW} at={at} align="center" px={11} offsetPx={[0, -(STAR_PX / 2 + 10)]} />}
            <TapTarget px={TAP_PX} at={at} onTap={() => useStarred.getState().select(place)} />
          </group>
        )
      })}
    </>
  )
}
