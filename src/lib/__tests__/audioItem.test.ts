/**
 * audioItem.test.ts: hidden audio's item (DECK-0007 §2): written, read back,
 * refused when it is not one, its file sealed and opened, and how loud it is
 * where the listener stands (§4).
 */

import { describe, expect, it } from 'vitest'
import {
  AUDIO_KIND, audioFileName, audioGain, audioInnerTemplate, audioItemOf, decryptAudioFile, encryptAudioFile, fadeRadius,
  fetchableUrl, inscribedRadius, insideRegion, regionBase, sourceLocal, titleFromFileName, type AudioItem, type Local,
} from '../audioItem'
import { positionHex } from '../events'
import { toneWav } from './audioFixture'

const at = { x: 90_000n, y: 4_000n, z: 71n }

const item: AudioItem = {
  title: 'Trickling water',
  about: 'from the east wall',
  url: 'https://blossom.test/' + 'ab'.repeat(32),
  mime: 'audio/mpeg',
  hash: 'ab'.repeat(32),
  originalHash: 'cd'.repeat(32),
  size: 1234,
  keyHex: 'ef'.repeat(32),
  nonceHex: '01'.repeat(12),
  autoplay: true,
  loop: true,
  retrigger: 'once',
  walkOnly: false,
}

const tag = (tags: string[][], name: string): string[] | undefined => tags.find((t) => t[0] === name)

describe('the item, written (DECK-0007 §2)', () => {
  it('is kind 1063 with NIP-94 file tags, NIP-17 encryption tags, its place and `-`', () => {
    const t = audioInnerTemplate(item, at, 0, 100)
    expect(t.kind).toBe(AUDIO_KIND)
    expect(t.content).toBe('from the east wall')
    expect(t.tags[0]).toEqual(['C', positionHex(at, 0)])
    expect(tag(t.tags, 'title')).toEqual(['title', 'Trickling water'])
    expect(tag(t.tags, 'url')).toEqual(['url', item.url])
    expect(tag(t.tags, 'm')).toEqual(['m', 'audio/mpeg'])
    expect(tag(t.tags, 'x')).toEqual(['x', item.hash])
    expect(tag(t.tags, 'ox')).toEqual(['ox', item.originalHash])
    expect(tag(t.tags, 'size')).toEqual(['size', '1234'])
    expect(tag(t.tags, 'encryption-algorithm')).toEqual(['encryption-algorithm', 'aes-gcm'])
    expect(tag(t.tags, 'decryption-key')).toEqual(['decryption-key', item.keyHex])
    expect(tag(t.tags, 'decryption-nonce')).toEqual(['decryption-nonce', item.nonceHex])
    expect(tag(t.tags, 'autoplay')).toEqual(['autoplay'])
    expect(tag(t.tags, 'loop')).toEqual(['loop'])
    expect(t.tags.filter((x) => x[0] === '-')).toEqual([['-']])
  })

  it('writes retrigger only on a one-shot, fade only when chosen, walk only when set', () => {
    const looped = audioInnerTemplate(item, at, 0, 1)
    expect(tag(looped.tags, 'retrigger')).toBeUndefined()
    expect(tag(looped.tags, 'fade')).toBeUndefined()
    expect(tag(looped.tags, 'walk')).toBeUndefined()
    const shot = audioInnerTemplate({ ...item, loop: false, retrigger: 'auto', fade: 12.7, walkOnly: true, autoplay: false }, at, 0, 1)
    expect(tag(shot.tags, 'loop')).toBeUndefined()
    expect(tag(shot.tags, 'autoplay')).toBeUndefined()
    expect(tag(shot.tags, 'retrigger')).toEqual(['retrigger', 'auto'])
    expect(tag(shot.tags, 'fade')).toEqual(['fade', '12'])
    expect(tag(shot.tags, 'walk')).toEqual(['walk'])
  })

  it('reads back as it was written', () => {
    const t = audioInnerTemplate(item, at, 0, 1)
    expect(audioItemOf(t)).toEqual(item)
    const shot = { ...item, loop: false, retrigger: 'auto' as const, fade: 40, walkOnly: true }
    expect(audioItemOf(audioInnerTemplate(shot, at, 0, 1))).toEqual(shot)
  })
})

