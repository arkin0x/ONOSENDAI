/**
 * occlusion.test.ts - the game camera never loses you behind a wall
 * (game/occlusion.ts; arkinox, 2026-11-23). Real three meshes, no canvas:
 * a wall between the camera and you fades and one beside you does not; the
 * fade comes back once it no longer blocks; only the part in the way is cut,
 * never the floor; the camera is pulled in above the floor rather than
 * under it; the shader patch lands once per material and never again per
 * frame; and a faded wall still stops you, since collision is the game's.
 */

import { describe, expect, it } from 'vitest'
import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshLambertMaterial,
  PlaneGeometry, BoxGeometry, InstancedBufferGeometry, ShaderLib, Vector3, type Material,
} from 'three'
import { fromPayload, type ShardModel } from 'sno-core/shards'
import {
  ARM_MARGIN, ARM_MIN, CUT_END, FADE_KEEP, FADE_MS, FEET_CLEAR, HOLD_MS, OcclusionFade, RECOMPUTE_MS,
  armShare, cutShare, patchOcclusionFade,
} from '../occlusion'
import { createDiscMaterial, SHARD_POINTS } from '../../scene/pointDisc'
import { shardGeometry } from '../../scene/ShardMesh'
import { placeShard } from '../../scene/WorldShards'
import { stepIn, type WorldShard } from '../../lib/games/play'
import { itemCentre, type Position, type ViewAxes } from '../../lib/space'
import type { GameDef } from '../../lib/games/types'

/** A solid box drawn as a shard's lit faces are: Lambert, here both sides in one mesh. */
function slab(at: [number, number, number], size: [number, number, number]): Group {
  const g = new Group()
  g.add(new Mesh(new BoxGeometry(...size), new MeshLambertMaterial({ side: DoubleSide })))
  g.position.set(...at)
  g.updateMatrixWorld(true)
  return g
}

/** A flat floor at height `y`, 16 across, as a dungeon cell's floor face. */
function floor(y: number): Group {
  const g = new Group()
  const m = new Mesh(new PlaneGeometry(16, 16), new MeshLambertMaterial({ side: DoubleSide }))
  m.rotation.x = -Math.PI / 2
  g.add(m)
  g.position.set(0, y, 0)
  g.updateMatrixWorld(true)
  return g
}

/** Runs `frames` frames of `ms` each from `t0`, the camera at `eye` (drifting a hair each frame with `drift`); the time after. */
function run(f: OcclusionFade, eye: Vector3, me: Vector3, t0: number, frames: number, ms = 16, drift = false): number {
  const at = eye.clone()
  let t = t0
  for (let i = 0; i < frames; i++) {
    t += ms
    if (drift) at.x = eye.x + (i % 2 ? 0.01 : -0.01)
    f.frame(at, me, me, at, t, ms)
  }
  return t
}

// You at the origin, the camera 3.2 behind you along +Z; a wall between (z 1.5), one off to the side, the floor under you.
const me = new Vector3(0, 0, 0)
const behind = new Vector3(0, 0.5, 3.2)

describe('a wall between the camera and you fades; one beside you does not', () => {
  it('fades the blocker in over FADE_MS and leaves the others solid', () => {
    const f = new OcclusionFade()
    f.register('between', slab([0, 0, 1.6], [4, 3, 0.5]))
    f.register('beside', slab([5, 0, 0], [0.5, 3, 4]))
    f.register('floor', floor(-1))
    run(f, behind, me, 1000, 1)
    expect([...f.faded]).toEqual(['between'])
    const t = run(f, behind, me, 1016, Math.ceil(FADE_MS / 16) + 2)
    expect(f.levelOf('between')).toBe(1)
    expect(f.levelOf('beside')).toBe(0)
    expect(f.levelOf('floor')).toBe(0)
    expect(t).toBeGreaterThan(0)
  })

  it('comes back once it no longer blocks, after its hold, eased over FADE_MS', () => {
    const f = new OcclusionFade()
    f.register('between', slab([0, 0, 1.6], [4, 3, 0.5]))
    // The camera drifting as a player's does, so it is looked at again and again while it blocks.
    let t = run(f, behind, me, 1000, 20, 16, true)
    expect(f.levelOf('between')).toBe(1)
    // The camera swings round to your other side: nothing in the way now.
    const clear = new Vector3(0, 0.5, -3.2)
    t = run(f, clear, me, t, 2)
    // Held a moment (no flicker on an edge), then easing back.
    expect(f.levelOf('between')).toBe(1)
    t = run(f, clear, me, t, Math.ceil((HOLD_MS + RECOMPUTE_MS) / 16) + 2)
    const mid = f.levelOf('between')
    expect(mid).toBeLessThan(1)
    t = run(f, clear, me, t, Math.ceil(FADE_MS / 16) + 2)
    expect(f.levelOf('between')).toBe(0)
    expect(f.faded.size).toBe(0)
  })
})

