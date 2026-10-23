/**
 * audioCard.test.ts: hidden audio's card (DECK-0007): PLAY and DOWNLOAD
 * always, RESET TRIGGER only for a one-shot that plays itself once, the marks
 * that say how it is heard, and the row MUTE AUDIO and BLOCK AUTHOR go in.
 */

import { describe, expect, it } from 'vitest'

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
import { AudioCard, audioMarks } from '../AudioCard'
import { eventJson, HIDDEN_SECRET, shownEvent } from '../EventData'
import { audioInnerTemplate } from '../../lib/audioItem'
import type { AudioItem } from '../../lib/audioItem'

const audio: AudioItem = {
  title: 'Eerie temple', about: 'listen at the altar', url: 'https://blossom.test/' + 'ab'.repeat(32), mime: 'audio/mpeg', hash: 'ab'.repeat(32),
  originalHash: '', size: 3 * 1024 * 1024, keyHex: 'ef'.repeat(32), nonceHex: '01'.repeat(12), autoplay: true, loop: true, retrigger: 'once', walkOnly: false,
}
const card = (a: AudioItem, moderation?: unknown): string => renderToString(createElement(AudioCard, { id: 'k', triggerId: 't', audio: a, moderation: moderation as never }))

describe('the audio card', () => {
  it('always offers PLAY and DOWNLOAD, with the title and the caption', () => {
    const html = card(audio)
    expect(html).toContain('Eerie temple')
    expect(html).toContain('listen at the altar')
    expect(html).toContain('PLAY')
    expect(html).toContain('DOWNLOAD')
    expect(html).not.toContain('RESET TRIGGER')
  })

  it('offers RESET TRIGGER for a one-shot that plays itself once, and only then', () => {
    expect(card({ ...audio, loop: false })).toContain('RESET TRIGGER')
    expect(card({ ...audio, loop: false, retrigger: 'auto' })).not.toContain('RESET TRIGGER')
    expect(card({ ...audio, loop: false, autoplay: false })).not.toContain('RESET TRIGGER')
  })

  it('says how it is heard in short marks', () => {
    expect(audioMarks(audio)).toEqual(['LOOP', 'AUTOPLAY', 'MP3', '3.0 MB'])
    expect(audioMarks({ ...audio, loop: false, walkOnly: true, size: 2048 })).toEqual(['ONE-SHOT', 'FIRST ENTRY', 'WALK ONLY', 'MP3', '2 KB'])
    expect(audioMarks({ ...audio, loop: false, retrigger: 'auto', size: 0 })).toEqual(['ONE-SHOT', 'EVERY ENTRY', 'MP3'])
    expect(audioMarks({ ...audio, autoplay: false, size: 0 })).toEqual(['LOOP', 'ON TAP', 'MP3'])
  })

  it('the event data never shows the file key or nonce: the key is the file', () => {
    const t = audioInnerTemplate(audio, { x: 1n, y: 2n, z: 3n }, 0, 1)
    const ev = { ...t, id: '00'.repeat(32), pubkey: '11'.repeat(32), sig: '' }
    const shown = shownEvent(ev)
    expect(shown.which).toBe('audio')
    const json = eventJson(shown.event)
    expect(json).not.toContain(audio.keyHex)
    expect(json).not.toContain(audio.nonceHex)
    expect(shown.event.tags.find((x) => x[0] === 'decryption-key')?.[1]).toBe(HIDDEN_SECRET)
    expect(json).toContain(audio.url)
  })

  it('draws the moderation row only when given one: MUTE AUDIO and BLOCK AUTHOR go there', () => {
    expect(card(audio)).not.toContain('audio__moderation')
    const html = card(audio, createElement('button', null, 'MUTE AUDIO'))
    expect(html).toContain('audio__moderation')
    expect(html).toContain('MUTE AUDIO')
  })
})
