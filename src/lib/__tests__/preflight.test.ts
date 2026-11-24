/**
 * preflight.test.ts: index.html's preflight, the plain ES5 script that runs
 * before any of the app (README "Browsers"; arkinox, 2026-11-23, an old iPad:
 * "the tour basically didnt draw everything").
 *
 * - It is ES5, so the oldest Safari can run it and say why the app cannot.
 * - A browser without WebGL 2, or without the JavaScript of Safari 15.4, gets
 *   a page in words in place of the wordmark, and main.tsx starts nothing.
 * - A browser that can run the app gets nothing from it but the watch: when
 *   the app's first script never runs, or its chunk fails, the page says it
 *   could not start, with RELOAD; never over an app that has drawn.
 * - The app's own code keeps to what Safari 15.4 can parse and run: no regex
 *   lookbehind (Safari 16.4) and none of the newer built-ins listed below.
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { transformSync } from 'esbuild'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../..')
const SRC = path.join(ROOT, 'src')
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const script = html.match(/<script id="preflight">([\s\S]*?)<\/script>/)?.[1] ?? ''

/** What #root holds before the app draws: the wordmark (its markup is bootSequence.test's to check). */
const WORDMARK = '<div class="wordmark"></div>'

interface Page {
  __onosendaiUnsupported?: string[]
  __onosendaiRan?: boolean
  onosendaiCannotStart?: (reason?: string) => void
}

/** Runs the preflight in a page of its own. `strip` runs first, in that page, to take away what an older browser lacks. */
function run({ webgl2 = true, strip = '', drawn = false, ua = 'Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X)' } = {}) {
  const listeners: Record<string, Array<(e?: unknown) => void>> = {}
  const timers: Array<() => void> = []
  const root = { innerHTML: WORDMARK }
  const page: Record<string, unknown> = {
    navigator: { userAgent: ua },
    document: { getElementById: (id: string) => (id === 'root' ? root : null), addEventListener: () => undefined },
    addEventListener: (type: string, fn: (e?: unknown) => void) => { (listeners[type] ??= []).push(fn) },
    setTimeout: (fn: () => void) => { timers.push(fn) },
  }
  if (drawn) page.__onosendaiDrawn = true
  if (webgl2) page.WebGL2RenderingContext = function WebGL2RenderingContext() {}
  page.window = page
  const ctx = vm.createContext(page)
  // structuredClone is the host's, not the language's: the page has it unless stripped.
  vm.runInContext('window.structuredClone = function (v) { return v };' + strip, ctx)
  vm.runInContext(script, ctx)
  const fire = (type: string, e?: unknown): void => { for (const fn of listeners[type] ?? []) fn(e) }
  const elapse = (): void => { for (const fn of timers.splice(0)) fn() }
  return { page: page as Page, root, fire, elapse }
}

