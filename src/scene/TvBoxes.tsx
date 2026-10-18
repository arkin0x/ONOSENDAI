/**
 * TvBoxes.tsx: a bag being sealed, on Cyberspace TV, where its hint box says
 * it is.
 *
 * "show a green box's outlines materialize, then the sides of the box
 * materialize. a key glyph stamps onto each side of the box, and then the
 * sides fade out. the green box outlines stay" (arkinox, 2026-10-18). The
 * box is the bag's hint box, the one place its author chose to make public;
 * a bag without one is never placed in the world (TvScreen shows it in an
 * inset), because where a bag is hidden is the hunt.
 *
 * Every box the tape has shown keeps its outline, dimmer, for the rest of
 * the tape (useTv `boxes`), so a stretch of history leaves its bags behind.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, CanvasTexture, DoubleSide, EdgesGeometry, type LineBasicMaterial, type Mesh, type MeshBasicMaterial, SRGBColorSpace } from 'three'
import type { HintBox } from '../lib/hint'
import { cellDelta, type Position, type ViewAxes } from '../lib/space'
import { alignedOrigin, useCyberspace } from '../store/useCyberspace'
import { shotProgress, useTv } from '../store/useTv'

/** The green of "found here", as the deploy box and the LIVE tag. */
const REGION = '#52e39f'
/** A box drawn smaller than this, or larger, in cells, is left out: a speck, or a wall around the camera. */
const MIN_CELLS = 0.25
const MAX_CELLS = 160
/** A shown bag's outline, once its shot is over. */
const KEPT_OPACITY = 0.3

/** The animation, in seconds from the shot's start. */
const EDGES_IN = [0, 1.0]
const SIDES_IN = [1.0, 1.8]
const STAMP_AT = 2.0
const STAMP_GAP = 0.22
const STAMP_S = 0.18
const SIDES_OUT = [4.2, 5.4]
const SIDES_OPACITY = 0.2

const ramp = (t: number, [a, b]: number[]): number => Math.min(1, Math.max(0, (t - a) / (b - a)))

/** Where a hint box is drawn: its centre and size in render cells, or null when it would be a speck or a wall. */
export function boxInFrame(hint: HintBox, origin: Position, scaleExp: number, axes: ViewAxes): { centre: [number, number, number]; size: [number, number, number] } | null {
  const centre: [number, number, number] = [0, 0, 0]
  const size: [number, number, number] = [1, 1, 1]
  const slots = [axes.right, axes.up, axes.out]
  for (let i = 0; i < 3; i++) {
    const a = slots[i]
    const h = hint.heights[a.axis === 'x' ? 0 : a.axis === 'y' ? 1 : 2]
    if (h < scaleExp) {
      const side = 2 ** (h - scaleExp)
      if (side < MIN_CELLS) return null
      centre[i] = (cellDelta(hint.base[a.axis], origin[a.axis], scaleExp) + side / 2 - 0.5) * a.dir
      size[i] = side
      continue
    }
    const lo = cellDelta(hint.base[a.axis], origin[a.axis], scaleExp)
    const hi = cellDelta(hint.base[a.axis] + (1n << BigInt(h)) - (1n << BigInt(scaleExp)), origin[a.axis], scaleExp)
    if (hi - lo + 1 > MAX_CELLS) return null
    centre[i] = ((lo + hi) / 2) * a.dir
    size[i] = hi - lo + 1
  }
  return { centre, size }
}

/** A key, drawn: a ring for the bow, a shaft, two teeth. White on clear, tinted by the material. */
function keyTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  g.strokeStyle = '#fff'
  g.fillStyle = '#fff'
  g.lineWidth = 12
  g.lineCap = 'round'
  g.beginPath()
  g.arc(38, 64, 20, 0, Math.PI * 2)
  g.stroke()
  g.beginPath()
  g.moveTo(58, 64)
  g.lineTo(112, 64)
  g.moveTo(96, 64)
  g.lineTo(96, 84)
  g.moveTo(110, 64)
  g.lineTo(110, 80)
  g.stroke()
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** The six faces: which render axis each is across, and which side. */
const FACES: Array<{ slot: 0 | 1 | 2; sign: 1 | -1 }> = [
  { slot: 0, sign: 1 }, { slot: 0, sign: -1 }, { slot: 1, sign: 1 }, { slot: 1, sign: -1 }, { slot: 2, sign: 1 }, { slot: 2, sign: -1 },
]

