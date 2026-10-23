/**
 * nowPlaying.test.ts: NOW PLAYING and TAP FOR SOUND (hidden audio step 2).
 * Every cyberspace sound is listed, TV's music included; a world voice
 * waiting for a tap is not playing yet, and TAP FOR SOUND counts it; only
 * a card's PLAY can be stopped from its row.
 */

import { beforeEach, describe, expect, it } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { NowPlayingChip, SoundChip, playingRows, waitingCount } from '../NowPlaying'
import { cardKey, useHiddenAudio, worldKey, type AudioEntry } from '../../store/useHiddenAudio'
import { useTvMusic } from '../../store/useTvMusic'

const entries: Record<string, AudioEntry> = {
  [worldKey('w1')]: { phase: 'playing', title: 'Trickling water', mode: 'world', itemKey: 'w1' },
  [worldKey('w2')]: { phase: 'waiting', title: 'Temple drone', mode: 'world', itemKey: 'w2' },
  [cardKey('c1')]: { phase: 'playing', title: 'Bell', mode: 'card', itemKey: 'c1' },
  [cardKey('c2')]: { phase: 'error', title: 'Broken', mode: 'card', itemKey: 'c2', error: 'x' },
}

beforeEach(() => {
  useHiddenAudio.setState({ entries: {} })
  useTvMusic.setState({ track: null, muted: false })
})

describe('what is playing', () => {
  it('lists hidden voices that sound, then TV, and never one waiting for a tap or failed', () => {
    const rows = playingRows(entries, { title: 'Acid Bench', artist: 'Sethy Bowoy' }, false)
    expect(rows.map((r) => [r.title, r.meta, r.stoppable])).toEqual([
      ['Trickling water', 'here', false],
      ['Bell', 'from its card', true],
      ['Acid Bench · Sethy Bowoy', 'Cyberspace TV', false],
    ])
    expect(rows[0].itemKey).toBe('w1')
    expect(rows[2].itemKey).toBeUndefined()
    expect(playingRows({}, { title: 'Song', artist: '' }, true)[0]).toMatchObject({ title: 'Song', meta: 'Cyberspace TV · muted' })
    expect(waitingCount(entries)).toBe(1)
  })

  it('neither chip draws anything while nothing plays or waits (the store as a page first renders it; the browser check covers the rest)', () => {
    expect(renderToString(createElement(NowPlayingChip))).toBe('')
    expect(renderToString(createElement(SoundChip))).toBe('')
  })
})
