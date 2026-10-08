/**
 * proofPanelAimed.test.ts - why a move did not go is said while the cursor
 * is still aimed (review of #236, item 1).
 *
 * The panel shows the preview of the move the cursor lines up, and the
 * proof's message lived only in the other branch, so "Can't confirm your
 * latest move; retrying.", "...Try again." and "Checking the signatures of
 * your saved chain." were set and never seen: the move just did not go.
 * (The panel itself is checked in a walled-off browser; a server render
 * reads a zustand store's initial state, not what a test sets.)
 */

import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
})
vi.mock('../../lib/workers', async (orig) => ({ ...(await orig() as object), postProof: () => {}, cancelProof: () => {} }))

import { BROKEN_CHAIN_MESSAGE, HEAD_RETRYING_MESSAGE, HEAD_UNCONFIRMED_MESSAGE, SIG_CHECK_MESSAGE } from '../../store/useCyberspace'
import { noticeWhileAimed } from '../ProofPanel'

describe('the Movement proof panel while the cursor is aimed', () => {
  it('says why the last press did not go: retrying, refused, or waiting on the signature check', () => {
    for (const message of [HEAD_RETRYING_MESSAGE, HEAD_UNCONFIRMED_MESSAGE, SIG_CHECK_MESSAGE]) {
      expect(noticeWhileAimed(true, { message }, false)).toBe(message)
    }
  })

  it('says nothing extra when there is nothing to say, when not aimed, or when the broken-chain line already says it', () => {
    expect(noticeWhileAimed(true, { message: null }, false)).toBeNull()
    expect(noticeWhileAimed(false, { message: HEAD_UNCONFIRMED_MESSAGE }, false)).toBeNull()
    expect(noticeWhileAimed(true, { message: BROKEN_CHAIN_MESSAGE }, true)).toBeNull()
  })
})
