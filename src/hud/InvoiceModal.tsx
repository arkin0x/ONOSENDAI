/**
 * InvoiceModal.tsx - paying HOSAKA for a move this machine cannot compute.
 *
 * Two modals for the two moments the cloud flow stops for a person. The
 * approval is the existing ConfirmModal with the quote in it and PAY N SATS
 * as the verb, since that is what confirming means. The invoice is a QR of
 * the lightning: URI plus the raw bolt11 and an open-in-wallet link, with the
 * expiry counting down; any wallet pays it, this client only watches for
 * settlement. A tap outside folds the invoice without abandoning the job (the
 * Cloud panel brings it back); CANCEL JOB is the way out.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { formatClock, satsOf } from '../lib/cloud'
import { useNow } from '../hooks/useNow'
import { useCyberspace } from '../store/useCyberspace'
import { ConfirmModal } from './ConfirmModal'

/** The quote, waiting for a PAY. */
export function CloudApproval(): JSX.Element | null {
  const cloud = useCyberspace((s) => s.cloud)
  if (cloud.status !== 'confirm' || !cloud.quote) return null
  const q = cloud.quote
  const sats = satsOf(q.costMsats)
  const when = [q.tier, q.estTime].filter((s): s is string => !!s).join(', ')
  const body =
    `HOSAKA computes this h${q.maxHeight} ${q.action} for ${sats} sat${sats === 1 ? '' : 's'}${when ? ` (${when})` : ''}. ` +
    (q.action === 'hop'
      ? 'It lands at the cursor and returns the region key. '
      : 'It lands 1 gibson past the wall; the cursor keeps the rest of the journey. ') +
    'Any Lightning wallet pays the invoice. HOSAKA learns the coordinates of this move. ' +
    'This client verifies the result before signing it into your chain.'
  return (
    <ConfirmModal
      title={`Cloud ${q.action}`}
      body={body}
      confirmLabel={`PAY ${sats} SATS`}
      danger={false}
      cardClassName="cloud"
      onConfirm={() => useCyberspace.getState().approveCloud()}
      onCancel={() => useCyberspace.getState().declineCloud()}
    />
  )
}

/** The invoice, while HOSAKA waits to be paid. */
export function InvoiceModal(): JSX.Element | null {
  const cloud = useCyberspace((s) => s.cloud)
  const signerKind = useCyberspace((s) => s.signerKind)
  const invoice = cloud.status === 'awaiting_payment' && cloud.invoiceOpen ? cloud.invoice : null
  const bolt11 = invoice?.bolt11 ?? null
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [copied, setCopied] = useState(false)
  const now = useNow(1000)

  // Rendered into a canvas the wallet's camera can read: dark modules on a
  // light field, whatever the HUD's palette says.
  useEffect(() => {
    if (!bolt11 || !canvas.current) return
    void QRCode.toCanvas(canvas.current, `lightning:${bolt11}`, {
      errorCorrectionLevel: 'L',
      margin: 2,
      width: 264,
      color: { dark: '#05070d', light: '#f4fbff' },
    }).catch(() => { /* the raw string below still works */ })
  }, [bolt11])

  useEffect(() => { setCopied(false) }, [bolt11])

  if (!invoice || !bolt11) return null

  const sats = satsOf(invoice.amountMsats)
  const remainingMs = invoice.expiresAt * 1000 - now
  const uri = `lightning:${bolt11}`
  const store = useCyberspace.getState
  const hide = (): void => store().setInvoiceOpen(false)
  const copy = (): void => {
    const done = (): void => setCopied(true)
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(bolt11).then(done, () => { /* select it by hand */ })
  }

  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label="Lightning invoice" onPointerDown={hide}>
      <div className="modal__card cloud invoice" onPointerDown={(e) => e.stopPropagation()}>
        <div className="login__head">
          <h2 className="modal__title">Cloud {cloud.job?.action ?? 'move'}: pay {sats} sat{sats === 1 ? '' : 's'}</h2>
          <button className="secret__close" onClick={hide} aria-label="Hide">✕</button>
        </div>

        <div className="invoice__qr-wrap">
          <canvas ref={canvas} className="invoice__qr" width={264} height={264} />
        </div>

        <p className={`invoice__meta ${remainingMs < 5 * 60_000 ? 'is-late' : ''}`}>
          {sats} SATS · {remainingMs > 0 ? `EXPIRES IN ${formatClock(remainingMs)}` : 'EXPIRED'}
          {cloud.job ? ` · JOB ${cloud.job.jobId.slice(0, 8)}` : ''}
        </p>

        <code className="invoice__bolt11" title={bolt11}>{bolt11}</code>

        <div className="secret__actions invoice__actions">
          <button className="secret__act" onClick={copy}>{copied ? 'COPIED' : 'COPY INVOICE'}</button>
          <a className="secret__act invoice__wallet" href={uri}>OPEN IN WALLET</a>
          <button className="secret__act" onClick={() => store().checkCloudPayment()}>CHECK PAYMENT</button>
        </div>

        <p className="legend__note">
          Watching for settlement{signerKind === 'local'
            ? ' every few seconds.'
            : ' every ten seconds; each check signs a request, so CHECK PAYMENT after paying saves a wait.'}
          {' '}Hiding this keeps the job; the Cloud panel reopens it.
        </p>

        <div className="modal__row">
          <button className="modal__cancel" onClick={() => store().cancelCloud()}>CANCEL JOB</button>
          <button className="modal__confirm" onClick={hide}>HIDE</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
