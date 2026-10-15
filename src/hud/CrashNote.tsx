/**
 * CrashNote.tsx: a render error shown on screen instead of a blank page.
 *
 * React unmounts everything under the nearest boundary when a render
 * throws, and this app had none, so a crash in one modal blanked the whole
 * screen with the reason visible only in a console nobody on a phone can
 * open (arkinox, 2026-10-09, a bag record that crashed on tap). A boundary
 * around the HUD and another around the modals keeps the scene up and shows
 * the error where the modal was: its message, the top of its stack, COPY
 * so it can be pasted into a report, CLOSE to leave the modal that crashed,
 * and RELOAD.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLootView } from '../store/useLootView'
import { useShards } from '../store/useShards'

interface Props {
  /** Which part of the screen this guards, for the note's title. */
  where: string
  children: ReactNode
}

interface State {
  error: Error | null
  stack: string
  copied: boolean
}

export class CrashNote extends Component<Props, State> {
  state: State = { error: null, stack: '', copied: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, copied: false }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The component stack says which modal; the error's own stack says where.
    const stack = `${error.stack ?? ''}\n${info.componentStack ?? ''}`.trim()
    this.setState({ stack })
    console.error('[onosendai] render crashed in', this.props.where, error, info.componentStack)
  }

  private report(): string {
    const { error, stack } = this.state
    return `ONOSENDAI crashed in ${this.props.where}\n${error?.name ?? 'Error'}: ${error?.message ?? ''}\n${stack}`
  }

  private copy = (): void => {
    void navigator.clipboard?.writeText(this.report()).then(() => this.setState({ copied: true }), () => { /* a copy that fails leaves the text on screen */ })
  }

  private close = (): void => {
    // Leave whatever was open, so the same render is not tried again at once.
    useLootView.getState().select(null)
    useShards.getState().setNearbyOpen(false)
    this.setState({ error: null, stack: '', copied: false })
  }

  render(): ReactNode {
    const { error, stack, copied } = this.state
    if (!error) return this.props.children
    const lines = stack.split('\n').filter((l) => l.trim()).slice(0, 8).join('\n')
    return (
      <div className="modal" role="alertdialog" aria-modal="true" aria-label="Something crashed">
        <div className="modal__card crash" onPointerDown={(e) => e.stopPropagation()}>
          <header className="panel__head">
            <h2>Crashed</h2>
            <span className="tag tag--warn">{this.props.where}</span>
          </header>
          <p className="crash__message">{error.name}: {error.message}</p>
          <pre className="crash__stack">{lines}</pre>
          <div className="modal__row">
            <button className="modal__cancel" onClick={this.copy}>{copied ? 'COPIED' : 'COPY'}</button>
            <button className="modal__cancel" onClick={this.close}>CLOSE</button>
            <button className="modal__cancel" onClick={() => window.location.reload()}>RELOAD</button>
          </div>
        </div>
      </div>
    )
  }
}
