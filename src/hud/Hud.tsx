/**
 * Hud.tsx - the overlay: who you are, where you are, what the pending hop
 * would cost, and what the chain has cost so far.
 */

import { formatBig, formatStep } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { BitReadout } from './BitReadout'
import { ChainPanel } from './ChainPanel'
import { Legend } from './Legend'
import { ScaleLadder } from './ScaleLadder'
import { ProofPanel } from './ProofPanel'

const AXIS_LABEL: Record<string, string> = { x: 'X', y: 'Y', z: 'Z' }

function signed(axis: string, dir: number): string {
  return `${dir === 1 ? '+' : '-'}${AXIS_LABEL[axis]}`
}

function Brand(): JSX.Element {
  return (
    <header className="brand">
      <img src="/logo.png" alt="ONOSENDAI" />
      <p>Cyberspace Protocol v2 spatial explorer</p>
    </header>
  )
}

function IdentityPanel(): JSX.Element {
  const identity = useCyberspace((s) => s.identity)

  return (
    <section className="panel">
      <header className="panel__head">
        <h2>Identity</h2>
        <span className="tag tag--local">LOCAL</span>
      </header>

      <div className="hash">
        <span className="hash__label">npub</span>
        <code>{identity.npub}</code>
      </div>

      <p className="legend__note">
        Spawned at this key's coordinate: the 256-bit pubkey decodes directly
        to x / y / z / plane (spec section 8.3). Persisted locally so
        refreshing keeps your identity and position.
      </p>
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

      <p className="legend__note">
        Looking along {signed(axes.out.axis, -axes.out.dir)}. R and F travel the
        axis into and out of the screen.
      </p>
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
        <PositionPanel />
        <BitReadout />
        <ScalePanel />
        <LinksPanel />
      </div>
      <div className="hud__col hud__col--right">
        <ProofPanel />
        <ChainPanel />
        <Legend />
        <Controls />
      </div>
    </div>
  )
}
