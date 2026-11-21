/**
 * The capture behind ?diag=1 (lib/diag.ts): off it is never loaded, and what it
 * holds is sizes and labels, never a payload.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { diagWanted, DIAG_FOUND_KEY, DIAG_KEY, DIAG_LAST_KEY } from '../diagGate'
import { DIAG_COLUMNS, GlLedger, VERIFY_COLUMNS, rxVerb, verifyRow, LOAF_COLUMNS, LOAF_MIN_MS, LOAF_SCRIPT_COLUMNS, LOAF_TOP, LoafLedger, Ring, scriptFile, bytesPerPixel, framePercentiles, frameVerb, heapReading, invokerLabel, largestKeys, safeDescription, safeLabel, toRow, uploadedBytes } from '../diagCore'

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

  it('the app (boot.tsx) loads it only behind the gate', () => {
    const main = fs.readFileSync(path.join(SRC, 'boot.tsx'), 'utf8')
    expect(main).toMatch(/if \(diagWanted\(location\.search, tabStore\)\) \{[\s\S]*?import\('\.\/lib\/diag'\)[\s\S]*?\} else boot\(\)/)
  })

  it('a chunk that stalls cannot hold the first render', () => {
    const main = fs.readFileSync(path.join(SRC, 'boot.tsx'), 'utf8')
    expect(main).toMatch(/setTimeout\(once, DIAG_WAIT_MS\)/)
    expect(main).toMatch(/\.finally\(once\)/)
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
  it('?diag=0 takes what it kept with it', () => {
    const s = memoryStore({ [DIAG_KEY]: '1', [DIAG_LAST_KEY]: '{}', [DIAG_FOUND_KEY]: '{}' })
    diagWanted('?diag=0', s)
    expect(s.map.size).toBe(0)
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
    // An address with a bracket in it, and an id with a dot in it (re-review of #551).
    expect(invokerLabel('IMG[src=https://secret-host.example.test/a]b/diary-bracket.png].onload')).toBe('IMG.onload')
    expect(invokerLabel('IMG#secret-id.tailsecret.onload')).toBe('IMG.onload')
    expect(invokerLabel('IMG#logo[src=https://secret-host.example.test/x.png].onerror')).toBe('IMG.onerror')
    expect(invokerLabel('Response.json.then')).toBe('Response.json.then')
  })

  it('the browser\'s own description still reads, and passes the same rule', () => {
    expect(safeDescription('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toContain('GeForce_RTX_3080')
    expect(safeDescription(`gpu at https://x.example/${HEX}`)).toBe('#url')
    expect(safeDescription(`x ${NSEC}`)).not.toMatch(/nsec1/i)
  })

  describe('hostile strings (re-review of #551)', () => {
    const split = (s: string, n: number, sep: string): string => s.match(new RegExp(`.{1,${n}}`, 'g'))!.join(sep)
    const both = (s: string): string[] => [safeLabel(s, 500), safeDescription(s, 500), invokerLabel(s)]
    const urls = ['ftp://secret-host.example/x', 'ipfs://QmSecret/d.png', '//secret-host.example/x', 'wss ://relay.example/x', 'https://a/b', 'data:image/png;base64,AA', 'blob:https://x/y', 'magnet:?xt=urn:btih:abc', 'chrome-extension://abcdef/inpage.js']
    for (const u of urls) {
      it(`an address goes whole: ${u}`, () => { expect(both(u)).toEqual(['#url', '#url', '#url']) })
    }
    const pieces = [split(HEX, 8, ' '), split(HEX, 12, '/'), split(HEX, 8, '-'), split(HEX, 8, ':'), split(HEX, 8, '.'), split(HEX, 8, '_'), split(HEX, 4, '-'), `${NSEC.slice(0, 20)}/${NSEC.slice(20)}`, `${NSEC.slice(0, 20)}-${NSEC.slice(20)}`, `${NSEC.slice(0, 20)}.${NSEC.slice(20)}`]
    for (const p of pieces) {
      it(`broken up, it does not rejoin: ${p.slice(0, 30)}`, () => { for (const out of both(p)) expect(out).toBe('#') })
    }
    const real = [
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00003E9B) Direct3D11 vs_5_0 ps_5_0, D3D11-27.20.100.8681)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    ]
    for (const r of real) {
      it(`a real browser string still reads: ${r.slice(0, 30)}`, () => { expect(safeDescription(r).length).toBeGreaterThan(30) })
    }
    it('a driver version survives', () => { expect(safeDescription(real[1])).toContain('D3D11-27.20.100.8681') })
    it('the invokers we need stay as they are', () => {
      for (const v of ['Window.requestAnimationFrame', 'TimerHandler:setTimeout', 'Response.json.then']) expect(invokerLabel(v)).toBe(v)
    })
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
    expect(text.match(/localStorage\.getItem\([^)]*\)[^;\n]*/g)).toEqual(['localStorage.getItem(key)?.length ?? 0)'])
    expect(text).not.toMatch(/indexedDB\.|location\.search/)
    // This tab's storage holds only the capture's own keys.
    expect([...text.matchAll(/sessionStorage\.(?:get|set|remove)Item\(([A-Z_]+)/g)].every((m) => ['DIAG_LAST_KEY', 'DIAG_FOUND_KEY'].includes(m[1]))).toBe(true)
    // The address is read once, to go back to it without the flag, and never kept.
    expect(text.match(/location\.href/g)).toHaveLength(1)
    expect(text).toMatch(/new URL\(location\.href\)/)
    // Message data is read for its length, and for its verb only through rxVerb (its first bytes).
    expect(text.match(/e\.data\b[^;\n]*/g)!.every((l) => /\.length/.test(l) || l === 'e.data) })')).toBe(true)
    expect(text).toMatch(/rxCount\(e\.data\)/)
    expect(text).toMatch(/const rxCount = \(data: unknown\): void => \{\n\s*const v = rxVerb\(data\)/)
    expect(text).not.toMatch(/JSON\.parse/)
  })
})

