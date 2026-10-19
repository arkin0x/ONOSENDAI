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
 * world. It is in the composer for the whole session and skipped while TV is
 * off: the composer's children are made once (Scene.tsx), and adding or
 * removing an effect would rebuild its passes. Skipped, the pass is one
 * full-screen copy to the screen (postprocessing still renders a skipped pass
 * that renders to screen), and the picture is unchanged.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'
import { CanvasTexture, LinearFilter, SRGBColorSpace, Uniform } from 'three'
import { placeable, useTv } from '../store/useTv'
import { useProfiles } from '../store/useProfiles'
import { targetColor } from '../lib/targets'
import { tvName } from '../lib/tv/text'
import { objectsOf } from '../workshop/ObjectPicker'
import { avatarFromEvent } from '../lib/avatar'
import { tvSpin } from '../hud/TvSegments'
import { CUT_MS, TV_FONT, TvPainter, type FlatRect, type TvAssets, type TvMusic } from './tvPainter'
import { musicProgress, setMusicVolume, toggleMusicMute, useTvMusic } from '../store/useTvMusic'
import { CALM, GlitchDirector } from '../lib/tv/glitch'
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
uniform float uAberr;
uniform float uTear;
uniform float uTearSeed;
uniform float uDrop;
uniform sampler2D uOverlay;

float tvNoise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// The picture at a point of the flat frame; black off its edge, where a
// tear or a wide aberration reaches (rather than the edge smeared across).
vec3 picture(vec2 p) {
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec3(0.0);
  return texture(inputBuffer, p).rgb;
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
  // uAberr: an aberration glitch pulls them far further apart (lib/tv/glitch.ts).
  vec2 ca = c * (0.0015 + 0.0045 * r2) * uAberr;
  vec3 col = vec3(picture(pw + ca).r, picture(pw).g, picture(pw - ca).b);
  col *= 1.0 - bar;

  // Snow: chunky (about three CSS pixels a grain), at a film's frame rate,
  // dark, and soft: each grain blends into the next, as a tube's do, where
  // square blocks read as pixels (arkinox, 2026-10-18: "on a CRT it would be
  // blurry").
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
  // The signal going (a dropout glitch): the picture sinks into the snow.
  col *= 1.0 - 0.55 * uDrop;
  float snow = max(uSnow, uDrop * 0.9);
  if (uCutKind > 1.5 && uCut < 1.0) snow = max(snow, (1.0 - uCut) * 0.95);
  col = mix(col, vec3(n * 0.5), snow);
  // A dip: from black, up.
  if (uCutKind < 0.5 && uCut < 1.0) col *= smoothstep(0.15, 1.0, uCut);

  // The furniture, on top of all that, fringed as the picture is, a little
  // less: words have to stay readable at the edges.
  vec3 base = col;
  // An aberration glitch splits the words less than the picture: at most
  // three times the usual, so the channel stays readable through it.
  vec2 oca = ca * 0.6 * min(uAberr, 3.0) / max(uAberr, 1.0);
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
        ['uAberr', new Uniform(1)],
        ['uTear', new Uniform(0)],
        ['uTearSeed', new Uniform(0)],
        ['uDrop', new Uniform(0)],
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
export function flatPoint(x: number, y: number, w: number, h: number): [number, number] {
  let cx = (x / w) * 2 - 1
  let cy = (y / h) * 2 - 1
  cx *= 1.1
  cy *= 1.1
  const k = 1 + 0.045 * (cx * cx + cy * cy)
  return [((cx * k) * 0.5 + 0.5) * w, ((cy * k) * 0.5 + 0.5) * h]
}

function within(r: FlatRect, x: number, y: number, slack: number): boolean {
  return x >= r.x - slack && x <= r.x + r.w + slack && y >= r.y - slack && y <= r.y + r.h + slack
}

/** NOW PLAYING's words, cover and progress, while there is music. */
function nowPlaying(): TvMusic | null {
  const { track, blocked, volume, muted } = useTvMusic.getState()
  return track ? { title: track.title, artist: track.artist, art: track.art, progress: musicProgress(), blocked, volume, muted } : null
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
  useEffect(() => {
    void document.fonts?.load(`16px ${TV_FONT}`).catch(() => {})
    void document.fonts?.load(`700 16px ${TV_FONT}`).catch(() => {})
    // What the marquee measured in the fallback face is measured again in this one.
    const again = (): void => painter.remeasure()
    document.fonts?.addEventListener('loadingdone', again)
    return () => document.fonts?.removeEventListener('loadingdone', again)
  }, [painter])
  const lastPaint = useRef(0)
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

  // NOW PLAYING takes a tap to mute and a drag up or down for the volume
  // (arkinox, 2026-10-18). On the canvas, ahead of the scene's own pointer
  // handling, and only on the card: a tap anywhere else is not the music's.
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    const el = gl.domElement
    let drag: { id: number; y: number; volume: number; moved: boolean } | null = null
    // The click a browser sends after a tap or a drag on the card is the
    // card's too, not a tap on whatever the scene has under it. A tap's mute
    // waits for that click: every browser lets sound be unmuted in a click,
    // where iOS may not count the end of a touch as one.
    let swallowUntil = 0
    let tapped = false
    const down = (e: PointerEvent): void => {
      swallowUntil = 0
      tapped = false
      const m = useTvMusic.getState()
      // While the browser holds the sound back, a tap is for the sound.
      if (!useTv.getState().on || !m.track || m.blocked) return
      const card = painter.musicCard
      const r = el.getBoundingClientRect()
      if (!card || r.width <= 0 || r.height <= 0) return
      const [x, y] = flatPoint(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
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
      if (tapped) toggleMusicMute()
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
  }, [gl, painter])

  useFrame((state) => {
    const tv = useTv.getState()
    // Read every frame rather than on a change: TV can be on before this
    // mounts (a page opened on /tv), and a missed change left the tube off.
    const want = tv.on ? BlendFunction.SET : BlendFunction.SKIP
    if (effect.blendMode.blendFunction !== want) effect.blendMode.blendFunction = want
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
    if (!tv.on) return
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
    // Now and then the set acts up (lib/tv/glitch.ts): never over a cut, the
    // tunnel or tuning, and never with reduced motion asked for.
    // Nor over a commercial: the sponsor's spot plays clean.
    const held = since < CUT_MS || tv.jump?.phase === 'warp' || tv.status !== 'playing' || tv.ad !== null
    const g = reduced ? CALM : glitches.levels(now, held)
    u.get('uAberr')!.value = g.aberration
    u.get('uTear')!.value = g.tear
    u.get('uTearSeed')!.value = g.tearSeed
    u.get('uDrop')!.value = g.dropout

    if (now - lastPaint.current < PAINT_MS) return
    lastPaint.current = now
    const { width, height } = state.size
    const scale = Math.min(PAINT_SCALE, state.gl.getPixelRatio(), Math.sqrt(PAINT_MAX_PIXELS / Math.max(1, width * height)))
    // A new size needs a new texture: three.js keeps the storage it first
    // made, and copying a larger canvas into it fails on the GPU, which left
    // the furniture frozen after a rotation or the phone's address bar
    // moving (review of #375).
    if (painter.size(width, height, scale)) overlay.dispose()
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
      music: nowPlaying(),
      hosaka: !tv.ad ? null : hosaka && hosaka.readyState >= 2 ? hosaka : pictureFor('/hosaka-poster.jpg'),
      hosakaMark: tv.ad ? pictureFor('/hosaka-mark.png') : null,
    }
    painter.paint(tv, assets, now, scale, reduced)
    overlay.needsUpdate = true
  })
  return <primitive object={effect} />
}
