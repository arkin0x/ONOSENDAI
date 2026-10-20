/**
 * tvSpinHost.test.tsx: the segment's turning shard keeps one canvas while the
 * set is on, there with a shard and without one (review of #394): a host
 * that came and went with its shard made a WebGL context per segment.
 */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ShardModel } from 'sno-core/shards'

// The canvas itself needs WebGL: a stand-in that says what it was given.
vi.mock('../../scene/ShardSpin', () => ({
  ShardSpin: ({ shard, pace }: { shard: ShardModel | null; pace?: unknown }) => <i className="spin" data-shard={shard?.name ?? ''} data-paced={String(pace === paceSpin)} />,
}))
vi.mock('../../workshop/ObjectPicker', () => ({
  objectsOf: () => [{ shard: { name: 'RELIC' } }],
}))
// Rendered on the server a store reads its first state: the shot comes from here.
const tv: { shot: unknown } = { shot: null }
vi.mock('../../store/useTv', () => ({
  useTv: (pick: (s: typeof tv) => unknown) => pick(tv),
  placeable: () => true,
}))

import { TvSpinHost, paceSpin, tvSpin } from '../TvSegments'

const shot = (item: unknown): never => ({ id: 'x', kind: 'object', pubkey: 'p', beats: [], start: 1, end: 2, offsets: [], length: 5, item }) as never

describe('the TV spin host', () => {
  it('keeps its canvas with no shard on screen, empty', () => {
    tv.shot = shot({ kind: 'bag', id: 'b' })
    const html = renderToStaticMarkup(<TvSpinHost />)
    expect(html).toContain('tv__spinhost')
    expect(html).toContain('class="spin" data-shard=""')
  })

  it('and with one, the same canvas with the shard in it', () => {
    tv.shot = shot({ kind: 'object', id: 'o', event: {} })
    const html = renderToStaticMarkup(<TvSpinHost />)
    expect(html).toContain('tv__spinhost')
    expect(html).toContain('data-shard="RELIC"')
  })

  it('asks its canvas for frames at the painter\'s pace, not the display\'s', () => {
    tv.shot = shot({ kind: 'object', id: 'o', event: {} })
    expect(renderToStaticMarkup(<TvSpinHost />)).toContain('data-paced="true"')
  })
})

describe('the spin\'s ask for a frame', () => {
  it('is the newest canvas\'s, and one going away late does not take it from the next (review of #414)', () => {
    const a = (): void => {}
    const b = (): void => {}
    paceSpin(a, a)
    expect(tvSpin.next).toBe(a)
    paceSpin(b, b)
    paceSpin(null, a)
    expect(tvSpin.next).toBe(b)
    paceSpin(null, b)
    expect(tvSpin.next).toBeNull()
  })
})
