/**
 * No hook below an early return, in any component or hook under src/hud and
 * src/scene.
 *
 * React numbers hooks by the order they are called. A component that returns
 * early on one render and calls one more hook on the next renders "more hooks
 * than during the previous render" (React error 310) and the nearest boundary
 * blanks it. LootDetail did exactly that: it is mounted all the time, rendered
 * null while no bag was selected, and called useBagReading below that return,
 * so the first tap on any bag crashed the modal (arkinox, 2026-10-09). The
 * project has no lint for the rules of hooks, so this test reads the source:
 * in every top-level function whose name starts with a capital letter or with
 * `use`, a `useX(` call at the function's own indent must not follow a
 * `return` at that indent.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOTS = [join(__dirname, '..'), join(__dirname, '..', '..', 'scene')]

/** Every .tsx file directly under the roots (tests excluded). */
function sources(): string[] {
  return ROOTS.flatMap((dir) => readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)))
}

interface Offence { file: string; line: number; fn: string; returnLine: number }

/** Top-level hooks called after an early return, per component or custom hook. */
export function hooksAfterReturn(file: string, text: string): Offence[] {
  const out: Offence[] = []
  let fn = ''
  let returnLine = 0
  let inIf = false
  text.split('\n').forEach((raw, i) => {
    const line = i + 1
    const head = /^(?:export )?(?:default )?function ([A-Z]\w*|use[A-Z]\w*)\(/.exec(raw)
    if (head) { fn = head[1]; returnLine = 0; inIf = false; return }
    if (/^}/.test(raw)) { fn = ''; returnLine = 0; inIf = false; return }
    if (!fn) return
    // The function's own statements sit at two spaces. A return there, or in
    // an if block opened there, that is not the final JSX return is an early
    // return.
    if (/^ {2}if \(.*\) \{\s*$/.test(raw)) { inIf = true; return }
    if (/^ {2}\}/.test(raw)) { inIf = false; return }
    const flat = /^ {2}(?:if \(.*\) )?return\b/.test(raw) && !/^ {2}return \($/.test(raw) && !/^ {2}return </.test(raw) && !/^ {2}return \{/.test(raw)
    const inBlock = inIf && /^ {4}return\b/.test(raw)
    if (flat || inBlock) {
      if (returnLine === 0) returnLine = line
      return
    }
    if (returnLine > 0 && /^ {2}(?:const |let |var |)[^\s/*].*\buse[A-Z]\w*\(/.test(raw)) {
      out.push({ file, line, fn, returnLine })
    }
  })
  return out
}

describe('hooks come before every early return', () => {
  it('finds nothing to report in src/hud and src/scene', () => {
    const offences = sources().flatMap((f) => hooksAfterReturn(f, readFileSync(f, 'utf8')))
    expect(offences.map((o) => `${o.file}:${o.line} ${o.fn} calls a hook after the return on line ${o.returnLine}`)).toEqual([])
  })

  it('catches the shape that crashed LootDetail', () => {
    const bad = [
      'export function Record(): JSX.Element | null {',
      '  const item = useLootView((s) => s.selected)',
      '  if (!item) return null',
      '  const reading = useBagReading(item.bagId)',
      '  return <div>{reading?.kind}</div>',
      '}',
    ].join('\n')
    expect(hooksAfterReturn('Record.tsx', bad)).toEqual([{ file: 'Record.tsx', line: 4, fn: 'Record', returnLine: 3 }])
    const good = bad.split('\n').filter((l) => !l.includes('useBagReading')).join('\n')
    expect(hooksAfterReturn('Record.tsx', good)).toEqual([])
  })
})
