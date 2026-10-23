/**
 * audioVectors.test.ts: ONOSENDAI against DECK-0007's vectors
 * (cyberspace decks/kinds-vectors.json, `audio`): the item reads as the
 * DECK says, the file opens with its key and nonce to the very tone, the
 * hashes match, a bag vouches for the rumor, and the loudness at each
 * listener is the vectors' to twelve places. Copied in, so a change on
 * either side fails here.
 */

import { describe, expect, it } from 'vitest'
import { getEventHash } from 'nostr-tools/pure'
import { audioGain, audioItemOf, decryptAudioFile, inscribedRadius, type Local } from '../audioItem'
import { sha256Hex } from '../blossom'
import { hexToBytes } from '../events'
import { innerAuthentic } from '../hidden'

const V = {
  "hider": "d6453e0ec7126a6c7e7d3732f8c836165fafadfdd1b661fee85bcf1066fd841c",
  "file_hex": "524946467400000057415645666d74201000000001000100401f0000803e00000200100064617461500000000000020d7a180d21b825ed25a6216519230e350122f477e894df87dae7d9c9ddb7e5c0f097fdb70a9216c21f31253a26bf22271b59109d0373f66beaefe020dbadd9c2dc02e491ee30fb60089314571e",
  "file_key": "87091e8d38c109c3a2a368d63b93d5417a1a30de23f209ca39f8bc5170a3d466",
  "file_nonce": "3d5f7fe8f35782320007781b",
  "ciphertext_hex": "a59037f2fa5c182d94f5655e8653f87ba3932bae1c6f84c0a3e587a44e3b481eb29173afec7af054ce9d4f1fb6ca03e81171e2c776ebe9490568a44d5c40d9ff6e37efa6b7582e21cafb0e826ddcbb856f8ab1814b406bbda08eb27d75e352b025ba39c0a77d9d92f5f2cc2b1de59a400c5cbc049b8550c5bddc91d0e9708911824507dacfab137256e1a526",
  "item": {
    "pubkey": "d6453e0ec7126a6c7e7d3732f8c836165fafadfdd1b661fee85bcf1066fd841c",
    "created_at": 1791800000,
    "kind": 1063,
    "content": "Listen by the altar.",
    "tags": [
      [
        "C",
        "c4924924924924924924920c53c81e9d260623340e5c3a75b6de6e4715cd1724"
      ],
      [
        "title",
        "Temple bell"
      ],
      [
        "url",
        "https://blossom.example/a4323aae800351931c1551c2f59f26e71aa7a33aaa662fcbaf96c949e129dda4"
      ],
      [
        "m",
        "audio/wav"
      ],
      [
        "x",
        "a4323aae800351931c1551c2f59f26e71aa7a33aaa662fcbaf96c949e129dda4"
      ],
      [
        "ox",
        "57c909abcba8c7d6bf2b1a13785f293ccc874473d143ea9209e8498b8182c982"
      ],
      [
        "size",
        "140"
      ],
      [
        "encryption-algorithm",
        "aes-gcm"
      ],
      [
        "decryption-key",
        "87091e8d38c109c3a2a368d63b93d5417a1a30de23f209ca39f8bc5170a3d466"
      ],
      [
        "decryption-nonce",
        "3d5f7fe8f35782320007781b"
      ],
      [
        "autoplay"
      ],
      [
        "retrigger",
        "once"
      ],
      [
        "fade",
        "6"
      ],
      [
        "walk"
      ],
      [
        "-"
      ]
    ],
    "id": "52b2eac824edbb5d7e37ca0bf24d5d022a3f9ee526bc3f3485f07aa54d7a67c9"
  },
  "gain": {
    "region_height": 5,
    "side": 32,
    "source": [
      10.5,
      16.5,
      16.5
    ],
    "fade": 6,
    "radius": 6,
    "samples": [
      {
        "listener": [
          10.5,
          16.5,
          16.5
        ],
        "gain": 1
      },
      {
        "listener": [
          16.5,
          16.5,
          16.5
        ],
        "gain": 1
      },
      {
        "listener": [
          21.25,
          16.5,
          16.5
        ],
        "gain": 0.775821556846
      },
      {
        "listener": [
          26.75,
          16.5,
          16.5
        ],
        "gain": 0.266456312309
      },
      {
        "listener": [
          32,
          16.5,
          16.5
        ],
        "gain": 0
      },
      {
        "listener": [
          0,
          16.5,
          16.5
        ],
        "gain": 0
      },
      {
        "listener": [
          10.5,
          26.5,
          26.5
        ],
        "gain": 0.48285691587
      },
      {
        "listener": [
          33,
          16.5,
          16.5
        ],
        "gain": 0
      }
    ]
  }
} as const

describe('DECK-0007 vectors', () => {
  it('the item is a canonical rumor by the hider, with `-`, that reads as hidden audio', () => {
    const ev = V.item as unknown as { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }
    expect('sig' in ev).toBe(false)
    expect(getEventHash(ev)).toBe(ev.id)
    expect(innerAuthentic(ev, V.hider)).toBe(true)
    expect(ev.tags).toContainEqual(['-'])
    const a = audioItemOf(ev)!
    expect(a).not.toBeNull()
    expect(a.title).toBe('Temple bell')
    expect(a.about).toBe('Listen by the altar.')
    expect(a.mime).toBe('audio/wav')
    expect(a.autoplay).toBe(true)
    expect(a.loop).toBe(false)
    expect(a.retrigger).toBe('once')
    expect(a.fade).toBe(6)
    expect(a.walkOnly).toBe(true)
    expect(a.keyHex).toBe(V.file_key)
    expect(a.nonceHex).toBe(V.file_nonce)
  })

  it('the ciphertext is the one named, and opens to the tone the item names', async () => {
    const a = audioItemOf(V.item as never)!
    const cipher = hexToBytes(V.ciphertext_hex)
    expect(sha256Hex(cipher)).toBe(a.hash)
    expect(a.size).toBe(cipher.byteLength)
    const plain = await decryptAudioFile(cipher, a.keyHex, a.nonceHex)
    expect(plain && Buffer.from(plain).toString('hex')).toBe(V.file_hex)
    expect(sha256Hex(plain!)).toBe(a.originalHash)
  })

  it('gives the vectors\' loudness at every listener', () => {
    const src = V.gain.source as unknown as Local
    const r = Math.min(V.gain.fade, inscribedRadius(src, V.gain.side))
    expect(r).toBe(V.gain.radius)
    for (const s of V.gain.samples) expect(audioGain(src, s.listener as unknown as Local, V.gain.side, r)).toBeCloseTo(s.gain, 12)
  })
})
