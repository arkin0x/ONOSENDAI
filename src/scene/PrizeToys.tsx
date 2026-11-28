/**
 * PrizeToys.tsx - what a smash compiled, waiting where the build stood
 * (design page 4.4; owner, 2026-11-27: "the toy shards appear for you to take
 * them and maybe glow a bit").
 *
 * Each prize bursts up out of the dust one after another (TOY_STAGGER_MS
 * apart) with a pop, a little sparkle and a chime a step higher than the last
 * (lib/blueprint/smashSound.ts), then settles into a slowly orbiting ring,
 * turning, glowing softly in its maker's colour, its name decoding above it.
 * Up to RING_MAX toys stand in the ring; the rest wait in the picker
 * (terrain/PrizePanel.tsx). Walk into one to take it, or tap it for its
 * name and maker and TAKE (owner, 2026-11-27: all three ways, COLLECT ALL
 * too). Untaken toys stay in their orbit, on this device only, until taken,
 * put away, or left behind; they stay in BUILT either way.
 *
 * Placed in the TERRAIN field's frame (scene/TerrainLayer.tsx fieldMatrix),
 * so a toy stands at its gibson as blocks do, but drawn in render space with
 * no turn of its own: the field's frame can be a mirror image of the view,
 * and a toy or its name must never read backwards. With reduced motion there
 * is no orbit and a toy simply fades in.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, CanvasTexture, Matrix4, Vector3, type Camera, type Group, type Sprite, type SpriteMaterial } from 'three'
import { fromPayload, type ShardModel } from 'sno-core/shards'
import { ShardMesh } from './ShardMesh'
import { WorldLabel } from './WorldLabel'
import { fieldMatrix, drawnScale, MAX_SCALE } from './TerrainLayer'
import { frameOf } from './ThumbStage'
import { terrainSession, headNow, offsetOf } from '../store/useTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { useBlueprints } from '../store/useBlueprints'
import { prizeName, setToyProjector, usePrizePick } from '../store/usePrizePick'
import { keepOwnTable } from '../lib/carried'
import { authorColour } from '../lib/authorColour'
import { compilerModel } from '../lib/blueprint/compilerModel'
import { quarryModel } from '../lib/blueprint/quarryModel'
import { isQuarryPrize } from '../lib/blueprint/gameCard'
import { RING_MAX } from '../lib/blueprint/smash'
import { prizeChime } from '../lib/blueprint/smashSound'
import { takeToy } from '../lib/blueprint/smashRun'
import { decodeText } from '../lib/decode'
import { useReducedMotion } from '../hooks/useReducedMotion'
import type { ToyRow } from '../lib/blueprint/blueprintDb'
import type { ViewAxes } from '../lib/space'
import { looks, spots, TOY_SIDE } from './toySpots'

/** Between one toy's burst and the next's. */
export const TOY_STAGGER_MS = 150
/** A toy's rise out of the dust. */
const RISE_MS = 520
/** Walking this near a toy takes it (gibsons, from the eye's cell to the toy). */
export const WALK_TAKE = 0.95
/** Toys this far from you (gibsons) are not drawn: left behind. */
const NEAR = 64
/** Radians a second round the ring. */
const ORBIT = 0.22
const NAME_MS = 700

/** When each toy was first drawn this session: its burst plays once. */
const born = new Map<string, number>()
/** Where you stood when each toy appeared: walking takes a toy only once you have moved, so one that pops out beside you is never taken by accident. */
const bornAt = new Map<string, string>()

/** A toy's place in the ring: its offset from the ring's centre, in gibsons, at a time. */
export function ringSpot(i: number, n: number, t: number, calm: boolean): [number, number, number] {
  const count = Math.min(n, RING_MAX)
  if (count <= 1) return [0, 0.35, 0]
  const r = 0.9 + 0.12 * count
  const a = (2 * Math.PI * i) / count + (calm ? 0 : t * ORBIT)
  return [Math.cos(a) * r, 0.35 + (calm ? 0 : 0.08 * Math.sin(t * 1.3 + i)), Math.sin(a) * r]
}

/** The soft glow behind a toy: one radial texture, tinted per toy. */
let glowTexture: CanvasTexture | null = null
function glow(): CanvasTexture | null {
  if (glowTexture || typeof document === 'undefined') return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  if (!g) return null
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  glowTexture = new CanvasTexture(c)
  return glowTexture
}

/** A toy's model: the prize's own shard (its maker counts for its carried parts), or the Compiler. */
function useToyModel(toy: ToyRow): ShardModel | null {
  const [tool, setTool] = useState<ShardModel | null>(null)
  const sno = useMemo(() => {
    if (toy.prize.type !== 'sno') return null
    const s = fromPayload(toy.prize.payload, toy.rowKey)
    return s ? keepOwnTable(s, toy.maker) : null
  }, [toy])
  useEffect(() => {
    if (toy.prize.type !== 'tool') return
    let live = true
    void (isQuarryPrize(toy.prize) ? quarryModel() : compilerModel()).then((m) => { if (live) setTool(m) })
    return () => { live = false }
  }, [toy])
  return sno ?? tool
}

