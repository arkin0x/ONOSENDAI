/**
 * RelayTrouble.tsx: the line a list shows instead of "nothing" when the
 * canonical relay did not answer its read (relay.ts troubleOf), with a RETRY
 * that signs in again and reads again. Whatever the list already had stays
 * on screen under it.
 */

import { RefreshCw } from 'lucide-react'
import { CYBERSPACE_RELAY, retryFailedAuth, type ReadTrouble } from '../lib/relay'

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
