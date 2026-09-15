/**
 * keyExport.ts — taking a local key with you, encrypted.
 *
 * A key that lives only in one browser is one cleared cache from gone, and the
 * chain it signed is then unreachable forever: there is no reset, because there
 * is nobody to ask. So a local key must be exportable, and the export must be
 * safe to carry, which means it leaves encrypted (NIP-49, `ncryptsec1…`) and
 * never as a bare nsec that a screenshot or a paste buffer could spill.
 *
 * The password is not optional and this module is where that is enforced
 * rather than in the markup, so no caller can offer an unprotected export by
 * forgetting a check. It is asked for twice, because a mistyped password on a
 * backup is not discovered until the day the backup is needed, and on that day
 * it is unrecoverable.
 *
 * On the floor: NIP-49 itself sets no minimum, and a short password is a
 * backup with a decorative lock. Eight is the shortest thing worth writing
 * down, and the caller is told the rule rather than having its input silently
 * accepted and quietly weakened.
 */

import * as nip49 from 'nostr-tools/nip49'

/** The shortest password this will encrypt with. */
export const MIN_PASSWORD = 8

/**
 * NIP-49's work factor, as its own name rather than a bare 16.
 *
 * It is the log2 of the scrypt rounds, so each step up doubles both the time
 * to unlock a backup and the time to attack one. 16 is the reference
 * implementation's default and takes a moment on a phone; higher is safer for
 * a key that is written down once and read years later, and is the number to
 * raise if that trade ever needs revisiting.
 */
export const LOG_N = 16

export type ExportProblem = 'no-key' | 'too-short' | 'mismatch'

/** Why an export cannot be made yet, or null when it can. */
export function exportProblem(secretKey: Uint8Array | null | undefined, password: string, again: string): ExportProblem | null {
  if (!secretKey || secretKey.length !== 32) return 'no-key'
  if (password.length < MIN_PASSWORD) return 'too-short'
  if (password !== again) return 'mismatch'
  return null
}

/** What to tell someone about a problem, in their terms rather than the code's. */
export function explainProblem(problem: ExportProblem): string {
  switch (problem) {
    case 'no-key':
      return 'Only a key held on this device can be exported. An extension or a bunker keeps its own key, and it is theirs to export.'
    case 'too-short':
      return `A password of at least ${MIN_PASSWORD} characters. This is the only thing standing between the file and whoever finds it.`
    case 'mismatch':
      return 'The two passwords are different. A mistyped password on a backup is not discovered until the day the backup is needed.'
  }
}

/**
 * The key as an `ncryptsec1…` string, or a thrown error naming the problem.
 *
 * Throws rather than returning null on a bad password so that a caller cannot
 * treat "not encrypted" as "encrypted": there is no safe fallback here, and a
 * silent one would hand out a key.
 */
export function exportNcryptsec(secretKey: Uint8Array | null | undefined, password: string, again: string): string {
  const problem = exportProblem(secretKey, password, again)
  if (problem) throw new Error(explainProblem(problem))
  return nip49.encrypt(secretKey as Uint8Array, password, LOG_N)
}

/** A file name for a saved backup: the identity it belongs to, and what it is. */
export function backupFileName(npub: string): string {
  const tail = npub.replace(/[^a-z0-9]/gi, '').slice(-8).toLowerCase()
  return `nostr-key-${tail || 'backup'}.ncryptsec.txt`
}