describe('only the part in the way is cut (the shader, term for term)', () => {
  const eye = behind
  const end = eye.distanceTo(me) - CUT_END

  it('cuts the wall on the line of sight, to all but FADE_KEEP of its pixels', () => {
    const onWall = new Vector3(0, 0.25, 1.6)
    expect(cutShare(onWall, eye, me, end, me.y - FEET_CLEAR, 1)).toBeCloseTo(1 - FADE_KEEP, 2)
  })

  it('never cuts the floor you stand on, nor anything beyond you, nor far off the line', () => {
    const floorBetween = new Vector3(0, -1, 1)
    expect(cutShare(floorBetween, eye, me, end, me.y - FEET_CLEAR, 1)).toBe(0)
    const beyond = new Vector3(0, 0, -1)
    expect(cutShare(beyond, eye, me, end, me.y - FEET_CLEAR, 1)).toBe(0)
    const offLine = new Vector3(3, 0.25, 1.6)
    expect(cutShare(offLine, eye, me, end, me.y - FEET_CLEAR, 1)).toBe(0)
  })

  it('cuts nothing at level 0, and in proportion while it eases', () => {
    const onWall = new Vector3(0, 0.25, 1.6)
    expect(cutShare(onWall, eye, me, end, me.y - FEET_CLEAR, 0)).toBe(0)
    expect(cutShare(onWall, eye, me, end, me.y - FEET_CLEAR, 0.5)).toBeCloseTo((1 - FADE_KEEP) / 2, 2)
  })
})

describe('the shader patch', () => {
  const shared = new OcclusionFade().shared

  it('patches three\'s Lambert faces and the point discs, once', () => {
    const lambert = { vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader, uniforms: {} as Record<string, { value: unknown }> }
    const level = { value: 0 }
    expect(patchOcclusionFade(lambert, shared, level)).toBe(true)
    expect(lambert.fragmentShader).toContain('discard')
    expect(lambert.vertexShader).toContain('vGfWorld = (modelMatrix')
    expect(lambert.uniforms.uGfLevel).toBe(level)
    expect(lambert.uniforms.uGfEye).toBe(shared.uGfEye)
    const once = lambert.fragmentShader
    expect(patchOcclusionFade(lambert, shared, level)).toBe(true)
    expect(lambert.fragmentShader).toBe(once)
    const disc = createDiscMaterial(SHARD_POINTS, 1)
    const d = { vertexShader: disc.vertexShader, fragmentShader: disc.fragmentShader, uniforms: { ...disc.uniforms } as Record<string, { value: unknown }> }
    expect(patchOcclusionFade(d, shared, level)).toBe(true)
    expect(d.fragmentShader).toContain('discard')
  })

  it('is set on a shard\'s faces when it registers, never on its lines, and not again frame after frame', () => {
    const f = new OcclusionFade()
    const g = slab([0, 0, 1.6], [4, 3, 0.5])
    const lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial())
    g.add(lines)
    g.updateMatrixWorld(true)
    f.register('between', g)
    const face = (g.children[0] as Mesh).material as Material
    expect(face.userData.gameFade).toBeDefined()
    expect(face.customProgramCacheKey()).toBe('game-occlusion-fade-1')
    expect((lines.material as Material).userData.gameFade).toBeUndefined()
    const version = face.version
    run(f, behind, me, 1000, 30)
    expect((g.children[0] as Mesh).material).toBe(face)
    expect(face.version).toBe(version)
  })
})

describe('each shard\'s fade reaches its own materials', () => {
  it('the compile hook binds the shard\'s own level, and a shard registered again keeps it', () => {
    const f = new OcclusionFade()
    const g = slab([0, 0, 1.6], [4, 3, 0.5])
    const off = f.register('between', g)
    const face = (g.children[0] as Mesh).material as Material
    const shader = { vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader, uniforms: {} as Record<string, { value: unknown }> }
    face.onBeforeCompile(shader as never, null as never)
    const level = shader.uniforms.uGfLevel as { value: number }
    expect(level).toBeDefined()
    run(f, behind, me, 1000, 30)
    expect(level.value).toBe(1)
    // Unmounted and mounted again (a remount, a hot reload): the patched material still reads the same level, which still fades.
    off()
    f.register('between', g)
    run(f, behind, me, 2000, 2)
    expect(level.value).toBe(f.levelOf('between'))
    expect(level.value).toBeGreaterThan(0)
  })

  it('leaves billboards (glow halos, point cores) unpatched', () => {
    const f = new OcclusionFade()
    const g = slab([0, 0, 1.6], [4, 3, 0.5])
    const halo = new Mesh(new InstancedBufferGeometry(), createDiscMaterial(SHARD_POINTS, 1))
    g.add(halo)
    f.register('between', g)
    expect((halo.material as Material).userData.gameFade).toBeUndefined()
  })
})

