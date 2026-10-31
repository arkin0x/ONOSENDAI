/**
 * The capture behind ?diag=1 (lib/diag.ts): off it is never loaded, and what it
 * holds is sizes and labels, never a payload.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { diagWanted, DIAG_KEY } from '../diagGate'
import { DIAG_COLUMNS, GlLedger, Ring, bytesPerPixel, framePercentiles, frameVerb, heapReading, invokerLabel, safeDescription, safeLabel, toRow, uploadedBytes } from '../diagCore'

const SRC = path.resolve(__dirname, '../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== '__tests__') walk(p, out) }
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

function memoryStore(init: Record<string, string> = {}): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; map: Map<string, string> } {
  const map = new Map(Object.entries(init))
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) }
}

describe('off costs nothing', () => {
  it('no module imports the capture statically, so its chunk is never fetched', () => {
    const offenders = walk(SRC).filter((f) => {
      const text = fs.readFileSync(f, 'utf8')
      return /^\s*import\s[^\n]*from\s+['"][^'"]*\/diag['"]/m.test(text) || /^\s*import\s[^\n]*from\s+['"][^'"]*\/diagCore['"]/m.test(text) && !f.endsWith(path.join('lib', 'diag.ts'))
    })
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([])
  })

  it('main loads it only behind the gate', () => {
    const main = fs.readFileSync(path.join(SRC, 'main.tsx'), 'utf8')
    expect(main).toMatch(/if \(diagWanted\(location\.search, tabStore\)\) void import\('\.\/lib\/diag'\)/)
    expect(main).toMatch(/else boot\(\)/)
  })

  it('wraps nothing at import: every prototype change is inside startDiag', () => {
    const text = fs.readFileSync(path.join(SRC, 'lib/diag.ts'), 'utf8')
    const start = text.indexOf('export function startDiag')
    expect(start).toBeGreaterThan(0)
    expect(text.slice(0, start)).not.toMatch(/\.prototype/)
  })
})

describe('the gate', () => {
  it('is off by default', () => {
    expect(diagWanted('', memoryStore())).toBe(false)
    expect(diagWanted('?foo=1', memoryStore())).toBe(false)
    expect(diagWanted('?diag=2', memoryStore())).toBe(false)
  })
  it('?diag=1 turns it on and it stays for the tab', () => {
    const s = memoryStore()
    expect(diagWanted('?diag=1', s)).toBe(true)
    expect(s.map.get(DIAG_KEY)).toBe('1')
    expect(diagWanted('', s)).toBe(true)
  })
  it('?diag=0 turns it off for good', () => {
    const s = memoryStore({ [DIAG_KEY]: '1' })
    expect(diagWanted('?diag=0', s)).toBe(false)
    expect(diagWanted('', s)).toBe(false)
  })
  it('a tab that refuses storage still honours the link', () => {
    const refusing = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => { throw new Error('no') } }
    expect(diagWanted('?diag=1', refusing)).toBe(true)
    expect(diagWanted('', refusing)).toBe(false)
    expect(diagWanted('?diag=1', null)).toBe(true)
  })
})

describe('nothing private leaves', () => {
  const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5'
  const HEX = 'cfe6b74cab677b52d850ac659d54266a3a4d7bb48270234d2fec836881d0a5f7'

  it('a label cannot carry a key, a coordinate, a URL or a sentence', () => {
    expect(safeLabel(NSEC)).not.toMatch(/nsec1/i)
    expect(safeLabel(`x${HEX}`)).not.toContain(HEX.slice(0, 16))
    expect(safeLabel('wss://relay.example.com/private?token=abc')).toBe('#url')
    expect(safeLabel('meet me at the old port')).not.toContain(' ')
    expect(safeLabel(undefined)).toBe('')
    expect(safeLabel('x'.repeat(500)).length).toBeLessThanOrEqual(48)
  })

  it('a key survives no prefix, no case and no punctuation (review of #551)', () => {
    for (const s of [`key_${NSEC}`, NSEC.toUpperCase(), `x${NSEC}`, `view${NSEC.replace('nsec', 'npub')}`, `key ${NSEC.slice(0, 20)} ${NSEC.slice(20)}`, `note1${'q'.repeat(40)}`, `naddr1${'q'.repeat(40)}`]) {
      expect(safeLabel(s, 500)).not.toMatch(/(nsec|npub|note|naddr)1/i)
    }
  })

  it('hex split up by punctuation does not rejoin, and upper case is hex too', () => {
    expect(safeLabel(`${HEX.slice(0, 20)} ${HEX.slice(20, 40)}`, 500)).not.toMatch(/[0-9a-f]{16}/i)
    expect(safeLabel(HEX.toUpperCase(), 500)).not.toMatch(/[0-9A-F]{16}/)
  })

  it('every kind of URL goes whole, not just its punctuation', () => {
    for (const u of ['https://a.example/x', 'HTTP://a.example', 'wss://relay.example', 'ws://localhost', 'blob:https://x/y', 'data:image/png;base64,AAAA', 'file:///etc/passwd']) {
      expect(safeLabel(u)).toBe('#url')
    }
  })

  it('a long frame\'s invoker says the element, never its src (review of #551)', () => {
    expect(invokerLabel('IMG[src=https://images.example/avatars/alice.png].onerror')).toBe('IMG.onerror')
    expect(invokerLabel('IMG[src=https://images.example/a.png].onload')).toBe('IMG.onload')
    expect(invokerLabel('DIV#someones-profile.onclick')).toBe('DIV.onclick')
    expect(invokerLabel('TimerHandler:setTimeout')).toBe('TimerHandler:setTimeout')
    expect(invokerLabel('Window.requestAnimationFrame')).toBe('Window.requestAnimationFrame')
    expect(invokerLabel(undefined)).toBe('')
  })

  it('the browser\'s own description still reads, and passes the same rule', () => {
    expect(safeDescription('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toContain('GeForce_RTX_3080')
    expect(safeDescription(`gpu at https://x.example/${HEX}`)).toBe('#url')
    expect(safeDescription(`x ${NSEC}`)).not.toMatch(/nsec1/i)
  })

  it('a socket frame gives up only its verb', () => {
    expect(frameVerb('["REQ","a",{}]')).toBe('req')
    expect(frameVerb('["CLOSE","a"]')).toBe('close')
    expect(frameVerb(`["EVENT",{"content":"${NSEC}"}]`)).toBe('event')
    expect(frameVerb('["AUTH",{}]')).toBe('auth')
    expect(frameVerb(new ArrayBuffer(2))).toBe('other')
  })

  it('the capture reads storage only for its size, and message data only for its length', () => {
    const text = fs.readFileSync(path.join(SRC, 'lib/diag.ts'), 'utf8')
    expect(text.match(/localStorage\.getItem\([^)]*\)[^;\n]*/g)).toEqual(['localStorage.getItem(key)?.length ?? 0) }'])
    expect(text).not.toMatch(/indexedDB\.|location\.search/)
    // This tab's storage holds only the capture's own keys.
    expect([...text.matchAll(/sessionStorage\.(?:get|set|remove)Item\(([A-Z_]+)/g)].every((m) => ['DIAG_KEY', 'LAST_KEY', 'FOUND_KEY'].includes(m[1]))).toBe(true)
    // The address is read once, to go back to it without the flag, and never kept.
    expect(text.match(/location\.href/g)).toHaveLength(1)
    expect(text).toMatch(/new URL\(location\.href\)/)
    expect(text.match(/e\.data\b[^;\n]*/g)!.every((l) => /\.length/.test(l))).toBe(true)
    expect(text).not.toMatch(/JSON\.parse/)
  })
})

