/**
 * TvScreenEffect.tsx: Cyberspace TV's picture tube.
 *
 * "the view becomes a CRT tv effect with some slight chromatic aberration"
 * (arkinox, 2026-10-18): the frame is bent onto a curved glass set well in
 * from the edges of the screen with rounded corners, its red and blue pulled
 * apart toward the edges, ruled with scanlines, darkened into the corners,
 * and left with a faint flicker and grain.
 *
 * Everything TV writes on the picture (scene/tvPainter.ts: the logo, the
 * clock, the chiron, the marquee, the segments) is painted onto a flat canvas
 * and sampled here like the picture, so the furniture is on the same glass:
 * bent, fringed and scanlined with it. It goes on after the snow, so a cut
 * never hides it ("i dont like how the ONOSENDAI logo is obscured so much
 * when the screen is snowy").
 *
 * A cut between shots is one of three, in turn: a dip (cut to black, fade
 * up), a roll (the picture rolls in from above, as a set losing vertical
 * hold), or a short burst of dark, chunky snow. The bright white static it
 * replaced was a flash at every cut ("this may bother some people and seems
 * overly aggressive"); with reduced motion asked for, every cut is a dip.
 *
 * One pass after the bloom, so the glow is on the tube rather than in the
 * world. It is in the composer for the whole session and skipped while TV is
 * off: the composer's children are made once (Scene.tsx), and adding or
 * removing an effect would rebuild its passes. Skipped, the pass is one
 * full-screen copy to the screen (postprocessing still renders a skipped pass
 * that renders to screen), and the picture is unchanged.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { CanvasTexture, LinearFilter, SRGBColorSpace, Uniform } from 'three'
import { placeable, useTv } from '../store/useTv'
import { useProfiles } from '../store/useProfiles'
import { targetColor } from '../lib/targets'
import { tvName } from '../lib/tv/text'
import { objectsOf } from '../workshop/ObjectPicker'
import { avatarFromEvent } from '../lib/avatar'
import { tvSpin } from '../hud/TvSegments'
import { CUT_MS, TV_FONT, TvPainter, type TvAssets } from './tvPainter'
import type { ShardModel } from 'sno-core/shards'

/** Kept for what still names the old static: a cut's transition, ms. */
export const STATIC_MS = CUT_MS

/** How often the furniture is painted, at most: plenty for a marquee, and half the uploads. */
const PAINT_MS = 33
/** The painted canvas's pixels per CSS pixel, at most, and its size, at most. */
const PAINT_SCALE = 1.5
const PAINT_MAX_PIXELS = 2_400_000

const FRAGMENT = `
uniform float uTime;
uniform float uPx;
uniform float uCut;
uniform float uCutKind;
uniform float uSnow;
uniform sampler2D uOverlay;

float tvNoise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// The furniture, painted flat, over a colour at a point of the flat frame.
vec3 withOverlay(vec3 col, vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return col;
  vec4 o = texture(uOverlay, p);
  return mix(col, o.rgb, o.a);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // The glass: set in from the screen's edges, bulging toward you, its
  // corners rounded, black all round it.
  vec2 c = uv * 2.0 - 1.0;
  c *= 1.1;
  c *= 1.0 + 0.045 * dot(c.yx, c.yx);
  vec2 q = abs(c) - vec2(0.86);
  float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.14;
  if (edge > 0.012) { outputColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 w = c * 0.5 + 0.5;
  if (w.x < 0.0 || w.x > 1.0 || w.y < 0.0 || w.y > 1.0) { outputColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // The picture, rolled in on a roll cut.
  vec2 pw = w;
  float bar = 0.0;
  if (uCutKind > 0.5 && uCutKind < 1.5 && uCut < 1.0) {
    float off = (1.0 - uCut) * (1.0 - uCut) * 0.85;
    float y = w.y + off;
    bar = step(1.0, y) * step(y, 1.06);
    pw.y = fract(y);
  }
  // Chromatic aberration, growing toward the edge of the tube: the centre
  // stays sharp, the edges split well apart.
  float r2 = dot(c, c);
  vec2 ca = c * (0.0015 + 0.0045 * r2);
  vec3 col = vec3(texture(inputBuffer, pw + ca).r, texture(inputBuffer, pw).g, texture(inputBuffer, pw - ca).b);
  col *= 1.0 - bar;

  // Snow: chunky (blocks of three CSS pixels), at a film's frame rate, dark.
  vec2 block = floor(gl_FragCoord.xy / (3.0 * uPx));
  float n = tvNoise(block + floor(uTime * 24.0) * vec2(17.0, 31.0));
  float snow = uSnow;
  if (uCutKind > 1.5 && uCut < 1.0) snow = max(snow, (1.0 - uCut) * 0.95);
  col = mix(col, vec3(n * 0.5), snow);
  // A dip: from black, up.
  if (uCutKind < 0.5 && uCut < 1.0) col *= smoothstep(0.15, 1.0, uCut);

  // The furniture, on top of all that, fringed as the picture is, a little
  // less: words have to stay readable at the edges.
  vec3 base = col;
  vec2 oca = ca * 0.6;
  col.r = withOverlay(base, w + oca).r;
  col.g = withOverlay(base, w).g;
  col.b = withOverlay(base, w - oca).b;

  // Scanlines, about every third device pixel, and a dim shadow mask.
  col *= 0.82 + 0.18 * sin(gl_FragCoord.y * 2.0944);
  col *= 0.93 + 0.07 * sin(gl_FragCoord.x * 2.0944);
  // Corners into the dark, as a tube's are, and the glass's own edge soft.
  col *= smoothstep(1.55, 0.55, length(c * vec2(0.92, 1.0)));
  col *= 1.0 - smoothstep(-0.02, 0.012, edge);
  // Flicker and grain.
  float g = tvNoise(gl_FragCoord.xy + fract(uTime) * 917.0);
  col *= 0.975 + 0.025 * sin(uTime * 57.0);
  col += (g - 0.5) * 0.03;
  outputColor = vec4(col, 1.0);
}`

