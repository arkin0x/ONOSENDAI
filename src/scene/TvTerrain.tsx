/**
 * TvTerrain.tsx: TERRAIN's blocks on Cyberspace TV, round the avatar of a
 * TERRAIN shot, as of the tape's time (store/useTvTerrain.ts works out
 * which chunks and makes their meshes; lib/tv/terrainReader.ts reads them).
 *
 * Up to 27 chunks, each one or two meshes (solid, then see-through) placed
 * from its own corner as the viewer's field places its chunks
 * (TerrainLayer originMatrix: against the anchor the scene was committed
 * with, at the zoom), placed again only when the anchor, the zoom or the
 * axes change. A material of TV's own, so what TV does to its blocks (the
 * cutaway to come, scene/tvTerrainCamera.ts) never touches the viewer's
 * field. Block shading on the site's /tv as your own field has it (each
 * chunk's light a texture on materials of its own, store/useTvTerrain.ts
 * tvLighting); none on the stream, where every chunk draws fully lit and
 * no light is worked out. Your own field (TerrainLayer) is not drawn
 * during TV.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Group, InterleavedBuffer, InterleavedBufferAttribute, Mesh, type Data3DTexture, type ShaderMaterial } from 'three'
import { tvLighting, useTvTerrain, type DrawnChunk } from '../store/useTvTerrain'
import { useCyberspace } from '../store/useCyberspace'
import { useLayers } from '../store/useLayers'
import { lightTexture, makeTerrainMaterial } from '../terrain/terrainMaterial'
import { FLOATS_PER_VERTEX } from '../lib/terrain/mesh'
import { MAX_SCALE, drawnAnchor, drawnScale, originMatrix } from './TerrainLayer'
import type { ViewAxes } from '../lib/space'

interface Built { chunk: DrawnChunk; meshes: Mesh[]; lit: { tex: Data3DTexture; material: ShaderMaterial; clearMaterial: ShaderMaterial } | null }

function drop(b: Built, g: Group): void {
  for (const m of b.meshes) { g.remove(m); m.geometry.dispose() }
  if (b.lit) { b.lit.tex.dispose(); b.lit.material.dispose(); b.lit.clearMaterial.dispose() }
}

export function TvTerrain({ axes }: { axes: ViewAxes }): JSX.Element {
  const group = useRef<Group>(null)
  const made = useMemo(() => makeTerrainMaterial(), [])
  /** What is in the scene, by chunk key. */
  const built = useRef(new Map<string, Built>())
  const placedFor = useRef('')
  const drawnWas = useRef<DrawnChunk[] | null>(null)

  useEffect(() => () => {
    for (const b of built.current.values()) {
      for (const m of b.meshes) m.geometry.dispose()
      if (b.lit) { b.lit.tex.dispose(); b.lit.material.dispose(); b.lit.clearMaterial.dispose() }
    }
    built.current.clear()
    made.dispose()
  }, [made])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const drawn = useTvTerrain.getState().drawn
    const zoom = drawnScale()
    const plane = useCyberspace.getState().anchorPlane
    // The chunks in and out: a chunk whose mesh changed is built again.
    let added = false
    if (drawn !== drawnWas.current) {
      drawnWas.current = drawn
      const want = new Map(drawn.map((d) => [d.key, d]))
      for (const [key, b] of built.current) {
        const w = want.get(key)
        if (w && w.meshKey === b.chunk.meshKey && w.lightKey === b.chunk.lightKey) continue
        drop(b, g)
        built.current.delete(key)
      }
      for (const d of drawn) {
        if (built.current.has(d.key)) continue
        const lit = d.light ? (() => { const tex = lightTexture(d.light); return { tex, ...made.forChunk(tex) } })() : null
        built.current.set(d.key, { chunk: d, meshes: buildMeshes(d, lit ?? made, g), lit })
        added = true
      }
    }
    g.visible = built.current.size > 0 && zoom <= MAX_SCALE
    if (!g.visible) return
    const layers = useLayers.getState()
    // Lit on the site by your Block shading; never on the stream (tvLighting).
    const shading = tvLighting()
    made.setView(2 ** -zoom, layers.glow, shading, false)
    const a = drawnAnchor()
    const place = `${a.x},${a.y},${a.z}|${zoom}|${axes.right.axis}${axes.right.dir}${axes.up.axis}${axes.up.dir}${axes.out.axis}${axes.out.dir}`
    const placeKey = `${place}|${shading}`
    if (placeKey === placedFor.current && !added) return
    placedFor.current = placeKey
    for (const b of built.current.values()) {
      // A chunk with no light of its own is not drawn while shading is on (as the field holds one back until its light comes).
      const inPlane = b.chunk.base.plane === plane && (!shading || b.lit !== null)
      for (const m of b.meshes) {
        m.visible = inPlane
        originMatrix(b.chunk.base, axes, zoom, m.matrix)
        m.matrixWorldNeedsUpdate = true
      }
    }
  })

  return <group ref={group} name="tv-terrain" />
}

/** A chunk's meshes from its greedy mesh: the solid blocks, then the see-through ones drawn after them. */
function buildMeshes(d: DrawnChunk, made: { material: ShaderMaterial; clearMaterial: ShaderMaterial }, g: Group): Mesh[] {
  const out: Mesh[] = []
  const m = d.mesh
  for (const [vertices, indices, material, order] of [[m.vertices, m.indices, made.material, 0], [m.clearVertices, m.clearIndices, made.clearMaterial, 1]] as const) {
    if (indices.length === 0) continue
    const geo = new BufferGeometry()
    const ib = new InterleavedBuffer(vertices, FLOATS_PER_VERTEX)
    geo.setAttribute('position', new InterleavedBufferAttribute(ib, 3, 0))
    geo.setAttribute('tile', new InterleavedBufferAttribute(ib, 1, 3))
    geo.setAttribute('face', new InterleavedBufferAttribute(ib, 1, 4))
    geo.setIndex(new BufferAttribute(indices, 1))
    geo.computeBoundingSphere()
    const mesh = new Mesh(geo, material)
    mesh.matrixAutoUpdate = false
    mesh.renderOrder = order
    mesh.name = `tv-terrain-${d.key}${order ? '-clear' : ''}`
    g.add(mesh)
    out.push(mesh)
  }
  return out
}
