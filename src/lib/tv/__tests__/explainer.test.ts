/**
 * explainer.test.ts: an explainer's turn, its file, its hash, its guard, and
 * where the live picture and the video sit on the tube (lib/tv/explainer).
 */
import { describe, expect, it } from 'vitest'
import {
  EXPLAINER_IN_MS, EXPLAINER_MAX_MS, EXPLAINER_OUT_MS, cueAt, explainerLayout, explainerMix, fileHash, forcedExplainer,
  guardMs, lerpRect, nextExplainer, parseVtt, playableFiles, type Explainer,
} from '../explainer'
import { EXPLAINERS } from '../explainerLineup'
import { MARGIN_X, MARGIN_Y } from '../../../scene/tvPainter'

const H = 'a'.repeat(64)
const ex = (id: string): Explainer => ({ id, title: id.toUpperCase(), duration: 40, files: [{ url: `https://b.example/${H}.webm`, type: 'video/webm' }] })

describe('explainer lineup', () => {
  it('an empty lineup plays nothing', () => {
    expect(nextExplainer([], null)).toBeNull()
  })

  it('every entry in the lineup can play: a unique id, a hash for every file, a length, captions on the site or https', () => {
    const ids = new Set<string>()
    for (const e of EXPLAINERS) {
      expect(ids.has(e.id)).toBe(false)
      ids.add(e.id)
      expect(e.id).toMatch(/^\d+-[a-z0-9-]+$/)
      expect(e.title.length).toBeGreaterThan(0)
      expect(e.duration).toBeGreaterThan(0)
      expect(guardMs(e)).toBeLessThan(EXPLAINER_MAX_MS)
      expect(e.files.length).toBeGreaterThan(0)
      for (const f of e.files) {
        expect(f.url).toMatch(/^https:\/\//)
        expect(fileHash(f)).toMatch(/^[0-9a-f]{64}$/)
        expect(f.type).toMatch(/^video\/(mp4|webm); codecs="/)
      }
      if (e.captions) expect(e.captions).toMatch(/^(https:\/\/|\/)/)
    }
  })

  it('takes the lineup in turn, round, and a forced one first', () => {
    const list = [ex('1-a'), ex('2-b'), ex('3-c')]
    expect(nextExplainer(list, null)?.id).toBe('1-a')
    expect(nextExplainer(list, '1-a')?.id).toBe('2-b')
    expect(nextExplainer(list, '3-c')?.id).toBe('1-a')
    // An id no longer in it (an old one after a release) starts it over.
    expect(nextExplainer(list, 'gone')?.id).toBe('1-a')
    expect(nextExplainer(list, null, '2-b')?.id).toBe('2-b')
    // A forced id that is not in the lineup is ignored.
    expect(nextExplainer(list, null, 'nope')?.id).toBe('1-a')
    // Never the same twice running, with more than one.
    let last: string | null = null
    for (let i = 0; i < 9; i++) {
      const n: string = nextExplainer(list, last)!.id
      expect(n).not.toBe(last)
      last = n
    }
  })

  it('reads the forcing query', () => {
    expect(forcedExplainer('?broadcast=1&explainer=1-a')).toBe('1-a')
    expect(forcedExplainer('?explainer=')).toBeNull()
    expect(forcedExplainer('')).toBeNull()
  })
})

describe('explainer files', () => {
  it('takes the hash from the entry, else from a Blossom link', () => {
    expect(fileHash({ url: 'https://x/v.webm', type: 'video/webm', sha256: H.toUpperCase() })).toBe(H)
    expect(fileHash({ url: `https://blossom.band/${H}.webm`, type: 'video/webm' })).toBe(H)
    expect(fileHash({ url: `https://blossom.band/${H}`, type: 'video/webm' })).toBe(H)
    expect(fileHash({ url: `https://blossom.band/${H}.mp4?x=1`, type: 'video/mp4' })).toBe(H)
    expect(fileHash({ url: 'https://x/v.webm', type: 'video/webm' })).toBeNull()
    // A bad given hash is not a hash.
    expect(fileHash({ url: 'https://x/v.webm', type: 'video/webm', sha256: 'zz' })).toBeNull()
  })

  it('plays what the browser says it can, sure before maybe, each in the lineup order', () => {
    const files = [
      { url: 'a', type: 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"' },
      { url: 'b', type: 'video/webm; codecs="vp9, opus"' },
      { url: 'c', type: 'video/webm; codecs="av01.0.05M.08, opus"' },
      { url: 'd', type: 'video/webm; codecs="vp9, opus"' },
    ]
    // A Chromium without the proprietary codecs (the stream's, perhaps).
    const can = (t: string): string => (t.includes('vp9') ? 'probably' : t.includes('av01') ? 'maybe' : '')
    expect(playableFiles(files, can).map((f) => f.url)).toEqual(['b', 'd', 'c'])
    expect(playableFiles(files, () => '')).toEqual([])
  })

  it('guards an explainer for its length and some, never past the most', () => {
    expect(guardMs(ex('1-a'))).toBe(EXPLAINER_IN_MS + 40_000 + 10_000)
    expect(guardMs({ ...ex('1-a'), duration: 3600 })).toBe(EXPLAINER_MAX_MS)
    expect(guardMs({ ...ex('1-a'), duration: NaN })).toBe(EXPLAINER_MAX_MS)
  })
})

describe('explainer transitions', () => {
  it('shrinks the picture in, holds, and grows it back, smoothly', () => {
    expect(explainerMix(null, 0, 5)).toBe(0)
    expect(explainerMix('in', 1000, 1000)).toBe(0)
    const mid = explainerMix('in', 1000, 1000 + EXPLAINER_IN_MS / 2)
    expect(mid).toBeCloseTo(0.5, 5)
    expect(explainerMix('in', 1000, 1000 + EXPLAINER_IN_MS)).toBe(1)
    expect(explainerMix('play', 0, 1e9)).toBe(1)
    expect(explainerMix('out', 1000, 1000)).toBe(1)
    expect(explainerMix('out', 1000, 1000 + EXPLAINER_OUT_MS)).toBe(0)
    // A failed one goes in its own, shorter time.
    expect(explainerMix('out', 0, 300, 300)).toBe(0)
    // Never outside 0..1, and never jumps: each step of a frame is small.
    let prev = 0
    for (let t = 0; t <= EXPLAINER_IN_MS; t += 16) {
      const m = explainerMix('in', 0, t)
      expect(m).toBeGreaterThanOrEqual(prev)
      expect(m - prev).toBeLessThan(0.03)
      prev = m
    }
  })

  it('lerps a rectangle from the whole tube to its corner', () => {
    const a = { x: 0, y: 0, w: 100, h: 50 }
    const b = { x: 10, y: 10, w: 30, h: 15 }
    expect(lerpRect(a, b, 0)).toEqual(a)
    expect(lerpRect(a, b, 1)).toEqual(b)
    expect(lerpRect(a, b, 0.5)).toEqual({ x: 5, y: 5, w: 65, h: 32.5 })
  })
})

describe('explainer layout', () => {
  const floorOf = (h: number): number => h - h * MARGIN_Y - 28

  it('on a wide tube: the live picture top left on the margins, clear of the logo, the video the whole tube', () => {
    for (const [w, h] of [[1280, 720], [1920, 1080], [1440, 900]]) {
      const { pip, video } = explainerLayout(w, h, 16 / 9, MARGIN_X, MARGIN_Y, floorOf(h))
      expect(pip.x).toBe(Math.round(w * MARGIN_X))
      expect(pip.y).toBe(Math.round(h * MARGIN_Y))
      expect(pip.w / pip.h).toBeCloseTo(w / h, 5)
      // Left of the logo's column, at its widest (LOGO_SHARE of the frame).
      expect(pip.x + pip.w).toBeLessThan(w - w * MARGIN_X - Math.min(260 * 1.35, w * 0.42))
      expect(video.w).toBeLessThanOrEqual(w + 1e-6)
      expect(video.h).toBeLessThanOrEqual(h + 1e-6)
      expect(Math.max(video.w / w, video.h / h)).toBeCloseTo(1, 5)
    }
  })

  it('on a phone held upright, with EXPLAINER_PIP_ENABLED: the video under the live picture, above the marquee', () => {
    const [w, h] = [390, 844]
    const { pip, video } = explainerLayout(w, h, 16 / 9, MARGIN_X, MARGIN_Y, floorOf(h), true)
    expect(pip.w).toBeCloseTo(w * 0.36, 5)
    expect(pip.x + pip.w).toBeLessThan(w - w * MARGIN_X - w * 0.42)
    expect(video.w).toBeCloseTo(w, 5)
    expect(video.y).toBeGreaterThanOrEqual(pip.y + pip.h)
    expect(video.y + video.h).toBeLessThanOrEqual(floorOf(h))
  })

  it("on a phone held upright, the default (EXPLAINER_PIP_ENABLED off): centred, not nudged down for a picture that is not there (arkinox, 2026-10-24: \"truly fullscreen\")", () => {
    const [w, h] = [390, 844]
    const { pip, video } = explainerLayout(w, h, 16 / 9, MARGIN_X, MARGIN_Y, floorOf(h))
    expect(video.w).toBeCloseTo(w, 5)
    expect(video.y).toBeCloseTo((h - video.h) / 2, 5)
    // Centred puts it higher than the old nudge-down did, clear above the live picture's corner.
    expect(video.y).toBeLessThan(pip.y + pip.h)
    // Explicitly off is the same as the default.
    expect(explainerLayout(w, h, 16 / 9, MARGIN_X, MARGIN_Y, floorOf(h), false)).toEqual({ pip, video })
  })

  it('a tall video in a wide tube is as tall as the tube, centred', () => {
    const { video } = explainerLayout(1280, 720, 9 / 16, MARGIN_X, MARGIN_Y, floorOf(720))
    expect(video.h).toBe(720)
    expect(video.x + video.w / 2).toBeCloseTo(640, 5)
  })

  it('a video of no known shape is laid out as 16:9', () => {
    const a = explainerLayout(1280, 720, NaN, MARGIN_X, MARGIN_Y, floorOf(720))
    const b = explainerLayout(1280, 720, 16 / 9, MARGIN_X, MARGIN_Y, floorOf(720))
    expect(a).toEqual(b)
  })
})

describe('explainer captions', () => {
  const vtt = `WEBVTT

1
00:00:00.500 --> 00:00:02.000 align:center
Welcome to <b>cyberspace</b>.

00:02.000 --> 00:04.250
Every move
is a proof of work.

NOTE a comment

bad --> cue
skipped
`
  it('reads every cue, its tags and settings dropped, its lines joined', () => {
    expect(parseVtt(vtt)).toEqual([
      { from: 0.5, to: 2, text: 'Welcome to cyberspace.' },
      { from: 2, to: 4.25, text: 'Every move is a proof of work.' },
    ])
    expect(parseVtt('')).toEqual([])
  })

  it('finds the caption at a moment', () => {
    const cues = parseVtt(vtt)
    expect(cueAt(cues, 0.2)).toBeNull()
    expect(cueAt(cues, 1)).toBe('Welcome to cyberspace.')
    expect(cueAt(cues, 2)).toBe('Every move is a proof of work.')
    expect(cueAt(cues, 9)).toBeNull()
  })
})
