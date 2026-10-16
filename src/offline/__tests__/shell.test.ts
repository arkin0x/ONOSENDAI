/**
 * shell.test.ts - the offline worker's file list and how it is written in.
 *
 * What would go wrong silently: a lazy chunk or a worker missing from the
 * list (the panel that needs it never opens offline), or the placeholders
 * left in, which makes /sw.js a syntax error and caches nothing.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { precacheList, renderWorker } from '../shell'

describe('the offline worker', () => {
  it('lists every bundle and public file once, index.html first, without the link-preview card or itself', () => {
    const list = precacheList(['index.html', 'assets/index-abc.js', 'assets/proof.worker-x.js', 'sw.js'], ['/coastline-10m.bin', '/og.png', '/fonts/a.woff2', '/coastline-10m.bin'])
    expect(list).toEqual(['/index.html', '/assets/index-abc.js', '/assets/proof.worker-x.js', '/coastline-10m.bin', '/fonts/a.woff2'])
  })

  it('fills both placeholders, and the result parses', () => {
    const template = readFileSync(new URL('../sw.js', import.meta.url), 'utf8')
    const out = renderWorker(template, 'mvaaq3u7-1x', ['/index.html', '/assets/a.js'])
    expect(out).not.toContain('__ONOSENDAI_')
    expect(out).toContain('const BUILD = "mvaaq3u7-1x"')
    expect(out).toContain('const FILES = ["/index.html","/assets/a.js"]')
    expect(() => new Function(out)).not.toThrow()
  })
})
