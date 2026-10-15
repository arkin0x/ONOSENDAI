import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes } from 'cyberspace-core'
import { cashuLabel, cashuTokensAsWritten, cashuWalletHref, checkCashuState, decodeCashuToken, decodeCbor, findCashuToken, hashToCurve, mintHost, readCashuToken, textWithoutToken } from '../cashu'

const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// A small CBOR encoder for the test's own fixtures.
function encodeCbor(v: unknown): Uint8Array {
  const head = (major: number, n: number): number[] => n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : [(major << 5) | 25, n >> 8, n & 255]
  if (typeof v === 'number') return new Uint8Array(head(0, v))
  if (typeof v === 'string') { const b = new TextEncoder().encode(v); return new Uint8Array([...head(3, b.length), ...b]) }
  if (v instanceof Uint8Array) return new Uint8Array([...head(2, v.length), ...v])
  if (Array.isArray(v)) return new Uint8Array([...head(4, v.length), ...v.flatMap((x) => [...encodeCbor(x)])])
  if (v && typeof v === 'object') { const e = Object.entries(v as Record<string, unknown>); return new Uint8Array([...head(5, e.length), ...e.flatMap(([k, x]) => [...encodeCbor(k), ...encodeCbor(x)])]) }
  throw new Error('unsupported')
}

const V3 = 'cashuA' + b64url(new TextEncoder().encode(JSON.stringify({ token: [{ mint: 'https://mint.example', proofs: [{ id: '00ad', amount: 16, secret: 'a', C: '02aa' }, { id: '00ad', amount: 5, secret: 'b', C: '02bb' }] }], unit: 'sat', memo: 'find me' })))
const V4 = 'cashuB' + b64url(encodeCbor({ m: 'https://mint.example', u: 'sat', d: 'chest', t: [{ i: new Uint8Array([0, 0xad]), p: [{ a: 8, s: 'x', c: new Uint8Array([2, 1]) }, { a: 1, s: 'y', c: new Uint8Array([2, 2]) }] }] }))

describe('findCashuToken', () => {
  it('finds a token inside a message and ignores the rest', () => {
    expect(findCashuToken(`Congratulations, take it: ${V3} and say hi`)).toBe(V3)
    expect(findCashuToken('nothing here')).toBeNull()
    expect(findCashuToken(null)).toBeNull()
  })
})

describe('decodeCashuToken', () => {
  it('reads a v3 token: mint, amount, unit, memo, proofs', () => {
    const t = decodeCashuToken(V3)!
    expect(t.version).toBe(3)
    expect(t.mint).toBe('https://mint.example')
    expect(t.amount).toBe(21)
    expect(t.memo).toBe('find me')
    expect(t.proofs.map((p) => p.secret)).toEqual(['a', 'b'])
    expect(cashuLabel(t)).toBe('21 sats')
  })
  it('reads a v4 token from CBOR', () => {
    const t = decodeCashuToken(V4)!
    expect(t.version).toBe(4)
    expect(t.mint).toBe('https://mint.example')
    expect(t.amount).toBe(9)
    expect(t.memo).toBe('chest')
  })
  it('returns null for junk', () => {
    expect(decodeCashuToken('cashuAnotbase64!!')).toBeNull()
    expect(decodeCashuToken('cashuB' + b64url(encodeCbor([1, 2])))).toBeNull()
  })
})

describe('decodeCbor', () => {
  it('round-trips the slice a token uses', () => {
    const v = { a: 1, b: 'two', c: new Uint8Array([3]), d: [4, 5], e: 300 }
    const out = decodeCbor(encodeCbor(v)) as Record<string, unknown>
    expect(out.a).toBe(1); expect(out.b).toBe('two'); expect(out.d).toEqual([4, 5]); expect(out.e).toBe(300)
    expect(bytesToHex(out.c as Uint8Array)).toBe('03')
  })
})

describe('hashToCurve (NUT-00)', () => {
  it('matches the published vectors', () => {
    // NUT-00 test vectors: the secrets 0, 1 and 2 as 32-byte values.
    expect(bytesToHex(hashToCurve(hexToBytes('0000000000000000000000000000000000000000000000000000000000000000')))).toBe('024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725')
    expect(bytesToHex(hashToCurve(hexToBytes('0000000000000000000000000000000000000000000000000000000000000001')))).toBe('022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf')
    expect(bytesToHex(hashToCurve(hexToBytes('0000000000000000000000000000000000000000000000000000000000000002')))).toBe('026cdbe15362df59cd1dd3c9c11de8aedac2106eca69236ecd9fbe117af897be4f')
  })
})

describe('checkCashuState (NUT-07)', () => {
  const token = decodeCashuToken(V3)!
  const mint = (states: string[]): typeof fetch => (async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe('https://mint.example/v1/checkstate')
    const body = JSON.parse(String(init?.body)) as { Ys: string[] }
    expect(body.Ys).toHaveLength(2)
    expect(body.Ys.every((y) => /^0[23][0-9a-f]{64}$/.test(y))).toBe(true)
    return new Response(JSON.stringify({ states: body.Ys.map((Y, i) => ({ Y, state: states[i] })) }), { status: 200 })
  }) as typeof fetch
  it('reads unclaimed, redeemed and pending off the mint', async () => {
    expect(await checkCashuState(token, mint(['UNSPENT', 'UNSPENT']))).toBe('unclaimed')
    expect(await checkCashuState(token, mint(['SPENT', 'SPENT']))).toBe('redeemed')
    expect(await checkCashuState(token, mint(['PENDING', 'UNSPENT']))).toBe('pending')
  })
  it('is unknown when the mint is down', async () => {
    expect(await checkCashuState(token, (async () => { throw new Error('down') }) as unknown as typeof fetch)).toBe('unknown')
  })
})

