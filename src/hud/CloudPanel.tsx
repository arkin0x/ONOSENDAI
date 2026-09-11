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
import type { RouteProfile } from '../lib/movePlan'
import { RATIO_MIN_SAMPLES, ratioOf, useExperience } from '../lib/experience'
import { offloadFrom } from '../lib/crossover'
import { useCalibration } from '../lib/calibration'
import { Explanation } from './Explanation'

const MODES: Array<[CloudMode, string]> = [['auto', 'AUTO'], ['ask', 'ASK'], ['off', 'OFF']]
/** The amounts most people want, so the common case is one tap. */
const TOP_UPS = [1_000, 5_000, 25_000]

const PROFILES: Array<[RouteProfile, string]> = [['loot', 'LOOT'], ['time', 'TIME'], ['cost', 'COST']]

/** What each strategy does, in plain words, under the buttons. */
const PROFILE_NOTES: Record<RouteProfile, string> = {
  loot: 'Buy the hop at every wall this machine cannot cross on its own, and land holding that region\u2019s key, so what is hidden there opens for you. Where HOSAKA cannot hop either, a sidestep gets you across without the key.',
  time: 'Buy the hop wherever paying is faster than walking, measured on this machine against HOSAKA\u2019s own times. Below that, walk and sidestep for free. You keep the keys only from the hops you paid for.',
  cost: 'Never buy a hop. Walk to each wall and sidestep through it, and pay for a sidestep only where this machine cannot manage one. You arrive without keys, so what is hidden along the way stays shut.',
}

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
  const provider = cloud.provider
  const [editingUrl, setEditingUrl] = useState(false)
  const [topUpOpen, setTopUpOpen] = useState(false)
  const [topUpSats, setTopUpSats] = useState('1000')
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
  const hopCeil = useCalibration((st) => st.hopHeight)
  const sidestepCeil = useCalibration((st) => st.sidestepHeight)
  const cantorMsByHeight = useCalibration((st) => st.cantorMsByHeight)
  const sha256PerSec = useCalibration((st) => st.sha256PerSec)

  // Where the paid hop starts winning, measured (lib/crossover): the setting
  // explains itself with the number rather than a promise.
  const samples = useExperience((st) => st.samples)
  const experience = ratioOf(samples)
  const crossover = offloadFrom('time', {
    hopCeiling: hopCeil,
    sidestepCeiling: sidestepCeil,
    cloudHop: cloud.limits?.max_hop_height ?? 0,
    provider: cloud.provider ?? null,
    signerKind,
    cantorMsByHeight,
    sha256PerSec,
    experience,
  })

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
        <h2>Cloud compute</h2>
        <span className={`tag tag--cloud ${cloud.status === 'error' ? 'tag--danger' : active ? 'tag--live' : ''}`}>{tag}</span>
      </header>

      {/* The provider's mark, first thing under the title: this is the panel
          whose work happens on someone else's machine. HOSAKA's for now; the
          plan is for the connected provider to serve its own (hosaka-api #6). */}
      <img className="cloud__mark" src={provider?.logo ?? '/hosaka-mark.png'} alt={provider?.name ?? 'HOSAKA'} width={308} height={334} decoding="async" />

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

      {/* What a route optimizes for at a wall this machine cannot hop. Not a
          spending limit: AUTO and ASK still decide what actually gets paid. */}
      {prefs.mode !== 'off' && (
        <div className="cloud__profile">
          <span className="login__label">OPTIMIZE FOR:</span>
          <div className="cloud__modes" role="radiogroup" aria-label="Optimize for">
            {PROFILES.map(([profile, label]) => (
              <button
                key={profile}
                type="button"
                role="radio"
                aria-checked={prefs.profile === profile}
                className={`secret__act cloud__mode ${prefs.profile === profile ? 'is-on' : ''}`}
                onClick={() => store().setCloudPrefs({ profile })}
              >{label}</button>
            ))}
          </div>
          <span className="cloud__profile-note">
            {PROFILE_NOTES[prefs.profile]}
            {prefs.profile === 'time' && (
              Number.isFinite(crossover)
                ? ` On this machine, paying is faster from 2^${crossover} up.`
                : ' On this machine, walking is faster everywhere it can reach, so TIME buys only where it cannot cross at all.'
            )}
            {prefs.profile === 'time' && samples.length >= RATIO_MIN_SAMPLES && (
              ` HOSAKA's estimates are corrected by experience: over your last ${samples.length} jobs it ran at ${experience.toFixed(2)}× what it estimated.`
            )}
          </span>
        </div>
      )}

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
          <dd className="cloud__balance">
            <span>
              {balance ? balanceLabel(balance.msats) : '—'}{' '}
              <button
                className="cloud__link"
                onClick={() => { void useCyberspace.getState().refreshBalance() }}
                disabled={cloud.balanceChecking}
                title={signerKind === 'local' ? 'Ask HOSAKA for the balance' : 'Ask HOSAKA for the balance (your signer will be asked to sign the request)'}
              >
                {cloud.balanceChecking ? 'CHECKING…' : balance ? `REFRESH · ${sinceLabel(balance.at, now || Date.now())}` : 'CHECK'}
              </button>
            </span>
            {/* Credit bought before anything needs it: the route's own funding
                only ever tops up what one move is short by. */}
            {prefs.mode !== 'off' && (
              <button
                className="avatars__go cloud__topup"
                onClick={() => setTopUpOpen((v) => !v)}
                aria-expanded={topUpOpen}
              >{topUpOpen ? 'CANCEL' : 'INCREASE COMPUTE BALANCE'}</button>
            )}
          </dd>
        </div>
      </dl>
      {topUpOpen && (
        <form
          className="cloud__topup-form"
          onSubmit={(e) => {
            e.preventDefault()
            const sats = Math.floor(Number(topUpSats))
            if (!Number.isFinite(sats) || sats <= 0) return
            setTopUpOpen(false)
            void useCyberspace.getState().topUp(sats)
          }}
        >
          <span className="login__label">How many sats</span>
          <div className="cloud__topup-row">
            {TOP_UPS.map((n) => (
              <button
                key={n}
                type="button"
                className={`secret__act cloud__mode ${Number(topUpSats) === n ? 'is-on' : ''}`}
                onClick={() => setTopUpSats(String(n))}
              >{n.toLocaleString()}</button>
            ))}
            <input
              className="avatars__input login__input cloud__topup-input"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={topUpSats}
              onChange={(e) => setTopUpSats(e.target.value)}
              aria-label="Top-up amount in sats"
            />
            <button className="avatars__go" type="submit">GET INVOICE ▸</button>
          </div>
          <span className="cloud__profile-note">
            HOSAKA sends a lightning invoice. The balance updates the moment the node reports it paid, and nothing is spent until a move needs it.
          </span>
        </form>
      )}

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
        <p>
          Actions may require hardware resources beyond your machine's capacity.
          Cloud services can compute actions on your behalf and return the data
          for assembly into a valid proof. ONOSENDAI's own compute provider is
          HOSAKA, but you can switch it to any provider.
        </p>
        <p>
          HOSAKA quotes prices in satoshis paid via lightning, and holds a balance
          for your identity to order compute jobs against. HOSAKA necessarily
          learns the cantor root of every region it computes for you.
        </p>
      </Explanation>
    </section>
  )
}
