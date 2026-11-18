/**
 * keyAtRest.test.ts - the password rules, the strength hint, and sealing and
 * opening a brought key (lib/keyAtRest.ts). Generated keys only.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import * as nip49 from 'nostr-tools/nip49'
import { bytesToHex } from '@noble/hashes/utils.js'
import { lockedSigner, LOCK_ABANDONED, openKey, passwordProblem, passwordStrength, sealKey, WRONG_PASSWORD } from '../keyAtRest'
import { localSigner } from '../signers'
import { NewPassword } from '../../hud/ui/NewPassword'

describe('passwords', () => {
  it('need at least 8 characters, typed the same twice', () => {
    expect(passwordProblem('1234567', '1234567')).toBe('too-short')
    expect(passwordProblem('12345678', '12345679')).toBe('mismatch')
    expect(passwordProblem('12345678', '12345678')).toBeNull()
  })

  it('get a rough strength: length first, a mix lifts it, repeats stay weak', () => {
    expect(passwordStrength('short')).toBe(0)
    expect(passwordStrength('abcdefgh')).toBe(1)
    expect(passwordStrength('aaaaaaaaaaaaaaaaaaaa')).toBe(1)
    expect(passwordStrength('abcdefghijkl')).toBe(2)
    expect(passwordStrength('Abcdefg1')).toBe(2)
    expect(passwordStrength('abcdefghijklmnop')).toBe(3)
    expect(passwordStrength('Abcdefghij1!')).toBe(3)
  })

  it('show one line under the fields: the rule, the mismatch once both are typed, or the strength', () => {
    const line = (password: string, again: string): string =>
      renderToString(createElement(NewPassword, { password, again, onPassword: () => {}, onAgain: () => {} })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    expect(line('', '')).toBe('At least 8 characters.')
    expect(line('abc', '')).toBe('At least 8 characters.')
    expect(line('abcdefgh', '')).toBe('WEAK')
    expect(line('abcdefgh', 'abc')).toBe('The two passwords are different.')
    expect(line('abcdefghijklmnop', 'abcdefghijklmnop')).toBe('STRONG')
  })
})

describe('sealing and opening', () => {
  it('seals with NIP-49 and opens only with the password, to the key of that pubkey', () => {
    const sk = generateSecretKey()
    const sealed = sealKey(sk, 'a good password', 'a good password')
    expect(sealed).toMatch(/^ncryptsec1/)
    expect(bytesToHex(nip49.decrypt(sealed, 'a good password'))).toBe(bytesToHex(sk))
    expect(bytesToHex(openKey(sealed, 'a good password', getPublicKey(sk)))).toBe(bytesToHex(sk))
    expect(() => openKey(sealed, 'a bad password', getPublicKey(sk))).toThrow(WRONG_PASSWORD)
    expect(() => openKey(sealed, 'a good password', getPublicKey(generateSecretKey()))).toThrow(WRONG_PASSWORD)
    expect(() => openKey('ncryptsec1garbage', 'a good password', getPublicKey(sk))).toThrow(WRONG_PASSWORD)
    expect(() => sealKey(sk, 'short', 'short')).toThrow('At least 8 characters.')
    expect(() => sealKey(sk, 'a good password', 'another')).toThrow('The two passwords are different.')
  })
})

describe('the locked stand-in', () => {
  it('holds no key, signs nothing until released, then signs and decrypts with the real one', async () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const lock = lockedSigner(pk)
    expect(lock.signer.pubkey).toBe(pk)
    expect(lock.signer.kind).toBe('local')
    expect(lock.signer.secretKey).toBeUndefined()
    let done = false
    const signing = lock.signer.signEvent({ kind: 1, created_at: 1, tags: [], content: 'x' }).then((e) => { done = true; return e })
    await new Promise((r) => setTimeout(r, 20))
    expect(done).toBe(false)
    lock.release(localSigner(sk))
    expect((await signing).pubkey).toBe(pk)
    const sealed = await lock.signer.nip44Encrypt!(pk, 'hello')
    expect(await lock.signer.nip44Decrypt!(pk, sealed)).toBe('hello')
  })

  it('ends what waits when abandoned', async () => {
    const lock = lockedSigner(getPublicKey(generateSecretKey()))
    const signing = lock.signer.signEvent({ kind: 1, created_at: 1, tags: [], content: 'x' })
    lock.abandon()
    await expect(signing).rejects.toThrow(LOCK_ABANDONED)
  })
})
