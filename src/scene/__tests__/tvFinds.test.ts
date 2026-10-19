/**
 * tvFinds.test.ts: a find fades only when it really stands between the
 * camera and the shot's avatar, by a raycast to the avatar's middle and four
 * points round it (review of #390: a bounding sphere put every floor and
 * room the avatar stood in "in the way"). In the plain three.js scene graph,
 * no renderer.
 */
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)) }, removeItem: (k: string) => { mem.delete(k) }, clear: () => mem.clear() }
}
vi.mock('../../lib/relay', () => ({ query: async () => [], queryEach: async () => [], queryAny: async () => [], publish: async () => ({ ok: true }), publishMany: async () => ({ ok: true }), relaySet: () => [] }))

import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, OneFactor, PlaneGeometry, Quaternion, Sphere, Vector3, ZeroFactor } from 'three'
import { COVERAGE_DIM, COVERING, REST, aimRays, look as lookFind, restingFor, shardInTheWay } from '../TvFinds'

/** A shard as the scene draws it: a group holding a mesh of faces. */
function shard(geometry: BoxGeometry | PlaneGeometry, at: [number, number, number], turn?: [number, number, number]): Group {
  const g = new Group()
  const m = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
  m.position.set(...at)
  if (turn) m.rotation.set(...turn)
  g.add(m)
  g.updateMatrixWorld(true)
  return g
}

// The camera 10 above and 10 back, looking at an avatar of radius 0.5 at the origin.
const eye = new Vector3(0, 10, 10)
const look = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(0, -10, -10).normalize())
const avatar = new Sphere(new Vector3(0, 0, 0), 0.5)

describe('a find in the way of the shot\'s avatar', () => {
  it('is a wall between the camera and the avatar', () => {
    expect(aimRays(eye, avatar, look)).toBe(true)
    expect(shardInTheWay(shard(new BoxGeometry(4, 4, 0.2), [0, 5, 5], [Math.PI / 4, 0, 0]))).toBe(true)
  })

  it('is not the floor the avatar stands on, however big', () => {
    aimRays(eye, avatar, look)
    expect(shardInTheWay(shard(new PlaneGeometry(200, 200), [0, -0.6, 0], [-Math.PI / 2, 0, 0]))).toBe(false)
  })

  it('is not a room around the avatar whose wall is behind it, nor anything off to the side', () => {
    aimRays(eye, avatar, look)
    expect(shardInTheWay(shard(new PlaneGeometry(40, 40), [0, 0, -5]))).toBe(false)
    expect(shardInTheWay(shard(new BoxGeometry(2, 2, 2), [8, 5, 5]))).toBe(false)
  })

  it('catches something covering only part of the avatar, through the rays round its middle', () => {
    aimRays(eye, avatar, look)
    // A post beside the line of sight, over the avatar's right edge.
    expect(shardInTheWay(shard(new BoxGeometry(0.2, 0.2, 0.2), [0.35, 2, 2]))).toBe(true)
  })
})

describe('how a find looks', () => {
  it('at rest writes depth and draws in its own order; faded it writes none and draws after', () => {
    const g = shard(new BoxGeometry(1, 1, 1), [0, 0, 0])
    const mesh = g.children[0] as Mesh
    const m = mesh.material as MeshBasicMaterial
    lookFind(g, REST, REST)
    expect(m.depthWrite).toBe(true)
    expect(mesh.renderOrder).toBe(0)
    expect(m.color.r).toBeCloseTo(REST)
    lookFind(g, COVERING, REST)
    expect(m.depthWrite).toBe(false)
    expect(mesh.renderOrder).toBe(1)
    expect(m.opacity).toBeCloseTo(COVERING / REST)
    lookFind(g, REST, REST)
    expect(m.depthWrite).toBe(true)
    expect(mesh.renderOrder).toBe(0)
    // Never lit into the bloom: the alpha already there is kept.
    expect(m.blendSrcAlpha).toBe(ZeroFactor)
    expect(m.blendDstAlpha).toBe(OneFactor)
  })

  it('dims a large find by how much of the screen it fills, when that is on (off until ruled)', () => {
    expect(COVERAGE_DIM).toBe(false)
    expect(restingFor(0.1)).toBeCloseTo(REST)
    expect(restingFor(0.25)).toBeCloseTo(REST)
    expect(restingFor(0.75)).toBeCloseTo(REST * 0.5)
    expect(restingFor(1)).toBeCloseTo(0.24)
    expect(restingFor(3)).toBeCloseTo(0.24)
  })
})

