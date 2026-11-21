/**
 * cameraShare.test.tsx: the scene's per-frame camera share writes nothing to
 * the page (scene/Scene.tsx CameraShare).
 *
 * It used to set `--cell-px` on the root element on every frame the camera
 * moved, for a HUD scale instrument removed in August (e89798eb). Nothing read
 * it, and a custom property changed on the root restyles the whole document:
 * the CHAIN chip work (#847, 2026-11-21) measured it as most of the HUD's style
 * time in WALK. The camera's orientation still reaches the compass.
 *
 * Runs CameraShare in a real R3F root (test/r3fRoot.ts) with the camera moving
 * every frame, and watches every write to the root element's style.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { r3fRoot, type R3fRoot } from '../../test/r3fRoot'

// The root element's style, watched: a write of any property, or of the whole attribute, is caught.
const rootStyle = vi.hoisted(() => {
  const writes: string[] = []
  const style = {
    setProperty: (name: string) => { writes.push(name) },
    removeProperty: (name: string) => { writes.push(`-${name}`) },
    getPropertyValue: () => '',
  }
  const doc = (globalThis as unknown as { document?: object }).document
  if (doc) Object.defineProperty(doc, 'documentElement', { value: { style }, configurable: true })
  else (globalThis as { document?: unknown }).document = { documentElement: { style }, visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined }
  return { writes }
})

import { CameraShare } from '../Scene'
import { cameraPose } from '../../lib/cameraPose'

// The dev build's harness handles are kept on the window.
;(globalThis as { window?: unknown }).window ??= globalThis

let r: R3fRoot | null = null
afterEach(async () => {
  await r?.unmount()
  r = null
  rootStyle.writes.length = 0
})

describe("the scene's per-frame camera share", () => {
  it('writes nothing to the root element, however the camera moves', async () => {
    r = await r3fRoot()
    await r.render(createElement(CameraShare))
    rootStyle.writes.length = 0
    const camera = r.state().camera
    for (let i = 0; i < 60; i++) {
      // A dolly and an orbit every frame, as WALK's follow camera does.
      camera.position.set(Math.sin(i / 7) * 10, 2 + i * 0.05, 10 + Math.cos(i / 5) * 4)
      camera.lookAt(0, 0, 0)
      await r.frame()
    }
    expect(rootStyle.writes).toEqual([])
  })

  it('writes nothing on frames where nothing changed either', async () => {
    r = await r3fRoot()
    await r.render(createElement(CameraShare))
    rootStyle.writes.length = 0
    for (let i = 0; i < 30; i++) await r.frame()
    expect(rootStyle.writes).toEqual([])
  })

  it('still hands the compass the camera’s orientation every frame', async () => {
    r = await r3fRoot()
    await r.render(createElement(CameraShare))
    const camera = r.state().camera
    camera.position.set(4, 3, 7)
    camera.lookAt(0, 0, 0)
    await r.frame()
    expect(cameraPose.angleTo(camera.quaternion)).toBeLessThan(1e-9)
    camera.position.set(-6, 1, 2)
    camera.lookAt(0, 0, 0)
    await r.frame()
    expect(cameraPose.angleTo(camera.quaternion)).toBeLessThan(1e-9)
  })
})

describe('no per-frame write to the root element anywhere', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === '__tests__' || f === 'test' ? [] : files(p)
    return /\.(ts|tsx)$/.test(f) ? [p] : []
  })
  const src = new URL('../../', import.meta.url).pathname

  it('nothing sets or reads --cell-px: the variable is gone', () => {
    const hits = [...files(src), join(src, 'styles.css')].filter((f) => readFileSync(f, 'utf8').includes('--cell-px') && !f.endsWith('Scene.tsx'))
    expect(hits).toEqual([])
    // Scene.tsx only names it in the comment that says why it went.
    const scene = readFileSync(join(src, 'scene/Scene.tsx'), 'utf8')
    expect(scene).not.toMatch(/setProperty\(\s*['"]--cell-px/)
  })

  it('no useFrame callback writes the root element\'s style', () => {
    const offenders: string[] = []
    for (const f of files(src)) {
      const text = readFileSync(f, 'utf8')
      for (const m of text.matchAll(/useFrame\(/g)) {
        // The callback's body: from the call to its matching close.
        let depth = 0
        let i = text.indexOf('(', m.index)
        const from = i
        for (; i < text.length; i++) {
          if (text[i] === '(') depth++
          else if (text[i] === ')' && --depth === 0) break
        }
        if (/documentElement\.style|document\.body\.style/.test(text.slice(from, i))) offenders.push(`${f.slice(src.length)}:${text.slice(0, m.index).split('\n').length}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
