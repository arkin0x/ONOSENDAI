/**
 * voiceCard.test.tsx: hidden audio as a voice line (owner, 2026-11-26: "the
 * audio look is amazing from the hidden message looks. lets replace audio
 * with this"): the large waveform is the scrubber. A tap on it moves the play
 * there, or starts PLAY there; the arrow keys step through it; its bars are
 * the file's own once known and light up as it plays. PLAY and DOWNLOAD stay.
 *
 * Mounted for real (test/elementRoot.ts), the player's store spied. No network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
;(globalThis as { window?: unknown }).window ??= globalThis

const player = vi.hoisted(() => ({ seeks: [] as Array<[string, number]>, plays: [] as string[], playing: false }))
vi.mock('../../store/useHiddenAudio', async (real) => ({
  ...(await real<object>()),
  seekCard: (id: string, t: number) => { player.seeks.push([id, t]); return player.playing },
  playAudio: async (id: string) => { player.plays.push(id) },
}))

import { createElement } from 'react'
import { mount, settled, type Host, type Mounted } from '../../test/elementRoot'
import { AudioCard } from '../AudioCard'
import { forgetWaves, setWave } from '../../store/useWaveforms'
import { WAVE_BARS } from '../../lib/waveform'
import type { AudioItem } from '../../lib/audioItem'

const audio: AudioItem = {
  title: 'Night lattice', about: 'Recorded where the column used to be.', url: 'https://blossom.test/' + 'ab'.repeat(32), mime: 'audio/mpeg', hash: 'ab'.repeat(32),
  // Too large to decode for its shape here: nothing is fetched by the test.
  originalHash: '', size: 9 * 1024 * 1024, keyHex: 'ef'.repeat(32), nonceHex: '01'.repeat(12), autoplay: false, loop: false, retrigger: 'once', walkOnly: false,
}

let m: Mounted | null = null
beforeEach(() => {
  player.seeks = []
  player.plays = []
  player.playing = false
  forgetWaves()
})
afterEach(async () => { await m?.unmount(); m = null })

const slider = (r: Mounted): Host => r.all().find((h) => h.props.role === 'slider')!
const bars = (r: Mounted): Host[] => r.all().filter((h) => h.type === 'i' && r.all().some((p) => p.props.className === 'wave__bars' && p.children.includes(h)))
/** A tap on the waveform `fraction` of the way across a 200 px track. */
function tapAt(r: Mounted, fraction: number): void {
  const h = slider(r) as Host & { getBoundingClientRect?: () => { left: number; width: number } }
  h.getBoundingClientRect = () => ({ left: 100, width: 200 })
  ;(h.props.onPointerDown as (e: unknown) => void)({ clientX: 100 + 200 * fraction, pointerId: 1, currentTarget: { setPointerCapture: () => {} } })
}

describe('the voice line', () => {
  it('keeps PLAY and DOWNLOAD, the title and the written line, and a waveform the size of a fingertip drag', async () => {
    m = await mount(createElement(AudioCard, { id: 'k', triggerId: 't', audio }))
    expect(m.says('Night lattice')).toBe(true)
    expect(m.says('Recorded where the column used to be.')).toBe(true)
    expect(m.buttons('PLAY')).toHaveLength(1)
    expect(m.buttons('DOWNLOAD')).toHaveLength(1)
    expect(slider(m).props['aria-label']).toContain('Night lattice')
    expect(bars(m)).toHaveLength(WAVE_BARS)
  })

  it('draws a stand-in shape before the file is known, then the file’s own with its length', async () => {
    m = await mount(createElement(AudioCard, { id: 'k', triggerId: 't', audio }))
    expect(String(slider(m).props.className)).toContain('wave--standin')
    expect(m.says('-:--')).toBe(true)
    setWave(audio.hash, new Array(WAVE_BARS).fill(0.5), 118)
    await settled()
    expect(String(slider(m).props.className)).not.toContain('wave--standin')
    expect(m.says('1:58')).toBe(true)
  })

  it('a tap on the waveform before PLAY starts the file there', async () => {
    setWave(audio.hash, new Array(WAVE_BARS).fill(0.5), 120)
    m = await mount(createElement(AudioCard, { id: 'k', triggerId: 't', audio }))
    tapAt(m, 0.25)
    await settled()
    expect(player.seeks).toEqual([['k', 30]])
    expect(player.plays).toEqual(['k'])
    // The played part lights to where it will play from.
    expect(bars(m).filter((b) => b.props.className === 'is-on')).toHaveLength(18)
    expect(slider(m).props['aria-valuenow']).toBe(30)
  })

  it('a tap while it plays moves the play there and starts nothing new', async () => {
    setWave(audio.hash, new Array(WAVE_BARS).fill(0.5), 120)
    player.playing = true
    m = await mount(createElement(AudioCard, { id: 'k', triggerId: 't', audio }))
    tapAt(m, 0.5)
    await settled()
    expect(player.seeks).toEqual([['k', 60]])
    expect(player.plays).toEqual([])
  })

  it('the arrow keys step five seconds, Home and End go to the ends', async () => {
    setWave(audio.hash, new Array(WAVE_BARS).fill(0.5), 100)
    player.playing = true
    m = await mount(createElement(AudioCard, { id: 'k', triggerId: 't', audio }))
    const key = async (k: string): Promise<void> => { (slider(m!).props.onKeyDown as (e: unknown) => void)({ key: k, preventDefault: () => {} }); await settled() }
    await key('ArrowRight')
    await key('ArrowRight')
    await key('ArrowLeft')
    await key('End')
    await key('Home')
    expect(player.seeks.map(([, t]) => t)).toEqual([5, 10, 5, 100, 0])
  })
})
