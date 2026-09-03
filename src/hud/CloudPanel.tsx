/**
 * CloudPanel.tsx - HOSAKA cloud compute: whether, how much, and what is pending.
 *
 * Movement beyond this machine's ceiling can be bought: HOSAKA computes the
 * proof, any Lightning wallet pays for it, and this client verifies the
 * result before signing it. The panel holds the three things a person sets
 * (mode, the budget below which AUTO does not ask, the API) and the one thing
 * they may need to act on: a job that is paid or computing while the tab was
 * elsewhere, which can be resumed while the chain head still matches it.
 */

import { CheckPaymentButton } from './InvoiceModal'
import { useEffect, useState } from 'react'
import { balanceLabel, formatClock, satsLabel, satsOf, sinceLabel, type CloudMode } from '../lib/cloud'
import { HOSAKA_DEFAULT_URL } from '../lib/hosaka'
import { shortHex } from '../lib/time'
import { useNow } from '../hooks/useNow'
import { useCyberspace } from '../store/useCyberspace'
import { Explanation } from './Explanation'

const MODES: Array<[CloudMode, string]> = [['auto', 'AUTO'], ['ask', 'ASK'], ['off', 'OFF']]

const STAGE_LABEL: Record<string, string> = {
  awaiting_payment: 'AWAITING PAYMENT',
  paid: 'PAID',
  computing: 'COMPUTING',
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'IDLE',
  quoting: 'QUOTING',
  confirm: 'CONFIRM',
  awaiting_payment: 'AWAITING PAYMENT',
  paid: 'PAID',
  computing: 'COMPUTING',
  verifying: 'VERIFYING',
  error: 'FAILED',
  funding: 'FUNDING',
}

function hostOf(url: string): string {
  try { return new URL(url).host } catch { return url }
}

/** A remembered balance older than this is refreshed on its own, local keys only. */
const BALANCE_STALE_MS = 10 * 60 * 1000

