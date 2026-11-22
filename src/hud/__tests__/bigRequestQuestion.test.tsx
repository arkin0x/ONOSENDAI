/**
 * bigRequestQuestion.test.tsx: the question before a big request goes to a
 * remote signer (lib/signerRequestSize.ts), by its real buttons. TRY ANYWAY
 * answers yes; DON'T SEND, the ✕ and a tap outside answer no. No network.
 */
import { describe, expect, it, vi } from 'vitest'

if (typeof localStorage === 'undefined') {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, String(v)) },
    removeItem: (k: string) => { mem.delete(k) },
    clear: () => { mem.clear() },
  }
}
;(globalThis as { window?: unknown }).window ??= globalThis
;(globalThis as { document?: unknown }).document ??= { addEventListener: () => undefined, removeEventListener: () => undefined, body: { nodeType: 1 } }

// The modal is a portal; the test's tree holds it where it stands.
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (el: unknown) => el }))

import { createElement } from 'react'
import { mount } from '../../test/elementRoot'
import { signerRequestBigWords, useBigRequestQuestion } from '../../lib/signerRequestSize'
import { BigRequestQuestion } from '../SignerControls'

const shard = JSON.stringify({ kind: 33331, created_at: 1, tags: [], content: '' })

function open(): boolean[] {
  const answers: boolean[] = []
  useBigRequestQuestion.setState({
    question: {
      session: 'a'.repeat(64),
      method: 'sign_event',
      noun: 'the shard',
      bytes: 72_400,
      words: signerRequestBigWords('sign_event', [shard], 72_400),
      answer: (go) => { answers.push(go); useBigRequestQuestion.setState({ question: null }) },
    },
  })
  return answers
}

describe('the big-request question', () => {
  it('says the sizes honestly, and TRY ANYWAY answers yes', async () => {
    const answers = open()
    const modal = await mount(createElement(BigRequestQuestion))
    try {
      expect(modal.says('This is bigger than some signer apps can read (about 65 KB, this needs 73 KB). TRY ANYWAY, or make the shard smaller.')).toBe(true)
      await modal.press('TRY ANYWAY')
      expect(answers).toEqual([true])
      expect(modal.says('This is bigger')).toBe(false)
    } finally {
      await modal.unmount()
    }
  })

  it("DON'T SEND answers no", async () => {
    const answers = open()
    const modal = await mount(createElement(BigRequestQuestion))
    try {
      await modal.press("DON'T SEND")
      expect(answers).toEqual([false])
    } finally {
      await modal.unmount()
    }
  })

  it('draws nothing when no question is open', async () => {
    useBigRequestQuestion.setState({ question: null })
    const modal = await mount(createElement(BigRequestQuestion))
    try {
      expect(modal.buttons('TRY ANYWAY')).toHaveLength(0)
    } finally {
      await modal.unmount()
    }
  })
})
