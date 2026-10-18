/**
 * TvScreenEffect.tsx: Cyberspace TV's picture tube.
 *
 * "the view becomes a CRT tv effect with some slight chromatic aberration"
 * (arkinox, 2026-10-18): the frame is bent onto a curved screen, its red and
 * blue pulled apart toward the edges, ruled with scanlines, darkened into the
 * corners, and left with a faint flicker and grain. Each cut between shots
 * is a short burst of static, as a channel change would be.
 *
 * The ONOSENDAI logo sits in the top right corner as the station's bug, drawn
 * here rather than over the canvas so the tube treats it as part of the
 * picture: it bends with the glass, fringes, carries the scanlines and goes
 * under the static with everything else (arkinox, 2026-10-18: "put the
 * ONOSENDAI logo in the top right corner and make sure to apply the filters
 * to it").
 *
 * One pass after the bloom, so the glow is on the tube rather than in the
 * world. It is in the composer for the whole session and skipped while TV is
 * off: the composer's children are made once (Scene.tsx), and adding or
 * removing an effect would rebuild its passes. Skipped, the pass is one
 * full-screen copy to the screen (postprocessing still renders a skipped pass
 * that renders to screen), and the picture is unchanged.
 */

import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { SRGBColorSpace, TextureLoader, Uniform, Vector4, type Texture } from 'three'
import { useTv } from '../store/useTv'

/** How long the static of a cut lasts, ms. */
export const STATIC_MS = 420

/** The logo's width, CSS px, and at most this share of the screen's. */
const LOGO_PX = 260
const LOGO_SHARE = 0.42
/** public/logo.png's proportions. */
const LOGO_ASPECT = 354 / 1871
/**
 * Its margins from the top and right, as shares of the screen. Wide on
 * purpose: the bent glass pulls the frame's corners off the tube, and a bug
 * set as close in as the HTML furniture would lose its tips.
 */
export const LOGO_MARGIN_X = 0.06
export const LOGO_MARGIN_Y = 0.085

const FRAGMENT = `
uniform float uTime;
uniform float uStatic;
uniform sampler2D uLogo;
uniform vec4 uLogoRect;

// The bug over the picture at a point of the flat frame, before the tube bends it.
vec3 withLogo(vec3 col, vec2 p) {
  vec2 q = (p - uLogoRect.xy) / (uLogoRect.zw - uLogoRect.xy);
  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) return col;
  vec4 l = texture(uLogo, q);
  return mix(col, l.rgb, l.a * 0.88);
}

float tvNoise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // The curved screen: the picture bulges toward you, corners off the glass.
  vec2 c = uv * 2.0 - 1.0;
  c *= 1.0 + 0.045 * dot(c.yx, c.yx);
  vec2 w = c * 0.5 + 0.5;
  if (w.x < 0.0 || w.x > 1.0 || w.y < 0.0 || w.y > 1.0) { outputColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // Slight chromatic aberration, growing toward the edge of the tube.
  vec2 ca = c * 0.0035;
  float r = withLogo(texture(inputBuffer, w + ca).rgb, w + ca).r;
  float g = withLogo(texture(inputBuffer, w).rgb, w).g;
  float b = withLogo(texture(inputBuffer, w - ca).rgb, w - ca).b;
  vec3 col = vec3(r, g, b);
  // Scanlines, about every third device pixel, and a dim shadow mask.
  col *= 0.84 + 0.16 * sin(gl_FragCoord.y * 2.0944);
  col *= 0.94 + 0.06 * sin(gl_FragCoord.x * 2.0944);
  // Corners into the dark, as a tube's are.
  col *= smoothstep(1.55, 0.55, length(c * vec2(0.92, 1.0)));
  // Flicker and grain, and the static of a cut over everything.
  float n = tvNoise(gl_FragCoord.xy + fract(uTime) * 917.0);
  col *= 0.975 + 0.025 * sin(uTime * 57.0);
  col += (n - 0.5) * 0.035;
  col = mix(col, vec3(n * 0.85), uStatic);
  outputColor = vec4(col, 1.0);
}`

class CrtEffect extends Effect {
  constructor(logo: Texture) {
    super('CyberspaceTvTube', FRAGMENT, {
      // Reads the frame around each texel, so it gets a pass of its own.
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SKIP,
      uniforms: new Map<string, Uniform>([
        ['uTime', new Uniform(0)],
        ['uStatic', new Uniform(0)],
        ['uLogo', new Uniform(logo)],
        // Off the frame until the first measure.
        ['uLogoRect', new Uniform(new Vector4(2, 2, 3, 3))],
      ]),
    })
  }
}

export function TvScreenEffect(): JSX.Element {
  const logo = useMemo(() => {
    const t = new TextureLoader().load('/logo.png')
    t.colorSpace = SRGBColorSpace
    return t
  }, [])
  useEffect(() => () => logo.dispose(), [logo])
  const effect = useMemo(() => new CrtEffect(logo), [logo])
  useEffect(() => () => effect.dispose(), [effect])
  useFrame((state) => {
    const tv = useTv.getState()
    // Read every frame rather than on a change: TV can be on before this
    // mounts (a page opened on /tv), and a missed change left the tube off.
    const want = tv.on ? BlendFunction.SET : BlendFunction.SKIP
    if (effect.blendMode.blendFunction !== want) effect.blendMode.blendFunction = want
    if (!tv.on) return
    effect.uniforms.get('uTime')!.value = state.clock.elapsedTime
    // The bug's place in the flat frame, uv from the bottom left.
    const { width, height } = state.size
    const w = Math.min(LOGO_PX, width * LOGO_SHARE) / width
    const h = (Math.min(LOGO_PX, width * LOGO_SHARE) * LOGO_ASPECT) / height
    const right = 1 - LOGO_MARGIN_X
    const top = 1 - LOGO_MARGIN_Y
    ;(effect.uniforms.get('uLogoRect')!.value as Vector4).set(right - w, top - h, right, top)
    const since = performance.now() - tv.cutAt
    effect.uniforms.get('uStatic')!.value = since < 0 || since > STATIC_MS ? (tv.status === 'tuning' || tv.status === 'no-signal' ? 0.9 : 0) : 1 - since / STATIC_MS
  })
  return <primitive object={effect} />
}
