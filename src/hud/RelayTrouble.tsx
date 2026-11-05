/**
 * RelayTrouble.tsx: the line a list shows instead of "nothing" when the
 * canonical relay did not answer its read (relay.ts troubleOf), with a RETRY
 * that signs in again and reads again. Whatever the list already had stays
 * on screen under it.
 *
 * BackupTrouble: the same for the pinned backup relay (useRelays
 * SECOND_RELAY) while the 2026-11-05 switch settles. Its reads need a
 * sign-in, so a signer that refused or never answered left it reading
 * nothing, unseen (review of #606). One short line under the list's own,
 * only while that sign-in stands failed.
 */

import { useSyncExternalStore } from 'react'
import { RefreshCw } from 'lucide-react'
import { CYBERSPACE_RELAY, onAuthChange, retryFailedAuth, signInFailed, type ReadTrouble } from '../lib/relay'
import { SECOND_RELAY } from '../store/useRelays'

/** What the line says: the words a list's tests look for too. */
export function troubleWords(trouble: ReadTrouble): string {
  const name = CYBERSPACE_RELAY.replace('wss://', '')
  return trouble === 'auth' ? `Could not sign in to ${name}.` : `Could not reach ${name}.`
}

/** RETRY: ask the signer again where it failed, then read again. */
export function retryRead(read: () => void): void {
  retryFailedAuth(CYBERSPACE_RELAY)
  read()
}

export function RelayTrouble({ trouble, onRetry }: { trouble: ReadTrouble; onRetry: () => void }): JSX.Element {
  return (
    <p className="notice relay-trouble">
      {troubleWords(trouble)}
      <button className="identity__change" onClick={() => retryRead(onRetry)} title={trouble === 'auth' ? 'Ask your signer to sign in again, then read again' : 'Read again'}>
        <RefreshCw size={10} strokeWidth={2.25} aria-hidden /> RETRY
      </button>
    </p>
  )
}

/** What the backup's line says. */
export function backupTroubleWords(): string {
  return `Could not sign in to backup ${SECOND_RELAY.replace('wss://', '')}.`
}

/** RETRY on the backup's line: ask the signer again there, then read again. */
export function retryBackup(read: () => void): void {
  retryFailedAuth(SECOND_RELAY)
  read()
}

export function BackupTrouble({ onRetry }: { onRetry: () => void }): JSX.Element | null {
  const failed = useSyncExternalStore(
    (changed) => onAuthChange(() => changed()),
    () => signInFailed(SECOND_RELAY),
    () => signInFailed(SECOND_RELAY),
  )
  if (!failed) return null
  return (
    <p className="notice relay-trouble relay-trouble--backup">
      {backupTroubleWords()}
      <button className="identity__change" onClick={() => retryBackup(onRetry)} title="Ask your signer to sign in to the backup relay again, then read again">
        <RefreshCw size={10} strokeWidth={2.25} aria-hidden /> RETRY
      </button>
    </p>
  )
}