class CrtEffect extends Effect {
  constructor(overlay: CanvasTexture) {
    super('CyberspaceTvTube', FRAGMENT, {
      // Reads the frame around each texel, so it gets a pass of its own.
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SKIP,
      uniforms: new Map<string, Uniform>([
        ['uTime', new Uniform(0)],
        ['uPx', new Uniform(1)],
        ['uCut', new Uniform(1)],
        ['uCutKind', new Uniform(0)],
        ['uSnow', new Uniform(0)],
        ['uOverlay', new Uniform(overlay)],
      ]),
    })
  }
}

/** Which of the three cuts a cut is: dip, roll, snow, in turn; always a dip with reduced motion. */
export function cutKind(cutAt: number, reduced: boolean): number {
  if (reduced) return 0
  return Math.abs(Math.floor(cutAt / 7)) % 3
}

/** Pictures, loaded once each, painted only when they came with CORS (else the canvas could not be uploaded). */
const pictures = new Map<string, HTMLImageElement | null>()
function pictureFor(url: string | null | undefined): HTMLImageElement | null {
  if (!url) return null
  const have = pictures.get(url)
  if (have !== undefined) return have && have.complete && have.naturalWidth > 0 ? have : null
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.referrerPolicy = 'no-referrer'
  img.onerror = () => { pictures.set(url, null) }
  img.src = url
  pictures.set(url, img)
  return null
}

export function TvScreenEffect(): JSX.Element {
  const painter = useMemo(() => new TvPainter(), [])
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __tvPainter?: TvPainter }).__tvPainter = painter }, [painter])
  const overlay = useMemo(() => {
    const t = new CanvasTexture(painter.canvas)
    t.colorSpace = SRGBColorSpace
    t.minFilter = LinearFilter
    t.generateMipmaps = false
    return t
  }, [painter])
  useEffect(() => () => overlay.dispose(), [overlay])
  const effect = useMemo(() => new CrtEffect(overlay), [overlay])
  useEffect(() => () => effect.dispose(), [effect])
  const logo = useMemo(() => {
    const img = new Image()
    img.src = '/logo.png'
    return img
  }, [])
  // The face the tube writes in, asked for before the first word is painted.
  useEffect(() => { void document.fonts?.load(`16px ${TV_FONT}`).catch(() => {}); void document.fonts?.load(`700 16px ${TV_FONT}`).catch(() => {}) }, [])
  const lastPaint = useRef(0)
  // The segment's shard, parsed once per segment rather than on every paint.
  const segment = useRef<{ id: string | undefined; shard: ShardModel | null }>({ id: undefined, shard: null })
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true, [])

  useFrame((state) => {
    const tv = useTv.getState()
    // Read every frame rather than on a change: TV can be on before this
    // mounts (a page opened on /tv), and a missed change left the tube off.
    const want = tv.on ? BlendFunction.SET : BlendFunction.SKIP
    if (effect.blendMode.blendFunction !== want) effect.blendMode.blendFunction = want
    if (!tv.on) return
    const now = performance.now()
    const u = effect.uniforms
    u.get('uTime')!.value = state.clock.elapsedTime
    u.get('uPx')!.value = state.gl.getPixelRatio()
    const since = now - tv.cutAt
    u.get('uCut')!.value = Math.min(1, Math.max(0, since / CUT_MS))
    u.get('uCutKind')!.value = cutKind(tv.cutAt, reduced)
    // Snow that stays: while tuning or without a signal, and under a bag
    // with no public place (the last picture behind its inset is often its
    // author's own trip, which would hint at where it went).
    const secret = tv.shot?.item?.kind === 'bag' && !placeable(tv.shot.item.hint)
    u.get('uSnow')!.value = tv.status === 'tuning' || tv.status === 'no-signal' ? 0.7 : secret ? 0.85 : 0

    if (now - lastPaint.current < PAINT_MS) return
    lastPaint.current = now
    const { width, height } = state.size
    const scale = Math.min(PAINT_SCALE, state.gl.getPixelRatio(), Math.sqrt(PAINT_MAX_PIXELS / Math.max(1, width * height)))
    painter.size(width, height, scale)
    const profiles = useProfiles.getState()
    const item = tv.shot?.item
    if (item?.id !== segment.current.id) segment.current = { id: item?.id, shard: item?.kind === 'object' ? (objectsOf([item.event])[0]?.shard ?? null) : item?.kind === 'avatar' ? avatarFromEvent(item.event) : null }
    const assets: TvAssets = {
      name: (pk) => { if (profiles.profiles[pk] === undefined) profiles.request(pk); return tvName(pk, profiles.profiles[pk]?.name) },
      picture: (pk) => pictureFor(profiles.profiles[pk]?.picture),
      logo: logo.complete && logo.naturalWidth > 0 ? logo : null,
      spin: tvSpin.canvas,
      segmentShard: segment.current.shard,
      color: targetColor,
    }
    painter.paint(tv, assets, now, scale, reduced)
    overlay.needsUpdate = true
  })
  return <primitive object={effect} />
}
