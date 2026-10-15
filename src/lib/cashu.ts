/**
 * cashu.ts - a Cashu token hidden in a message, and whether it has been taken.
 *
 * Bitcoin hidden in cyberspace is a Cashu token in a message (decided
 * 2026-09-07): a bearer thing, like a coin in a chest, and the mint decides
 * who was first. This file finds a token in a message's text, reads what it
 * holds (v3 JSON and v4 CBOR tokens, NUT-00), and asks the mint whether the
 * proofs are still unspent (NUT-07), which is the STASH's claimed or
 * unclaimed. Nothing here spends anything.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex, sha256 } from 'cyberspace-core'

export interface CashuProof { amount: number; secret: string }
export interface CashuToken {
  /** The mint's URL, as written in the token. */
  mint: string
  unit: string
  memo: string | null
  amount: number
  proofs: CashuProof[]
  version: 3 | 4
}
export type CashuState = 'unclaimed' | 'redeemed' | 'pending' | 'unknown'

const TOKEN = /cashu[AB][A-Za-z0-9_\-+/=]{16,}/

/**
 * A token with the `cashu:` link prefix a writer may have pasted in front of
 * it (`cashu:cashuB...`, or `cashu://cashuB...`). The prefix is part of the
 * link, not of the token, so it leaves the text with the token.
 */
const TOKEN_WITH_SCHEME = new RegExp(`(?:cashu:(?://)?)?${TOKEN.source}`, 'g')

/**
 * What a message says once its token is taken out.
 *
 * A token can sit anywhere in the text, and usually has words around it: "for
 * the drinks" and then two thousand characters of base64. Those words are the
 * message and the base64 is the money, so they are drawn as different things.
 * The words keep their line breaks, since the panels draw a message with its
 * lines as written; only the spaces the token leaves behind are closed up.
 */
