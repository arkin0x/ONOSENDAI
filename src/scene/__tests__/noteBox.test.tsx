/**
 * noteBox.test.tsx: a message's box is one gibson on a side, always, while it
 * is drawn (owner, 2026-11-22: "I dont like that the message boxes don't
 * change size as you get closer or farther. I want a message box to be 1
 * gibson cubed, always, while it is normally visible"), and nothing that
 * cannot be seen hides it ("why is this message box being partially hidden?
 * It's being occluded by something invisible").
 *
 * What hid it was the ground. The box was held to a size on screen, so from
 * a little way off it was larger than its gibson and its bottom reached
 * under the landscape tile it stood on: the tile wrote depth as it should,
 * and with one flat colour there, the box's bottom edges vanished with no
 * edge to show where (a LOCAL capture with the tile alone hidden showed the
 * whole box, and the same capture with a 0% floor and a 0% wall laid through
 * the box was the same to the pixel). One gibson keeps the box in its own
 * place, and its edges are drawn a hair toward the camera so a box resting on
 * a floor keeps its bottom edges.
 *
 * Run in a real R3F root (test/r3fRoot.ts): real three objects, frames and
 * camera, so the size is measured in the world, as drawn.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { Box3, Vector3, type Camera, type LineSegments, type Material, type Mesh, type Object3D, type PerspectiveCamera } from 'three'
import { newShard, type ShardModel } from 'sno-core/shards'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'

// Words are troika's, which fetches a font: a plain group stands in, so the label's own frame still runs.
vi.mock('@react-three/drei', async () => {
  const { createElement: h, forwardRef } = await import('react')
  return { Text: forwardRef((_props, ref) => h('group', { name: 'text', ref })) }
})

import { NoteItem, noteBoxSide, NOTE_BOX_GIBSONS, NOTE_DEPTH_PULL } from '../WorldMessages'
import { ShardMesh } from '../ShardMesh'
import { useCyberspace } from '../../store/useCyberspace'
import { labelLiftPx, projScaleOf } from '../../lib/markerSize'

;(globalThis as { window?: unknown }).window ??= globalThis

let r: R3fRoot | null = null
afterEach(async () => {
  await r?.unmount()
  r = null
})

const NOTE = { key: 'n1', text: 'hello', mine: true, author: '', centre: [0, 0, 0] as [number, number, number] }

/** Every object three would draw: it and every parent visible, with a material. */
function drawn(scene: Object3D): Array<Object3D & { material: Material | Material[] }> {
  const out: Array<Object3D & { material: Material | Material[] }> = []
  scene.traverse((o) => {
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return
    if ((o as { material?: unknown }).material) out.push(o as Object3D & { material: Material | Material[] })
  })
  return out
}

/** The box's edges: the one line drawing under the message. */
function boxEdges(scene: Object3D): LineSegments {
  const lines = drawn(scene).filter((o) => o.type === 'LineSegments') as unknown as LineSegments[]
  expect(lines).toHaveLength(1)
  return lines[0]
}

/** The box's edge in the world, measured from its drawn geometry (float32 vertices: to a millionth). */
function worldEdge(edges: LineSegments): number {
  edges.updateWorldMatrix(true, false)
  const size = new Box3().setFromObject(edges).getSize(new Vector3())
  expect(size.x).toBeCloseTo(size.y, 9)
  expect(size.y).toBeCloseTo(size.z, 9)
  return size.x
}

async function placeCamera(root: R3fRoot, at: [number, number, number]): Promise<Camera> {
  const camera = root.state().camera
  camera.position.set(...at)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()
  await root.frame()
  return camera
}

