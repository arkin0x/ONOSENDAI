/**
 * chunkWall.test.tsx - the glow wall at the edge of the chunk you stand in
 * (lib/terrain/chunkWall.ts the numbers, scene/ChunkWall.tsx the drawing):
 * nothing four steps from the edge, clear one step from it, smooth between;
 * one face per axis, so one on a face's middle, two at an edge and three at a
 * corner, each the nearer of its axis's two; only in TERRAIN, for a chunk
 * drawn for you or the one you stay in; solid while the lock is on; still
 * with reduced motion; one mesh made once, a frame writing uniforms only.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

;(globalThis as { window?: unknown }).window ??= globalThis
let reducedMotion = false
;(globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce') && reducedMotion, media: q, addEventListener: () => {}, removeEventListener: () => {} })

import { createElement } from 'react'
import type { BufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'
import { ChunkWall, WALL_FILL, WALL_FILL_LOCKED } from '../../scene/ChunkWall'
import { CHUNK_SIDE, WALL_FAR, WALL_NEAR, makeFaces, nearFaces, wallStrength } from '../../lib/terrain/chunkWall'
import { useTerrain, type TerrainSession } from '../../store/useTerrain'
import { useCyberspace } from '../../store/useCyberspace'
import { useChunkStay } from '../chunkStay'
import { resetStay, setLock } from '../stayLock'
import { chunkKey, chunkOf } from '../../lib/terrain/coords'
import type { Position } from '../../lib/space'

/** Where you are in the chunk, as the wall reads it: gibson n's middle is n + 0.5. */
const mid = (x: number, y: number, z: number): [number, number, number] => [x + 0.5, y + 0.5, z + 0.5]

describe('the wall\'s numbers', () => {
  it('nothing at four steps or more, clear at one, rising smoothly between', () => {
    expect(wallStrength(WALL_FAR)).toBe(0)
    expect(wallStrength(WALL_FAR + 3)).toBe(0)
    expect(wallStrength(WALL_NEAR)).toBe(1)
    expect(wallStrength(0.5)).toBe(1)
    const s2 = wallStrength(2), s3 = wallStrength(3)
    expect(s2).toBeGreaterThan(s3)
    expect(s3).toBeGreaterThan(0)
    expect(s2).toBeLessThan(1)
  })

  it('steps from crossing: the last gibson is one step, the one before two', () => {
    const f = makeFaces()
    nearFaces(mid(0, 16, 16), f)
    expect(f[0]).toMatchObject({ axis: 0, side: -1, steps: 1, strength: 1 })
    nearFaces(mid(31, 16, 16), f)
    expect(f[0]).toMatchObject({ side: 1, steps: 1, strength: 1 })
    nearFaces(mid(1, 16, 16), f)
    expect(f[0].steps).toBe(2)
    nearFaces(mid(3, 16, 16), f)
    expect(f[0].strength).toBe(0)
  })

  it('the middle of the chunk shows nothing; a face\'s middle one face; an edge two; a corner three', () => {
    const f = makeFaces()
    expect(nearFaces(mid(16, 16, 16), f)).toBe(0)
    expect(nearFaces(mid(16, 0, 16), f)).toBe(1)
    expect(f[1]).toMatchObject({ axis: 1, side: -1, strength: 1 })
    expect(nearFaces(mid(31, 16, 0), f)).toBe(2)
    expect([f[0].side, f[2].side]).toEqual([1, -1])
    expect(f[1].strength).toBe(0)
    expect(nearFaces(mid(0, 31, 31), f)).toBe(3)
    expect(f.map((x) => x.side)).toEqual([-1, 1, 1])
    // Near a corner but nearer one face than the others: each fades by its own distance.
    nearFaces(mid(0, 1, 2), f)
    expect(f[0].strength).toBeGreaterThan(f[1].strength)
    expect(f[1].strength).toBeGreaterThan(f[2].strength)
  })

  it('writes into the faces it is given: a frame makes nothing new', () => {
    const f = makeFaces()
    const first = f[0]
    nearFaces(mid(0, 0, 0), f)
    expect(f[0]).toBe(first)
  })
})

