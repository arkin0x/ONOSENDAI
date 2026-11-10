/**
 * blossomServerPicker.test.tsx: the picker as it renders after the page is
 * opened again. The owner's report (2026-11-10): he typed
 * http://blossom.oslim.dev to upload audio and wanted it "to stick to the list
 * and be my default"; it was in neither. And "If anyone adds any server
 * manually, it should stick."
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BlossomServerPicker, useBlossomChoice } from '../BlossomServer'
import { LEGACY_SERVER_KEY, rememberServer } from '../../lib/blossomChoice'
import { serverAnswered, BlossomRefusal, TransferTimeout } from '../../lib/blossom'

const m = new Map<string, string>()
;(globalThis as { localStorage?: Storage }).localStorage = {
  get length() { return m.size },
  clear: () => m.clear(),
  getItem: (k: string) => m.get(k) ?? null,
  key: (i: number) => [...m.keys()][i] ?? null,
  removeItem: (k: string) => { m.delete(k) },
  setItem: (k: string, v: string) => { m.set(k, String(v)) },
}

const PK = 'ab'.repeat(32)

function Picker({ pubkey }: { pubkey: string }): JSX.Element {
  const choice = useBlossomChoice(pubkey, false)
  return <BlossomServerPicker id="t" choice={choice} />
}

/** The options as rendered: [label, selected]. */
function options(pubkey = PK): Array<[string, boolean]> {
  const html = renderToStaticMarkup(createElement(Picker, { pubkey }))
  return [...html.matchAll(/<option value="[^"]*"( selected="")?>([^<]*)<\/option>/g)].map((x) => [x[2], !!x[1]])
}

describe('a typed server, after the picker mounts again', () => {
  beforeEach(() => m.clear())

  it('is in the list, marked yours, and selected', () => {
    rememberServer(PK, 'http://blossom.oslim.dev')
    const opts = options()
    expect(opts[0]).toEqual(['blossom.oslim.dev (yours)', true])
    expect(opts.filter(([, sel]) => sel)).toHaveLength(1)
    expect(opts.at(-1)?.[0]).toBe('Another server…')
  })

  it('stays in the list after an upload to a default, which is then selected', () => {
    rememberServer(PK, 'https://blossom.oslim.dev')
    rememberServer(PK, 'https://nostr.download')
    const opts = options()
    expect(opts[0]).toEqual(['nostr.download', true])
    expect(opts[1]).toEqual(['blossom.oslim.dev (yours)', false])
  })

  it('migrates from the one server the old picker kept', () => {
    m.set(LEGACY_SERVER_KEY, 'https://blossom.oslim.dev')
    expect(options()[0]).toEqual(['blossom.oslim.dev (yours)', true])
  })

  it('belongs to the key that used it', () => {
    rememberServer(PK, 'https://blossom.oslim.dev')
    const other = options('cd'.repeat(32))
    expect(other.map(([l]) => l)).not.toContain('blossom.oslim.dev (yours)')
    expect(other[0]).toEqual(['blossom.band', true])
  })
})

describe('which failed uploads still keep the server', () => {
  it('a refusal from the server (402, wants a subscription) keeps it; no answer does not', () => {
    expect(serverAnswered(new BlossomRefusal(402, 'subscription required'))).toBe(true)
    expect(serverAnswered(new BlossomRefusal(401, null))).toBe(true)
    expect(serverAnswered(new TypeError('Failed to fetch'))).toBe(false)
    expect(serverAnswered(new TransferTimeout('The server did not answer.'))).toBe(false)
    expect(serverAnswered(new Error('signer refused'))).toBe(false)
  })
})