describe('a token among words', () => {
  const token = 'cashuBo2FteCJodHRwczovL21pbnQubWluaWJpdHMuY2FzaCIsInVuaXQiOiJzYXQiLCJwcm9vZnMi' + 'A'.repeat(200)

  it('is found wherever it sits in the message', () => {
    expect(findCashuToken(`for the drinks ${token}`)).toBeTruthy()
    expect(findCashuToken(`${token} enjoy`)).toBeTruthy()
    expect(findCashuToken(`before ${token} after`)).toBeTruthy()
  })

  it('leaves the words behind when it is taken out', () => {
    expect(textWithoutToken(`for the drinks ${token}`)).toBe('for the drinks')
    expect(textWithoutToken(`${token} enjoy`)).toBe('enjoy')
    expect(textWithoutToken(`before ${token} after`)).toBe('before after')
  })

  it('is nothing but a token when there are no words', () => {
    expect(textWithoutToken(token)).toBe('')
  })

  it('leaves an ordinary message alone', () => {
    expect(findCashuToken('just a note')).toBeNull()
    expect(textWithoutToken('just a note')).toBe('just a note')
  })
})

describe('readCashuToken: a coin is a coin whether or not it can be read', () => {
  it('reads a whole token: found, and what it holds', () => {
    const r = readCashuToken(`for the drinks ${V4}`)
    expect(r.raw).toBe(V4)
    expect(r.token?.amount).toBe(9)
  })
  it('a token cut short is still found, with nothing readable in it', () => {
    // What the 2000-character compose cap does to a token longer than the room
    // left after the words: the prefix survives, the tail does not.
    const r = readCashuToken(`for the drinks ${V4.slice(0, V4.length - 20)}`)
    expect(r.raw).not.toBeNull()
    expect(r.token).toBeNull()
  })
  it('a token fused with the word after it is found and unreadable, not a plain message', () => {
    const r = readCashuToken(`${V4}enjoy`)
    expect(r.raw).not.toBeNull()
    expect(r.token).toBeNull()
  })
  it('a plain message is neither', () => {
    expect(readCashuToken('just a note')).toEqual({ raw: null, token: null })
    expect(readCashuToken(undefined)).toEqual({ raw: null, token: null })
  })
})

describe('a token behind a cashu: link prefix', () => {
  it('leaves the prefix out of the words, as part of the link and not of the message', () => {
    expect(textWithoutToken(`for the drinks cashu:${V4}`)).toBe('for the drinks')
    expect(textWithoutToken(`cashu://${V4} enjoy`)).toBe('enjoy')
    expect(textWithoutToken(`cashu:${V4}`)).toBe('')
  })
  it('leaves the word cashu alone when no token follows it', () => {
    expect(textWithoutToken('I like cashu: it is private')).toBe('I like cashu: it is private')
  })
})

describe('textWithoutToken keeps the message\'s lines', () => {
  it('closes up the gap the token leaves but keeps line breaks, as the panels draw them', () => {
    expect(textWithoutToken(`Line one\nLine two  ${V4}\n\nsigned, me`)).toBe('Line one\nLine two\n\nsigned, me')
    expect(textWithoutToken(`top\r\n${V4}\r\nbottom`)).toBe('top\n\nbottom')
  })
  it('never leaves more than one blank line where the token was', () => {
    expect(textWithoutToken(`above\n\n${V4}\n\nbelow`)).toBe('above\n\nbelow')
  })
})

describe('cashuTokensAsWritten: what COPY TOKEN copies', () => {
  it('is the bare token, without the cashu: link prefix a wallet would not accept in its paste box', () => {
    expect(cashuTokensAsWritten(`take it cashu:${V4}`)).toEqual([V4])
    expect(cashuTokensAsWritten(`cashu://${V4}`)).toEqual([V4])
    expect(cashuTokensAsWritten(`for the drinks ${V3} thanks`)).toEqual([V3])
  })
  it('keeps any = padding the writer pasted, where findCashuToken drops it', () => {
    const padded = `${V3}==`
    expect(cashuTokensAsWritten(`here ${padded}`)).toEqual([padded])
    expect(findCashuToken(`here ${padded}`)).toBe(V3)
  })
  it('is every token, in order, since textWithoutToken takes every one out of the words', () => {
    expect(cashuTokensAsWritten(`one for you ${V3}\nand one for your friend cashu:${V4}`)).toEqual([V3, V4])
    expect(textWithoutToken(`one for you ${V3}\nand one for your friend cashu:${V4}`)).toBe('one for you\nand one for your friend')
  })
  it('is empty for a message without a token', () => {
    expect(cashuTokensAsWritten('just a note')).toEqual([])
    expect(cashuTokensAsWritten(undefined)).toEqual([])
  })
})

describe('cashuWalletHref', () => {
  it('is the token behind the cashu: scheme that wallet apps register', () => {
    expect(cashuWalletHref(V4)).toBe(`cashu:${V4}`)
  })
})

describe('mintHost', () => {
  it('is the host of a mint URL, path dropped and port kept', () => {
    expect(mintHost('https://mint.minibits.cash/Bitcoin')).toBe('mint.minibits.cash')
    expect(mintHost('http://localhost:3338')).toBe('localhost:3338')
  })
  it('is the text as written when it is not a URL', () => {
    expect(mintHost('not a url')).toBe('not a url')
  })
})
