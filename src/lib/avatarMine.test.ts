import { describe, expect, it } from 'vitest'
import { getEventHash } from 'nostr-tools/pure'
import { avatarWork, verifyAvatarWork } from 'cyberspace-core'
import { avatarTemplate } from './avatar'
import { blocksOf, describeDuration, eventId, leadingZeros, mineChunk, nonceTagged, serializeEvent, triesPerSec } from './avatarMine'
import { newShard, toPayload } from './shards'

const me = 'ab'.repeat(32)
const wedge = () => {
  const s = newShard('me')
  s.name = 'Wedge'
  s.vertices = [{ p: [0, 0, 0], c: [1, 0, 0] }, { p: [1, 0, 0], c: [1, 0, 0] }, { p: [0, 1, 0], c: [1, 0, 0] }, { p: [0, 0, 1], c: [1, 0, 0] }]
  s.faces = [[0, 1, 2], [0, 2, 3], [0, 3, 1], [1, 3, 2]]
  s.mode = 'solid'
  return s
}
const template = (nonce?: string, target = 16) => {
  const t = { ...avatarTemplate(wedge(), 1_800_000_000), pubkey: me }
  return nonce === undefined ? t : nonceTagged(t, nonce, target)
}

describe('avatarMine', () => {
  it('serializes and hashes exactly as NIP-01 (nostr-tools agrees)', () => {
    const t = template('42')
    expect(JSON.parse(serializeEvent(t))).toEqual([0, me, 1_800_000_000, 33331, t.tags, t.content])
    expect(eventId(t)).toBe(getEventHash({ ...t, id: '', sig: '' } as never))
  })

  it('counts leading zero bits', () => {
    expect(leadingZeros(new Uint8Array([0, 0, 0x0f, 0xff]))).toBe(20)
    expect(leadingZeros(new Uint8Array([0x80]))).toBe(0)
    expect(leadingZeros(new Uint8Array([0x01]))).toBe(7)
    expect(leadingZeros(new Uint8Array([0, 0]))).toBe(16)
  })

  it('nonceTagged replaces an earlier nonce and keeps the rest', () => {
    const t = nonceTagged(nonceTagged(template(), '1', 16), '2', 20)
    expect(t.tags.filter((x) => x[0] === 'nonce')).toEqual([['nonce', '2', '20']])
    expect(t.tags[0]).toEqual(['d', 'avatar'])
  })

  it('mines the floor for a one-gibson wedge, and the verdict is paid', () => {
    const t = template()
    const required = avatarWork(toPayload(wedge()))
    expect(required).toBe(16)
    let found = null
    for (let from = 0; found === null && from < 2 ** 22; from += 4096) found = mineChunk(t, required, from, 4096)
    expect(found).not.toBeNull()
    const mined = nonceTagged(t, found!.nonce, required)
    expect(eventId(mined)).toBe(found!.id)
    const verdict = verifyAvatarWork({ ...mined, id: found!.id })
    expect(verdict).toMatchObject({ ok: true, required: 16, committed: 16 })
    expect(verdict.zeros).toBeGreaterThanOrEqual(16)
  })

  it('the fast path and the plain path find the same nonce', () => {
    const t = template()
    const fast = mineChunk(t, 8, 0, 4096)
    let plain = null
    for (let n = 0; plain === null && n < 4096; n++) {
      const c = nonceTagged(t, String(n), 8)
      const id = eventId(c)
      if (id.startsWith('00')) plain = { nonce: String(n), id }
    }
    expect(fast).toEqual(plain)
  })

  it('a stride walks its own residue: worker i of n finds the first nonce congruent to i', () => {
    const t = template()
    const first = mineChunk(t, 8, 0, 4096)!
    const byStride = [0, 1, 2].map((i) => mineChunk(t, 8, i, 2048, 3)).filter((x) => x !== null)
    expect(byStride.map((x) => Number(x!.nonce) % 3)).toEqual([...new Set(byStride.map((x) => Number(x!.nonce) % 3))])
    expect(byStride.some((x) => x!.nonce === first.nonce)).toBe(true)
    for (const x of byStride) expect(x!.id.startsWith('00')).toBe(true)
  })

  it('estimates: blocks, tries per second, wording', () => {
    expect(blocksOf(55)).toBe(1)
    expect(blocksOf(56)).toBe(2)
    expect(blocksOf(602)).toBe(10)
    expect(triesPerSec(100_000, 602)).toBeCloseTo(24_000, 0)
    expect(triesPerSec(100_000, 602, 4)).toBeCloseTo(24_000 * 3.1, 0)
    expect(describeDuration(0.3)).toBe('under a second')
    expect(describeDuration(40)).toBe('about 40 s')
    expect(describeDuration(200)).toBe('about 3 min')
    expect(describeDuration(7200)).toBe('about 2 h')
    expect(describeDuration(5 * 86400)).toBe('about 5 days')
    expect(describeDuration(3 * 365.25 * 86400)).toBe('about 3 years')
  })
})
