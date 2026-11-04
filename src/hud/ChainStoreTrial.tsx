/**
 * ChainStoreTrial.tsx - the yes a device gives before it tries the chain's
 * new store (lib/chainStore.ts). The link ?chainstore=trial only asks; a tap
 * here is what puts this device on the trial, and the app loads again on it.
 */

import { useState } from 'react'
import { declineTrial, startTrial, trialAskedByLink } from '../lib/chainStore'
import { ConfirmModal } from './ConfirmModal'

/** The page's address without ?chainstore, so a reload does not ask again. */
function withoutAsk(): string {
  const url = new URL(location.href)
  url.searchParams.delete('chainstore')
  return url.toString()
}

export function ChainStoreTrial(): JSX.Element | null {
  const [open, setOpen] = useState(trialAskedByLink)
  if (!open) return null
  return (
    <ConfirmModal
      title="Try the new chain store?"
      body={<>This device only. To stop, open with ?chainstore=off</>}
      confirmLabel="TRY IT"
      cancelLabel="NOT NOW"
      danger={false}
      onConfirm={() => { startTrial(); location.replace(withoutAsk()) }}
      onCancel={() => { declineTrial(); setOpen(false); try { history.replaceState(history.state, '', withoutAsk()) } catch { /* the address stays */ } }}
    />
  )
}
