/**
 * Hud.tsx - the overlay: who you are, where you are, what the pending hop
 * would cost, and what the chain has cost so far.
 */

import { useState } from 'react'
import { formatBig, formatStep } from '../lib/space'
import { formatCellSizeLong } from '../lib/scale'
import { useCyberspace } from '../store/useCyberspace'
import { shortHex } from '../lib/time'
import { ProfilePic } from './ProfileBadge'
import { useProfile } from '../hooks/useProfile'
import { profileLabel } from '../store/useProfiles'
import { LoginModal } from './LoginModal'
import { AvatarsPanel } from './AvatarsPanel'
import { LootPanel } from './LootPanel'
import { ChainPanel } from './ChainPanel'
import { DerezzPanel } from './DerezzPanel'
import { HyperspacePanel } from './HyperspacePanel'
import { useHyperspace } from '../store/useHyperspace'
import { RelaysPanel } from './RelaysPanel'
import { TargetsPanel } from './TargetsPanel'
import { ShardsPanel } from './ShardsPanel'
import { Legend } from './Legend'
import { ScaleLadder } from './ScaleLadder'
import { ProofPanel } from './ProofPanel'
import { CloudPanel } from './CloudPanel'
import { Explanation } from './Explanation'
import { jobInProgress } from '../lib/cloud'

const AXIS_LABEL: Record<string, string> = { x: 'X', y: 'Y', z: 'Z' }

function signed(axis: string, dir: number): string {
  return `${dir === 1 ? '+' : '-'}${AXIS_LABEL[axis]}`
}

function Brand(): JSX.Element {
  return (
    <header className="brand">
      {/* Intrinsic dimensions reserve the box before the file arrives, so
          even a cold cache cannot shift the layout under the pointer. */}
      <img src="/logo.png" alt="ONOSENDAI" width={1871} height={354} decoding="async" />
      <p>Cyberspace Protocol v2 spatial explorer</p>
    </header>
  )
}

const SIGNER_LABEL: Record<string, string> = {
  local: 'LOCAL KEY',
  nip07: 'EXTENSION',
  nip46: 'BUNKER',
}

/** How long a tapped readout says COPIED before its label returns. */
const COPIED_MS = 1200

/** Tap to copy: which key was copied last, and the copier. The clipboard gets the raw text. */
function useCopied(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (key: string, text: string): void => {
    navigator.clipboard?.writeText(text).then(
      () => { setCopied(key); window.setTimeout(() => setCopied((c) => (c === key ? null : c)), COPIED_MS) },
      () => { /* no clipboard here: the value stays selectable */ },
    )
  }
  return [copied, copy]
}

function IdentityPanel(): JSX.Element {
  const identity = useCyberspace((s) => s.identity)
  const signerKind = useCyberspace((s) => s.signerKind)
  const live = useCyberspace((s) => s.live)
  const profile = useProfile(identity.pubkey)
  const [loginOpen, setLoginOpen] = useState(false)

  const name = profileLabel(profile, identity.npub)

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Identity</h2>
        <span className={`tag ${live ? 'tag--live' : 'tag--local'}`}>{live ? 'LIVE' : 'LOCAL'}</span>
      </header>

      <div className="identity__who">
        <ProfilePic pubkey={identity.pubkey} size={38} />
        <div className="identity__who-text">
          <span className="identity__name">{name}</span>
          <span className="identity__signer">{SIGNER_LABEL[signerKind] ?? signerKind}</span>
          <span className="secret__npub" title={identity.npub}>{shortHex(identity.npub, 14, 8)}</span>
        </div>
        <button className="identity__change" onClick={() => setLoginOpen(true)}>CHANGE</button>
      </div>

      <Explanation>
        Your spawn location is equal to your public key. Use the generated key or
        sign in with your nostr keypair. LIVE indicates your proofs are being
        published so other identities can see your movements. LOCAL means proofs
        are stored on this device until you switch to LIVE.
      </Explanation>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} />}
    </section>
  )
}

function PositionPanel(): JSX.Element {
  const position = useCyberspace((s) => s.position)
  const plane = useCyberspace((s) => s.plane)
  const coordHex = useCyberspace((s) => s.coordHex())
  const sector = useCyberspace((s) => s.sector())
  const [copied, copy] = useCopied()

  // Every figure copies on a tap, raw: the grouping commas are for reading,
  // not for pasting into a filter or a script.
  const readout = (key: string, label: string, shown: string, raw: string): JSX.Element => (
    <div key={key}>
      <dt className={copied === key ? 'is-copied' : ''}>{copied === key ? 'Copied' : label}</dt>
      <dd><button className="copy" onClick={() => copy(key, raw)} title="Tap to copy">{shown}</button></dd>
    </div>
  )

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Position</h2>
        <span className={`plane plane--${plane}`}>
          {plane === 0 ? 'DATASPACE' : 'IDEASPACE'}
        </span>
      </header>

      <dl className="stats stats--axes">
        {readout('x', 'X', formatBig(position.x), position.x.toString())}
        {readout('y', 'Y', formatBig(position.y), position.y.toString())}
        {readout('z', 'Z', formatBig(position.z), position.z.toString())}
        {readout('sector', 'Sector', sector, sector)}
      </dl>

      <button className="hash copy" onClick={() => copy('coord', coordHex)} title="Tap to copy">
        <span className={`hash__label ${copied === 'coord' ? 'is-copied' : ''}`}>{copied === 'coord' ? 'copied' : 'coord'}</span>
        <code>{coordHex}</code>
      </button>
    </section>
  )
}