describe('a message’s box', () => {
  it('is one gibson in scene units at every scale: a scene unit is 2^scaleExp gibsons', () => {
    expect(NOTE_BOX_GIBSONS).toBe(1)
    for (const scaleExp of [0, 1, 2, 5, 10]) expect(noteBoxSide(scaleExp) * 2 ** scaleExp).toBe(1)
    expect(noteBoxSide(0)).toBe(1)
    expect(noteBoxSide(1)).toBe(0.5)
  })

  it('is drawn one gibson across in the world at 2^0 and 2^1, near or far: it grows as you come close and shrinks as you go', async () => {
    for (const scaleExp of [0, 1]) {
      useCyberspace.setState({ scaleExp })
      r = await r3fRoot()
      await r.render(createElement(NoteItem, { w: NOTE, birth: undefined, onTap: () => undefined }))
      const edges = boxEdges(r.state().scene)
      const widths: number[] = []
      for (const eye of [[0, 0, 3], [4, 3, 12], [0, 20, 60], [-50, 10, 150]] as Array<[number, number, number]>) {
        const camera = await placeCamera(r, eye) as PerspectiveCamera
        expect(worldEdge(edges)).toBeCloseTo(noteBoxSide(scaleExp), 6)
        // Its size on screen is the world's: a gibson over the distance.
        const depth = camera.position.length()
        widths.push(projScaleOf(r.state().size.height, camera.fov) * noteBoxSide(scaleExp) / depth)
      }
      // Nearer is larger on screen, farther is smaller.
      for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1])
      await r.unmount()
      r = null
    }
  })

  it('follows the scale as it changes, still one gibson', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(createElement(NoteItem, { w: NOTE, birth: undefined, onTap: () => undefined }))
    await placeCamera(r, [0, 2, 10])
    expect(worldEdge(boxEdges(r.state().scene))).toBeCloseTo(1, 6)
    useCyberspace.setState({ scaleExp: 1 })
    await r.render(createElement(NoteItem, { w: NOTE, birth: undefined, onTap: () => undefined }))
    await r.frame()
    expect(worldEdge(boxEdges(r.state().scene))).toBeCloseTo(0.5, 6)
  })

  it('draws as light that hides nothing: see-through, writing no depth', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(createElement(NoteItem, { w: NOTE, birth: undefined, onTap: () => undefined }))
    const m = boxEdges(r.state().scene).material as Material
    expect(m.transparent).toBe(true)
    expect(m.depthWrite).toBe(false)
    expect(m.depthTest).toBe(true)
  })

  it('pulls its edges a hair toward the camera along each sight line, so they keep their place on screen and win over a floor they rest on', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(createElement(NoteItem, { w: NOTE, birth: undefined, onTap: () => undefined }))
    const m = boxEdges(r.state().scene).material as Material & { onBeforeCompile: (s: { vertexShader: string }) => void; customProgramCacheKey: () => string }
    const shader = { vertexShader: '#include <common>\nvoid main() {\n#include <project_vertex>\n}' }
    m.onBeforeCompile(shader as never)
    // After three's own projection, the view-space point scaled toward the eye: the same x and y on screen, a nearer depth.
    expect(shader.vertexShader).toMatch(/#include <project_vertex>\s*gl_Position = projectionMatrix \* vec4\( mvPosition\.xyz \* \( 1\.0 - [0-9.e-]+ \), mvPosition\.w \);/)
    expect(m.customProgramCacheKey()).toContain('note-depth-pull')
    expect(NOTE_DEPTH_PULL).toBeGreaterThan(0)
    expect(NOTE_DEPTH_PULL).toBeLessThanOrEqual(0.002)
  })

  it('carries the name under the box, clear of it at any size on screen', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(createElement(NoteItem, { w: NOTE, birth: undefined, onTap: () => undefined }))
    const scene = r.state().scene
    for (const eye of [[0, 0, 2.5], [0, 0, 8], [0, 0, 40]] as Array<[number, number, number]>) {
      const camera = await placeCamera(r, eye) as PerspectiveCamera
      // The label: the group holding the stand-in text, inside its facing and lifting groups.
      let text: Object3D | undefined
      scene.traverse((o) => { if (o.name === 'text') text = o })
      const inner = text!.parent!
      const label = inner.parent!.parent!
      const unitPx = label.scale.x * projScaleOf(r.state().size.height, camera.fov) / eye[2]
      const dropPx = -inner.position.y * unitPx
      // Below the box's reach on screen (its half diagonal), plus a gap.
      const want = labelLiftPx(noteBoxSide(0), 0, eye[2], projScaleOf(r.state().size.height, camera.fov), unitPx)
      expect(inner.position.y).toBeLessThan(0)
      expect(dropPx).toBeCloseTo(want, 6)
    }
  })

  it('takes a tap anywhere over the box once it is larger than a fingertip', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    const tapped = vi.fn()
    r = await r3fRoot()
    await r.render(createElement(NoteItem, { w: NOTE, birth: undefined, onTap: tapped }))
    // Close: the box is about 300 px across on this 800 px canvas; a tap near its corner, far outside 44 px, opens it.
    await placeCamera(r, [0, 0, 3])
    await r.tap(400 + 120, 400 - 120)
    expect(tapped).toHaveBeenCalledTimes(1)
    // Far: the box is a few pixels; the fingertip target still takes a tap just off it.
    await placeCamera(r, [0, 0, 200])
    await r.tap(400 + 15, 400)
    expect(tapped).toHaveBeenCalledTimes(2)
  })
})