describe('the preflight', () => {
  it('is in the head, before the app, and plain ES5', () => {
    expect(script.length).toBeGreaterThan(200)
    expect(html.indexOf('<script id="preflight">')).toBeLessThan(html.indexOf('</head>'))
    expect(html.indexOf('<script id="preflight">')).toBeLessThan(html.indexOf('<script type="module"'))
    expect(script).not.toMatch(/`/)
    // esbuild refuses to lower let, const, arrows and classes to ES5: any of them throws here.
    expect(() => transformSync(script, { target: 'es5', loader: 'js' })).not.toThrow()
  })

  it('leaves a browser that can run the app alone, and only watches', () => {
    const { page, root } = run()
    expect(page.__onosendaiUnsupported).toBeUndefined()
    expect(typeof page.onosendaiCannotStart).toBe('function')
    expect(root.innerHTML).toBe(WORDMARK)
  })

  it('says in words that a browser without WebGL 2 cannot run it, and what can', () => {
    const { page, root } = run({ webgl2: false })
    expect(page.__onosendaiUnsupported).toEqual(['3D graphics (WebGL 2)'])
    expect(root.innerHTML).toMatch(/class="cannot-run"/)
    expect(root.innerHTML).toMatch(/can’t run in this browser/)
    expect(root.innerHTML).toMatch(/missing 3D graphics \(WebGL 2\)/)
    expect(root.innerHTML).toMatch(/iOS or iPadOS 15\.4 or newer/)
    // An Apple device without WebGL 2 may be in Lockdown Mode.
    expect(root.innerHTML).toMatch(/Lockdown Mode/)
    expect(root.innerHTML).not.toMatch(/RELOAD/)
  })

  it('turns away Safari before 15.4 by what it lacks, not by its name', () => {
    for (const strip of ['delete Object.hasOwn;', 'delete Array.prototype.at;', 'delete Array.prototype.findLast;', 'delete window.structuredClone;']) {
      const { page, root } = run({ strip })
      expect(page.__onosendaiUnsupported, strip).toEqual(['a recent web engine (Safari 15.4 or newer)'])
      expect(root.innerHTML, strip).toMatch(/class="cannot-run"/)
      expect(root.innerHTML, strip).not.toMatch(/Lockdown/)
    }
  })

  it('says the app could not start when its first script never ran, with the reason and RELOAD', () => {
    const { page, root, fire, elapse } = run()
    fire('error', { message: 'SyntaxError: Unexpected token \'<\'' })
    fire('load')
    elapse()
    expect(page.__onosendaiRan).toBeUndefined()
    expect(root.innerHTML).toMatch(/couldn’t start/)
    expect(root.innerHTML).toMatch(/SyntaxError: Unexpected token '&lt;'/)
    expect(root.innerHTML).toMatch(/RELOAD/)
  })

  it('stays quiet once the app has run, and never covers an app that has drawn', () => {
    const ran = run()
    ran.page.__onosendaiRan = true
    ran.fire('load')
    ran.elapse()
    expect(ran.root.innerHTML).toBe(WORDMARK)

    const drawn = run({ drawn: true })
    drawn.page.onosendaiCannotStart!('TypeError: late')
    expect(drawn.root.innerHTML).toBe(WORDMARK)
  })

  it('escapes what it shows', () => {
    const { page, root } = run()
    page.onosendaiCannotStart!('<img src=x onerror=alert(1)>')
    expect(root.innerHTML).not.toMatch(/<img src=x/)
    expect(root.innerHTML).toMatch(/&lt;img src=x onerror=alert\(1\)&gt;/)
  })
})

describe("main.tsx, boot.tsx and the preflight", () => {
  it('marks that it ran, starts nothing on a browser the preflight turned away, and hands a failed load to the page', () => {
    const main = fs.readFileSync(path.join(SRC, 'main.tsx'), 'utf8')
    expect(main).toMatch(/page\.__onosendaiRan = true/)
    expect(main).toMatch(/if \(!page\.__onosendaiUnsupported\) \{\s*void runBoot\(\{/)
    expect(main).toMatch(/onFail: \(err\) => page\.onosendaiCannotStart\?\.\(/)
  })

  it('boot.tsx marks the first draw, so the preflight never covers a drawn app', () => {
    const boot = fs.readFileSync(path.join(SRC, 'boot.tsx'), 'utf8')
    const draw = boot.match(/function draw\(\): void \{([\s\S]*?)\n\}/)?.[1] ?? ''
    expect(draw).toMatch(/preflightPage\(\)\.__onosendaiDrawn = true/)
    expect(draw.indexOf('__onosendaiDrawn')).toBeLessThan(draw.indexOf('createRoot'))
  })
})

/** Every source file of the app, tests aside. */
function sources(dir = SRC): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'test') out.push(...sources(p)) }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

describe('the app keeps to Safari 15.4', () => {
  // Built-ins newer than Safari 15.4 with no fallback in the app. The build
  // cannot write these in older words, as it does for syntax. Add one only
  // behind a check that it exists.
  const NEWER = [
    /\(\?<[=!]/, // regex lookbehind, Safari 16.4: in a literal it stops the whole file from parsing there
    /\.toSorted\(|\.toReversed\(|\.toSpliced\(/, // Safari 16
    /\bObject\.groupBy\b|\bMap\.groupBy\b/, // Safari 17.4
    /\bPromise\.withResolvers\b/, // Safari 17.4
    /\bArray\.fromAsync\b/, // Safari 16.4
    /\bAbortSignal\.any\b/, // Safari 17.4
    /\.checkVisibility\(/, // Safari 17.4
  ]

  it('uses no regex lookbehind and none of the newer built-ins', () => {
    const hits: string[] = []
    for (const file of sources()) {
      const code = fs.readFileSync(file, 'utf8')
      code.split('\n').forEach((line, i) => {
        for (const re of NEWER) if (re.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 120)}`)
      })
    }
    expect(hits).toEqual([])
  })
})
