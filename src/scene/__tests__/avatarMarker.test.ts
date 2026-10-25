/**
 * avatarMarker.test.ts - your own marker, drawn with no depth test so you can
 * always find yourself, draws after every shard face; drawn opaque it drew
 * before them, and a floor behind it painted over it (arkinox, 2026-10-24:
 * "glitch - default avatar is clipped by shards"). Put through three's own
 * render list, the one WebGLRenderer sorts and draws, opaque list first.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BoxGeometry, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, Scene, type Material, type MeshBasicMaterialParameters, type Object3D } from 'three'
import { WebGLRenderLists } from 'three/src/renderers/webgl/WebGLRenderLists.js'
import { markerMaterialProps } from '../avatarMarker'
import { OVERLAY_ORDER, basicFaceProps } from '../shardFaces'

/** The order three draws `items` in: its opaque list, then its transmissive, then its transparent, each sorted. */
function drawOrder(items: Array<{ object: Object3D; material: Material; z: number }>): Object3D[] {
  // r169's constructor takes nothing; @types/three still lists a WebGLProperties it no longer reads.
  const list = new WebGLRenderLists(undefined as never).get(new Scene(), 0)
  list.init()
  for (const { object, material, z } of items) list.push(object, (object as Mesh).geometry, material, 0, z, null)
  list.sort(null as never, null as never)
  return [...list.opaque, ...list.transmissive, ...list.transparent].map((r) => r.object)
}

/** An opaque shard face in the world (ShardMesh), at render order 0, as the floor is. */
function floor(): { object: Object3D; material: Material } {
  const material = new MeshBasicMaterial(basicFaceProps(1, { ghost: false, world: true }) as MeshBasicMaterialParameters)
  const object = new Mesh(new BoxGeometry(), material)
  object.renderOrder = 0
  return { object, material }
}

/** Your own marker as Avatar.tsx draws it: render order 9.5, no depth test. */
function ownMarker(props = markerMaterialProps({ depthTest: false })): { object: Object3D; material: Material } {
  const material = new LineBasicMaterial(props)
  const object = new LineSegments(new BoxGeometry(), material)
  object.renderOrder = 9.5
  return { object, material }
}

describe('your own marker against a shard', () => {
  it('is drawn after an opaque shard face, nearer or further', () => {
    for (const [markerZ, floorZ] of [[1, 5], [5, 1]]) {
      const m = ownMarker(), f = floor()
      const order = drawOrder([{ ...m, z: markerZ }, { ...f, z: floorZ }])
      expect(order.indexOf(m.object)).toBeGreaterThan(order.indexOf(f.object))
    }
  })

  it('was drawn before it while opaque, which is what let the floor paint over it', () => {
    const m = ownMarker({ depthTest: false }), f = floor()
    const order = drawOrder([{ ...m, z: 1 }, { ...f, z: 5 }])
    expect(order.indexOf(m.object)).toBeLessThan(order.indexOf(f.object))
  })

  it('writes the colour it did opaque: transparent at full opacity, still no depth test', () => {
    expect(markerMaterialProps({ depthTest: false })).toEqual({ depthTest: false, transparent: true, opacity: 1 })
  })

  it('draws after the translucent overlays drawn over shards too', () => {
    const m = ownMarker(), f = floor()
    const fill = new MeshBasicMaterial({ transparent: true, opacity: 0.2, depthWrite: false })
    const overlay = new Mesh(new BoxGeometry(), fill)
    overlay.renderOrder = OVERLAY_ORDER
    const order = drawOrder([{ ...m, z: 3 }, { ...f, z: 5 }, { object: overlay, material: fill, z: 1 }])
    expect(order.at(-1)).toBe(m.object)
  })

  it('is the marker Avatar.tsx draws: render order 9.5, no depth test', () => {
    const src = readFileSync(new URL('../Avatar.tsx', import.meta.url), 'utf8')
    expect(src).toMatch(/<AvatarShape [^>]*renderOrder=\{9\.5\} depthTest=\{false\} firstPerson=\{walking\} \/>/)
  })
})

describe('anyone else\'s marker, and the outline', () => {
  it('stays opaque and depth tested: depth decides who is in front', () => {
    expect(markerMaterialProps({})).toEqual({ depthTest: true })
    expect(markerMaterialProps({ depthTest: true })).toEqual({ depthTest: true })
  })

  it('keeps the outline faint and see-through', () => {
    expect(markerMaterialProps({ depthTest: false, outline: true })).toEqual({ depthTest: false, transparent: true, opacity: 0.3 })
  })
})
