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
 * Now and then, between cuts, the set acts up: the colours pull apart, a
 * tear slips across the picture, or the signal goes for a moment
 * (lib/tv/glitch.ts).
 *
 * A cut between shots is one of three, in turn: a dip (cut to black, fade
 * up), a roll (the picture rolls in from above, as a set losing vertical
 * hold), or a short burst of dark, chunky snow. The bright white static it
 * replaced was a flash at every cut ("this may bother some people and seems
 * overly aggressive"); with reduced motion asked for, every cut is a dip.
 *
 * One pass after the bloom, so the glow is on the tube rather than in the
 * world. It is in the composer for the whole session, since the composer's
 * children are made once (Scene.tsx) and adding or removing an effect would
 * rebuild its passes, but with TV off its pass is switched off and the bloom
 * draws to the screen itself, as it did before TV. Merely skipped, the pass
 * cost every frame of the main view a full-screen copy, and the bloom, no
 * longer last, drew into the composer's spare multisampled buffer and had it
 * resolved: about half again the GPU time per frame, and on a Windows laptop
 * the world chugged from the first frame (arkinox, 2026-10-20: "it's barely
 * usable"; smooth on his Android).
 */

import { useContext, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BlendFunction, Effect, EffectAttribute, type Pass } from 'postprocessing'
import { EffectComposerContext } from '@react-three/postprocessing'
import { CanvasTexture, DataTexture, LinearFilter, SRGBColorSpace, Uniform, Vector2, Vector4, VideoTexture } from 'three'
import { placeable, useTv } from '../store/useTv'
import { useProfiles } from '../store/useProfiles'
import { targetColor } from '../lib/targets'
import { tvName } from '../lib/tv/text'
import { objectsOf } from '../workshop/ObjectPicker'
import { avatarFromEvent } from '../lib/avatar'
import { tvSpin } from '../hud/TvSegments'
import { uploadRegions } from './drawTracker'
import { CUT_MS, MARGIN_X, MARGIN_Y, TV_FONT, TvPainter, type FlatRect, type TvAssets, type TvExplainer, type TvMusic } from './tvPainter'
import { askForTap, musicProgress, setMusicVolume, tapMusic, useTvMusic } from '../store/useTvMusic'
import { countTvFrame, isBroadcast } from '../lib/tv/broadcast'
import { useTvWatching } from '../store/useTvWatching'
import { CALM, GlitchDirector } from '../lib/tv/glitch'
import { EXPLAINER_PIP_ENABLED, explainerLayout, explainerMix, lerpRect, type Rect } from '../lib/tv/explainer'
import { explainerCaption, explainerSoundHeld, explainerVideo, useTvExplainer } from '../store/useTvExplainer'
import type { ShardModel } from 'sno-core/shards'

/** Kept for what still names the old static: a cut's transition, ms. */
export const STATIC_MS = CUT_MS

/** How often the furniture is painted, at most: plenty for a marquee, and half the uploads. */
const PAINT_MS = 33
/** The painted canvas's pixels per CSS pixel, at most, and its size, at most. */
const PAINT_SCALE = 1.5
const PAINT_MAX_PIXELS = 2_400_000
/**
 * However little a paint changed, a band of the canvas this share of its
 * height goes up with it, the next band at the next paint, so all of it is
 * renewed every thirty paints (about a second at full pace, longer on a set
 * that paints slower): what can change on the canvas
 * without any call on it changing (a scaled picture's filtering settling, a
 * glyph's fallback face arriving) is put right within that. A band each
 * paint rather than all of it once a second, which would be a hitch a second
 * (review of #415).
 */
const REFRESH_BANDS = 30

/**
 * The glass: how far the frame is pulled in before it bulges (its middle is
 * drawn at 1 / this), and where the corners' shade has darkened them
 * altogether. On the stream, the glass comes nearer the frame's edges and
 * the corners shade less: the bezel took about a tenth off each side, and a
 * phone held upright shows the stream a fifth of its size (arkinox,
 * 2026-10-23). The same tube, curve and rounded corners; on the site, as it was.
 */
export const GLASS = 1.1
export const BROADCAST_GLASS = 1.02
const SHADE = 1.55
const BROADCAST_SHADE = 1.8

const FRAGMENT = `
uniform float uTime;
uniform float uPx;
uniform float uCut;
uniform float uCutKind;
uniform float uSnow;
uniform float uAberr;
uniform float uTear;
uniform float uTearSeed;
uniform float uDrop;
uniform float uFlicker;
uniform vec2 uDrift;
uniform float uGlass;
uniform float uShade;
uniform sampler2D uOverlay;
uniform sampler2D uVideo;
uniform float uMix;
uniform vec4 uPip;
uniform vec4 uVid;

float tvNoise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

bool inside(vec2 s) {
  return s.x >= 0.0 && s.x <= 1.0 && s.y >= 0.0 && s.y <= 1.0;
}

// The picture at a point of the flat frame; black off its edge, where a
// tear or a wide aberration reaches (rather than the edge smeared across).
// Over an explainer (lib/tv/explainer), the live picture made small in its
// corner (uPip, x y w h, y up), its frame a fine line, and the video behind
// it (uVid) coming up as the picture goes in (uMix), on this same glass.
vec3 picture(vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec3(0.0);
  if (uMix <= 0.0) return texture(inputBuffer, p).rgb;
  vec2 s = (p - uPip.xy) / uPip.zw;
  if (inside(s)) {
    vec2 px = min(s, 1.0 - s) * uPip.zw / texelSize;
    if (min(px.x, px.y) < 1.5 * uPx) return mix(texture(inputBuffer, s).rgb, vec3(0.0, 0.9, 1.0), 0.85 * uMix);
    // Made small, four taps a quarter of a screen pixel's footprint apart,
    // so the lattice's fine lines do not shimmer.
    vec2 d = texelSize * 0.25 / uPip.zw;
    return 0.25 * (texture(inputBuffer, s + vec2(-d.x, -d.y)).rgb + texture(inputBuffer, s + vec2(d.x, -d.y)).rgb
      + texture(inputBuffer, s + vec2(-d.x, d.y)).rgb + texture(inputBuffer, s + vec2(d.x, d.y)).rgb);
  }
  vec2 v = (p - uVid.xy) / uVid.zw;
  return inside(v) ? texture(uVideo, v).rgb * uMix : vec3(0.0);
}

// The furniture, painted flat, over a colour at a point of the flat frame.
// Its texture is the canvas's rows top down, as they are copied (no flip on
// upload, so a part of it copies to the same place: TvScreenEffect).
vec3 withOverlay(vec3 col, vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return col;
  vec4 o = texture(uOverlay, vec2(p.x, 1.0 - p.y));
  return mix(col, o.rgb, o.a);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // The glass: set in from the screen's edges, bulging toward you, its
  // corners rounded, black all round it.
  vec2 c = uv * 2.0 - 1.0;
  c *= uGlass;
  c *= 1.0 + 0.045 * dot(c.yx, c.yx);
  vec2 q = abs(c) - vec2(0.86);
  float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.14;
  if (edge > 0.012) { outputColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec2 w = c * 0.5 + 0.5;
  if (w.x < 0.0 || w.x > 1.0 || w.y < 0.0 || w.y > 1.0) { outputColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  // A tear (lib/tv/glitch.ts): some bands of the signal slip sideways, the
  // words on it with them, as a tape losing its tracking.
  if (uTear > 0.0) {
    float band = floor(w.y * 22.0);
    float slips = step(0.6, tvNoise(vec2(band, uTearSeed)));
    w.x += (tvNoise(vec2(band * 1.7, uTearSeed + 3.0)) - 0.5) * 0.14 * uTear * slips;
  }

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
  // uAberr: an aberration glitch pulls them far further apart (lib/tv/glitch.ts),
  // and the whole screen with them, the middle too, along a slowly turning
  // line (2026-10-19: "the chromatic abberation effect only seems to affect
  // the black sun. I want it to dramatically affect everything on screen,
  // including the text"). The radial part alone left the middle, where the
  // camera holds the avatar, all but still.
  float glitch = clamp((uAberr - 1.0) / 7.0, 0.0, 1.0);
  // Turning slowly, of one length all the way round (uDrift, set once a
  // frame: tubeDrift).
  vec2 drift = uDrift * 0.0028 * (uAberr - 1.0);
  vec2 ca = c * (0.0015 + 0.0045 * r2) * uAberr + drift;
  vec3 col = vec3(picture(pw + ca).r, picture(pw).g, picture(pw - ca).b);
  // A ghost of the picture further along the split: an avatar's red is all in
  // one channel, so a split alone only moves it; the ghost doubles it.
  if (glitch > 0.0) col = max(col, picture(pw + ca * 2.5) * 0.45 * glitch);
  col *= 1.0 - bar;

  // The signal going (a dropout glitch): the picture sinks a little into the
  // snow, as if drifting out of range, never more than about two fifths
  // (2026-10-19: "it should fade in slowly and subtly, only up to maybe 40%
  // or less even, like you're moving out of range of the signal").
  col *= 1.0 - 0.2 * uDrop;
  // The live picture's own snow (tuning, no signal, a bag with no public
  // place) stays on it: over an explainer, only in its corner.
  float shotSnow = uSnow;
  if (uMix > 0.0 && !inside((pw - uPip.xy) / uPip.zw)) shotSnow = 0.0;
  float snow = max(shotSnow, uDrop * 0.38);
  if (uCutKind > 1.5 && uCut < 1.0) snow = max(snow, (1.0 - uCut) * 0.95);
  // Only worked out when there is some: most of the time there is none, and
  // its six hashes, a sine each, were half of the twelve sines the tube took
  // on every pixel of every frame (2026-10-20: "the perf on /tv on my laptop
  // is not satisfactory"; the three that hang on the time alone, flicker and
  // drift, are worked out once a frame now). The same for the whole frame,
  // so every pixel takes the same way and the branch is cheap.
  if (snow > 0.0) {
    // Snow: chunky (about three CSS pixels a grain), at a film's frame rate,
    // dark, and soft: each grain blends into the next, as a tube's do, where
    // square blocks read as pixels (arkinox, 2026-10-18: "on a CRT it would
    // be blurry").
    // A new field each frame, from a small offset: large coordinates break
    // the hash into diagonal stripes.
    float frame = mod(floor(uTime * 24.0), 64.0);
    vec2 sp = gl_FragCoord.xy / (3.0 * uPx) + vec2(tvNoise(vec2(frame, 1.0)), tvNoise(vec2(frame, 2.0))) * 97.0;
    vec2 si = floor(sp);
    vec2 sf = fract(sp);
    sf = sf * sf * (3.0 - 2.0 * sf);
    float n = mix(mix(tvNoise(si), tvNoise(si + vec2(1.0, 0.0)), sf.x), mix(tvNoise(si + vec2(0.0, 1.0)), tvNoise(si + vec2(1.0, 1.0)), sf.x), sf.y);
    // Blending pulls toward grey: stretch it back out.
    n = clamp(0.5 + (n - 0.5) * 1.6, 0.0, 1.0);
    col = mix(col, vec3(n * 0.5), snow);
  }
  // A dip: from black, up.
  if (uCutKind < 0.5 && uCut < 1.0) col *= smoothstep(0.15, 1.0, uCut);

  // The furniture, on top of all that, fringed as the picture is, a little
  // less: words have to stay readable at the edges.
  vec3 base = col;
  // At rest the words split a little less than the picture, to stay crisp;
  // in an aberration glitch as much as it, ghost and all.
  vec2 oca = ca * mix(0.6, 1.0, glitch);
  col.r = withOverlay(base, w + oca).r;
  col.g = withOverlay(base, w).g;
  col.b = withOverlay(base, w - oca).b;
  if (glitch > 0.0) col = max(col, withOverlay(vec3(0.0), w + oca * 2.5) * 0.45 * glitch);

  // Scanlines, about every third device pixel, and a dim shadow mask.
  col *= 0.82 + 0.18 * sin(gl_FragCoord.y * 2.0944);
  col *= 0.93 + 0.07 * sin(gl_FragCoord.x * 2.0944);
  // Corners into the dark, as a tube's are, and the glass's own edge soft.
  col *= smoothstep(uShade, uShade - 1.0, length(c * vec2(0.92, 1.0)));
  col *= 1.0 - smoothstep(-0.02, 0.012, edge);
  // Flicker (uFlicker, set once a frame: tubeFlicker) and grain.
  float g = tvNoise(gl_FragCoord.xy + fract(uTime) * 917.0);
  col *= uFlicker;
  col += (g - 0.5) * 0.03;
  outputColor = vec4(col, 1.0);
}`

/** What the tube samples for the video while none is on: one black texel. */
const NO_VIDEO = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
NO_VIDEO.needsUpdate = true

/** A rectangle of the flat frame (CSS px, y down) as the shader takes it: shares of the frame, y up, into `out`. */
export function glRect(r: Rect, w: number, h: number, out: Vector4): Vector4 {
  return out.set(r.x / w, 1 - (r.y + r.h) / h, Math.max(1e-4, r.w / w), Math.max(1e-4, r.h / h))
}

/**
 * Off the flat frame entirely, however it is scaled: the shader's `inside`
 * check (picture(), the fragment above) never matches it, so with
 * EXPLAINER_PIP_ENABLED off the live picture never draws small in a corner;
 * every point of the tube falls straight through to the video.
 */
const PIP_HIDDEN: Rect = { x: -1e6, y: -1e6, w: 0, h: 0 }

/**
 * Where the live picture sits while an explainer plays, `mix` of the way
 * from the whole tube to `layout.pip` (lib/tv/explainer explainerLayout).
 * With EXPLAINER_PIP_ENABLED off (the default since 2026-10-24: arkinox,
 * "the pip needs to go away"), it never shows at all, PIP_HIDDEN, and the
 * video alone fills the tube: the live picture simply steps away, as the
 * marquee and the rest of its own furniture do.
 */
export function explainerPipRect(width: number, height: number, pip: Rect, mix: number, enabled: boolean = EXPLAINER_PIP_ENABLED): Rect {
  if (!enabled) return PIP_HIDDEN
  return lerpRect({ x: 0, y: 0, w: width, h: height }, pip, mix)
}

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
        ['uAberr', new Uniform(1)],
        ['uTear', new Uniform(0)],
        ['uTearSeed', new Uniform(0)],
        ['uDrop', new Uniform(0)],
        ['uFlicker', new Uniform(1)],
        ['uDrift', new Uniform(new Vector2(1, 0))],
        ['uGlass', new Uniform(isBroadcast() ? BROADCAST_GLASS : GLASS)],
        ['uShade', new Uniform(isBroadcast() ? BROADCAST_SHADE : SHADE)],
        ['uOverlay', new Uniform(overlay)],
        ['uVideo', new Uniform(NO_VIDEO)],
        ['uMix', new Uniform(0)],
        ['uPip', new Uniform(new Vector4(0, 0, 1, 1))],
        ['uVid', new Uniform(new Vector4(0, 0, 1, 1))],
      ]),
    })
  }
}

