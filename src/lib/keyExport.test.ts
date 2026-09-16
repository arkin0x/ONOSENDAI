/**
 * What these prove: a key cannot leave this device unencrypted, the password
 * rule is enforced here rather than in the markup, and what comes out is
 * something the login screen can read back.
 */
import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip49 from 'nostr-tools/nip49'
import { MIN_PASSWORD, backupFileName, explainProblem, exportNcryptsec, exportProblem } from './keyExport'

const sk = generateSecretKey()

describe('exportProblem', () => {
  it('refuses when there is no key on this device', () => {
    // An extension or a bunker holds its own key and this app never sees it.
    expect(exportProblem(null, 'longenough', 'longenough')).toBe('no-key')
    expect(exportProblem(undefined, 'longenough', 'longenough')).toBe('no-key')
    expect(exportProblem(new Uint8Array(31), 'longenough', 'longenough')).toBe('no-key')
  })

  it('refuses a password shorter than the floor, and an empty one', () => {
    expect(MIN_PASSWORD).toBe(8)
    expect(exportProblem(sk, '', '')).toBe('too-short')
    expect(exportProblem(sk, 'short', 'short')).toBe('too-short')
    expect(exportProblem(sk, 'a'.repeat(MIN_PASSWORD - 1), 'a'.repeat(MIN_PASSWORD - 1))).toBe('too-short')
    expect(exportProblem(sk, 'a'.repeat(MIN_PASSWORD), 'a'.repeat(MIN_PASSWORD))).toBeNull()
  })

  it('refuses two passwords that differ, because a typo is found years later', () => {
    expect(exportProblem(sk, 'correct horse', 'correct horsr')).toBe('mismatch')
  })

  it('explains each problem in a person\'s terms', () => {
    for (const p of ['no-key', 'too-short', 'mismatch'] as const) {
      expect(explainProblem(p).length).toBeGreaterThan(20)
    }
    expect(explainProblem('too-short')).toContain(String(MIN_PASSWORD))
  })
})

describe('exportNcryptsec', () => {
  it('encrypts to an ncryptsec that decrypts back to the same key', () => {
    const out = exportNcryptsec(sk, 'a good password', 'a good password')
    expect(out.startsWith('ncryptsec1')).toBe(true)
    const back = nip49.decrypt(out, 'a good password')
    expect(getPublicKey(back)).toBe(getPublicKey(sk))
  })

  it('will not decrypt with the wrong password', () => {
    const out = exportNcryptsec(sk, 'a good password', 'a good password')
    expect(() => nip49.decrypt(out, 'a good passwerd')).toThrow()
  })

  it('throws rather than returning anything when the password fails the rule', () => {
    // There is no safe fallback: a silent one would hand out a key.
    expect(() => exportNcryptsec(sk, 'short', 'short')).toThrow(/8 characters/)
    expect(() => exportNcryptsec(sk, 'longenough', 'different!')).toThrow(/different/)
    expect(() => exportNcryptsec(null, 'longenough', 'longenough')).toThrow(/held on this device/)
  })

  it('never contains the key in the clear', () => {
    const out = exportNcryptsec(sk, 'a good password', 'a good password')
    const hex = [...sk].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(out).not.toContain(hex)
    expect(out).not.toContain('nsec')
  })

  it('two exports of the same key differ, because the salt is fresh', () => {
    const a = exportNcryptsec(sk, 'a good password', 'a good password')
    const b = exportNcryptsec(sk, 'a good password', 'a good password')
    expect(a).not.toBe(b)
    expect(getPublicKey(nip49.decrypt(b, 'a good password'))).toBe(getPublicKey(sk))
  })
})

describe('backupFileName', () => {
  it('names the file after the identity it belongs to', () => {
    expect(backupFileName('npub1abcdefghijklmnop')).toBe('nostr-key-ijklmnop.ncryptsec.txt')
    expect(backupFileName('')).toBe('nostr-key-backup.ncryptsec.txt')
  })
})