describe('what cannot be seen hides nothing', () => {
  /** A slab of floor, two triangles, at the given opacity, walled for WALK. */
  function floor(opacity?: number): ShardModel {
    return {
      ...newShard('floor'), unit: 0, mode: 'solid',
      vertices: [{ p: [-2, 0, -2], c: [0.3, 0.6, 0.3] }, { p: [2, 0, -2], c: [0.3, 0.6, 0.3] }, { p: [2, 0, 2], c: [0.3, 0.6, 0.3] }, { p: [-2, 0, 2], c: [0.3, 0.6, 0.3] }],
      faces: [[0, 1, 2], [0, 2, 3]],
      ...(opacity === undefined ? {} : { opacity }),
      extra: { constrain: 'all' },
    } as ShardModel
  }

  it('a 0% object (an invisible wall: 0% and constrain) draws nothing that writes depth or colour; its tap copy is never drawn', async () => {
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: floor(0), world: true }))
    await r.frame()
    const scene = r.state().scene
    expect(drawn(scene)).toEqual([])
    // It is still there for a tap or a pick: a copy that three never draws, and could draw nothing if it did.
    const hit: Mesh[] = []
    scene.traverse((o) => { if (o.name === 'shard-hit') hit.push(o as Mesh) })
    expect(hit).toHaveLength(1)
    expect(hit[0].visible).toBe(false)
    const hm = hit[0].material as Material
    expect(hm.colorWrite).toBe(false)
    expect(hm.depthWrite).toBe(false)
  })

  it('the same floor seen draws its faces and writes depth, as an opaque face must; see-through, it writes none', async () => {
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: floor(), world: true }))
    await r.frame()
    const faces = drawn(r.state().scene).filter((o) => o.name === 'shard-faces')
    expect(faces).toHaveLength(1)
    expect((faces[0].material as Material).depthWrite).toBe(true)
    await r.unmount()
    r = await r3fRoot()
    await r.render(createElement(ShardMesh, { shard: floor(40), world: true }))
    await r.frame()
    for (const o of drawn(r.state().scene)) for (const m of ([] as Material[]).concat(o.material)) expect(m.depthWrite).toBe(false)
  })

  it('among a 0% floor and a message, the only thing drawn is the message, and it writes no depth', async () => {
    useCyberspace.setState({ scaleExp: 0 })
    r = await r3fRoot()
    await r.render(createElement('group', null,
      createElement(ShardMesh, { shard: floor(0), world: true }),
      createElement(NoteItem, { w: NOTE, birth: undefined, onTap: () => undefined }),
    ))
    await placeCamera(r, [0, 3, 10])
    const all = drawn(r.state().scene)
    // The box's edges and the name's stand-in groups have no material; the box is all that draws.
    expect(all.map((o) => o.type)).toEqual(['LineSegments'])
    for (const o of all) for (const m of ([] as Material[]).concat(o.material)) {
      expect(m.depthWrite).toBe(false)
      expect(m.colorWrite).not.toBe(false)
    }
  })
})