/**
 * The tube's pass runs only while TV is on; while it is off, the pass before
 * it (the bloom) is the last one and draws to the screen. Found again each
 * frame, so a rebuilt composer is set right too, and changed only when it
 * differs: a pass's screen switch rebuilds its material.
 */
function tubeOnly(passes: Pass[] | undefined, effect: Effect, on: boolean): void {
  if (!passes) return
  const at = passes.findIndex((p) => (p as unknown as { effects?: Effect[] }).effects?.includes(effect))
  if (at < 1 || at !== passes.length - 1) return
  const tube = passes[at], before = passes[at - 1]
  if (tube.enabled !== on) tube.enabled = on
  if (before.renderToScreen === on) before.renderToScreen = !on
}

/**
 * The aberration's drift at `t` seconds, into `out`: turning slowly, so the
 * split grows and shrinks rather than swinging about (2026-10-19: "it
 * fluctuates too much"); of one length all the way round, and turning
 * steadily, so only the glitch sets how far it pulls (review of #391: the
 * bare vector swung threefold by itself, and normalised with its second
 * frequency it now and then spun half round in under half a second). Mostly
 * sideways. Worked out once a frame here rather than on every pixel.
 */
export function tubeDrift(t: number, out: Vector2): Vector2 {
  const turn = t * 0.35
  return out.set(Math.cos(turn), 0.6 * Math.sin(turn)).normalize()
}