describe('the ledger', () => {
  const gl = {}, tex = {}, tex2 = {}, buf = {}, rb = {}
  const totals = (l: GlLedger): ReturnType<GlLedger['totals']> => l.totals([gl], () => false)

  it('sums a buffer by what was last given it, until it is deleted', () => {
    const l = new GlLedger()
    l.bindBuffer(gl, 34962, buf)
    l.bufferData(gl, 34962, 1000)
    l.bufferData(gl, 34962, 400)
    expect(totals(l).bufferBytes).toBe(400)
    expect(l.counts.bufferDataBytes).toBe(1400)
    l.deleteBuffer(gl, buf)
    expect(totals(l).bufferBytes).toBe(0)
  })

  it('a multisampled target at 1440p costs its samples', () => {
    const l = new GlLedger()
    l.bindRenderbuffer(gl, rb)
    l.renderbufferStorage(gl, 4, 0x8058, 2560, 1440)
    expect(totals(l).renderbufferBytes).toBe(2560 * 1440 * 4 * 4)
    expect(l.largest([gl], () => false)[0]).toMatchObject({ kind: 'rb', size: '2560x1440', samples: 4, count: 1 })
    l.deleteRenderbuffer(gl, rb)
    expect(totals(l).renderbufferBytes).toBe(0)
  })

  it('textures are kept per unit, and their mips count', () => {
    const l = new GlLedger()
    l.activeTexture(gl, 0)
    l.bindTexture(gl, 3553, tex)
    l.activeTexture(gl, 1)
    l.bindTexture(gl, 3553, tex2)
    l.activeTexture(gl, 0)
    l.textureLevel(gl, 3553, 0, 0x8058, 256, 256)
    expect(totals(l).textureBytes).toBe(256 * 256 * 4)
    expect(totals(l).textures).toBe(1)
    l.mipmap(gl, 3553)
    expect(totals(l).textureBytes).toBeGreaterThan(256 * 256 * 4 * 1.33)
    expect(totals(l).textureBytes).toBeLessThan(256 * 256 * 4 * 1.34)
    l.deleteTexture(gl, tex)
    expect(totals(l).textureBytes).toBe(0)
  })

  it('storage counts every level', () => {
    const l = new GlLedger()
    l.bindTexture(gl, 3553, tex)
    l.textureStorage(gl, 3553, 2, 0x881a, 100, 100)
    expect(totals(l).textureBytes).toBe(100 * 100 * 8 + 50 * 50 * 8)
  })

  it('a lost context holds nothing, and counts reset at each take', () => {
    const l = new GlLedger()
    l.bindBuffer(gl, 34962, buf)
    l.bufferData(gl, 34962, 1000)
    expect(l.totals([gl], () => true).bufferBytes).toBe(0)
    expect(l.takeCounts().bufferData).toBe(1)
    expect(l.takeCounts().bufferData).toBe(0)
  })

  it('an unknown format counts as four bytes', () => {
    expect(bytesPerPixel(0x8058)).toBe(4)
    expect(bytesPerPixel(0x881a)).toBe(8)
    expect(bytesPerPixel(12345)).toBe(4)
  })
})

