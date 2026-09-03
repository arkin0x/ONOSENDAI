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

import { HosakaBanner } from './HosakaOffer'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import QRCode from 'qrcode'
import { depositSettled, formatClock, satsLabel } from '../lib/cloud'
import { useNow } from '../hooks/useNow'
import { useCyberspace } from '../store/useCyberspace'
import { ConfirmModal } from './ConfirmModal'

/** The quote, waiting for a PAY. */
export function CloudApproval(): JSX.Element | null {
  const cloud = useCyberspace((s) => s.cloud)
  if ((cloud.status !== 'confirm' && cloud.status !== 'funding') || !cloud.quote) return null
  const q = cloud.quote
  const price = satsLabel(q.costMsats)
  const funding = cloud.status === 'funding'
  const steps = q.route ?? { steps: 1, cloudSteps: 1 }
  const body = q.route
    ? (
      <>
        {`HOSAKA will calculate ${steps.cloudSteps} of ${steps.steps} actions. Estimate wait is ${q.estTime ?? 'unknown'}.`}
        <br />
        Your payment will apply to your HOSAKA balance and leftover funds may be used for future jobs.
      </>
    )
    : (
      <>
        {`HOSAKA will calculate this 2^${q.maxHeight} ${q.action}. Estimate wait is ${q.estTime ?? 'unknown'}.`}
        <br />
        Your payment will apply to your HOSAKA balance and leftover funds may be used for future jobs.
      </>
    )
  return (
    <ConfirmModal
      banner={<HosakaBanner />}
      title="Offload Estimate"
      figure={<span className="modal__price">{price}</span>}
      body={body}
      confirmLabel={`PAY ${price.toUpperCase()}`}
      busy={funding}
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
          <h2 className="modal__title">HOSAKA Offload for {satsLabel(invoice.amountMsats)}</h2>
          <button className="secret__close" onClick={hide} aria-label="Hide">✕</button>
        </div>

        <div className="invoice__qr-wrap">
          <canvas ref={canvas} className="invoice__qr" width={264} height={264} />
        </div>

        <p className="invoice__amount">{satsLabel(invoice.amountMsats)}</p>
        <p className={`invoice__meta ${remainingMs < 5 * 60_000 ? 'is-late' : ''}`}>
          {remainingMs > 0 ? `EXPIRES IN ${formatClock(remainingMs)}` : 'EXPIRED'}
          {cloud.job ? ` · JOB ${cloud.job.jobId.slice(0, 8)}` : ''}
        </p>

        <code className="invoice__bolt11" title={bolt11}>{bolt11}</code>

        <div className="secret__actions invoice__actions">
          <button className="secret__act" onClick={copy}>{copied ? 'COPIED' : 'COPY INVOICE'}</button>
          <a className="secret__act invoice__wallet" href={uri}>OPEN IN WALLET</a>
          <CheckPaymentButton />
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

/**
 * CHECK PAYMENT with something to show for it: a spinner while the node is
 * asked, then the node's answer for a few seconds, even when the answer is
 * "still unpaid".
 */
export function CheckPaymentButton({ className = 'secret__act' }: { className?: string }): JSX.Element {
  const checking = useCyberspace((s) => s.cloud.checking)
  const lastCheck = useCyberspace((s) => s.cloud.lastCheck)
  const now = useNow(1000)
  const fresh = lastCheck && now - lastCheck.at < 6000 ? lastCheck : null
  const label = checking
    ? 'CHECKING'
    : fresh
      ? fresh.status === 'pending' ? 'CHECKED: NOT PAID YET' : `CHECKED: ${fresh.status.toUpperCase()}`
      : 'CHECK PAYMENT'
  return (
    <button className={`${className} ${checking ? 'is-busy' : ''} ${fresh && !checking ? 'is-checked' : ''}`} onClick={() => useCyberspace.getState().checkCloudPayment()} disabled={checking}>
      {checking && <span className="spin" aria-hidden="true" />}{label}
    </button>
  )
}

/**
 * The invoice was paid: one modal says so, since the invoice simply vanished
 * the moment the payment was detected and the job went on in the menu, out
 * of sight. Mounted permanently and watching the status, because the invoice
 * modal itself unmounts on exactly the transition this needs to see.
 */
export function PaidModal(): JSX.Element | null {
  const status = useCyberspace((s) => s.cloud.status)
  const prev = useRef(status)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (depositSettled(prev.current, status)) setOpen(true)
    prev.current = status
  }, [status])
  if (!open) return null
  const close = (): void => setOpen(false)
  return (
    <ConfirmModal
      banner={<HosakaBanner />}
      title="Thanks for using HOSAKA!"
      body="Open the menu to see the job's progress."
      confirmLabel="OK"
      cancelLabel={null}
      danger={false}
      cardClassName="cloud"
      onConfirm={close}
      onCancel={close}
    />
  )
}

/**
 * A payment that arrived while the tab was away. On a phone the wallet is
 * another app, and the PWA is often dropped while it is up: on return the
 * route is gone, but the deposit was on disk, claimed at startup and
 * credited. Without this it looked as if the payment was never seen.
 */
export function CreditedModal(): JSX.Element | null {
  const credited = useCyberspace((s) => s.cloud.credited)
  if (!credited) return null
  const close = (): void => useCyberspace.getState().dismissCredited()
  return (
    <ConfirmModal
      banner={<HosakaBanner />}
      title="Payment received"
      body={`${satsLabel(credited.msats)} paid while you were away are on your HOSAKA balance. Line up the move again and GO: the balance covers it.`}
      confirmLabel="OK"
      cancelLabel={null}
      danger={false}
      cardClassName="cloud"
      onConfirm={close}
      onCancel={close}
    />
  )
}
