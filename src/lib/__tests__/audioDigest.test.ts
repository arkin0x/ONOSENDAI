/**
 * audioDigest.test.ts: opening a hidden audio file hashes it with the
 * browser's digest, off the page's thread, not in script (owner's phone diag,
 * 2026-11-22: 320 to 358 ms in one task for a file opened while walking), and
 * the answer is the same.
 */
import { describe, expect, it, vi } from 'vitest'

const counted = vi.hoisted(() => ({ sync: 0 }))
vi.mock('../blossom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../blossom')>()
  return { ...actual, sha256Hex: (b: Uint8Array) => { counted.sync++; return actual.sha256Hex(b) } }
})

import { sha256Hex, sha256HexAsync } from '../blossom'
import { forgetOpenedAudio, openAudio } from '../audioFile'
import { encryptAudioFile } from '../audioItem'
import { toneWav } from './audioFixture'

describe('the audio file digest', () => {
  it('is the same as the script hash', async () => {
    const bytes = toneWav(0.2, 440)
    expect(await sha256HexAsync(bytes)).toBe(sha256Hex(bytes))
    expect(await sha256HexAsync(new Uint8Array(0))).toBe(sha256Hex(new Uint8Array(0)))
  })

  it('opening a file hashes neither the cipher nor the plain file in script', async () => {
    forgetOpenedAudio()
    const plain = toneWav(0.3, 330)
    const sealed = await encryptAudioFile(plain)
    const hash = sha256Hex(sealed.cipher)
    const originalHash = sha256Hex(plain)
    counted.sync = 0
    const fetchImpl = async () => new Response(sealed.cipher as BodyInit, { status: 200 })
    const blob = await openAudio({ url: 'https://blossom.test/x', hash, originalHash, keyHex: sealed.keyHex, nonceHex: sealed.nonceHex, mime: 'audio/wav' }, fetchImpl)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(plain)
    expect(counted.sync).toBe(0)
  })
})
