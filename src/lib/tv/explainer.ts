/**
 * explainer.ts: how Cyberspace TV rolls an explainer (arkinox, 2026-10-23:
 * "I'm thinking we minimize the cyberspace TV scene to a PIP and then we
 * roll the video fullscreen (but still VHS-style with the same rounded
 * border, CRT effect, and other effects.) Once the tutorial video is over
 * (30s-1m) then the normal broadcast comes back to full picture.").
 *
 * The live picture shrinks into the top left corner, where the minimap
 * stands (it steps away meanwhile), and keeps playing there; the video
 * fills the tube behind it, through the same glass (scene/TvScreenEffect),
 * so it is curved, fringed, scanlined and glitched as the picture is. The
 * logo, the clock and the marquee stay; the chiron, NOW PLAYING and a
 * segment's panels, which are about the live picture, step away with the
 * minimap. When the video ends the picture grows back to the whole tube.
 *
 * When (EXPLAINER_EVERY_MS): one every ten minutes of TV, the first a little
 * after TV comes on, the lineup in turn. One waits for the song playing to
 * end, so none cuts a song off, and the next song waits for it; after
 * EXPLAINER_MUSIC_WAIT_MS of waiting the song fades out instead, and comes
 * back where it was. Never within EXPLAINER_AD_GAP_MS of the ad break
 * (lib/tv/hosakaAd; whichever spot is due), either side: a spot that comes
 * due meanwhile waits for it.
 *
 * Nothing on screen changes until the video is loaded and ready: one that
 * will not load, or fails its hash, is skipped and TV plays on as it was. One
 * that stalls or errors while it plays, or runs past its own length, gives
 * the picture straight back (store/useTvExplainer).
 *
 * The lineup itself is data (lib/tv/explainerLineup).
 */

/** One file of an explainer: where it is, what it is, and its hash. */
export interface ExplainerFile {
  url: string
  /** Its type with codecs, as canPlayType takes it: 'video/webm; codecs="vp9, opus"'. */
  type: string
  /** Its sha256, hex; read from the link when the link ends in it (Blossom). */
  sha256?: string
}

/** One explainer (lib/tv/explainerLineup). */
export interface Explainer {
  /** Stable, versioned: `<n>-<name>`. /tv?explainer=<id> plays it first. */
  id: string
  /** What the tag under the live picture says. */
  title: string
  /** Its length, seconds: what the guard allows it. */
  duration: number
  /** The same video, in the order to try. */
  files: ExplainerFile[]
  /** A WebVTT file's link, optional. */
  captions?: string
}

/** How often, ms of TV on: one every ten minutes. */
export const EXPLAINER_EVERY_MS = 20 * 60_000
/** The first, ms after TV comes on: a few shots in, before a short visit is over. */
export const EXPLAINER_FIRST_MS = 2 * 60_000
/** How long one waits for the song playing to end before fading it out instead, ms. */
export const EXPLAINER_MUSIC_WAIT_MS = 4 * 60_000
/** How long the video may take to come and be ready, ms; then it is skipped. */
export const EXPLAINER_LOAD_MS = 90_000
/** How long after one that did not play the next is tried, ms. */
export const EXPLAINER_RETRY_MS = 5 * 60_000
/** The least time between an explainer and the HOSAKA spot, either way round, ms. */
export const EXPLAINER_AD_GAP_MS = 90_000
/** How long the live picture takes to shrink into its corner, and to grow back, ms. */
export const EXPLAINER_IN_MS = 1200
export const EXPLAINER_OUT_MS = 1200
/** How fast it grows back when the video fails, ms: straight back, no black between. */
export const EXPLAINER_FAIL_OUT_MS = 300
/** How long the video may go without moving on before it counts as stalled, ms. */
export const EXPLAINER_STALL_MS = 5_000
/** What the guard allows past an explainer's own length, ms, and the most it allows in all. */
export const EXPLAINER_GUARD_SLACK_MS = 10_000
export const EXPLAINER_MAX_MS = 3 * 60_000
/** The largest file loaded, bytes: an explainer is under a minute. */
export const EXPLAINER_MAX_BYTES = 80 * 1024 * 1024

/** The query that plays one first, for a look at it: /tv?explainer=<id>. */
export const EXPLAINER_PARAM = 'explainer'
/** How long after TV comes on a forced one is due, ms: once the first shot is up. */
export const EXPLAINER_FORCED_MS = 4_000

/** The id an address asks to play first, or null. */
export function forcedExplainer(search: string): string | null {
  try {
    const v = new URLSearchParams(search).get(EXPLAINER_PARAM)
    return v ? v : null
  } catch {
    return null
  }
}

/** The explainer after `last`, round the lineup; `first` if it is in it and none has played. Null for an empty lineup. */
export function nextExplainer(lineup: Explainer[], last: string | null, first: string | null = null): Explainer | null {
  if (lineup.length === 0) return null
  if (last === null && first !== null) {
    const f = lineup.find((e) => e.id === first)
    if (f) return f
  }
  const i = last === null ? -1 : lineup.findIndex((e) => e.id === last)
  return lineup[(i + 1) % lineup.length]
}