describe('the wall in the scene', () => {
  // The field's origin a chunk below and west of the chunk drawn, so the chunk's low corner is (32, 32, 0) in the frame.
  const origin = chunkOf((1n << 40n), (1n << 40n), (1n << 40n), 0)
  const base = { x: origin.x + 32n, y: origin.y + 32n, z: origin.z, plane: 0 }
  const KEY = chunkKey(base)
  let drawn = true
  const field = { plane: 0, world: { origin, slotByKey: (k: string) => (k === KEY ? { key: KEY, blocks: drawn ? new Uint8Array(1) : null } : null) } } as unknown as TerrainSession
  const cell = (x: number, y: number, z: number): Position => ({ x: base.x + BigInt(x), y: base.y + BigInt(y), z: base.z + BigInt(z) })
  let root: R3fRoot
  const wall = (): Mesh => root.state().scene.getObjectByName('terrain-chunk-wall') as Mesh
  const u = (): ShaderMaterial['uniforms'] => (wall().material as ShaderMaterial).uniforms
  const strengths = (): number[] => [...(u().uStrength.value as number[])]
  const stand = async (p: Position): Promise<void> => { useCyberspace.setState({ walking: true, position: p, cursor: p }); await root.frame() }

  beforeEach(async () => {
    drawn = true
    resetStay()
    useCyberspace.setState({ walking: true, plane: 0, position: cell(16, 16, 16), cursor: cell(16, 16, 16) })
    useTerrain.setState({ active: true })
    useChunkStay.setState({ here: KEY })
    root = await r3fRoot()
    await root.render(createElement(ChunkWall, { session: () => field }))
  })
  afterEach(async () => {
    await root?.unmount()
    reducedMotion = false
    resetStay()
    useChunkStay.setState({ here: null })
    useTerrain.setState({ active: false })
    useCyberspace.setState({ walking: false })
  })

  it('hidden in the chunk\'s middle; one step from a face it shows that face, clear, on the face\'s plane', async () => {
    await root.frame()
    expect(wall().visible).toBe(false)
    await stand(cell(0, 16, 16))
    expect(wall().visible).toBe(true)
    expect(strengths()).toEqual([1, 0, 0])
    const c = (u().uCentre.value as Vector3[])[0]
    // The low x face, in the field's frame: the chunk's low corner is x 32; the patch round your gibson's middle.
    expect(c.toArray()).toEqual([32, 32 + 16.5, 16.5])
  })

  it('at a corner, the three faces that meet there', async () => {
    await stand(cell(31, 0, 31))
    expect(strengths()).toEqual([1, 1, 1])
    const c = u().uCentre.value as Vector3[]
    expect(c[0].x).toBe(32 + CHUNK_SIDE)
    expect(c[1].y).toBe(32)
    expect(c[2].z).toBe(CHUNK_SIDE)
  })

  it('only for a chunk drawn for you, unless you stay in it; never out of TERRAIN', async () => {
    drawn = false
    // Asked again a few times a second: a fresh wall looks at once.
    await root.unmount()
    root = await r3fRoot()
    await root.render(createElement(ChunkWall, { session: () => field }))
    await stand(cell(0, 16, 16))
    expect(wall().visible).toBe(false)
    setLock(useCyberspace.getState().identity.pubkey || 'local', KEY)
    await root.frame()
    expect(wall().visible).toBe(true)
    useTerrain.setState({ active: false })
    await root.frame()
    expect(wall().visible).toBe(false)
  })

  it('solid while STAY IN THIS CHUNK is on, open otherwise', async () => {
    await stand(cell(0, 16, 16))
    expect(u().uFill.value).toBe(WALL_FILL)
    setLock(useCyberspace.getState().identity.pubkey || 'local', KEY)
    await root.frame()
    expect(u().uFill.value).toBe(WALL_FILL_LOCKED)
  })

  it('shimmers, but not with reduced motion', async () => {
    await stand(cell(0, 16, 16))
    expect(u().uShimmer.value).toBe(1)
    await root.unmount()
    reducedMotion = true
    root = await r3fRoot()
    await root.render(createElement(ChunkWall, { session: () => field }))
    await stand(cell(0, 16, 16))
    expect(u().uShimmer.value).toBe(0)
  })

  it('one mesh, made once: the same geometry, material and uniforms every frame', async () => {
    await stand(cell(0, 16, 16))
    const m = wall()
    const g = m.geometry as BufferGeometry, mat = m.material, centre = u().uCentre.value
    for (const p of [cell(31, 0, 31), cell(16, 16, 16), cell(0, 31, 0)]) await stand(p)
    expect(wall()).toBe(m)
    expect(wall().geometry).toBe(g)
    expect(wall().material).toBe(mat)
    expect(u().uCentre.value).toBe(centre)
    // Three quads in one geometry.
    expect(g.index!.count).toBe(18)
  })
})
