/**
 * keepPrograms.test.ts: a renderer keeps the shader programs it compiles,
 * and a copy of each ShaderMaterial source it draws, so a cut on Cyberspace
 * TV does not compile again what the last one used (2026-10-20).
 */

import { describe, expect, it, vi } from 'vitest'
import {
  BatchedMesh, BufferGeometry, Group, InstancedMesh, SkinnedMesh, Line, LineBasicMaterial, LineLoop, LineSegments, Mesh, MeshBasicMaterial,
  PerspectiveCamera, Points, Scene, ShaderMaterial, Sprite, SpriteMaterial, Texture, UniformsGroup, type Camera, type Material, type Object3D, type WebGLRenderer,
} from 'three'
import { KEEP_MAX, checkShaderErrorsInDevOnly, copyable, keep, keepPrograms, keepSources, standIn, type Counted, type Sources } from '../keepPrograms'

/** Three's own rule (WebGLPrograms.releaseProgram): a program goes when its last user does. */
function release(programs: Counted[], p: Counted): void {
  if (--p.usedTimes === 0) programs.splice(programs.indexOf(p), 1)
}

const VERT = 'void main() { gl_Position = vec4(0.0); }'
const FRAG_A = 'void main() { gl_FragColor = vec4(1.0); }'
const FRAG_B = 'void main() { gl_FragColor = vec4(0.5); }'
const disc = (frag = FRAG_A): ShaderMaterial => new ShaderMaterial({
  vertexShader: VERT, fragmentShader: frag, defines: { GLOW: 1 }, transparent: true, depthWrite: false,
  uniforms: { uOpacity: { value: 0.5 }, uTex: { value: new Texture() } },
})

interface Compiled { object: Object3D; camera: Camera; target: Scene | null }
/** The parts of a WebGLRenderer keepPrograms uses: its programs, what each material was drawn with, compile. */
function fakeGl(): { gl: WebGLRenderer; programs: Counted[]; compiled: Compiled[]; drawWith: (m: Material, p: Counted) => void } {
  const programs: Counted[] = []
  const props = new WeakMap<object, { currentProgram?: Counted }>()
  const compiled: Compiled[] = []
  const gl = {
    info: { programs },
    properties: { get: (m: object) => { let p = props.get(m); if (!p) { p = {}; props.set(m, p) } return p } },
    compile: (object: Object3D, camera: Camera, target: Scene | null = null) => { compiled.push({ object, camera, target }); return new Set() },
    debug: { checkShaderErrors: true },
  }
  const drawWith = (m: Material, p: Counted): void => {
    if (!programs.includes(p)) programs.push(p)
    gl.properties.get(m).currentProgram = p
  }
  return { gl: gl as unknown as WebGLRenderer, programs, compiled, drawWith }
}

const camera = new PerspectiveCamera()
const render = (scene: Scene, gl: WebGLRenderer): void => scene.onAfterRender(gl, scene, camera, new BufferGeometry(), new MeshBasicMaterial(), new Group())

describe('keep', () => {
  it('a kept program outlives the last material that used it', () => {
    const programs: Counted[] = [{ usedTimes: 1 }]
    keep(programs, new Set())
    release(programs, programs[0])
    expect(programs).toHaveLength(1)
  })

  it('takes one use of each program, once however often it runs', () => {
    const a = { usedTimes: 1 }, b = { usedTimes: 3 }
    const kept = new Set<Counted>()
    expect(keep([a, b], kept)).toBe(2)
    expect(keep([a, b], kept)).toBe(2)
    expect(keep([b, a], kept)).toBe(2)
    expect([a.usedTimes, b.usedTimes]).toEqual([2, 4])
  })

  it('keeps one that arrives later', () => {
    const a = { usedTimes: 1 }, b = { usedTimes: 1 }
    const kept = new Set<Counted>()
    keep([a], kept)
    keep([a, b], kept)
    expect([a.usedTimes, b.usedTimes]).toEqual([2, 2])
  })

  it('keeps no more than KEEP_MAX: past it, three frees them as before', () => {
    const programs = Array.from({ length: KEEP_MAX + 5 }, () => ({ usedTimes: 1 }))
    expect(keep(programs, new Set())).toBe(KEEP_MAX)
    expect(programs.filter((p) => p.usedTimes === 2)).toHaveLength(KEEP_MAX)
    expect(programs.slice(KEEP_MAX).every((p) => p.usedTimes === 1)).toBe(true)
  })
})