/** The field's frame this frame (set by PrizeToys before its toys run). */
const field = { m: new Matrix4(), scale: 1 }
const scratch = new Vector3()
const eye = new Vector3()
const projected = new Vector3()
/** The camera and canvas size this frame, for the projector. */
const view: { cam: Camera | null; w: number; h: number } = { cam: null, w: 1, h: 1 }

function Toy({ toy, index, count, centre, calm }: { toy: ToyRow; index: number; count: number; centre: readonly [number, number, number]; calm: boolean }): JSX.Element {
  const shard = useToyModel(toy)
  const group = useRef<Group>(null)
  const spin = useRef<Group>(null)
  const halo = useRef<Sprite>(null)
  const [fit, setFit] = useState<{ scale: number; centre: [number, number, number] } | null>(null)
  const [name, setName] = useState('')
  const colour = toy.maker === 'game' ? '#ff9a3c' : authorColour(toy.maker)
  const label = prizeName(toy)
  const start = useMemo(() => {
    if (!born.has(toy.rowKey)) {
      // A toy found waiting from an earlier session settles at once; a new one bursts in its turn.
      const fresh = Date.now() / 1000 - toy.made < 20
      born.set(toy.rowKey, fresh ? performance.now() + index * TOY_STAGGER_MS : -Infinity)
    }
    return born.get(toy.rowKey)!
  }, [toy, index])
  useEffect(() => {
    if (!shard) return
    let live = true
    void frameOf(shard).then((f) => { if (live) setFit({ scale: TOY_SIDE / Math.max(0.001, 2 * f.reach), centre: f.centre }) })
    return () => { live = false }
  }, [shard])
  // The chime as it pops, and the name decoding.
  useEffect(() => {
    const wait = Math.max(0, start - performance.now())
    const t = setTimeout(() => { if (start > 0) prizeChime(index) }, wait)
    let raf = 0
    const tick = (): void => {
      const e = performance.now() - start
      if (e >= NAME_MS || start === -Infinity) { setName(label); return }
      setName(e < 0 ? '' : decodeText(label, e / NAME_MS, index + 1, Math.floor(e / 40)))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { clearTimeout(t); cancelAnimationFrame(raf) }
  }, [start, index, label])
  useFrame(() => {
    const g = group.current
    if (!g) return
    const now = performance.now()
    const e = now - start
    const spot = ringSpot(index, count, now / 1000, calm)
    const rise = start === -Infinity ? 1 : Math.max(0, Math.min(1, e / RISE_MS))
    // Out of the dust: from the centre, overshooting a little, then settling.
    const k = calm ? 1 : 1 - Math.pow(1 - rise, 3)
    // Where it stands in the field (cs offsets, Y up), then in render space.
    scratch.set(centre[0] + spot[0] * k, centre[1] + spot[1] * k - (calm ? 0 : 0.3 * (1 - k)), centre[2] + spot[2] * k)
    const kept = spots.get(toy.rowKey)
    if (kept) kept.copy(scratch)
    else spots.set(toy.rowKey, scratch.clone())
    g.position.copy(scratch.applyMatrix4(field.m))
    const pop = calm ? rise : rise < 1 ? k * (1 + 0.35 * Math.sin(Math.PI * rise)) : 1
    g.scale.setScalar(Math.max(0.0001, pop) * field.scale)
    g.visible = e >= 0 || start === -Infinity
    if (spin.current && !calm) spin.current.rotation.y = now / 1000 * 0.9 + index
    if (halo.current) {
      const m = halo.current.material as SpriteMaterial
      m.opacity = (calm ? 0.45 : 0.4 + 0.15 * Math.sin(now / 500 + index)) * (calm ? rise : 1) + (calm ? 0 : 0.6 * Math.max(0, 1 - e / 400) * (e > 0 ? 1 : 0))
    }
    looks.set(toy.rowKey, { colour, name: label })
  })
  useEffect(() => () => { spots.delete(toy.rowKey); looks.delete(toy.rowKey); born.delete(toy.rowKey); bornAt.delete(toy.rowKey) }, [toy.rowKey])
  const tex = glow()
  return (
    <group ref={group} visible={false}>
      <sprite ref={halo} scale={TOY_SIDE * 1.7}>
        <spriteMaterial map={tex} color={colour} transparent opacity={0} blending={AdditiveBlending} depthWrite={false} />
      </sprite>
      <group ref={spin}>
        {shard && fit && (
          <group scale={fit.scale}>
            <group position={[-fit.centre[0], -fit.centre[1], -fit.centre[2]]}>
              <ShardMesh shard={shard} world lit />
            </group>
          </group>
        )}
      </group>
      {name && <WorldLabel text={name} color="#ffffff" at={[0, TOY_SIDE * 0.9, 0]} px={13} align="center" sub={toy.maker === 'game' ? 'a starter recipe' : undefined} />}
    </group>
  )
}

/** The toys near you, in the field's frame. */
export function PrizeToys({ axes }: { axes: ViewAxes }): JSX.Element {
  const frame = useRef<Group>(null)
  const toys = useBlueprints((s) => s.toys)
  const putAway = useBlueprints((s) => s.putAway)
  const plane = useCyberspace((s) => s.plane)
  const calm = useReducedMotion()
  const m = useMemo(() => new Matrix4(), [])
  const lastHead = useRef('')
  // Where a toy stands on screen, for its flight to ITEMS: one projector, reading the camera this frame.
  useEffect(() => {
    setToyProjector((key) => {
      const at = spots.get(key), look = looks.get(key)
      if (!at || !look || !view.cam) return null
      const p = projected.copy(at).applyMatrix4(field.m).project(view.cam)
      return { x: (p.x + 1) / 2 * view.w, y: (1 - p.y) / 2 * view.h, ...look }
    })
    return () => setToyProjector(null)
  }, [])
  const [near, setNear] = useState<ToyRow[]>([])
  // Which toys are near, looked at a few times a second (they never move, you do).
  useEffect(() => {
    const look = (): void => {
      const s = terrainSession
      if (!s) { setNear([]); return }
      const head = offsetOf(s, headNow())
      const list = toys.filter((t) => {
        if (t.at.plane !== plane || putAway.has(t.rowKey)) return false
        const o = offsetOf(s, { x: BigInt(t.at.x), y: BigInt(t.at.y), z: BigInt(t.at.z) })
        return Math.max(Math.abs(o[0] - head[0]), Math.abs(o[1] - head[1]), Math.abs(o[2] - head[2])) <= NEAR
      })
      setNear((was) => (was.length === list.length && was.every((t, i) => t === list[i]) ? was : list))
    }
    look()
    const t = setInterval(look, 400)
    return () => clearInterval(t)
  }, [toys, putAway, plane])
  // Groups of toys by where they wait: each smash's prizes are one ring.
  const rings = useMemo(() => {
    const by = new Map<string, ToyRow[]>()
    for (const t of near) {
      const k = `${t.at.x},${t.at.y},${t.at.z}`
      by.set(k, [...(by.get(k) ?? []), t])
    }
    return [...by.values()]
  }, [near])
  useFrame((state) => {
    const f = frame.current
    const s = terrainSession
    if (!f) return
    const zoom = drawnScale()
    f.visible = !!s && s.plane === useCyberspace.getState().plane && zoom <= MAX_SCALE
    if (!s || !f.visible) return
    fieldMatrix(s, axes, zoom, m)
    field.m.copy(m)
    field.scale = 2 ** -zoom
    view.cam = state.camera
    view.w = state.size.width
    view.h = state.size.height
    if (spots.size === 0) return
    // Walking into a toy takes it: only on a step (the frame your gibson changes), once the toy has settled
    // and you have moved since it appeared, so a ring orbiting past you never takes one by itself.
    const head = offsetOf(s, headNow())
    const here = `${head[0]},${head[1]},${head[2]}`
    const stepped = here !== lastHead.current
    lastHead.current = here
    const now = performance.now()
    eye.set(head[0] + 0.5, head[1] + 0.5, head[2] + 0.5)
    for (const [key, at] of spots) {
      if (!bornAt.has(key)) bornAt.set(key, here)
      if (!stepped) continue
      const settled = now - (born.get(key) ?? 0) > RISE_MS + 600
      if (settled && bornAt.get(key) !== here && at.distanceTo(eye) <= WALK_TAKE && usePrizePick.getState().taking !== key) {
        const pick = usePrizePick.getState()
        const from = pick.measure(key)
        if (takeToy(key)) pick.flyFrom(key, from)
      }
    }
  })
  const s = terrainSession
  return (
    <group ref={frame} name="prize-toys">
      {s && rings.map((ring) => {
        const t0 = ring[0]
        const o = offsetOf(s, { x: BigInt(t0.at.x), y: BigInt(t0.at.y), z: BigInt(t0.at.z) })
        const centre: [number, number, number] = [o[0] + 0.5, o[1] + 0.5, o[2] + 0.5]
        return ring.slice(0, RING_MAX).map((toy, i) => <Toy key={toy.rowKey} toy={toy} index={i} count={ring.length} centre={centre} calm={calm} />)
      })}
    </group>
  )
}
