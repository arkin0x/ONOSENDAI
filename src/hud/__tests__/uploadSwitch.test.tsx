/**
 * uploadSwitch.test.tsx - a file chosen as one identity is never uploaded
 * under another's signature (identity-switch audit, 2026-11-19).
 *
 * PLACE AUDIO encrypts the file before its upload is signed, and a profile
 * picture is hashed first: each takes a moment. A switch of identity in that
 * moment had the identity signed in since sign the old one's upload, and the
 * file went on to be placed, or put in the profile form, as the new one's.
 * Each upload here is a stand-in that switches identity before it asks for
 * its signature. No network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../../lib/relay', () => ({
  publishMany: vi.fn(async () => ({ ok: true })),
  query: vi.fn(async () => []),
  queryAny: vi.fn(async () => []),
  relaySet: () => ['wss://relay.test'],
}))

// Radix's switch reads the DOM, which these hosts are not: plain stand-ins, the form's own logic untouched.
vi.mock('../ui/Switch', async () => {
  const { createElement: h, Fragment } = await import('react')
  return { Field: ({ children }: { children?: unknown }) => h(Fragment, null, children as never), Switch: () => null }
})

/** Runs before the stand-in upload asks for its signature (the file is encrypted by then). */
const upload = vi.hoisted(() => ({ beforeSign: null as null | (() => void), afterSign: null as null | (() => void) }))
vi.mock('../../lib/audioFile', async (orig) => {
  const real = await orig<typeof import('../../lib/audioFile')>()
  return {
    ...real,
    sealAndUpload: async (_file: Blob, server: string, sign: (t: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<unknown>) => {
      upload.beforeSign?.()
      await sign({ kind: 24242, created_at: Math.floor(Date.now() / 1000), tags: [['t', 'upload']], content: 'Upload' })
      upload.afterSign?.()
      const hash = 'ab'.repeat(32)
      return { url: `${server}/${hash}`, hash, originalHash: 'cd'.repeat(32), keyHex: '11'.repeat(32), nonceHex: '22'.repeat(12), mime: 'audio/mpeg', size: 4 }
    },
  }
})

// The profile modal draws into document.body: here, in place.
vi.mock('react-dom', async (orig) => ({ ...(await orig<typeof import('react-dom')>()), createPortal: (node: unknown) => node }))
vi.mock('../../lib/blossom', async (orig) => {
  const real = await orig<typeof import('../../lib/blossom')>()
  return {
    ...real,
    uploadBlob: async (server: string, _file: Blob, sign: (t: { kind: number; created_at: number; tags: string[][]; content: string }) => Promise<unknown>) => {
      upload.beforeSign?.()
      await sign({ kind: 24242, created_at: Math.floor(Date.now() / 1000), tags: [['t', 'upload']], content: 'Upload' })
      upload.afterSign?.()
      const hash = 'ef'.repeat(32)
      return { url: `${server}/${hash}`, sha256: hash, size: 4, type: 'image/png', uploaded: 1 }
    },
  }
})

import { createElement } from 'react'
import type { EventTemplate } from '../../lib/events'
import { mount, type Host } from '../../test/elementRoot'
import { useCyberspace } from '../../store/useCyberspace'
import { AudioUpload } from '../AudioCompose'
import { ProfileModal } from '../ProfileModal'

/** Every signature the store was asked for, with the identity on screen when it was asked. */
let asked: { kind: number; as: string }[] = []

beforeEach(() => {
  asked = []
  upload.beforeSign = null
  upload.afterSign = null
})

describe('PLACE AUDIO when the identity switches while the file is encrypted', () => {
  it('asks the new identity to sign nothing, and hands nothing on to be placed', async () => {
    const realSign = useCyberspace.getState().signEvent
    const was = useCyberspace.getState().identity
    useCyberspace.setState({
      signEvent: (t: EventTemplate, patience?: number, late?: Parameters<typeof realSign>[2]) => {
        asked.push({ kind: t.kind, as: useCyberspace.getState().identity.pubkey })
        return realSign(t, patience, late)
      },
    })
    const ready = vi.fn()
    const other = 'b2'.repeat(32)
    try {
      const view = await mount(createElement(AudioUpload, { idPrefix: 't', submitLabel: 'AIM IT', onReady: ready, onCancel: () => {} }))
      const input = view.all().find((h: Host) => h.type === 'input' && h.props.type === 'file')!
      ;(input.props.onChange as (e: unknown) => void)({ target: { files: [new File([new Uint8Array([1, 2, 3, 4])], 'drip.mp3', { type: 'audio/mpeg' })], value: '' } })
      await new Promise((r) => setTimeout(r, 20))
      upload.beforeSign = () => { useCyberspace.setState({ identity: { pubkey: other, npub: 'npub-other' } }) }
      await view.press('AIM IT')
      expect(asked.filter((a) => a.as === other)).toEqual([])
      expect(ready).not.toHaveBeenCalled()
      expect(view.says('switched identity')).toBe(true)
      await view.unmount()
    } finally {
      useCyberspace.setState({ signEvent: realSign, identity: was })
    }
  })
})

describe('a profile picture when the identity switches while the file is hashed', () => {
  it('asks the new identity to sign nothing, and puts nothing in the form', async () => {
    const realSign = useCyberspace.getState().signEvent
    const was = useCyberspace.getState().identity
    useCyberspace.setState({
      signEvent: (t: EventTemplate, patience?: number, late?: Parameters<typeof realSign>[2]) => {
        asked.push({ kind: t.kind, as: useCyberspace.getState().identity.pubkey })
        return realSign(t, patience, late)
      },
    })
    const other = 'b2'.repeat(32)
    try {
      const view = await mount(createElement(ProfileModal, { onClose: () => {} }))
      const input = view.all().find((h: Host) => h.type === 'input' && h.props.type === 'file')!
      upload.beforeSign = () => { useCyberspace.setState({ identity: { pubkey: other, npub: 'npub-other' } }) }
      ;(input.props.onChange as (e: unknown) => void)({ target: { files: [new File([new Uint8Array([1, 2, 3, 4])], 'me.png', { type: 'image/png' })], value: '' } })
      await new Promise((r) => setTimeout(r, 50))
      expect(asked.filter((a) => a.as === other)).toEqual([])
      expect(view.all().some((h: Host) => typeof h.props.value === 'string' && (h.props.value as string).includes('ef'.repeat(32)))).toBe(false)
      expect(view.says('switched identity')).toBe(true)
      await view.unmount()
    } finally {
      useCyberspace.setState({ signEvent: realSign, identity: was })
    }
  })
})

describe('an upload that finishes after a switch of identity', () => {
  it('PLACE AUDIO: is not handed on to be placed as the new identity', async () => {
    const was = useCyberspace.getState().identity
    const ready = vi.fn()
    try {
      const view = await mount(createElement(AudioUpload, { idPrefix: 't2', submitLabel: 'AIM IT', onReady: ready, onCancel: () => {} }))
      const input = view.all().find((h: Host) => h.type === 'input' && h.props.type === 'file')!
      ;(input.props.onChange as (e: unknown) => void)({ target: { files: [new File([new Uint8Array([1, 2, 3, 4])], 'drip.mp3', { type: 'audio/mpeg' })], value: '' } })
      await new Promise((r) => setTimeout(r, 20))
      upload.afterSign = () => { useCyberspace.setState({ identity: { pubkey: 'b2'.repeat(32), npub: 'npub-other' } }) }
      await view.press('AIM IT')
      expect(ready).not.toHaveBeenCalled()
      expect(view.says('switched identity')).toBe(true)
      await view.unmount()
    } finally {
      useCyberspace.setState({ identity: was })
    }
  })

  it('profile picture: its address is not put in the form', async () => {
    const was = useCyberspace.getState().identity
    try {
      const view = await mount(createElement(ProfileModal, { onClose: () => {} }))
      const input = view.all().find((h: Host) => h.type === 'input' && h.props.type === 'file')!
      upload.afterSign = () => { useCyberspace.setState({ identity: { pubkey: 'b2'.repeat(32), npub: 'npub-other' } }) }
      ;(input.props.onChange as (e: unknown) => void)({ target: { files: [new File([new Uint8Array([1, 2, 3, 4])], 'me.png', { type: 'image/png' })], value: '' } })
      await new Promise((r) => setTimeout(r, 50))
      expect(view.all().some((h: Host) => typeof h.props.value === 'string' && (h.props.value as string).includes('ef'.repeat(32)))).toBe(false)
      expect(view.says('switched identity')).toBe(true)
      await view.unmount()
    } finally {
      useCyberspace.setState({ identity: was })
    }
  })
})