/** The tube's flicker at `t` seconds, a factor on the picture: once a frame here rather than on every pixel. */
export function tubeFlicker(t: number): number {
  return 0.975 + 0.025 * Math.sin(t * 57)
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

/** How far a drag on NOW PLAYING goes from silent to full, CSS px. */
const VOLUME_DRAG_PX = 160
/** How far a finger may wander and still be a tap, CSS px. */
const TAP_SLOP_PX = 6
/** How far outside NOW PLAYING a tap still lands on it, CSS px: a fingertip's slack. */
const CARD_SLACK_PX = 8

/**
 * Where a point on the screen shows on the flat frame the furniture is
 * painted on, CSS px: the glass's bend (FRAGMENT's first lines), so a tap
 * lands on what is seen there. y down, as the screen's is: the bend is the
 * same either way up.
 */
export function flatPoint(x: number, y: number, w: number, h: number, glass: number = GLASS): [number, number] {
  let cx = (x / w) * 2 - 1
  let cy = (y / h) * 2 - 1
  cx *= glass
  cy *= glass
  const k = 1 + 0.045 * (cx * cx + cy * cy)
  return [((cx * k) * 0.5 + 0.5) * w, ((cy * k) * 0.5 + 0.5) * h]
}

function within(r: FlatRect, x: number, y: number, slack: number): boolean {
  return x >= r.x - slack && x <= r.x + r.w + slack && y >= r.y - slack && y <= r.y + r.h + slack
}

/** NOW PLAYING's words, cover and progress, while there is music. */
function nowPlaying(): TvMusic | null {
  const { track, volume, muted } = useTvMusic.getState()
  return track ? { title: track.title, artist: track.artist, art: track.art, progress: musicProgress(), blocked: askForTap(), volume, muted } : null
}

export function TvScreenEffect(): JSX.Element {
  const painter = useMemo(() => new TvPainter(), [])
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __tvPainter?: TvPainter }).__tvPainter = painter }, [painter])
  const overlay = useMemo(() => {
    const t = new CanvasTexture(painter.canvas)
    t.colorSpace = SRGBColorSpace
    t.minFilter = LinearFilter
    t.generateMipmaps = false
    // Rows as the canvas has them, top first: a part of the canvas copied
    // into it then lands where it is (the shader reads it upside down).
    t.flipY = false
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
  useEffect(() => {
    void document.fonts?.load(`16px ${TV_FONT}`).catch(() => {})
    void document.fonts?.load(`700 16px ${TV_FONT}`).catch(() => {})
    // What the marquee measured in the fallback face is measured again in this one.
    const again = (): void => painter.remeasure()
    document.fonts?.addEventListener('loadingdone', again)
    return () => document.fonts?.removeEventListener('loadingdone', again)
  }, [painter])
  const lastPaint = useRef(0)
  const band = useRef(0)
  // The segment's shard, parsed once per segment rather than on every paint.
  const segment = useRef<{ id: string | undefined; shard: ShardModel | null }>({ id: undefined, shard: null })
  const reduced = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true, [])
  const glitches = useMemo(() => new GlitchDirector(performance.now()), [])
  const wasOn = useRef(false)
  // The HOSAKA banner for the commercial (lib/tv/hosakaAd), drawn into the
  // tube frame by frame: it opens the spot and plays once through. Its file
  // is asked for only once TV is on.
  const hosakaFor = useRef<number | null>(null)
  const hosaka = useMemo(() => {
    if (typeof document === 'undefined') return null
    const v = document.createElement('video')
    v.muted = true
    v.loop = false
    v.playsInline = true
    v.preload = 'auto'
    // A browser that says it plays AV1 and then cannot gets the VP9 cut.
    // Played again from the start if a spot is on (review of #384).
    v.addEventListener('error', () => { if (v.getAttribute('src') === '/hosaka.webm') { v.src = '/hosaka-vp9.webm'; hosakaFor.current = null } })
    return v
  }, [])
  useEffect(() => () => { if (hosaka) { hosaka.pause(); hosaka.removeAttribute('src'); hosaka.load() } }, [hosaka])
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __tvGlitches?: GlitchDirector }).__tvGlitches = glitches }, [glitches])
  // An explainer's video, as the tube samples it (lib/tv/explainer): one
  // texture per video, made when it comes on and let go when it goes.
  const videoTex = useRef<VideoTexture | null>(null)
  const videoAt = useRef(-1)
  useEffect(() => () => { videoTex.current?.dispose(); videoTex.current = null }, [])

  // NOW PLAYING takes a tap to mute and a drag up or down for the volume
  // (arkinox, 2026-10-18). On the canvas, ahead of the scene's own pointer
  // handling, and only on the card: a tap anywhere else is not the music's.
  const gl = useThree((s) => s.gl)
  const composer = useContext(EffectComposerContext)?.composer
  useEffect(() => {
    const el = gl.domElement
    let drag: { id: number; y: number; volume: number; moved: boolean } | null = null
    // The click a browser sends after a tap or a drag on the card is the
    // card's too, not a tap on whatever the scene has under it. A tap's mute
    // waits for that click: every browser lets sound be unmuted in a click,
    // where iOS may not count the end of a touch as one.
    let swallowUntil = 0
    let tapped = false
    // A tap that began while an explainer's sound was held back is for the
    // sound alone (its own listener lets it in): never also a mute.
    let forSound = false
    const down = (e: PointerEvent): void => {
      swallowUntil = 0
      tapped = false
      forSound = explainerSoundHeld()
      const m = useTvMusic.getState()
      // While the browser holds the sound back, a tap is for the sound.
      // Over an explainer the card is its title's tag, for the sound, track or none.
      if (!useTv.getState().on || (!m.track && !useTvExplainer.getState().showing) || m.blocked) return
      const card = painter.musicCard
      const r = el.getBoundingClientRect()
      if (!card || r.width <= 0 || r.height <= 0) return
      const [x, y] = flatPoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height, effect.uniforms.get('uGlass')!.value as number)
      if (!within(card, x, y, CARD_SLACK_PX)) return
      drag = { id: e.pointerId, y: e.clientY, volume: m.volume, moved: false }
      try { el.setPointerCapture(e.pointerId) } catch { /* the drag still works while over the canvas */ }
      e.stopPropagation()
    }
    const move = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return
      const up = drag.y - e.clientY
      if (!drag.moved && Math.abs(up) < TAP_SLOP_PX) return
      drag.moved = true
      setMusicVolume(drag.volume + up / VOLUME_DRAG_PX)
      e.stopPropagation()
    }
    const end = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return
      tapped = !drag.moved && e.type === 'pointerup'
      drag = null
      swallowUntil = performance.now() + 500
      e.stopPropagation()
    }
    const click = (e: MouseEvent): void => {
      if (performance.now() > swallowUntil) return
      swallowUntil = 0
      if (tapped && !forSound) tapMusic()
      tapped = false
      e.stopPropagation()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('click', click)
    return () => {
      el.removeEventListener('click', click)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', end)
      el.removeEventListener('pointercancel', end)
    }
  }, [gl, painter, effect])

  useFrame((state) => {
    const tv = useTv.getState()
    // Read every frame rather than on a change: TV can be on before this
    // mounts (a page opened on /tv), and a missed change left the tube off.
    const want = tv.on ? BlendFunction.SET : BlendFunction.SKIP
    if (effect.blendMode.blendFunction !== want) effect.blendMode.blendFunction = want
    tubeOnly(composer?.passes, effect, tv.on)
    const now = performance.now()
    // The glitches' clocks start when TV comes on: time with it off is not a backlog.
    if (tv.on && !wasOn.current) {
      glitches.reset(now)
      if (hosaka && !hosaka.getAttribute('src')) hosaka.src = hosaka.canPlayType('video/webm; codecs=av01') ? '/hosaka.webm' : '/hosaka-vp9.webm'
    }
    wasOn.current = tv.on
    // The banner runs only while the commercial is on.
    if (hosaka) {
      // From its start once per spot, when the spot's own clock starts
      // (after the cut into it), then left on its last frame.
      if (tv.on && tv.ad && hosakaFor.current !== tv.ad.at && now - tv.ad.at >= CUT_MS) { hosakaFor.current = tv.ad.at; hosaka.currentTime = 0; void hosaka.play().catch(() => {}) }
      else if (!(tv.on && tv.ad) && !hosaka.paused) hosaka.pause()
    }
    if (!tv.on) {
      // TV went off over an explainer: its texture goes with it.
      if (videoTex.current) { effect.uniforms.get('uVideo')!.value = NO_VIDEO; effect.uniforms.get('uMix')!.value = 0; videoTex.current.dispose(); videoTex.current = null }
      return
    }
    // The encoder's watchdog reads this (lib/tv/broadcast); nothing off the stream.
    countTvFrame()
    const u = effect.uniforms
    u.get('uTime')!.value = state.clock.elapsedTime
    u.get('uFlicker')!.value = tubeFlicker(state.clock.elapsedTime)
    tubeDrift(state.clock.elapsedTime, u.get('uDrift')!.value as Vector2)
    u.get('uPx')!.value = state.gl.getPixelRatio()
    const since = now - tv.cutAt
    // Over an explainer a cut in the live picture's corner is a plain cut: a
    // dip, a roll or a burst of snow would take the whole tube, video and all.
    const explaining = useTvExplainer.getState().showing !== null
    u.get('uCut')!.value = explaining ? 1 : Math.min(1, Math.max(0, since / CUT_MS))
    u.get('uCutKind')!.value = cutKind(tv.cutAt, reduced)
    // Snow that stays: while tuning or without a signal, and under a bag
    // with no public place (the last picture behind its inset is often its
    // author's own trip, which would hint at where it went).
    const secret = tv.shot?.item?.kind === 'bag' && !placeable(tv.shot.item.hint)
    u.get('uSnow')!.value = tv.status === 'tuning' || tv.status === 'no-signal' ? 0.7 : secret ? 0.85 : 0
    // Now and then the set acts up (lib/tv/glitch.ts): never over a cut, the
    // tunnel or tuning, and never with reduced motion asked for.
    // Nor over a commercial: the sponsor's spot plays clean.
    // A CYBERSPACE STATS break plays clean too.
    const onBreak = tv.ad !== null || tv.stats !== null
    const held = since < CUT_MS || tv.jump?.phase === 'warp' || tv.status !== 'playing' || onBreak
    // And one already on ends as the spot or the tunnel comes in, not over them.
    const g = reduced ? CALM : glitches.levels(now, held, onBreak || tv.jump?.phase === 'warp')
    u.get('uAberr')!.value = g.aberration
    u.get('uTear')!.value = g.tear
    u.get('uTearSeed')!.value = g.tearSeed
    u.get('uDrop')!.value = g.dropout

    // An explainer (lib/tv/explainer): the video fills the tube, through
    // this glass; with EXPLAINER_PIP_ENABLED (off by default) the live
    // picture goes small into its corner behind it instead of away entirely
    // (explainerPipRect, above). Laid out every frame, so a moving frame
    // tracks it.
    const { width, height } = state.size
    const ex = useTvExplainer.getState().showing
    const ev = explainerVideo()
    const mix = ex && ev ? explainerMix(ex.phase, ex.at, now, ex.outMs) : 0
    let explainer: TvExplainer | null = null
    if (ex && ev && mix > 0) {
      if (videoTex.current?.image !== ev) {
        videoTex.current?.dispose()
        const t = new VideoTexture(ev)
        t.colorSpace = SRGBColorSpace
        t.minFilter = LinearFilter
        t.generateMipmaps = false
        videoTex.current = t
        videoAt.current = -1
      }
      // three's VideoTexture marks each new frame on the video's own frame
      // callback; this marks it too, from the clock, for a browser that does
      // not call back for a video outside the page. Either way it is one
      // upload a frame at most (review of #471).
      if (ev.readyState >= 2 && ev.currentTime !== videoAt.current) { videoTex.current.needsUpdate = true; videoAt.current = ev.currentTime }
      const floor = painter.marqueeTop ?? height * (1 - MARGIN_Y) - 28
      const layout = explainerLayout(width, height, ev.videoWidth / ev.videoHeight, MARGIN_X, MARGIN_Y, floor)
      glRect(explainerPipRect(width, height, layout.pip, mix), width, height, u.get('uPip')!.value as Vector4)
      glRect(layout.video, width, height, u.get('uVid')!.value as Vector4)
      u.get('uVideo')!.value = videoTex.current
      explainer = { title: ex.title, mix, pip: layout.pip, video: layout.video, caption: explainerCaption(), soundHeld: explainerSoundHeld(), muted: useTvMusic.getState().muted, pipShown: EXPLAINER_PIP_ENABLED }
    } else if (videoTex.current) {
      u.get('uVideo')!.value = NO_VIDEO
      videoTex.current.dispose()
      videoTex.current = null
    }
    u.get('uMix')!.value = mix

    if (now - lastPaint.current < PAINT_MS) return
    lastPaint.current = now
    const scale = Math.min(PAINT_SCALE, state.gl.getPixelRatio(), Math.sqrt(PAINT_MAX_PIXELS / Math.max(1, width * height)))
    // A new size needs a new texture: three.js keeps the storage it first
    // made, and copying a larger canvas into it fails on the GPU, which left
    // the furniture frozen after a rotation or the phone's address bar
    // moving (review of #375).
    const resized = painter.size(width, height, scale)
    if (resized) overlay.dispose()
    const profiles = useProfiles.getState()
    const item = tv.shot?.item
    if (item?.id !== segment.current.id) segment.current = { id: item?.id, shard: item?.kind === 'object' ? (objectsOf([item.event])[0]?.shard ?? null) : item?.kind === 'avatar' ? avatarFromEvent(item.event) : null }
    const assets: TvAssets = {
      name: (pk) => { if (profiles.profiles[pk] === undefined) profiles.request(pk); return tvName(pk, profiles.profiles[pk]?.name) },
      bot: (pk) => profiles.profiles[pk]?.bot === true,
      picture: (pk) => pictureFor(profiles.profiles[pk]?.picture),
      logo: logo.complete && logo.naturalWidth > 0 ? logo : null,
      spin: tvSpin.canvas,
      segmentShard: segment.current.shard,
      color: targetColor,
      music: nowPlaying(),
      watching: useTvWatching.getState().count,
      hosaka: !tv.ad ? null : hosaka && hosaka.readyState >= 2 ? hosaka : pictureFor('/hosaka-poster.jpg'),
      hosakaMark: tv.ad ? pictureFor('/hosaka-mark.png') : null,
      explainer,
    }
    // The turning shard's next frame, for the next paint: this one copies the
    // last (TvSegments tvSpin).
    tvSpin.next?.()
    painter.paint(tv, assets, now, scale, reduced)
    // Only what the paint changed goes to the GPU (drawTracker): the marquee,
    // the minimap and NOW PLAYING's progress move on every paint, and the
    // rest, most of the canvas, mostly sits still until a cut. It was all of
    // it, some ten megabytes a paint at a laptop's size, thirty times a
    // second (arkinox, 2026-10-20: "the perf on /tv on my laptop is not
    // satisfactory").
    const dirty = painter.dirty
    if (resized || dirty === null) overlay.needsUpdate = true
    else {
      const W = painter.canvas.width, H = painter.canvas.height
      const bh = Math.ceil(H / REFRESH_BANDS)
      const y = (band.current++ % REFRESH_BANDS) * bh
      uploadRegions(state.gl, overlay, y < H ? [...dirty, { x: 0, y, w: W, h: Math.min(bh, H - y) }] : dirty)
    }
  })
  return <primitive object={effect} />
}