describe('the item, read (DECK-0007 §2.2)', () => {
  const base = audioInnerTemplate(item, at, 0, 1)
  const without = (name: string): typeof base => ({ ...base, tags: base.tags.filter((t) => t[0] !== name) })
  const replaced = (name: string, value: string): typeof base => ({ ...base, tags: base.tags.map((t) => (t[0] === name ? [name, value] : t)) })

  it('is refused unless it is encrypted audio this client can fetch', () => {
    expect(audioItemOf({ ...base, kind: 1 })).toBeNull()
    expect(audioItemOf(without('encryption-algorithm'))).toBeNull()
    expect(audioItemOf(replaced('encryption-algorithm', 'chacha20'))).toBeNull()
    expect(audioItemOf(without('decryption-key'))).toBeNull()
    expect(audioItemOf(replaced('decryption-key', 'ef'.repeat(16)))).toBeNull()
    expect(audioItemOf(replaced('decryption-nonce', '01'.repeat(16)))).toBeNull()
    expect(audioItemOf(replaced('m', 'image/png'))).toBeNull()
    expect(audioItemOf(without('m'))).toBeNull()
    expect(audioItemOf(replaced('x', 'zz'))).toBeNull()
    expect(audioItemOf(without('url'))).toBeNull()
    expect(audioItemOf(replaced('url', 'http://blossom.test/a'))).toBeNull()
    expect(audioItemOf(replaced('url', 'javascript:alert(1)'))).toBeNull()
    expect(audioItemOf({ ...base, tags: 'nope' as unknown as string[][] })).toBeNull()
  })

  it('reads what is optional as absent, and a malformed fade or retrigger as the default', () => {
    expect(audioItemOf(without('ox'))?.originalHash).toBe('')
    expect(audioItemOf(without('size'))?.size).toBe(0)
    expect(audioItemOf(without('title'))?.title).toBe('audio')
    const shot = audioInnerTemplate({ ...item, loop: false, retrigger: 'auto' }, at, 0, 1)
    expect(audioItemOf({ ...shot, tags: shot.tags.map((t) => (t[0] === 'retrigger' ? ['retrigger', 'always'] : t)) })?.retrigger).toBe('once')
    for (const bad of ['-1', '01', '1.5', '1e3', '', '99999999999999999999']) {
      expect(audioItemOf({ ...base, tags: [...base.tags, ['fade', bad]] })?.fade).toBeUndefined()
    }
    expect(audioItemOf({ ...base, tags: [...base.tags, ['fade', '0']] })?.fade).toBe(0)
    // A looping item has no trigger to retrigger: its retrigger reads once.
    expect(audioItemOf({ ...base, tags: [...base.tags, ['retrigger', 'auto']] })?.retrigger).toBe('once')
  })

  it('fetches only over https, or http to this machine', () => {
    expect(fetchableUrl('https://cdn.example/x')).toBe(true)
    expect(fetchableUrl('http://localhost:3000/x')).toBe(true)
    expect(fetchableUrl('http://127.0.0.1/x')).toBe(true)
    expect(fetchableUrl('http://example.com/x')).toBe(false)
    expect(fetchableUrl('data:audio/mpeg;base64,AAAA')).toBe(false)
  })
})

