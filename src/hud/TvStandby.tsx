/**
 * TvStandby.tsx: the 24/7 stream's stand-by (lib/tv/standby). Around the
 * whole app in broadcast mode only (main.tsx): a render error anywhere,
 * WebGL refused above all, puts TV's own NO SIGNAL card up in place of a
 * black page, with the stream's address, while the music plays on under it
 * (it lives outside React), and the page reloads as soon as it can draw.
 *
 * Only words TV already says (the chiron's CYBERSPACE TV, the tube's NO
 * SIGNAL, BROADCAST_TAG), and no WebGL: it has to draw when WebGL will not.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { BROADCAST_TAG } from '../lib/tv/broadcast'
import { standBy } from '../lib/tv/standby'

interface Props {
  children: ReactNode
}

interface State {
  error: unknown
}

export class TvStandby extends Component<Props, State> {
  state: State = { error: null }
  private stop: (() => void) | null = null

  static getDerivedStateFromError(error: unknown): State {
    return { error: error ?? new Error('unknown') }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[onosendai] TV stands by:', error, info.componentStack)
    if (!this.stop) this.stop = standBy(error)
  }

  componentWillUnmount(): void {
    this.stop?.()
    this.stop = null
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="tv-standby" role="status" aria-live="polite">
        <div className="tv-standby__card">
          <div className="tv-standby__name">CYBERSPACE <span className="tv-standby__tv">TV</span></div>
          <div className="tv-standby__status">NO SIGNAL</div>
        </div>
        <div className="tv-standby__url">{BROADCAST_TAG}</div>
      </div>
    )
  }
}
