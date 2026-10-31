/**
 * broadcastPortrait.test.ts: the upright stream (arkinox, 2026-10-30):
 * /tv?broadcast=1&layout=portrait is TV laid out for a 720 x 1280 frame, and
 * nothing else is. The 16:9 stream, every other address and the site's TV
 * read as they did before the flag existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BROADCAST_LAYOUT, PORTRAIT_FRAME, broadcastScale, broadcastText, isBroadcast, isPortraitBroadcast, markBroadcastPage, parseBroadcastLayout, portraitFov, setBroadcastForTest } from '../broadcast'
import { FOV } from '../../../scene/camera'

let win: { location: { pathname: string; search: string } }
const at = (pathname: string, search: string): void => {
  win = { location: { pathname, search } }
  vi.stubGlobal('window', win)
  setBroadcastForTest(null)
}

beforeEach(() => at('/tv', '?broadcast=1&layout=portrait&text=large'))
afterEach(() => {
  setBroadcastForTest(null)
  vi.unstubAllGlobals()
})

describe('the layout query', () => {
  it('is portrait for exactly layout=portrait, and landscape for anything else', () => {
    expect(BROADCAST_LAYOUT).toEqual(['landscape', 'portrait'])
    expect(parseBroadcastLayout('?broadcast=1&layout=portrait')).toBe('portrait')
    expect(parseBroadcastLayout('?layout=portrait&broadcast=1&text=xl')).toBe('portrait')
    expect(parseBroadcastLayout('?broadcast=1')).toBe('landscape')
    expect(parseBroadcastLayout('')).toBe('landscape')
    expect(parseBroadcastLayout('?broadcast=1&layout=landscape')).toBe('landscape')
    expect(parseBroadcastLayout('?broadcast=1&layout=PORTRAIT')).toBe('landscape')
    expect(parseBroadcastLayout('?broadcast=1&layout=square')).toBe('landscape')
    expect(parseBroadcastLayout('?broadcast=1&layout=')).toBe('landscape')
  })

  it('names the frame the streamer\'s upright window is', () => {
    expect(PORTRAIT_FRAME).toEqual({ width: 720, height: 1280 })
  })
})

describe('the upright stream', () => {
  it('is the broadcast with layout=portrait, read from the address the page loaded on', () => {
    expect(isBroadcast()).toBe(true)
    expect(isPortraitBroadcast()).toBe(true)
    // TV's own history writes do not switch it.
    win.location = { pathname: '/tv', search: '' }
    expect(isPortraitBroadcast()).toBe(true)
  })

  it('is never the site\'s TV, whatever the address says', () => {
    at('/tv', '?layout=portrait&text=large')
    expect(isBroadcast()).toBe(false)
    expect(isPortraitBroadcast()).toBe(false)
    at('/', '?broadcast=1&layout=portrait')
    expect(isPortraitBroadcast()).toBe(false)
    setBroadcastForTest(false, 'large', 'portrait')
    expect(isPortraitBroadcast()).toBe(false)
  })

  it('is not the 16:9 stream: no layout, or any other, is landscape', () => {
    for (const search of ['?broadcast=1', '?broadcast=1&text=large', '?broadcast=1&layout=landscape&text=large', '?broadcast=1&layout=tall']) {
      at('/tv', search)
      expect(isBroadcast(), search).toBe(true)
      expect(isPortraitBroadcast(), search).toBe(false)
    }
  })

  it('keeps the text size it asks for, and its sizes are the 16:9 stream\'s share of the frame', () => {
    expect(broadcastText()).toBe(2.25)
    // The rule every size follows (lib/tv/broadcast broadcastScale): at 720
    // wide the same share of the frame as at 1920, so a phone showing either
    // frame full width reads the same size.
    expect(broadcastScale(0.9, PORTRAIT_FRAME.width, 1.35) * 0.9 / PORTRAIT_FRAME.width).toBeCloseTo(broadcastScale(1.35, 1920, 1.35) * 1.35 / 1920, 9)
  })

  it('marks the page as every stream is, and the site\'s not at all', () => {
    const classes = new Set<string>()
    vi.stubGlobal('document', { documentElement: { classList: { add: (c: string) => classes.add(c) } } })
    markBroadcastPage()
    expect([...classes]).toEqual(['tv-broadcast'])
    classes.clear()
    at('/tv', '?layout=portrait')
    markBroadcastPage()
    expect(classes.size).toBe(0)
  })
})

describe('the upright camera (portraitFov)', () => {
  it('is as wide across as the 16:9 camera is tall, so a subject spans the narrow frame as it spans the wide one', () => {
    const aspect = PORTRAIT_FRAME.width / PORTRAIT_FRAME.height
    const v = portraitFov(FOV, aspect)
    const across = (2 * Math.atan(Math.tan((v * Math.PI) / 360) * aspect) * 180) / Math.PI
    expect(across).toBeCloseTo(FOV, 9)
    expect(v).toBeGreaterThan(FOV)
    expect(v).toBeLessThan(90)
  })

  it('leaves a frame as wide as it is tall, or wider, and nonsense, at the angle it was given', () => {
    expect(portraitFov(FOV, 1)).toBe(FOV)
    expect(portraitFov(FOV, 16 / 9)).toBe(FOV)
    expect(portraitFov(FOV, 0)).toBe(FOV)
    expect(portraitFov(FOV, Number.NaN)).toBe(FOV)
    expect(portraitFov(FOV, -1)).toBe(FOV)
  })
})
