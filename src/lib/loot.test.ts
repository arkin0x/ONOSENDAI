import { describe, it, expect } from 'vitest'
import type { NostrEvent } from './events'
import { formatBytes, mergeLoot, payloadBytes, regionLabel, summarizeBag } from './loot'

const pk = (n: number): string => n.toString(16).padStart(64, '0')
const lookup = (n: number): string => (n + 1).toString(16).padStart(64, 'a')

function bag(over: Partial<NostrEvent> & { d?: string; h?: string; cipher?: string } = {}): NostrEvent {
  const { d = lookup(1), h = '5', cipher = 'Zm9v', ...rest } = over
  const tags: string[][] = [['d', d], ['encrypted', 'aes-256-gcm', cipher], ['version', '2']]
  if (h !== '') tags.push(['h', h])
  return { id: 'e1', pubkey: pk(1), created_at: 100, kind: 33330, content: '', sig: '', tags, ...rest }
}

describe('summarizeBag', () => {
  it('reads author, lookup id, height, size and a trimmed riddle', () => {
    const it = summarizeBag(bag({ content: '  where the\n  black sun  sets ', h: '12', cipher: 'Zm9vYmFy' }))
    expect(it).toMatchObject({ bagId: 'e1', author: pk(1), lookupId: lookup(1), height: 12, createdAt: 100, bytes: 6, riddle: 'where the black sun sets' })
    expect(it?.key).toBe(`${pk(1)}:${lookup(1)}`)
  })

  it('treats a missing height as 0 and an empty content as no riddle', () => {
    const it = summarizeBag(bag({ h: '' }))
    expect(it?.height).toBe(0)
    expect(it?.riddle).toBe('')
  })

  it('rejects other kinds, envelopes without ciphertext, and malformed lookup ids', () => {
    expect(summarizeBag({ ...bag(), kind: 3333 })).toBeNull()
    expect(summarizeBag({ ...bag(), tags: [['d', lookup(1)]] })).toBeNull()
    expect(summarizeBag(bag({ d: 'not-hex' }))).toBeNull()
    expect(summarizeBag(bag({ d: lookup(1).slice(0, 40) }))).toBeNull()
  })
})

describe('payloadBytes', () => {
  it('halves hex and takes three quarters of base64 minus padding', () => {
    expect(payloadBytes('deadbeef')).toBe(4)
    expect(payloadBytes('Zm9v')).toBe(3)
    expect(payloadBytes('Zm8=')).toBe(2)
    expect(payloadBytes('Zg==')).toBe(1)
    expect(payloadBytes('')).toBe(0)
  })
})

describe('mergeLoot', () => {
  const a = summarizeBag(bag({ id: 'a', created_at: 10 }))!
  const b = summarizeBag(bag({ id: 'b', pubkey: pk(2), created_at: 30 }))!
  const aNewer = summarizeBag(bag({ id: 'a2', created_at: 20 }))!

  it('keeps one entry per bag key, newest version winning, newest first', () => {
    const out = mergeLoot([a, b], [aNewer])
    expect(out.map((x) => x.bagId)).toEqual(['b', 'a2'])
  })

  it('never lets an older republish overwrite a newer one', () => {
    const out = mergeLoot([aNewer], [a])
    expect(out.map((x) => x.bagId)).toEqual(['a2'])
  })
})

describe('labels', () => {
  it('names the region as a size, never as a distance from the viewer', () => {
    expect(regionLabel(0)).toBe('single gibson')
    expect(regionLabel(34)).toBe('2 m cube')
    expect(regionLabel(34)).not.toMatch(/within/)
  })

  it('formats bytes below a kilobyte and KB above', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
  })
})
