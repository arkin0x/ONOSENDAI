/**
 * DmInboxSetup.tsx: SET UP DM INBOX, one tap and a confirmation (arkinox,
 * 2026-10-13: "ship it so that we can make the agent panel public").
 *
 * Talking to an agent needs a DM inbox on both sides: a kind 10050 naming
 * the relays where you read private messages (NIP-17). Until now this app
 * never published yours, so a new operator met NO DM INBOX and had to go
 * set one up in another client. Now, when the relays answered that you
 * have none, TALK and the AGENTS panel offer SET UP DM INBOX. It opens a
 * ConfirmModal that says what is published (a public list of relays, no
 * message content) and to which relays, and only PUBLISH signs it, with your
 * own signer (store/useAgentDms.ts setUpDmInbox). The relays are
 * lib/inbox.ts DEFAULT_DM_RELAYS, chosen for being free and refusing to
 * hand out gift wraps without NIP-42 AUTH.
 */

import { useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import { DEFAULT_DM_RELAYS } from '../lib/inbox'
import { checkMyInbox, setUpDmInbox, useAgentDms, type InboxState } from '../store/useAgentDms'
import { ConfirmModal } from './ConfirmModal'

/** What the confirmation says, apart from the relay list; exported for the tests. */
export const DM_INBOX_CONFIRM =
  'This publishes a kind 10050 from your account: a public list of the relays where you read private messages (NIP-17), so your agent knows where to write to you. It holds relay addresses only, never message content. You publish none now, so nothing is replaced. Your signer will ask to sign it. You can change the relays later in any client that manages DM relays.'

/** What the relays have in common, said under the list. */
export const DM_INBOX_RELAYS_NOTE = 'Each is free, and each asks a reader to log in (NIP-42) before handing out private messages.'

/** My DM inbox as the store knows it, looked up once for `me` while `enabled`. */
export function useMyDmInbox(me: string, enabled = true): InboxState {
  const mine = useAgentDms((s) => (s.me === me ? s.myInbox : null))
  useEffect(() => { if (enabled) checkMyInbox(me) }, [me, enabled])
  return mine ?? { status: 'loading', relays: [] }
}

/** The confirmation's body: what is published, and where. */
export function DmInboxConfirmBody({ relays = DEFAULT_DM_RELAYS, error }: { relays?: readonly string[]; error?: string | null }): JSX.Element {
  return (
    <>
      <p>{DM_INBOX_CONFIRM}</p>
      <span className="legend__label">DM relays</span>
      <ul className="dminbox__relays">
        {relays.map((r) => <li key={r}><code>{r}</code></li>)}
      </ul>
      <p>{DM_INBOX_RELAYS_NOTE}</p>
      {error && <p className="notice" role="status">{error}</p>}
    </>
  )
}

/**
 * The SET UP DM INBOX button and its confirmation. Rendered only where your
 * inbox is known to be missing; nothing is signed or sent before PUBLISH.
 */
export function DmInboxSetup(): JSX.Element {
  const [asking, setAsking] = useState(false)
  const setup = useAgentDms((s) => s.inboxSetup)
  const busy = setup.status === 'publishing'
  const publish = (): void => {
    void setUpDmInbox().then((ok) => { if (ok) setAsking(false) })
  }
  return (
    <>
      <button className="avatars__go dminbox__setup" onClick={() => setAsking(true)} title="Publish a DM inbox (kind 10050) so your agent can write to you. Asks first.">
        <Inbox size={10} aria-hidden /> SET UP DM INBOX
      </button>
      {asking && (
        <ConfirmModal
          title="SET UP DM INBOX"
          body={<DmInboxConfirmBody error={setup.status === 'failed' ? setup.error : null} />}
          confirmLabel={busy ? 'PUBLISHING' : 'PUBLISH'}
          danger={false}
          busy={busy}
          onConfirm={publish}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  )
}