describe('the file (DECK-0007 §2.1)', () => {
  it('seals with a fresh key and nonce, and opens with them only', async () => {
    const tone = toneWav()
    const a = await encryptAudioFile(tone)
    const b = await encryptAudioFile(tone)
    expect(a.keyHex).toMatch(/^[0-9a-f]{64}$/)
    expect(a.nonceHex).toMatch(/^[0-9a-f]{24}$/)
    expect(a.keyHex).not.toBe(b.keyHex)
    // AES-GCM: as long as the file plus its 16-byte tag.
    expect(a.cipher.byteLength).toBe(tone.byteLength + 16)
    expect(await decryptAudioFile(a.cipher, a.keyHex, a.nonceHex)).toEqual(tone)
    expect(await decryptAudioFile(a.cipher, b.keyHex, a.nonceHex)).toBeNull()
    expect(await decryptAudioFile(a.cipher, a.keyHex, b.nonceHex)).toBeNull()
    const tampered = a.cipher.slice()
    tampered[10] ^= 1
    expect(await decryptAudioFile(tampered, a.keyHex, a.nonceHex)).toBeNull()
  })

  it('downloads under its title and its type', () => {
    expect(audioFileName({ title: 'Temple / drone?', mime: 'audio/mpeg' })).toBe('Temple drone.mp3')
    expect(audioFileName({ title: '', mime: 'audio/x-unknown' })).toBe('audio.audio')
    expect(audioFileName({ title: 'water', mime: 'audio/ogg; codecs=opus' })).toBe('water.ogg')
    expect(titleFromFileName('temple_drone  02.mp3')).toBe('temple drone 02')
  })
})

describe('how loud it is (DECK-0007 §4)', () => {
  const H = 6
  const side = 2 ** H

  it('places the source at its gibson centre in the region frame', () => {
    const base = regionBase(at, H)
    expect(base).toEqual({ x: (at.x >> 6n) << 6n, y: (at.y >> 6n) << 6n, z: (at.z >> 6n) << 6n })
    expect(sourceLocal(at, H)).toEqual([Number(at.x - base.x) + 0.5, Number(at.y - base.y) + 0.5, Number(at.z - base.z) + 0.5])
  })

  it('a sphere never reaches past the nearest wall; without a fade it is as large as fits', () => {
    const src: Local = [10.5, 32, 50]
    expect(inscribedRadius(src, side)).toBe(10.5)
    expect(fadeRadius(undefined, src, H)).toBe(10.5)
    expect(fadeRadius(4, src, H)).toBe(4)
    expect(fadeRadius(500, src, H)).toBe(10.5)
    expect(fadeRadius(-3, src, H)).toBe(0)
  })

  it('is full inside the sphere, silent at the walls and outside, and falls smoothly between', () => {
    const src: Local = [32, 32, 32]
    const r = 8
    expect(audioGain(src, [32, 32, 32], side, r)).toBe(1)
    expect(audioGain(src, [32 + 8, 32, 32], side, r)).toBe(1)
    expect(audioGain(src, [64, 32, 32], side, r)).toBe(0)
    expect(audioGain(src, [0, 32, 32], side, r)).toBe(0)
    expect(audioGain(src, [65, 32, 32], side, r)).toBe(0)
    expect(audioGain(src, [32, -0.01, 32], side, r)).toBe(0)
    // Halfway from the sphere to the wall is half loud (smoothstep's midpoint).
    expect(audioGain(src, [32 + 8 + 12, 32, 32], side, r)).toBeCloseTo(0.5, 10)
    let last = 1
    for (let x = 40; x <= 64; x += 0.5) {
      const g = audioGain(src, [x, 32, 32], side, r)
      expect(g).toBeLessThanOrEqual(last + 1e-12)
      last = g
    }
  })

  it('ends at the wall the line from the source meets, whichever way that is', () => {
    // Off centre: the east wall is 54 away, the west one 10.
    const src: Local = [10, 32, 32]
    const r = fadeRadius(undefined, src, H)
    expect(r).toBe(10)
    expect(audioGain(src, [10 + 32, 32, 32], side, r)).toBeCloseTo(0.5, 10)
    expect(audioGain(src, [63.999, 32, 32], side, r)).toBeLessThan(1e-6)
    // Along a diagonal the wall is further, and the fade stretches to it.
    const d = Math.SQRT1_2
    const corner = audioGain(src, [10 + 30 * d, 32 + 30 * d, 32], side, r)
    expect(corner).toBeGreaterThan(0)
    expect(corner).toBeLessThan(1)
    expect(insideRegion([0, 0, 64], side)).toBe(true)
    expect(insideRegion([0, 0, 64.1], side)).toBe(false)
  })
})