describe('standIn', () => {
  const g = new BufferGeometry()
  const m = new ShaderMaterial()

  it('is the same kind of thing on the same geometry, drawing the copy', () => {
    const cases: Array<[Object3D, string]> = [
      [new Points(g), 'Points'], [new LineSegments(g), 'LineSegments'], [new LineLoop(g), 'LineLoop'],
      [new Line(g), 'Line'], [new Mesh(g), 'Mesh'],
    ]
    for (const [o, type] of cases) {
      const s = standIn(o, m) as Mesh
      expect(s.type).toBe(type)
      expect(s.geometry).toBe(g)
      expect(s.material).toBe(m)
    }
    const sprite = standIn(new Sprite(), m) as Sprite
    expect(sprite.type).toBe('Sprite')
    expect(sprite.material).toBe(m)
  })

  it('is nothing for an instanced, skinned or batched mesh, whose program depends on more', () => {
    expect(standIn(new InstancedMesh(g, m, 4), m)).toBeNull()
    expect(standIn(new SkinnedMesh(g, m), m)).toBeNull()
    expect(standIn(new BatchedMesh(4, 64, 64, m), m)).toBeNull()
  })

  it('is nothing for what is not drawn', () => {
    expect(standIn(new Group(), m)).toBeNull()
  })
})

describe('copyable', () => {
  it('is a plain ShaderMaterial, not one with lights or its own compile hook or key', () => {
    expect(copyable(disc())).toBe(true)
    const lit = disc(); lit.lights = true
    const hooked = disc(); hooked.onBeforeCompile = () => {}
    const keyed = disc(); keyed.customProgramCacheKey = () => 'mine'
    for (const m of [lit, hooked, keyed]) expect(copyable(m)).toBe(false)
  })
})