describe('the biggest localStorage keys', () => {
  const NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5'
  const HEX = 'cfe6b74cab677b52d850ac659d54266a3a4d7bb48270234d2fec836881d0a5f7'
  it('lists the largest first, at most ten, by name and size only, a pubkey in a name masked', () => {
    const entries: Array<[string, number]> = Array.from({ length: 14 }, (_, i) => [`onosendai:k${i}`, i * 10])
    entries.push([`onosendai:chain:${HEX}`, 3_000_000], [`onosendai:${NSEC}`, 5])
    const top = largestKeys(entries)
    expect(top).toHaveLength(10)
    expect(top[0]).toEqual(['onosendai:chain:#', 3_000_000])
    expect(top.map((r) => r[1])).toEqual([3_000_000, 130, 120, 110, 100, 90, 80, 70, 60, 50])
    expect(JSON.stringify(largestKeys(entries, 20))).not.toMatch(/nsec1|[0-9a-f]{16}/i)
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

describe('long animation frames, by who ran in them (owner walk of 2026-11-21)', () => {
  const frame = (duration: number, scripts: Array<Record<string, unknown>>, extra: Record<string, number> = {}) => ({ startTime: 1000, duration, ...extra, scripts: scripts as never })
  const ws = { duration: 70, invokerType: 'event-listener', invoker: 'WebSocket.onmessage', sourceFunctionName: 'h', sourceURL: 'https://onosendai.tech/assets/boot-SKDJhwQn.js?v=1', sourceCharPosition: 1234, forcedStyleAndLayoutDuration: 2 }

  it('counts every frame of 50 ms or more, not only the 200 ms ones, and skips shorter frames', () => {
    const l = new LoafLedger()
    l.add(frame(LOAF_MIN_MS - 1, [ws]))
    expect(l.take(5)).toBeNull()
    // A frame whose animation frame callback (3 ms of script) ran from 1072 and whose style and layout ran from 1076 to its end at 1082.
    l.add(frame(82, [ws, { startTime: 1072, duration: 3, invokerType: 'user-callback', invoker: 'FrameRequestCallback', sourceFunctionName: 'tick', sourceURL: 'https://onosendai.tech/assets/boot-SKDJhwQn.js' }], { blockingDuration: 32, renderStart: 1072, styleAndLayoutStart: 1076 }))
    l.add(frame(88, [ws, { ...ws, duration: 9, invoker: 'IDBRequest.onsuccess', sourceFunctionName: 'put', sourceCharPosition: 77 }], { blockingDuration: 38 }))
    const row = l.take(10)!
    const at = (c: (typeof LOAF_COLUMNS)[number]) => row[LOAF_COLUMNS.indexOf(c)]
    expect(at('t')).toBe(10)
    expect(at('frames')).toBe(2)
    expect(at('ms')).toBe(170)
    expect(at('maxMs')).toBe(88)
    expect(at('blockMs')).toBe(70)
    expect(at('scriptMs')).toBe(152)
    expect(at('rafMs')).toBe(4)
    expect(at('layoutMs')).toBe(6)
    // 170 - 152 script - (4 - 3) callbacks outside any script - 6 layout.
    expect(at('otherMs')).toBe(11)
    const top = at('top') as Array<Array<string | number>>
    const e = Object.fromEntries(LOAF_SCRIPT_COLUMNS.map((c, i) => [c, top[0][i]]))
    expect(e).toEqual({ invokerType: 'event-listener', invoker: 'WebSocket.onmessage', fn: 'h', pos: 1234, file: 'boot-SKDJhwQn.js', n: 2, ms: 140, maxMs: 70, forcedMs: 4 })
    expect(top[1][1]).toBe('IDBRequest.onsuccess')
    // The window starts over; the whole capture keeps its sums.
    expect(l.take(15)).toBeNull()
    expect(l.top()[0][5]).toBe(2)
  })

  it('keeps no URL, key or content: a file by name only, other schemes by scheme only', () => {
    expect(scriptFile('https://onosendai.tech/assets/index-r_sQnZEa.js#x')).toBe('index-r_sQnZEa.js')
    expect(scriptFile('blob:https://onosendai.tech/3f2a9c1e-5b7d-4e8f-a1b2-c3d4e5f6a7b8')).toBe('blob')
    expect(scriptFile('data:text/javascript;base64,ZXZpbA==')).toBe('data')
    expect(scriptFile('chrome-extension://abcdefabcdefabcdef/inpage.js')).toBe('chrome-extension')
    expect(scriptFile(undefined)).toBe('')
    // The page's own address (an inline script, a timer): never its host or its path.
    expect(scriptFile('https://onosendai.tech/')).toBe('page')
    expect(scriptFile('https://onosendai.tech')).toBe('page')
    expect(scriptFile('https://onosendai.tech/C/3fa2b9c1')).toBe('page')
    expect(scriptFile('https://onosendai.tech/C/3fa2b9c1?x=1#y')).toBe('page')
    const l = new LoafLedger()
    l.add(frame(90, [{ duration: 60, invokerType: 'user-callback', invoker: `IMG#a[src="https://x.example/${'a'.repeat(64)}"].onload`, sourceFunctionName: `f${'ab12'.repeat(16)}`, sourceURL: 'https://h.example/u/npub1qqqqqqqqqqqqqqqqqqqqqqqq/x.js' }]))
    const s = JSON.stringify(l.top())
    expect(s).not.toMatch(/https?:|x\.example|npub1|[0-9a-f]{16}/)
    expect(s).toContain('IMG.onload')
  })

  it('a window keeps its top few by time, and a full ring stays small', () => {
    const l = new LoafLedger()
    for (let i = 0; i < 40; i++) l.add(frame(60, [{ ...ws, duration: 10 + i, sourceFunctionName: `fn_${i}`, sourceCharPosition: 123456 + i }]))
    const top = l.take(5)![LOAF_COLUMNS.indexOf('top')] as Array<Array<string | number>>
    expect(top).toHaveLength(LOAF_TOP)
    expect(top.map((e) => e[2])).toEqual(['fn_39', 'fn_38', 'fn_37', 'fn_36', 'fn_35', 'fn_34', 'fn_33', 'fn_32'])
    // Every label at its longest.
    const long = (i: number) => ({ duration: 60, invokerType: 'x'.repeat(30), invoker: `I${'y'.repeat(60)}`, sourceFunctionName: `f${i}${'z'.repeat(60)}`, sourceURL: `https://onosendai.tech/assets/${'w'.repeat(60)}${i}.js`, sourceCharPosition: 12345678 + i, forcedStyleAndLayoutDuration: 1.25 })
    for (let i = 0; i < 40; i++) l.add(frame(60, [long(i)]))
    expect(JSON.stringify(l.take(10)).length * 180 + JSON.stringify(l.top()).length).toBeLessThan(400 * 1024)
  })

  it('the report carries the table, fed by every long frame', () => {
    const text = fs.readFileSync(path.join(SRC, 'lib/diag.ts'), 'utf8')
    expect(text).toMatch(/loafs\.add\(e as unknown as LoafFrame\)\n\s*if \(e\.duration < SLOW_FRAME_MS\) return/)
    expect(text).toMatch(/loaf: loaf\.all\(\)/)
    expect(text).toMatch(/loafTop: loafs\.top\(\)/)
    // The slow log names files the same way.
    expect(text).not.toMatch(/sourceURL \?\? ''\)\.split/)
  })
})

describe('relay frames and checks, counted by kind (owner\'s phone walk, 2026-11-21)', () => {
  it('a frame a relay sends gives up only its verb', () => {
    expect(rxVerb('["EVENT","s",{"content":"x"}]')).toBe('event')
    expect(rxVerb('["OK","id",true,""]')).toBe('ok')
    expect(rxVerb('["EOSE","s"]')).toBe('eose')
    expect(rxVerb('["CLOSED","s","x"]')).toBe('closed')
    expect(rxVerb('["NOTICE","x"]')).toBe('other')
    expect(rxVerb(new ArrayBuffer(2))).toBe('other')
  })

  it('a window\'s checks as a row of numbers, the costliest kinds first', () => {
    expect(verifyRow(5, new Map())).toBeNull()
    const row = verifyRow(10, new Map([[3333, { n: 9, schnorr: 1, hashed: 0, compared: 8, deferred: 0, ms: 12.34 }], [33330, { n: 3, schnorr: 2, hashed: 0, compared: 0, deferred: 1, ms: 20 }]]))!
    expect(row.slice(0, VERIFY_COLUMNS.length - 1)).toEqual([10, 12, 3, 0, 8, 1, 32.3])
    expect(row[VERIFY_COLUMNS.indexOf('top')]).toEqual([[33330, 3, 2, 0, 0, 1, 20], [3333, 9, 1, 0, 8, 0, 12.3]])
    expect(JSON.stringify(row)).toMatch(/^[\[\]0-9.,]+$/)
  })

  it('the capture counts checks and frames, and nothing counts while it is off', async () => {
    const text = fs.readFileSync(path.join(SRC, 'lib/diag.ts'), 'utf8')
    expect(text).toMatch(/const verifies = countVerifies\(\)/)
    expect(text).toMatch(/verify: verify\.all\(\)/)
    const vs = fs.readFileSync(path.join(SRC, 'lib/verifiedSigs.ts'), 'utf8')
    expect(vs).toMatch(/if \(!verifyStats\) return check\(ev, null\)/)
  })
})

describe('columns added later', () => {
  it('come after every column a report already had, so a reader by position still reads those', () => {
    expect(DIAG_COLUMNS.slice(-3)).toEqual(['rxEv', 'rxOk', 'rxEose'])
    expect(DIAG_COLUMNS.indexOf('ui')).toBe(DIAG_COLUMNS.length - 4)
  })
})
