/**
 * QuarryFx.tsx - the Quarry Charge in the scene (store/useQuarry.ts holds
 * the charges and drops; lib/terrain/quarry.ts the rules). Drawn in the
 * TERRAIN field's frame (TerrainLayer fieldMatrix), as SmashFx is, so a cell
 * is one unit here at any zoom:
 *
 *   - each charge burning: a small dark casing banded in the Compiler's
 *     orange, its lamp flashing on every beep of the fuse (FUSE_BEEPS, so
 *     the light and the sound keep time), and the seconds left over it, white
 *     with a dark edge, never hidden by the blocks;
 *   - the drops (scene/quarryDrops.ts): every block the blast took, as a
 *     small copy of itself in its own cell, one InstancedMesh per kind,
 *     turning, bobbing and fading in the shader; a frame sets only the time.
 *
 * Nothing is made per frame. The lamp's glow adds its light and blooms.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, Sprite, SpriteMaterial } from 'three'
import { terrainSession } from '../store/useTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { useQuarry } from '../store/useQuarry'
import { FUSE_MS, blinkLit, secondsLeft } from '../lib/terrain/quarry'
import { ITEM_ORANGE } from '../lib/blueprint/itemMark'
import { DropField } from './quarryDrops'
import { MAX_SCALE, drawnScale, fieldMatrix } from './TerrainLayer'
import type { ViewAxes } from '../lib/space'

/** The most charges drawn burning at once; more still blast, unseen. */
const CHARGES_DRAWN = 8
/** A charge's casing, in blocks. */
const CASE = 0.56

/** A digit for the countdown: white with a dark edge, as text over the scene is (owner's taste). */
function digitTexture(d: number): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 128; c.height = 128
  const g = c.getContext('2d')
  if (!g) return null
  g.font = '700 92px ui-monospace, "SFMono-Regular", Menlo, monospace'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineWidth = 14
  g.strokeStyle = 'rgba(0, 0, 0, 0.85)'
  g.strokeText(String(d), 64, 68)
  g.fillStyle = '#ffffff'
  g.fillText(String(d), 64, 68)
  return new CanvasTexture(c)
}

/** A soft round glow, white in the middle: tinted by its material. */
function glowTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 64; c.height = 64
  const g = c.getContext('2d')
  if (!g) return null
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return new CanvasTexture(c)
}

const UNIT_BOX = new BoxGeometry(1, 1, 1)

export function QuarryFx({ axes }: { axes: ViewAxes }): JSX.Element {
  const frame = useRef<Group>(null)
  const chargeGroup = useRef<Group>(null)
  // The drops (scene/quarryDrops.ts): one instanced mesh per block kind, made as kinds come, let go with the scene.
  const drops = useMemo(() => new DropField(), [])
  useEffect(() => () => drops.dispose(), [drops])

  const look = useMemo(() => {
    const side = new MeshBasicMaterial({ color: '#1d2224', toneMapped: false })
    const top = new MeshBasicMaterial({ color: '#2c3335', toneMapped: false })
    const under = new MeshBasicMaterial({ color: '#111516', toneMapped: false })
    const band = new MeshBasicMaterial({ color: ITEM_ORANGE, toneMapped: false })
    const lampOff = new MeshBasicMaterial({ color: '#5a2a08', toneMapped: false })
    const lampOn = new MeshBasicMaterial({ color: '#ffd9a8', toneMapped: false })
    const glowMap = glowTexture()
    const glow = new SpriteMaterial({ map: glowMap, color: ITEM_ORANGE, blending: AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false })
    const digits = [1, 2, 3].map((d) => new SpriteMaterial({ map: digitTexture(d), depthWrite: false, depthTest: false, transparent: true, toneMapped: false }))
    // The casing's faces: +x, -x, +y, -y, +z, -z.
    const casing = [side, side, top, under, side, side]
    return { side, top, under, band, lampOff, lampOn, glow, glowMap, digits, casing }
  }, [])
  useEffect(() => () => {
    for (const m of [look.side, look.top, look.under, look.band, look.lampOff, look.lampOn, look.glow, ...look.digits]) { if (m !== look.glow) m.map?.dispose(); m.dispose() }
    look.glowMap?.dispose()
  }, [look])

  useFrame(() => {
    const f = frame.current, cg = chargeGroup.current
    if (!f || !cg) return
    const s = terrainSession
    const plane = useCyberspace.getState().plane
    const zoom = drawnScale()
    const q = useQuarry.getState()
    const on = !!s && s.plane === plane && zoom <= MAX_SCALE && (q.charges.length > 0 || q.drops.length > 0)
    f.visible = on
    if (!s || !on) return
    fieldMatrix(s, axes, zoom, f.matrix)
    f.matrixWorldNeedsUpdate = true

    // The drops: written again only when they change or the field does; a frame moves only their time.
    drops.update(s, q.owner === s.owner ? q.drops : NO_DROPS, q.version)
    drops.tick(Date.now())

    // The charges burning: the casing where each was placed, the lamp on each beep, the seconds over it.
    const now = performance.now()
    const o = s.world.origin
    let n = 0
    for (const c of q.charges) {
      if (n >= CHARGES_DRAWN) break
      if (c.plane !== s.plane || c.owner !== s.owner) continue
      const g = cg.children[n] as Group | undefined
      if (!g) break
      const ms = now - c.armedAt
      g.visible = true
      g.position.set(Number(c.x - o.x) + 0.5, Number(c.y - o.y) + 0.5 - (1 - CASE) / 2, Number(c.z - o.z) + 0.5)
      const lit = blinkLit(ms)
      ;(g.children[2] as Mesh).material = lit ? look.lampOn : look.lampOff
      ;(g.children[3] as Sprite).visible = lit
      const left = secondsLeft(ms, FUSE_MS)
      const digit = g.children[4] as Sprite
      digit.visible = left >= 1 && left <= 3
      if (digit.visible) digit.material = look.digits[left - 1]
      n++
    }
    for (let i = n; i < cg.children.length; i++) cg.children[i].visible = false
  })

  return (
    <group ref={frame} name="quarry-fx" visible={false} matrixAutoUpdate={false}>
      <group ref={chargeGroup}>
        {Array.from({ length: CHARGES_DRAWN }, (_, i) => (
          <group key={i} visible={false}>
            <mesh geometry={UNIT_BOX} material={look.casing} scale={[CASE, CASE * 0.8, CASE]} renderOrder={6} raycast={() => {}} />
            <mesh geometry={UNIT_BOX} material={look.band} scale={[CASE * 1.04, CASE * 0.16, CASE * 1.04]} renderOrder={6} raycast={() => {}} />
            <mesh geometry={UNIT_BOX} material={look.lampOff} scale={[0.14, 0.1, 0.14]} position={[0, CASE * 0.45, 0]} renderOrder={6} raycast={() => {}} />
            <sprite material={look.glow} scale={[1.4, 1.4, 1]} position={[0, CASE * 0.45, 0]} renderOrder={15} visible={false} raycast={() => {}} />
            <sprite material={look.digits[2]} scale={[0.7, 0.7, 1]} position={[0, 1.05, 0]} renderOrder={16} visible={false} raycast={() => {}} />
          </group>
        ))}
      </group>
      <primitive object={drops.group} />
    </group>
  )
}

/** None, the same every frame. */
const NO_DROPS: readonly never[] = []