function ScalePanel(): JSX.Element {
  const scaleExp = useCyberspace((s) => s.scaleExp)
  const axes = useCyberspace((s) => s.axes())

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Scale &amp; view</h2>
        <span className="scale-exp">2^{scaleExp}</span>
      </header>

      {/* Two columns: the axis key and the view facts on the left, the whole
          scale range on the right, so the ladder's height is not empty space
          beside three lines of text. */}
      <div className="scale__cols">
        <div className="scale__facts">
          <div className="axis-legend">
            <div className="axis-legend-item">
              <span className="axis-dot axis-dot--x"></span>
              <span className="axis-name">X axis</span>
            </div>
            <div className="axis-legend-item">
              <span className="axis-dot axis-dot--y"></span>
              <span className="axis-name">Y axis</span>
            </div>
            <div className="axis-legend-item">
              <span className="axis-dot axis-dot--z"></span>
              <span className="axis-name">Z axis (forward)</span>
            </div>
          </div>
          <dl className="stats stats--stack">
            <div>
              <dt>Step</dt>
              <dd>{formatStep(scaleExp)}</dd>
            </div>
            <div>
              <dt>Cursor</dt>
              <dd>{formatCellSizeLong(scaleExp)}</dd>
            </div>
            <div>
              <dt>Screen up</dt>
              <dd>{signed(axes.up.axis, axes.up.dir)}</dd>
            </div>
            <div>
              <dt>Screen right</dt>
              <dd>{signed(axes.right.axis, axes.right.dir)}</dd>
            </div>
            <div>
              <dt>Looking along</dt>
              <dd>{signed(axes.out.axis, -axes.out.dir)}</dd>
            </div>
          </dl>
        </div>
        <ScaleLadder />
      </div>

      <Explanation>
        2^0 is the atomic-scale view of cyberspace; things don't get any smaller.
        Your view can scale up exponentially until 2^85, which is the full size of
        cyberspace (along each axis). The cursor represents a cubic meter at 2^33.
        Earth is visible around 2^50.
      </Explanation>
    </section>
  )
}

const OFFICIAL: Array<{ href: string; name: string; what: string }> = [
  { href: 'https://github.com/arkin0x/cyberspace', name: 'Cyberspace v2 Specification', what: 'the core protocol documentation' },
  { href: 'https://straylight.cafe', name: 'straylight.cafe', what: 'cyberspace enthusiast community hub' },
  { href: 'https://cyberspace.international', name: 'cyberspace.international', what: 'education, proliferation, adoption of cyberspace' },
  { href: 'https://github.com/arkin0x/ONOSENDAI/tree/v2', name: 'ONOSENDAI v2 Codebase', what: 'this client, on GitHub' },
]

function LinksPanel(): JSX.Element {
  return (
    <section className="panel panel--links">
      <header className="panel__head">
        <h2>Official</h2>
      </header>
      {OFFICIAL.map((l) => (
        <p key={l.href} className="links__row">
          <a href={l.href} target="_blank" rel="noopener noreferrer">{l.name}</a>
          <span className="links__what"> - {l.what}</span>
        </p>
      ))}
    </section>
  )
}

function Controls(): JSX.Element {
  const rows: Array<[string, string]> = [
    ['W A S D', 'move cursor one step'],
    ['Space', 'commit hop or sidestep (compute proof)'],
    ['X', 'cancel proof / recall cursor'],
    ['Shift + W A S D', 'rotate view 90°'],
    ['Tab', 'previous view'],
    ['Esc', 'reset to top-down map'],
    ['C', 'canonical view (facing the black sun)'],
    ['Q / E', 'scale step up / down (zoom out / in)'],
    ['R / F', 'cursor along depth axis'],
    ['P', 'toggle plane'],
    ['H', 'hyperspace line scrubber'],
    ['[ / ]', 'chain explorer: back / forward one action'],
    ['Home / End', 'chain explorer: spawn / live head'],
  ]

  return (
    <section className="panel panel--controls">
      <header className="panel__head">
        <h2>Controls</h2>
      </header>
      <dl className="keys">
        {rows.map(([key, description]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function Hud({ menuOpen = false }: { menuOpen?: boolean }): JSX.Element {
  // With a destination picked, the ride is the thing you are doing: the
  // Hyperspace panel leads the left column until the destination is cleared.
  const rideSet = useHyperspace((s) => s.destination !== null)
  // HOSAKA outranks even that: while a payment is awaited or a job is under
  // way the cloud panel takes the first panel position, under the brand.
  const cloudLeads = useCyberspace((s) => s.cloud.status === 'awaiting_payment' || jobInProgress(s.cloud.status))
  return (
    <div className={menuOpen ? 'hud hud--menu' : 'hud'}>
      <div className="hud__col hud__col--left">
        <Brand />
        {cloudLeads && <CloudPanel />}
        {rideSet && <HyperspacePanel />}
        <IdentityPanel />
        <LootPanel />
        <ShardsPanel />
        <AvatarsPanel />
        <TargetsPanel />
        <LinksPanel />
      </div>
      <div className="hud__col hud__col--right">
        <ScalePanel />
        <PositionPanel />
        <ProofPanel />
        {!cloudLeads && <CloudPanel />}
        <ChainPanel />
        {!rideSet && <HyperspacePanel />}
        <Legend />
        <Controls />
        <DerezzPanel />
        <RelaysPanel />
      </div>
    </div>
  )
}