function Box({ hint, live }: { hint: HintBox; live: boolean }): JSX.Element | null {
  const axes = useMemo(() => useCyberspace.getState().axes(), [])
  const anchor = useCyberspace((s) => s.anchor)
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const plane = useCyberspace((s) => s.anchorPlane)
  const at = useMemo(() => boxInFrame(hint, alignedOrigin(anchor, scaleExp), scaleExp, axes), [hint, anchor, scaleExp, axes])
  const edges = useMemo(() => new EdgesGeometry(new BoxGeometry(1, 1, 1)), [])
  const sides = useMemo(() => new BoxGeometry(1, 1, 1), [])
  const key = useMemo(() => (live ? keyTexture() : null), [live])
  useEffect(() => () => { edges.dispose(); sides.dispose(); key?.dispose() }, [edges, sides, key])
  const line = useRef<LineBasicMaterial>(null)
  const fill = useRef<MeshBasicMaterial>(null)
  const stamps = useRef<Array<Mesh | null>>([])

  useFrame(() => {
    if (!live) return
    const shot = useTv.getState().shot
    const t = shotProgress() * (shot?.length ?? 1)
    if (line.current) line.current.opacity = 0.9 * ramp(t, EDGES_IN)
    const out = 1 - ramp(t, SIDES_OUT)
    if (fill.current) fill.current.opacity = SIDES_OPACITY * ramp(t, SIDES_IN) * out
    stamps.current.forEach((m, i) => {
      if (!m) return
      const start = STAMP_AT + i * STAMP_GAP
      const k = ramp(t, [start, start + STAMP_S])
      // Lands: from large and faint to its size, as a stamp comes down.
      const sc = 1.8 - 0.8 * k
      m.scale.set(sc, sc, sc)
      ;(m.material as MeshBasicMaterial).opacity = k * out
    })
  })

  if (!at || hint.plane !== plane) return null
  const [cx, cy, cz] = at.centre
  const [sx, sy, sz] = at.size
  return (
    <group position={[cx, cy, cz]}>
      <lineSegments geometry={edges} scale={[sx, sy, sz]} frustumCulled={false}>
        <lineBasicMaterial ref={line} color={REGION} toneMapped={false} transparent opacity={live ? 0 : KEPT_OPACITY} />
      </lineSegments>
      {live && (
        <mesh geometry={sides} scale={[sx, sy, sz]} frustumCulled={false}>
          <meshBasicMaterial ref={fill} color={REGION} toneMapped={false} transparent opacity={0} side={DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {live && key && FACES.map((f, i) => {
        const pos: [number, number, number] = [0, 0, 0]
        pos[f.slot] = (f.sign * [sx, sy, sz][f.slot]) / 2
        const rot: [number, number, number] = f.slot === 0 ? [0, (f.sign * Math.PI) / 2, 0] : f.slot === 1 ? [(-f.sign * Math.PI) / 2, 0, 0] : [0, f.sign > 0 ? 0 : Math.PI, 0]
        const across = Math.min(...[sx, sy, sz].filter((_, j) => j !== f.slot)) * 0.55
        return (
          <group key={i} position={pos} rotation={rot}>
            <mesh ref={(m) => { stamps.current[i] = m }} frustumCulled={false}>
              <planeGeometry args={[across, across]} />
              <meshBasicMaterial map={key} color={REGION} toneMapped={false} transparent opacity={0} side={DoubleSide} depthWrite={false} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

export function TvBoxes(): JSX.Element {
  const boxes = useTv((s) => s.boxes)
  const shot = useTv((s) => s.shot)
  const liveId = shot?.kind === 'bag' && shot.item?.kind === 'bag' && shot.item.hint ? shot.id : null
  return (
    <group>
      {boxes.map((b) => <Box key={`${b.id}${b.id === liveId ? ':live' : ''}`} hint={b.hint} live={b.id === liveId} />)}
    </group>
  )
}