/** A file's sha256: its own, else a 64-hex name at the end of its link (Blossom), else null. Lower case. */
export function fileHash(f: ExplainerFile): string | null {
  if (f.sha256 && /^[0-9a-f]{64}$/i.test(f.sha256)) return f.sha256.toLowerCase()
  let path = f.url
  try { path = new URL(f.url, 'https://x.invalid').pathname } catch { /* as it is */ }
  const m = /([0-9a-f]{64})(?:\.[a-z0-9]+)?$/i.exec(path)
  return m ? m[1].toLowerCase() : null
}

/** The files this browser says it can play, best first: 'probably' before 'maybe', each kind in the lineup's order. */
export function playableFiles(files: ExplainerFile[], canPlay: (type: string) => string): ExplainerFile[] {
  const sure = files.filter((f) => canPlay(f.type) === 'probably')
  const maybe = files.filter((f) => canPlay(f.type) === 'maybe')
  return [...sure, ...maybe]
}

/** How long the guard lets one run once it is on screen, ms: its length and some, at most EXPLAINER_MAX_MS. */
export function guardMs(ex: Explainer): number {
  const own = Number.isFinite(ex.duration) && ex.duration > 0 ? ex.duration * 1000 : EXPLAINER_MAX_MS
  return Math.min(EXPLAINER_MAX_MS, EXPLAINER_IN_MS + own + EXPLAINER_GUARD_SLACK_MS)
}

/** Where an explainer is: shrinking the picture in, playing, or giving it back. */
export type ExplainerPhase = 'in' | 'play' | 'out'

/** Ease in and out. */
function ease(k: number): number {
  const t = Math.min(1, Math.max(0, k))
  return t * t * (3 - 2 * t)
}

/**
 * How far into its corner the live picture is at `now`, 0 (the whole tube)
 * to 1 (in the corner, the video behind it).
 */
export function explainerMix(phase: ExplainerPhase | null, at: number, now: number, outMs: number = EXPLAINER_OUT_MS): number {
  if (phase === null) return 0
  if (phase === 'in') return ease((now - at) / EXPLAINER_IN_MS)
  if (phase === 'play') return 1
  return 1 - ease((now - at) / Math.max(1, outMs))
}

/** A rectangle on the flat frame, CSS px, top left. */
export interface Rect { x: number; y: number; w: number; h: number }

/** The live picture's share of the tube's width in its corner: on a phone, a little more. */
export const PIP_SHARE = 0.3
export const NARROW_PIP_SHARE = 0.36
/** The gap between the live picture and the video under it, CSS px, where there is room for one: the title's tag stands in it. */
const PIP_GAP_PX = 36

/**
 * Where the live picture sits in its corner and where the video sits, on the
 * flat frame `w` x `h` (CSS px), with the margins everything takes
 * (scene/tvPainter MARGIN_X, MARGIN_Y) and the marquee's top `floor` from
 * the top. The picture is the whole tube made small, top left. The video is
 * as large as the tube holds whole; where the tube is taller than the video
 * (a phone held upright), it sits under the picture rather than behind it,
 * and above the marquee, as far as there is room.
 */
export function explainerLayout(w: number, h: number, videoAspect: number, marginX: number, marginY: number, floor: number): { pip: Rect; video: Rect } {
  const share = w < 600 ? NARROW_PIP_SHARE : PIP_SHARE
  const pip: Rect = { x: Math.round(w * marginX), y: Math.round(h * marginY), w: w * share, h: h * share }
  const aspect = Number.isFinite(videoAspect) && videoAspect > 0 ? videoAspect : 16 / 9
  let vw = w
  let vh = w / aspect
  if (vh > h) { vh = h; vw = h * aspect }
  let top = (h - vh) / 2
  if (vh < h) {
    const under = pip.y + pip.h + PIP_GAP_PX
    const lowest = Math.max(top, floor - PIP_GAP_PX - vh)
    if (top < under) top = Math.min(under, lowest)
  }
  return { pip, video: { x: (w - vw) / 2, y: top, w: vw, h: vh } }
}

/** A rectangle between `a` (at 0) and `b` (at 1). */
export function lerpRect(a: Rect, b: Rect, k: number): Rect {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k }
}

/** One caption: from, to, seconds into the video, and its words. */
export interface Cue { from: number; to: number; text: string }

/** Seconds from a WebVTT time: `mm:ss.ttt` or `hh:mm:ss.ttt`. */
function vttTime(t: string): number {
  const parts = t.trim().split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return NaN
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

/** The captions in a WebVTT file: every cue's times and words, the words on one line. Cue settings and tags dropped. */
export function parseVtt(text: string): Cue[] {
  const cues: Cue[] = []
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '')
    const at = lines.findIndex((l) => l.includes('-->'))
    if (at < 0) continue
    const [a, rest] = lines[at].split('-->')
    const from = vttTime(a)
    const to = vttTime(rest.trim().split(/\s+/)[0] ?? '')
    const words = lines.slice(at + 1).join(' ').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    if (Number.isFinite(from) && Number.isFinite(to) && to > from && words) cues.push({ from, to, text: words })
  }
  return cues
}

/** The caption at `t` seconds into the video, or null. */
export function cueAt(cues: Cue[], t: number): string | null {
  for (const c of cues) if (t >= c.from && t < c.to) return c.text
  return null
}
