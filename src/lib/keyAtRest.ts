/**
 * keyAtRest.ts - a key someone brought is kept on this device only encrypted.
 *
 * A pasted nsec used to be written to localStorage as it was, and a pasted
 * ncryptsec was opened and its key written the same way: anything that could
 * read this origin's storage (a stolen laptop, a malicious extension, a
 * backup of the profile) read the key itself. Now a brought key is stored
 * only as an ncryptsec (NIP-49) sealed with a password the person chose, with
 * the same work factor as the key export (keyExport.ts LOG_N), and a reload
 * asks for that password once. The opened key lives in memory for the visit.
 *
 * The key this app generates for a new visitor is not one of these: it is a
 * full identity with nothing to ask (owner rule, 2026-11-11), and stays as it
 * was (Signer.minted).
 *
 * Here: the password rules and the strength hint the forms show, sealing and
 * opening a key, and the stand-in that holds a locked identity's place
 * (lockedSigner) so the app shows who it is and signs nothing as anyone else
 * until it is opened.
 */

import * as nip49 from 'nostr-tools/nip49'
import { getPublicKey } from 'nostr-tools/pure'
import { LOG_N, MIN_PASSWORD } from './keyExport'
import type { EventTemplate, NostrEvent } from './events'
import type { Signer } from './signers'

export { MIN_PASSWORD }

export type PasswordProblem = 'too-short' | 'mismatch'

/** Why a new password cannot be used yet, or null when it can. */
export function passwordProblem(password: string, again: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD) return 'too-short'
  if (password !== again) return 'mismatch'
  return null
}

/** A problem in plain words, short enough for the line under the fields. */
export function explainPassword(problem: PasswordProblem): string {
  return problem === 'too-short' ? `At least ${MIN_PASSWORD} characters.` : 'The two passwords are different.'
}

/** 0: too short to use. 1 weak, 2 fair, 3 strong: a hint, not a rule. */
export type Strength = 0 | 1 | 2 | 3

export const STRENGTH_LABEL: Record<Strength, string> = { 0: 'TOO SHORT', 1: 'WEAK', 2: 'FAIR', 3: 'STRONG' }

/**
 * A rough read of a password's strength, for the hint under the field. Length
 * counts most; a mix of letters, digits and symbols lifts it one step; a
 * password of a few repeated characters is weak however long.
 */
export function passwordStrength(password: string): Strength {
  if (password.length < MIN_PASSWORD) return 0
  if (new Set(password).size < 5) return 1
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length
  let level = password.length >= 16 ? 3 : password.length >= 12 ? 2 : 1
  if (kinds >= 3) level++
  return Math.min(3, level) as Strength
}

/**
 * The key sealed with a new password, as an `ncryptsec1…`, or a thrown error
 * naming the problem. Throws rather than returning anything else, so no
 * caller can mistake "not sealed" for "sealed".
 */
export function sealKey(secretKey: Uint8Array, password: string, again: string): string {
  const problem = passwordProblem(password, again)
  if (problem) throw new Error(explainPassword(problem))
  if (secretKey.length !== 32) throw new Error('That is not a key.')
  return nip49.encrypt(secretKey, password, LOG_N)
}

/**
 * What a wrong password is told. One message for every way opening can fail
 * (a wrong password, a damaged copy), and nothing about how long it took.
 */
export const WRONG_PASSWORD = 'Wrong password.'

/**
 * The key inside a stored ncryptsec, if `password` opens it and it is the key
 * of `pubkey`; otherwise throws WRONG_PASSWORD. A copy that opens to some
 * other key is refused the same way: storage that was tampered with must not
 * put a stranger's key behind this identity's name.
 */
export function openKey(ncryptsec: string, password: string, pubkey: string): Uint8Array {
  let sk: Uint8Array
  try { sk = nip49.decrypt(ncryptsec, password) } catch { throw new Error(WRONG_PASSWORD) }
  if (getPublicKey(sk) !== pubkey) { sk.fill(0); throw new Error(WRONG_PASSWORD) }
  return sk
}

/**
 * Lets the spinner draw before the work that blocks the page: NIP-49's scrypt
 * at LOG_N runs on the main thread and takes a moment on a phone.
 */
export function paintFirst(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 40))
}

/** Why a signature waiting on a locked key ended: the identity was switched instead of unlocked. */
export const LOCK_ABANDONED = 'Switched to another identity before this key was unlocked.'

/** A locked identity's place: its stand-in signer, and the two ways the lock ends. */
export interface KeyLockHandle {
  signer: Signer
  /** Opened (or logged in again as the same key): everything waiting signs with it. */
  release: (real: Signer) => void
  /** Switched away instead: everything waiting ends with LOCK_ABANDONED. */
  abandon: () => void
}

/**
 * A stand-in for an identity whose key is locked. Its pubkey is known at once
 * (the pref keeps it), so the chain and the name on screen are the person's
 * own and never the generated key's. It holds no key: every signature and
 * every decrypt asked of it waits until the lock ends, and then goes through
 * the opened key, or ends with LOCK_ABANDONED if another identity was chosen.
 * Nothing signs as anyone else meanwhile.
 */
export function lockedSigner(pubkey: string): KeyLockHandle {
  let release: (real: Signer) => void = () => {}
  let abandon: () => void = () => {}
  const opened = new Promise<Signer>((resolve, reject) => {
    release = resolve
    abandon = () => reject(new Error(LOCK_ABANDONED))
  })
  // A lock abandoned with nothing waiting is not an unhandled rejection.
  opened.catch(() => {})
  const via = <T>(use: (real: Signer) => Promise<T> | undefined, missing: string): Promise<T> =>
    opened.then((real) => use(real) ?? Promise.reject(new Error(missing)))
  const signer: Signer = {
    kind: 'local',
    pubkey,
    signEvent: (template: EventTemplate): Promise<NostrEvent> => opened.then((real) => real.signEvent(template)),
    nip44Decrypt: (sender, payload) => via((real) => real.nip44Decrypt?.(sender, payload), 'no NIP-44'),
    nip44Encrypt: (recipient, plaintext) => via((real) => real.nip44Encrypt?.(recipient, plaintext), 'no NIP-44'),
    nip04Decrypt: (sender, payload) => via((real) => real.nip04Decrypt?.(sender, payload), 'no NIP-04'),
    nip04Encrypt: (recipient, plaintext) => via((real) => real.nip04Encrypt?.(recipient, plaintext), 'no NIP-04'),
  }
  return { signer, release: (real) => release(real), abandon: () => abandon() }
}
