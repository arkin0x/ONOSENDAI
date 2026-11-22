/**
 * publishStatusOk.test.ts: an action a relay took stays taken. The backlog
 * (lib/unsent.ts), which the publisher sends from, counts on an 'ok' never
 * going back; a late failure of the same action's send (another send or a
 * relay's echo marked it first) does not undo it.
 */
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { useCyberspace } from '../useCyberspace'

describe('publish status', () => {
  it('a failure reported after an action was marked taken leaves it taken', () => {
    useCyberspace.setState({ published: { a: 'ok', b: 'sending' } } as never)
    useCyberspace.getState().setPublishStatus('a', 'failed', 'timed out')
    useCyberspace.getState().setPublishStatus('b', 'failed', 'timed out')
    expect(useCyberspace.getState().published).toEqual({ a: 'ok', b: 'failed' })
  })
})