export function CloudPanel(): JSX.Element {
  const prefs = useCyberspace((s) => s.cloudPrefs)
  const cloud = useCyberspace((s) => s.cloud)
  const [editingUrl, setEditingUrl] = useState(false)
  const [urlDraft, setUrlDraft] = useState(prefs.apiUrl)
  const store = useCyberspace.getState

  const active = cloud.status !== 'idle' && cloud.status !== 'error'
  const job = cloud.job
  // Elapsed and "ago" lines only exist while there is a job to describe.
  const now = useNow(job || cloud.status === 'awaiting_payment' ? 1000 : 0)
  const pubkey = useCyberspace((s) => s.identity.pubkey)
  const signerKind = useCyberspace((s) => s.signerKind)
  const balance = cloud.balance
  // The remembered balance for this identity, the moment the panel is up;
  // and with a local key (no signer to ask) a fresh figure when the one we
  // have is stale, once HOSAKA has answered the caps so it is known to be
  // reachable.
  useEffect(() => {
    const st = useCyberspace.getState()
    st.ensureBalance()
    const known = st.cloud.balance
    if (signerKind === 'local' && st.cloud.limits !== null && st.cloudPrefs.mode !== 'off' && (known === null || Date.now() - known.at > BALANCE_STALE_MS)) void st.refreshBalance()
  }, [pubkey, signerKind, cloud.limits !== null])
  const tag = prefs.mode === 'off' ? 'OFF' : active || cloud.status === 'error' ? STATUS_LABEL[cloud.status] : prefs.mode.toUpperCase()

  const setUrl = (): void => {
    const url = urlDraft.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/\S+$/.test(url)) return
    store().setCloudPrefs({ apiUrl: url })
    setEditingUrl(false)
  }

  return (
    <section className={`panel panel--cloud ${active ? 'is-active' : ''}`}>
      <header className="panel__head">
        {/* The HOSAKA mark, small, so this panel is not one more panel: it is
            the one whose work happens on someone else's machine. */}
        <h2><img className="panel__mark" src="/hosaka-mark.png" alt="" aria-hidden="true" width={308} height={334} decoding="async" />Cloud compute</h2>
        <span className={`tag tag--cloud ${cloud.status === 'error' ? 'tag--danger' : active ? 'tag--live' : ''}`}>{tag}</span>
      </header>

      <div className="cloud__modes" role="radiogroup" aria-label="Cloud mode">
        {MODES.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={prefs.mode === mode}
            className={`secret__act cloud__mode ${prefs.mode === mode ? 'is-on' : ''}`}
            onClick={() => store().setCloudMode(mode)}
          >{label}</button>
        ))}
      </div>

      {prefs.mode === 'auto' && (
        <label className="cloud__budget">
          <span className="login__label">Auto-approve up to (sats, 0 asks every time)</span>
          <input
            className="avatars__input login__input"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={prefs.autoMaxSats}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value))
              if (Number.isFinite(n) && n >= 0) store().setCloudPrefs({ autoMaxSats: n })
            }}
            aria-label="Auto-approve budget in sats"
          />
        </label>
      )}

      <dl className="stats">
        <div>
          <dt>API</dt>
          <dd>
            <button className="cloud__link" title={prefs.apiUrl} onClick={() => { setUrlDraft(prefs.apiUrl); setEditingUrl((v) => !v) }}>
              {hostOf(prefs.apiUrl)}{cloud.limits?.local_compute ? ' (LOCAL)' : ''}
            </button>
          </dd>
        </div>
        <div>
          <dt>Cloud caps</dt>
          <dd>{cloud.limits ? `HOPS 2^${cloud.limits.max_hop_height} · SIDESTEPS 2^${cloud.limits.max_sidestep_height}` : prefs.mode === 'off' ? '—' : 'not fetched'}</dd>
        </div>
        <div>
          <dt>Prepaid balance</dt>
          <dd>
            {balance ? balanceLabel(balance.msats) : '—'}{' '}
            <button
              className="cloud__link"
              onClick={() => { void useCyberspace.getState().refreshBalance() }}
              disabled={cloud.balanceChecking}
              title={signerKind === 'local' ? 'Ask HOSAKA for the balance' : 'Ask HOSAKA for the balance (your signer will be asked to sign the request)'}
            >
              {cloud.balanceChecking ? 'CHECKING…' : balance ? `REFRESH · ${sinceLabel(balance.at, now || Date.now())}` : 'CHECK'}
            </button>
          </dd>
        </div>
      </dl>
      {cloud.balanceError && <p className="legend__note">{cloud.balanceError}</p>}

      {editingUrl && (
        <form className="avatars__find cloud__url" onSubmit={(e) => { e.preventDefault(); setUrl() }}>
          <input
            className="avatars__input"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder={HOSAKA_DEFAULT_URL}
            spellCheck={false}
            autoComplete="off"
            aria-label="HOSAKA API URL"
          />
          <button className="avatars__go" type="submit" disabled={!/^https?:\/\/\S+$/.test(urlDraft.trim())}>SET</button>
          <button className="avatars__go" type="button" onClick={() => { setUrlDraft(HOSAKA_DEFAULT_URL); store().setCloudPrefs({ apiUrl: HOSAKA_DEFAULT_URL }); setEditingUrl(false) }}>RESET</button>
        </form>
      )}

      {!job && cloud.status === 'awaiting_payment' && cloud.invoice && (
        <div className="cloud__job">
          <dl className="stats">
            <div>
              <dt>Route deposit</dt>
              <dd>{satsLabel(cloud.invoice.amountMsats)}</dd>
            </div>
            <div>
              <dt>Invoice</dt>
              <dd>{cloud.invoice.expiresAt * 1000 > now ? `expires in ${formatClock(cloud.invoice.expiresAt * 1000 - now)}` : 'expired'}</dd>
            </div>
          </dl>
          <div className="secret__actions">
            {!cloud.invoiceOpen && <button className="secret__act" onClick={() => store().setInvoiceOpen(true)}>SHOW INVOICE</button>}
            <CheckPaymentButton />
            <button className="secret__act secret__act--danger" onClick={() => store().cancelCloud()}>CANCEL</button>
          </div>
          <p className="legend__note">One invoice funds the whole route; the steps start the moment your node reports it paid.</p>
        </div>
      )}

      {job && (
        <div className="cloud__job">
          <dl className="stats">
            <div>
              <dt>Job</dt>
              <dd title={job.jobId}>{job.action.toUpperCase()} · {job.jobId.slice(0, 8)}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>{satsOf(job.costMsats)} sats</dd>
            </div>
            <div>
              <dt>Stage</dt>
              <dd>{active ? STATUS_LABEL[cloud.status] : `${STAGE_LABEL[job.stage]} (KEPT)`}</dd>
            </div>
            <div>
              <dt>{active ? 'Elapsed' : 'Submitted'}</dt>
              <dd>{active ? formatClock(now - (cloud.startedAt ?? job.createdAt)) : `${formatClock(now - job.createdAt)} ago`}</dd>
            </div>
          </dl>
          {active && cloud.progress !== null && (
            <div className="bar">
              <div className="bar__fill bar__fill--cloud" style={{ width: `${Math.round(cloud.progress * 100)}%` }} />
            </div>
          )}
          <div className="secret__actions">
            {cloud.status === 'awaiting_payment' && !cloud.invoiceOpen && (
              <button className="secret__act" onClick={() => store().setInvoiceOpen(true)}>SHOW INVOICE</button>
            )}
            {cloud.status === 'awaiting_payment' && <CheckPaymentButton />}
            {active && <button className="secret__act secret__act--danger" onClick={() => store().cancelCloud()}>CANCEL</button>}
            {!active && <button className="secret__act" onClick={() => void store().resumeCloudJob()}>RESUME</button>}
            {!active && <button className="secret__act secret__act--danger" onClick={() => store().discardCloudJob()}>DISCARD</button>}
          </div>
          {!active && (
            <p className="legend__note">A paid job outlives this tab. RESUME finishes it while your chain head is still the one it was bound to; moving first makes it worthless.</p>
          )}
        </div>
      )}

      {cloud.message && (
        <p className={cloud.status === 'error' ? 'notice' : 'legend__note'}>{cloud.message}</p>
      )}

      {cloud.last && !job && (
        <p className="legend__note">
          Last cloud {cloud.last.action}: {satsOf(cloud.last.costMsats)} sats, job {cloud.last.jobId.slice(0, 8)}
          {cloud.last.lookupId ? `, region ${shortHex(cloud.last.lookupId, 8, 4)}` : ''}.
        </p>
      )}

      <Explanation>
        Beyond this machine's ceiling, Space asks HOSAKA for a quote instead of
        stalling: a cloud hop lands at the cursor and returns the region key, a
        cloud sidestep crosses a wall taller than the cloud's hop cap. AUTO
        submits without asking up to the budget and asks above it; ASK always
        asks; OFF keeps every proof local. You pay a Lightning invoice from
        any wallet (this app has none); a job that fails is refunded to your
        HOSAKA balance. HOSAKA learns the coordinates of each cloud move and
        holds the region key of every region it computes for you. Every result
        is verified here before it is signed.
      </Explanation>
    </section>
  )
}
