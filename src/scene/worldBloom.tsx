/**
 * worldBloom.tsx - the world's bloom, blind to the shard faces' tag, and how
 * its composer's buffers resolve. Drawn by the world's canvas (Scene.tsx) and
 * by the workshop bench's LOOK (workshop/benchBloom.tsx), so the two are one
 * pass and cannot drift apart. Moved here unchanged from Scene.tsx.
 */

import { useEffect, useMemo, useRef } from 'react'
import { Bloom } from '@react-three/postprocessing'
import { BlendFunction, Effect, type BloomEffect, type EffectComposer as PostComposer } from 'postprocessing'

/**
 * The last word on a tagged texel: alpha 1. The tag (colour with alpha 0)
 * is valid inside the composer's buffers but not on the canvas, which
 * composites premultiplied: a compositor is free to clamp colour to alpha,
 * and one did, drawing the faces black except where a halo lent them some.
 * Merged into the bloom's own pass by postprocessing, so it costs nothing.
 * Only the tag is touched; every other texel leaves exactly as it came.
 */
const OPAQUE_TAGGED_FRAGMENT = `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec4 o = texture(inputBuffer, uv);
  float tagged = step(o.a, 0.0) * step(0.0005, max(o.r, max(o.g, o.b)));
  outputColor = vec4(inputColor.rgb, max(inputColor.a, tagged));
}`
class OpaqueTaggedEffect extends Effect {
  constructor() {
    super('OpaqueTagged', OPAQUE_TAGGED_FRAGMENT, { blendFunction: BlendFunction.SET })
  }
}

/** The luminance line the bloom ships with, and the same line blind to tagged texels. */
const LUMINANCE_LINE = 'float l=luminance(texel.rgb);'
const LUMINANCE_TAG_AWARE = 'float l=luminance(texel.rgb)*step(0.0005,texel.a);'

/**
 * The bloom, blind to the world's shard faces.
 *
 * Those faces write their colour with alpha 0 (ShardMesh `world`), a tag
 * nothing else in the frame carries: everything visible writes alpha above
 * zero, and the untouched background is black. The bloom's luminance pass,
 * patched here, treats a tagged texel as dark, so the faces draw at their
 * own colours, as on the bench, while every line, ring, label and point
 * field blooms exactly as it always has: same numbers, same passes, no depth
 * texture, nothing drawn twice. The canvas composites premultiplied, which is
 * how the bloom's own halos already show over alpha-0 background, so a
 * tagged texel shows its colour too.
 */
export function WorldBloom(): JSX.Element {
  // The wrapper types its ref as the class; what it holds is the instance.
  const ref = useRef<typeof BloomEffect>(null)
  // After every render, not once: the wrapper rebuilds its effect when a prop changes.
  useEffect(() => {
    const m = (ref.current as unknown as BloomEffect | null)?.luminanceMaterial
    if (!m || m.userData.tagAware) return
    if (!m.fragmentShader.includes(LUMINANCE_LINE)) {
      console.warn('[bloom] the luminance shader is not the one expected; shard faces will bloom')
      m.userData.tagAware = true
      return
    }
    m.fragmentShader = m.fragmentShader.replace(LUMINANCE_LINE, LUMINANCE_TAG_AWARE)
    m.userData.tagAware = true
    m.needsUpdate = true
  })
  const opaque = useMemo(() => new OpaqueTaggedEffect(), [])
  return (
    <>
      <Bloom ref={ref} mipmapBlur levels={3} intensity={2.6} luminanceThreshold={0.001} luminanceSmoothing={0} />
      <primitive object={opaque} />
    </>
  )
}

/**
 * The composer's buffers hand on their colour only.
 *
 * The scene is drawn into a multisampled buffer, and before the bloom can
 * read it, three resolves it into a plain one: by default the depth and the
 * stencil too. Nothing after the scene's own draw reads either (the shard
 * faces' stencil tag does its work inside that draw, ShardMesh
 * FACE_TAG_STENCIL), so resolving them was pure cost, and on Windows a
 * heavy one: Direct3D 11 cannot resolve a multisampled stencil on the GPU,
 * so ANGLE draws it (and the depth with it) out, copies it to a staging
 * texture, waits for the GPU to read it back, repacks it pixel by pixel on
 * the CPU and uploads it again, every frame (three.js #27799; ANGLE
 * Blit11::resolveStencil). On an Android phone the same resolve is one blit
 * on the GPU, likely why the main view was smooth there and laboured on a
 * Windows laptop (arkinox, 2026-10-20: "on my laptop the perf has improved
 * but it still isn't great"). Both buffers, since TV's tube makes the bloom
 * draw into the second one.
 *
 * An effect that reads depth (depth of field, SSAO, a normal pass, anything
 * with EffectAttribute.DEPTH) would get the composer's depth from the plain
 * buffer, which this leaves unresolved: it would need resolveDepthBuffer
 * back on. A ref, so a composer made again is set again: the wrapper hands
 * its ref the composer itself (useImperativeHandle, @react-three/
 * postprocessing 2.16), which a wrapper upgrade should check.
 */
export function resolveColourOnly(composer: PostComposer | null): void {
  if (!composer) return
  for (const buffer of [composer.inputBuffer, composer.outputBuffer]) {
    buffer.resolveDepthBuffer = false
    buffer.resolveStencilBuffer = false
  }
  // The second buffer only ever takes a full-screen pass (TV's bloom, ahead of
  // the tube): a quad's edges are off screen, so samples there smooth nothing,
  // and it was a second full copy of the scene's buffer while TV had been on.
  composer.outputBuffer.samples = 0
}
