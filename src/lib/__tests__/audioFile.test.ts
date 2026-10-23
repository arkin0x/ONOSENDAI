/**
 * audioFile.test.ts: hidden audio's file, up and back (DECK-0007 §2). The
 * upload goes as ciphertext with no type that says audio, signed for its
 * hash; the file comes back only when the bytes are the ones named and open
 * with the key. Blossom is a mock here: nothing leaves the machine.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { sha256Hex } from '../blossom'
import { audioFileRefusal, forgetOpenedAudio, openAudio, sealAndUpload, AUDIO_UPLOAD_REASON } from '../audioFile'
import { decryptAudioFile, MAX_AUDIO_BYTES } from '../audioItem'
import type { EventTemplate } from '../events'
import { toneWav } from './audioFixture'

const sk = generateSecretKey()
const sign = async (t: EventTemplate) => finalizeEvent(t, sk)

/** A Blossom server in memory: PUT stores by hash, GET serves it. */
function mockServer(): { fetch: (url: string, init?: RequestInit) => Promise<Response>; blobs: Map<string, Uint8Array>; puts: Array<{ type: string | null; auth: string | null }> } {
  const blobs = new Map<string, Uint8Array>()
  const puts: Array<{ type: string | null; auth: string | null }> = []
  return {
    blobs,
    puts,
    fetch: async (url, init) => {
      const method = init?.method ?? 'GET'
      const headers = new Headers(init?.headers)
      if (method === 'HEAD') return new Response(null, { status: 200 })
      if (method === 'PUT') {
        const body = new Uint8Array(init!.body as Uint8Array)
        const hash = sha256Hex(body)
        blobs.set(hash, body)
        puts.push({ type: headers.get('Content-Type'), auth: headers.get('Authorization') })
        return new Response(JSON.stringify({ url: `https://blossom.test/${hash}`, sha256: hash, size: body.byteLength, type: 'application/octet-stream' }), { status: 200 })
      }
      const hash = url.split('/').pop()!
      const b = blobs.get(hash)
      return b ? new Response(b as BodyInit, { status: 200 }) : new Response(null, { status: 404 })
    },
  }
}

beforeEach(() => forgetOpenedAudio())

describe('sealing and uploading', () => {
  it('uploads ciphertext as octet-stream, and the item opens back to the very file', async () => {
    const server = mockServer()
    const tone = toneWav(0.5, 330)
    const file = new Blob([tone as BlobPart], { type: 'audio/wav' })
    const up = await sealAndUpload(file, 'https://blossom.test', sign, server.fetch)
    expect(server.puts).toHaveLength(1)
    expect(server.puts[0].type).toBe('application/octet-stream')
    const token = JSON.parse(atob(server.puts[0].auth!.replace(/^Nostr /, ''))) as { content: string; tags: string[][] }
    expect(token.content).toBe(AUDIO_UPLOAD_REASON)
    expect(token.tags).toContainEqual(['x', up.hash])
    const stored = server.blobs.get(up.hash)!
    // The server holds noise: not the file, not even its header.
    expect(stored).not.toEqual(tone)
    expect(new TextDecoder().decode(stored.slice(0, 4))).not.toBe('RIFF')
    expect(up.mime).toBe('audio/wav')
    expect(up.originalHash).toBe(sha256Hex(tone))
    expect(up.size).toBe(stored.byteLength)
    expect(await decryptAudioFile(stored, up.keyHex, up.nonceHex)).toEqual(tone)

    const back = await openAudio(up, server.fetch)
    expect(back.type).toBe('audio/wav')
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(tone)
  })
})

describe('opening', () => {
  it('refuses other bytes than the ones named, a wrong key, and another file', async () => {
    const server = mockServer()
    const up = await sealAndUpload(new Blob([toneWav() as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', sign, server.fetch)
    const stored = server.blobs.get(up.hash)!
    const swapped = stored.slice()
    swapped[0] ^= 1
    server.blobs.set(up.hash, swapped)
    await expect(openAudio(up, server.fetch)).rejects.toThrow('other bytes')
    server.blobs.set(up.hash, stored)
    // A failure is not kept: the next try fetches again.
    expect((await openAudio(up, server.fetch)).size).toBeGreaterThan(0)
    forgetOpenedAudio()
    await expect(openAudio({ ...up, keyHex: '00'.repeat(32) }, server.fetch)).rejects.toThrow('does not open')
    forgetOpenedAudio()
    await expect(openAudio({ ...up, originalHash: 'aa'.repeat(32) }, server.fetch)).rejects.toThrow('not the one hidden')
    forgetOpenedAudio()
    await expect(openAudio({ ...up, url: 'https://blossom.test/' + 'bb'.repeat(32), hash: 'bb'.repeat(32) }, server.fetch)).rejects.toThrow('HTTP 404')
    await expect(openAudio({ ...up, hash: 'cc'.repeat(32) }, async () => { throw new TypeError('offline') })).rejects.toThrow('could not be reached')
  })

  it('fetches a file once for PLAY and DOWNLOAD alike', async () => {
    const server = mockServer()
    const up = await sealAndUpload(new Blob([toneWav() as BlobPart], { type: 'audio/wav' }), 'https://blossom.test', sign, server.fetch)
    let gets = 0
    const counting = (url: string, init?: RequestInit) => { gets++; return server.fetch(url, init) }
    await openAudio(up, counting)
    await openAudio(up, counting)
    expect(gets).toBe(1)
  })
})

describe('what the composer takes', () => {
  it('audio only, not empty, not past the cap', () => {
    expect(audioFileRefusal({ type: 'audio/mpeg', size: 1000 })).toBeNull()
    expect(audioFileRefusal({ type: 'image/png', size: 1000 })).toMatch('Not an audio file')
    expect(audioFileRefusal({ type: 'audio/mpeg', size: 0 })).toMatch('empty')
    expect(audioFileRefusal({ type: 'audio/mpeg', size: MAX_AUDIO_BYTES + 1 })).toMatch('Too large')
  })
})