describe('the camera is pulled in above the floor, never under it', () => {
  it('stops at the nearest crossing below your feet; faces above them are left to the fade', () => {
    expect(armShare([0.4, 0.7], [-0.2, -1.5], 2, -0.75)).toBe(0.7)
    expect(armShare([0.4], [0.1], 1, -0.75)).toBe(1)
    expect(armShare([], [], 0, -0.75)).toBe(1)
  })

  it('shortens an arm that dips under the floor to just above it, and leaves one through a wall whole', () => {
    const f = new OcclusionFade()
    f.register('floor', floor(-1))
    f.register('wall', slab([0, 0, 1.6], [4, 3, 0.5]))
    // Pitched down: the arm from you goes 3.2 down and back, through the floor at y -1.
    const down = new Vector3(0, -2.4, 2.1)
    const len = me.distanceTo(down)
    const share = f.armFor(me, down, me.y - FEET_CLEAR)
    const crossing = 1 / 2.4
    expect(share).toBeCloseTo(Math.max(ARM_MIN, crossing * len - ARM_MARGIN) / len, 5)
    // Level, through the wall: whole, the wall fades instead.
    expect(f.armFor(me, behind, me.y - FEET_CLEAR)).toBe(1)
  })
})

describe('a faded wall still stops you', () => {
  const AXES: ViewAxes = { right: { axis: 'x', dir: 1 }, up: { axis: 'y', dir: 1 }, out: { axis: 'z', dir: -1 } }
  const base = { x: 1n << 20n, y: 1n << 20n, z: 1n << 20n }
  const game: Pick<GameDef, 'region' | 'pads'> = { region: { base, height: 6, plane: 1 }, pads: [] }
  const P = (x: number, y: number, z: number): Position => ({ x: base.x + BigInt(x), y: base.y + BigInt(y), z: base.z + BigInt(z) })

  /** A closed box from lo to hi (whole gibsons), wound outward: a wall the game's collision holds at. */
  function box(lo: number[], hi: number[]): ShardModel {
    const vertices = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]])
    const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
    const faces = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]])
    const s = fromPayload({ v: 2, name: 'wall', unit: 0, mode: 'solid', vertices, colors: vertices.map(() => 1), faces, constrain: 'all' }, `wall-${lo}-${hi}`)
    if (!s) throw new Error('box')
    return s
  }

  it('the wall that blocks your step is the one faded, and the step is still refused', () => {
    // A wall one gibson in front of you along cyberspace -Z, drawn where GameView draws it.
    const wall: WorldShard = { key: 'wall', shard: box([-3, -1, -1], [3, 3, 0]), at: P(32, 32, 31), height: 6 }
    const you = P(32, 32, 32)
    const placed = placeShard({ key: wall.key, at: wall.at, height: wall.height, plane: 1, shard: wall.shard }, base, 0, AXES)
    const geo = shardGeometry(wall.shard, placed.clip, placed.pose)
    const g = new Group()
    const bg = new BufferGeometry()
    bg.setAttribute('position', new Float32BufferAttribute(geo.positions, 3))
    bg.setIndex(geo.index)
    g.add(new Mesh(bg, new MeshLambertMaterial({ side: DoubleSide })))
    g.position.set(...placed.centre)
    g.scale.setScalar(placed.scale)
    g.updateMatrixWorld(true)
    const f = new OcclusionFade()
    f.register('wall', g)
    const centre = new Vector3(...itemCentre(you, base, 0, AXES))
    // The camera on the far side of the wall, looking back at you: the render frame's -Z is cyberspace +Z, so the wall is at +render Z.
    const eye = centre.clone().add(new Vector3(0, 0.5, 3.2))
    const before = stepIn(game, you, 'z', -1, [wall])
    run(f, eye, centre, 1000, 30)
    expect(f.levelOf('wall')).toBe(1)
    const after = stepIn(game, you, 'z', -1, [wall])
    expect(before.moved).toBe(false)
    expect(after).toEqual(before)
  })
})
