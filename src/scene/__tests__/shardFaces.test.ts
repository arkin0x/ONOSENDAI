/**
 * shardFaces.test.ts - a see-through shard (DECK-0003 §1.11) is blended so the
 * bloom never flares on it, draws after every opaque face, writes no depth,
 * and keeps one pass for both sides; opaque shards are exactly as they were;
 * an avatar ignores its opacity; a placed object takes its own.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CustomBlending, LineBasicMaterial, MeshBasicMaterial, OneFactor, OneMinusSrcAlphaFactor, ReplaceStencilOp, ShaderLib, SrcAlphaFactor, ZeroFactor, type LineBasicMaterialParameters, type MeshBasicMaterialParameters } from 'three'
import { HEADLAMP_FACES, HEADLAMP_LINES, patchHeadlamp } from '../headlamp'
import { DOTS_ORDER, FACE_TAG_STENCIL, GHOST_OPACITY, OVERLAY_ORDER, SEE_THROUGH_BLEND, TAG_BLEND, TRANSLUCENT_ORDER, basicFaceProps, benchOrders, lineProps, litFaceProps, seeThrough, shardOpacity, shardOrder } from '../shardFaces'

describe('what a shard is drawn at', () => {
  it('is its own opacity with the 10% floor, 1 when it has none', () => {
    expect(shardOpacity({})).toBe(1)
    expect(shardOpacity({ opacity: 50 })).toBe(0.5)
    expect(shardOpacity({ opacity: 3 })).toBe(0.1)
  })

  it('multiplies a ghost by the object\'s own', () => {
    expect(shardOpacity({}, { ghost: true })).toBe(GHOST_OPACITY)
    expect(shardOpacity({ opacity: 50 }, { ghost: true })).toBeCloseTo(GHOST_OPACITY * 0.5)
  })

  it('ignores the object\'s own for an avatar (§3.3), a ghost\'s still applies', () => {
    expect(shardOpacity({ opacity: 20 }, { ignoreOpacity: true })).toBe(1)
    expect(shardOpacity({ opacity: 20 }, { ignoreOpacity: true, ghost: true })).toBe(GHOST_OPACITY)
  })
})

describe('a see-through face in the world', () => {
  const p = basicFaceProps(0.5, { ghost: false, world: true })

  it('keeps one pass for both sides (the #339 leak)', () => {
    expect(p.forceSinglePass).toBe(true)
  })

  it('writes no depth and draws after every opaque face', () => {
    expect(p.depthWrite).toBe(false)
    expect(shardOrder(0.5, false)).toBe(TRANSLUCENT_ORDER)
    expect(TRANSLUCENT_ORDER).toBeGreaterThan(0)
  })

  it('blends its colour and leaves the alpha under it as it was, so the bloom tag survives', () => {
    expect(p).toMatchObject({ transparent: true, opacity: 0.5, blending: CustomBlending, blendSrc: SrcAlphaFactor, blendDst: OneMinusSrcAlphaFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor })
  })

  it('marks the stencil like an opaque face, so overlays keep its alpha too', () => {
    expect(p).toMatchObject({ stencilWrite: true, stencilRef: FACE_TAG_STENCIL, stencilZPass: ReplaceStencilOp })
    expect(SEE_THROUGH_BLEND.stencilRef).toBe(TAG_BLEND.stencilRef)
  })
})

describe('an opaque face is exactly as it was', () => {
  it('in the world: the alpha-0 tag, depth written, the default order', () => {
    const p = basicFaceProps(1, { ghost: false, world: true })
    expect(p).toMatchObject({ ...TAG_BLEND, transparent: true, opacity: 1, forceSinglePass: true })
    expect(p).not.toHaveProperty('depthWrite')
    expect(shardOrder(1, false)).toBe(0)
  })

  it('off the world: plain blending, nothing else', () => {
    const p = basicFaceProps(1, { ghost: false, world: false })
    expect(p).toEqual({ transparent: true, opacity: 1, forceSinglePass: true })
  })
})

describe('a ghost keeps what it had', () => {
  it('two passes, ordinary blending, depth written, the default order, at its own opacity too', () => {
    const p = basicFaceProps(0.45 * 0.5, { ghost: true, world: true })
    expect(p).toEqual({ transparent: true, opacity: 0.45 * 0.5, forceSinglePass: false })
    expect(seeThrough(0.2, true)).toBe(false)
    expect(shardOrder(0.2, true)).toBe(0)
  })
})

describe('lines, points and the bench', () => {
  it('a see-through line writes no depth; an opaque one does', () => {
    expect(lineProps(0.5, false)).toEqual({ transparent: true, opacity: 0.5, depthWrite: false })
    expect(lineProps(1, false)).toEqual({ transparent: true, opacity: 1 })
  })

  it('the bench\'s lit faces: see-through writes no depth', () => {
    expect(litFaceProps(0.5, false)).toEqual({ transparent: true, opacity: 0.5, depthWrite: false })
    expect(litFaceProps(1, false)).toEqual({ transparent: true, opacity: 1 })
  })
})

describe('where it is wired (ShardMesh and the avatar)', () => {
  const mesh = readFileSync('src/scene/ShardMesh.tsx', 'utf8')
  const avatar = readFileSync('src/scene/AvatarShape.tsx', 'utf8')

  it('every face, line and point material takes the one opacity, and every mesh the one order', () => {
    expect(mesh).toMatch(/const opacity = shardOpacity\(given, \{ ghost, ignoreOpacity \}\)/)
    expect(mesh).toMatch(/basicFaceProps\(opacity, \{ ghost, world \}\)/)
    // Written where singlePass.test.ts's scan reads it, so the guard still sees this material:
    // before the spread, since the scan ends a declaration at its first "})".
    expect(mesh).toMatch(/<meshBasicMaterial[^>]*transparent forceSinglePass=\{!ghost\} \{\.\.\.basicFaceProps\(opacity, \{ ghost, world \}\)\}/)
    expect((mesh.match(/litFaceProps\(opacity, ghost\)/g) ?? []).length).toBe(2)
    expect((mesh.match(/lineProps\(opacity, ghost\)/g) ?? []).length).toBe(2)
    expect((mesh.match(/renderOrder=\{order\}/g) ?? []).length).toBe(1)
    expect(mesh).toMatch(/name="shard-faces"[^>]*renderOrder=\{lit \? bench\.front : order\}/)
    expect(mesh).toMatch(/geometry=\{inside\}[^>]*renderOrder=\{bench\.inside\}/)
    expect(mesh).toMatch(/<points [^>]*renderOrder=\{DOTS_ORDER\}/)
    expect(mesh).toMatch(/l\.renderOrder = shardOrder\(opacity, ghost\)/)
    expect(mesh).toMatch(/createDiscMaterial\([^)]*\? opacity : opacity \* 0\.55, headlamp && !lit\)/)
  })

  it('a placed object is drawn from its own model, never with its parent\'s opacity (§1.10)', () => {
    expect(mesh).toMatch(/body = <ShardMesh shard=\{model\} [^>]*ignoreOpacity=\{ignoreOpacity\} \/>/)
    expect(mesh).not.toMatch(/body = <ShardMesh[^>]*opacity=\{opacity\}/)
  })

  it('an avatar, and its parts, ignore their opacity (§3.3)', () => {
    expect(avatar).toMatch(/<ShardMesh shard=\{shard\} world cull=\{firstPerson\} ignoreOpacity \/>/)
    expect(readFileSync('src/hud/PersonModal.tsx', 'utf8')).toMatch(/<Preview shard=\{shard\} ignoreOpacity \/>/)
    expect(readFileSync('src/hud/TvSegments.tsx', 'utf8')).toMatch(/ignoreOpacity=\{item\?\.kind !== 'object'\}/)
  })
})

describe('the draw order (review of #452)', () => {
  it('opaque < see-through < bench front < dots < overlays', () => {
    expect(0).toBeLessThan(TRANSLUCENT_ORDER)
    expect(TRANSLUCENT_ORDER).toBeLessThan(benchOrders(0.5, false).front)
    expect(benchOrders(0.5, false).front).toBeLessThan(DOTS_ORDER)
    expect(DOTS_ORDER).toBeLessThan(OVERLAY_ORDER)
    // Below the world's other marks (paths 4, cages 8, walls and cursor 10).
    expect(OVERLAY_ORDER).toBeLessThan(4)
  })

  it('a see-through lit face draws its inside first, then its front; opaque stays at 0 for both', () => {
    expect(benchOrders(0.5, false)).toEqual({ inside: TRANSLUCENT_ORDER, front: TRANSLUCENT_ORDER + 0.5 })
    expect(benchOrders(1, false)).toEqual({ inside: 0, front: 0 })
    expect(benchOrders(0.2, true)).toEqual({ inside: 0, front: 0 })
  })

  it('every translucent overlay drawn over shards draws at OVERLAY_ORDER', () => {
    const box = readFileSync('src/scene/CoveringBox.tsx', 'utf8')
    const walls = readFileSync('src/scene/ClipWalls.tsx', 'utf8')
    const bench = readFileSync('src/workshop/Bench.tsx', 'utf8')
    expect(box).toMatch(/geometry=\{box\.fill\}[^>]*renderOrder=\{OVERLAY_ORDER\}/)
    expect(walls).toMatch(/material=\{m\}[^>]*renderOrder=\{OVERLAY_ORDER\}/)
    // The face highlight's fill and edge, the halo, the pick loop and ADD's ghost.
    expect(bench).toMatch(/<mesh geometry=\{lit\.g\} frustumCulled=\{false\} renderOrder=\{OVERLAY_ORDER\}>/)
    expect(bench).toMatch(/edge\.renderOrder = OVERLAY_ORDER/)
    expect(bench).toMatch(/LineBasicMaterial\(\{ color: WARN, toneMapped: false, transparent: true \}\)/)
    expect(bench).toMatch(/<primitive object=\{halos\.points\} renderOrder=\{OVERLAY_ORDER\} \/>/)
    expect(bench).toMatch(/l\.renderOrder = OVERLAY_ORDER/)
    expect(bench).toMatch(/<mesh position=\{UP\(aim\)\} renderOrder=\{OVERLAY_ORDER\}>/)
  })

  it('every one of a shard\'s own materials carries its own share, never a ghost\'s or its parent\'s', () => {
    const mesh = readFileSync('src/scene/ShardMesh.tsx', 'utf8')
    expect(mesh).toMatch(/const own = shardOpacity\(given, \{ ignoreOpacity \}\)/)
    expect((mesh.match(/userData-share=\{own\}/g) ?? []).length).toBe(4)
    expect(mesh).toMatch(/l\.material\.userData\.share = own/)
  })
})

describe('the headlamp (#456) on see-through shards', () => {
  const mesh = readFileSync('src/scene/ShardMesh.tsx', 'utf8')

  it('a see-through world face wears the same headlamp props as an opaque one: one element for both', () => {
    expect(mesh).toMatch(/\{\.\.\.basicFaceProps\(opacity, \{ ghost, world \}\)\} \{\.\.\.lampFaces\}/)
    expect(mesh).toMatch(/const lampFaces = headlamp \? HEADLAMP_FACES : \{\}/)
  })

  it('see-through lines and dots wear it as opaque ones do', () => {
    expect(mesh).toMatch(/\{\.\.\.lineProps\(opacity, ghost\)\} \{\.\.\.lampLines\}/)
    expect(mesh).toMatch(/const lampLines = headlamp && !lit \? HEADLAMP_LINES : \{\}/)
    expect(mesh).toMatch(/LineBasicMaterial\(\{ vertexColors: true, toneMapped: false, \.\.\.lineProps\(opacity, ghost\) \}\)\n\s*if \(headlamp && !lit\) Object\.assign\(m, HEADLAMP_LINES\)/)
    expect(mesh).toMatch(/opacity : opacity \* 0\.55, headlamp && !lit\)/)
  })

  it('the see-through blend and the headlamp compose on one material: neither drops the other', () => {
    const m = new MeshBasicMaterial({ ...basicFaceProps(0.5, { ghost: false, world: true }), ...HEADLAMP_FACES } as MeshBasicMaterialParameters)
    expect(m.onBeforeCompile).toBe(HEADLAMP_FACES.onBeforeCompile)
    expect(m.customProgramCacheKey()).toBe(HEADLAMP_FACES.customProgramCacheKey())
    expect(m).toMatchObject({ blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor, depthWrite: false, forceSinglePass: true, stencilWrite: true })
    const l = new LineBasicMaterial({ ...lineProps(0.5, false), ...HEADLAMP_LINES } as LineBasicMaterialParameters)
    expect(l.onBeforeCompile).toBe(HEADLAMP_LINES.onBeforeCompile)
    expect(l.depthWrite).toBe(false)
  })

  it('the headlamp scales colour only, never alpha, so the alpha kept under a see-through face stays kept', () => {
    const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader, uniforms: {} }
    expect(patchHeadlamp(shader, true)).toBe(true)
    expect(shader.fragmentShader).toMatch(/gl_FragColor\.rgb \*= /)
    expect(shader.fragmentShader).not.toMatch(/gl_FragColor\.a \*=|gl_FragColor \*= /)
  })
})
