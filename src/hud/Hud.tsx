/**
 * Hud.tsx - the overlay: who you are, where you are, what the pending hop
 * would cost, and what the chain has cost so far.
 */

import { useState } from 'react'
import { formatBig, formatStep } from '../lib/space'
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
import { RelaysPanel } from './RelaysPanel'
import { TargetsPanel } from './TargetsPanel'
import { ShardsPanel } from './ShardsPanel'
import { Legend } from './Legend'
import { ScaleLadder } from './ScaleLadder'
import { ProofPanel } from './ProofPanel'
import { CloudPanel } from './CloudPanel'
import { Explanation } from './Explanation'

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
        Spawned at this key's coordinate: the 256-bit pubkey decodes directly
        to x / y / z / plane (spec section 8.3). Persisted locally so
        refreshing keeps your identity and position.
        {live
          ? ' LIVE: every action is signed and published to cyberspace.nostr1.com as it completes.'
          : ' LOCAL: actions are signed but stay on this device. Going live publishes the whole chain.'}
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

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Position</h2>
        <span className={`plane plane--${plane}`}>
          {plane === 0 ? 'DATASPACE' : 'IDEASPACE'}
        </span>
      </header>

      <dl className="stats stats--axes">
        <div>
          <dt>X</dt>
          <dd>{formatBig(position.x)}</dd>
        </div>
        <div>
          <dt>Y</dt>
          <dd>{formatBig(position.y)}</dd>
        </div>
        <div>
          <dt>Z</dt>
          <dd>{formatBig(position.z)}</dd>
        </div>
        <div>
          <dt>Sector</dt>
          <dd>{sector}</dd>
        </div>
      </dl>

      <div className="hash">
        <span className="hash__label">coord</span>
        <code>{coordHex}</code>
      </div>
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

      <dl className="stats">
        <div>
          <dt>Step</dt>
          <dd>{formatStep(scaleExp)}</dd>
        </div>
        <div>
          <dt>Screen right</dt>
          <dd>{signed(axes.right.axis, axes.right.dir)}</dd>
        </div>
        <div>
          <dt>Screen up</dt>
          <dd>{signed(axes.up.axis, axes.up.dir)}</dd>
        </div>
      </dl>

      <ScaleLadder />

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

      <Explanation>
        Looking along {signed(axes.out.axis, -axes.out.dir)}. R and F travel the
        axis into and out of the screen.
      </Explanation>
    </section>
  )
}

function LinksPanel(): JSX.Element {
  return (
    <section className="panel panel--links">
      <a href="https://straylight.cafe" target="_blank" rel="noopener noreferrer">
        straylight.cafe
      </a>
      <a href="https://cyberspace.international" target="_blank" rel="noopener noreferrer">
        cyberspace.international
      </a>
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
  return (
    <div className={menuOpen ? 'hud hud--menu' : 'hud'}>
      <div className="hud__col hud__col--left">
        <Brand />
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
        <CloudPanel />
        <ChainPanel />
        <HyperspacePanel />
        <Legend />
        <Controls />
        <DerezzPanel />
        <RelaysPanel />
      </div>
    </div>
  )
}
