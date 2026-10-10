/**
 * clientTagGuard.test.ts: no publishing path can sign around the client tag.
 *
 * arkinox asked twice (2026-10-04 and 2026-10-10) that every event ONOSENDAI
 * publishes carry ["client", "ONOSENDAI"]. The tag is added in one place,
 * the signers (lib/signers.ts, through lib/client.ts attributed), so this
 * scans the source for the two ways around it: signing with a raw key
 * outside signers.ts, and a signer in signers.ts whose signEvent neither
 * attributes the template nor hands it to another signer that does.
 * An audit of arkinox's own events on 2026-10-10 found every event from
 * ONOSENDAI tagged; this keeps it so.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..', '..')

function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) { if (name !== '__tests__') out.push(...sources(path)); continue }
    if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path)
  }
  return out
}

describe('the client tag cannot be signed around', () => {
  it('only lib/signers.ts signs with a raw key', () => {
    const raw = sources(SRC)
      .filter((f) => /\b(finalizeEvent|schnorr\.sign)\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(SRC, f))
    expect(raw).toEqual(['lib/signers.ts'])
  })

  it('every signer in lib/signers.ts attributes its template or delegates to a signer that does', () => {
    const text = readFileSync(join(SRC, 'lib', 'signers.ts'), 'utf8')
    const lines = text.split('\n').filter((l) => /^\s*signEvent:\s*\(template\)\s*=>/.test(l))
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(/attributed\(template\)|\bs\.signEvent\(template\)/.test(line), line.trim()).toBe(true)
    }
  })
})
