/**
 * Hud.tsx — the overlay: where you are, how far a keypress takes you, and
 * which way the world is turned.
 */

import { formatBig, formatStep } from '../lib/space'
import { useCyberspace } from '../store/useCyberspace'
import { Legend } from './Legend'
import { ProofPanel } from './ProofPanel'

const AXIS_LABEL: Record<string, string> = { x: 'X', y: 'Y', z: 'Z' }

function signed(axis: string, dir: number): string {
  return `${dir === 1 ? '+' : '-'}${AXIS_LABEL[axis]}`
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
  const moveCount = useCyberspace((s) => s.moveCount)
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
          <dt>Hops</dt>
          <dd>{moveCount}</dd>
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

      <p className="legend__note">
        Looking along {signed(axes.out.axis, -axes.out.dir)}. R and F travel the
        axis into and out of the screen.
      </p>
    </section>
  )
}

function Controls(): JSX.Element {
  const rows: Array<[string, string]> = [
    ['W A S D', 'move one step'],
    ['Shift + W A S D', 'rotate view 90°'],
    ['Tab', 'previous view'],
    ['Space', 'reset to top-down'],
    ['Q / E', 'scale step down / up'],
    ['R / F', 'move along depth axis'],
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

export function Hud(): JSX.Element {
  return (
    <div className="hud">
      <div className="hud__col hud__col--left">
        <PositionPanel />
        <ScalePanel />
      </div>
      <div className="hud__col hud__col--right">
        <ProofPanel />
        <Legend />
        <Controls />
      </div>
    </div>
  )
}