export function textWithoutToken(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(TOKEN_WITH_SCHEME, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Every token in a text, in order, exactly as written, for copying: any `=`
 * padding kept, and without a `cashu:` link prefix in front of it. Every one,
 * not the first, because textWithoutToken takes them all out of the words:
 * a second token that got no card of its own would vanish from the panel.
 *
 * Wallets paste the bare token (`cashuB...`) into their receive screen; the
 * `cashu:` prefix belongs to links, so a message that wrote
 * `cashu:cashuB...` copies as `cashuB...`. The padding stays because this is
 * what the writer pasted, and some decoders insist on it. findCashuToken
 * drops the padding, which is right for recognizing a token and wrong for
 * handing one to a wallet.
 */
export function cashuTokensAsWritten(text: string | null | undefined): string[] {
  if (!text) return []
  return text.match(new RegExp(TOKEN.source, 'g')) ?? []
}

/**
 * A link that opens a token in a Cashu wallet app. Wallets that receive
 * tokens (Minibits among them) register the `cashu:` URI scheme; with none
 * installed, the link does nothing or the system says it cannot open it.
 */
export function cashuWalletHref(token: string): string {
  return `cashu:${token}`
}

/** A mint's host ("mint.example"), or the URL as written when it is not one. */
export function mintHost(mint: string): string {
  try { return new URL(mint).host || mint } catch { return mint }
}

/** The first Cashu token in a text, or null. Found anywhere in it. */
export function findCashuToken(text: string | null | undefined): string | null {
  if (!text) return null
  const m = TOKEN.exec(text)
  return m ? m[0].replace(/=+$/, '') : null
}

/**
 * A message's token, found and read, as one answer. `raw` is the token as it
 * sits in the text, or null when the message carries none: it decides whether
 * the message is a coin. `token` is what the coin holds, or null when the
 * token is there but this reader cannot read it: cut short (the compose cap
 * or a paste that lost its tail), fused with the word after it, or a shape
 * this decoder does not know. A coin that cannot be read is still a coin, so
 * every surface keys the mark on `raw` and the amount on `token`.
 */
export function readCashuToken(text: string | null | undefined): { raw: string | null; token: CashuToken | null } {
  const raw = findCashuToken(text)
  return { raw, token: raw ? decodeCashuToken(raw) : null }
}

function base64ToBytes(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/')
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ---------------------------------------------------------------------------
// The slice of CBOR a v4 token uses: unsigned ints, bytes, text, arrays, maps,
// and the simple values. No floats, no tags, no indefinite lengths.
// ---------------------------------------------------------------------------
type Cbor = number | bigint | string | Uint8Array | boolean | null | Cbor[] | { [k: string]: Cbor }

export function decodeCbor(bytes: Uint8Array): Cbor {
  let at = 0
  const need = (n: number): void => { if (at + n > bytes.length) throw new Error('cbor: short') }
  const length = (info: number): number => {
    if (info < 24) return info
    if (info === 24) { need(1); return bytes[at++] }
    if (info === 25) { need(2); const v = (bytes[at] << 8) | bytes[at + 1]; at += 2; return v }
    if (info === 26) { need(4); const v = ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3]; at += 4; return v }
    if (info === 27) { need(8); let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(bytes[at + i]); at += 8; if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('cbor: too large'); return Number(v) }
    throw new Error('cbor: indefinite length')
  }
  const item = (): Cbor => {
    need(1)
    const head = bytes[at++]
    const major = head >> 5, info = head & 31
    switch (major) {
      case 0: return length(info)
      case 1: return -1 - length(info)
      case 2: { const n = length(info); need(n); const v = bytes.slice(at, at + n); at += n; return v }
      case 3: { const n = length(info); need(n); const v = new TextDecoder().decode(bytes.slice(at, at + n)); at += n; return v }
      case 4: { const n = length(info); const out: Cbor[] = []; for (let i = 0; i < n; i++) out.push(item()); return out }
      case 5: { const n = length(info); const out: { [k: string]: Cbor } = {}; for (let i = 0; i < n; i++) { const k = item(); const v = item(); out[typeof k === 'string' ? k : String(k)] = v } return out }
      case 7:
        if (info === 20) return false
        if (info === 21) return true
        if (info === 22) return null
        throw new Error('cbor: unsupported simple value')
      default: throw new Error('cbor: unsupported type')
    }
  }
  const v = item()
  if (at !== bytes.length) throw new Error('cbor: trailing bytes')
  return v
}

/** What a token holds, or null when it is not one this reader understands. */
export function decodeCashuToken(token: string): CashuToken | null {
  try {
    if (token.startsWith('cashuA')) {
      const json = JSON.parse(new TextDecoder().decode(base64ToBytes(token.slice(6)))) as { token?: Array<{ mint?: string; proofs?: Array<{ amount?: number; secret?: string }> }>; unit?: string; memo?: string }
      const entries = Array.isArray(json.token) ? json.token : []
      const mint = entries.find((e) => typeof e.mint === 'string')?.mint
      if (!mint) return null
      const proofs: CashuProof[] = []
      for (const e of entries) for (const p of e.proofs ?? []) if (typeof p.amount === 'number' && typeof p.secret === 'string') proofs.push({ amount: p.amount, secret: p.secret })
      return { mint, unit: json.unit ?? 'sat', memo: json.memo ?? null, amount: proofs.reduce((a, p) => a + p.amount, 0), proofs, version: 3 }
    }
    if (token.startsWith('cashuB')) {
      const v = decodeCbor(base64ToBytes(token.slice(6))) as { m?: Cbor; u?: Cbor; d?: Cbor; t?: Cbor }
      if (typeof v.m !== 'string' || !Array.isArray(v.t)) return null
      const proofs: CashuProof[] = []
      for (const keyset of v.t as Array<{ p?: Cbor }>) {
        for (const p of (Array.isArray(keyset.p) ? keyset.p : []) as Array<{ a?: Cbor; s?: Cbor }>) {
          if (typeof p.a === 'number' && typeof p.s === 'string') proofs.push({ amount: p.a, secret: p.s })
        }
      }
      return { mint: v.m, unit: typeof v.u === 'string' ? v.u : 'sat', memo: typeof v.d === 'string' ? v.d : null, amount: proofs.reduce((a, p) => a + p.amount, 0), proofs, version: 4 }
    }
  } catch { /* not a token this reader understands */ }
  return null
}

const DOMAIN = new TextEncoder().encode('Secp256k1_HashToCurve_Cashu_')

/**
 * NUT-00 hash_to_curve: the curve point Y a secret stands for, which is what
 * the mint indexes spent proofs by. The counter is four bytes little endian.
 */
export function hashToCurve(secret: Uint8Array): Uint8Array {
  const msg = sha256(concat(DOMAIN, secret))
  const counter = new Uint8Array(4)
  for (let i = 0; i < 2 ** 16; i++) {
    counter[0] = i & 0xff; counter[1] = (i >> 8) & 0xff; counter[2] = (i >> 16) & 0xff; counter[3] = (i >>> 24) & 0xff
    const x = sha256(concat(msg, counter))
    const candidate = new Uint8Array(33)
    candidate[0] = 2
    candidate.set(x, 1)
    try {
      return secp256k1.Point.fromHex(bytesToHex(candidate)).toBytes(true)
    } catch { /* not on the curve: next counter */ }
  }
  throw new Error('hash_to_curve: no point found')
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** The Y of each proof, hex, for NUT-07 checkstate. */
export function proofYs(token: CashuToken): string[] {
  return token.proofs.map((p) => bytesToHex(hashToCurve(new TextEncoder().encode(p.secret))))
}

/**
 * NUT-07: ask the mint whether the proofs are still unspent. Redeemed when
 * every proof is spent, pending while any is in flight, unclaimed when all
 * are unspent, unknown when the mint cannot be reached or answers oddly.
 */
export async function checkCashuState(token: CashuToken, fetchFn: typeof fetch = fetch): Promise<CashuState> {
  if (token.proofs.length === 0) return 'unknown'
  try {
    const r = await fetchFn(`${token.mint.replace(/\/+$/, '')}/v1/checkstate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Ys: proofYs(token) }),
    })
    if (!r.ok) return 'unknown'
    const body = (await r.json()) as { states?: Array<{ state?: string }> }
    const states = (body.states ?? []).map((s) => s.state)
    if (states.length !== token.proofs.length) return 'unknown'
    if (states.every((s) => s === 'SPENT')) return 'redeemed'
    if (states.some((s) => s === 'PENDING')) return 'pending'
    if (states.every((s) => s === 'UNSPENT')) return 'unclaimed'
    return states.some((s) => s === 'SPENT') ? 'redeemed' : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** "21 sats" or "1 sat", in the token's unit. */
export function cashuLabel(token: CashuToken): string {
  const unit = token.unit === 'sat' ? (token.amount === 1 ? 'sat' : 'sats') : token.unit
  return `${token.amount.toLocaleString('en-US')} ${unit}`
}