describe('the log stays small', () => {
  it('percentiles of a window', () => {
    const a = new Float32Array(100)
    for (let i = 0; i < 100; i++) a[i] = 100 - i
    expect(framePercentiles(a, 100)).toEqual({ p50: 51, p95: 96, p99: 100, max: 100 })
    expect(framePercentiles(a, 0)).toEqual({ p50: 0, p95: 0, p99: 0, max: 0 })
  })
  it('a ring drops its oldest', () => {
    const r = new Ring<number>(3)
    for (let i = 0; i < 10; i++) r.push(i)
    expect(r.all()).toEqual([7, 8, 9])
  })
  it('a full log stays under a megabyte, both rings at their largest', () => {
    const row = toRow(Object.fromEntries(DIAG_COLUMNS.map((c) => [c, 1234567890])))
    expect(row.length).toBe(DIAG_COLUMNS.length)
    expect(JSON.stringify(row).length * (360 + 720)).toBeLessThan(1024 * 1024)
  })
  it('nothing read is null, not a 0 that looks measured (review of #551)', () => {
    const row = toRow({ t: 5, heapUsed: 0 })
    expect(row[DIAG_COLUMNS.indexOf('t')]).toBe(5)
    expect(row[DIAG_COLUMNS.indexOf('heapUsed')]).toBe(0)
    expect(row[DIAG_COLUMNS.indexOf('glBufferB')]).toBeNull()
  })
  it('has no columns that read 1 because the last full-screen pass reset them', () => {
    expect(DIAG_COLUMNS).not.toContain('riCalls')
    expect(DIAG_COLUMNS).not.toContain('riTriangles')
    expect(DIAG_COLUMNS).toContain('draws')
    expect(DIAG_COLUMNS).toContain('verts')
  })
})

describe('what a texture call hands over', () => {
  it('counts pixels in an array by their length', () => {
    expect(uploadedBytes([0, 0, 0, 2, 2, 0, 0, 0, new Uint8Array(16)], 2, 2)).toBe(16)
  })
  it('counts nothing for a call that only sizes storage', () => {
    expect(uploadedBytes([0, 0, 0, 2, 2, 0, 0, 0, null], 2, 2)).toBe(0)
  })
  it('counts an image or canvas by its size', () => {
    expect(uploadedBytes([0, 0, 0, 0, 0, { width: 4, height: 4 }], 4, 4)).toBe(64)
    expect(uploadedBytes([0, 0, 0, 0, 0, 0, { width: 4, height: 4 }], 4, 4)).toBe(64)
  })
})

describe('how exact the heap reading is', () => {
  it('says which it is, and absent is not 0', () => {
    expect(heapReading([])).toBe('absent')
    expect(heapReading([10_000_000, 11_000_000])).toBe('bucketed')
    expect(heapReading([10_000_000, 11_234_567])).toBe('precise')
  })
})