describe('keepSources', () => {
  it('makes ready a copy of each drawn ShaderMaterial source once, on a stand-in, against the scene', () => {
    const { gl, compiled, drawWith } = fakeGl()
    const scene = new Scene()
    const a1 = disc(), a2 = disc(), b = disc(FRAG_B)
    const p1 = new Points(new BufferGeometry(), a1)
    scene.add(p1, new Points(new BufferGeometry(), a2), new Mesh(new BufferGeometry(), b))
    for (const m of [a1, a2, b]) drawWith(m, { usedTimes: 1 })
    const sources: Sources = new Map()
    keepSources(gl, scene, camera, sources, () => true)
    expect(compiled).toHaveLength(2)
    const [first, second] = compiled
    expect(first.object.type).toBe('Points')
    expect((first.object as Points).geometry).toBe(p1.geometry)
    expect(second.object.type).toBe('Mesh')
    expect(first.camera).toBe(camera)
    expect(first.target).toBe(scene)
    // Again: nothing more.
    keepSources(gl, scene, camera, sources, () => true)
    expect(compiled).toHaveLength(2)
  })

  it('the copy has the source and options, not the uniforms, and is a new material', () => {
    const { gl, compiled } = fakeGl()
    const scene = new Scene()
    const m = disc()
    scene.add(new Points(new BufferGeometry(), m))
    keepSources(gl, scene, camera, new Map(), () => true)
    const copy = (compiled[0].object as Points).material as ShaderMaterial
    expect(copy).not.toBe(m)
    expect(copy.vertexShader).toBe(m.vertexShader)
    expect(copy.fragmentShader).toBe(m.fragmentShader)
    expect(copy.defines).toEqual(m.defines)
    expect(copy.transparent).toBe(true)
    expect(copy.depthWrite).toBe(false)
    expect(copy.uniforms).toEqual({})
    expect(m.uniforms.uOpacity.value).toBe(0.5)
  })

  it('leaves alone what was not drawn, and what is not a ShaderMaterial', () => {
    const { gl, compiled } = fakeGl()
    const scene = new Scene()
    const undrawn = disc()
    scene.add(new Points(new BufferGeometry(), undrawn), new Mesh(new BufferGeometry(), new MeshBasicMaterial()), new Sprite(new SpriteMaterial()))
    const sources: Sources = new Map()
    keepSources(gl, scene, camera, sources, (m) => m !== undrawn)
    expect(compiled).toHaveLength(0)
    // Drawn later, it is kept then.
    keepSources(gl, scene, camera, sources, () => true)
    expect(compiled).toHaveLength(1)
  })

  it('leaves to three a material a copy could not stand in for, without counting its source kept', () => {
    const { gl, compiled } = fakeGl()
    const scene = new Scene()
    const lit = disc(); lit.lights = true
    scene.add(new Points(new BufferGeometry(), lit))
    const sources: Sources = new Map()
    keepSources(gl, scene, camera, sources, () => true)
    expect(compiled).toHaveLength(0)
    expect(sources.size).toBe(0)
  })

  it('counts a source kept only once a stand-in is made: first seen instanced, kept when drawn plainer', () => {
    const { gl, compiled } = fakeGl()
    const scene = new Scene()
    const a = disc()
    scene.add(new InstancedMesh(new BufferGeometry(), a, 4))
    const sources: Sources = new Map()
    keepSources(gl, scene, camera, sources, () => true)
    expect(compiled).toHaveLength(0)
    scene.add(new Points(new BufferGeometry(), disc()))
    keepSources(gl, scene, camera, sources, () => true)
    expect(compiled).toHaveLength(1)
  })

  it('the copy holds no uniform groups either', () => {
    const { gl, compiled } = fakeGl()
    const scene = new Scene()
    const m = disc()
    m.uniformsGroups = [new UniformsGroup()]
    scene.add(new Points(new BufferGeometry(), m))
    keepSources(gl, scene, camera, new Map(), () => true)
    expect(((compiled[0].object as Points).material as ShaderMaterial).uniformsGroups).toEqual([])
    expect(m.uniformsGroups).toHaveLength(1)
  })

  it('says so when a copy compiled a program of its own', () => {
    const { gl, programs } = fakeGl()
    const scene = new Scene()
    scene.add(new Points(new BufferGeometry(), disc()), new Points(new BufferGeometry(), disc(FRAG_B)))
    let n = 0
    vi.spyOn(gl, 'compile').mockImplementation(() => { if (n++ === 0) programs.push({ usedTimes: 1 }); return new Set() as never })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    keepSources(gl, scene, camera, new Map(), () => true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][2])).toContain('compiled a program of its own')
    warn.mockRestore()
  })

  it('reads every material of an object that has several', () => {
    const { gl, compiled } = fakeGl()
    const scene = new Scene()
    scene.add(new Mesh(new BufferGeometry(), [new MeshBasicMaterial(), disc(), disc(FRAG_B)]))
    keepSources(gl, scene, camera, new Map(), () => true)
    expect(compiled).toHaveLength(2)
  })

  it('a copy that cannot be made costs no frame and is not tried again', () => {
    const { gl } = fakeGl()
    const scene = new Scene()
    const m = disc()
    scene.add(new Points(new BufferGeometry(), m))
    const compile = vi.spyOn(gl, 'compile').mockImplementation(() => { throw new Error('lost') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const sources: Sources = new Map()
    expect(() => keepSources(gl, scene, camera, sources, () => true)).not.toThrow()
    keepSources(gl, scene, camera, sources, () => true)
    expect(compile).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('checkShaderErrorsInDevOnly', () => {
  it('leaves the driver-blocking shader check on in development, off once built (arkinox, 2026-10-23: navigation freezes)', () => {
    const { gl } = fakeGl()
    const env = import.meta.env as { DEV: boolean }
    const was = env.DEV
    env.DEV = true
    checkShaderErrorsInDevOnly(gl)
    expect(gl.debug.checkShaderErrors).toBe(true)
    env.DEV = false
    checkShaderErrorsInDevOnly(gl)
    expect(gl.debug.checkShaderErrors).toBe(false)
    env.DEV = was
  })
})

describe('keepPrograms', () => {
  it('turns off the driver-blocking shader check the same way checkShaderErrorsInDevOnly does', () => {
    const { gl } = fakeGl()
    const env = import.meta.env as { DEV: boolean }
    const was = env.DEV
    env.DEV = false
    keepPrograms(gl, new Scene())
    expect(gl.debug.checkShaderErrors).toBe(false)
    env.DEV = was
  })

  it('keeps what the render that just ran compiled, and calls what was there before', () => {
    const { gl, programs } = fakeGl()
    const scene = new Scene()
    const before = vi.fn()
    scene.onAfterRender = before
    keepPrograms(gl, scene)
    const p = { usedTimes: 1 }
    programs.push(p)
    render(scene, gl)
    expect(before).toHaveBeenCalledTimes(1)
    expect(p.usedTimes).toBe(2)
    render(scene, gl)
    expect(p.usedTimes).toBe(2)
  })

  it('keeps a copy of a ShaderMaterial drawn with a program it has kept, looking only when a program is new', () => {
    const { gl, compiled, drawWith } = fakeGl()
    const scene = new Scene()
    keepPrograms(gl, scene)
    const traverse = vi.spyOn(scene, 'traverse')
    const m = disc()
    scene.add(new Points(new BufferGeometry(), m))
    drawWith(m, { usedTimes: 1 })
    render(scene, gl)
    expect(compiled).toHaveLength(1)
    expect(traverse).toHaveBeenCalledTimes(1)
    // Frames with no new program look at nothing.
    render(scene, gl)
    render(scene, gl)
    expect(traverse).toHaveBeenCalledTimes(1)
    // A new program for another material: a look, and the disc is not copied again.
    drawWith(new LineBasicMaterial(), { usedTimes: 1 })
    render(scene, gl)
    expect(traverse).toHaveBeenCalledTimes(2)
    expect(compiled).toHaveLength(1)
  })

  it('does not copy a material this renderer has not drawn', () => {
    const { gl, compiled, drawWith } = fakeGl()
    const scene = new Scene()
    keepPrograms(gl, scene)
    const shown = disc(), culled = disc(FRAG_B)
    scene.add(new Points(new BufferGeometry(), shown), new Points(new BufferGeometry(), culled))
    drawWith(shown, { usedTimes: 1 })
    render(scene, gl)
    expect(compiled).toHaveLength(1)
    expect(((compiled[0].object as Points).material as ShaderMaterial).fragmentShader).toBe(FRAG_A)
  })

  it('in the frame the bound is reached, copies the material whose program it kept and not the one past it', () => {
    const { gl, compiled, programs, drawWith } = fakeGl()
    const scene = new Scene()
    keepPrograms(gl, scene)
    for (let i = 0; i < KEEP_MAX - 1; i++) programs.push({ usedTimes: 1 })
    render(scene, gl)
    const inside = disc(), past = disc(FRAG_B)
    scene.add(new Points(new BufferGeometry(), inside), new Points(new BufferGeometry(), past))
    drawWith(inside, { usedTimes: 1 })
    drawWith(past, { usedTimes: 1 })
    render(scene, gl)
    expect(compiled).toHaveLength(1)
    expect(((compiled[0].object as Points).material as ShaderMaterial).fragmentShader).toBe(FRAG_A)
  })

  it('does not copy a material whose program it does not keep', () => {
    const { gl, compiled, programs, drawWith } = fakeGl()
    const scene = new Scene()
    keepPrograms(gl, scene)
    // KEEP_MAX programs kept, then one drawn past the bound.
    for (let i = 0; i < KEEP_MAX; i++) programs.push({ usedTimes: 1 })
    render(scene, gl)
    const m = disc()
    scene.add(new Points(new BufferGeometry(), m))
    drawWith(m, { usedTimes: 1 })
    render(scene, gl)
    expect(compiled).toHaveLength(0)
  })

  it('after a lost context, keeps the programs and copies three makes anew', () => {
    const { gl, drawWith, compiled, programs } = fakeGl()
    const scene = new Scene()
    keepPrograms(gl, scene)
    const m = disc()
    scene.add(new Points(new BufferGeometry(), m))
    drawWith(m, { usedTimes: 1 })
    render(scene, gl)
    expect(compiled).toHaveLength(1)
    // As many again before the loss, so that a count carried over would leave no room.
    for (let i = 1; i < KEEP_MAX; i++) programs.push({ usedTimes: 1 })
    render(scene, gl)
    // Three's new cache after the restore (WebGLRenderer initGLContext).
    const fresh = { usedTimes: 1 }
    ;(gl.info as unknown as { programs: Counted[] }).programs = [fresh]
    ;(gl.properties.get(m) as { currentProgram?: Counted }).currentProgram = fresh
    render(scene, gl)
    expect(fresh.usedTimes).toBe(2)
    expect(compiled).toHaveLength(2)
  })
})
