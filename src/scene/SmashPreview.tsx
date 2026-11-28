/**
 * SmashPreview.tsx - the blocks a smash would take, pulsing before it happens
 * (lib/blueprint/smashPreview.ts has the rules: the set is smash.ts
 * smashGroup's own, mint when it compiles, the Compiler's orange when it only
 * breaks, the warning red when it is a game recipe built wrong: nearMiss.ts).
 *
 * Drawn inside TerrainLayer's Marks frame (the field's frame, a cell one unit
 * at any zoom), beside the block outline, as the set's outer
 * faces: one mesh and one draw for the whole set, never one per cell. Depth
 * tested, so blocks in front hide it, and it never blooms.
 *
 * Shown with the Compiler in hand while you aim at a block in reach, and with
 * either hand while a SMASH hold is under way (at the hold's own block). The
 * set is worked out again only when the aimed cell, the hand or the blocks
 * change, once the aim has rested a moment (PreviewTracker); a frame only
 * moves the pulse, which quickens with the hold's charge, and stays still
 * with reduced motion. Hidden while the bag, the menu over the scene or a
 * modal is up, outside TERRAIN, and from the swing until the shatter's main
 * burst is over (the hammer's flash has the screen).
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, DoubleSide, MeshBasicMaterial, type Mesh } from 'three'
import { cellInReach, compilerInHand, headNow, terrainSession, useTerrain, type TerrainSession } from '../store/useTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { walkMenuCovering } from '../store/walkInput'
import { modalUp } from '../hooks/useEscape'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { useSmashHold } from '../terrain/smashHold'
import { RESOLVE_AFTER_MS, SWING_MS } from '../lib/blueprint/smash'
import { PreviewTracker, advancePhase, previewCause, previewColor, pulseOpacity, outerFaces, showPreview, smashPreview, type Preview, type PreviewAim } from '../lib/blueprint/smashPreview'
import { naturalOf } from '../lib/blueprint/nearMiss'
import { NO_BLOOM_BLEND } from './shardFaces'
import { terrainCursor } from './TerrainLayer'

/** The preview's overlay: flat colour, depth tested, never writing depth, pulled a little toward the eye, never blooming. */
export function makePreviewMaterial(): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color: '#ffffff', transparent: true, opacity: 0, depthTest: true, depthWrite: false, side: DoubleSide, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, forceSinglePass: true, ...NO_BLOOM_BLEND,
  })
}

/** The last reach asked: asked again only when the field, the block, where you stand or the check changes (it makes BigInts). */
const reachMemo: { s: TerrainSession | null; x: number; y: number; z: number; head: unknown; check: unknown; ok: boolean } = { s: null, x: 0, y: 0, z: 0, head: null, check: null, ok: false }
function reachable(s: TerrainSession, cell: readonly [number, number, number], check: typeof cellInReach): boolean {
  const head = headNow()
  const m = reachMemo
  if (m.s === s && m.check === check && m.head === head && m.x === cell[0] && m.y === cell[1] && m.z === cell[2]) return m.ok
  m.s = s; m.check = check; m.head = head; m.x = cell[0]; m.y = cell[1]; m.z = cell[2]
  m.ok = check(s, cell)
  return m.ok
}

/** What the preview aims at this frame, or null for nothing: written into `out`, so a frame makes nothing new. */
export function previewAim(out: PreviewAim, now: number, s: TerrainSession | null = terrainSession, inReach: typeof cellInReach = cellInReach): PreviewAim | null {
  const st = useTerrain.getState()
  if (!s || !st.active || s.plane !== useCyberspace.getState().plane) return null
  if (st.sheet || walkMenuCovering() || modalUp()) return null
  const hold = useSmashHold.getState()
  // From the swing to the shatter's main burst, the hammer's flash has the screen.
  if (hold.swingAt !== null && now >= hold.swingAt && now - hold.swingAt < SWING_MS + RESOLVE_AFTER_MS) return null
  let cell: readonly [number, number, number] | null = null
  let bare: boolean
  if (hold.since !== null && hold.target) {
    // A hold aims at the block it started on, with the hand it started with (smashRun.ts holdSmash).
    cell = hold.target
    bare = hold.bare
  } else {
    // Not holding: only with the Compiler in hand, at a block in reach (holdSmash refuses one out of reach).
    bare = !compilerInHand()
    const hit = terrainCursor.hit
    if (bare || !hit || !reachable(s, hit.cell, inReach)) return null
    cell = hit.cell
  }
  out.field = s; out.x = cell[0]; out.y = cell[1]; out.z = cell[2]; out.bare = bare; out.version = s.version
  return out
}

/** The hold's charge now: 0 with no hold, 1 as it completes. */
function holdCharge(now: number): number {
  const h = useSmashHold.getState()
  return h.since === null || h.ms <= 0 ? 0 : Math.min(1, (now - h.since) / h.ms)
}

export function SmashPreview(): JSX.Element {
  const reduced = useReducedMotion()
  const calm = useRef(reduced)
  calm.current = reduced
  const mesh = useRef<Mesh>(null)
  const material = useMemo(() => makePreviewMaterial(), [])
  const geometry = useRef<BufferGeometry | null>(null)
  const builtFor = useRef<Preview | null>(null)
  const phase = useRef(0)
  const aim = useRef<PreviewAim>({ field: {}, x: 0, y: 0, z: 0, bare: false, version: 0 })
  const tracker = useMemo(() => new PreviewTracker((a) => {
    const s = a.field as TerrainSession
    return smashPreview((x, y, z) => s.world.blockCs(x, y, z), [a.x, a.y, a.z], a.bare, naturalOf(s.world))
  }), [])
  useEffect(() => () => {
    geometry.current?.dispose()
    geometry.current = null
    material.dispose()
    showPreview(null)
  }, [material])
  useFrame((_, delta) => {
    const m = mesh.current
    if (!m) return
    const now = performance.now()
    const shown = tracker.step(previewAim(aim.current, now), now)
    showPreview(shown)
    if (!shown) { m.visible = false; return }
    if (builtFor.current !== shown) {
      // A new set: its faces are built once, here, and the old one freed.
      builtFor.current = shown
      ;(geometry.current ?? m.geometry).dispose()
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(outerFaces(shown.cells, shown.keys, shown.hit), 3))
      g.computeBoundingSphere()
      geometry.current = g
      m.geometry = g
      material.color.set(previewColor(shown.state, previewCause(shown)))
    }
    phase.current = advancePhase(phase.current, Math.min(delta, 0.1) * 1000, holdCharge(now))
    material.opacity = pulseOpacity(phase.current, calm.current)
    m.visible = true
  })
  return <mesh ref={mesh} name="terrain-smash-preview" material={material} renderOrder={4} visible={false} frustumCulled={false} />
}
