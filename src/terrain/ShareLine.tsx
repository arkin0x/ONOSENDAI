/**
 * ShareLine.tsx - the bag's part about sharing your blocks
 * (store/terrainShare.ts): saved on this device, sharing, or shared, in
 * plain words; RETIRE for this device's building key, asked twice; and the
 * Crew, both ways: who can build on yours (with remove), who lets you build
 * on theirs (ADD BACK for those not in yours), and add from people you
 * follow. Changing the Crew asks no signer: this device's building key
 * publishes your blocks again with the new list.
 */

import { useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { Cloud, CloudUpload, HardDrive, Users, X } from 'lucide-react'
import { addCrew, removeCrew, retireDeviceKey, useShare } from '../store/terrainShare'
import { useCyberspace } from '../store/useCyberspace'
import { followsOf } from '../lib/contacts'
import { useProfile } from '../hooks/useProfile'
import { safeNpub } from '../lib/npub'

/** How long the second tap of RETIRE is waited for, ms. */
const CONFIRM_MS = 4000
/** How many people you follow are offered at once. */
const FOLLOWS_SHOWN = 6

const small = { cursor: 'pointer', background: 'transparent' } as const

/** A pubkey from what was typed: an npub or 64 hex; null when it is neither. */
export function crewInput(text: string): string | null {
  const t = text.trim()
  if (/^[0-9a-f]{64}$/.test(t)) return t
  try {
    const d = nip19.decode(t)
    return d.type === 'npub' ? (d.data as string) : null
  } catch { return null }
}

function Name({ pubkey }: { pubkey: string }): JSX.Element {
  const p = useProfile(pubkey)
  return <span title={safeNpub(pubkey)}>{p?.name || `${safeNpub(pubkey).slice(0, 12)}…`}</span>
}

function Crew(): JSX.Element {
  const crew = useShare((s) => s.crew)
  const crewOf = useShare((s) => s.crewOf)
  const me = useCyberspace((s) => s.identity.pubkey)
  const [typed, setTyped] = useState('')
  const [why, setWhy] = useState<string | null>(null)
  const [follows, setFollows] = useState<string[]>([])
  const [showFollows, setShowFollows] = useState(false)
  useEffect(() => {
    if (!showFollows || !me) return
    let on = true
    followsOf(me).then((l) => { if (on) setFollows(l) }).catch(() => undefined)
    return () => { on = false }
  }, [showFollows, me])
  const add = (): void => {
    const pk = crewInput(typed)
    if (!pk) { setWhy('That is not an npub.'); return }
    if (pk === me) { setWhy('You are already on your own blocks.'); return }
    setTyped('')
    void addCrew(pk).then((ok) => setWhy(ok ? null : 'Already in your crew.'))
  }
  const offer = follows.filter((p) => p !== me && !crew.includes(p)).slice(0, FOLLOWS_SHOWN)
  return (
    <section className="terrain-crew" aria-label="Crew" style={{ marginTop: 8, fontSize: 12, color: '#fff' }}>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '4px 0', fontSize: 12, letterSpacing: '0.08em' }}><Users size={13} strokeWidth={2} aria-hidden />CREW</h3>
      <p style={{ margin: '4px 0', opacity: 0.85 }}>Can build on yours: {crew.length === 0 ? 'nobody yet.' : null}</p>
      {crew.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {crew.map((pk) => (
            <li key={pk} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Name pubkey={pk} />
              <button type="button" className="terrain-key" style={small} onClick={() => { void removeCrew(pk) }} aria-label="Remove from your crew" title="Remove from your crew"><X size={11} strokeWidth={2.5} aria-hidden /></button>
            </li>
          ))}
        </ul>
      )}
      <p style={{ margin: '6px 0 4px', opacity: 0.85 }}>You build on theirs: {crewOf.length === 0 ? 'nobody has added you yet.' : null}</p>
      {crewOf.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {crewOf.map((pk) => (
            <li key={pk} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Name pubkey={pk} />
              {!crew.includes(pk) && <button type="button" className="terrain-key" style={small} onClick={() => { void addCrew(pk) }}>ADD BACK</button>}
            </li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
        <input value={typed} onChange={(e) => { setTyped(e.target.value); setWhy(null) }} onKeyDown={(e) => { if (e.key === 'Enter') add() }} placeholder="npub1…" aria-label="Add to your crew by npub"
          style={{ flex: '1 1 160px', minWidth: 0, background: 'rgba(0,0,0,0.4)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', padding: '4px 6px', fontSize: 12 }} />
        <button type="button" className="terrain-key" style={small} onClick={add}>ADD</button>
        <button type="button" className="terrain-key" style={small} onClick={() => setShowFollows(!showFollows)} aria-expanded={showFollows}>ADD FROM PEOPLE YOU FOLLOW</button>
      </div>
      {why && <p role="status" style={{ margin: '4px 0' }}>{why}</p>}
      {showFollows && (
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {offer.length === 0 ? <li style={{ opacity: 0.85 }}>Nobody else to add.</li> : offer.map((pk) => (
            <li key={pk} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Name pubkey={pk} />
              <button type="button" className="terrain-key" style={small} onClick={() => { void addCrew(pk) }}>ADD</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ShareLine(): JSX.Element {
  const { state, words } = useShare()
  const [asking, setAsking] = useState(false)
  useEffect(() => {
    if (!asking) return
    const t = window.setTimeout(() => setAsking(false), CONFIRM_MS)
    return () => clearTimeout(t)
  }, [asking])
  const Icon = state === 'shared' ? Cloud : state === 'sharing' ? CloudUpload : HardDrive
  const retire = (): void => {
    if (!asking) { setAsking(true); return }
    setAsking(false)
    retireDeviceKey()
  }
  return (
    <>
      <p className="terrain-sheet__foot" data-share={state} role="status" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Icon size={13} strokeWidth={2} aria-hidden />
        <span>{words}</span>
        <button
          type="button"
          className="terrain-key"
          onClick={retire}
          style={{ marginLeft: 'auto', ...small }}
          title="Retire this device's building key: what it signed stops counting, and your blocks go out again under a new key"
          aria-label={asking ? 'Tap again to retire this device\'s building key' : 'Retire this device\'s building key'}
        >
          {asking ? 'TAP AGAIN TO RETIRE' : 'RETIRE KEY'}
        </button>
      </p>
      <Crew />
    </>
  )
}
