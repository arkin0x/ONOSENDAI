/**
 * SurveyGlow.tsx - the chunk a SURVEY hold will fill, lit while it is held
 * (terrain/surveyGlow.ts has the numbers; owner, 2026-11-27: "light up the
 * chunk region being surveyed somehow while the survey button is being held
 * so we know what one is being acted upon").
 *
 * The chunk is the hold's own (terrain/surveyHold.ts `key`, chosen as the
 * hold starts by store/useTerrain.ts surveyTarget), the very one the survey
 * fills when the hold completes, so the two never disagree.
 *
 * Drawn inside TerrainLayer's Marks frame (the field's frame, a cell one unit
 * at any zoom; the left-handed axes are the frame's matrix's business,
 * lib/space.ts), as one group made once and kept: the chunk's twelve edges in
 * TERRAIN's mint as one screen-space line (one geometry for all twelve), a
 * wide faint line under it for the glow, and the faces faintly filled, a
 * hair outside the chunk so they never fight the blocks on its border. A
 * frame only moves it, sets three opacities and the breath's phase: nothing
 * is made. Depth tested, so the blocks in front hide it; it never blooms.
 * Hidden on release; held to the end, it flashes once and fades
 * (not with reduced motion, where it stays steady and never breathes).
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BoxGeometry, DoubleSide, MeshBasicMaterial, type Group } from 'three'
import { terrainSession, type TerrainSession } from '../store/useTerrain'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { SURVEY_HOLD_MS, useSurveyHold } from '../terrain/surveyHold'
import { GLOW_COLOUR, advanceGlow, glowFraction, glowLook, type GlowLook } from '../terrain/surveyGlow'
import { NO_BLOOM_BLEND } from './shardFaces'
import { edgeSegments, outlineLines, outlineMaterial, sizeOutline } from './hiddenParts'
import type { ChunkSlot } from '../lib/terrain/world'
import type { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'

/** A chunk's side, in blocks (h5: 32 by 32 by 32). */
export const CHUNK_SIDE = 32
/** How far outside the chunk the glow is drawn, in blocks, so it never fights the faces of the blocks on its border. */
const GLOW_PAD = 0.04
/** The edges' width and the glow's under them, in CSS pixels. */
const EDGE_PX = 2.5
const HALO_PX = 9

/** The chunk's box, made once for every glow. */
const GLOW_BOX = new BoxGeometry(CHUNK_SIDE + GLOW_PAD, CHUNK_SIDE + GLOW_PAD, CHUNK_SIDE + GLOW_PAD)
const GLOW_EDGES = edgeSegments(GLOW_BOX)

/** The glow's parts and materials, made once for a glow, moved and faded every frame. */
export function makeSurveyGlow(): { faces: MeshBasicMaterial; edges: LineMaterial; halo: LineMaterial; edgeLines: LineSegments2; haloLines: LineSegments2 } {
  const faces = new MeshBasicMaterial({
    color: GLOW_COLOUR, transparent: true, opacity: 0, depthTest: true, depthWrite: false, side: DoubleSide, forceSinglePass: true, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, ...NO_BLOOM_BLEND,
  })
  // Both sides: the field's frame can be mirrored (an axis running -1), which turns a screen-space line's quads round.
  const edges = Object.assign(outlineMaterial({ color: GLOW_COLOUR, opacity: 0, px: EDGE_PX }), NO_BLOOM_BLEND, { side: DoubleSide })
  const halo = Object.assign(outlineMaterial({ color: GLOW_COLOUR, opacity: 0, px: HALO_PX }), NO_BLOOM_BLEND, { side: DoubleSide })
  return { faces, edges, halo, edgeLines: outlineLines(GLOW_EDGES, edges), haloLines: outlineLines(GLOW_EDGES, halo) }
}

/** The last chunk looked up by key, so a frame does not walk the field's chunks again (a chunk keeps its place while held). */
const slotMemo: { s: TerrainSession | null; key: string | null; slot: ChunkSlot | null } = { s: null, key: null, slot: null }
function slotOf(s: TerrainSession, key: string): ChunkSlot | null {
  const m = slotMemo
  if (m.s !== s || m.key !== key || !m.slot) {
    m.s = s; m.key = key; m.slot = s.world.slotByKey(key)
  }
  return m.slot
}

/** Where the glow finds the field (the scene's own session; a test passes its own). */
export interface SurveyGlowProps {
  session?: () => TerrainSession | null
}

export function SurveyGlow({ session = () => terrainSession }: SurveyGlowProps): JSX.Element {
  const reduced = useReducedMotion()
  const calm = useRef(reduced)
  calm.current = reduced
  const group = useRef<Group>(null)
  const parts = useMemo(() => makeSurveyGlow(), [])
  useEffect(() => () => {
    parts.faces.dispose(); parts.edges.dispose(); parts.halo.dispose()
    parts.edgeLines.geometry.dispose(); parts.haloLines.geometry.dispose()
  }, [parts])
  const phase = useRef(0)
  const look = useRef<GlowLook>({ key: null, edge: 0, face: 0, halo: 0 })
  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const now = performance.now()
    const hold = useSurveyHold.getState()
    if (hold.since === null) phase.current = 0
    else phase.current = advanceGlow(phase.current, Math.min(delta, 0.1) * 1000, glowFraction(hold, now, SURVEY_HOLD_MS))
    const l = glowLook(look.current, hold, now, phase.current, calm.current)
    const s = session()
    const slot = l.key && s ? slotOf(s, l.key) : null
    if (!slot) { g.visible = false; return }
    g.position.set(CHUNK_SIDE * slot.off[0] + CHUNK_SIDE / 2, CHUNK_SIDE * slot.off[1] + CHUNK_SIDE / 2, CHUNK_SIDE * slot.off[2] + CHUNK_SIDE / 2)
    parts.faces.opacity = l.face
    parts.edges.opacity = l.edge
    parts.halo.opacity = l.halo
    sizeOutline(parts.edges, state.size)
    sizeOutline(parts.halo, state.size)
    g.visible = true
  })
  return (
    <group ref={group} name="terrain-survey-glow" visible={false}>
      <mesh geometry={GLOW_BOX} material={parts.faces} renderOrder={3} raycast={() => {}} />
      <primitive object={parts.haloLines} renderOrder={4} />
      <primitive object={parts.edgeLines} renderOrder={5} />
    </group>
  )
}
