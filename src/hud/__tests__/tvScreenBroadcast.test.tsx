/**
 * tvScreenBroadcast.test.tsx: on the 24/7 stream (/tv?broadcast=1) TV's
 * controls are not drawn: no close (X) and no RETRY, since nobody can tap a
 * stream. A viewer's TV keeps both.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const tv: { on: boolean; status: string } = { on: true, status: 'no-signal' }
vi.mock('../../store/useTv', () => ({
  useTv: Object.assign((pick: (s: typeof tv) => unknown) => pick(tv), { getState: () => ({ ...tv, stop: () => {}, retune: () => {} }) }),
  startTvInPlace: () => {},
  tvBlocked: () => null,
}))
vi.mock('../TvSegments', () => ({ TvSpinHost: () => <i className="spinhost" /> }))

import { TvScreen } from '../TvScreen'
import { setBroadcastForTest } from '../../lib/tv/broadcast'

afterEach(() => setBroadcastForTest(null))

describe('TV\'s controls', () => {
  it('are there for a viewer: OFF, and RETRY under NO SIGNAL', () => {
    setBroadcastForTest(false)
    const html = renderToStaticMarkup(<TvScreen />)
    expect(html).toContain('tv__off')
    expect(html).toContain('RETRY')
    expect(html).toContain('spinhost')
  })

  it('are not drawn on the stream; the shard host stays', () => {
    setBroadcastForTest(true)
    const html = renderToStaticMarkup(<TvScreen />)
    expect(html).not.toContain('tv__off')
    expect(html).not.toContain('RETRY')
    expect(html).not.toContain('<button')
    expect(html).toContain('spinhost')
  })
})
